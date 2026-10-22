import { describe, expect, it, vi } from 'vitest';
import {
  createRealExecutionService,
  getRealExecutionProviders,
  mockTripExecutionProvider,
  type RealExecutionServiceOptions,
} from '../services/realExecution/realExecutionService';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  DEFAULT_AMADEUS_EXECUTION_CONFIG,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import type { AmadeusExecutionConnection } from '../services/realExecution/amadeusExecutionConnection';
import { getAdapterOperationalCapabilityIds } from '../domain/providers/providerAdapter';
import { MOCK_TRIP_EXECUTION_PROVIDER_ID } from '../services/tripExecution/mockTripExecutionProvider';
import { executeTripExecutionPipeline } from '../services/tripExecution/tripExecutionPipeline';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import { createTripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import type { TripPlanningReference } from '../types/trip';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';

const SECRET = 'service-level-secret';
const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 4.3522 };

const READY_CONFIG: AmadeusExecutionConfig = {
  attemptEnabled: true,
  credentials: { clientId: 'service-id', clientSecret: SECRET, environment: 'production' },
};

function placeReference(overrides: Record<string, unknown> = {}): TripPlanningReference {
  return {
    id: 'place:service',
    title: 'Service Place',
    kind: 'activity',
    provider: 'Test Provider',
    providerId: 'service-1',
    ...overrides,
  } as TripPlanningReference;
}

/** A fully valid provider-neutral request, built through the real domain chain. */
function validRequest(tripId = 'trip-service-abc'): TripExecutionProviderRequest {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:o', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:d', location: DESTINATION_LOCATION }),
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
    kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

function spyConnection(): { connection: AmadeusExecutionConnection; attempt: ReturnType<typeof vi.fn> } {
  const attempt = vi.fn(() => 'not-implemented' as const);
  return { connection: { implementedOperations: [], attempt }, attempt };
}

describe('STEP 66 real execution service composition', () => {
  it('is disabled by default and needs no arguments to compose', () => {
    const service = createRealExecutionService();
    expect(service.gate).toBe('disabled');
    expect(service.providerIds).toEqual([AMADEUS_EXECUTION_PROVIDER_ID]);
  });

  it('defaults to the always-off, credential-free config', () => {
    expect(createRealExecutionService().gate).toBe('disabled');
    expect(getRealExecutionProviders()).toEqual([expect.objectContaining({ providerId: AMADEUS_EXECUTION_PROVIDER_ID })]);
  });

  it('exposes the Amadeus execution provider as the composed provider', () => {
    const service = createRealExecutionService(READY_CONFIG);
    expect(service.amadeusProvider.providerId).toBe(AMADEUS_EXECUTION_PROVIDER_ID);
    expect(service.providers).toHaveLength(1);
    expect(service.providers[0]).toBe(service.amadeusProvider);
  });

  it('adds the deterministic mock only when explicitly requested', () => {
    expect(getRealExecutionProviders(READY_CONFIG).map((p) => p.providerId)).toEqual([
      AMADEUS_EXECUTION_PROVIDER_ID,
    ]);
    const withMock = getRealExecutionProviders(READY_CONFIG, { includeMock: true });
    expect(withMock.map((p) => p.providerId)).toEqual([
      AMADEUS_EXECUTION_PROVIDER_ID,
      MOCK_TRIP_EXECUTION_PROVIDER_ID,
    ]);
  });

  it('never mutates the deterministic mock and re-exports the same instance', () => {
    expect(mockTripExecutionProvider.providerId).toBe(MOCK_TRIP_EXECUTION_PROVIDER_ID);
    const composed = createRealExecutionService(READY_CONFIG, { includeMock: true });
    expect(composed.providers[1]).toBe(mockTripExecutionProvider);
  });

  it('leaves the mock semantics untouched: it still accepts a valid request', async () => {
    const result = await mockTripExecutionProvider.execute(validRequest());
    expect(result).toEqual({
      providerId: MOCK_TRIP_EXECUTION_PROVIDER_ID,
      requestId: expect.any(String),
      status: 'accepted',
    });
    expect((await mockTripExecutionProvider.execute({} as TripExecutionProviderRequest)).status).toBe('rejected');
  });

  it('executes nothing and consults no connection merely by being constructed', () => {
    const { connection, attempt } = spyConnection();
    const options: RealExecutionServiceOptions = { connection };
    createRealExecutionService(READY_CONFIG, options);
    createRealExecutionService(READY_CONFIG, options);
    getRealExecutionProviders(READY_CONFIG, options);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('exposes a capability profile that advertises nothing operational', () => {
    expect(getAdapterOperationalCapabilityIds(createRealExecutionService(READY_CONFIG).amadeusCapabilityProfile)).toEqual(
      []
    );
  });

  it('leaks no credential through any value on the service handle', () => {
    const serialized = JSON.stringify(createRealExecutionService(READY_CONFIG));
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('service-id');
  });
});

describe('STEP 66 real execution service end-to-end through the STEP 65 pipeline', () => {
  it('surfaces an honest unsupported result for the default browser build', async () => {
    const service = createRealExecutionService();
    const result = await executeTripExecutionPipeline(validRequest(), service.providers);
    expect(result).not.toBeNull();
    expect(result?.providerResults).toEqual([
      { providerId: AMADEUS_EXECUTION_PROVIDER_ID, requestId: expect.any(String), status: 'unsupported' },
    ]);
  });

  it('still surfaces unsupported even for a fully configured server build', async () => {
    const service = createRealExecutionService(READY_CONFIG);
    const result = await executeTripExecutionPipeline(validRequest(), service.providers);
    expect(result?.providerResults.map((providerResult) => providerResult.status)).toEqual(['unsupported']);
  });

  it('keeps the mock accepted alongside an unsupported real provider', async () => {
    const service = createRealExecutionService(READY_CONFIG, { includeMock: true });
    const result = await executeTripExecutionPipeline(validRequest(), service.providers);
    expect(result?.providerResults).toEqual([
      { providerId: AMADEUS_EXECUTION_PROVIDER_ID, requestId: expect.any(String), status: 'unsupported' },
      { providerId: MOCK_TRIP_EXECUTION_PROVIDER_ID, requestId: expect.any(String), status: 'accepted' },
    ]);
  });

  it('never reports accepted for the Amadeus provider through the pipeline', async () => {
    for (const config of [DEFAULT_AMADEUS_EXECUTION_CONFIG, READY_CONFIG]) {
      const service = createRealExecutionService(config, { includeMock: true });
      const result = await executeTripExecutionPipeline(validRequest(), service.providers);
      const amadeusResults = result?.providerResults.filter(
        (providerResult) => providerResult.providerId === AMADEUS_EXECUTION_PROVIDER_ID
      );
      expect(amadeusResults).toHaveLength(1);
      expect(amadeusResults?.[0]?.status).not.toBe('accepted');
    }
  });
});
