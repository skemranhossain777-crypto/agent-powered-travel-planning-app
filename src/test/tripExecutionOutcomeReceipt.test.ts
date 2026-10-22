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
import { createTripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import type { TripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripExecutionProviderRequest,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { createTripExecutionQualifiedAuthorization } from '../services/tripExecution/tripExecutionQualifiedAuthorization';
import { createTripExecutionAuthorizedRequest } from '../services/tripExecution/tripExecutionAuthorizedRequest';
import {
  orchestrateTripExecutionAuthorizedRequest,
  type TripExecutionAuthorizedOrchestrationResult,
} from '../services/tripExecution/tripExecutionAuthorizedOrchestrator';
import {
  createTripExecutionOutcomeReceipt,
  isTripExecutionOutcomeReceipt,
  TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX,
  TRIP_EXECUTION_OUTCOME_RECEIPT_KIND,
  TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS,
  type TripExecutionOutcomeReceipt,
} from '../services/tripExecution/tripExecutionOutcomeReceipt';
import { MAX_PROVIDER_ID_LENGTH } from '../domain/providers/providerResults';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';
/** Test-owned provider identities. Never a real provider. */
const ALPHA = 'alpha-execution';
const BETA = 'beta-execution';
const GAMMA = 'gamma-execution';
/** A secret the fake providers "leak", to prove nothing escapes into a receipt. */
const SECRET = 'amadeus-live-key-9f2c://internal-provider-stack-frame';

const RECEIPT_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionOutcomeReceipt.ts'
);
const SOURCE = readFileSync(RECEIPT_PATH, 'utf8');
/** Comments and string literals removed, so a code assertion cannot be fooled by prose. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
/** Comments removed, literals intact, so import paths can be enumerated. */
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

function providerRequestFor(tripId = 'trip-plan'): TripExecutionProviderRequest {
  const authorization = requireValue(
    createTripPlanningExecutionAuthorization(validStep56Request(tripId)),
    'authorization'
  );
  const dispatch = requireValue(createTripExecutionDispatchInstruction(authorization), 'dispatch');
  return requireValue(createTripExecutionProviderRequest(dispatch), 'provider request');
}

/** The real, deterministic STEP 59 provider-request id used throughout. */
const REQUEST_ID = providerRequestFor().id;

function validPlan(providerIds: ReadonlyArray<string> = [ALPHA], tripId = 'trip-plan') {
  const providers = providerIds.map((providerId) => ({
    providerId,
    async execute() {
      return Promise.resolve({ providerId, requestId: 'unused', status: 'accepted' as const });
    },
  }));
  return requireValue(createTripExecutionPlan(providerRequestFor(tripId), providers), 'plan');
}

function validDispatch(providerIds: ReadonlyArray<string> = [ALPHA], tripId = 'trip-plan') {
  const request = validStep56Request(tripId);
  const plan = validPlan(providerIds, tripId);
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: {
      eligible: true,
      requestId: request.id,
      requiredCapabilityId: CAPABILITY,
      providerIds: [...plan.providerIds],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    },
  });
  if (!qualification.qualified) throw new Error('test setup: fixture did not qualify');
  const qualified = createTripExecutionQualifiedDispatch({ qualification });
  if (!qualified.dispatched) {
    throw new Error(`test setup: fixture did not dispatch (${qualified.reason})`);
  }
  return { ...qualified, dispatch: { ...qualified.dispatch }, providerIds: [...qualified.providerIds] };
}

/** A genuine STEP 74 authorized-request result, deep-copied for mutation tests. */
function authorizedRequest(providerIds: ReadonlyArray<string> = [ALPHA]): Record<string, unknown> {
  const authorized = createTripExecutionQualifiedAuthorization({
    dispatch: validDispatch(providerIds) as never,
  });
  if (!authorized.authorized) {
    throw new Error(`test setup: fixture not authorized (${authorized.reason})`);
  }
  const request = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (!request.accepted) throw new Error(`test setup: fixture not accepted (${request.reason})`);
  return {
    ...request,
    providerRequest: { ...(request.providerRequest as TripExecutionProviderRequest) },
    providerIds: [...request.providerIds],
  } as unknown as Record<string, unknown>;
}

type Respond = (request: TripExecutionProviderRequest) => unknown;

/** A deterministic recording fake implementing the STEP 59 provider contract. */
function fakeProvider(providerId: string, respond?: Respond) {
  const calls: TripExecutionProviderRequest[] = [];
  return {
    calls,
    name: providerId,
    provider: {
      providerId,
      async execute(request: TripExecutionProviderRequest): Promise<unknown> {
        calls.push(request);
        if (respond) return respond(request);
        return { providerId, requestId: request.id, status: 'accepted' as const };
      },
    },
  };
}

/** A fake answering with a specific STEP 59 status. */
function statusProvider(providerId: string, status: 'accepted' | 'rejected' | 'unsupported' | 'failed') {
  return fakeProvider(providerId, (r) => ({ providerId, requestId: r.id, status }));
}

/** A fake whose execute throws synchronously. */
function throwingProvider(providerId: string) {
  return {
    calls: [] as TripExecutionProviderRequest[],
    name: providerId,
    provider: {
      providerId,
      execute(): unknown {
        throw new Error(SECRET);
      },
    },
  };
}

/** A fake whose execute returns a rejected promise. */
function rejectingProvider(providerId: string) {
  return fakeProvider(providerId, () => Promise.reject(new Error(SECRET)));
}

