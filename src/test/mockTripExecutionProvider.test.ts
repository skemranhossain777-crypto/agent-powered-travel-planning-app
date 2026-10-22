import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOCK_TRIP_EXECUTION_PROVIDER_ID,
  mockTripExecutionProvider,
} from '../services/tripExecution/mockTripExecutionProvider';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_RESULT_STATUSES,
  createTripExecutionProviderRequest,
  isTripExecutionProviderRequest,
  isTripExecutionProviderResult,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import {
  createTripExecutionDispatchInstruction,
  type TripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripPlanningExecutionAuthorization,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionIntent,
} from '../domain/trips/tripPlanningExecutionIntent';
import {
  createTripPlanningApplicationBinding,
  type TripPlanningApplicationBinding,
} from '../domain/trips/tripPlanningApplicationBinding';
import {
  createTripPlanningApplication,
  type TripPlanningApplication,
} from '../domain/trips/tripPlanningApplication';
import {
  createTripPlanningApplicationTarget,
  type TripPlanningApplicationTarget,
} from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import {
  createTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposal';
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

function validApplication(): TripPlanningApplication {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  const proposal = createTripPlanningCompositionProposal(
    composition
  ) as TripPlanningCompositionProposal;
  const approved = approveTripPlanningCompositionProposal(
    proposal
  ) as TripPlanningCompositionProposal;
  return createTripPlanningApplication(approved) as TripPlanningApplication;
}

function validTarget(tripId = 'trip-abc'): TripPlanningApplicationTarget {
  return createTripPlanningApplicationTarget({ scope: 'trip', tripId }) as TripPlanningApplicationTarget;
}

function validBinding(tripId = 'trip-abc'): TripPlanningApplicationBinding {
  return createTripPlanningApplicationBinding(validApplication(), validTarget(tripId)) as TripPlanningApplicationBinding;
}

function validIntent(tripId = 'trip-abc'): ReturnType<typeof createTripPlanningExecutionIntent> {
  return createTripPlanningExecutionIntent(validBinding(tripId));
}

function validRequest(tripId = 'trip-abc'): TripPlanningExecutionRequest {
  const intent = validIntent(tripId);
  if (intent === null) throw new Error('test setup: intent missing');
  const request = createTripPlanningExecutionRequest(intent);
  if (request === null) throw new Error('test setup: request missing');
  return request;
}

function validAuthorization(tripId = 'trip-abc'): TripPlanningExecutionAuthorization {
  const authorization = createTripPlanningExecutionAuthorization(validRequest(tripId));
  if (authorization === null) throw new Error('test setup: authorization missing');
  return authorization;
}

function validDispatch(tripId = 'trip-abc'): TripExecutionDispatchInstruction {
  const dispatch = createTripExecutionDispatchInstruction(validAuthorization(tripId));
  if (dispatch === null) throw new Error('test setup: dispatch missing');
  return dispatch;
}

function validProviderRequest(tripId = 'trip-abc'): TripExecutionProviderRequest {
  const request = createTripExecutionProviderRequest(validDispatch(tripId));
  if (request === null) throw new Error('test setup: provider request missing');
  return request;
}

describe('STEP 60 mock provider: identity and contract', () => {
  it('1. provider ID is exactly mock-execution', () => {
    expect(MOCK_TRIP_EXECUTION_PROVIDER_ID).toBe('mock-execution');
    expect(mockTripExecutionProvider.providerId).toBe('mock-execution');
  });

  it('2. provider ID satisfies existing provider-ID rules', () => {
    const id = mockTripExecutionProvider.providerId;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(id).toBe(id.trim());
  });

  it('3. provider implements TripExecutionProvider', () => {
    const candidate = mockTripExecutionProvider as TripExecutionProvider;
    expect('providerId' in candidate).toBe(true);
    expect(typeof candidate.execute).toBe('function');
    const pending = candidate.execute(validProviderRequest());
    expect(pending).toBeInstanceOf(Promise);
  });

  it('42. execute returns a Promise (async execution contract)', () => {
    const pending = mockTripExecutionProvider.execute(validProviderRequest());
    expect(pending).toBeInstanceOf(Promise);
  });
});

describe('STEP 60 mock provider: valid request behavior', () => {
  it('4. valid provider request returns accepted', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    expect(result.status).toBe('accepted');
  });

  it('5. providerId in result is mock-execution', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    expect(result.providerId).toBe('mock-execution');
  });

  it('6. requestId equals request.id', async () => {
    const request = validProviderRequest();
    const result = await mockTripExecutionProvider.execute(request);
    expect(result.requestId).toBe(request.id);
  });

  it('7. result passes isTripExecutionProviderResult', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    expect(isTripExecutionProviderResult(result)).toBe(true);
  });

  it('8. repeated valid execution is deterministic', async () => {
    const request = validProviderRequest();
    const first = await mockTripExecutionProvider.execute(request);
    const again = await mockTripExecutionProvider.execute(request);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(first).not.toBe(again);
  });

  it('43. deterministic result for repeated identical input', async () => {
    const request = validProviderRequest();
    const first = await mockTripExecutionProvider.execute(request);
    const second = await mockTripExecutionProvider.execute(JSON.parse(JSON.stringify(request)));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('44. different valid request IDs preserve their own request identity', async () => {
    const requestA = validProviderRequest('trip-abc');
    const requestB = validProviderRequest('trip-def');
    expect(requestA.id).not.toBe(requestB.id);
    const resultA = await mockTripExecutionProvider.execute(requestA);
    const resultB = await mockTripExecutionProvider.execute(requestB);
    expect(resultA.requestId).toBe(requestA.id);
    expect(resultB.requestId).toBe(requestB.id);
    expect(resultA.requestId).not.toBe(resultB.requestId);
  });

  it('45. result status remains within Step 59 vocabulary', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    expect([...TRIP_EXECUTION_PROVIDER_RESULT_STATUSES]).toContain(result.status);
  });

  it('14. request input is not mutated', async () => {
    const request = validProviderRequest();
    const snapshot = JSON.stringify(request);
    await mockTripExecutionProvider.execute(request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});

describe('STEP 60 mock provider: invalid request behavior', () => {
  it('9. malformed request rejects safely', async () => {
    for (const input of [null, undefined, {}, 'x', 42, [], 0]) {
      const result = await mockTripExecutionProvider.execute(input as never);
      expect(result.status).toBe('rejected');
      expect(isTripExecutionProviderResult(result)).toBe(true);
    }
  });

  it('10. malformed request never produces accepted', async () => {
    const invalidInputs = [
      null,
      undefined,
      {},
      { id: 'x', kind: 'trip-execution-provider-request', dispatchId: 'y' },
      { id: TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX + 'x' },
    ];
    for (const input of invalidInputs) {
      const result = await mockTripExecutionProvider.execute(input as never);
      expect(result.status).not.toBe('accepted');
    }
  });

  it('11. wrong request kind is not accepted', async () => {
    const request = validProviderRequest();
    const wrongKind = { ...request, kind: 'other' };
    expect(isTripExecutionProviderRequest(wrongKind)).toBe(false);
    const result = await mockTripExecutionProvider.execute(wrongKind as never);
    expect(result.status).toBe('rejected');
    expect(result.requestId).toBe(request.id);
  });

  it('12. malformed dispatch-derived request is not accepted', async () => {
    const request = validProviderRequest();
    const badDispatch = { ...request, dispatchId: 'trip-execution-dispatch:other' };
    const mismatchedId = {
      id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}stray`,
      kind: 'trip-execution-provider-request',
      dispatchId: request.dispatchId,
    };
    expect(isTripExecutionProviderRequest(badDispatch)).toBe(false);
    expect(isTripExecutionProviderRequest(mismatchedId)).toBe(false);
    for (const input of [badDispatch, mismatchedId]) {
      const result = await mockTripExecutionProvider.execute(input as never);
      expect(result.status).toBe('rejected');
    }
  });

  it('13. missing request ID is not accepted', async () => {
    const request = validProviderRequest();
    const missingId = { kind: request.kind as 'trip-execution-provider-request', dispatchId: request.dispatchId };
    const missingEverything = {};
    const resultMissing = await mockTripExecutionProvider.execute(missingId as never);
    const resultEmpty = await mockTripExecutionProvider.execute(missingEverything as never);
    expect(resultMissing.status).toBe('rejected');
    expect(resultEmpty.status).toBe('rejected');
    expect(resultMissing.requestId).toBe(`${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`);
    expect(resultEmpty.requestId).toBe(`${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`);
    expect(isTripExecutionProviderResult(resultMissing)).toBe(true);
    expect(isTripExecutionProviderResult(resultEmpty)).toBe(true);
  });

  it('rejected result echoes a usable exposed request id deterministically', async () => {
    const request = validProviderRequest();
    const partial = { id: request.id, kind: 'wrong-kind' };
    const first = await mockTripExecutionProvider.execute(partial as never);
    const again = await mockTripExecutionProvider.execute(partial as never);
    expect(first.status).toBe('rejected');
    expect(first.requestId).toBe(request.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('rejected result is stable for arbitrary non-string inputs', async () => {
    const first = await mockTripExecutionProvider.execute({} as never);
    const again = await mockTripExecutionProvider.execute({} as never);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });
});

describe('STEP 60 mock provider: result purity', () => {
  it('15. result contains only provider-neutral fields', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('16-24. no fake booking, reservation, payment, price, inventory, URL, or reference data', async () => {
    const result = await mockTripExecutionProvider.execute(validProviderRequest());
    for (const field of [
      'bookingId',
      'bookingRef',
      'reservationId',
      'ticketNumber',
      'confirmationCode',
      'paymentId',
      'price',
      'amount',
      'currency',
      'inventory',
      'providerUrl',
      'externalReference',
      'externalRef',
      'endpoint',
      'url',
    ]) {
      expect(result).not.toHaveProperty(field);
    }
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });
});

describe('STEP 60 mock provider: module boundary and determinism', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'mockTripExecutionProvider.ts'),
    'utf8'
  );

  it('imports only the STEP 59 provider contract and the STEP 62 capability contract', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripExecutionCapability', './tripExecutionProvider']);
  });

  it('27. no Firebase/Firestore and 28. no persistence', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/getFirestore|onCall|cloud functions/i);
  });

  it('25. no network calls and 26. no fetch/axios', () => {
    expect(source).not.toMatch(/fetch\s*\(|axios|new\s+WebSocket|XMLHttpRequest/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiEndpoint|httpMethod/i);
  });

  it('29. no Google dependency and 30. no Amadeus dependency', () => {
    expect(source).not.toMatch(
      /googleDiscovery|googleRoutes|googlePlaces|googleRoutesService|googlePlacesService/i
    );
    expect(source).not.toMatch(/amadeus|realDiscovery|mockDiscovery/i);
  });

  it('31. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage|aiTravelAgent/i);
  });

  it('32. no environment-variable dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env|env\(/i);
  });

  it('33. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(|new\s+Date\(/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime|setTimeout|setInterval/);
  });

  it('34. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
  });

  it('35. no mutable global state', () => {
    expect(source).not.toMatch(/globalThis|useState\(|setState|moduleScope/i);
    expect(source).not.toMatch(/let\s+\w+\s*=\s*0|var\s+\w+\s*=\s*0/);
  });

  it('36. no counters and 37. no UUID generation', () => {
    expect(source).not.toMatch(/increment\(|attemptCount|sequence|\+\+/i);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|\bv4\(\)/i);
  });

  it('40. no payment behavior and 41. no booking behavior', () => {
    expect(source).not.toMatch(
      /charge|payment-intent|checkout|paymentMethod|\bstripe\b|refund|invoice|paid/i
    );
    expect(source).not.toMatch(
      /createBooking|submit-booking|prepare-booking|bookingRef|reservationId/i
    );
  });

  it('46. no new execution lifecycle statuses', () => {
    expect(source).not.toMatch(
      /executing|pending-execution|completed|cancelled|refunded|\bbooked\b|\bexecuted\b/i
    );
    expect(source).not.toMatch(/markApply|markApplied|executionStatus/i);
  });

  it('47. no retry behavior', () => {
    expect(source).not.toMatch(/retry|backoff|deadLetter|attemptCount/i);
  });

  it('48. no rollback/compensation', () => {
    expect(source).not.toMatch(/rollback|compensa|recoveryQueue/i);
  });

  it('49. no provider selection and 50. no provider orchestration', () => {
    expect(source).not.toMatch(/selectProvider|providerRegistry|providerFactory|preferProvider/i);
    expect(source).not.toMatch(/orchestrat|Promise\.all\(|dispatchAll|executeAll/i);
  });

  it('42. no real provider execution', () => {
    expect(source).not.toMatch(/serverBoundary|serverDiscoveryClient/i);
    expect(source).not.toMatch(/executeProvider|callProvider|runAdapter|sendTo/i);
  });

  it('38. no trip mutation and 39. no itinerary mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('no credentials, tokens, or secrets', () => {
    expect(source).not.toMatch(/apiKey|x-goog-api-key|Bearer\s/i);
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|authorizationHeader/i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });
});