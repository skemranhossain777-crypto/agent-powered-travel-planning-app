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
  TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionAuthorization,
  getTripPlanningExecutionAuthorizationId,
  isTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import {
  createTripExecutionDispatchInstruction,
  getTripExecutionDispatchId,
  isTripExecutionDispatchInstruction,
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
} from '../services/tripExecution/tripExecutionDispatch';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import {
  createTripExecutionQualifiedAuthorization,
  TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS,
  type TripExecutionQualifiedAuthorization,
} from '../services/tripExecution/tripExecutionQualifiedAuthorization';
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

/** The real STEP 59 provider request a STEP 63 plan references. */
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

/**
 * A genuine STEP 72 qualified dispatch, produced by the real STEP 71 and STEP 72
 * evaluators from real plans and eligibility results. No fixture hand-writes an
 * affirmative qualification or dispatch, so no test can pass on an artifact that
 * the real chain would not produce.
 */
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
  // Detach the arrays and nested instruction so mutation tests have something real
  // to prove against.
  return {
    ...qualified,
    dispatch: { ...qualified.dispatch },
    providerIds: [...qualified.providerIds],
  } as Record<string, unknown>;
}

/** Overrides a qualified dispatch without making it affirmative by hand. */
function dispatchedWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validDispatch(), ...overrides };
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

function authorize(dispatch: unknown): TripExecutionQualifiedAuthorization {
  return createTripExecutionQualifiedAuthorization({ dispatch });
}