function objects(...fakes: Array<{ provider: Record<string, unknown> }>): unknown[] {
  return fakes.map((fake) => fake.provider);
}

/** Runs the real STEP 76 boundary and returns its genuine result. */
async function orchestrate(
  fakes: Array<{ provider: Record<string, unknown> }>,
  providerIds: ReadonlyArray<string> = [ALPHA],
  request: unknown = authorizedRequest(providerIds)
): Promise<TripExecutionAuthorizedOrchestrationResult> {
  return orchestrateTripExecutionAuthorizedRequest({ request, providers: objects(...fakes) });
}

/** The real STEP 76 result for a set of statuses, as an orchestration result. */
async function step76For(
  statuses: ReadonlyArray<'accepted' | 'rejected' | 'unsupported' | 'failed' | 'throw' | 'reject'>,
  providerIds: ReadonlyArray<string> = [ALPHA, BETA, GAMMA].slice(0, statuses.length)
): Promise<TripExecutionAuthorizedOrchestrationResult> {
  const fakes = statuses.map((status, index) => {
    const providerId = providerIds[index];
    if (status === 'throw') return throwingProvider(providerId);
    if (status === 'reject') return rejectingProvider(providerId);
    return statusProvider(providerId, status);
  });
  return orchestrate(fakes, providerIds);
}

/** A hand-built STEP 76-shaped value, for contradictions the real boundary cannot emit. */
function step76Like(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executed: true,
    requestId: REQUEST_ID,
    providerIds: [ALPHA],
    results: [step75Like(ALPHA, 'accepted')],
    status: 'accepted',
    reason: 'orchestrated',
    ...overrides,
  };
}

/** A hand-built STEP 75-shaped result value. */
function step75Like(
  providerId: string,
  status: 'accepted' | 'rejected' | 'unsupported' | 'failed' | null,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    executed: status !== null,
    result: status === null ? null : { providerId, requestId: REQUEST_ID, status },
    requestId: REQUEST_ID,
    providerId,
    reason: status === null ? 'provider-execution-failed' : 'executed',
    ...overrides,
  };
}

function receiptFor(input: unknown): TripExecutionOutcomeReceipt | null {
  return createTripExecutionOutcomeReceipt(input);
}

/** Asserts a value is refused, naming the case for a readable failure. */
function expectRefused(input: unknown, label: string): void {
  expect(receiptFor(input), label).toBeNull();
  expect(isTripExecutionOutcomeReceipt(input), label).toBe(false);
}

/** A genuine valid receipt for the default single-provider accepted case. */
async function validReceipt(): Promise<TripExecutionOutcomeReceipt> {
  const result = await orchestrate([statusProvider(ALPHA, 'accepted')]);
  return requireValue(receiptFor(result), 'valid receipt fixture');
}

// --------------------------------------------------------------------------------
// Valid construction
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: valid construction (1-9)', () => {
  it('1. valid single-provider outcome', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'accepted')]);
    const receipt = requireValue(receiptFor(result), 'single-provider receipt');
    expect(receipt.requestId).toBe(REQUEST_ID);
    expect(receipt.providerIds).toEqual([ALPHA]);
    expect(receipt.results).toHaveLength(1);
    expect(receipt.results[0].result?.status).toBe('accepted');
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBe('accepted');
    expect(receipt.reason).toBe('recorded');
    expect(isTripExecutionOutcomeReceipt(receipt)).toBe(true);
  });

  it('2. valid multi-provider outcome', async () => {
    const result = await step76For(['accepted', 'accepted']);
    const receipt = requireValue(receiptFor(result), 'multi-provider receipt');
    expect(receipt.providerIds).toEqual([ALPHA, BETA]);
    expect(receipt.results.map((entry) => entry.providerId)).toEqual([ALPHA, BETA]);
    expect(receipt.status).toBe('accepted');
    expect(receipt.executed).toBe(true);
  });

  it('3. accepted outcome', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'accepted')]);
    expect(receiptFor(result)?.status).toBe('accepted');
  });

  it('4. rejected outcome', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'rejected')]);
    const receipt = requireValue(receiptFor(result), 'rejected receipt');
    expect(receipt.status).toBe('rejected');
    expect(receipt.executed).toBe(true);
    expect(receipt.results[0].result?.status).toBe('rejected');
  });

  it('5. unsupported outcome', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'unsupported')]);
    const receipt = requireValue(receiptFor(result), 'unsupported receipt');
    expect(receipt.status).toBe('unsupported');
    expect(receipt.executed).toBe(true);
  });

  it('6. failed outcome', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'failed')]);
    const receipt = requireValue(receiptFor(result), 'failed receipt');
    expect(receipt.status).toBe('failed');
    expect(receipt.executed).toBe(true);
    expect(receipt.results[0].result?.status).toBe('failed');
  });

  it('7. null status / no-answer outcome', async () => {
    const result = await step76For(['throw', 'reject']);
    expect(result.status).toBeNull();
    const receipt = requireValue(receiptFor(result), 'no-answer receipt');
    expect(receipt.status).toBeNull();
    expect(receipt.executed).toBe(true);
    expect(receipt.results).toHaveLength(2);
    expect(receipt.results.every((entry) => entry.result === null)).toBe(true);
  });

  it('8. non-executed preflight outcome', async () => {
    // A wrong-order collection is a preflight failure that still established the
    // request identity, so a truthful receipt of "nothing ran" is possible.
    const request = authorizedRequest([ALPHA, BETA]);
    const result = await orchestrate(
      [statusProvider(BETA, 'accepted'), statusProvider(ALPHA, 'accepted')],
      [ALPHA, BETA],
      request
    );
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-order-mismatch');
    const receipt = requireValue(receiptFor(result), 'preflight receipt');
    expect(receipt.executed).toBe(false);
    expect(receipt.providerIds).toEqual([]);
    expect(receipt.results).toEqual([]);
    expect(receipt.status).toBeNull();
    expect(receipt.reason).toBe('recorded');
  });

  it('9. executed outcome with provider failures', async () => {
    const result = await step76For(['throw', 'failed', 'rejected']);
    const receipt = requireValue(receiptFor(result), 'failure receipt');
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBe('rejected');
    expect(receipt.results).toHaveLength(3);
    expect(receipt.results[0].reason).toBe('provider-execution-failed');
    expect(receipt.results[1].result?.status).toBe('failed');
    // The failure is recorded, not dropped and not translated.
    expect(receipt.results.map((entry) => entry.providerId)).toEqual([ALPHA, BETA, GAMMA]);
  });
});

