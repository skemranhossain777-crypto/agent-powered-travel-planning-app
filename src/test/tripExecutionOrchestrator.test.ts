import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getTripExecutionAggregateStatus,
  orchestrateTripExecution,
  type TripExecutionProviderAggregate,
} from '../services/tripExecution/tripExecutionOrchestrator';
import { mockTripExecutionProvider } from '../services/tripExecution/mockTripExecutionProvider';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  isTripExecutionProviderRequest,
  isTripExecutionProviderResult,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from '../services/tripExecution/tripExecutionProvider';
import {
  createTripExecutionDispatchInstruction,
  type TripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
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
  return createTripPlanningProviderRequest(dispatch);
}

function createTripPlanningProviderRequest(
  dispatch: TripExecutionDispatchInstruction
): TripExecutionProviderRequest {
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

function recordingProvider(
  providerId: string,
  log: string[],
  status: TripExecutionProviderResultStatus = 'accepted'
): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(providerId);
      return Promise.resolve({ providerId, requestId: request.id, status });
    },
  };
}

function throwingProvider(providerId: string, error: Error): TripExecutionProvider {
  return {
    providerId,
    async execute(): Promise<TripExecutionProviderResult> {
      throw error;
    },
  };
}

function rejectingProvider(providerId: string): TripExecutionProvider {
  return {
    providerId,
    async execute(): Promise<TripExecutionProviderResult> {
      return Promise.reject(new Error('synthetic rejection'));
    },
  };
}

function malformedResultProvider(providerId: string): TripExecutionProvider {
  return {
    providerId,
    async execute(): Promise<TripExecutionProviderResult> {
      return { providerId, requestId: 'broken', status: 'superseded' } as never;
    },
  };
}

async function orchestrate(
  providers: ReadonlyArray<TripExecutionProvider>,
  request: TripExecutionProviderRequest = validRequest()
): Promise<TripExecutionProviderAggregate> {
  return orchestrateTripExecution(request, providers);
}

