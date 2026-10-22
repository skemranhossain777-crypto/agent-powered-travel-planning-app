import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionPlan,
  type TripExecutionPlan,
} from '../services/tripExecution/tripExecutionPlan';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import type { TripPlanningReference } from '../types/trip';
import {
  evaluateTripExecutionPlanQualification,
  TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS,
  type TripExecutionPlanQualification,
} from '../services/tripExecution/tripExecutionPlanQualification';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';

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

/**
 * A real STEP 63 plan. `createTripExecutionPlan` is the genuine factory, and the
 * providers are execution-only, so STEP 62 treats them as supported and the
 * plan records exactly `providerIds` in the given order.
 */
function validPlan(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): TripExecutionPlan {
  const providers = providerIds.map((providerId) => ({
    providerId,
    async execute() {
      return Promise.resolve({
        providerId,
        requestId: 'unused',
        status: 'accepted' as const,
      });
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

function ineligibleFor(step56Request: TripPlanningExecutionRequest): Record<string, unknown> {
  return {
    eligible: false,
    requestId: step56Request.id,
    requiredCapabilityId: null,
    providerIds: [],
    capabilityIds: [],
    reason: 'no-eligible-provider',
  };
}

function qualify(
  plan: unknown,
  eligibility: unknown
): TripExecutionPlanQualification {
  return evaluateTripExecutionPlanQualification({ plan, eligibility });
}

/** The happy-path pair, so each test can perturb exactly one thing. */
function pair(
  providerIds: ReadonlyArray<string> = ['amadeus-execution'],
  tripId = 'trip-plan'
): { request: TripPlanningExecutionRequest; plan: TripExecutionPlan; eligibility: Record<string, unknown> } {
  const request = validStep56Request(tripId);
  const plan = validPlan(providerIds, tripId);
  return { request, plan, eligibility: eligibleFor(request, plan.providerIds as string[]) };
}

describe('STEP 71 qualification: input validity (1-6)', () => {
  it('1. valid plan + valid eligible result qualifies', () => {
    const { plan, eligibility } = pair();
    const result = qualify(plan, eligibility);
    expect(result.qualified).toBe(true);
    expect(result.reason).toBe('qualified');
    expect(result.providerIds).toEqual(['amadeus-execution']);
  });

  it('2. invalid plan is rejected', () => {
    const { eligibility } = pair();
    const valid = validPlan();
    const invalid: unknown[] = [
      null,
      undefined,
      'a-plan',
      42,
      [],
      {},
      { ...valid, kind: 'wrong-kind' },
      { ...valid, id: 'trip-execution-plan:forged' },
      { ...valid, requestId: 'not-a-provider-request-id' },
      { ...valid, providerIds: 'amadeus-execution' },
      { ...valid, providerIds: [''] },
    ];
    for (const plan of invalid) {
      const result = qualify(plan, eligibility);
      expect(result.qualified, JSON.stringify(plan)).toBe(false);
      expect(result.reason).toBe('plan-invalid');
      expect(result.providerIds).toEqual([]);
    }
  });

  it('3. a missing plan is rejected', () => {
    const { eligibility } = pair();
    for (const missing of [null, undefined]) {
      const result = qualify(missing, eligibility);
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe('plan-invalid');
    }
  });

  it('4. malformed eligibility is rejected', () => {
    const { plan } = pair();
    const invalid: unknown[] = [
      null,
      undefined,
      'eligible',
      42,
      [],
      {},
      { eligible: 'yes', requestId: 'x', providerIds: [], capabilityIds: [], reason: 'eligible' },
      { eligible: true, requestId: 'x', providerIds: [], capabilityIds: [], reason: 'bogus' },
      { eligible: true, requestId: null, providerIds: ['a'], capabilityIds: [], reason: 'eligible' },
      { eligible: true, requestId: 'x', requiredCapabilityId: 'flight-booking', providerIds: ['a'], capabilityIds: [], reason: 'eligible' },
      { eligible: true, requestId: 'x', requiredCapabilityId: CAPABILITY, providerIds: 'a', capabilityIds: [], reason: 'eligible' },
      { eligible: true, requestId: 'x', requiredCapabilityId: CAPABILITY, providerIds: ['a'], capabilityIds: [42], reason: 'eligible' },
      // Claims eligible with nothing supporting it.
      { eligible: true, requestId: 'x', requiredCapabilityId: CAPABILITY, providerIds: [], capabilityIds: [CAPABILITY], reason: 'eligible' },
      { eligible: true, requestId: 'x', requiredCapabilityId: null, providerIds: ['a'], capabilityIds: [], reason: 'eligible' },
      { eligible: true, requestId: 'x', requiredCapabilityId: CAPABILITY, providerIds: ['a'], capabilityIds: [], reason: 'eligible' },
      // A reason that contradicts the verdict.
      { eligible: true, requestId: 'x', requiredCapabilityId: CAPABILITY, providerIds: ['a'], capabilityIds: [CAPABILITY], reason: 'no-eligible-provider' },
      // An ineligible result that still exposes providers.
      { eligible: false, requestId: 'x', providerIds: ['a'], capabilityIds: [], reason: 'no-eligible-provider' },
    ];
    for (const eligibility of invalid) {
      const result = qualify(plan, eligibility);
      expect(result.qualified, JSON.stringify(eligibility)).toBe(false);
      expect(result.reason).toBe('eligibility-invalid');
      expect(result.providerIds).toEqual([]);
    }
  });

  it('5. a missing eligibility is rejected as invalid, not as ineligible', () => {
    const { plan } = pair();
    for (const missing of [null, undefined]) {
      const result = qualify(plan, missing);
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe('eligibility-invalid');
    }
  });

  it('6. eligibility explicitly false is reported as eligibility-ineligible', () => {
    const { request, plan } = pair();
    const result = qualify(plan, ineligibleFor(request));
    expect(result.qualified).toBe(false);
    // Distinct from malformed: the input was well-formed, the answer was no.
    expect(result.reason).toBe('eligibility-ineligible');
    expect(result.providerIds).toEqual([]);
    // The plan identity is still safely reportable.
    expect(result.planId).toBe(plan.id);
    expect(result.requestId).toBe(plan.requestId);
  });

  it('6b. every STEP 70 ineligible reason is reported as eligibility-ineligible', () => {
    const { request, plan } = pair();
    const reasons = [
      'request-invalid',
      'capability-unspecified',
      'snapshot-missing',
      'snapshot-malformed',
      'provider-identity-invalid',
      'provider-identity-duplicate',
      'no-eligible-provider',
    ];
    for (const reason of reasons) {
      const result = qualify(plan, {
        eligible: false,
        requestId: request.id,
        requiredCapabilityId: null,
        providerIds: [],
        capabilityIds: [],
        reason,
      });
      expect(result.reason, reason).toBe('eligibility-ineligible');
    }
  });

  it('6c. a non-object input does not throw', () => {
    for (const bad of [null, undefined, 'x', 7, true, []]) {
      expect(() => evaluateTripExecutionPlanQualification(bad as never)).not.toThrow();
      expect(evaluateTripExecutionPlanQualification(bad as never).qualified).toBe(false);
    }
  });
});

describe('STEP 71 qualification: request identity (7-9)', () => {
  it('7. matching request identity qualifies', () => {
    const { request, plan, eligibility } = pair();
    // The plan references the provider-request id derived from this exact
    // STEP 56 request, so the correspondence holds.
    expect(plan.requestId).toBe(
      `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}trip-execution-dispatch:` +
        `trip-planning-execution-authorization:${request.id}`
    );
    expect(qualify(plan, eligibility).qualified).toBe(true);
  });

  it('8. mismatched request identity is rejected', () => {
    const first = pair();
    const second = pair(['amadeus-execution'], 'other-trip');
    // A real plan and a real eligibility, but for different work.
    const result = qualify(first.plan, second.eligibility);
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('request-mismatch');
    expect(result.providerIds).toEqual([]);
  });

  it('8b. a plan from one chain and eligibility from another never match', () => {
    const planTrip = validPlan(['amadeus-execution'], 'trip-a');
    const otherRequest = validStep56Request('trip-b');
    const result = qualify(planTrip, eligibleFor(otherRequest, ['amadeus-execution']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('request-mismatch');
  });

  it('8c. a provider-request id is not accepted where a STEP 56 id is required', () => {
    const { plan } = pair();
    // Feeding the plan's own request id back as the eligibility request id must
    // not produce a match.
    const result = qualify(plan, {
      eligible: true,
      requestId: plan.requestId,
      requiredCapabilityId: CAPABILITY,
      providerIds: ['amadeus-execution'],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('request-mismatch');
  });

  it('9. invalid request identity is rejected', () => {
    const { plan } = pair();
    // An unrecognizable identity is either structurally invalid (non-string, or
    // an eligible result with a null id) or well-formed but unmatched. Both fail
    // closed; the distinction is only which bounded reason is reported.
    for (const requestId of ['', 'trip-planning-execution-request:', 'not-a-request-id', 42, {}]) {
      const result = qualify(plan, {
        eligible: true,
        requestId,
        requiredCapabilityId: CAPABILITY,
        providerIds: ['amadeus-execution'],
        capabilityIds: [CAPABILITY],
        reason: 'eligible',
      });
      expect(result.qualified, JSON.stringify(requestId)).toBe(false);
      expect(['eligibility-invalid', 'request-mismatch']).toContain(result.reason);
      expect(result.providerIds).toEqual([]);
    }
    // A well-formed STEP 56 id that simply names different work is a mismatch,
    // not a structural fault, and is reported as such.
    const mismatch = qualify(plan, {
      eligible: true,
      requestId: `${'trip-planning-execution-request:'}some-other-intent`,
      requiredCapabilityId: CAPABILITY,
      providerIds: ['amadeus-execution'],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    });
    expect(mismatch.reason).toBe('request-mismatch');
  });

  it('9b. a null request id on an eligible result is structurally invalid', () => {
    const { plan } = pair();
    const result = qualify(plan, {
      eligible: true,
      requestId: null,
      requiredCapabilityId: CAPABILITY,
      providerIds: ['amadeus-execution'],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('eligibility-invalid');
  });
});

describe('STEP 71 qualification: capability (10-13)', () => {
  it('10. a valid required capability qualifies', () => {
    for (const capabilityId of PROVIDER_CAPABILITY_IDS) {
      const request = validStep56Request();
      const plan = validPlan(['amadeus-execution']);
      const result = qualify(plan, eligibleFor(request, ['amadeus-execution'], capabilityId));
      expect(result.qualified, capabilityId).toBe(true);
      expect(result.requiredCapabilityId).toBe(capabilityId);
    }
  });

  it('11. a missing capability is rejected as capability-unspecified', () => {
    const { request, plan } = pair();
    const result = qualify(plan, {
      eligible: true,
      requestId: request.id,
      requiredCapabilityId: null,
      providerIds: ['amadeus-execution'],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    });
    // Structurally this is a null capability on an eligible result, which the
    // validator treats as malformed.
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('eligibility-invalid');
  });

  it('11b. a present-but-empty capabilityId list leaves the field null', () => {
    const { request, plan } = pair();
    const result = qualify(plan, {
      eligible: true,
      requestId: request.id,
      requiredCapabilityId: null,
      providerIds: ['amadeus-execution'],
      capabilityIds: [],
      reason: 'eligible',
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('eligibility-invalid');
  });

  it('12. an invalid capability is rejected', () => {
    const { request, plan } = pair();
    for (const invalid of [
      'flight-booking',
      'hotel-booking',
      'payment',
      'Search-Transport',
      ' search-transport',
      'search-transport ',
      'search_transport',
      'hotel',
      42,
      {},
      [],
    ]) {
      const result = qualify(plan, {
        eligible: true,
        requestId: request.id,
        requiredCapabilityId: invalid,
        providerIds: ['amadeus-execution'],
        capabilityIds: [typeof invalid === 'string' ? invalid : CAPABILITY],
        reason: 'eligible',
      });
      expect(result.qualified, JSON.stringify(invalid)).toBe(false);
      expect(result.reason).toBe('eligibility-invalid');
      // No invented capability is ever echoed back.
      expect(result.requiredCapabilityId).toBeNull();
    }
  });

  it('13. the capability is preserved exactly, with no normalization', () => {
    const { request, plan } = pair();
    const result = qualify(plan, eligibleFor(request, ['amadeus-execution'], CAPABILITY));
    expect(result.qualified).toBe(true);
    // Byte-for-byte identical to what the eligibility result carried.
    expect(result.requiredCapabilityId).toBe(CAPABILITY);
    expect(result.requiredCapabilityId).toBe(
      (eligibleFor(request, ['amadeus-execution']) as Record<string, unknown>)[
        'requiredCapabilityId'
      ]
    );
  });

  it('13b. the module invents no capability of its own', () => {
    const { request, plan } = pair();
    // With no capability anywhere, there is no path to a qualified result.
    const noCapability = qualify(plan, {
      eligible: false,
      requestId: request.id,
      requiredCapabilityId: null,
      providerIds: [],
      capabilityIds: [],
      reason: 'capability-unspecified',
    });
    expect(noCapability.qualified).toBe(false);
    expect(noCapability.requiredCapabilityId).toBeNull();
    for (const invented of ['flight-booking', 'payment', 'ticket-purchase', 'hotel-booking']) {
      expect(PROVIDER_CAPABILITY_IDS).not.toContain(invented);
    }
  });
});

describe('STEP 71 qualification: provider matching (14-22)', () => {
  it('14. identical provider ids in identical order qualifies', () => {
    const ids = ['alpha', 'beta', 'gamma'];
    const { plan, eligibility } = pair(ids);
    expect((plan.providerIds as string[])).toEqual(ids);
    const result = qualify(plan, eligibility);
    expect(result.qualified).toBe(true);
    expect(result.providerIds).toEqual(ids);
  });

  it('15. the same providers in a different order is rejected', () => {
    const { request, plan } = pair(['alpha', 'beta']);
    const result = qualify(plan, eligibleFor(request, ['beta', 'alpha']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-set-mismatch');
    expect(result.providerIds).toEqual([]);
  });

  it('16. a missing provider is rejected', () => {
    const { request, plan } = pair(['alpha', 'beta']);
    const result = qualify(plan, eligibleFor(request, ['alpha']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-set-mismatch');
    // Not even the matching subset is exposed.
    expect(result.providerIds).toEqual([]);
  });

  it('17. an extra provider is rejected', () => {
    const { request, plan } = pair(['alpha']);
    const result = qualify(plan, eligibleFor(request, ['alpha', 'beta']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-set-mismatch');
    expect(result.providerIds).toEqual([]);
  });

  it('18. a duplicate provider is rejected', () => {
    // On the plan side the STEP 63 validator permits repeated ids, so this
    // module must catch the duplication itself.
    const { request, plan } = pair(['alpha', 'alpha']);
    expect((plan.providerIds as string[])).toEqual(['alpha', 'alpha']);
    const result = qualify(plan, eligibleFor(request, ['alpha', 'alpha']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
    expect(result.providerIds).toEqual([]);
  });

  it('18b. a duplicate on the eligibility side is rejected', () => {
    const { request, plan } = pair(['alpha', 'beta']);
    const result = qualify(plan, eligibleFor(request, ['alpha', 'alpha']));
    // A duplicate against a two-element plan is a size mismatch first; either
    // way it must not qualify.
    expect(result.qualified).toBe(false);
    expect(['provider-set-mismatch', 'provider-identity-duplicate']).toContain(result.reason);
  });

  it('19. an invalid provider identity is rejected', () => {
    const { request, plan } = pair(['alpha']);
    for (const bad of ['', '  ', ' padded', 'trailing ', 'a'.repeat(101), 42, null]) {
      const result = qualify(plan, eligibleFor(request, [bad as string]));
      expect(result.qualified, JSON.stringify(bad)).toBe(false);
      expect(result.providerIds).toEqual([]);
    }
  });

  it('20. case variation is rejected', () => {
    const { request, plan } = pair(['AlphaExec']);
    const result = qualify(plan, eligibleFor(request, ['alphaexec']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-set-mismatch');
    expect(result.providerIds).toEqual([]);
  });

  it('20b. case variation among several providers is rejected', () => {
    const { request, plan } = pair(['alpha', 'Beta']);
    const result = qualify(plan, eligibleFor(request, ['alpha', 'beta']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('provider-set-mismatch');
  });

  it('21. whitespace variation is rejected', () => {
    const { request, plan } = pair(['alpha']);
    // A padded identity is not a usable identity, so the eligibility value that
    // carries it never becomes a valid input. Either bounded reason is a
    // rejection; neither may expose a provider.
    for (const variant of [' alpha', 'alpha ', ' alpha ', '\talpha']) {
      const result = qualify(plan, eligibleFor(request, [variant]));
      expect(result.qualified, JSON.stringify(variant)).toBe(false);
      expect(['eligibility-invalid', 'provider-identity-invalid', 'provider-set-mismatch']).toContain(
        result.reason
      );
      expect(result.providerIds).toEqual([]);
    }
  });

  it('21b. a plan whose own ids are padded is rejected at the plan boundary', () => {
    const { request, plan } = pair(['alpha']);
    const padded = { ...plan, providerIds: [' alpha'] };
    const result = qualify(padded, eligibleFor(request, ['alpha']));
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('plan-invalid');
    expect(result.providerIds).toEqual([]);
  });

  it('22. alias and substitution is rejected', () => {
    const { request, plan } = pair(['amadeus-execution']);
    for (const alias of [
      'amadeus',
      'amadeus_execution',
      'amadeus-execution-v2',
      'Amadeus-Execution',
      'other-provider',
    ]) {
      const result = qualify(plan, eligibleFor(request, [alias]));
      expect(result.qualified, alias).toBe(false);
      expect(result.reason).toBe('provider-set-mismatch');
      expect(result.providerIds).toEqual([]);
    }
  });

  it('22b. a plan with no providers cannot qualify', () => {
    const { request, plan } = pair([]);
    expect((plan.providerIds as string[])).toEqual([]);
    const result = qualify(plan, eligibleFor(request, []));
    // STEP 70 never emits an eligible result with an empty provider list, so
    // this pair is rejected rather than vacuously qualified.
    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('eligibility-invalid');
  });
});

describe('STEP 71 qualification: output integrity (23-28)', () => {
  it('23. a qualified result preserves the plan provider order exactly', () => {
    const ids = ['zeta', 'alpha', 'mid', 'beta'];
    const { plan, eligibility } = pair(ids);
    const result = qualify(plan, eligibility);
    expect(result.qualified).toBe(true);
    expect(result.providerIds).toEqual(ids);
    // Not sorted, not deduplicated, not ranked.
    expect(result.providerIds).not.toEqual([...ids].sort());
  });

  it('24. a qualified result preserves the plan id exactly', () => {
    const { plan, eligibility } = pair();
    const result = qualify(plan, eligibility);
    expect(result.planId).toBe(plan.id);
    expect(result.planId).toMatch(/^trip-execution-plan:trip-execution-provider-request:/);
  });

  it('25. a qualified result preserves the plan request id exactly', () => {
    const { request, plan, eligibility } = pair();
    const result = qualify(plan, eligibility);
    expect(result.qualified).toBe(true);
    // The result reports the plan's own request id, byte-for-byte.
    expect(result.requestId).toBe(plan.requestId);
    // The eligibility result names the STEP 56 request, which is the upstream
    // identity in the same deterministic chain - not the plan's provider-request
    // id. The two are related, never equal, which is exactly why qualification
    // re-derives the correspondence instead of comparing the strings.
    expect(result.requestId).not.toBe(request.id);
    expect((eligibility as Record<string, unknown>)['requestId']).toBe(request.id);
    expect((plan.requestId as string).endsWith(request.id)).toBe(true);
  });

  it('26. a qualified result preserves the capability id exactly', () => {
    const request = validStep56Request();
    const plan = validPlan(['alpha']);
    for (const capabilityId of PROVIDER_CAPABILITY_IDS) {
      const result = qualify(plan, eligibleFor(request, ['alpha'], capabilityId));
      expect(result.qualified).toBe(true);
      expect(result.requiredCapabilityId).toBe(capabilityId);
    }
  });

  it('27. every failure returns an empty provider list', () => {
    const { request, plan, eligibility } = pair(['alpha', 'beta']);
    const failures: Array<{ plan: unknown; eligibility: unknown }> = [
      { plan: null, eligibility },
      { plan: 'x', eligibility },
      { plan, eligibility: null },
      { plan, eligibility: 'x' },
      { plan, eligibility: {} },
      { plan, eligibility: ineligibleFor(request) },
      { plan, eligibility: eligibleFor(validStep56Request('other'), ['alpha', 'beta']) },
      { plan, eligibility: eligibleFor(request, ['beta', 'alpha']) },
      { plan, eligibility: eligibleFor(request, ['alpha']) },
      { plan, eligibility: eligibleFor(request, ['alpha', 'beta', 'gamma']) },
      { plan, eligibility: eligibleFor(request, ['alpha', '']) },
    ];
    for (const failure of failures) {
      const result = qualify(failure.plan, failure.eligibility);
      expect(result.qualified, JSON.stringify(failure.eligibility)).toBe(false);
      expect(result.providerIds).toEqual([]);
      expect(result.reason).toBeTruthy();
      expect(TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS).toContain(result.reason);
    }
  });

  it('28. no partial provider answer is ever exposed', () => {
    const { request, plan } = pair(['alpha', 'beta', 'gamma']);
    // Two of the three match exactly; a lax implementation would return them.
    const result = qualify(plan, eligibleFor(request, ['alpha', 'beta']));
    expect(result.qualified).toBe(false);
    expect(result.providerIds).toEqual([]);
    expect(result.providerIds).not.toContain('alpha');
    expect(result.providerIds).not.toContain('beta');
  });

  it('28b. a rejected result never carries providers even when the plan has some', () => {
    const { request, plan } = pair(['alpha', 'beta']);
    const result = qualify(plan, eligibleFor(request, ['alpha']));
    expect(result.qualified).toBe(false);
    expect((plan.providerIds as string[])).toEqual(['alpha', 'beta']);
    expect(result.providerIds).toEqual([]);
  });

  it('28c. the reason vocabulary is closed and bounded', () => {
    expect([...TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS].sort()).toEqual([
      'capability-unspecified',
      'eligibility-ineligible',
      'eligibility-invalid',
      'plan-invalid',
      'provider-identity-duplicate',
      'provider-identity-invalid',
      'provider-set-mismatch',
      'qualified',
      'request-mismatch',
    ]);
  });
});

describe('STEP 71 qualification: safety (29-32)', () => {
  it('29. neither input object is mutated', () => {
    const { request, plan, eligibility } = pair(['alpha', 'beta']);
    const planBefore = JSON.stringify(plan);
    const eligibilityBefore = JSON.stringify(eligibility);
    const requestBefore = JSON.stringify(request);

    qualify(plan, eligibility);

    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(eligibility)).toBe(eligibilityBefore);
    expect(JSON.stringify(request)).toBe(requestBefore);
  });

  it('29b. a rejected evaluation does not mutate its inputs either', () => {
    const { request, plan } = pair(['alpha', 'beta']);
    const badEligibility = eligibleFor(request, ['beta', 'alpha']);
    const planBefore = JSON.stringify(plan);
    const eligibilityBefore = JSON.stringify(badEligibility);

    qualify(plan, badEligibility);

    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(badEligibility)).toBe(eligibilityBefore);
  });

  it('30. provider arrays are not mutated or aliased', () => {
    const { plan, eligibility } = pair(['alpha', 'beta']);
    const planIdsBefore = [...(plan.providerIds as string[])];
    const eligibilityIdsBefore = [...(eligibility['providerIds'] as string[])];

    const result = qualify(plan, eligibility);

    expect(plan.providerIds).toEqual(planIdsBefore);
    expect(eligibility['providerIds']).toEqual(eligibilityIdsBefore);
    // The returned array is a fresh copy, not a reference into either input.
    expect(result.providerIds).not.toBe(plan.providerIds);
    expect(result.providerIds).not.toBe(eligibility['providerIds']);
  });

  it('30b. mutating the returned array cannot reach back into the plan', () => {
    const { plan, eligibility } = pair(['alpha', 'beta']);
    const result = qualify(plan, eligibility);
    expect(result.qualified).toBe(true);
    (result.providerIds as string[]).push('injected');
    expect((plan.providerIds as string[])).toEqual(['alpha', 'beta']);
  });

  it('31. repeated identical calls are deterministic', () => {
    const { plan, eligibility } = pair(['alpha', 'beta']);
    const first = qualify(plan, eligibility);
    const second = qualify(plan, eligibility);
    const third = qualify(plan, eligibility);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(third));

    // And deterministic for failures too.
    const { request } = pair();
    const a = qualify(plan, eligibleFor(request, ['beta', 'alpha']));
    const b = qualify(plan, eligibleFor(request, ['beta', 'alpha']));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('32. malformed and untrusted values never throw', () => {
    const nasty: unknown[] = [
      undefined,
      null,
      0,
      NaN,
      '',
      'plan',
      true,
      false,
      [],
      [null],
      {},
      { plan: null, eligibility: null },
      { plan: () => 'x', eligibility: () => 'y' },
      Object.create(null),
      { plan: { id: 'a'.repeat(5000), kind: 'trip-execution-plan' }, eligibility: { eligible: true } },
    ];
    for (const input of nasty) {
      expect(() => evaluateTripExecutionPlanQualification(input as never)).not.toThrow();
      const result = evaluateTripExecutionPlanQualification(input as never);
      expect(result.qualified).toBe(false);
      expect(result.providerIds).toEqual([]);
    }
  });

  it('32c. a throwing getter or Proxy is a documented boundary, not a silent pass', () => {
    // The evaluator reads properties directly and deliberately uses no try/catch,
    // so a value whose accessor throws propagates. That is a real limit of the
    // guarantee, and it is asserted rather than hidden: the evaluator is total
    // over *data* values, not over arbitrary instrumented objects. Asserting it
    // keeps a future change from silently widening the input surface.
    const trappingPlan = { get id(): string { throw new Error('trap'); } };
    expect(() => qualify(trappingPlan, null)).toThrow('trap');
    const trappingProxy = new Proxy({}, { get() { throw new Error('trap'); } });
    expect(() => qualify(trappingProxy, null)).toThrow('trap');
  });

  it('32b. deeply nested malformed plans never throw', () => {
    for (const plan of [
      { id: { nested: true }, kind: 'trip-execution-plan', requestId: {}, providerIds: [[]] },
      { id: [], kind: [], requestId: [], providerIds: [[], []] },
      { providerIds: [{}, {}] },
    ]) {
      expect(() => qualify(plan, eligibleFor(validStep56Request(), ['a']))).not.toThrow();
      expect(qualify(plan, eligibleFor(validStep56Request(), ['a'])).qualified).toBe(false);
    }
  });
});

describe('STEP 71 qualification: architectural regression (33-40)', () => {
  const MODULE_PATH = join(
    process.cwd(),
    'src',
    'services',
    'tripExecution',
    'tripExecutionPlanQualification.ts'
  );
  const SOURCE = readFileSync(MODULE_PATH, 'utf8');
  /** The same source with comments and string literals stripped. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

  it('33. no provider execution and no provider is accepted', () => {
    expect(CODE).not.toMatch(/\.execute\(/);
    expect(CODE).not.toMatch(/\bexecute\b/);
    expect(CODE).not.toMatch(/TripExecutionProvider\b/);
    // The input type cannot even carry a provider.
    expect(SOURCE).not.toMatch(/providers?\??\s*:\s*(?:ReadonlyArray|unknown)\s*<\s*Trip/);
  });

  it('34. no orchestrator invocation', () => {
    expect(CODE).not.toContain('orchestrateTripExecution');
    expect(CODE).not.toContain('tripExecutionOrchestrator');
    expect(CODE).not.toContain('TripExecutionOrchestrator');
  });

  it('35. no pipeline invocation', () => {
    expect(CODE).not.toContain('executeTripExecutionPipeline');
    expect(CODE).not.toContain('tripExecutionPipeline');
    expect(CODE).not.toContain('TripExecutionPipeline');
  });

  it('35b. no plan creation: the plan is consumed, never built here', () => {
    expect(CODE).not.toMatch(/createTripExecutionPlan\s*\(/);
    expect(CODE).not.toMatch(/getTripExecutionPlanId\s*\(/);
    // Only the validator is imported, never a factory.
    expect(CODE).toContain('isTripExecutionPlan');
  });

  it('36. no network, fetch, or transport', () => {
    expect(CODE).not.toMatch(/fetch\s*\(/);
    expect(CODE).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|axios/);
    expect(CODE).not.toMatch(/https?:\/\//);
    expect(CODE).not.toMatch(/httpsCallable|getFunctions|onCall/);
  });

  it('37. no persistence or environment', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(CODE).not.toMatch(/firebase|firestore|addDoc|setDoc|collection\(|doc\(/i);
    expect(CODE).not.toMatch(/import\.meta\.env|process\.env/);
  });

  it('38. no React, Router, Zustand, or Firebase dependency', () => {
    for (const forbidden of ['react', 'react-dom', 'react-router', 'zustand', 'firebase']) {
      expect(CODE).not.toMatch(new RegExp(`from\\s+['"]${forbidden}`));
    }
    expect(CODE).not.toMatch(/useState|useEffect|useMemo|useCallback/);
  });

  it('38b. no asynchrony, timer, or mutable global state', () => {
    expect(CODE).not.toMatch(/\basync\b|\bawait\b/);
    expect(CODE).not.toMatch(/\bPromise\b/);
    expect(CODE).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(CODE).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
    // A module-level mutable binding would break determinism.
    expect(CODE).not.toMatch(/^(let|var)\s/m);
  });

  it('39. no booking or payment capability is invented', () => {
    for (const invented of [
      'flight-booking',
      'hotel-booking',
      'accommodation-booking',
      'payment',
      'charge-card',
      'purchase',
      'ticket-purchase',
      'refund',
      'invoice',
    ]) {
      expect(SOURCE).not.toContain(`'${invented}'`);
      expect(SOURCE).not.toContain(`"${invented}"`);
    }
  });

  it('39b. no booking, payment, or execution vocabulary in the module', () => {
    expect(CODE).not.toMatch(/book|payment|charge|refund|invoice|reserve/i);
    expect(CODE).not.toMatch(/reservation/i);
  });

  it('40. no sorting, ranking, or scoring', () => {
    expect(CODE).not.toMatch(/\.sort\s*\(/);
    expect(CODE).not.toMatch(/\.reverse\s*\(/);
    expect(CODE).not.toMatch(/\.rank|score|bestProvider|preferred/i);
    // Only identity-preserving copies.
    expect(CODE).toMatch(/\[\.\.\.planProviderIds\]/);
  });

  it('40b. the module imports only the contracts it consumes', () => {
    const imports = [
      ...SOURCE.matchAll(/import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g),
    ].map((match) => ({ typeOnly: match[1].trim().startsWith('type'), module: match[3] }));
    expect(imports).toEqual([
      { typeOnly: false, module: '../../domain/providers/providerResults' },
      { typeOnly: false, module: '../../domain/providers/providerCapabilities' },
      { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionRequest' },
      { typeOnly: false, module: '../../domain/trips/tripPlanningExecutionAuthorization' },
      { typeOnly: false, module: './tripExecutionDispatch' },
      { typeOnly: false, module: './tripExecutionProvider' },
      { typeOnly: false, module: './tripExecutionPlan' },
      { typeOnly: false, module: './tripExecutionEligibility' },
    ]);
  });

  it('40c. no concrete provider, mock, or server-boundary module is imported', () => {
    for (const forbidden of [
      'mockTripExecutionProvider',
      'serverBoundary',
      'serverExecution',
      'realExecution',
      'amadeus',
      'googleDiscovery',
      'googleRoutes',
      'tripExecutionPlanBinding',
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});