// --------------------------------------------------------------------------------
// Identity
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: identity (10-15)', () => {
  it('10. deterministic receipt ID', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'accepted')]);
    const receipt = requireValue(receiptFor(result), 'receipt');
    expect(receipt.id).toBe(`trip-execution-outcome-receipt:${REQUEST_ID}`);
    expect(receipt.id.startsWith(TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX)).toBe(true);
    expect(receipt.kind).toBe(TRIP_EXECUTION_OUTCOME_RECEIPT_KIND);
    // Nothing time-like or random is in the identity.
    expect(receipt.id).toMatch(/^trip-execution-outcome-receipt:trip-execution-provider-request:/);
  });

  it('11. same request produces the same receipt ID', async () => {
    const first = requireValue(
      receiptFor(await orchestrate([statusProvider(ALPHA, 'accepted')])),
      'first'
    );
    const second = requireValue(
      receiptFor(await orchestrate([statusProvider(ALPHA, 'accepted')])),
      'second'
    );
    expect(first.id).toBe(second.id);
    expect(first).toEqual(second);
  });

  it('12. invalid request ID rejected', () => {
    for (const requestId of [7, true, {}, [], '', null, 'trip-execution-provider-request:']) {
      expectRefused(step76Like({ requestId }), `requestId ${JSON.stringify(requestId) ?? 'null'}`);
    }
  });

  it('13. wrong ID prefix rejected', () => {
    for (const requestId of [
      'trip-execution-dispatch:trip-execution-request:abc',
      'trip-execution-provider-results:abc',
      'receipt:trip-execution-provider-request:abc',
      'trip-execution-provider-requestx:trip-execution-request:abc',
      'nonsense',
    ]) {
      expectRefused(step76Like({ requestId }), requestId);
    }
  });

  it('14. padded ID rejected', () => {
    for (const requestId of [` ${REQUEST_ID}`, `${REQUEST_ID} `, `\t${REQUEST_ID}\n`]) {
      expectRefused(step76Like({ requestId }), `padded ${JSON.stringify(requestId)}`);
    }
  });

  it('15. case-variant ID rejected', () => {
    const upper = REQUEST_ID.toUpperCase();
    // Only assert case-variant rejection when uppercasing actually changed it.
    if (upper !== REQUEST_ID) {
      expectRefused(step76Like({ requestId: upper }), 'upper case variant');
      expectRefused(
        step76Like({ requestId: REQUEST_ID.replace('trip-execution', 'Trip-Execution') }),
        'mixed case variant'
      );
    }
    expectRefused(step76Like({ requestId: 'Trip-Execution-Provider-Request:abc' }), 'title case');
  });
});

