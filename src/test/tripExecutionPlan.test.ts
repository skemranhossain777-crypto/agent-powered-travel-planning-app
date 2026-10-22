import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_EXECUTION_PLAN_ID_PREFIX,
  createTripExecutionPlan,
  getTripExecutionPlanId,
  isTripExecutionPlan,
  type TripExecutionPlan,
} from '../services/tripExecution/tripExecutionPlan';
import { mockTripExecutionProvider } from '../services/tripExecution/mockTripExecutionProvider';
import { type TripExecutionCapabilityProvider } from '../services/tripExecution/tripExecutionCapability';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  isTripExecutionProviderRequest,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
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

function createProviderRequest(dispatch: TripExecutionDispatchInstruction): TripExecutionProviderRequest {
  return {
    id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`,
    kind: 'trip-execution-provider-request',
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

function validRequest(tripId = 'trip-plan'): TripExecutionProviderRequest {
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
  return createProviderRequest(dispatch);
}

function executionOnlyProvider(providerId: string, log: string[] = []): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  };
}

function capabilityAwareProvider(
  providerId: string,
  verdict: boolean,
  log: string[] = []
): TripExecutionCapabilityProvider {
  return {
    providerId,
    supports(request: TripExecutionProviderRequest): boolean {
      void request;
      log.push(`supports:${providerId}`);
      return verdict;
    },
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  };
}

describe('STEP 63 plan: contract', () => {
  it('1. valid single eligible provider', () => {
    const request = validRequest();
    const plan = createTripExecutionPlan(request, [mockTripExecutionProvider]);
    expect(plan).not.toBeNull();
    expect(plan!.providerIds).toEqual(['mock-execution']);
  });

  it('2. multiple eligible providers', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-only'),
    ]);
    expect(plan!.providerIds).toEqual(['mock-execution', 'provider-only']);
  });

  it('3. exact provider ordering preserved', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      executionOnlyProvider('provider-z'),
      mockTripExecutionProvider,
      executionOnlyProvider('provider-a'),
    ]);
    expect(plan!.providerIds).toEqual(['provider-z', 'mock-execution', 'provider-a']);
  });

  it('4. unsupported provider excluded', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-no', false),
    ]);
    expect(plan!.providerIds).toEqual([]);
  });

  it('5. mixed supported/unsupported providers', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-yes', true),
      capabilityAwareProvider('provider-no', false),
      executionOnlyProvider('provider-only'),
    ]);
    expect(plan!.providerIds).toEqual(['provider-yes', 'provider-only']);
  });

  it('6. all providers unsupported', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-no-1', false),
      capabilityAwareProvider('provider-no-2', false),
    ]);
    expect(plan!.providerIds).toEqual([]);
  });

  it('7. empty provider list is a valid plan', () => {
    const request = validRequest();
    const plan = createTripExecutionPlan(request, []);
    expect(plan).not.toBeNull();
    expect(plan!.providerIds).toEqual([]);
    expect(isTripExecutionPlan(plan)).toBe(true);
  });

  it('8. malformed request is rejected as null', () => {
    const malformed = { id: 'bad', kind: 'bad', dispatchId: 'bad' };
    const plan = createTripExecutionPlan(malformed, [mockTripExecutionProvider]);
    expect(plan).toBeNull();
  });

  it('9. missing request ID is rejected as null', () => {
    const request = validRequest();
    const missingId = { kind: request.kind, dispatchId: request.dispatchId };
    const plan = createTripExecutionPlan(missingId, [mockTripExecutionProvider]);
    expect(plan).toBeNull();
  });

  it('10. wrong request kind is rejected as null', () => {
    const request = validRequest();
    const wrongKind = { ...request, kind: 'other' };
    const plan = createTripExecutionPlan(wrongKind, [mockTripExecutionProvider]);
    expect(plan).toBeNull();
  });

  it('defensive: non-array provider list is rejected as null', () => {
    const plan = createTripExecutionPlan(validRequest(), null as never);
    expect(plan).toBeNull();
  });

  it('11. malformed provider is excluded, not fatal', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      null as never,
      'string' as never,
      executionOnlyProvider('provider-ok'),
    ]);
    expect(plan!.providerIds).toEqual(['provider-ok']);
  });

  it('12. invalid provider ID is excluded', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      executionOnlyProvider('provider-ok'),
      { providerId: '  spaced  ', execute: async () => ({}) } as never,
      { providerId: '', execute: async () => ({}) } as never,
    ]);
    expect(plan!.providerIds).toEqual(['provider-ok']);
  });

  it('13. capability-aware supported provider included', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-cap', true),
    ]);
    expect(plan!.providerIds).toEqual(['provider-cap']);
  });

  it('14. capability-aware unsupported provider excluded', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-cap', false),
    ]);
    expect(plan!.providerIds).toEqual([]);
  });

  it('15. execution-only provider is eligible', () => {
    const plan = createTripExecutionPlan(validRequest(), [executionOnlyProvider('provider-only')]);
    expect(plan!.providerIds).toEqual(['provider-only']);
  });

  it('31. provider attribution preserved in the plan', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-second'),
    ]);
    expect(plan!.providerIds[0]).toBe('mock-execution');
    expect(plan!.providerIds[1]).toBe('provider-second');
  });

  it('duplicate eligible provider IDs are preserved (no silent deduplication)', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      mockTripExecutionProvider,
      mockTripExecutionProvider,
    ]);
    expect(plan!.providerIds).toEqual(['mock-execution', 'mock-execution']);
    expect(isTripExecutionPlan(plan)).toBe(true);
  });

  it('plan carries only the four contract fields', () => {
    const plan = createTripExecutionPlan(validRequest(), [mockTripExecutionProvider]);
    expect(Object.keys(plan as TripExecutionPlan).sort()).toEqual([
      'id',
      'kind',
      'providerIds',
      'requestId',
    ]);
  });
});

describe('STEP 63 plan: purity and determinism', () => {
  it('16. capability evaluation occurs', () => {
    const log: string[] = [];
    createTripExecutionPlan(validRequest(), [
      capabilityAwareProvider('provider-cap', false, log),
    ]);
    expect(log).toEqual(['supports:provider-cap']);
  });

  it('17. provider execute is never called during plan creation', () => {
    const log: string[] = [];
    const request = validRequest();
    createTripExecutionPlan(request, [
      capabilityAwareProvider('provider-cap', true, log),
      executionOnlyProvider('provider-only', log),
      mockTripExecutionProvider,
    ]);
    expect(log.some((entry) => entry.startsWith('execute:'))).toBe(false);
    expect(log).toEqual(['supports:provider-cap']);
  });

  it('18. request is not mutated', () => {
    const request = validRequest();
    const snapshot = JSON.stringify(request);
    createTripExecutionPlan(request, [mockTripExecutionProvider]);
    expect(JSON.stringify(request)).toBe(snapshot);
  });

  it('19. provider array is not mutated', () => {
    const providers = [mockTripExecutionProvider, executionOnlyProvider('provider-only')];
    const snapshot = JSON.stringify(providers);
    createTripExecutionPlan(validRequest(), providers);
    expect(JSON.stringify(providers)).toBe(snapshot);
  });

  it('20. provider objects are not mutated', () => {
    const provider = capabilityAwareProvider('provider-cap', true);
    const snapshot = JSON.stringify(provider);
    createTripExecutionPlan(validRequest(), [provider]);
    expect(JSON.stringify(provider)).toBe(snapshot);
  });

  it('21. deterministic plan ID derives from the request ID', () => {
    const request = validRequest();
    const plan = createTripExecutionPlan(request, [mockTripExecutionProvider]);
    expect(plan!.id).toBe(getTripExecutionPlanId(request.id));
    expect(plan!.id).toBe(`${TRIP_EXECUTION_PLAN_ID_PREFIX}${request.id}`);
  });

  it('22. repeated creation is structurally identical', () => {
    const request = validRequest();
    const providers = [
      capabilityAwareProvider('provider-cap', true),
      executionOnlyProvider('provider-only'),
    ];
    const first = createTripExecutionPlan(request, providers);
    const again = createTripExecutionPlan(JSON.parse(JSON.stringify(request)), providers);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('57. JSON round-trip preserves plan semantics', () => {
    const original = createTripExecutionPlan(validRequest(), [mockTripExecutionProvider]);
    const restored = JSON.parse(JSON.stringify(original)) as TripExecutionPlan;
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
    expect(isTripExecutionPlan(restored)).toBe(true);
  });

  it('58. plan ID space is distinct from request/provider IDs', () => {
    expect(TRIP_EXECUTION_PLAN_ID_PREFIX).toBe('trip-execution-plan:');
    expect(TRIP_EXECUTION_PLAN_ID_PREFIX).not.toBe(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX);
    const plan = createTripExecutionPlan(validRequest(), [mockTripExecutionProvider]) as TripExecutionPlan;
    expect(plan.id.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX)).toBe(false);
    expect(isTripExecutionProviderRequest(plan.id)).toBe(false);
    expect(isTripExecutionPlan(plan.requestId)).toBe(false);
  });

  it('plan id is stable across trips with the same request', () => {
    const request = validRequest('trip-plan');
    const planA = createTripExecutionPlan(request, [mockTripExecutionProvider]);
    const planB = createTripExecutionPlan(validRequest('trip-plan'), [mockTripExecutionProvider]);
    expect(planA!.id).toBe(planB!.id);
  });
});

describe('STEP 63 plan: validator', () => {
  const buildPlan = (): TripExecutionPlan =>
    createTripExecutionPlan(validRequest(), [mockTripExecutionProvider]) as TripExecutionPlan;

  it('23. validator accepts a valid plan', () => {
    expect(isTripExecutionPlan(buildPlan())).toBe(true);
  });

  it('24. validator rejects malformed plan (non-record)', () => {
    for (const value of [null, undefined, 'string', 42, []]) {
      expect(isTripExecutionPlan(value)).toBe(false);
    }
  });

  it('25. validator rejects wrong kind', () => {
    const plan = { ...buildPlan(), kind: 'other' } as unknown;
    expect(isTripExecutionPlan(plan)).toBe(false);
  });

  it('26. validator rejects wrong ID', () => {
    const wrongId = { ...buildPlan(), id: 'trip-execution-plan:stray' } as unknown;
    const nonPlanPrefix = { ...buildPlan(), id: 'trip-execution-dispatcher:x' } as unknown;
    const barePrefix = { ...buildPlan(), id: TRIP_EXECUTION_PLAN_ID_PREFIX } as unknown;
    expect(isTripExecutionPlan(wrongId)).toBe(false);
    expect(isTripExecutionPlan(nonPlanPrefix)).toBe(false);
    expect(isTripExecutionPlan(barePrefix)).toBe(false);
  });

  it('27. validator rejects mismatched requestId/ID', () => {
    const request = validRequest();
    const other = createTripExecutionPlan(validRequest('trip-other'), [
      mockTripExecutionProvider,
    ]) as TripExecutionPlan;
    const mismatched = {
      ...buildPlan(),
      id: getTripExecutionPlanId(other.requestId),
      requestId: other.requestId,
    } as unknown;
    void request;
    expect(isTripExecutionPlan(mismatched)).toBe(true);
    const idOnlyMismatch = { ...buildPlan(), id: getTripExecutionPlanId('stray-request') } as unknown;
    expect(isTripExecutionPlan(idOnlyMismatch)).toBe(false);
  });

  it('validator rejects a malformed requestId', () => {
    const wrongPrefix = { ...buildPlan(), requestId: 'trip-execution-dispatcher:x' } as unknown;
    const bareRequestPrefix = {
      ...buildPlan(),
      requestId: TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
    } as unknown;
    const nonString = { ...buildPlan(), requestId: 42 } as unknown;
    expect(isTripExecutionPlan(wrongPrefix)).toBe(false);
    expect(isTripExecutionPlan(bareRequestPrefix)).toBe(false);
    expect(isTripExecutionPlan(nonString)).toBe(false);
  });

  it('28. validator rejects invalid provider IDs', () => {
    const spaced = { ...buildPlan(), providerIds: [' spaced'] } as unknown;
    const empty = { ...buildPlan(), providerIds: [''] } as unknown;
    const tooLong = { ...buildPlan(), providerIds: ['a'.repeat(120)] } as unknown;
    const nonString = { ...buildPlan(), providerIds: [42] } as unknown;
    const nonArray = { ...buildPlan(), providerIds: 'mock-execution' } as unknown;
    expect(isTripExecutionPlan(spaced)).toBe(false);
    expect(isTripExecutionPlan(empty)).toBe(false);
    expect(isTripExecutionPlan(tooLong)).toBe(false);
    expect(isTripExecutionPlan(nonString)).toBe(false);
    expect(isTripExecutionPlan(nonArray)).toBe(false);
  });

  it('validator accepts a valid empty-eligible plan', () => {
    const empty = createTripExecutionPlan(validRequest('trip-empty'), [
      capabilityAwareProvider('provider-no', false),
    ]) as TripExecutionPlan;
    expect(empty.providerIds).toEqual([]);
    expect(isTripExecutionPlan(empty)).toBe(true);
  });

  it('29-30. validator is pure: calls no provider and no execute', () => {
    const plan = buildPlan();
    expect(isTripExecutionPlan(plan)).toBe(true);
    expect(isTripExecutionPlan(JSON.parse(JSON.stringify(plan)))).toBe(true);
  });
});

describe('STEP 63 plan: no implicit behavior', () => {
  it('32. no provider ranking', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      executionOnlyProvider('provider-b'),
      executionOnlyProvider('provider-a'),
      executionOnlyProvider('provider-m'),
    ]);
    expect(plan!.providerIds).toEqual(['provider-b', 'provider-a', 'provider-m']);
  });

  it('33. no provider scoring', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-more'),
    ]);
    expect(plan!.providerIds).toEqual(['mock-execution', 'provider-more']);
  });

  it('34. no provider prioritization', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      executionOnlyProvider('provider-first'),
      executionOnlyProvider('provider-second'),
    ]);
    expect(plan!.providerIds).toEqual(['provider-first', 'provider-second']);
  });

  it('35. no automatic provider discovery, 36. no registration, 37. no creation', () => {
    const plan = createTripExecutionPlan(validRequest(), [executionOnlyProvider('provider-only')]);
    expect(plan!.providerIds).toEqual(['provider-only']);
  });

  it('38. no provider selection beyond capability eligibility', () => {
    const plan = createTripExecutionPlan(validRequest(), [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-only'),
    ]);
    expect(plan!.providerIds).toHaveLength(2);
  });
});

describe('STEP 63 plan: module boundary scans', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionPlan.ts'),
    'utf8'
  );

  it('imports only provider-execution/domain contracts', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionCapability',
      './tripExecutionProvider',
    ]);
  });

  it('39-42. no booking, payment, inventory, or credential data', () => {
    expect(source).not.toMatch(/createBooking|bookingRef|reservationId|ticketNumber|confirmationCode/i);
    expect(source).not.toMatch(/charge|payment-intent|checkout|paymentMethod|\bstripe\b|refund|invoice/i);
    expect(source).not.toMatch(/inventoryCount|stockLevel|priceList|seatClass/i);
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|Bearer\s|x-goog-api-key/i);
    expect(source).not.toMatch(/providerUrl|externalRef|authorizationHeader/i);
  });

  it('43. no network', () => {
    expect(source).not.toMatch(/fetch\s*\(|axios|new\s+WebSocket|XMLHttpRequest/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiKey/i);
  });

  it('44. no Firebase and 53. no persistence', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getFirestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/i);
  });

  it('45. no Google Places and 46. no Google Routes', () => {
    expect(source).not.toMatch(/googlePlaces|googlePlacesService|googlePlacesAdapter/i);
    expect(source).not.toMatch(/googleRoutes|googleRoutesService|googleRoutesAdapter/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(googleRoutes|googlePlaces)/i);
  });

  it('47. no Amadeus', () => {
    expect(source).not.toMatch(/amadeus|realDiscovery/i);
  });

  it('48. no AI', () => {
    expect(source).not.toMatch(/gemini|aiPlanningService|generativeLanguage|aiTravelAgent/i);
  });

  it('49. no environment dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env|\benv\s*\(/i);
  });

  it('50. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(|new\s+Date\(/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime|setTimeout|setInterval/i);
  });

  it('51. no randomness', () => {
    expect(source).not.toMatch(/Math\.random|crypto\.randomUUID|\buuid\b/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\.|globalThis/i);
  });

  it('52. no global mutable state', () => {
    expect(source).not.toMatch(/let\s+\w+\s*=\s*0|var\s+\w+\s*=\s*0/i);
    expect(source).not.toMatch(/useState\(|setState\(|moduleScope|increment\(|\+\+/i);
  });

  it('no provider execution in the module', () => {
    expect(source).not.toMatch(/\.execute\(/);
    expect(source).not.toMatch(/provider\.execute|await\s+\w+\.execute/i);
  });

  it('54. no trip mutation and 55. no itinerary mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/i);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/i);
  });

  it('56. no lifecycle-state mutation', () => {
    expect(source).not.toMatch(/executing|pending-execution|completed|cancelled|refunded/i);
    expect(source).not.toMatch(/\bbooked\b|\bexecuted\b|executionStatus|markApply/i);
    expect(source).not.toMatch(/updateTripStatus\(/);
  });

  it('no orchestration changes, registration, registry, or rollback', () => {
    expect(source).not.toMatch(/orchestrateTripExecution|registerProvider|providerRegistry/i);
    expect(source).not.toMatch(/retry|backoff|deadLetter|rollback|compensa/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.?[\\/](components|pages)/i);
  });
});