describe('STEP 61 orchestrator: request and provider identity', () => {
  it('1. single mock provider success', async () => {
    const request = validRequest();
    const aggregate = await orchestrate([mockTripExecutionProvider], request);
    expect(aggregate.status).toBe('accepted');
    expect(aggregate.requestId).toBe(request.id);
    expect(aggregate.providerResults).toHaveLength(1);
    expect(aggregate.providerResults[0]).toEqual({
      providerId: 'mock-execution',
      requestId: request.id,
      status: 'accepted',
    });
  });

  it('2. multiple providers', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-alpha', 'accepted'),
      stubProvider('provider-beta', 'unsupported'),
    ]);
    expect(aggregate.providerResults).toHaveLength(2);
  });

  it('3. exact input ordering preserved', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-one', 'rejected'),
      stubProvider('provider-two', 'accepted'),
      stubProvider('provider-three', 'unsupported'),
    ]);
    expect(aggregate.providerResults.map((result) => result.providerId)).toEqual([
      'provider-one',
      'provider-two',
      'provider-three',
    ]);
  });

  it('4. provider attribution preserved', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-x', 'accepted'),
      stubProvider('provider-y', 'failed'),
    ]);
    expect(aggregate.providerResults[0].providerId).toBe('provider-x');
    expect(aggregate.providerResults[1].providerId).toBe('provider-y');
  });

  it('5. request ID preserved through orchestration', async () => {
    const request = validRequest();
    const aggregate = await orchestrate(
      [stubProvider('provider-a', 'accepted'), stubProvider('provider-b', 'rejected')],
      request
    );
    expect(aggregate.requestId).toBe(request.id);
    expect(aggregate.providerResults[0].requestId).toBe(request.id);
    expect(aggregate.providerResults[1].requestId).toBe(request.id);
  });

  it('32. no provider sorting', async () => {
    const unsorted = [
      stubProvider('zzz-last', 'rejected'),
      stubProvider('aaa-first', 'accepted'),
      stubProvider('mmm-middle', 'unsupported'),
    ];
    const aggregate = await orchestrate(unsorted);
    expect(aggregate.providerResults.map((result) => result.providerId)).toEqual([
      'zzz-last',
      'aaa-first',
      'mmm-middle',
    ]);
  });

  it('33. no provider prioritization', async () => {
    const aggregate = await orchestrate([
      stubProvider('first-provider', 'rejected'),
      stubProvider('second-provider', 'accepted'),
    ]);
    expect(aggregate.status).toBe('accepted');
    expect(aggregate.providerResults[0].status).toBe('rejected');
    expect(aggregate.providerResults[1].status).toBe('accepted');
  });

  it('34. no implicit provider selection', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'accepted'),
      stubProvider('provider-b', 'accepted'),
    ]);
    expect(aggregate.providerResults).toHaveLength(2);
    expect(aggregate.providerResults[0].status).toBe('accepted');
    expect(aggregate.providerResults[1].status).toBe('accepted');
  });

  it('35. no deduplication: repeated providers are all preserved', async () => {
    const aggregate = await orchestrate([
      stubProvider('repeated', 'accepted'),
      stubProvider('repeated', 'accepted'),
      stubProvider('repeated', 'accepted'),
    ]);
    expect(aggregate.providerResults).toHaveLength(3);
    expect(aggregate.providerResults.every((result) => result.providerId === 'repeated')).toBe(true);
    expect(JSON.stringify(aggregate.providerResults[0])).toBe(
      JSON.stringify(aggregate.providerResults[2])
    );
  });

  it('36. repeated orchestration is deterministic', async () => {
    const request = validRequest();
    const providers = [
      stubProvider('provider-a', 'accepted'),
      stubProvider('provider-b', 'failed'),
      stubProvider('provider-c', 'unsupported'),
    ];
    const first = await orchestrate(providers, request);
    const again = await orchestrate(providers, request);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('37. input provider array is not mutated', async () => {
    const providers = [
      stubProvider('provider-a', 'accepted'),
      stubProvider('provider-b', 'unsupported'),
    ];
    const snapshot = JSON.stringify(providers);
    await orchestrate(providers);
    expect(JSON.stringify(providers)).toBe(snapshot);
  });

  it('38. request is not mutated', async () => {
    const request = validRequest();
    const snapshot = JSON.stringify(request);
    await orchestrate([mockTripExecutionProvider], request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});

describe('STEP 61 orchestrator: aggregation rules', () => {
  it('6. accepted aggregation', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'accepted'),
      stubProvider('provider-b', 'failed'),
      stubProvider('provider-c', 'unsupported'),
    ]);
    expect(aggregate.status).toBe('accepted');
  });

  it('7. rejected aggregation', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'rejected'),
      stubProvider('provider-b', 'failed'),
    ]);
    expect(aggregate.status).toBe('rejected');
  });

  it('8. failed aggregation', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'failed'),
      stubProvider('provider-b', 'unsupported'),
    ]);
    expect(aggregate.status).toBe('failed');
  });

  it('9. unsupported aggregation', async () => {
    const aggregate = await orchestrate([stubProvider('provider-a', 'unsupported')]);
    expect(aggregate.status).toBe('unsupported');
  });

  it('10. empty provider list yields unsupported', async () => {
    const request = validRequest();
    const aggregate = await orchestrate([], request);
    expect(aggregate.status).toBe('unsupported');
    expect(aggregate.providerResults).toHaveLength(0);
    expect(aggregate.requestId).toBe(request.id);
  });

  it('11. accepted plus rejected is accepted', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'rejected'),
      stubProvider('provider-b', 'accepted'),
    ]);
    expect(aggregate.status).toBe('accepted');
  });

  it('12. accepted plus failed is accepted', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'failed'),
      stubProvider('provider-b', 'accepted'),
    ]);
    expect(aggregate.status).toBe('accepted');
  });

  it('13. accepted plus unsupported is accepted', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'unsupported'),
      stubProvider('provider-b', 'accepted'),
    ]);
    expect(aggregate.status).toBe('accepted');
  });

  it('14. rejected plus failed is rejected', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'failed'),
      stubProvider('provider-b', 'rejected'),
    ]);
    expect(aggregate.status).toBe('rejected');
  });

  it('15. rejected plus unsupported is rejected', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'unsupported'),
      stubProvider('provider-b', 'rejected'),
    ]);
    expect(aggregate.status).toBe('rejected');
  });

  it('16. failed plus unsupported is failed', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'unsupported'),
      stubProvider('provider-b', 'failed'),
    ]);
    expect(aggregate.status).toBe('failed');
  });

  it('17. all rejected is rejected', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'rejected'),
      stubProvider('provider-b', 'rejected'),
    ]);
    expect(aggregate.status).toBe('rejected');
  });

  it('18. all failed is failed', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'failed'),
      stubProvider('provider-b', 'failed'),
    ]);
    expect(aggregate.status).toBe('failed');
  });

  it('19. all unsupported is unsupported', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'unsupported'),
      stubProvider('provider-b', 'unsupported'),
    ]);
    expect(aggregate.status).toBe('unsupported');
  });

  it('20. mixed all-status input is accepted', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-accepted', 'accepted'),
      stubProvider('provider-rejected', 'rejected'),
      stubProvider('provider-failed', 'failed'),
      stubProvider('provider-unsupported', 'unsupported'),
    ]);
    expect(aggregate.status).toBe('accepted');
    expect(aggregate.providerResults.map((result) => result.providerId)).toEqual([
      'provider-accepted',
      'provider-rejected',
      'provider-failed',
      'provider-unsupported',
    ]);
  });

  it('decision table empty list via helper', () => {
    expect(getTripExecutionAggregateStatus([])).toBe('unsupported');
  });
});