// --------------------------------------------------------------------------------
// Provider set
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: provider set (16-25)', () => {
  it('16. valid provider IDs', async () => {
    const receipt = await validReceipt();
    expect(receipt.providerIds).toEqual([ALPHA]);
    expect(receipt.providerIds.every((id) => typeof id === 'string' && id !== '')).toBe(true);
  });

  it('17. empty provider IDs when STEP 76 permits it', async () => {
    // Every STEP 76 preflight failure shares one shape: no ids, no results, no
    // aggregate, nothing invoked. A genuine one is recorded as that.
    const genuine = await orchestrate(
      [statusProvider(BETA, 'accepted'), statusProvider(ALPHA, 'accepted')],
      [ALPHA, BETA],
      authorizedRequest([ALPHA, BETA])
    );
    expect(genuine.executed).toBe(false);
    expect(genuine.providerIds).toEqual([]);
    const fromGenuine = requireValue(receiptFor(genuine), 'preflight failure receipt');
    expect(fromGenuine.providerIds).toEqual([]);
    expect(fromGenuine.results).toEqual([]);
    expect(fromGenuine.executed).toBe(false);
    expect(fromGenuine.status).toBeNull();
    // The `provider-set-empty` shape is the same, and is equally recordable.
    const emptySet = requireValue(
      receiptFor(
        step76Like({
          executed: false,
          providerIds: [],
          results: [],
          status: null,
          reason: 'provider-set-empty',
        })
      ),
      'empty set receipt'
    );
    expect(emptySet.providerIds).toEqual([]);
    expect(emptySet.status).toBeNull();
    expect(emptySet.reason).toBe('recorded');
  });

  it('18. invalid provider ID', () => {
    for (const providerId of [7, true, {}, [], null, '']) {
      expectRefused(
        step76Like({ providerIds: [providerId] }),
        `providerIds ${JSON.stringify(providerId) ?? 'null'}`
      );
    }
    expectRefused(
      step76Like({ providerIds: ['x'.repeat(MAX_PROVIDER_ID_LENGTH + 1)] }),
      'over-long provider id'
    );
  });

  it('19. duplicate provider ID', () => {
    expectRefused(
      step76Like({
        providerIds: [ALPHA, ALPHA],
        results: [step75Like(ALPHA, 'accepted'), step75Like(ALPHA, 'accepted')],
      }),
      'duplicate provider id'
    );
  });

  it('20. padded provider ID', () => {
    for (const providerId of [` ${ALPHA}`, `${ALPHA} `]) {
      expectRefused(
        step76Like({
          providerIds: [providerId],
          results: [step75Like(providerId, 'accepted')],
        }),
        `padded ${JSON.stringify(providerId)}`
      );
    }
  });

  it('21. case-variant provider ID', () => {
    // An upper-case identity is its own legal provider identity - provider ids are
    // exact keys, not case-insensitive names - so a self-consistent one is
    // recorded rather than refused.
    const shouted = ALPHA.toUpperCase();
    expect(shouted).not.toBe(ALPHA);
    const legitimate = receiptFor(
      step76Like({
        providerIds: [shouted],
        results: [step75Like(shouted, 'accepted')],
        status: 'accepted',
      })
    );
    expect(legitimate?.providerIds).toEqual([shouted]);
    // What is refused is a case *variant* of the same provider: the declared set
    // says `alpha-execution` while the result says `ALPHA-EXECUTION`, so they are
    // two different providers and the trace would be misattributed.
    expectRefused(
      step76Like({ providerIds: [shouted], results: [step75Like(ALPHA, 'accepted')] }),
      'case variant set against a different result identity'
    );
    expectRefused(
      step76Like({
        providerIds: [ALPHA, BETA],
        results: [step75Like(ALPHA, 'accepted'), step75Like(BETA.toUpperCase(), 'accepted')],
        status: 'accepted',
      }),
      'case variant in the second position'
    );
  });

  it('22. extra provider result', () => {
    expectRefused(
      step76Like({
        providerIds: [ALPHA],
        results: [step75Like(ALPHA, 'accepted'), step75Like(BETA, 'accepted')],
      }),
      'extra result'
    );
  });

  it('23. missing provider result', () => {
    expectRefused(
      step76Like({
        providerIds: [ALPHA, BETA],
        results: [step75Like(ALPHA, 'accepted')],
        status: 'accepted',
      }),
      'missing result'
    );
  });

  it('24. provider-set mismatch', () => {
    expectRefused(
      step76Like({
        providerIds: [BETA],
        results: [step75Like(ALPHA, 'accepted')],
        status: 'accepted',
      }),
      'set mismatch'
    );
  });

  it('25. provider-order mismatch', () => {
    expectRefused(
      step76Like({
        providerIds: [ALPHA, BETA],
        results: [step75Like(BETA, 'accepted'), step75Like(ALPHA, 'accepted')],
        status: 'accepted',
      }),
      'order mismatch'
    );
  });
});

// --------------------------------------------------------------------------------
// Result validation
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: result validation (26-33)', () => {
  it('26. malformed result', () => {
    for (const bad of [null, 7, 'accepted', [], true, {}]) {
      expectRefused(step76Like({ results: [bad] }), `malformed result ${JSON.stringify(bad) ?? 'null'}`);
    }
    expectRefused(step76Like({ results: 'accepted' }), 'results not an array');
    expectRefused(step76Like({ results: {} }), 'results not an array');
  });

  it('27. invalid provider result', () => {
    // `executed` and `reason` must carry the domain's own values.
    expectRefused(step76Like({ results: [step75Like(ALPHA, 'accepted', { executed: 'yes' })] }), 'executed type');
    expectRefused(
      step76Like({ results: [step75Like(ALPHA, 'accepted', { reason: 'invented' })] }),
      'invented reason'
    );
    expectRefused(step76Like({ results: [step75Like(ALPHA, 'accepted', { reason: null })] }), 'null reason');
    expectRefused(
      step76Like({ results: [step75Like(ALPHA, 'accepted', { result: { providerId: ALPHA } })] }),
      'result without status'
    );
    expectRefused(
      step76Like({
        results: [step75Like(ALPHA, 'accepted', { result: { providerId: ALPHA, requestId: REQUEST_ID, status: 'booked' } })],
      }),
      'invented status'
    );
  });

  it('28. invalid provider identity', () => {
    for (const providerId of ['', ' alpha-execution', 7, null]) {
      expectRefused(
        step76Like({ results: [step75Like(ALPHA, 'accepted', { providerId })] }),
        `result providerId ${JSON.stringify(providerId) ?? 'null'}`
      );
    }
  });

  it('29. invalid request identity', () => {
    for (const requestId of ['nonsense', ` ${REQUEST_ID}`, 7, true]) {
      expectRefused(
        step76Like({ results: [step75Like(ALPHA, 'accepted', { requestId })] }),
        `result requestId ${JSON.stringify(requestId)}`
      );
    }
  });

  it('30. result provider mismatch', () => {
    expectRefused(
      step76Like({
        providerIds: [ALPHA],
        results: [step75Like(ALPHA, 'accepted', { result: { providerId: BETA, requestId: REQUEST_ID, status: 'accepted' } })],
        status: 'accepted',
      }),
      'result names another provider'
    );
  });

  it('31. result request mismatch', () => {
    expectRefused(
      step76Like({
        results: [
          step75Like(ALPHA, 'accepted', {
            requestId: 'trip-execution-provider-request:trip-execution-request:other',
          }),
        ],
      }),
      'result belongs to another request'
    );
    expectRefused(
      step76Like({
        results: [
          step75Like(ALPHA, 'accepted', {
            result: { providerId: ALPHA, requestId: 'trip-execution-provider-request:x:y', status: 'accepted' },
          }),
        ],
      }),
      'answer belongs to another request'
    );
  });

  it('32. wrong result count', () => {
    // `executed: true` with no results claims providers were attempted when none were.
    expectRefused(
      step76Like({ providerIds: [], results: [], status: null, executed: true }),
      'executed true with no results'
    );
    // And a non-empty trace with `executed: false` claims nothing ran.
    expectRefused(
      step76Like({ executed: false }),
      'executed false with a result'
    );
  });

  it('33. contradictory result ordering', () => {
    expectRefused(
      step76Like({
        providerIds: [BETA, ALPHA],
        results: [step75Like(ALPHA, 'accepted'), step75Like(BETA, 'accepted')],
        status: 'accepted',
      }),
      'reordered provider set'
    );
  });
});

