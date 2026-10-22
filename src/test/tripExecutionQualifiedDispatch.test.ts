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
} from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan, type TripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import {
  createTripExecutionDispatchInstruction,
  getTripExecutionDispatchId,
  isTripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import {
  createTripExecutionQualifiedDispatch,
  TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS,
  type TripExecutionQualifiedDispatch,
} from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';

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

/** The real STEP 59 provider request that a STEP 63 plan references. */
function providerRequestFor(step56Request: TripPlanningExecutionRequest): TripExecutionProviderRequest {
  const authorization = requireValue(
    createTripPlanningExecutionAuthorization(step56Request),
    'authorization'
  );
  const dispatch = requireValue(createTripExecutionDispatchInstruction(authorization), 'dispatch');
  return {
    id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`,
    kind: 'trip-execution-provider-request',
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

/** A real STEP 63 plan, built by the genuine factory. */
function validPlan(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): TripExecutionPlan {
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

/** A real STEP 70 eligibility result, shaped by hand but never by the evaluator. */
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

/**
 * A genuine STEP 71 qualification result, produced by the real STEP 71 evaluator
 * from a real plan and a real eligibility result. The fixture never hand-writes
 * an affirmative qualification, so a passing test cannot be an artifact of a
 * hand-built happy path.
 */
function validQualification(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): Record<string, unknown> {
  const request = validStep56Request(tripId);
  const plan = validPlan(providerIds, tripId);
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: eligibleFor(request, plan.providerIds as string[]),
  });
  if (!qualification.qualified) {
    throw new Error(`test setup: fixture did not qualify (${qualification.reason})`);
  }
  return { ...qualification, providerIds: [...qualification.providerIds] } as Record<string, unknown>;
}

function dispatch(qualification: unknown): TripExecutionQualifiedDispatch {
  return createTripExecutionQualifiedDispatch({ qualification });
}

/** Overrides a qualification result without ever making it affirmative by hand. */
function qualifiedWith(
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return { ...validQualification(), ...overrides };
}

describe('STEP 72 qualified dispatch: qualification validity (1-8)', () => {
  it('1. a real qualified result produces a dispatch instruction', () => {
    const result = dispatch(validQualification());
    expect(result.dispatched).toBe(true);
    expect(result.reason).toBe('dispatched');
    expect(result.dispatch).not.toBeNull();
    expect(result.providerIds).toEqual(['amadeus-execution']);
    expect(result.requiredCapabilityId).toBe(CAPABILITY);
  });

  it('1b. a genuine STEP 71 result is accepted unmodified', () => {
    // The strongest form of test 1: take the real evaluator's own output, with
    // no re-shaping, and dispatch it.
    const request = validStep56Request();
    const plan = validPlan();
    const qualification = evaluateTripExecutionPlanQualification({
      plan,
      eligibility: eligibleFor(request, plan.providerIds as string[]),
    });
    expect(qualification.qualified).toBe(true);
    const result = createTripExecutionQualifiedDispatch({ qualification });
    expect(result.dispatched).toBe(true);
    expect(result.requestId).toBe(plan.requestId);
    expect(result.planId).toBe(plan.id);
  });

  it('2. a missing qualification is rejected', () => {
    for (const missing of [null, undefined]) {
      const result = dispatch(missing);
      expect(result.dispatched, String(missing)).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('2b. a non-object input is rejected', () => {
    for (const malformed of ['qualified', 42, true, [], [validQualification()]]) {
      const result = dispatch(malformed);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
    }
  });

  it('2c. a non-object input wrapper is rejected', () => {
    for (const wrapper of [null, undefined, 'input', 42, []]) {
      const result = createTripExecutionQualifiedDispatch(
        wrapper as unknown as { qualification: unknown }
      );
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('3. a malformed qualification is rejected', () => {
    const valid = validQualification();
    const malformed: unknown[] = [
      {},
      { ...valid, qualified: 'yes' },
      { ...valid, qualified: null },
      { ...valid, reason: 'totally-qualified' },
      { ...valid, reason: null },
      { ...valid, reason: 42 },
      { ...valid, reason: 'dispatched' },
      { ...valid, planId: 42 },
      { ...valid, planId: { id: 'x' } },
      { ...valid, requestId: 42 },
      { ...valid, requestId: ['a'] },
      { ...valid, requiredCapabilityId: 42 },
      { ...valid, providerIds: 'amadeus-execution' },
      { ...valid, providerIds: { length: 1 } },
      { ...valid, providerIds: [42] },
      { ...valid, providerIds: [null] },
      { ...valid, providerIds: ['x'.repeat(5000)] },
      { ...valid, providerIds: [' padded'] },
    ];
    for (const qualification of malformed) {
      const result = dispatch(qualification);
      expect(result.dispatched, JSON.stringify(qualification)).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('4. qualified === false is rejected as not-qualified', () => {
    const request = validStep56Request();
    const plan = validPlan();
    // A real negative qualification from the real STEP 70/71 chain.
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
    expect(qualification.qualified).toBe(false);

    const result = dispatch(qualification);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('not-qualified');
    expect(result.dispatch).toBeNull();
    expect(result.providerIds).toEqual([]);

    // And the explicit form, for both STEP 71 negative reasons that carry no
    // provider set.
    for (const reason of [
      'plan-invalid',
      'eligibility-invalid',
      'eligibility-ineligible',
      'request-mismatch',
      'capability-unspecified',
      'provider-set-mismatch',
      'provider-identity-invalid',
      'provider-identity-duplicate',
    ]) {
      const negative = dispatch({
        qualified: false,
        planId: 'trip-execution-plan:x',
        requestId: 'trip-execution-provider-request:x',
        providerIds: [],
        requiredCapabilityId: null,
        reason,
      });
      expect(negative.dispatched, reason).toBe(false);
      expect(negative.reason).toBe('not-qualified');
      expect(negative.dispatch).toBeNull();
    }
  });

  it('4b. a negative qualification never echoes identities', () => {
    const result = dispatch({
      qualified: false,
      planId: 'trip-execution-plan:x',
      requestId: 'trip-execution-provider-request:x',
      providerIds: [],
      requiredCapabilityId: CAPABILITY,
      reason: 'plan-invalid',
    });
    expect(result.planId).toBeNull();
    expect(result.requestId).toBeNull();
    expect(result.authorizationId).toBeNull();
    expect(result.requiredCapabilityId).toBeNull();
  });

  it('4c. a real negative qualification carrying providers is malformed, not merely negative', () => {
    // STEP 70 and STEP 71 never expose a provider set on a negative verdict, so
    // a hand-built value claiming otherwise is structurally invalid.
    const result = dispatch({
      qualified: false,
      planId: 'trip-execution-plan:x',
      requestId: 'trip-execution-provider-request:x',
      providerIds: ['amadeus-execution'],
      requiredCapabilityId: CAPABILITY,
      reason: 'plan-invalid',
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('qualification-invalid');
    expect(result.dispatch).toBeNull();
  });

  it('5. a missing or invalid plan id is rejected', () => {
    // A present-but-wrong string: the identity gate rejects it.
    for (const planId of [
      '',
      'plan',
      'trip-execution-plan',
      'trip-execution-plan:',
      'not-a-plan-id',
      '  trip-execution-plan:x',
    ]) {
      const result = dispatch(qualifiedWith({ planId }));
      expect(result.dispatched, JSON.stringify(planId)).toBe(false);
      expect(result.reason).toBe('plan-identity-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }

    // An absent or non-string plan id is not a plan identity at all.
    for (const planId of [null, undefined, 42, {}, ['trip-execution-plan:x']]) {
      const result = dispatch(qualifiedWith({ planId }));
      expect(result.dispatched, JSON.stringify(planId)).toBe(false);
      expect(['plan-identity-invalid', 'qualification-invalid']).toContain(result.reason);
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('6. a missing or invalid request id is rejected', () => {
    for (const requestId of [
      '',
      'request',
      'trip-execution-provider-request',
      'trip-execution-provider-request:',
      'not-a-provider-request-id',
    ]) {
      const result = dispatch(qualifiedWith({ requestId }));
      expect(result.dispatched, JSON.stringify(requestId)).toBe(false);
      expect(result.reason).toBe('request-identity-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }

    for (const requestId of [null, undefined, 42, {}, ['x']]) {
      const result = dispatch(qualifiedWith({ requestId }));
      expect(result.dispatched, JSON.stringify(requestId)).toBe(false);
      expect(['request-identity-invalid', 'qualification-invalid']).toContain(result.reason);
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('7. a missing capability is rejected', () => {
    // Absent in either form: the domain's explicit `null` and a missing field.
    for (const requiredCapabilityId of [null, undefined]) {
      const result = dispatch(qualifiedWith({ requiredCapabilityId }));
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('capability-unspecified');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
      expect(result.requiredCapabilityId).toBeNull();
    }
  });

  it('8. an invalid capability is rejected', () => {
    for (const requiredCapabilityId of [
      '',
      'not-a-capability',
      'flight-booking',
      'payment',
      'search-transport-extra',
      'SEARCH-TRANSPORT',
      42,
      true,
      ['search-transport'],
    ]) {
      const result = dispatch(qualifiedWith({ requiredCapabilityId }));
      expect(result.dispatched, String(requiredCapabilityId)).toBe(false);
      // An unrecognized capability means the value is not a STEP 71 result.
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('8b. every capability in the closed vocabulary is accepted', () => {
    for (const capabilityId of PROVIDER_CAPABILITY_IDS) {
      const request = validStep56Request();
      const plan = validPlan();
      const qualification = evaluateTripExecutionPlanQualification({
        plan,
        eligibility: eligibleFor(request, plan.providerIds as string[], capabilityId),
      });
      // STEP 70 requires the snapshot to list the capability, so an arbitrary
      // one may be ineligible; either way the value must be well formed, and the
      // capability must survive the round trip byte-for-byte.
      if (!qualification.qualified) {
        expect(
          dispatch(qualification).reason === 'not-qualified' ||
            dispatch(qualification).reason === 'qualification-invalid'
        ).toBe(true);
        continue;
      }
      const result = dispatch(qualification);
      expect(result.dispatched, capabilityId).toBe(true);
      expect(result.requiredCapabilityId).toBe(capabilityId);
    }
  });
});

describe('STEP 72 qualified dispatch: provider validation (9-16)', () => {
  it('9. a single valid provider dispatches', () => {
    const result = dispatch(validQualification(['amadeus-execution']));
    expect(result.dispatched).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('10. multiple valid providers dispatch in the qualified order', () => {
    const result = dispatch(validQualification(['amadeus-execution', 'google-execution']));
    expect(result.dispatched).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution', 'google-execution']);
  });

  it('11. an empty provider list is rejected', () => {
    const result = dispatch(qualifiedWith({ providerIds: [] }));
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('provider-set-empty');
    expect(result.dispatch).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('12. an invalid provider identity is rejected', () => {
    for (const providerId of [
      '',
      ' padded',
      'padded ',
      'x'.repeat(5000),
      42,
      null,
      undefined,
      {},
    ]) {
      const result = dispatch(qualifiedWith({ providerIds: [providerId] }));
      expect(result.dispatched, JSON.stringify(providerId)).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('13. a duplicate provider is rejected', () => {
    for (const providerIds of [
      ['amadeus-execution', 'amadeus-execution'],
      ['alpha', 'beta', 'alpha'],
    ]) {
      const result = dispatch(qualifiedWith({ providerIds }));
      expect(result.dispatched, JSON.stringify(providerIds)).toBe(false);
      expect(result.reason).toBe('provider-identity-duplicate');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('14. case variation is preserved verbatim, never folded', () => {
    // A differently-cased identity is still a *valid* identity. This module has
    // no provider registry to compare against, and inventing one would be worse
    // than useless. The guarantee that matters is that whatever the qualification
    // states is what the dispatch carries, byte for byte: no case folding, no
    // silent correction of a caller's typo.
    for (const providerId of [
      'Amadeus-Execution',
      'AMADEUS-EXECUTION',
      'amadeus-Execution',
      'aMaDeUs-ExEcUtIoN',
    ]) {
      const result = dispatch(qualifiedWith({ providerIds: [providerId] }));
      expect(result.dispatched, providerId).toBe(true);
      expect(result.providerIds).toEqual([providerId]);
      expect(result.providerIds[0]).toBe(providerId);
    }
  });

  it('14b. a padded identity is rejected outright, never trimmed', () => {
    // An untrimmed identity is not a valid identity at all, so it fails at the
    // shape gate. The point is that it is not *silently repaired* into one that
    // would have matched.
    for (const providerId of [
      ' amadeus-execution',
      'amadeus-execution ',
      '\tamadeus-execution',
      'amadeus-execution\n',
    ]) {
      const result = dispatch(qualifiedWith({ providerIds: [providerId] }));
      expect(result.dispatched, JSON.stringify(providerId)).toBe(false);
      expect(result.reason).toBe('qualification-invalid');
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('15. whitespace variation is rejected, never trimmed', () => {
    for (const providerId of ['\tamadeus-execution', 'amadeus-execution\n', ' amadeus-execution']) {
      const result = dispatch(qualifiedWith({ providerIds: [providerId] }));
      expect(result.dispatched, JSON.stringify(providerId)).toBe(false);
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('16. an alias or substitution is never resolved to another identity', () => {
    // These are all valid identities, and all are carried exactly as written.
    // What is rejected is any *normalization* that would have turned one into a
    // different provider, and test 14b covers the rejection side.
    for (const providerId of [
      'amadeus',
      'amadeus.execution',
      'amadeus_execution',
      'AMADEUS',
      'amadeus-execution-v2',
      'amadeus-exec',
    ]) {
      const result = dispatch(qualifiedWith({ providerIds: [providerId] }));
      expect(result.dispatched, providerId).toBe(true);
      // Exactly the supplied string - not a canonicalized or resolved variant.
      expect(result.providerIds).toEqual([providerId]);
    }
  });

  it('16b. a changed provider set is dispatched exactly as the qualification states it', () => {
    // The qualified result is authoritative. This module does not re-verify it
    // against a plan, because a plan is not among the input: STEP 71 already
    // established the correspondence. So a *structurally valid* qualification
    // naming a different provider set is dispatched verbatim - which is exactly
    // the required "preserve provider IDs exactly as supplied" behavior.
    const result = dispatch(qualifiedWith({ providerIds: ['some-other-execution'] }));
    expect(result.dispatched).toBe(true);
    expect(result.providerIds).toEqual(['some-other-execution']);
  });
});

describe('STEP 72 qualified dispatch: output integrity (17-23)', () => {
  it('17. the result carries a valid existing STEP 58 dispatch instruction', () => {
    const result = dispatch(validQualification());
    const instruction = requireValue(result.dispatch, 'dispatch');
    // The real STEP 58 validator, not a restatement of it.
    expect(isTripExecutionDispatchInstruction(instruction)).toBe(true);
    expect(instruction.kind).toBe('trip-execution-dispatch-instruction');
    expect(Object.keys(instruction).sort()).toEqual(['authorizationId', 'id', 'kind']);
  });

  it('18. the dispatch id follows the existing STEP 58 formula exactly', () => {
    const result = dispatch(validQualification());
    const instruction = requireValue(result.dispatch, 'dispatch');
    const authorizationId = requireValue(result.authorizationId, 'authorizationId');

    // The real STEP 58 formula and the real STEP 57 formula, recomputed.
    expect(instruction.id).toBe(getTripExecutionDispatchId(authorizationId));

    // And the authorization is the one this plan was actually built from.
    const request = validStep56Request();
    const realAuthorization = requireValue(
      createTripPlanningExecutionAuthorization(request),
      'authorization'
    );
    expect(authorizationId).toBe(realAuthorization.id);
    expect(authorizationId).toBe(getTripPlanningExecutionAuthorizationId(request.id));
  });

  it('18b. the recovered authorization is the plan chain, not a new authorization', () => {
    const result = dispatch(validQualification());
    const instruction = requireValue(result.dispatch, 'dispatch');
    // The dispatch id is the plan's own dispatch id, recoverable from its
    // provider-request id with the existing prefixes.
    const planDispatchId = result.requestId!.slice(
      'trip-execution-provider-request:'.length
    );
    expect(instruction.id).toBe(planDispatchId);
    // Different work produces a different instruction, so nothing is shared.
    const other = dispatch(validQualification(['amadeus-execution'], 'other-trip'));
    expect(other.authorizationId).not.toBe(result.authorizationId);
    expect(other.dispatch!.id).not.toBe(instruction.id);
  });

  it('19. provider order is preserved exactly, never reordered', () => {
    const forward = ['alpha-execution', 'beta-execution', 'gamma-execution'];
    const result = dispatch(validQualification(forward));
    expect(result.dispatched).toBe(true);
    expect(result.providerIds).toEqual(forward);
    expect(result.dispatch!.authorizationId).toBeTruthy();

    // A reversed set is a different qualification, not a reorder request.
    const reversed = dispatch(qualifiedWith({ providerIds: [...forward].reverse() }));
    expect(reversed.providerIds).toEqual([...forward].reverse());
  });

  it('20. the capability is preserved exactly, never inferred', () => {
    const result = dispatch(validQualification());
    expect(result.requiredCapabilityId).toBe(CAPABILITY);
    // A capability that differs from the provider name is still carried as
    // supplied: no inference from identity happens anywhere here.
    expect(result.requiredCapabilityId).not.toBe(result.providerIds[0]);
  });

  it('21. the plan and request relationship is preserved exactly', () => {
    const result = dispatch(validQualification());
    expect(result.planId).toBe(
      `trip-execution-plan:${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:trip-planning-execution-authorization:${result.authorizationId!.slice('trip-planning-execution-authorization:'.length)}`
    );
    expect(result.requestId).toBe(
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${result.dispatch!.id}`
    );
  });

  it('21b. an inconsistent plan/request relationship is rejected', () => {
    const valid = validQualification();
    // A plan id that is well formed but belongs to different work.
    const result = dispatch({
      ...valid,
      planId: 'trip-execution-plan:trip-execution-provider-request:forged',
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('identity-inconsistent');
    expect(result.dispatch).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('21c. a request id that does not carry the authorization chain is rejected', () => {
    // Well formed as a provider-request id and paired with a consistent plan id,
    // so it passes the identity gates and is stopped only by the chain check.
    for (const requestId of [
      'trip-execution-provider-request:trip-execution-dispatch:x',
      'trip-execution-provider-request:forged',
    ]) {
      const result = dispatch(qualifiedWith({ requestId, planId: `trip-execution-plan:${requestId}` }));
      expect(result.dispatched, requestId).toBe(false);
      expect(result.reason).toBe('authorization-unresolved');
      expect(result.dispatch).toBeNull();
      expect(result.authorizationId).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('21d. a request id whose authorization chain is truncated is rejected', () => {
    for (const requestId of [
      // Nothing behind the provider-request prefix.
      'trip-execution-provider-request:trip-execution-dispatch:',
      // Chain stops at the authorization prefix.
      'trip-execution-provider-request:trip-execution-dispatch:trip-planning-execution-authorization:',
      // Chain reaches the request prefix but has no request id behind it.
      'trip-execution-provider-request:trip-execution-dispatch:trip-planning-execution-authorization:trip-planning-execution-request:',
      // Prefixes present but in the wrong order.
      'trip-execution-provider-request:trip-planning-execution-authorization:trip-execution-dispatch:trip-planning-execution-request:x',
      // A plausible inner value that is not a request id.
      'trip-execution-provider-request:trip-execution-dispatch:trip-planning-execution-authorization:just-a-string',
    ]) {
      const result = dispatch(qualifiedWith({ requestId, planId: `trip-execution-plan:${requestId}` }));
      expect(result.dispatched, requestId).toBe(false);
      expect(result.reason).toBe('authorization-unresolved');
      expect(result.dispatch).toBeNull();
      expect(result.authorizationId).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('21e. a provider-request id with no id at all is rejected at the identity gate', () => {
    const requestId = 'trip-execution-provider-request:';
    const result = dispatch(qualifiedWith({ requestId, planId: `trip-execution-plan:${requestId}` }));
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('request-identity-invalid');
    expect(result.dispatch).toBeNull();
  });

  it('21f. a request id that is well formed but not self-consistent is rejected', () => {
    // A trailing space keeps the prefix intact, so the request id is well formed
    // as an identity. It is the *pairing* with the plan id that is wrong, and the
    // consistency gate is what catches it.
    const requestId = 'trip-execution-provider-request:trip-execution-dispatch: ';
    const result = dispatch(qualifiedWith({ requestId }));
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('identity-inconsistent');
    expect(result.dispatch).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('22. every failure returns no dispatch instruction', () => {
    const failures: unknown[] = [
      null,
      undefined,
      'qualified',
      42,
      [],
      {},
      { ...validQualification(), qualified: false },
      { ...validQualification(), reason: 'nope' },
      { ...validQualification(), planId: null },
      { ...validQualification(), requestId: null },
      { ...validQualification(), requiredCapabilityId: null },
      { ...validQualification(), requiredCapabilityId: 'invented' },
      { ...validQualification(), providerIds: [] },
      { ...validQualification(), providerIds: ['a', 'a'] },
      { ...validQualification(), providerIds: [' padded'] },
    ];
    for (const qualification of failures) {
      const result = dispatch(qualification);
      expect(result.dispatched, JSON.stringify(qualification)).toBe(false);
      expect(result.dispatch, JSON.stringify(qualification)).toBeNull();
      expect(result.authorizationId).toBeNull();
      expect(result.reason).not.toBe('dispatched');
      expect(TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS).toContain(result.reason);
    }
  });

  it('23. a failure never exposes a partial provider list', () => {
    const result = dispatch(
      qualifiedWith({ providerIds: ['alpha-execution', 'beta-execution', 'alpha-execution'] })
    );
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
    // Two of the three are valid identities. None of them is exposed.
    expect(result.providerIds).toEqual([]);

    const empty = dispatch(qualifiedWith({ providerIds: [] }));
    expect(empty.providerIds).toEqual([]);
  });

  it('23b. a successful result exposes exactly the qualified provider list', () => {
    const result = dispatch(validQualification(['alpha-execution', 'beta-execution']));
    expect(result.providerIds).toEqual(['alpha-execution', 'beta-execution']);
  });
});

describe('STEP 72 qualified dispatch: safety (24-27)', () => {
  it('24. the input is not mutated', () => {
    const qualification = validQualification();
    const before = JSON.stringify(qualification);
    const result = dispatch(qualification);
    expect(JSON.stringify(qualification)).toBe(before);
    expect(qualification.qualified).toBe(true);
    expect(qualification.reason).toBe('qualified');
    expect(result.dispatched).toBe(true);
  });

  it('24b. the input is not mutated on any failure path', () => {
    for (const overrides of [
      { planId: null },
      { requestId: 'trip-execution-provider-request:trip-execution-dispatch:x' },
      { requiredCapabilityId: null },
      { providerIds: [] },
      { providerIds: ['a', 'a'] },
      { qualified: false },
    ]) {
      const qualification = qualifiedWith(overrides);
      const before = JSON.stringify(qualification);
      dispatch(qualification);
      expect(JSON.stringify(qualification), JSON.stringify(overrides)).toBe(before);
    }
  });

  it('25. the provider array is not mutated and the result array is a copy', () => {
    const providerIds = ['alpha-execution', 'beta-execution'];
    const qualification = qualifiedWith({ providerIds });
    const result = dispatch(qualification);

    expect(providerIds).toEqual(['alpha-execution', 'beta-execution']);
    expect(result.providerIds).not.toBe(providerIds);
    expect(result.providerIds).toEqual(providerIds);

    // Editing the result cannot reach back into the input.
    (result.providerIds as string[]).push('gamma-execution');
    expect(qualification.providerIds).toEqual(['alpha-execution', 'beta-execution']);
    expect(providerIds).toEqual(['alpha-execution', 'beta-execution']);
  });

  it('25b. the returned dispatch instruction is a fresh value', () => {
    const first = dispatch(validQualification());
    const second = dispatch(validQualification());
    expect(first.dispatch).not.toBe(second.dispatch);
    expect(first.dispatch).toEqual(second.dispatch);
    // Mutating one result's instruction cannot affect another's.
    (first.dispatch as { id: string }).id = 'trip-execution-dispatch:tampered';
    expect(second.dispatch!.id).not.toBe('trip-execution-dispatch:tampered');
  });

  it('26. repeated calls are deterministic', () => {
    const qualification = validQualification(['alpha-execution', 'beta-execution']);
    const first = dispatch(qualification);
    for (let index = 0; index < 5; index += 1) {
      expect(dispatch(qualification)).toEqual(first);
    }

    // Determinism holds on the failure paths too.
    const failing = qualifiedWith({ providerIds: [] });
    const failed = dispatch(failing);
    for (let index = 0; index < 5; index += 1) {
      expect(dispatch(failing)).toEqual(failed);
    }
  });

  it('26b. the result contains no mutable global or ambient state', () => {
    const result = dispatch(validQualification());
    expect(Object.keys(result).sort()).toEqual([
      'authorizationId',
      'dispatch',
      'dispatched',
      'planId',
      'providerIds',
      'reason',
      'requestId',
      'requiredCapabilityId',
    ]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.dispatch!)).toBe(Object.prototype);
  });

  it('27. ordinary malformed values never throw', () => {
    const malformed: unknown[] = [
      null,
      undefined,
      '',
      'qualified',
      0,
      42,
      true,
      false,
      NaN,
      Infinity,
      [],
      [validQualification()],
      {},
      { qualified: true },
      { qualified: true, reason: 'qualified' },
      { qualified: true, reason: 'qualified', providerIds: [] },
      { qualified: true, reason: 'qualified', planId: null, requestId: null },
      { qualified: true, reason: 'qualified', planId: [], requestId: {} },
      { qualified: true, reason: 'qualified', requiredCapabilityId: null },
      { qualified: true, reason: 'qualified', providerIds: null },
      { qualified: true, reason: 'qualified', providerIds: [[]] },
      { qualified: true, reason: 'qualified', providerIds: [{}] },
      Object.create(null),
      { qualification: Object.create(null) },
      { qualification: { qualified: true, reason: 'qualified', providerIds: [1] } },
    ];
    for (const qualification of malformed) {
      const result = dispatch(qualification);
      expect(result.dispatched, JSON.stringify(qualification)).toBe(false);
      expect(result.dispatch).toBeNull();
      expect(result.providerIds).toEqual([]);
      expect(TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS).toContain(result.reason);
    }
  });

  it('27b. a throwing accessor or Proxy is a documented boundary, as in STEP 71', () => {
    // The module reads properties directly and uses no try/catch, so the
    // totality guarantee is over data values, not instrumented objects. Asserting
    // the boundary keeps it from being silently widened later.
    const trapping = {
      qualified: true,
      get reason(): string {
        throw new Error('trap');
      },
    };
    expect(() => dispatch(trapping)).toThrow('trap');

    const trappingProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      }
    );
    expect(() => dispatch(trappingProxy)).toThrow('trap');
  });
});

describe('STEP 72 qualified dispatch: architectural regression (28-36)', () => {
  const MODULE_PATH = join(
    process.cwd(),
    'src',
    'services',
    'tripExecution',
    'tripExecutionQualifiedDispatch.ts'
  );
  const SOURCE = readFileSync(MODULE_PATH, 'utf8');
  /** The same source with comments and string literals stripped. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

  it('28. no provider execution and no provider is accepted', () => {
    expect(CODE).not.toMatch(/\.execute\(/);
    expect(CODE).not.toMatch(/TripExecutionProvider\b/);
    expect(CODE).not.toMatch(/createTripExecutionProviderRequest/);
    // The input type cannot even carry a provider.
    expect(SOURCE).not.toMatch(/providers?\??\s*:\s*(?:ReadonlyArray|unknown)\s*<\s*Trip/);
  });

  it('29. no orchestrator invocation', () => {
    expect(CODE).not.toContain('orchestrateTripExecution');
    expect(CODE).not.toContain('tripExecutionOrchestrator');
    expect(CODE).not.toContain('TripExecutionOrchestrator');
  });

  it('30. no pipeline invocation', () => {
    expect(CODE).not.toContain('executeTripExecutionPipeline');
    expect(CODE).not.toContain('tripExecutionPipeline');
    expect(CODE).not.toContain('TripExecutionPipeline');
  });

  it('31. no network, fetch, or transport', () => {
    expect(CODE).not.toMatch(/fetch\s*\(/);
    expect(CODE).not.toMatch(/XMLHttpRequest|axios|https?:\/\//);
    expect(CODE).not.toMatch(/httpsCallable|getFunctions|serverDiscoveryClient/);
    expect(CODE).not.toMatch(/amadeus|google/i);
    expect(CODE).not.toMatch(/serverBoundary|serverExecution/);
  });

  it('32. no persistence', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(CODE).not.toMatch(/addDoc|setDoc|updateDoc|\.collection\(/);
  });

  it('33. no Firebase', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('34. no React, Router, or Zustand', () => {
    for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
      expect(CODE, forbidden).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
    }
    expect(CODE).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
  });

  it('34b. no asynchrony, timers, clock, or environment access', () => {
    expect(CODE).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
    expect(CODE).not.toMatch(/setTimeout|setInterval/);
    expect(CODE).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
    expect(CODE).not.toMatch(/import\.meta\.env|process\.env/);
  });

  it('35. no booking or payment capability is invented', () => {
    for (const invented of [
      'flight-booking',
      'hotel-booking',
      'payment',
      'charge-card',
      'purchase',
      'ticket-purchase',
      'refund',
      'reservation',
      'cancel-booking',
    ]) {
      expect(SOURCE, invented).not.toContain(`'${invented}'`);
    }
    // The capability vocabulary stays owned by the provider domain.
    expect(SOURCE).not.toMatch(
      /export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/
    );
    expect(CODE).toContain('isProviderCapabilityId');
  });

  it('36. no sorting, ranking, deduplication, or scoring', () => {
    expect(CODE).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
    expect(CODE).not.toMatch(/\b(rank|score|bestProvider|preferredProvider)\b/i);
    // A Set is used only to detect a repeat, never to rebuild the list.
    expect(CODE).toMatch(/new Set<string>\(\)/);
    expect(CODE).not.toMatch(/Array\.from\(\s*seen/);
  });

  it('36b. the module does not fabricate an authorization value', () => {
    // The authorization is re-derived with the real STEP 57 function, validated
    // by the real STEP 57 validator, and the instruction is built by the real
    // STEP 58 factory. No literal authorization id is ever written.
    expect(CODE).toContain('getTripPlanningExecutionAuthorizationId');
    expect(CODE).toContain('isTripPlanningExecutionAuthorization');
    expect(CODE).toContain('createTripExecutionDispatchInstruction');
    expect(CODE).toContain('isTripExecutionDispatchInstruction');
    expect(CODE).not.toMatch(/authorizationId:\s*`/);
    expect(CODE).not.toMatch(/authorizationId:\s*'/);
    // The dispatch id formula is used, never restated as a concatenation.
    expect(CODE).not.toMatch(/trip-execution-dispatch/);
  });

  it('36c. the module adds no new identity or status vocabulary', () => {
    // STEP 58's kind and prefixes are referenced, never redeclared.
    expect(SOURCE).not.toMatch(/export const (?:TRIP_EXECUTION_DISPATCH|KIND)/);
    expect(SOURCE).not.toMatch(/'trip-execution-dispatch-instruction'/);
    // No execution status vocabulary is introduced here.
    expect(SOURCE).not.toMatch(/'accepted'|'rejected'|'unsupported'|'failed'|'pending'/);
  });
});