describe('STEP 61 orchestrator: failure isolation', () => {
  it('21. provider failure does not stop later providers', async () => {
    const log: string[] = [];
    const aggregate = await orchestrate([
      throwingProvider('provider-boom', new Error('kaboom')),
      recordingProvider('provider-next', log),
      recordingProvider('provider-last', log),
    ]);
    expect(log).toEqual(['provider-next', 'provider-last']);
    expect(aggregate.providerResults).toHaveLength(3);
    expect(aggregate.providerResults[0]).toEqual({
      providerId: 'provider-boom',
      requestId: validRequest().id,
      status: 'failed',
    });
    expect(aggregate.providerResults[1]).toEqual({
      providerId: 'provider-next',
      requestId: validRequest().id,
      status: 'accepted',
    });
  });

  it('22. thrown provider error becomes failed', async () => {
    const aggregate = await orchestrate([throwingProvider('provider-meltdown', new Error('boom'))]);
    expect(aggregate.providerResults[0].status).toBe('failed');
    expect(aggregate.providerResults[0].providerId).toBe('provider-meltdown');
    expect(aggregate.providerResults[0].requestId).toBe(validRequest().id);
  });

  it('23. rejected promise becomes failed', async () => {
    const aggregate = await orchestrate([
      rejectingProvider('provider-reject'),
      stubProvider('provider-ok', 'accepted'),
    ]);
    expect(aggregate.providerResults[0].status).toBe('failed');
    expect(aggregate.providerResults[0].providerId).toBe('provider-reject');
    expect(aggregate.providerResults[1].status).toBe('accepted');
    expect(aggregate.status).toBe('accepted');
  });

  it('24. raw exception message does not escape', async () => {
    const secretMessage = 'SECRET-INTERNAL-EXPLOSION-9988';
    const aggregate = await orchestrate([throwingProvider('provider-boom', new Error(secretMessage))]);
    const serialized = JSON.stringify(aggregate);
    expect(serialized.includes(secretMessage)).toBe(false);
    expect(Object.keys(aggregate.providerResults[0]).sort()).toEqual([
      'providerId',
      'requestId',
      'status',
    ]);
  });

  it('25. stack trace does not escape', async () => {
    const error = new Error('boom');
    const aggregate = await orchestrate([throwingProvider('provider-boom', error)]);
    expect(aggregate.providerResults[0]).not.toHaveProperty('stack');
    expect(JSON.stringify(aggregate).toLowerCase().includes('at object.')).toBe(false);
    expect(isTripExecutionProviderResult(aggregate.providerResults[0])).toBe(true);
  });
});