// --------------------------------------------------------------------------------
// Status consistency
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: status consistency (34-41)', () => {
  it('34. accepted precedence', async () => {
    const result = await step76For(['rejected', 'accepted', 'failed']);
    const receipt = requireValue(receiptFor(result), 'accepted precedence');
    expect(receipt.status).toBe('accepted');
    expect(receipt.results.map((entry) => entry.result?.status)).toEqual([
      'rejected',
      'accepted',
      'failed',
    ]);
  });

  it('35. rejected when no accepted exists', async () => {
    const result = await step76For(['failed', 'rejected', 'failed']);
    const receipt = requireValue(receiptFor(result), 'rejected precedence');
    expect(receipt.status).toBe('rejected');
  });

  it('36. failed when no accepted/rejected exists', async () => {
    const result = await step76For(['failed', 'failed']);
    const receipt = requireValue(receiptFor(result), 'failed precedence');
    expect(receipt.status).toBe('failed');
  });

  it('37. unsupported when all valid answers are unsupported', async () => {
    const result = await step76For(['unsupported', 'unsupported']);
    const receipt = requireValue(receiptFor(result), 'unsupported precedence');
    expect(receipt.status).toBe('unsupported');
  });

  it('38. null when no provider answered', async () => {
    const result = await step76For(['throw', 'reject']);
    expect(result.status).toBeNull();
    const receipt = requireValue(receiptFor(result), 'null aggregate');
    expect(receipt.status).toBeNull();
  });

  it('39. reject accepted with no accepted result', () => {
    expectRefused(
      step76Like({ status: 'accepted', results: [step75Like(ALPHA, 'rejected')] }),
      'accepted claimed over a rejected answer'
    );
    expectRefused(
      step76Like({ status: 'accepted', results: [step75Like(ALPHA, null)] }),
      'accepted claimed over no answer'
    );
  });

  it('40. reject null with answered results', () => {
    expectRefused(
      step76Like({ status: null, results: [step75Like(ALPHA, 'accepted')] }),
      'null claimed over an answered request'
    );
    expectRefused(
      step76Like({ status: null, results: [step75Like(ALPHA, 'rejected')] }),
      'null claimed over a rejected answer'
    );
  });

  it('41. reject unsupported when actual STEP 76 status is null', async () => {
    const result = await step76For(['throw']);
    expect(result.status).toBeNull();
    // The genuine STEP 76 result is accepted; the same trace with `unsupported`
    // is refused, because `unsupported` is a provider's claim, not this module's.
    expectRefused(
      { ...result, status: 'unsupported' as const },
      'unsupported over a no-answer trace'
    );
    expectRefused(
      { ...result, status: 'failed' as const },
      'failed over a no-answer trace'
    );
    // And `null` is never silently converted to `unsupported`.
    const receipt = requireValue(receiptFor(result), 'genuine no-answer receipt');
    expect(receipt.status).toBeNull();
  });
});

// --------------------------------------------------------------------------------
// Executed semantics
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: executed semantics (42-47)', () => {
  it('42. non-executed receipt', () => {
    const receipt = requireValue(
      receiptFor(
        step76Like({
          executed: false,
          providerIds: [],
          results: [],
          status: null,
          reason: 'provider-collection-invalid',
        })
      ),
      'non-executed receipt'
    );
    expect(receipt.executed).toBe(false);
    expect(receipt.status).toBeNull();
    expect(receipt.reason).toBe('recorded');
  });

  it('43. executed receipt', async () => {
    const receipt = await validReceipt();
    expect(receipt.executed).toBe(true);
  });

  it('44. executed with rejected provider', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['rejected', 'rejected'])),
      'rejected executed receipt'
    );
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBe('rejected');
  });

  it('45. executed with failed provider', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['failed', 'throw'])),
      'failed executed receipt'
    );
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBe('failed');
  });

  it('46. executed with unsupported provider', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['unsupported', 'unsupported'])),
      'unsupported executed receipt'
    );
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBe('unsupported');
  });

  it('47. execution remains true despite provider-level failure', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['throw', 'throw', 'throw'])),
      'all-failed executed receipt'
    );
    // Attempted is not answered: the orchestration ran, no provider answered.
    expect(receipt.executed).toBe(true);
    expect(receipt.status).toBeNull();
    expect(receipt.results).toHaveLength(3);
    expect(receipt.results.every((entry) => entry.executed === false)).toBe(true);
    expect(receipt.results.every((entry) => entry.reason === 'provider-execution-failed')).toBe(true);
  });
});

