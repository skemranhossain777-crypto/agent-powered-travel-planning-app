import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateTripExecutionCapability,
  isTripExecutionCapabilityProvider,
  type TripExecutionCapabilityProvider,
} from '../services/tripExecution/tripExecutionCapability';
import { mockTripExecutionProvider } from '../services/tripExecution/mockTripExecutionProvider';
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

function validRequest(tripId = 'trip-capability'): TripExecutionProviderRequest {
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

function createProviderRequest(dispatch: TripExecutionDispatchInstruction): TripExecutionProviderRequest {
  return {
    id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`,
    kind: 'trip-execution-provider-request',
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

function executionOnlyProvider(providerId: string, log: string[] = []): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(providerId);
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

function malformedCapabilityProvider(providerId: string): TripExecutionProvider {
  return {
    providerId,
    supports(request: TripExecutionProviderRequest): unknown {
      void request;
      return 'yes';
    },
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  } as never;
}

describe('STEP 62 capability: contract and result shape', () => {
  it('1. valid capability result is well-formed', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-capable', true)
    );
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'supported']);
    expect(typeof result.supported).toBe('boolean');
  });

  it('2. invalid capability result is coerced to unsupported', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(request, malformedCapabilityProvider('bad-verdict'));
    expect(result.supported).toBe(false);
  });

  it('3. provider ID is preserved', () => {
    const request = validRequest();
    const aware = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-aware', true)
    );
    const only = evaluateTripExecutionCapability(request, executionOnlyProvider('provider-only'));
    expect(aware.providerId).toBe('provider-aware');
    expect(only.providerId).toBe('provider-only');
  });

  it('4. request ID is preserved', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(request, executionOnlyProvider('provider-only'));
    expect(result.requestId).toBe(request.id);
  });

  it('5. supported=true when capability aware and positive', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-capable', true)
    );
    expect(result.supported).toBe(true);
  });

  it('6. supported=false when capability aware and negative', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-refusing', false)
    );
    expect(result.supported).toBe(false);
  });

  it('isTripExecutionCapabilityProvider recognizes the capability shape', () => {
    expect(isTripExecutionCapabilityProvider(capabilityAwareProvider('p', true))).toBe(true);
    expect(isTripExecutionCapabilityProvider(executionOnlyProvider('p'))).toBe(false);
    expect(isTripExecutionCapabilityProvider(null)).toBe(false);
    expect(isTripExecutionCapabilityProvider(mockTripExecutionProvider)).toBe(true);
  });
});

describe('STEP 62 capability: malformed inputs', () => {
  it('7. malformed request is unsupported', () => {
    const malformed = { id: 'not-an-id', kind: 'wrong', dispatchId: 'wrong' };
    const result = evaluateTripExecutionCapability(
      malformed,
      capabilityAwareProvider('provider-aware', true)
    );
    expect(result.supported).toBe(false);
    expect(result.providerId).toBe('provider-aware');
  });

  it('7b. malformed request echoes a usable id when present', () => {
    const malformed = {
      id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}stray`,
      kind: 'wrong-kind',
      dispatchId: 'trip-execution-dispatch:stray',
    };
    const result = evaluateTripExecutionCapability(malformed, executionOnlyProvider('provider-only'));
    expect(result.supported).toBe(false);
    expect(result.requestId).toBe(malformed.id);
  });

  it('7c. malformed request with no usable id uses the deterministic placeholder', () => {
    const result = evaluateTripExecutionCapability({ id: 'nonsense' }, executionOnlyProvider('p'));
    expect(result.supported).toBe(false);
    expect(result.requestId).toBe(`${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`);
  });

  it('8. missing request ID is unsupported', () => {
    const request = validRequest();
    const missingId = { kind: request.kind, dispatchId: request.dispatchId };
    expect(isTripExecutionProviderRequest(missingId)).toBe(false);
    const result = evaluateTripExecutionCapability(missingId, capabilityAwareProvider('p', true));
    expect(result.supported).toBe(false);
  });

  it('9. wrong request kind is unsupported', () => {
    const request = validRequest();
    const wrongKind = { ...request, kind: 'other' };
    const result = evaluateTripExecutionCapability(wrongKind, mockTripExecutionProvider);
    expect(result.supported).toBe(false);
  });

  it('10. malformed provider is unsupported', () => {
    const request = validRequest();
    for (const provider of [null, 'plain-string', 42, {}, []]) {
      const result = evaluateTripExecutionCapability(request, provider);
      expect(result.supported).toBe(false);
      expect(result.providerId).toBe('unknown-execution-provider');
      expect(result.requestId).toBe(request.id);
    }
  });

  it('11. invalid provider ID is unsupported with a safe fallback identity', () => {
    const request = validRequest();
    const unsafeProviders = [
      { providerId: '  spaced  ', execute: async () => ({}) },
      { providerId: '', execute: async () => ({}) },
      { providerId: 'a'.repeat(120), execute: async () => ({}) },
    ];
    for (const provider of unsafeProviders) {
      const result = evaluateTripExecutionCapability(request, provider);
      expect(result.supported).toBe(false);
      expect(result.providerId).toBe('unknown-execution-provider');
    }
  });

  it('11b. known safe provider id is preserved on an otherwise invalid provider', () => {
    const request = validRequest();
    const incomplete = { providerId: 'declared-executor', execute: 'not-a-function' };
    const result = evaluateTripExecutionCapability(request, incomplete);
    expect(result.supported).toBe(false);
    expect(result.providerId).toBe('declared-executor');
  });
});