describe('STEP 61 orchestrator: validation boundaries', () => {
  it('26. malformed request is rejected before any provider invocation', async () => {
    const log: string[] = [];
    const malformed = {
      id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}stray`,
      kind: 'trip-execution-provider-request',
      dispatchId: 'trip-execution-dispatch:stray',
    };
    expect(isTripExecutionProviderRequest(malformed)).toBe(false);
    const aggregate = await orchestrateTripExecution(malformed as never, [
      recordingProvider('provider-never', log),
    ]);
    expect(aggregate.status).toBe('rejected');
    expect(aggregate.providerResults).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it('26b. malformed request rejects before invocation and echoes a usable id', async () => {
    const malformed = {
      id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}stray`,
      kind: 'wrong-kind',
      dispatchId: 'trip-execution-dispatch:stray',
    };
    const aggregate = await orchestrateTripExecution(malformed as never, []);
    expect(aggregate.status).toBe('rejected');
    expect(aggregate.requestId).toBe(malformed.id);
  });

  it('26c. malformed request with no usable id uses the deterministic placeholder', async () => {
    const aggregate = await orchestrateTripExecution({ id: 'nonsense' } as never, []);
    expect(aggregate.status).toBe('rejected');
    expect(aggregate.requestId).toBe(`${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`);
  });

  it('27. provider result validator is enforced', async () => {
    const aggregate = await orchestrate([malformedResultProvider('provider-bad')]);
    expect(aggregate.providerResults[0].status).toBe('failed');
    expect(aggregate.providerResults[0].providerId).toBe('provider-bad');
    expect(aggregate.providerResults[0].requestId).toBe(validRequest().id);
  });

  it('28. malformed provider result becomes failed and passes the result validator', async () => {
    const aggregate = await orchestrate([
      malformedResultProvider('provider-bad'),
      stubProvider('provider-good', 'unsupported'),
    ]);
    expect(aggregate.providerResults[0].status).toBe('failed');
    expect(isTripExecutionProviderResult(aggregate.providerResults[0])).toBe(true);
    expect(aggregate.providerResults[1].status).toBe('unsupported');
  });

  it('29. malformed provider does not corrupt other results', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'accepted'),
      null as never,
      stubProvider('provider-c', 'unsupported'),
    ]);
    expect(aggregate.providerResults).toHaveLength(3);
    expect(aggregate.providerResults[0]).toEqual({
      providerId: 'provider-a',
      requestId: validRequest().id,
      status: 'accepted',
    });
    expect(aggregate.providerResults[1].status).toBe('failed');
    expect(aggregate.providerResults[2]).toEqual({
      providerId: 'provider-c',
      requestId: validRequest().id,
      status: 'unsupported',
    });
    expect(aggregate.status).toBe('accepted');
  });

  it('30. invalid provider identity handled safely', async () => {
    const request = validRequest();
    const invalidProviders = [null, 'plain-string', 42, {}, []];
    for (const provider of invalidProviders) {
      const aggregate = await orchestrate([provider as never], request);
      expect(aggregate.providerResults).toHaveLength(1);
      expect(aggregate.providerResults[0]).toEqual({
        providerId: 'unknown-execution-provider',
        requestId: request.id,
        status: 'failed',
      });
      expect(isTripExecutionProviderResult(aggregate.providerResults[0])).toBe(true);
    }
  });

  it('30b. unsafe provider id value is replaced by the deterministic fallback', async () => {
    const request = validRequest();
    const unsafeIds = [
      { providerId: '  spaced  ', execute: async () => ({ status: 'accepted' }) },
      { providerId: '', execute: async () => ({ status: 'accepted' }) },
      { providerId: 'a'.repeat(120), execute: async () => ({ status: 'accepted' }) },
    ];
    for (const provider of unsafeIds) {
      const aggregate = await orchestrate([provider as never], request);
      expect(aggregate.providerResults[0]).toEqual({
        providerId: 'unknown-execution-provider',
        requestId: request.id,
        status: 'failed',
      });
    }
  });

  it('30c. safe provider id is preserved even when execute is missing', async () => {
    const request = validRequest();
    const incomplete = { providerId: 'declared-executor', execute: 'not-a-function' };
    const aggregate = await orchestrate([incomplete as never], request);
    expect(aggregate.providerResults[0].providerId).toBe('declared-executor');
    expect(aggregate.providerResults[0].status).toBe('failed');
  });

  it('31. no silent provider replacement', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-first', 'accepted'),
      null as never,
      stubProvider('provider-last', 'accepted'),
    ]);
    expect(aggregate.providerResults[1]).toEqual({
      providerId: 'unknown-execution-provider',
      requestId: validRequest().id,
      status: 'failed',
    });
    expect(aggregate.providerResults.map((result) => result.providerId)).toEqual([
      'provider-first',
      'unknown-execution-provider',
      'provider-last',
    ]);
  });
});