// --------------------------------------------------------------------------------
// Immutability
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: immutability (48-52)', () => {
  it('48. input providerIds mutation cannot alter receipt', async () => {
    const result = await step76For(['accepted', 'rejected']);
    const receipt = requireValue(receiptFor(result), 'receipt');
    (result.providerIds as string[]).push('injected-execution');
    expect(receipt.providerIds).toEqual([ALPHA, BETA]);
  });

  it('49. receipt providerIds mutation cannot alter input', async () => {
    const result = await step76For(['accepted', 'rejected']);
    const receipt = requireValue(receiptFor(result), 'receipt');
    receipt.providerIds.push('injected-execution');
    receipt.providerIds[0] = 'replaced-execution';
    expect(result.providerIds).toEqual([ALPHA, BETA]);
  });

  it('50. input results mutation cannot alter receipt', async () => {
    const result = await step76For(['accepted', 'rejected']);
    const receipt = requireValue(receiptFor(result), 'receipt');
    const firstResult = result.results[0] as { result: { status: string } | null };
    firstResult.result!.status = 'failed';
    (result.results as unknown[]).pop();
    expect(receipt.results).toHaveLength(2);
    expect(receipt.results[0].result?.status).toBe('accepted');
    expect(receipt.status).toBe('accepted');
  });

  it('51. receipt results mutation cannot alter input', async () => {
    const result = await step76For(['accepted', 'rejected']);
    const receipt = requireValue(receiptFor(result), 'receipt');
    const copied = receipt.results[0] as { result: { status: string } | null; reason: string };
    copied.result!.status = 'failed';
    copied.reason = 'provider-execution-failed';
    expect((result.results[0] as { result: { status: string } | null }).result?.status).toBe('accepted');
    expect((result.results[0] as { reason: string }).reason).toBe('executed');
    expect(receipt.status).toBe('accepted');
  });

  it('52. repeated construction is deterministic', async () => {
    const result = await step76For(['accepted', 'throw', 'rejected']);
    const first = requireValue(receiptFor(result), 'first');
    const second = requireValue(receiptFor(result), 'second');
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.id).toBe(first.id);
  });
});