describe('STEP 62 capability: provider kinds', () => {
  it('12. capability-aware provider contributes its own verdict', () => {
    const request = validRequest();
    const positive = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-yes', true)
    );
    const negative = evaluateTripExecutionCapability(
      request,
      capabilityAwareProvider('provider-no', false)
    );
    expect(positive.supported).toBe(true);
    expect(negative.supported).toBe(false);
  });

  it('13. execution-only provider is treated as eligible', () => {
    const request = validRequest();
    const result = evaluateTripExecutionCapability(request, executionOnlyProvider('provider-only'));
    expect(result.supported).toBe(true);
    expect(result.providerId).toBe('provider-only');
  });

  it('13b. eligibility is capability-unknown presumed eligible for a plain provider', () => {
    const request = validRequest();
    const plain = { providerId: 'plain-id', execute: async () => ({}) };
    const result = evaluateTripExecutionCapability(request, plain as never);
    expect(result.supported).toBe(true);
  });

  it('14. capability check does not call execute', () => {
    const log: string[] = [];
    const request = validRequest();
    evaluateTripExecutionCapability(request, capabilityAwareProvider('provider-a', true, log));
    evaluateTripExecutionCapability(request, capabilityAwareProvider('provider-b', false, log));
    evaluateTripExecutionCapability(request, executionOnlyProvider('provider-c', log));
    expect(log).toEqual(['supports:provider-a', 'supports:provider-b']);
  });

  it('15. capability check does not mutate the request', () => {
    const request = validRequest();
    const snapshot = JSON.stringify(request);
    evaluateTripExecutionCapability(request, capabilityAwareProvider('provider-a', true));
    expect(JSON.stringify(request)).toBe(snapshot);
  });

  it('16. capability check does not mutate the provider', () => {
    const provider = capabilityAwareProvider('provider-a', true);
    const snapshot = JSON.stringify(provider);
    evaluateTripExecutionCapability(validRequest(), provider);
    expect(JSON.stringify(provider)).toBe(snapshot);
  });

  it('17. repeated evaluation is deterministic', () => {
    const request = validRequest();
    const provider = capabilityAwareProvider('provider-a', true);
    const first = evaluateTripExecutionCapability(request, provider);
    const again = evaluateTripExecutionCapability(JSON.parse(JSON.stringify(request)), provider);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });
});

describe('STEP 62 capability: mock provider integration', () => {
  it('18. valid mock provider is supported', () => {
    const result = evaluateTripExecutionCapability(validRequest(), mockTripExecutionProvider);
    expect(result.supported).toBe(true);
    expect(result.providerId).toBe('mock-execution');
    expect(result.requestId).toBe(validRequest().id);
  });

  it('19. malformed request against mock is unsupported', () => {
    const result = evaluateTripExecutionCapability(
      { id: 'bad', kind: 'bad', dispatchId: 'bad' },
      mockTripExecutionProvider
    );
    expect(result.supported).toBe(false);
  });

  it('20. mock execution behavior remains accepted', async () => {
    const result = await mockTripExecutionProvider.execute(validRequest());
    expect(result.status).toBe('accepted');
    expect(result.providerId).toBe('mock-execution');
  });

  it('21. mock invalid execution remains rejected', async () => {
    const result = await mockTripExecutionProvider.execute({ id: 'bad', kind: 'bad' } as never);
    expect(result.status).toBe('rejected');
  });
});