describe('STEP 73 authorization: dispatch validity (1-7)', () => {
  it('1. a genuine qualified dispatch authorizes', () => {
    const result = authorize(validDispatch());
    expect(result.authorized).toBe(true);
    expect(result.reason).toBe('authorized');
    expect(result.authorization).not.toBeNull();
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('1b. the recovered authorization is the one the dispatch was built from', () => {
    const request = validStep56Request();
    const real = requireValue(
      createTripPlanningExecutionAuthorization(request),
      'authorization'
    );
    const result = authorize(validDispatch());
    // The real STEP 57 value, recomputed through the real factory.
    expect(result.authorization).toEqual(real);
    expect(result.authorization!.id).toBe(real.id);
    expect(result.authorization!.requestId).toBe(request.id);
    expect(result.authorization!.kind).toBe('trip-planning-execution-authorization');
  });

  it('2. a missing dispatch is rejected', () => {
    for (const missing of [null, undefined]) {
      const result = authorize(missing);
      expect(result.authorized, String(missing)).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('2b. a non-object dispatch is rejected', () => {
    for (const malformed of ['dispatched', 42, true, [], [validDispatch()]]) {
      const result = authorize(malformed);
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
    }
  });

  it('2c. a non-object input wrapper is rejected', () => {
    for (const wrapper of [null, undefined, 'input', 42, []]) {
      const result = createTripExecutionQualifiedAuthorization(
        wrapper as unknown as { dispatch: unknown }
      );
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('3. a malformed dispatch is rejected', () => {
    const valid = validDispatch();
    const malformed: unknown[] = [
      {},
      { ...valid, dispatched: 'yes' },
      { ...valid, dispatched: null },
      { ...valid, reason: 'totally-dispatched' },
      { ...valid, reason: null },
      { ...valid, reason: 42 },
      { ...valid, reason: 'authorized' },
      { ...valid, planId: 42 },
      { ...valid, planId: { id: 'x' } },
      { ...valid, requestId: 42 },
      { ...valid, requestId: ['a'] },
      { ...valid, authorizationId: 42 },
      { ...valid, requiredCapabilityId: 42 },
      { ...valid, requiredCapabilityId: 'not-a-capability' },
      { ...valid, providerIds: 'amadeus-execution' },
      { ...valid, providerIds: { length: 1 } },
      { ...valid, providerIds: [42] },
      { ...valid, providerIds: [null] },
      { ...valid, providerIds: ['x'.repeat(5000)] },
      { ...valid, providerIds: [' padded'] },
      { ...valid, dispatch: 'an-instruction' },
      { ...valid, dispatch: 42 },
      { ...valid, dispatch: [] },
    ];
    for (const dispatch of malformed) {
      const result = authorize(dispatch);
      expect(result.authorized, JSON.stringify(dispatch)).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('4. a dispatch that is not qualified is rejected', () => {
    // The real STEP 72 negative result.
    const negative = negativeDispatch();
    expect(negative.dispatched).toBe(false);

    const result = authorize(negative);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('dispatch-not-qualified');
    expect(result.authorization).toBeNull();
    expect(result.providerIds).toEqual([]);

    // And every bounded negative token the real STEP 72 module can emit.
    for (const reason of [
      'qualification-invalid',
      'not-qualified',
      'plan-identity-invalid',
      'request-identity-invalid',
      'identity-inconsistent',
      'capability-unspecified',
      'provider-set-empty',
      'provider-identity-invalid',
      'provider-identity-duplicate',
      'authorization-unresolved',
    ]) {
      const negativeResult = authorize({
        dispatched: false,
        dispatch: null,
        planId: null,
        requestId: null,
        authorizationId: null,
        providerIds: [],
        requiredCapabilityId: null,
        reason,
      });
      expect(negativeResult.authorized, reason).toBe(false);
      expect(negativeResult.reason, reason).toBe('dispatch-not-qualified');
      expect(negativeResult.authorization).toBeNull();
      expect(negativeResult.providerIds).toEqual([]);
    }
  });

  it('3b. an affirmative dispatch carrying a non-affirmative reason token is rejected', () => {
    // `dispatched: true` paired with a real STEP 72 *negative* token is a value
    // the STEP 72 module cannot produce, so it is malformed rather than qualified.
    for (const reason of [
      'qualification-invalid',
      'not-qualified',
      'provider-set-empty',
      'authorization-unresolved',
    ]) {
      const result = authorize(dispatchedWith({ reason }));
      expect(result.authorized, reason).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('4b. a negative dispatch never echoes identities', () => {
    const result = authorize({
      dispatched: false,
      dispatch: { id: 'trip-execution-dispatch:x', kind: 'trip-execution-dispatch-instruction', authorizationId: 'trip-planning-execution-authorization:x' },
      planId: 'trip-execution-plan:x',
      requestId: 'trip-execution-provider-request:x',
      authorizationId: 'trip-planning-execution-authorization:x',
      providerIds: ['amadeus-execution'],
      requiredCapabilityId: CAPABILITY,
      reason: 'authorization-unresolved',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('dispatch-not-qualified');
    // A negative verdict is never mined for identities.
    expect(result.dispatchId).toBeNull();
    expect(result.requestId).toBeNull();
    expect(result.planId).toBeNull();
    expect(result.authorization).toBeNull();
    expect(result.requiredCapabilityId).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('5. an invalid dispatch id is rejected', () => {
    // The real STEP 58 validator, applied first: these never reach the id gate.
    for (const id of [
      '',
      'dispatch',
      'trip-execution-dispatch',
      'trip-execution-dispatch:',
      'not-a-dispatch-id',
    ]) {
      const result = authorize(
        dispatchedWith({
          dispatch: {
            id,
            kind: 'trip-execution-dispatch-instruction',
            authorizationId: 'trip-planning-execution-authorization:x',
          },
        })
      );
      expect(result.authorized, id).toBe(false);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('5b. a well-formed dispatch id naming a different authorization is rejected', () => {
    const valid = validDispatch();
    const instruction = valid.dispatch as { id: string; authorizationId: string };
    // Swap in a *structurally valid* STEP 58 instruction for other work. It passes
    // the real validator, so the mismatch must be caught by the chain equality.
    const otherRequest = validStep56Request('other-trip');
    const otherAuthorization = requireValue(
      createTripPlanningExecutionAuthorization(otherRequest),
      'authorization'
    );
    expect(isTripExecutionDispatchInstruction({
      id: getTripExecutionDispatchId(otherAuthorization.id),
      kind: 'trip-execution-dispatch-instruction',
      authorizationId: otherAuthorization.id,
    })).toBe(true);

    const result = authorize({
      ...valid,
      dispatch: {
        id: instruction.id,
        kind: 'trip-execution-dispatch-instruction',
        authorizationId: otherAuthorization.id,
      },
    });
    expect(result.authorized).toBe(false);
    expect(result.authorization).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('6. an invalid request id is rejected', () => {
    for (const requestId of [
      null,
      undefined,
      '',
      'request',
      'trip-execution-provider-request',
      'trip-execution-provider-request:',
      'not-a-provider-request-id',
      42,
      ['x'],
    ]) {
      const result = authorize(dispatchedWith({ requestId }));
      expect(result.authorized, JSON.stringify(requestId)).toBe(false);
      expect(['request-id-invalid', 'dispatch-invalid']).toContain(result.reason);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('7. an invalid plan id is rejected', () => {
    for (const planId of [
      null,
      undefined,
      '',
      'plan',
      'trip-execution-plan',
      'trip-execution-plan:',
      'not-a-plan-id',
      42,
      ['x'],
    ]) {
      const result = authorize(dispatchedWith({ planId }));
      expect(result.authorized, JSON.stringify(planId)).toBe(false);
      expect(['plan-id-invalid', 'dispatch-invalid']).toContain(result.reason);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('7b. a plan id that does not derive from the request id is rejected', () => {
    const result = authorize(dispatchedWith({ planId: 'trip-execution-plan:forged' }));
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('identity-inconsistent');
    expect(result.authorization).toBeNull();
    expect(result.providerIds).toEqual([]);
  });
});

describe('STEP 73 authorization: provider validation (8-15)', () => {
  it('8. a single valid provider authorizes', () => {
    const result = authorize(validDispatch(['amadeus-execution']));
    expect(result.authorized).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('9. multiple valid providers authorize in the qualified order', () => {
    const result = authorize(validDispatch(['amadeus-execution', 'google-execution']));
    expect(result.authorized).toBe(true);
    expect(result.providerIds).toEqual(['amadeus-execution', 'google-execution']);
  });

  it('10. an empty provider list is rejected', () => {
    const result = authorize(dispatchedWith({ providerIds: [] }));
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('provider-set-empty');
    expect(result.authorization).toBeNull();
    expect(result.providerIds).toEqual([]);
  });

  it('11. an invalid provider identity is rejected', () => {
    for (const providerId of ['', 42, null, undefined, {}, [], 'x'.repeat(5000)]) {
      const result = authorize(dispatchedWith({ providerIds: [providerId] }));
      expect(result.authorized, JSON.stringify(providerId)).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('12. a duplicate provider identity is rejected', () => {
    for (const providerIds of [
      ['amadeus-execution', 'amadeus-execution'],
      ['alpha', 'beta', 'alpha'],
    ]) {
      const result = authorize(dispatchedWith({ providerIds }));
      expect(result.authorized, JSON.stringify(providerIds)).toBe(false);
      expect(result.reason).toBe('provider-identity-duplicate');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('13. a malformed or padded provider identity is rejected, never repaired', () => {
    for (const providerId of [
      ' amadeus-execution',
      'amadeus-execution ',
      '\tamadeus-execution',
      'amadeus-execution\n',
      ' padded ',
    ]) {
      const result = authorize(dispatchedWith({ providerIds: [providerId] }));
      expect(result.authorized, JSON.stringify(providerId)).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('14. provider order is preserved exactly', () => {
    const forward = ['alpha-execution', 'beta-execution', 'gamma-execution'];
    const result = authorize(validDispatch(forward));
    expect(result.authorized).toBe(true);
    expect(result.providerIds).toEqual(forward);
  });

  it('15. provider values are not normalized', () => {
    // A qualified dispatch is authoritative about its own provider list, and this
    // handoff carries it through untouched. What is rejected is a malformed
    // identity, never silently repaired into one that would have matched.
    for (const providerIds of [
      ['Amadeus-Execution'],
      ['AMADEUS-EXECUTION'],
      ['amadeus'],
      ['amadeus.execution'],
      ['amadeus-execution-v2'],
    ]) {
      const result = authorize(validDispatch(providerIds));
      expect(result.authorized, providerIds[0]).toBe(true);
      expect(result.providerIds).toEqual(providerIds);
    }
  });
});

describe('STEP 73 authorization: capability (16-20)', () => {
  it('16. a valid capability authorizes', () => {
    const result = authorize(validDispatch());
    expect(result.authorized).toBe(true);
    expect(result.requiredCapabilityId).toBe(CAPABILITY);
  });

  it('17. a missing capability is rejected', () => {
    for (const requiredCapabilityId of [null, undefined]) {
      const result = authorize(dispatchedWith({ requiredCapabilityId }));
      expect(result.authorized).toBe(false);
      expect(['capability-invalid', 'dispatch-invalid']).toContain(result.reason);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('18. an invalid capability is rejected', () => {
    for (const requiredCapabilityId of [
      '',
      'not-a-capability',
      'flight-booking',
      'payment',
      'purchase',
      'SEARCH-TRANSPORT',
      42,
      ['search-transport'],
    ]) {
      const result = authorize(dispatchedWith({ requiredCapabilityId }));
      expect(result.authorized, String(requiredCapabilityId)).toBe(false);
      expect(result.reason).toBe('dispatch-invalid');
      expect(result.authorization).toBeNull();
    }
  });

  it('19. the capability is preserved exactly', () => {
    for (const capabilityId of PROVIDER_CAPABILITY_IDS) {
      const request = validStep56Request();
      const plan = validPlan();
      const qualification = evaluateTripExecutionPlanQualification({
        plan,
        eligibility: eligibleFor(request, plan.providerIds as string[], capabilityId),
      });
      if (!qualification.qualified) continue;
      const qualified = createTripExecutionQualifiedDispatch({ qualification });
      if (!qualified.dispatched) continue;

      const result = authorize(qualified);
      expect(result.authorized, capabilityId).toBe(true);
      expect(result.requiredCapabilityId).toBe(capabilityId);
    }
  });

  it('20. no capability is inferred from provider or plan identity', () => {
    // A dispatch whose provider names look like a capability must not acquire one,
    // and a dispatch with no capability must not be helped along.
    const noCapability = authorize(dispatchedWith({ requiredCapabilityId: null }));
    expect(noCapability.authorized).toBe(false);
    expect(noCapability.requiredCapabilityId).toBeNull();

    // A capability that disagrees with the provider name is still carried as
    // supplied: nothing here correlates the two.
    const mismatched = authorize(validDispatch(['search-transport-execution']));
    expect(mismatched.authorized).toBe(true);
    expect(mismatched.requiredCapabilityId).toBe(CAPABILITY);
    expect(mismatched.providerIds).toEqual(['search-transport-execution']);
  });
});

describe('STEP 73 authorization: authorization chain (21-27)', () => {
  it('21. a valid authorization chain authorizes', () => {
    const result = authorize(validDispatch());
    expect(result.authorized).toBe(true);
    expect(result.authorization).not.toBeNull();
  });

  it('22. the authorization identity is recovered from the chain', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    const requestId = dispatch.requestId as string;

    // Walk the chain back by hand, removing the STEP 59, STEP 58, and STEP 57
    // prefixes. What remains must be the STEP 56 request id.
    const step56RequestId = requestId.slice(
      (
        TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX +
        TRIP_EXECUTION_DISPATCH_ID_PREFIX +
        TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX
      ).length
    );
    expect(step56RequestId.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX)).toBe(true);

    // And the recovered authorization is the real one, from the real factory.
    const expected = getTripPlanningExecutionAuthorizationId(step56RequestId);
    expect(result.authorization!.id).toBe(expected);
    expect(result.authorization!.requestId).toBe(step56RequestId);
  });

  it('23. the recovered authorization passes the real STEP 57 validator', () => {
    const result = authorize(validDispatch());
    // The actual STEP 57 validator, not a restatement of it.
    expect(isTripPlanningExecutionAuthorization(result.authorization)).toBe(true);
    expect(Object.keys(result.authorization!).sort()).toEqual(['id', 'kind', 'requestId']);
  });

  it('24. the rebuilt authorization matches the encoded dispatch relationship', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    const instruction = dispatch.dispatch as { id: string; authorizationId: string };

    // Every link, re-composed forward with the real id functions.
    expect(result.authorization!.id).toBe(instruction.authorizationId);
    expect(result.dispatchId).toBe(instruction.id);
    expect(result.dispatchId).toBe(getTripExecutionDispatchId(result.authorization!.id));
    expect(
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${result.dispatchId}`
    ).toBe(result.requestId);
    expect(result.requestId).toBe(dispatch.requestId);
  });

  it('24b. the authorization is a fresh value, not a shared reference', () => {
    const first = authorize(validDispatch());
    const second = authorize(validDispatch());
    expect(first.authorization).not.toBe(second.authorization);
    expect(first.authorization).toEqual(second.authorization);

    // Editing one result's authorization cannot affect another's.
    (first.authorization as { id: string }).id = 'trip-planning-execution-authorization:tampered';
    expect(second.authorization!.id).not.toBe('trip-planning-execution-authorization:tampered');
  });

  it('25. an authorization mismatch fails closed', () => {
    const dispatch = validDispatch();
    const instruction = dispatch.dispatch as { id: string };

    // A real STEP 58 instruction naming a different, real authorization. The
    // instruction is structurally valid, so only the chain equality can stop it.
    const otherAuthorization: TripPlanningExecutionAuthorization = requireValue(
      createTripPlanningExecutionAuthorization(validStep56Request('other-trip')),
      'authorization'
    );
    const mismatched = authorize({
      ...dispatch,
      dispatch: {
        id: instruction.id,
        kind: 'trip-execution-dispatch-instruction',
        authorizationId: otherAuthorization.id,
      },
    });
    expect(mismatched.authorized).toBe(false);
    expect(mismatched.authorization).toBeNull();
    expect(mismatched.providerIds).toEqual([]);
  });

  it('25a. a request id naming a different dispatch fails the forward re-derivation', () => {
    // The one tamper the forward re-derivation exists to catch: a request id that
    // is internally a complete, valid STEP 59 -> 58 -> 57 -> 56 chain, but for a
    // *different* piece of work than the instruction embedded in this dispatch.
    // Every shape gate passes, and only the re-derived chain disagrees.
    const other = validDispatch(['amadeus-execution'], 'other-trip') as unknown as {
      requestId: string;
      planId: string;
      dispatch: { id: string };
    };
    const result = authorize(dispatchedWith({ requestId: other.requestId, planId: other.planId }));
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('authorization-mismatch');
    expect(result.authorization).toBeNull();
    expect(result.providerIds).toEqual([]);
    // The ids the caller supplied are reported back for diagnosis, never an
    // authorization.
    expect(result.dispatchId).toBe((dispatchedWith({}).dispatch as { id: string }).id);
  });

  it('25b. a dispatch-level authorizationId that disagrees with its instruction fails closed', () => {
    // STEP 72's result states the authorization identity twice: once on the
    // embedded STEP 58 instruction and once at the top level. Both must agree
    // with what the chain re-derives, or the value is internally inconsistent.
    const otherAuthorization: TripPlanningExecutionAuthorization = requireValue(
      createTripPlanningExecutionAuthorization(validStep56Request('other-trip')),
      'authorization'
    );
    const disagreeing = authorize(
      dispatchedWith({ authorizationId: otherAuthorization.id })
    );
    expect(disagreeing.authorized).toBe(false);
    expect(disagreeing.authorization).toBeNull();
    expect(disagreeing.providerIds).toEqual([]);
  });

  it('26. a malformed authorization chain fails closed', () => {
    for (const requestId of [
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:`,
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:trip-planning-execution-request:`,
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:trip-planning-execution-request:x`,
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:just-a-string`,
    ]) {
      const result = authorize(
        dispatchedWith({ requestId, planId: `trip-execution-plan:${requestId}` })
      );
      expect(result.authorized, requestId).toBe(false);
      expect(['authorization-chain-invalid', 'identity-inconsistent']).toContain(result.reason);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('27. a look-alike prefix chain fails closed', () => {
    for (const requestId of [
      // Prefixes present but in the wrong order.
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-planning-execution-request:${TRIP_EXECUTION_DISPATCH_ID_PREFIX}x`,
      // A nested-looking id with a doubled dispatch prefix.
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}trip-planning-execution-request:x`,
      // Trailing content that merely resembles a valid chain.
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}trip-planning-execution-request:trip-planning-execution-request:x`,
      // Whitespace-padded, which keeps the prefix but breaks the pairing.
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}trip-planning-execution-request:x `,
    ]) {
      const result = authorize(
        dispatchedWith({ requestId, planId: `trip-execution-plan:${requestId}` })
      );
      expect(result.authorized, requestId).toBe(false);
      expect(result.authorization, requestId).toBeNull();
      expect(result.providerIds).toEqual([]);
      expect(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS).toContain(result.reason);
    }
  });

  it('27a. each internal chain guard is reachable and fails closed', () => {
    // The chain is unwound in stages, and a defect at any stage must stop the
    // handoff rather than produce an authorization for a half-decoded identity.
    const cases: ReadonlyArray<[string, string]> = [
      [
        // Nothing behind the STEP 57 prefix: not a request id at all.
        'garbage',
        `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}garbage`,
      ],
      [
        // The request prefix present but with no id behind it.
        'prefix only',
        `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}`,
      ],
      [
        // A well-formed request id shape whose intent id is not an intent id, which
        // is what the real STEP 56 validator rejects.
        'bad intent id',
        `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}not-an-intent`,
      ],
    ];

    for (const [label, requestId] of cases) {
      const result = authorize(
        dispatchedWith({ requestId, planId: `trip-execution-plan:${requestId}` })
      );
      expect(result.authorized, label).toBe(false);
      expect(result.reason, label).toBe('authorization-chain-invalid');
      expect(result.authorization, label).toBeNull();
      expect(result.providerIds, label).toEqual([]);
    }
  });

  it('27b. different work produces a different authorization', () => {
    const first = authorize(validDispatch(['amadeus-execution'], 'trip-a'));
    const second = authorize(validDispatch(['amadeus-execution'], 'trip-b'));
    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(true);
    expect(first.authorization!.id).not.toBe(second.authorization!.id);
    expect(first.dispatchId).not.toBe(second.dispatchId);
  });
});

describe('STEP 73 authorization: output integrity (28-35)', () => {
  it('28. a successful result contains a real STEP 57 authorization', () => {
    const result = authorize(validDispatch());
    const authorization = result.authorization!;
    expect(authorization.kind).toBe('trip-planning-execution-authorization');
    expect(authorization.id.startsWith('trip-planning-execution-authorization:')).toBe(true);
    expect(authorization.requestId.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX)).toBe(true);
    expect(isTripPlanningExecutionAuthorization(authorization)).toBe(true);
  });

  it('28b. a successful result carries a valid STEP 58 instruction identity', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    // The dispatch id still names a real, valid STEP 58 instruction.
    expect(
      isTripExecutionDispatchInstruction({
        id: result.dispatchId,
        kind: 'trip-execution-dispatch-instruction',
        authorizationId: result.authorization!.id,
      })
    ).toBe(true);
  });

  it('29. the exact dispatch id is preserved', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    expect(result.dispatchId).toBe((dispatch.dispatch as { id: string }).id);
    // The dispatch id is the STEP 58 id of the recovered authorization.
    expect(result.dispatchId).toBe(getTripExecutionDispatchId(result.authorization!.id));
  });

  it('30. the exact request id is preserved', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    expect(result.requestId).toBe(dispatch.requestId);
    expect(result.requestId).toBe(
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${result.dispatchId}`
    );
  });

  it('31. the exact plan id is preserved', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    expect(result.planId).toBe(dispatch.planId);
    expect(result.planId).toBe(`trip-execution-plan:${result.requestId}`);
  });

  it('32. the exact provider order is preserved', () => {
    const providers = ['alpha-execution', 'beta-execution', 'gamma-execution'];
    const result = authorize(validDispatch(providers));
    expect(result.authorized).toBe(true);
    expect(result.providerIds).toEqual(providers);
  });

  it('33. the exact capability is preserved', () => {
    const result = authorize(validDispatch());
    expect(result.requiredCapabilityId).toBe(CAPABILITY);
  });

  it('34. every failure returns authorization null', () => {
    const failures: unknown[] = [
      null,
      undefined,
      'dispatched',
      42,
      [],
      {},
      negativeDispatch(),
      { ...validDispatch(), dispatched: false },
      { ...validDispatch(), reason: 'nope' },
      { ...validDispatch(), planId: null },
      { ...validDispatch(), planId: 'trip-execution-plan:other' },
      { ...validDispatch(), requestId: null },
      { ...validDispatch(), requestId: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}forged` },
      { ...validDispatch(), requiredCapabilityId: null },
      { ...validDispatch(), requiredCapabilityId: 'invented' },
      { ...validDispatch(), providerIds: [] },
      { ...validDispatch(), providerIds: ['a', 'a'] },
      { ...validDispatch(), providerIds: [' padded'] },
      { ...validDispatch(), dispatch: null },
      { ...validDispatch(), dispatch: { id: 'x', kind: 'y' } },
    ];
    for (const dispatch of failures) {
      const result = authorize(dispatch);
      expect(result.authorized, JSON.stringify(dispatch)).toBe(false);
      expect(result.authorization, JSON.stringify(dispatch)).toBeNull();
      expect(result.reason).not.toBe('authorized');
      expect(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS).toContain(result.reason);
    }
  });

  it('35. every failure returns an empty provider list', () => {
    const failures: unknown[] = [
      null,
      {},
      { ...validDispatch(), dispatched: false },
      { ...validDispatch(), requiredCapabilityId: null },
      { ...validDispatch(), providerIds: [] },
      { ...validDispatch(), providerIds: ['alpha', 'beta', 'alpha'] },
      { ...validDispatch(), requestId: 'trip-execution-provider-request:unresolved' },
    ];
    for (const dispatch of failures) {
      const result = authorize(dispatch);
      expect(result.providerIds, JSON.stringify(dispatch)).toEqual([]);
      expect(Array.isArray(result.providerIds)).toBe(true);
    }
  });

  it('35b. a successful result exposes exactly the qualified provider list', () => {
    const result = authorize(validDispatch(['alpha-execution', 'beta-execution']));
    expect(result.providerIds).toEqual(['alpha-execution', 'beta-execution']);
  });
});

describe('STEP 73 authorization: safety (36-39)', () => {
  it('36. the input is not mutated', () => {
    const dispatch = validDispatch();
    const before = JSON.stringify(dispatch);
    const result = authorize(dispatch);
    expect(JSON.stringify(dispatch)).toBe(before);
    expect(dispatch.dispatched).toBe(true);
    expect(dispatch.reason).toBe('dispatched');
    expect(result.authorized).toBe(true);
  });

  it('36b. the input is not mutated on any failure path', () => {
    for (const overrides of [
      { dispatched: false },
      { planId: null },
      { planId: 'trip-execution-plan:forged' },
      { requestId: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unresolved` },
      { requiredCapabilityId: null },
      { providerIds: [] },
      { providerIds: ['a', 'a'] },
      { dispatch: null },
    ]) {
      const dispatch = dispatchedWith(overrides);
      const before = JSON.stringify(dispatch);
      authorize(dispatch);
      expect(JSON.stringify(dispatch), JSON.stringify(overrides)).toBe(before);
    }
  });

  it('37. the provider array and the nested instruction are not mutated', () => {
    const dispatch = validDispatch(['alpha-execution', 'beta-execution']);
    const providerIds = dispatch.providerIds as string[];
    const instruction = dispatch.dispatch as { id: string; authorizationId: string };
    const originalId = instruction.id;

    const result = authorize(dispatch);
    expect(providerIds).toEqual(['alpha-execution', 'beta-execution']);
    expect(instruction.id).toBe(originalId);
    expect(result.providerIds).not.toBe(providerIds);
    expect(result.providerIds).toEqual(providerIds);

    // Editing the result cannot reach back into the input.
    (result.providerIds as string[]).push('gamma-execution');
    expect(dispatch.providerIds).toEqual(['alpha-execution', 'beta-execution']);
  });

  it('37b. the result object has a plain shape and no leaked references', () => {
    const dispatch = validDispatch();
    const result = authorize(dispatch);
    expect(Object.keys(result).sort()).toEqual([
      'authorization',
      'authorized',
      'dispatchId',
      'planId',
      'providerIds',
      'reason',
      'requestId',
      'requiredCapabilityId',
    ]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.authorization!)).toBe(Object.prototype);
    expect(result.authorization).not.toBe(dispatch.authorizationId);
  });

  it('38. repeated calls are deterministic', () => {
    const dispatch = validDispatch(['alpha-execution', 'beta-execution']);
    const first = authorize(dispatch);
    for (let index = 0; index < 5; index += 1) {
      expect(authorize(dispatch)).toEqual(first);
    }

    const failing = dispatchedWith({ providerIds: [] });
    const failed = authorize(failing);
    for (let index = 0; index < 5; index += 1) {
      expect(authorize(failing)).toEqual(failed);
    }
  });

  it('39. ordinary malformed values never throw', () => {
    const malformed: unknown[] = [
      null,
      undefined,
      '',
      'dispatched',
      0,
      42,
      true,
      false,
      NaN,
      Infinity,
      [],
      [validDispatch()],
      {},
      { dispatched: true },
      { dispatched: true, reason: 'dispatched' },
      { dispatched: true, reason: 'dispatched', providerIds: [] },
      { dispatched: true, reason: 'dispatched', dispatch: {} },
      { dispatched: true, reason: 'dispatched', dispatch: { id: 'x', kind: 'y', authorizationId: 'z' } },
      { dispatched: true, reason: 'dispatched', planId: null, requestId: null },
      { dispatched: true, reason: 'dispatched', planId: [], requestId: {} },
      { dispatched: true, reason: 'dispatched', requiredCapabilityId: null },
      { dispatched: true, reason: 'dispatched', providerIds: null },
      { dispatched: true, reason: 'dispatched', providerIds: [[]] },
      { dispatched: true, reason: 'dispatched', providerIds: [{}] },
      Object.create(null),
      { dispatch: Object.create(null) },
      { dispatch: { dispatched: true, reason: 'dispatched', providerIds: [1] } },
    ];
    for (const dispatch of malformed) {
      const result = authorize(dispatch);
      expect(result.authorized, JSON.stringify(dispatch)).toBe(false);
      expect(result.authorization).toBeNull();
      expect(result.providerIds).toEqual([]);
      expect(TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS).toContain(result.reason);
    }
  });

  it('39b. a throwing accessor or Proxy is a documented boundary, as in STEPS 71-72', () => {
    const trapping = {
      dispatched: true,
      get reason(): string {
        throw new Error('trap');
      },
    };
    expect(() => authorize(trapping)).toThrow('trap');

    const trappingProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      }
    );
    expect(() => authorize(trappingProxy)).toThrow('trap');
  });
});

describe('STEP 73 authorization: architectural regression (40-50)', () => {
  const MODULE_PATH = join(
    process.cwd(),
    'src',
    'services',
    'tripExecution',
    'tripExecutionQualifiedAuthorization.ts'
  );
  const SOURCE = readFileSync(MODULE_PATH, 'utf8');
  /** The same source with comments and string literals stripped. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

  it('40. no provider execution and no provider is accepted', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
    expect(CODE).not.toMatch(/TripExecutionProvider\b/);
    expect(CODE).not.toMatch(/createTripExecutionProviderRequest/);
    expect(CODE).not.toMatch(/mockTripExecutionProvider/);
    expect(SOURCE).not.toMatch(/providers?\??\s*:\s*(?:ReadonlyArray|unknown)\s*<\s*Trip/);
  });

  it('41. no orchestrator invocation', () => {
    expect(CODE).not.toContain('orchestrateTripExecution');
    expect(CODE).not.toContain('tripExecutionOrchestrator');
    expect(CODE).not.toContain('TripExecutionOrchestrator');
  });

  it('42. no pipeline invocation', () => {
    expect(CODE).not.toContain('executeTripExecutionPipeline');
    expect(CODE).not.toContain('tripExecutionPipeline');
    expect(CODE).not.toContain('TripExecutionPipeline');
  });

  it('43. no network or fetch', () => {
    expect(CODE).not.toMatch(/fetch\s*\(/);
    expect(CODE).not.toMatch(/XMLHttpRequest|axios|https?:\/\//);
    expect(CODE).not.toMatch(/httpsCallable|getFunctions|serverDiscoveryClient/);
    expect(CODE).not.toMatch(/amadeus|google/i);
    expect(CODE).not.toMatch(/serverBoundary|serverExecution/);
  });

  it('44. no persistence', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(CODE).not.toMatch(/addDoc|setDoc|updateDoc|\.collection\(/);
  });

  it('45. no Firebase', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('46. no React, Router, or Zustand', () => {
    for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand']) {
      expect(CODE, forbidden).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
    }
    expect(CODE).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
  });

  it('46b. no asynchrony, timers, clock, or environment access', () => {
    expect(CODE).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
    expect(CODE).not.toMatch(/setTimeout|setInterval/);
    expect(CODE).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
    expect(CODE).not.toMatch(/import\.meta\.env|process\.env/);
    expect(CODE).not.toMatch(/^(let|var)\s/m);
    expect(CODE).not.toMatch(/class\s+\w+/);
  });

  it('47. no booking or payment capability invention', () => {
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
    expect(SOURCE).not.toMatch(
      /export (?:const|type) (?:PROVIDER_CAPABILITY_IDS|ProviderCapabilityId)/
    );
    expect(CODE).toContain('isProviderCapabilityId');
  });

  it('48. no authorization-rule invention', () => {
    const code = readCodeOnly();
    // No policy, role, scope, session, or expiry evaluation: STEP 57 scopes those
    // to a later layer, and this module must not quietly take them over.
    expect(code).not.toMatch(/\b(role|policy|permission|scope|token|credential|session|consent)\b/i);
    expect(code).not.toMatch(/expires|expiry|validUntil|revoked|approvedBy/);
    // No existence lookup, so it cannot claim a referenced value is present.
    expect(code).not.toMatch(/exists|lookup|findBy|getDoc|query\(/i);
  });

  it('48b. the real STEP 57 factory and validator are used, not a restatement', () => {
    expect(CODE).toContain('createTripPlanningExecutionAuthorization');
    expect(CODE).toContain('isTripPlanningExecutionAuthorization');
    // The authorization id belongs to STEP 57, so this module neither writes it
    // nor derives it a second time: it consumes the factory's own output and
    // re-derives the chain forward with STEP 58's id function only.
    expect(CODE).not.toContain('getTripPlanningExecutionAuthorizationId');
    expect(CODE).toContain('getTripExecutionDispatchId');
    // No authorization id is ever written literally, and no second formula exists.
    expect(CODE).not.toMatch(/trip-planning-execution-authorization/);
    expect(SOURCE).not.toMatch(/export const TRIP_PLANNING_EXECUTION_AUTHORIZATION/);
    expect(SOURCE).not.toMatch(/export function getTripPlanningExecutionAuthorizationId/);
    expect(CODE).not.toMatch(/authorization:\s*\{/);
  });

  it('49. no sorting, ranking, or scoring', () => {
    expect(CODE).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.flat\s*\(/);
    expect(CODE).not.toMatch(/\b(rank|score|bestProvider|preferred)\b/i);
    // A Set detects a repeat; it never rebuilds the list.
    expect(CODE).toMatch(/new Set<string>\(\)/);
    expect(CODE).not.toMatch(/Array\.from\(\s*seen/);
  });

  it('50. no STEP 57 or STEP 58 contract restatement', () => {
    // The dispatch id prefix and the instruction kind belong to STEP 58.
    expect(SOURCE).not.toMatch(/export const TRIP_EXECUTION_DISPATCH/);
    expect(SOURCE).not.toContain("'trip-execution-dispatch-instruction'");
    // The request prefix and kind belong to STEP 56.
    expect(SOURCE).not.toMatch(/export const TRIP_PLANNING_EXECUTION_REQUEST/);
    expect(SOURCE).not.toContain("'trip-planning-execution-request'");
    // The STEP 72 reason vocabulary is imported, never redeclared.
    expect(SOURCE).not.toMatch(/export const TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS/);
  });

  function readCodeOnly(): string {
    return CODE;
  }
});