// --------------------------------------------------------------------------------
// Architectural safety
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: architectural safety (53-63)', () => {
  it('53. no provider execution', () => {
    expect(CODE).not.toMatch(/provider\s*\.\s*execute/);
    expect(CODE).not.toMatch(/\.execute\s*\(/);
    expect(CODE).not.toMatch(/\bexecuteTripExecutionAuthorizedRequest\b/);
    expect(CODE).not.toMatch(/\borchestrateTripExecutionAuthorizedRequest\b/);
    // No provider is accepted as input: both members are untrusted `unknown`.
    expect(CODE_WITH_LITERALS).toMatch(/export function createTripExecutionOutcomeReceipt\(\s*input:\s*unknown\s*\)/);
  });

  it('62. no provider object is accepted as input, and none is ever invoked', () => {
    // Proved by behaviour, not only by the signature: a genuine STEP 59 provider
    // object - one that really can be executed - is refused as input, and the
    // receipt never reaches it. The spy is the proof that the receipt is a record
    // of an execution that already happened and cannot become a new one.
    const fake = fakeProvider(ALPHA);
    const receipt = createTripExecutionOutcomeReceipt(fake.provider);
    expect(receipt).toBeNull();
    expect(fake.calls).toHaveLength(0);
    // A whole orchestration input - request plus providers - is refused too, so
    // there is no shape by which a provider set could reach the factory.
    expect(
      createTripExecutionOutcomeReceipt({ request: authorizedRequest(), providers: [fake.provider] })
    ).toBeNull();
    expect(createTripExecutionOutcomeReceipt([fake.provider])).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('54. no persistence', () => {
    for (const forbidden of [
      'firestore',
      'firebase',
      'addDoc',
      'setDoc',
      'updateDoc',
      'writeBatch',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document\\.cookie',
      'writeFile',
      'readFile',
      'node:fs',
      '\\brequire\\s*\\(',
    ]) {
      expect(CODE_WITH_LITERALS, forbidden).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('55. no network', () => {
    for (const forbidden of [
      'fetch(',
      'XMLHttpRequest',
      'axios',
      'httpsCallable',
      'getFunctions',
      'http://',
      'https://',
      'axios.create',
      'node:http',
    ]) {
      expect(CODE_WITH_LITERALS, forbidden).not.toMatch(new RegExp(forbidden.replace(/[.(]/g, '\\$&'), 'i'));
    }
  });

  it('56. no Firebase, Amadeus, or Google', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/amadeus/i);
    expect(CODE_WITH_LITERALS).not.toMatch(/google/i);
    expect(CODE_WITH_LITERALS).not.toMatch(/firebase/i);
    // And no provider implementation is imported.
    expect(CODE_WITH_LITERALS).not.toMatch(/mockTripExecutionProvider/);
    expect(CODE_WITH_LITERALS).not.toMatch(/TripExecutionProvider\b\s*[,;}]/);
  });

  it('57. no environment, clock, or randomness', () => {
    expect(CODE).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
    expect(CODE).not.toMatch(/Date\.now\(|new\s+Date\s*\(|Math\.random|performance\./);
    expect(CODE).not.toMatch(/setTimeout|setInterval|clearTimeout|clearInterval/);
    expect(CODE).not.toMatch(/randomUUID|uuid|crypto\./i);
    // No counter or accumulator at module scope.
    expect(CODE).not.toMatch(/^(let|var)\s/m);
    expect(CODE).not.toMatch(/class\s+\w+/);
    // The only reassignable bindings are the two index counters. Everything else
    // is a `const` local, so there is no module-scoped mutable state.
    expect([...CODE.matchAll(/\b(let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[2])).toEqual([
      'index',
      'index',
    ]);
  });

  it('58. no commerce semantics', () => {
    for (const invented of [
      'booking',
      'booked',
      'payment',
      'purchase',
      'reservation',
      'reserve',
      'ticket',
      'invoice',
      'refund',
      'cancellation',
      'transaction',
      'charge',
    ]) {
      expect(CODE, invented).not.toMatch(new RegExp(invented, 'i'));
      for (const literal of SOURCE.match(/'[^'\n]*'/g) ?? []) {
        expect(literal, `${invented} in ${literal}`).not.toMatch(new RegExp(invented, 'i'));
      }
    }
  });

  it('59. no duplicated status vocabulary', () => {
    // No status array is declared here: the existing STEP 59 validator decides.
    expect(CODE_WITH_LITERALS).not.toMatch(/TRIP_EXECUTION_PROVIDER_RESULT_STATUSES\s*=\s*\[/);
    expect(CODE_WITH_LITERALS).not.toMatch(/export const [A-Z_]*STATUS/);
    expect(CODE_WITH_LITERALS).not.toMatch(/'accepted'\s*,\s*'rejected'\s*,\s*'unsupported'\s*,\s*'failed'/);
    expect(CODE).toContain('isTripExecutionProviderResultStatus');
    expect(CODE).toContain('getTripExecutionAggregateStatus');
  });

  it('60. no duplicated receipt ID formula', () => {
    // The prefix is declared once and used through the constant everywhere.
    expect([...CODE_WITH_LITERALS.matchAll(/'trip-execution-outcome-receipt:'/g)].length).toBe(1);
    expect(CODE_WITH_LITERALS).toContain('TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX');
    expect([...CODE.matchAll(/id:\s*`\$\{TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX\}/g)].length).toBe(1);
    // The provider-request prefix is read from STEP 59, never restated.
    expect(CODE_WITH_LITERALS).not.toMatch(/'trip-execution-provider-request:'/);
    expect(CODE).toContain('TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX');
  });

  it('61. no STEP 75 or STEP 76 execution is imported or called', () => {
    // STEP 75's type and reason list are reused; its function is not imported.
    expect(CODE_WITH_LITERALS).toContain('type TripExecutionAuthorizedExecutionResult');
    expect(CODE_WITH_LITERALS).toContain('TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS');
    expect(CODE).not.toMatch(/executeTripExecutionAuthorizedRequest/);
    // STEP 76's type and reason list are reused; its function is not imported.
    expect(CODE_WITH_LITERALS).toContain('type TripExecutionAuthorizedOrchestrationResult');
    expect(CODE_WITH_LITERALS).toContain('TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS');
    expect(CODE).not.toMatch(/orchestrateTripExecutionAuthorizedRequest/);
    // No upstream layer, no provider implementation, no UI layer.
    for (const upstream of [
      'tripPlanningExecutionAuthorization',
      'tripExecutionDispatch',
      'tripExecutionPlan',
      'tripExecutionQualifiedDispatch',
      'tripExecutionQualifiedAuthorization',
      'tripExecutionAuthorizedRequest',
      'tripExecutionPipeline',
    ]) {
      expect(CODE_WITH_LITERALS, upstream).not.toContain(upstream);
    }
    for (const ui of ['react', 'react-dom', 'react-router', 'zustand']) {
      expect(CODE_WITH_LITERALS, ui).not.toMatch(new RegExp(`from\\s+['"]${ui}`));
    }
  });

  it('63. no receipt escapes a provider failure detail', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['throw', 'reject'])),
      'failure receipt'
    );
    const serialised = JSON.stringify(receipt);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('amadeus');
    expect(serialised).not.toMatch(/stack|Error:/i);
    // Only the bounded reason travels.
    expect(receipt.results[0].reason).toBe('provider-execution-failed');
    expect(receipt.results[0].result).toBeNull();
  });
});

// --------------------------------------------------------------------------------
// Shape gates, one field at a time
// --------------------------------------------------------------------------------

describe('STEP 77 outcome receipt: shape gates (74-79)', () => {
  it('74. each shape gate refuses on its own field', () => {
    // Each entry isolates exactly one structural fault, so the test proves the
    // gate exists rather than proving that "something" was refused.
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['executed is not a boolean', { executed: 'yes' }],
      ['executed is absent', { executed: undefined }],
      ['requestId is a number', { requestId: 7 }],
      ['requestId is an object', { requestId: {} }],
      ['providerIds is not an array', { providerIds: 'alpha-execution' }],
      ['providerIds is absent', { providerIds: undefined }],
      ['results is absent', { results: undefined }],
      ['status is a number', { status: 7 }],
      ['status is an object', { status: { value: 'accepted' } }],
      ['reason is invented', { reason: 'invented' }],
      ['reason is absent', { reason: undefined }],
      ['reason is a STEP 75 token, not a STEP 76 one', { reason: 'executed' }],
    ];
    for (const [label, override] of cases) {
      expectRefused(step76Like(override), label);
    }
  });

  it('75. a wholly non-object input is refused', () => {
    for (const value of [null, undefined, 7, 'orchestrated', true, [], () => null]) {
      expectRefused(value, `non-object ${typeof value}`);
    }
  });

  it('76. a top-level status outside the existing vocabulary is refused', () => {
    // `hasOrchestrationShape` accepts any string, so this reaches the status gate
    // itself rather than being refused as structurally malformed.
    for (const status of ['booked', 'ok', 'ACCEPTED', 'Accepted', 'completed', 'error']) {
      expectRefused(step76Like({ status }), `status ${status}`);
    }
    // `null` and the four real statuses are accepted by that gate.
    for (const status of [null, 'accepted', 'rejected', 'unsupported', 'failed'] as const) {
      const outcome = step76Like({
        status,
        results: [step75Like(ALPHA, status === null ? null : status)],
      });
      expect(receiptFor(outcome), `status ${status}`).not.toBeNull();
    }
  });

  it('77. an absent status is never inferred from the results', () => {
    // An absent field is read as `null`. With answers behind it, that is a
    // contradiction - `null` claims nobody answered - so the combination is
    // refused rather than quietly repaired to `accepted`.
    expectRefused(
      step76Like({ status: undefined }),
      'absent status over an answered trace'
    );
    // With genuinely unanswered results, an absent status and `null` agree, so
    // the receipt is recorded - and it records `null`, not a fabricated status.
    const unanswered = receiptFor(
      step76Like({ status: undefined, results: [step75Like(ALPHA, null)] })
    );
    expect(unanswered?.status).toBeNull();
    expect(unanswered?.executed).toBe(true);
  });

  it('78. the guard refuses a bad request identity on a receipt', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, requestId: 7 })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, requestId: 'nonsense' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, requestId: null })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, requestId: undefined })).toBe(false);
  });

  it('79. the guard refuses a bad provider identity on a receipt', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [' padded'] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [''] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [7] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: undefined })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: null })).toBe(false);
  });
});