describe('STEP 62 capability: module boundary and determinism', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionCapability.ts'),
    'utf8'
  );

  it('imports only the shared identity bound and the STEP 59 contract', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionProvider',
    ]);
  });

  it('22. no booking information', () => {
    expect(source).not.toMatch(/createBooking|bookingRef|reservationId|ticketNumber|confirmationCode/i);
  });

  it('23. no payment information', () => {
    expect(source).not.toMatch(/charge|payment-intent|checkout|paymentMethod|\bstripe\b|refund|invoice/i);
    expect(source).not.toMatch(/paid|amount|currency|price/i);
  });

  it('24. no inventory information', () => {
    expect(source).not.toMatch(/inventoryCount|stockLevel|priceList|seatClass/i);
  });

  it('25. no provider credentials', () => {
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|Bearer\s|x-goog-api-key/i);
    expect(source).not.toMatch(/providerUrl|externalRef|authorizationHeader/i);
  });

  it('26. no network and 37. no persistence', () => {
    expect(source).not.toMatch(/fetch\s*\(|axios|new\s+WebSocket|XMLHttpRequest/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getFirestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/i);
  });

  it('27. no Firebase and 28. no Google dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/googlePlaces|googleDiscovery|googlePlacesService/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(googleRoutes|googlePlaces)/i);
  });

  it('29. no Google Routes and 30. no Amadeus dependency', () => {
    expect(source).not.toMatch(/googleRoutes|googleRoutesService/i);
    expect(source).not.toMatch(/amadeus|realDiscovery/i);
  });

  it('31. no AI dependency', () => {
    expect(source).not.toMatch(/gemini|aiPlanningService|generativeLanguage|aiTravelAgent/i);
  });

  it('32. no environment dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env|\benv\s*\(/i);
  });

  it('33. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(|new\s+Date\(/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime|setTimeout|setInterval/i);
  });

  it('34. no randomness', () => {
    expect(source).not.toMatch(/Math\.random|crypto\.randomUUID|\buuid\b/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\.|globalThis/i);
  });

  it('35. no global mutable state', () => {
    expect(source).not.toMatch(/let\s+\w+\s*=\s*0|var\s+\w+\s*=\s*0/i);
    expect(source).not.toMatch(/useState\(|setState\(|moduleScope|\bcounters?\b/i);
    expect(source).not.toMatch(/increment\(|\+\+/i);
  });

  it('36. no provider execution (execute is never called)', () => {
    expect(source).not.toMatch(/\.execute\(/);
    expect(source).not.toMatch(/provider\.execute|await\s+\w+\.execute/i);
  });

  it('38. no trip mutation and 39. no itinerary mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/i);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/i);
  });

  it('40. no new execution lifecycle statuses', () => {
    expect(source).not.toMatch(/executing|pending-execution|completed|cancelled|refunded/i);
    expect(source).not.toMatch(/\bbooked\b|\bexecuted\b|executionStatus|markApply/i);
  });

  it('no provider filtering, orchestration change, retry, or rollback', () => {
    expect(source).not.toMatch(/orchestrateTripExecution|selectProvider|providerRegistry/i);
    expect(source).not.toMatch(/retry|backoff|deadLetter|rollback|compensa/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.?[\\/](components|pages)/i);
  });

  it('result never carries extra sensitive fields', () => {
    const result = evaluateTripExecutionCapability(validRequest(), capabilityAwareProvider('p', true));
    const keys = Object.keys(result);
    expect(keys).toEqual(['providerId', 'requestId', 'supported']);
    const serialized = JSON.stringify(result);
    for (const token of ['booking', 'payment', 'price', 'stripe', 'secret', 'token', 'http']) {
      expect(serialized.toLowerCase().includes(token)).toBe(false);
    }
  });
});