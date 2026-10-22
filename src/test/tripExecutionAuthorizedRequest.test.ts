import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import {
  createTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionAuthorization,
  getTripPlanningExecutionAuthorizationId,
  isTripPlanningExecutionAuthorization,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import {
  createTripExecutionProviderRequest,
  getTripExecutionProviderRequestId,
  isTripExecutionProviderRequest,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import {
  createTripExecutionDispatchInstruction,
  getTripExecutionDispatchId,
} from '../services/tripExecution/tripExecutionDispatch';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { createTripExecutionQualifiedAuthorization } from '../services/tripExecution/tripExecutionQualifiedAuthorization';
import {
  createTripExecutionAuthorizedRequest,
  TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS,
  type TripExecutionAuthorizedRequest,
} from '../services/tripExecution/tripExecutionAuthorizedRequest';
import { MAX_PROVIDER_ID_LENGTH } from '../domain/providers/providerResults';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';

const SOURCE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionAuthorizedRequest.ts'
);
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
// Comments and string literals removed, so an assertion about *code* cannot be
// satisfied by a doc comment or by a bare token.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");

function placeReference(overrides: Record<string, unknown> = {}): TripPlanningReference {
  return {
    id: 'place:alpha',
    title: 'Alpha Place',
    kind: 'activity',
    provider: 'Test Provider',
    providerId: 'alpha-1',
    ...overrides,
  } as TripPlanningReference;
}

function requireValue<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} missing`);
  return value;
}

/** The real STEP 57 id function, so a test never restates the formula. */
function authorizationIdOf(authorization: TripPlanningExecutionAuthorization): string {
  return getTripPlanningExecutionAuthorizationId(authorization.requestId);
}

/** The real STEP 56 request, built through the real domain chain. */
function validStep56Request(tripId = 'trip-plan'): TripPlanningExecutionRequest {
  const composition = requireValue(
    createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    }),
    'composition'
  );
  const approved = requireValue(
    approveTripPlanningCompositionProposal(
      requireValue(createTripPlanningCompositionProposal(composition), 'proposal')
    ),
    'approved'
  );
  const application = requireValue(createTripPlanningApplication(approved), 'application');
  const target = requireValue(
    createTripPlanningApplicationTarget({ scope: 'trip', tripId }),
    'target'
  );
  const binding = requireValue(createTripPlanningApplicationBinding(application, target), 'binding');
  const intent = requireValue(createTripPlanningExecutionIntent(binding), 'intent');
  return requireValue(createTripPlanningExecutionRequest(intent), 'step56 request');
}

/**
 * The real STEP 59 provider request, built by the real STEP 59 factory from the
 * real STEP 58 instruction, which in turn comes from the real STEP 57 factory.
 * No test fabricates a provider request.
 */
function providerRequestFor(
  step56Request: TripPlanningExecutionRequest
): TripExecutionProviderRequest {
  const authorization = requireValue(
    createTripPlanningExecutionAuthorization(step56Request),
    'authorization'
  );
  const dispatch = requireValue(createTripExecutionDispatchInstruction(authorization), 'dispatch');
  return requireValue(createTripExecutionProviderRequest(dispatch), 'provider request');
}

/** A real STEP 63 plan, built by the genuine factory. */
function validPlan(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
) {
  const providers = providerIds.map((providerId) => ({
    providerId,
    async execute() {
      return Promise.resolve({ providerId, requestId: 'unused', status: 'accepted' as const });
    },
  }));
  return requireValue(
    createTripExecutionPlan(providerRequestFor(validStep56Request(tripId)), providers),
    'plan'
  );
}

/** A real STEP 70 eligibility result. */
function eligibleFor(
  step56Request: TripPlanningExecutionRequest,
  providerIds: ReadonlyArray<string>,
  requiredCapabilityId: string = CAPABILITY
): Record<string, unknown> {
  return {
    eligible: true,
    requestId: step56Request.id,
    requiredCapabilityId,
    providerIds: [...providerIds],
    capabilityIds: [requiredCapabilityId],
    reason: 'eligible',
  };
}

/** A genuine STEP 72 qualified dispatch, from the real STEP 71 and STEP 72 evaluators. */
function validDispatch(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): Record<string, unknown> {
  const request = validStep56Request(tripId);
  const plan = validPlan(providerIds, tripId);
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: eligibleFor(request, plan.providerIds as string[]),
  });
  if (!qualification.qualified) throw new Error('test setup: fixture did not qualify');

  const qualified = createTripExecutionQualifiedDispatch({ qualification });
  if (!qualified.dispatched) {
    throw new Error(`test setup: fixture did not dispatch (${qualified.reason})`);
  }
  return {
    ...qualified,
    dispatch: { ...qualified.dispatch },
    providerIds: [...qualified.providerIds],
  } as Record<string, unknown>;
}

/** A real STEP 72 negative result, straight from the evaluator. */
function negativeDispatch(): Record<string, unknown> {
  const request = validStep56Request();
  const plan = validPlan();
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: {
      eligible: false,
      requestId: request.id,
      requiredCapabilityId: null,
      providerIds: [],
      capabilityIds: [],
      reason: 'no-eligible-provider',
    },
  });
  return { ...createTripExecutionQualifiedDispatch({ qualification }) } as Record<string, unknown>;
}

/**
 * A genuine STEP 73 qualified authorization, produced by the real STEP 73
 * boundary from a genuine STEP 72 dispatch. Detached so mutation tests have a
 * real object to prove against.
 */
function authorizedResult(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): TripExecutionAuthorizedRequest & Record<string, unknown> {
  const result = createTripExecutionQualifiedAuthorization({ dispatch: validDispatch(providerIds, tripId) });
  if (!result.authorized) throw new Error(`test setup: fixture not authorized (${result.reason})`);
  return {
    ...result,
    authorization: result.authorization === null ? null : { ...result.authorization },
    providerIds: [...result.providerIds],
  } as unknown as TripExecutionAuthorizedRequest & Record<string, unknown>;
}

function authorizedWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...authorizedResult(), ...overrides };
}

/** A real STEP 73 negative result, straight from the real boundary. */
function unauthorizedResult(): Record<string, unknown> {
  const result = createTripExecutionQualifiedAuthorization({ dispatch: negativeDispatch() });
  if (result.authorized) throw new Error('test setup: fixture unexpectedly authorized');
  return { ...result, providerIds: [...result.providerIds] } as Record<string, unknown>;
}

function handoff(authorization: unknown): TripExecutionAuthorizedRequest {
  return createTripExecutionAuthorizedRequest({ authorization });
}

describe('STEP 74 provider request: authorization validity (1-7)', () => {
  it('1. a genuine STEP 73 authorization produces a provider request', () => {
    const result = handoff(authorizedResult());
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('accepted');
    expect(result.providerRequest).not.toBeNull();
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('2. a missing authorization is rejected', () => {
    for (const missing of [undefined, null, {}]) {
      const result = handoff(missing);
      expect(result.accepted, String(missing)).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
    // An input that is not an object at all is refused before it is read.
    for (const bad of [undefined, null, 'authorization', 7, [], true]) {
      const result = createTripExecutionAuthorizedRequest(bad as never);
      expect(result.accepted, String(bad)).toBe(false);
      expect(result.reason).toBe('authorization-result-invalid');
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
    // A well-formed negative STEP 73 result is reported as not authorized, not
    // as a missing value.
    const negative = handoff(unauthorizedResult());
    expect(negative.accepted).toBe(false);
    expect(negative.reason).toBe('not-authorized');
    expect(negative.providerRequest).toBeNull();
    expect(negative.providerIds).toEqual([]);
  });

  it('3. a malformed authorization result is rejected', () => {
    const malformed: ReadonlyArray<unknown> = [
      'authorized',
      42,
      true,
      [],
      { authorized: 'yes', reason: 'authorized' },
      { authorized: true },
      { authorized: true, reason: 'looks-authorized' },
      { authorized: true, reason: 'authorized', providerIds: 'amadeus-execution' },
      { authorized: true, reason: 'authorized', providerIds: [1] },
      { authorized: true, reason: 'authorized', providerIds: [' padded '] },
      { authorized: true, reason: 'authorized', providerIds: [''] },
      { authorized: true, reason: 'authorized', providerIds: [], authorizationId: 7 },
      {
        authorized: true,
        reason: 'authorized',
        providerIds: ['ok'],
        requiredCapabilityId: 7,
      },
    ];
    for (const value of malformed) {
      const result = handoff(value);
      expect(result.accepted, JSON.stringify(value)).toBe(false);
      expect(result.reason).toBe('authorization-result-invalid');
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('4. authorized === false is rejected even with a real authorization attached', () => {
    // The most dangerous shape this step can be handed: a genuine STEP 57
    // authorization, a real chain, and a negative verdict. The verdict governs.
    const real = authorizedResult();
    const flipped = handoff(authorizedWith({ authorized: false, authorization: real.authorization }));
    expect(flipped.accepted).toBe(false);
    expect(flipped.reason).toBe('not-authorized');
    expect(flipped.providerRequest).toBeNull();
    expect(flipped.providerIds).toEqual([]);

    // And a positive verdict with the negative result's own reason token is a
    // self-contradictory value, not an authorization.
    const contradictory = handoff(
      authorizedWith({ reason: (unauthorizedResult().reason as string) })
    );
    expect(contradictory.accepted).toBe(false);
    expect(contradictory.reason).toBe('authorization-result-invalid');
  });

  it('5. an invalid authorization ID is rejected', () => {
    const real = authorizedResult().authorization as TripPlanningExecutionAuthorization;

    // An id that is not an authorization id at all is reported as such.
    for (const id of [undefined, null, '', 'trip-planning-execution-authorization:', 'not-an-id', 42]) {
      const result = handoff(authorizedWith({ authorization: { ...real, id } }));
      expect(result.accepted, String(id)).toBe(false);
      expect(result.reason).toBe('authorization-id-invalid');
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }

    // An id that is well formed but does not derive from the request is reported
    // by the real STEP 57 validator's verdict instead.
    for (const id of [`${real.id}-tampered`, 'trip-planning-execution-authorization:trip-planning-execution-request:other']) {
      const result = handoff(authorizedWith({ authorization: { ...real, id } }));
      expect(result.accepted, id).toBe(false);
      expect(result.reason).toBe('authorization-invalid');
      expect(result.providerRequest).toBeNull();
    }

    // And a request id that does not derive is refused the same way.
    const badRequest = handoff(
      authorizedWith({
        authorization: { ...real, requestId: 'trip-planning-execution-request:trip-planning-execution-intent:other' },
      })
    );
    expect(badRequest.accepted).toBe(false);
    expect(badRequest.reason).toBe('authorization-invalid');

    // A missing authorization object is its own reason. A non-object one is a
    // shape fault, because the shape gate owns the field's type.
    for (const missing of [null, undefined]) {
      const result = handoff(authorizedWith({ authorization: missing }));
      expect(result.accepted, String(missing)).toBe(false);
      expect(result.reason).toBe('authorization-missing');
      expect(result.providerRequest).toBeNull();
    }
    for (const wrongType of ['authorization', 7, [], true]) {
      const result = handoff(authorizedWith({ authorization: wrongType }));
      expect(result.accepted, String(wrongType)).toBe(false);
      expect(result.reason).toBe('authorization-result-invalid');
      expect(result.providerRequest).toBeNull();
    }
  });

  it('6. an invalid dispatch relationship is rejected', () => {
    // Absent and null are the field's own gate (the shape contract treats an
    // absent key as "not supplied"); a wrong-typed value is the shape gate's;
    // a well-typed string is judged on its own terms.
    for (const dispatchId of [undefined, null, '', 'trip-execution-dispatch:', 'dispatch-1', 9, []]) {
      const result = handoff(authorizedWith({ dispatchId }));
      expect(result.accepted, String(dispatchId)).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
      const expected =
        dispatchId == null || typeof dispatchId === 'string'
          ? 'dispatch-id-invalid'
          : 'authorization-result-invalid';
      expect(result.reason).toBe(expected);
    }
  });

  it('7. an invalid request relationship is rejected', () => {
    for (const requestId of [
      undefined,
      null,
      '',
      'trip-execution-provider-request:',
      'trip-execution-request:abc',
      'not-a-request-id',
      9,
      [],
    ]) {
      const result = handoff(authorizedWith({ requestId }));
      expect(result.accepted, String(requestId)).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
      const expected =
        requestId == null || typeof requestId === 'string'
          ? 'request-id-invalid'
          : 'authorization-result-invalid';
      expect(result.reason).toBe(expected);
    }

    // A plan id that is well formed but describes other work.
    for (const planId of [undefined, null, '', 'trip-execution-plan:', 'plan-1', 9, []]) {
      const result = handoff(authorizedWith({ planId }));
      expect(result.accepted, String(planId)).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
      const expected =
        planId == null || typeof planId === 'string'
          ? 'plan-id-invalid'
          : 'authorization-result-invalid';
      expect(result.reason).toBe(expected);
    }

    // A plan id that is well formed and derives from a *different* request id.
    const other = authorizedResult(['amadeus-execution'], 'other-trip');
    const crossed = handoff(authorizedWith({ planId: other.planId }));
    expect(crossed.accepted).toBe(false);
    expect(crossed.reason).toBe('identity-inconsistent');
  });
});

describe('STEP 74 provider request: provider validation (8-15)', () => {
  it('8. one valid provider is carried', () => {
    const result = handoff(authorizedResult(['amadeus-execution']));
    expect(result.accepted).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('9. multiple valid providers are carried', () => {
    const result = handoff(authorizedResult(['amadeus-execution', 'google-execution']));
    expect(result.accepted).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution', 'google-execution']);
  });

  it('10. an empty provider list is rejected', () => {
    const result = handoff(authorizedWith({ providerIds: [] }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('provider-set-empty');
    expect(result.providerRequest).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('11. an invalid provider identity is rejected', () => {
    for (const providerId of ['', ' amadeus-execution', 'amadeus-execution ', 7, null, {}]) {
      const result = handoff(authorizedWith({ providerIds: ['amadeus-execution', providerId] }));
      // A wrong type is a shape fault; a well-typed but unusable identity is not.
      const expected =
        typeof providerId === 'string' && providerId.trim() === providerId
          ? 'authorization-result-invalid'
          : 'authorization-result-invalid';
      expect(result.accepted, String(providerId)).toBe(false);
      expect(result.reason).toBe(expected);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('12. a duplicate provider identity is rejected', () => {
    const result = handoff(
      authorizedWith({ providerIds: ['amadeus-execution', 'amadeus-execution'] })
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
    expect(result.providerRequest).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('13. a malformed provider identity is rejected at the boundary', () => {
    // An over-long identity is well typed and well trimmed, so it survives the
    // shape gate and is refused by the domain's own length bound.
    const overlong = 'p'.repeat(MAX_PROVIDER_ID_LENGTH + 1);
    const result = handoff(authorizedWith({ providerIds: [overlong] }));
    expect(result.accepted).toBe(false);
    expect(result.providerRequest).toBeNull();
    expect(result.providerIds).toEqual([]);

    // Exactly at the bound is accepted: the gate is the domain's, not a stricter
    // private one.
    const atBound = 'p'.repeat(MAX_PROVIDER_ID_LENGTH);
    const ok = handoff(authorizedWith({ providerIds: [atBound] }));
    expect(ok.accepted).toBe(true);
    expect(ok.providerIds).toEqual([atBound]);
  });

  it('14. provider order is preserved exactly', () => {
    const order = ['zeta-execution', 'alpha-execution', 'mu-execution'];
    const result = handoff(authorizedWith({ providerIds: order }));
    expect(result.accepted).toBe(true);
    expect(result.providerIds).toEqual(order);
    // Not sorted, not reverse-sorted: the exact input order survives.
    expect(result.providerIds).not.toEqual([...order].sort());
    expect(result.providerIds).not.toEqual([...order].reverse());
  });

  it('15. provider values are not normalized, trimmed, or case-folded', () => {
    const identities = ['Amadeus-Execution', 'AMADEUS-EXECUTION', 'aMaDeUs-ExEcUtIoN'];
    const result = handoff(authorizedWith({ providerIds: identities }));
    expect(result.accepted).toBe(true);
    expect(result.providerIds).toEqual(identities);
    // Case variants are distinct identities, never collapsed to one.
    expect(new Set(result.providerIds).size).toBe(3);
    // They are carried verbatim, not lower-cased or aliased.
    for (const id of result.providerIds) expect(id).toBe(id.trim());
  });
});

describe('STEP 74 provider request: capability (16-20)', () => {
  it('16. a valid capability from the closed vocabulary is accepted', () => {
    for (const capability of PROVIDER_CAPABILITY_IDS) {
      const result = handoff(authorizedWith({ requiredCapabilityId: capability }));
      expect(result.accepted, capability).toBe(true);
      expect(result.requiredCapabilityId).toBe(capability);
    }
  });

  it('17. a missing capability is rejected', () => {
    for (const missing of [null, undefined]) {
      const result = handoff(authorizedWith({ requiredCapabilityId: missing }));
      expect(result.accepted, String(missing)).toBe(false);
      expect(result.reason).toBe('capability-invalid');
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('18. an invalid capability is rejected', () => {
    for (const capability of ['flight-booking', 'payment', 'reserve', 'search-flights', 7]) {
      const result = handoff(authorizedWith({ requiredCapabilityId: capability }));
      expect(result.accepted, String(capability)).toBe(false);
      expect(result.reason).toBe('authorization-result-invalid');
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('19. the capability is preserved exactly', () => {
    for (const capability of PROVIDER_CAPABILITY_IDS) {
      const result = handoff(authorizedWith({ requiredCapabilityId: capability }));
      expect(result.requiredCapabilityId).toBe(capability);
    }
  });

  it('20. no capability is ever inferred', () => {
    const real = authorizedResult();

    // A missing capability is never guessed from the authorization or providers.
    const noCapability = handoff(authorizedWith({ requiredCapabilityId: null }));
    expect(noCapability.accepted).toBe(false);
    expect(noCapability.reason).toBe('capability-invalid');
    expect(noCapability.requiredCapabilityId).toBeNull();

    // The only place a capability is bound to a value in the module is a read of
    // the caller's own field: there is no literal, no fallback, and no derived
    // alternative. The one other binding is the shape gate's own narrowing read.
    const bindings = CODE.match(/const requiredCapabilityId = [^;]+;/g) ?? [];
    expect(bindings).toHaveLength(2);
    expect(CODE).toContain('const requiredCapabilityId = result.requiredCapabilityId;');
    expect(CODE).toContain('const requiredCapabilityId = value.requiredCapabilityId;');
    expect(CODE).not.toMatch(/requiredCapabilityId\s*[:=]\s*'[a-z-]+'/);
    expect(CODE).not.toMatch(/requiredCapabilityId\s*(\?\?|\|\|)/);
    expect(CODE).not.toMatch(/infer|Capable\(|guess|fallback/i);
    // The genuine result's own capability is what comes back, unchanged.
    expect(handoff(real).requiredCapabilityId).toBe(real.requiredCapabilityId);
  });
});

describe('STEP 74 provider request: provider-request creation (21-27)', () => {
  it('21. the successful result contains the real STEP 59 provider request', () => {
    const result = handoff(authorizedResult());
    expect(result.providerRequest).not.toBeNull();
    // Exactly the value the real STEP 59 factory produces for this dispatch.
    const instruction = requireValue(
      createTripExecutionDispatchInstruction(
        result.providerRequest === null
          ? (null as unknown as TripPlanningExecutionAuthorization)
          : (authorizedResult().authorization as TripPlanningExecutionAuthorization)
      ),
      'instruction'
    );
    expect(result.providerRequest).toEqual(
      requireValue(createTripExecutionProviderRequest(instruction), 'expected request')
    );
    // STEP 59 stays provider-neutral: only the three identity fields exist.
    expect(Object.keys(result.providerRequest!).sort()).toEqual(['dispatchId', 'id', 'kind']);
  });

  it('22. the provider request passes the real STEP 59 validator', () => {
    const result = handoff(authorizedResult());
    expect(isTripExecutionProviderRequest(result.providerRequest)).toBe(true);
    // And the embedded STEP 57 value still passes its own real validator.
    expect(isTripPlanningExecutionAuthorization(authorizedResult().authorization)).toBe(true);
  });

  it('23. the request id is exactly the one the real STEP 59 factory produces', () => {
    const result = handoff(authorizedResult());
    const expected = getTripExecutionProviderRequestId(result.dispatchId!);
    expect(result.providerRequest!.id).toBe(expected);
    expect(result.requestId).toBe(expected);
    // Not a second formula, not a prefixed variant, not a normalized variant.
    expect(result.providerRequest!.id).toBe(result.providerRequest!.dispatchId.replace(/^/, 'trip-execution-provider-request:'));
  });

  it('24. the request id corresponds to the authorized chain', () => {
    const source = authorizedResult();
    const result = handoff(source);
    // Each link in the authorized chain is reproduced exactly, in order.
    const authorization = source.authorization as TripPlanningExecutionAuthorization;
    const instruction = requireValue(
      createTripExecutionDispatchInstruction(authorization),
      'instruction'
    );
    expect(result.authorizationId).toBe(authorization.id);
    expect(result.dispatchId).toBe(instruction.id);
    expect(result.dispatchId).toBe(getTripExecutionDispatchId(authorization.id));
    expect(result.requestId).toBe(getTripExecutionProviderRequestId(instruction.id));
    expect(result.planId).toBe(source.planId);
    // The provider request references the dispatch this authorization produced.
    expect(result.providerRequest!.dispatchId).toBe(instruction.id);
  });

  it('25. the round-trip identity equality holds', () => {
    const source = authorizedResult();
    const result = handoff(source);
    const authorization = source.authorization as TripPlanningExecutionAuthorization;

    // Forward: authorization -> instruction -> provider request, using only real
    // factories, and arriving at the values this result reported.
    const instruction = requireValue(
      createTripExecutionDispatchInstruction(authorization),
      'instruction'
    );
    const expected = requireValue(createTripExecutionProviderRequest(instruction), 'request');
    expect(result.providerRequest).toEqual(expected);

    // Backward: the created provider request re-derives the same dispatch, and
    // that dispatch re-derives the same authorization, closing the loop.
    expect(getTripExecutionDispatchId(authorization.id)).toBe(expected.dispatchId);
    expect(
      getTripExecutionProviderRequestId(expected.dispatchId)
    ).toBe(expected.id);

    // A restated authorization id that disagrees is caught by the same equality.
    const restated = handoff(authorizedWith({ authorizationId: `${authorization.id}-other` }));
    expect(restated.accepted).toBe(false);
    expect(restated.reason).toBe('identity-inconsistent');
    expect(restated.providerRequest).toBeNull();
    expect(restated.providerIds).toEqual([]);
  });

  it('26. a look-alike provider-request chain fails closed', () => {
    const source = authorizedResult();
    const real = source.requestId!;
    const lookalikes: ReadonlyArray<string> = [
      real.toUpperCase(),
      ` ${real}`,
      `${real} `,
      `${real}-extra`,
      real.replace('trip-execution-provider-request:', 'trip-execution-provider-request'),
      real.replace('trip-execution-dispatch:', 'trip-execution-dispatch'),
      'trip-execution-provider-request:trip-execution-dispatch:',
    ];
    for (const requestId of lookalikes) {
      const result = handoff(authorizedWith({ requestId }));
      expect(result.accepted, requestId).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('27. a malformed provider-request relationship fails closed', () => {
    // A request id from a *different* authorization, carrying its own consistent
    // plan id. Every identity is well formed; the chain is simply not this one.
    const other = authorizedResult(['amadeus-execution'], 'other-trip');
    const swapped = handoff(
      authorizedWith({ requestId: other.requestId, planId: other.planId })
    );
    expect(swapped.accepted).toBe(false);
    expect(swapped.reason).toBe('identity-inconsistent');
    expect(swapped.providerRequest).toBeNull();
    expect(swapped.providerIds).toEqual([]);

    // A dispatch id from that other authorization, likewise.
    const swappedDispatch = handoff(authorizedWith({ dispatchId: other.dispatchId }));
    expect(swappedDispatch.accepted).toBe(false);
    expect(swappedDispatch.reason).toBe('identity-inconsistent');

    // And a plan id that does not derive from the request id at all.
    const badPlan = handoff(authorizedWith({ planId: 'trip-execution-plan:trip-execution-other' }));
    expect(badPlan.accepted).toBe(false);
    expect(badPlan.reason).toBe('identity-inconsistent');
    expect(badPlan.providerRequest).toBeNull();
  });
});

describe('STEP 74 provider request: output integrity (28-35)', () => {
  it('28. the authorization id is preserved', () => {
    const source = authorizedResult();
    const result = handoff(source);
    const authorization = source.authorization as TripPlanningExecutionAuthorization;
    expect(result.authorizationId).toBe(authorization.id);
    // The genuine STEP 57 id, not a re-derived or restated one.
    expect(result.authorizationId).toBe(
      getTripPlanningExecutionAuthorizationId(authorization.requestId)
    );
  });

  it('29. the dispatch id is preserved', () => {
    const source = authorizedResult();
    const result = handoff(source);
    expect(result.dispatchId).toBe(source.dispatchId);
    expect(result.providerRequest!.dispatchId).toBe(source.dispatchId);
  });

  it('30. the request id is preserved', () => {
    const source = authorizedResult();
    const result = handoff(source);
    expect(result.requestId).toBe(source.requestId);
  });

  it('31. the plan id is preserved', () => {
    const source = authorizedResult();
    const result = handoff(source);
    expect(result.planId).toBe(source.planId);
  });

  it('32. the provider order is preserved', () => {
    const order = ['delta-execution', 'bravo-execution', 'alpha-execution'];
    const result = handoff(authorizedWith({ providerIds: order }));
    expect(result.accepted).toBe(true);
    expect(result.providerIds).toEqual(order);
  });

  it('33. the capability is preserved', () => {
    const source = authorizedResult();
    expect(handoff(source).requiredCapabilityId).toBe(source.requiredCapabilityId);
  });

  it('34. every failure returns providerRequest null', () => {
    const failures: ReadonlyArray<unknown> = [
      undefined,
      null,
      'x',
      {},
      unauthorizedResult(),
      authorizedWith({ authorized: false }),
      authorizedWith({ authorization: null }),
      authorizedWith({ dispatchId: 'bad' }),
      authorizedWith({ requestId: 'bad' }),
      authorizedWith({ planId: 'bad' }),
      authorizedWith({ requiredCapabilityId: null }),
      authorizedWith({ providerIds: [] }),
      authorizedWith({ providerIds: ['a', 'a'] }),
    ];
    for (const value of failures) {
      const result = handoff(value);
      expect(result.accepted, JSON.stringify(value)).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.reason).not.toBe('accepted');
    }
  });

  it('35. every failure returns an empty provider list', () => {
    const failures: ReadonlyArray<unknown> = [
      undefined,
      {},
      unauthorizedResult(),
      authorizedWith({ providerIds: [] }),
      authorizedWith({ providerIds: ['a', 'a'] }),
      authorizedWith({ requiredCapabilityId: null }),
      authorizedWith({ dispatchId: 'bad' }),
    ];
    for (const value of failures) {
      const result = handoff(value);
      expect(result.providerIds, JSON.stringify(value)).toEqual([]);
      expect(result.providerIds).toHaveLength(0);
    }
  });
});

describe('STEP 74 provider request: safety (36-39)', () => {
  it('36. the input is not mutated', () => {
    const source = authorizedResult();
    const before = JSON.stringify(source);
    const result = handoff(source);
    expect(result.accepted).toBe(true);
    expect(JSON.stringify(source)).toBe(before);

    // The embedded authorization is not rewritten either: same fields, same ids,
    // and a different object from the one handed back on the result.
    const authorization = source.authorization as TripPlanningExecutionAuthorization;
    expect(Object.keys(authorization).sort()).toEqual(['id', 'kind', 'requestId']);
    expect(authorization.id).toBe(authorizationIdOf(authorization));
    expect(authorization.requestId).toBe(authorization.requestId);
  });

  it('37. the provider array is not mutated and not shared', () => {
    const order = ['one-execution', 'two-execution'];
    const source = authorizedWith({ providerIds: [...order] });
    const result = handoff(source);

    expect(result.accepted).toBe(true);
    // A different array object: the caller cannot reach back through the result.
    expect(result.providerIds).not.toBe(source.providerIds);
    // Editing the caller's array does not reach the result.
    (source.providerIds as string[]).push('three-execution');
    expect(result.providerIds).toEqual(order);
    expect(order).toEqual(['one-execution', 'two-execution']);
    // And editing the result does not reach the caller.
    (result.providerIds as string[]).push('four-execution');
    expect(source.providerIds).toEqual([...order, 'three-execution']);
    expect(result.providerRequest).not.toBeNull();
  });

  it('38. repeated calls are deterministic', () => {
    const source = authorizedResult();
    const first = handoff(source);
    const second = handoff(source);
    const third = handoff(authorizedResult());
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Deterministic identities, not merely equal shapes.
    expect(second.providerRequest!.id).toBe(first.providerRequest!.id);
    expect(second.requestId).toBe(first.requestId);
    expect(second.dispatchId).toBe(first.dispatchId);
  });

  it('39. ordinary malformed values never throw', () => {
    const hostile: ReadonlyArray<unknown> = [
      undefined,
      null,
      0,
      1,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      'authorized',
      true,
      false,
      [],
      [undefined],
      [null],
      [{}],
      Symbol('x'),
      () => 0,
      new Date(0),
      { authorized: true, reason: 'authorized', providerIds: new Array(3) },
      { authorized: true, reason: 'authorized', providerIds: [''] },
      { authorized: true, reason: 'authorized', authorization: { id: {} } },
      { authorized: true, reason: 'authorized', dispatchId: { toString() {} } },
      { authorized: true, reason: 'authorized', planId: [] },
    ];
    for (const value of hostile) {
      expect(() => handoff(value), String(value?.toString() ?? 'value')).not.toThrow();
      const result = handoff(value);
      expect(result.accepted).toBe(false);
      expect(result.providerRequest).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });
});

describe('STEP 74 provider request: architectural regression (40-50)', () => {
  it('40. no provider is executed and no provider object is referenced', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
    // The adapter interface itself, not the provider-request type it shares a
    // name prefix with.
    expect(CODE).not.toMatch(/\bTripExecutionProvider\b/);
    expect(CODE).not.toContain('mockTripExecutionProvider');
    for (const forbidden of ['amadeus', 'Amadeus', 'google', 'Google', 'flights', 'hotels']) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('41. no orchestrator is referenced', () => {
    expect(CODE).not.toContain('orchestrat');
    expect(CODE).not.toContain('Orchestrat');
    expect(CODE).not.toContain('pipeline');
    expect(CODE).not.toContain('Pipeline');
  });

  it('42. no execution pipeline is invoked', () => {
    for (const forbidden of [
      'executeTripExecutionPipeline',
      'runTripExecutionPipeline',
      'TripExecutionOrchestrator',
      'TripExecutionPipeline',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('43. no network or fetch call exists', () => {
    expect(CODE).not.toMatch(/\bfetch\s*\(/);
    for (const forbidden of [
      'XMLHttpRequest',
      'axios',
      'httpsCallable',
      'getFunctions',
      'http://',
      'https://',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('44. no persistence occurs', () => {
    for (const forbidden of [
      'addDoc',
      'setDoc',
      'updateDoc',
      'getDoc',
      'getDocs',
      'query(',
      'collection(',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('45. no Firebase object is touched', () => {
    for (const forbidden of ['firebase', 'Firebase', 'Firestore', 'serverBoundary', 'serverExecution']) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('46. no React, Router, Zustand, or browser global is used', () => {
    for (const forbidden of [
      'react',
      'react-dom',
      'react-router',
      'zustand',
      'window.',
      'document.',
      'navigator.',
      'localStorage',
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
    expect(CODE).not.toMatch(/import\.meta\.env|process\.env/);
  });

  it('47. no booking, payment, or reservation capability is invented', () => {
    // Prose may name these concerns; code and string literals may not.
    for (const invented of [
      'flight-booking',
      'hotel-booking',
      'payment',
      'charge',
      'purchase',
      'reservation',
      'refund',
      'cancellation',
    ]) {
      expect(CODE, invented).not.toContain(invented);
    }
    // No string literal in the module invents one either.
    for (const literal of SOURCE.match(/'[^'\n]*'/g) ?? []) {
      for (const invented of ['payment', 'booking', 'reservation', 'purchase', 'refund']) {
        expect(literal, `${invented} in ${literal}`).not.toContain(invented);
      }
    }
    // The closed capability vocabulary is not redeclared or re-exported here.
    expect(SOURCE).not.toMatch(/export const PROVIDER_CAPABILITY_IDS/);
    expect(SOURCE).not.toMatch(/export type ProviderCapabilityId/);
    expect(CODE).toContain('isProviderCapabilityId');
  });

  it('48. no authorization rule is invented and no provider registry is created', () => {
    // No policy, role, scope, session, expiry, or existence evaluation.
    expect(CODE).not.toMatch(/\b(role|policy|permission|scope|token|credential|session|consent)\b/i);
    expect(CODE).not.toMatch(/expires|expiry|validUntil|revoked|approvedBy/);
    expect(CODE).not.toMatch(/exists|lookup|findBy/i);
    // And no registry, classification, or provider metadata table.
    expect(CODE).not.toMatch(/REGISTRY|Registry|registry/);
    expect(CODE).not.toMatch(/\.some\(|\.find\(/);
    expect(CODE).not.toMatch(/providerCapabilities[A-Z]/);
  });

  it('49. nothing is sorted, ranked, or scored', () => {
    expect(CODE).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
    expect(CODE).not.toMatch(/\b(rank|score|bestProvider|preferred|topProvider)\b/i);
    // A Set detects a repeat; it never rebuilds the list.
    expect(CODE).toMatch(/new Set<string>\(\)/);
    expect(CODE).not.toMatch(/Array\.from\(\s*seen/);
  });

  it('50. the STEP 57, 58, and 59 contracts are reused, not restated', () => {
    // The real STEP 59 factory, validator, and id function are used.
    expect(CODE).toContain('createTripExecutionProviderRequest');
    expect(CODE).toContain('isTripExecutionProviderRequest');
    expect(CODE).toContain('getTripExecutionProviderRequestId');
    // As are the real STEP 58 factory and validator, and the STEP 57 validator.
    expect(CODE).toContain('createTripExecutionDispatchInstruction');
    expect(CODE).toContain('isTripExecutionDispatchInstruction');
    expect(CODE).toContain('isTripPlanningExecutionAuthorization');
    // No id, kind, or factory is redeclared or re-exported here.
    expect(SOURCE).not.toMatch(/export const TRIP_EXECUTION_PROVIDER_REQUEST/);
    expect(SOURCE).not.toMatch(/export const TRIP_EXECUTION_DISPATCH/);
    expect(SOURCE).not.toMatch(/export const TRIP_PLANNING_EXECUTION_AUTHORIZATION/);
    expect(SOURCE).not.toMatch(/export function getTripExecutionProviderRequestId/);
    expect(SOURCE).not.toMatch(/export function getTripExecutionDispatchId/);
    // No provider-request value is written by hand.
    expect(CODE).not.toMatch(/\{[^{}]*kind:\s*TRIP_EXECUTION_PROVIDER_REQUEST_KIND/);
    // And no STEP 59 result status is emitted: those describe a provider's
    // answer, and no provider has been asked.
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed']) {
      expect(CODE.includes(`status: '${status}'`), status).toBe(false);
    }
  });

  it('the reason vocabulary is closed and the affirmative token is unique', () => {
    expect([...TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS]).toEqual([
      'accepted',
      'authorization-result-invalid',
      'not-authorized',
      'authorization-missing',
      'authorization-id-invalid',
      'authorization-invalid',
      'dispatch-id-invalid',
      'dispatch-invalid',
      'request-id-invalid',
      'plan-id-invalid',
      'identity-inconsistent',
      'capability-invalid',
      'provider-identity-invalid',
      'provider-identity-duplicate',
      'provider-set-empty',
      'provider-request-invalid',
    ]);
    // Every token is a bounded identifier: no prose, no punctuation, no
    // provider message.
    for (const reason of TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS) {
      expect(reason, reason).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
    // The required minimum from the brief is present.
    for (const required of [
      'accepted',
      'authorization-missing',
      'authorization-id-invalid',
      'dispatch-id-invalid',
      'request-id-invalid',
      'plan-id-invalid',
      'provider-identity-invalid',
      'provider-identity-duplicate',
      'provider-set-empty',
      'capability-invalid',
      'identity-inconsistent',
      'provider-request-invalid',
    ]) {
      expect(TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS, required).toContain(
        required as (typeof TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS)[number]
      );
    }
  });

  it('the provider request stays provider-neutral and carries no result shape', () => {
    // The real STEP 59 request type, not the result type: nothing here reports a
    // provider outcome.
    const result = handoff(authorizedResult());
    expect(result.providerRequest).not.toBeNull();
    const keys = Object.keys(result.providerRequest!);
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('providerId');
    expect(keys).not.toContain('result');
    // A TripProviderResult is never constructed or referenced in the module.
    expect(CODE).not.toContain('TripProviderResult');
    expect(CODE).not.toContain('TripExecutionProviderResult');
    expect(CODE).not.toMatch(/\bstatus:/);
  });

  it('a real STEP 63 plan result is never manufactured by this module', () => {
    // The module is a pure identity handoff: it builds no plan, no result, and
    // no provider record of its own. Only the plan *id* helper is used, to check
    // that the caller's plan id and request id agree.
    expect(CODE).not.toContain('TripProviderResult');
    expect(CODE).not.toContain('TripExecutionProviderResult');
    expect(CODE).not.toMatch(/\bTripExecutionPlan\b/);
    expect(CODE).not.toMatch(/createTripExecutionPlan/);
    expect(CODE).toContain('getTripExecutionPlanId');
  });
});