describe('STEP 77 outcome receipt: guard and vocabulary (64-73)', () => {
  it('64. the guard accepts a genuine receipt', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt(receipt)).toBe(true);
    expect(isTripExecutionOutcomeReceipt(JSON.parse(JSON.stringify(receipt)))).toBe(true);
  });

  it('65. the guard rejects a STEP 76 result', async () => {
    const result = await orchestrate([statusProvider(ALPHA, 'accepted')]);
    expect(isTripExecutionOutcomeReceipt(result)).toBe(false);
  });

  it('66. the guard rejects non-receipts', () => {
    for (const value of [null, undefined, 7, 'recorded', [], true, {}]) {
      expect(isTripExecutionOutcomeReceipt(value), JSON.stringify(value) ?? 'undefined').toBe(false);
    }
  });

  it('67. the guard rejects a wrong kind', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, kind: 'receipt' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, kind: undefined })).toBe(false);
  });

  it('68. the guard rejects a wrong receipt id', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, id: 'other-receipt' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, id: `${receipt.id}x` })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, id: undefined })).toBe(false);
    // The id must still derive from the recorded request identity.
    expect(
      isTripExecutionOutcomeReceipt({ ...receipt, requestId: 'trip-execution-provider-request:a:b' })
    ).toBe(false);
  });

  it('69. the guard rejects a broken provider set', async () => {
    const receipt = requireValue(
      receiptFor(await step76For(['accepted', 'rejected'])),
      'two-provider receipt'
    );
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: 'nonsense' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [ALPHA, ALPHA] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [BETA, ALPHA] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, providerIds: [ALPHA] })).toBe(false);
  });

  it('70. the guard rejects a broken executed or status field', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, executed: 'yes' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, status: 'booked' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, status: 'accepted', executed: false })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, reason: 'invented' })).toBe(false);
  });

  it('71. the guard rejects a malformed result entry', async () => {
    const receipt = await validReceipt();
    expect(isTripExecutionOutcomeReceipt({ ...receipt, results: [null] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, results: [7] })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, results: 'accepted' })).toBe(false);
    expect(isTripExecutionOutcomeReceipt({ ...receipt, results: [{ reason: 'executed' }] })).toBe(false);
  });

  it('72. the reason vocabulary is a closed set of bounded tokens', () => {
    expect(TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS).toContain('recorded');
    for (const reason of TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z-]*[a-z]$/);
      // No provider message, URL, credential, or exception text can travel here.
      expect(reason).not.toMatch(/https?:|Error|\s/);
    }
    expect(new Set(TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS).size).toBe(
      TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS.length
    );
  });

  it('73. a receipt records only the STEP 76 outcome, with no new fields', async () => {
    const receipt = await validReceipt();
    expect(Object.keys(receipt).sort()).toEqual([
      'executed',
      'id',
      'kind',
      'providerIds',
      'reason',
      'requestId',
      'results',
      'status',
    ]);
    // And the recorded result is exactly the STEP 75 shape, with no additions.
    expect(Object.keys(receipt.results[0]).sort()).toEqual([
      'executed',
      'providerId',
      'reason',
      'requestId',
      'result',
    ]);
    expect(Object.keys(receipt.results[0].result as object).sort()).toEqual([
      'providerId',
      'requestId',
      'status',
    ]);
  });
});
