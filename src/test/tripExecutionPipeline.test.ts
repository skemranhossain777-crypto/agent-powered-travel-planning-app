import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  executeTripExecutionPipeline,
  type TripExecutionPipelineResult,
} from '../services/tripExecution/tripExecutionPipeline';
import { mockTripExecutionProvider } from '../services/tripExecution/mockTripExecutionProvider';
import { orchestrateTripExecution } from '../services/tripExecution/tripExecutionOrchestrator';
import {
  isTripExecutionPlan,
  createTripExecutionPlan,
} from '../services/tripExecution/tripExecutionPlan';
import { isTripExecutionPlanBinding } from '../services/tripExecution/tripExecutionPlanBinding';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_RESULT_STATUSES,
  isTripExecutionProviderResult,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from '../services/tripExecution/tripExecutionProvider';
import type { TripExecutionCapabilityProvider } from '../services/tripExecution/tripExecutionCapability';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };

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

function validRequest(tripId = 'trip-abc'): TripExecutionProviderRequest {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  const proposal = createTripPlanningCompositionProposal(composition);
  if (proposal === null) throw new Error('test setup: proposal missing');
  const approved = approveTripPlanningCompositionProposal(proposal);
  const application = createTripPlanningApplication(approved as never);
  if (application === null) throw new Error('test setup: application missing');
  const target = createTripPlanningApplicationTarget({ scope: 'trip', tripId });
  if (target === null) throw new Error('test setup: target missing');
  const binding = createTripPlanningApplicationBinding(application, target);
  if (binding === null) throw new Error('test setup: binding missing');
  const intent = createTripPlanningExecutionIntent(binding);
  if (intent === null) throw new Error('test setup: intent missing');
  const executionRequest = createTripPlanningExecutionRequest(intent);
  if (executionRequest === null) throw new Error('test setup: execution request missing');
  const authorization = createTripPlanningExecutionAuthorization(executionRequest);
  if (authorization === null) throw new Error('test setup: authorization missing');
  const dispatch = createTripExecutionDispatchInstruction(authorization);
  if (dispatch === null) throw new Error('test setup: dispatch missing');
  return {
    id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`,
    kind: 'trip-execution-provider-request',
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

function stubProvider(
  providerId: string,
  status: TripExecutionProviderResultStatus
): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      return Promise.resolve({ providerId, requestId: request.id, status });
    },
  };
}

function capabilityProvider(
  providerId: string,
  verdict: boolean,
  log: string[]
): TripExecutionCapabilityProvider {
  return {
    providerId,
    supports(): boolean {
      log.push(`supports:${providerId}`);
      return verdict;
    },
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  };
}

function recordingProvider(
  providerId: string,
  log: string[],
  status: TripExecutionProviderResultStatus = 'accepted'
): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status });
    },
  };
}

function throwingProvider(providerId: string): TripExecutionProvider {
  return {
    providerId,
    async execute(): Promise<TripExecutionProviderResult> {
      throw new Error(`synthetic failure from ${providerId}`);
    },
  };
}

async function runPipeline(
  providers: ReadonlyArray<TripExecutionProvider>,
  request: TripExecutionProviderRequest = validRequest()
): Promise<TripExecutionPipelineResult | null> {
  return executeTripExecutionPipeline(request, providers);
}

describe('STEP 65 pipeline: composition and structure', () => {
  it('1. valid single provider produces a composed pipeline result', async () => {
    const result = await runPipeline([mockTripExecutionProvider]);
    expect(result).not.toBeNull();
    expect(result?.plan).not.toBeUndefined();
    expect(result?.binding).not.toBeUndefined();
    expect(result?.providerResults).toHaveLength(1);
  });

  it('2. multiple providers all appear in providerResults', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('pipeline-alpha', true, log),
      capabilityProvider('pipeline-beta', true, log),
    ]);
    expect(result?.providerResults).toHaveLength(2);
  });

  it('3. plan contains the eligible provider ids in caller order', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('first-eligible', true, log),
      capabilityProvider('second-eligible', true, log),
    ]);
    expect(result?.plan.providerIds).toEqual(['first-eligible', 'second-eligible']);
  });

  it('4. binding provider ids exactly equal the plan provider ids', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('bind-alpha', true, log),
      capabilityProvider('bind-beta', true, log),
    ]);
    expect(result?.binding.providerIds).toEqual(result?.plan.providerIds);
    expect(result?.binding.planId).toBe(result?.plan.id);
    expect(result?.binding.requestId).toBe(result?.plan.requestId);
  });

  it('5. provider order is preserved end-to-end', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('order-first', true, log),
      capabilityProvider('order-second', true, log),
      capabilityProvider('order-third', true, log),
    ]);
    expect(result?.providerResults.map((entry) => entry.providerId)).toEqual([
      'order-first',
      'order-second',
      'order-third',
    ]);
  });

  it('6. provider execution happens only as part of orchestration after planning', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('stage-aware', true, log),
      recordingProvider('stage-plain', log),
    ]);
    expect(result).not.toBeNull();
    const supportsEntries = log.filter((entry) => entry.startsWith('supports:'));
    const executeEntries = log.filter((entry) => entry.startsWith('execute:'));
    expect(supportsEntries.length).toBeGreaterThan(0);
    expect(executeEntries).toEqual(['execute:stage-aware', 'execute:stage-plain']);
    const lastSupportIndex = log
      .map((entry, index) => (entry.startsWith('supports:') ? index : -1))
      .reduce((max, index) => Math.max(max, index), -1);
    const firstExecuteIndex = log.indexOf('execute:stage-aware');
    expect(firstExecuteIndex).toBeGreaterThan(lastSupportIndex);
  });

  it('7. every provider result preserves the provider request id', async () => {
    const request = validRequest();
    const log: string[] = [];
    const result = await runPipeline(
      [capabilityProvider('id-alpha', true, log), recordingProvider('id-beta', log)],
      request
    );
    for (const providerResult of result?.providerResults ?? []) {
      expect(providerResult.requestId).toBe(request.id);
    }
  });

  it('8. provider results are attributed to the exact plan provider ids', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('attrib-alpha', true, log),
      capabilityProvider('attrib-beta', true, log),
    ]);
    result?.providerResults.forEach((providerResult, index) => {
      expect(providerResult.providerId).toBe(result.plan.providerIds[index]);
    });
  });

  it('9. an accepted provider yields the accepted aggregate', async () => {
    const result = await runPipeline([mockTripExecutionProvider]);
    expect(result?.aggregateStatus).toBe('accepted');
  });

  it('22. aggregate status is delegated to the STEP 61 orchestrator', async () => {
    const request = validRequest();
    const providers = [
      stubProvider('delegated-alpha', 'accepted'),
      stubProvider('delegated-beta', 'failed'),
    ];
    const result = await runPipeline(providers, request);
    const direct = await orchestrateTripExecution(request, providers);
    expect(result?.aggregateStatus).toBe(direct.status);
    expect(result?.providerResults).toEqual(direct.providerResults);
  });

  it('26. the provider request is not mutated', async () => {
    const request = validRequest();
    const snapshot = JSON.stringify(request);
    await runPipeline([mockTripExecutionProvider], request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });

  it('24. capability evaluation never invokes a provider execute method', async () => {
    const log: string[] = [];
    const request = validRequest();

    const plan = createTripExecutionPlan(request, [
      capabilityProvider('capability-only-alpha', true, log),
      capabilityProvider('capability-only-beta', false, log),
    ]);

    expect(plan?.providerIds).toEqual(['capability-only-alpha']);
    expect(log).toEqual(['supports:capability-only-alpha', 'supports:capability-only-beta']);
    expect(log.some((entry) => entry.startsWith('execute:'))).toBe(false);
  });

  it('27. the caller provider array is not reordered or otherwise mutated', async () => {
    const log: string[] = [];
    const providers = [
      capabilityProvider('order-guard-first', true, log),
      capabilityProvider('order-guard-second', true, log),
      capabilityProvider('order-guard-third', true, log),
    ];
    const orderBefore = providers.map((entry) => entry.providerId);
    const objectBefore = [...providers];
    const lengthBefore = providers.length;
    const snapshot = JSON.stringify(providers);

    const result = await runPipeline(providers);

    expect(result?.providerResults.map((entry) => entry.providerId)).toEqual(orderBefore);
    expect(providers.map((entry) => entry.providerId)).toEqual(orderBefore);
    expect(providers.length).toBe(lengthBefore);
    expect(JSON.stringify(providers)).toBe(snapshot);
    providers.forEach((entry, index) => {
      expect(Object.is(entry, objectBefore[index])).toBe(true);
    });
  });

  it('28. provider objects are never mutated (frozen providers survive the run)', async () => {
    const log: string[] = [];
    const frozen = Object.freeze(
      Object.freeze({
        providerId: 'frozen-provider',
        supports(): boolean {
          return true;
        },
        async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
          log.push('execute:frozen-provider');
          return Promise.resolve({
            providerId: 'frozen-provider',
            requestId: request.id,
            status: 'accepted',
          });
        },
      })
    );
    const before = Object.keys(frozen).sort();

    const result = await runPipeline([frozen]);

    expect(result?.aggregateStatus).toBe('accepted');
    expect(Object.keys(frozen).sort()).toEqual(before);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(frozen, 'providerId')?.writable).toBe(false);
    expect(frozen.providerId).toBe('frozen-provider');
  });

  it('28. composed artifacts are fresh values', async () => {
    const result = await runPipeline([mockTripExecutionProvider]);
    expect(result?.plan).not.toBe(result?.binding);
    expect(Object.keys(result as NonNullable<TripExecutionPipelineResult>).sort()).toEqual([
      'aggregateStatus',
      'binding',
      'plan',
      'providerResults',
    ]);
  });

  it('29. pipeline execution is deterministic', async () => {
    const log: string[] = [];
    const providers = [capabilityProvider('deterministic-a', true, log)];
    const first = await runPipeline(providers);
    const second = await runPipeline(providers);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('30. composed result survives a JSON round-trip', async () => {
    const result = await runPipeline([mockTripExecutionProvider]);
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(isTripExecutionPlan(roundTripped.plan)).toBe(true);
    expect(isTripExecutionPlanBinding(roundTripped.binding)).toBe(true);
    for (const providerResult of roundTripped.providerResults) {
      expect(isTripExecutionProviderResult(providerResult)).toBe(true);
    }
  });
});

describe('STEP 65 pipeline: fail-closed and status behavior', () => {
  it('10. empty provider list produces an empty plan and unsupported aggregate', async () => {
    const result = await runPipeline([]);
    expect(result?.plan.providerIds).toEqual([]);
    expect(result?.binding.providerIds).toEqual([]);
    expect(result?.providerResults).toEqual([]);
    expect(result?.aggregateStatus).toBe('unsupported');
  });

  it('11. no eligible providers produces an empty plan and unsupported aggregate', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('never-eligible', false, log),
      capabilityProvider('never-eligible-again', false, log),
    ]);
    expect(result?.plan.providerIds).toEqual([]);
    expect(result?.binding.providerIds).toEqual([]);
    expect(result?.providerResults).toEqual([]);
    expect(log.every((entry) => !entry.startsWith('execute:'))).toBe(true);
  });

  it('12. unsupported remains a valid aggregate outcome', async () => {
    const log: string[] = [];
    const result = await runPipeline([capabilityProvider('unsupported-capable', false, log)]);
    expect(result?.aggregateStatus).toBe('unsupported');
  });

  it('13. malformed request yields null', async () => {
    expect(await runPipeline([mockTripExecutionProvider], { id: 'broken' } as never)).toBeNull();
    expect(await runPipeline([mockTripExecutionProvider], null as never)).toBeNull();
  });

  it('14. malformed request never executes a provider', async () => {
    const log: string[] = [];
    const request = validRequest();
    const tampered = { ...request, kind: 'trip-execution-provider-request-tampered' };
    const result = await runPipeline([recordingProvider('never-runs', log)], tampered as never);
    expect(result).toBeNull();
    expect(log.filter((entry) => entry.startsWith('execute:'))).toEqual([]);
  });

  it('15. capability rejection prevents that provider from executing', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('accepted-one', true, log),
      capabilityProvider('rejected-one', false, log),
    ]);
    expect(result?.providerResults.map((entry) => entry.providerId)).toEqual(['accepted-one']);
    expect(log.includes('execute:rejected-one')).toBe(false);
  });

  it('16. binding mismatch (duplicate eligible identity) yields null without execution', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('duplicated-id', true, log),
      capabilityProvider('duplicated-id', true, log),
    ]);
    expect(result).toBeNull();
    expect(log.filter((entry) => entry.startsWith('execute:'))).toEqual([]);
  });

  it('17. a rejected provider yields the rejected aggregate and keeps its result', async () => {
    const result = await runPipeline([stubProvider('rejected-provider', 'rejected')]);
    expect(result?.providerResults[0].status).toBe('rejected');
    expect(result?.aggregateStatus).toBe('rejected');
  });

  it('18. a failed provider yields the failed aggregate', async () => {
    const result = await runPipeline([stubProvider('failed-provider', 'failed')]);
    expect(result?.providerResults[0].status).toBe('failed');
    expect(result?.aggregateStatus).toBe('failed');
  });

  it('19. a throwing provider becomes a failed result and never escapes', async () => {
    const result = await runPipeline([throwingProvider('throwing-provider')]);
    expect(result?.providerResults[0]).toEqual({
      providerId: 'throwing-provider',
      requestId: result?.plan.requestId,
      status: 'failed',
    });
    expect(result?.aggregateStatus).toBe('failed');
  });

  it('20. later providers still execute after an earlier provider fails', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      throwingProvider('boom-provider'),
      recordingProvider('after-boom', log),
    ]);
    expect(result?.providerResults.map((entry) => entry.status)).toEqual(['failed', 'accepted']);
    expect(result?.aggregateStatus).toBe('accepted');
    expect(log).toEqual(['execute:after-boom']);
  });

  it('21. every provider result is preserved verbatim in plan order', async () => {
    const result = await runPipeline([
      stubProvider('mix-alpha', 'rejected'),
      stubProvider('mix-beta', 'unsupported'),
      stubProvider('mix-gamma', 'failed'),
    ]);
    expect(result?.providerResults.map((entry) => entry.status)).toEqual([
      'rejected',
      'unsupported',
      'failed',
    ]);
  });

  it('56. no provider outside the plan is ever executed', async () => {
    const log: string[] = [];
    const result = await runPipeline([
      capabilityProvider('in-plan-a', true, log),
      capabilityProvider('in-plan-b', true, log),
      capabilityProvider('not-selected', false, log),
    ]);
    expect(result?.providerResults.map((entry) => entry.providerId)).toEqual([
      'in-plan-a',
      'in-plan-b',
    ]);
    expect(log).toEqual([
      'supports:in-plan-a',
      'supports:in-plan-b',
      'supports:not-selected',
      'execute:in-plan-a',
      'execute:in-plan-b',
    ]);
  });

  it('64. the STEP 60 mock provider runs through the full pipeline', async () => {
    const request = validRequest();
    const result = await runPipeline([mockTripExecutionProvider], request);
    expect(result?.plan.providerIds).toEqual(['mock-execution']);
    expect(result?.binding.providerIds).toEqual(['mock-execution']);
    expect(result?.binding.planId).toBe(result?.plan.id);
    expect(result?.providerResults).toEqual([
      { providerId: 'mock-execution', requestId: request.id, status: 'accepted' },
    ]);
    expect(result?.providerResults[0].requestId).toBe(request.id);
    expect(result?.aggregateStatus).toBe('accepted');
  });

  it('65. complete end-to-end accepted path', async () => {
    const request = validRequest();
    const log: string[] = [];
    const result = await runPipeline(
      [capabilityProvider('e2e-first', true, log), mockTripExecutionProvider],
      request
    );
    expect(result?.plan.providerIds).toEqual(['e2e-first', 'mock-execution']);
    expect(result?.binding.providerIds).toEqual(['e2e-first', 'mock-execution']);
    expect(result?.providerResults.map((entry) => entry.status)).toEqual(['accepted', 'accepted']);
    expect(result?.aggregateStatus).toBe('accepted');
    expect(log.filter((entry) => entry.startsWith('execute:'))).toEqual(['execute:e2e-first']);
  });

  it('non-array provider list yields null', async () => {
    const result = await executeTripExecutionPipeline(validRequest(), null as never);
    expect(result).toBeNull();
  });

  it('a malformed provider array element never throws and never executes', async () => {
    const log: string[] = [];
    const request = validRequest();

    const onlyMalformed = await executeTripExecutionPipeline(request, [null] as never);
    expect(onlyMalformed).not.toBeNull();
    expect(onlyMalformed?.plan.providerIds).toEqual([]);
    expect(onlyMalformed?.binding.providerIds).toEqual([]);
    expect(onlyMalformed?.providerResults).toEqual([]);
    expect(onlyMalformed?.aggregateStatus).toBe('unsupported');

    const mixed = await executeTripExecutionPipeline(request, [
      mockTripExecutionProvider,
      null,
      'not-a-provider',
      42,
    ] as never);
    expect(mixed?.plan.providerIds).toEqual(['mock-execution']);
    expect(mixed?.binding.providerIds).toEqual(['mock-execution']);
    expect(mixed?.providerResults).toEqual([
      { providerId: 'mock-execution', requestId: request.id, status: 'accepted' },
    ]);
    expect(mixed?.aggregateStatus).toBe('accepted');
    expect(log.filter((entry) => entry.startsWith('execute:'))).toEqual([]);
  });

  it('execution-only providers (no capability) are eligible and run', async () => {
    const log: string[] = [];
    const result = await runPipeline([recordingProvider('exec-only-a', log)]);
    expect(result?.plan.providerIds).toEqual(['exec-only-a']);
    expect(result?.providerResults.map((entry) => entry.providerId)).toEqual(['exec-only-a']);
  });

  it('boundary orders mix capability-aware and execution-only providers in caller order', async () => {
    const log: string[] = [];
    const sorted = await runPipeline([
      capabilityProvider('cap-first', true, log),
      recordingProvider('plain-second', log),
      capabilityProvider('cap-third', true, log),
    ]);
    expect(sorted?.providerResults.map((entry) => entry.providerId)).toEqual([
      'cap-first',
      'plain-second',
      'cap-third',
    ]);
  });

  it('aggregate and provider statuses stay within the STEP 59 vocabulary', async () => {
    const result = await runPipeline([
      stubProvider('vocab-a', 'accepted'),
      stubProvider('vocab-b', 'failed'),
    ]);
    for (const providerResult of result?.providerResults ?? []) {
      expect(TRIP_EXECUTION_PROVIDER_RESULT_STATUSES).toContain(providerResult.status);
    }
    expect(TRIP_EXECUTION_PROVIDER_RESULT_STATUSES).toContain(result?.aggregateStatus);
  });

  it('the composed result carries no booking or payment fields', async () => {
    const result = await runPipeline([mockTripExecutionProvider]);
    expect(result).not.toHaveProperty('booking');
    expect(result).not.toHaveProperty('payment');
    expect(result).not.toHaveProperty('confirmation');
    expect((result?.providerResults ?? []).every((entry) => !('pnr' in entry))).toBe(true);
  });
});

describe('STEP 65 pipeline: composed result carries no commercial or secret data', () => {
  const FORBIDDEN_RESULT_KEYS = [
    'booking',
    'bookings',
    'bookingId',
    'reservation',
    'reservations',
    'reservationId',
    'ticket',
    'tickets',
    'ticketNumber',
    'pnr',
    'confirmation',
    'confirmationCode',
    'payment',
    'payments',
    'paymentId',
    'price',
    'prices',
    'amount',
    'currency',
    'fare',
    'fee',
    'invoice',
    'refund',
    'inventory',
    'availability',
    'seat',
    'credential',
    'credentials',
    'secret',
    'secrets',
    'token',
    'tokens',
    'accessToken',
    'refreshToken',
    'apiKey',
    'authorization',
    'url',
    'urls',
    'endpoint',
    'baseUrl',
    'providerUrl',
  ] as const;

  function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) {
      for (const entry of value) collectKeys(entry, acc);
      return acc;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        acc.add(key);
        collectKeys(entry, acc);
      }
    }
    return acc;
  }

  async function composedResult(): Promise<NonNullable<TripExecutionPipelineResult>> {
    const log: string[] = [];
    const result = await runPipeline([
      mockTripExecutionProvider,
      capabilityProvider('scan-alpha', true, log),
    ]);
    expect(result).not.toBeNull();
    return result as NonNullable<TripExecutionPipelineResult>;
  }

  function expectNoKeys(keys: Set<string>, forbidden: ReadonlyArray<string>): void {
    for (const key of keys) {
      for (const candidate of forbidden) {
        expect(key.toLowerCase().includes(candidate.toLowerCase())).toBe(false);
      }
    }
  }

  it('the composed result exposes only the four contract fields at every level', async () => {
    const result = await composedResult();
    const keys = [...collectKeys(result)].sort();
    expect(keys).toEqual([
      'aggregateStatus',
      'binding',
      'id',
      'kind',
      'plan',
      'planId',
      'providerId',
      'providerIds',
      'providerResults',
      'requestId',
      'status',
    ]);
  });

  it('31. no booking data', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['booking', 'confirmation', 'pnr']);
  });

  it('32. no payment data', async () => {
    expectNoKeys(collectKeys(await composedResult()), [
      'payment',
      'price',
      'amount',
      'currency',
      'fare',
      'fee',
      'invoice',
      'refund',
    ]);
  });

  it('33. no ticket data', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['ticket']);
  });

  it('34. no reservation data', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['reservation', 'pnr']);
  });

  it('35. no inventory data', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['inventory', 'availability', 'seat']);
  });

  it('36. no credentials or secrets', async () => {
    expectNoKeys(collectKeys(await composedResult()), [
      'credential',
      'secret',
      'apiKey',
      'password',
    ]);
  });

  it('37. no tokens', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['token', 'authorization', 'bearer']);
  });

  it('38. no provider URLs or endpoints', async () => {
    expectNoKeys(collectKeys(await composedResult()), ['url', 'endpoint', 'host', 'uri']);
  });

  it('no forbidden result key appears anywhere in the composed result', async () => {
    const result = await composedResult();
    expectNoKeys(collectKeys(result), [...FORBIDDEN_RESULT_KEYS]);
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//i);
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });
});

describe('STEP 65 pipeline module boundary', () => {
  const sourcePath = join(
    process.cwd(),
    'src',
    'services',
    'tripExecution',
    'tripExecutionPipeline.ts'
  );
  const source = readFileSync(sourcePath, 'utf8');
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('60. uses the existing STEP 61 orchestration seam', () => {
    expect(source).toMatch(/from\s+['"]\.\/tripExecutionOrchestrator['"]/);
    expect(source).toMatch(/orchestrateTripExecution\s*\(/);
  });

  it('61. defers eligibility to the STEP 62 boundary via the STEP 63 plan (no own capability logic)', () => {
    expect(source).not.toMatch(/from\s+['"]\.\/tripExecutionCapability['"]/);
    expect(source).not.toMatch(/\.supports\s*\(/);
    expect(source).not.toMatch(/evaluateTripExecutionCapability\s*\(/);
  });

  it('62. uses the existing STEP 63 plan boundary', () => {
    expect(source).toMatch(/from\s+['"]\.\/tripExecutionPlan['"]/);
    expect(source).toMatch(/createTripExecutionPlan\s*\(/);
  });

  it('63. uses the existing STEP 64 binding boundary', () => {
    expect(source).toMatch(/from\s+['"]\.\/tripExecutionPlanBinding['"]/);
    expect(source).toMatch(/createTripExecutionPlanBinding\s*\(/);
    expect(source).toMatch(/resolveTripExecutionPlanProviders\s*\(/);
  });

  it('23. reimplements no STEP 61 aggregate logic', () => {
    expect(source).not.toMatch(/getTripExecutionAggregateStatus/);
    expect(source).not.toMatch(/\bstatus\s*===?\s*['"]/);
    expect(source).not.toMatch(/providerResults\.push\s*\(/);
    expect(source).not.toMatch(/\.some\s*\(/);
  });

  it('imports only the STEP 59-64 composition modules', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual([
      './tripExecutionProvider',
      './tripExecutionPlan',
      './tripExecutionPlanBinding',
      './tripExecutionOrchestrator',
    ]);
  });

  it('never imports or instantiates a concrete provider (stays provider-neutral)', () => {
    expect(source).not.toMatch(/mockTripExecutionProvider/);
    expect(source).not.toMatch(/implements\s+TripExecutionProvider/);
  });

  it('25. never calls a provider execute method directly', () => {
    expect(source).not.toMatch(/\.execute\s*\(/);
  });

  it('41. no Google Places dependency', () => {
    expect(source).not.toMatch(
      /googlePlacesAdapter|googlePlacesService|googlePlacesConnection|googleDiscovery/i
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*googleDiscovery/i);
  });

  it('42. no Google Routes dependency', () => {
    expect(source).not.toMatch(/googleRoutesAdapter|googleRoutesService|googleRoutesConnection/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*googleRoutes/i);
  });

  it('43. no Amadeus dependency', () => {
    expect(source).not.toMatch(/amadeusAdapter|amadeusConnection|amadeusConfig|amadeusMapping/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(realDiscovery|amadeus)/i);
  });

  it('44. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('40. no Firebase dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/getFirestore|getAuth|initializeApp/i);
  });

  it('49. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/i);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore/i);
  });

  it('39. no network dependency', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiEndpoint|httpMethod/i);
  });

  it('46. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('45. no environment dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
    expect(source).not.toMatch(/localStorage|sessionStorage|navigator\.|window\.|document\./);
  });

  it('47. no randomness or entropy source', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|geolocation/i);
  });

  it('48. no global mutable state', () => {
    expect(source).not.toMatch(/globalThis|window\.|global\./);
    expect(source).not.toMatch(/static\s+\w+\s*[=:]/);
    expect(source).not.toMatch(/^\s*(let|var)\s+\w/m);
    const topLevelDeclarations = source.split('\n').filter((line) => /^[A-Za-z/]/.test(line));
    for (const line of topLevelDeclarations) {
      expect(line).toMatch(/^(export\s+)?(const|(async\s+)?function|interface|type|import|\/\*)/);
    }
    expect(topLevelDeclarations.length).toBeGreaterThan(0);
  });

  it('36. no credentials, secrets, or API keys in the source', () => {
    expect(source).not.toMatch(/apiKey|x-goog-api-key|Bearer\s/i);
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|authorizationHeader/i);
    expect(source).not.toMatch(/OAuth|AppCheck|getIdToken/i);
  });

  it('37. no tokens in the source code', () => {
    expect(codeOnly).not.toMatch(/token/i);
    expect(codeOnly).not.toMatch(/idToken|authToken|bearer/i);
    expect(codeOnly).not.toMatch(/authorization/i);
  });

  it('38. no provider URLs in the source', () => {
    expect(source).not.toMatch(/https?:\/\//i);
    expect(source).not.toMatch(/providerUrl|baseUrl|endpoint|origin/i);
  });

  it('58. no booking or payment side effects', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking/i);
    expect(source).not.toMatch(
      /refund|charge|payment-intent|checkout|paymentMethod|\bstripe\b|invoice|paid/i
    );
  });

  it('53. no provider selection beyond STEP 63 capability eligibility', () => {
    expect(source).not.toMatch(/selectProvider\(|defaultProvider|providerFactory/i);
    expect(source).not.toMatch(/\.filter\(|\.sort\(|\.reverse\(/);
  });

  it('54. no provider ranking', () => {
    expect(source).not.toMatch(/preferProvider|providerRanking|providerPriority/i);
    expect(source).not.toMatch(/\brank\b|\bpriority\b|\bweight/i);
  });

  it('55. no provider scoring', () => {
    expect(source).not.toMatch(/\bscore\b|\bscoring\b|\bweighting\b|\bheuristic/i);
    expect(source).not.toMatch(/bestProvider|topProvider|optimal/i);
  });

  it('56. no provider discovery', () => {
    expect(source).not.toMatch(/discoverProviders|findProviders|listProviders/i);
    expect(source).not.toMatch(/providerCatalog|providerIndex/i);
  });

  it('57. no provider registration', () => {
    expect(source).not.toMatch(/providerRegistry|registerProvider|addProvider|removeProvider/i);
    expect(source).not.toMatch(/implements\s+TripExecutionProvider/);
  });

  it('59. no direct orchestrator reimplementation', () => {
    const awaitedCallers = [...source.matchAll(/await\s+([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1]
    );
    expect(awaitedCallers).toEqual(['orchestrateTripExecution']);
    expect(codeOnly).not.toMatch(/reduce\s*\(/);
    expect(codeOnly).not.toMatch(/for\s+await/);
  });

  it('no parallel or autonomous orchestration', () => {
    expect(source).not.toMatch(/dispatchAll|parallelDispatch|forkJoin|Promise\.all\(/i);
    expect(source).not.toMatch(/executeAll|runAllProviders/i);
  });

  it('no automatic execution or event wiring', () => {
    expect(source).not.toMatch(/startExecution|beginExecution|fire\(|emit\(/i);
    expect(source).not.toMatch(/system\.on|process\.on|app\.use\(|listen\(/i);
  });

  it('52. no execution-lifecycle mutation or statuses', () => {
    expect(source).not.toMatch(
      /executing|pending-execution|completed|cancelled|refunded|\bbooked\b/i
    );
    expect(source).not.toMatch(/markApply|markApplied|executionStatus|externalRequestId/i);
  });

  it('50. no trip mutation', () => {
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(|setTripStatus|createDraftTrip/i);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('51. no itinerary mutation', () => {
    expect(source).not.toMatch(/updateTripDays|itineraryToTripWorkspace|addDay|removeDay/i);
    expect(source).not.toMatch(/itinerary\.[A-Za-z]+\s*=/);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('no retry, rollback, or compensation logic', () => {
    expect(source).not.toMatch(/retryCount|attempts|backoff|deadLetter/i);
    expect(source).not.toMatch(/rollback|compensa|recoveryQueue/i);
  });
});