describe('STEP 61 orchestrator: module boundary and determinism', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionOrchestrator.ts'),
    'utf8'
  );

  it('imports only the shared identity bound and the STEP 59 contract', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionProvider',
    ]);
  });

  it('39. no persistence and no Firestore', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getFirestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage|asyncStorage/i);
  });

  it('40. no network and no HTTP clients', () => {
    expect(source).not.toMatch(/fetch\s*\(|axios|new\s+WebSocket|XMLHttpRequest/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiKey|httpMethod/i);
  });

  it('41. no booking behavior', () => {
    expect(source).not.toMatch(/createBooking|submit-booking|prepare-booking|bookingRef/i);
    expect(source).not.toMatch(/reservationId|ticketNumber|confirmationCode/i);
  });

  it('42. no payment behavior', () => {
    expect(source).not.toMatch(/charge|payment-intent|checkout|paymentMethod|\bstripe\b|refund/i);
    expect(source).not.toMatch(/invoice|paid|amount|currency|price/i);
  });

  it('43. no Google dependency', () => {
    expect(source).not.toMatch(/googlePlaces|googleRoutes|googleDiscovery|googlePlacesService/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(googleRoutes|googlePlaces)/i);
  });

  it('44. no Amadeus dependency', () => {
    expect(source).not.toMatch(/amadeus|realDiscovery/i);
  });

  it('45. no AI dependency', () => {
    expect(source).not.toMatch(/gemini|aiPlanningService|generativeLanguage|aiTravelAgent/i);
  });

  it('46. no environment dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env|\benv\s*\(/i);
  });

  it('47. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(|new\s+Date\(/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime|setTimeout|setInterval/i);
  });

  it('48. no randomness', () => {
    expect(source).not.toMatch(/Math\.random|crypto\.randomUUID|\buuid\b/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\.|globalThis/i);
  });

  it('49. no global mutable execution state', () => {
    expect(source).not.toMatch(/let\s+\w+\s*=\s*0|var\s+\w+\s*=\s*0/i);
    expect(source).not.toMatch(/useState\(|setState\(|moduleScope/i);
    expect(source).not.toMatch(/increment\(|\+\+|\bcounters?\b/i);
  });

  it('50. no new lifecycle statuses', () => {
    expect(source).not.toMatch(/executing|pending-execution|completed|cancelled|refunded/i);
    expect(source).not.toMatch(/\bbooked\b|\bexecuted\b|executionStatus|markApply/i);
  });

  it('no provider registration, selection, or orchestration of discovery', () => {
    expect(source).not.toMatch(/registerProvider|providerRegistry|dependencyInjector/i);
    expect(source).not.toMatch(/selectProvider|discoverProviders|orchestrateDiscovery/i);
    expect(source).not.toMatch(/retry|backoff|deadLetter|rollback|compensa/i);
  });

  it('no credentials, secrets, tokens, or URLs', () => {
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|Bearer\s|x-goog-api-key/i);
    expect(source).not.toMatch(/providerUrl|externalRef|authorizationHeader/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.?[\\/](components|pages)/i);
  });

  it('no external side effects: aggregate results are plain provider results only', async () => {
    const aggregate = await orchestrate([
      stubProvider('provider-a', 'accepted'),
      stubProvider('provider-b', 'failed'),
    ]);
    expect(Object.keys(aggregate).sort()).toEqual(['providerResults', 'requestId', 'status']);
    expect(
      aggregate.providerResults.every((result) =>
        JSON.stringify(Object.keys(result).sort()) === JSON.stringify(['providerId', 'requestId', 'status'])
      )
    ).toBe(true);
  });
});