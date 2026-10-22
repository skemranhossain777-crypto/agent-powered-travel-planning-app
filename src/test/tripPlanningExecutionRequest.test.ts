import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_REQUEST_KIND,
  createTripPlanningExecutionRequest,
  getTripPlanningExecutionRequestId,
  isTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionIntent,
  TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_INTENT_KIND,
  type TripPlanningExecutionIntent,
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

function validTarget(): TripPlanningApplicationTarget {
  return createTripPlanningApplicationTarget({ scope: 'trip', tripId: 'trip-abc' }) as TripPlanningApplicationTarget;
}

function validBinding(): TripPlanningApplicationBinding {
  return createTripPlanningApplicationBinding(validApplication(), validTarget()) as TripPlanningApplicationBinding;
}

function validIntent(): TripPlanningExecutionIntent {
  return createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
}

function tamperedRequest(overrides: Record<string, unknown>): Record<string, unknown> {
  const intent = validIntent();
  return {
    id: getTripPlanningExecutionRequestId(intent.id),
    kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND,
    intentId: intent.id,
    ...overrides,
  };
}

describe('STEP 56 request: structure and identity', () => {
  it('1. valid execution intent creates request', () => {
    const request = createTripPlanningExecutionRequest(validIntent());
    expect(request).not.toBeNull();
    expect(request?.kind).toBe(TRIP_PLANNING_EXECUTION_REQUEST_KIND);
  });

  it('2. deterministic request ID', () => {
    const intent = validIntent();
    const request = createTripPlanningExecutionRequest(intent);
    expect(request?.id).toBe(
      `${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}${intent.id}`
    );
    expect(request?.id).toBe(getTripPlanningExecutionRequestId(intent.id));
    expect(request?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact request kind', () => {
    expect(TRIP_PLANNING_EXECUTION_REQUEST_KIND).toBe('trip-planning-execution-request');
    expect(createTripPlanningExecutionRequest(validIntent())?.kind).toBe(
      TRIP_PLANNING_EXECUTION_REQUEST_KIND
    );
  });

  it('4. intentId preserved', () => {
    const intent = validIntent();
    const request = createTripPlanningExecutionRequest(intent);
    expect(request?.intentId).toBe(intent.id);
  });

  it('5. fresh request value', () => {
    const intent = validIntent();
    const request = createTripPlanningExecutionRequest(intent) as TripPlanningExecutionRequest;
    expect(request).not.toBe(intent);
    expect(JSON.stringify(request)).not.toBe(JSON.stringify(intent));
  });

  it('34. fresh output on repeated valid creation', () => {
    const intent = validIntent();
    const first = createTripPlanningExecutionRequest(intent) as TripPlanningExecutionRequest;
    const second = createTripPlanningExecutionRequest(intent) as TripPlanningExecutionRequest;
    expect(Object.is(first, second)).toBe(false);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('6. intent input not mutated', () => {
    const intent = validIntent();
    const snapshot = JSON.stringify(intent);
    expect(createTripPlanningExecutionRequest(intent)).not.toBeNull();
    expect(JSON.stringify(intent)).toBe(snapshot);
  });

  it('7. repeated creation is deterministic', () => {
    const intent = validIntent();
    const first = createTripPlanningExecutionRequest(intent);
    const again = createTripPlanningExecutionRequest(intent);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('33. deterministic validator behavior', () => {
    const request = createTripPlanningExecutionRequest(validIntent());
    expect(isTripPlanningExecutionRequest(request)).toBe(true);
    expect(isTripPlanningExecutionRequest(JSON.parse(JSON.stringify(request)))).toBe(true);
    expect(isTripPlanningExecutionRequest(request)).toBe(true);
  });

  it('request id space is distinct from the intent id space', () => {
    expect(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX).not.toBe(TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX);
    expect(getTripPlanningExecutionRequestId('i')).not.toBe('i');
  });
});

describe('STEP 56 request: rejection', () => {
  it('8. malformed intent rejected', () => {
    expect(createTripPlanningExecutionRequest(null as never)).toBeNull();
    expect(createTripPlanningExecutionRequest(undefined as never)).toBeNull();
    expect(createTripPlanningExecutionRequest({} as never)).toBeNull();
    expect(createTripPlanningExecutionRequest('trip-planning-execution-intent:x' as never)).toBeNull();
    expect(createTripPlanningExecutionRequest(42 as never)).toBeNull();
    const intent = validIntent();
    expect(createTripPlanningExecutionRequest({ ...intent, kind: 'other' } as never)).toBeNull();
    expect(createTripPlanningExecutionRequest({ ...intent, id: 'stray' } as never)).toBeNull();
  });

  it('9. malformed intent ID rejected', () => {
    expect(
      isTripPlanningExecutionRequest({
        id: TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX + TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX + 'x',
        kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND,
        intentId: 7,
      })
    ).toBe(false);
    const request = tamperedRequest({ intentId: '' });
    expect(isTripPlanningExecutionRequest(request)).toBe(false);
    const notPrefixed = tamperedRequest({ intentId: 'intent:abc' });
    expect(isTripPlanningExecutionRequest(notPrefixed)).toBe(false);
  });

  it('10. missing intentId rejected', () => {
    expect(isTripPlanningExecutionRequest(tamperedRequest({ intentId: undefined }))).toBe(false);
    const removed = { kind: tamperedRequest({}).kind, id: tamperedRequest({}).id };
    expect(isTripPlanningExecutionRequest(removed)).toBe(false);
  });

  it('11. wrong kind rejected', () => {
    const request = tamperedRequest({});
    expect(isTripPlanningExecutionRequest({ ...request, kind: 'other' })).toBe(false);
    expect(isTripPlanningExecutionRequest({ ...request, kind: TRIP_PLANNING_EXECUTION_INTENT_KIND })).toBe(
      false
    );
  });

  it('12. incorrect deterministic request ID rejected', () => {
    const request = tamperedRequest({});
    expect(isTripPlanningExecutionRequest({ ...request, id: 'trip-planning-execution-request:other' })).toBe(false);
    expect(isTripPlanningExecutionRequest({ ...request, id: request.intentId })).toBe(false);
    expect(isTripPlanningExecutionRequest({ ...request, id: undefined })).toBe(false);
  });

  it('13. prefix-only intent ID rejected', () => {
    const intentId = TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX;
    expect(
      isTripPlanningExecutionRequest({
        id: `${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}${intentId}`,
        kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND,
        intentId,
      })
    ).toBe(false);
  });

  it('malformed request object rejected', () => {
    expect(isTripPlanningExecutionRequest(null)).toBe(false);
    expect(isTripPlanningExecutionRequest(undefined)).toBe(false);
    expect(isTripPlanningExecutionRequest({})).toBe(false);
    expect(isTripPlanningExecutionRequest('x')).toBe(false);
    expect(isTripPlanningExecutionRequest(['x'])).toBe(false);
    expect(isTripPlanningExecutionRequest(7)).toBe(false);
  });

  it('intent id derivability is enforced (no reassignment)', () => {
    const request = tamperedRequest({});
    expect(isTripPlanningExecutionRequest({ ...request, intentId: request.id })).toBe(false);
  });
});

describe('STEP 56 request: data shape and provider neutrality', () => {
  it('15. request contains only required identifiers', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    expect(Object.keys(request).sort()).toEqual(['id', 'intentId', 'kind']);
  });

  it('14. provider-neutral request accepted', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toMatch(/google|placeId|providerId|latitude|longitude|apiKey/i);
    expect(serialized).not.toContain('scope');
    expect(serialized).not.toContain('tripId');
    expect(serialized).not.toContain('proposalId');
  });

  it('16. no duplicated intent object', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    expect(request).not.toHaveProperty('bindingId');
    expect(JSON.stringify(request)).not.toBe(JSON.stringify(validIntent()));
  });

  it('17. no binding duplication', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    expect(request).not.toHaveProperty('applicationId');
    expect(request).not.toHaveProperty('targetId');
    expect(request).not.toHaveProperty('bindingId');
    expect(Object.keys(request).sort()).toEqual(['id', 'intentId', 'kind']);
  });

  it('18. no application duplication and 19. no target duplication', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('originReferenceId');
    expect(serialized).not.toContain('compositionId');
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('tripId');
  });

  it('20. no composition duplication', () => {
    const request = createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('origin');
    expect(serialized).not.toContain('destination');
    expect(serialized).not.toContain('transport');
  });
});

describe('STEP 56 request: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningExecutionRequest.ts'),
    'utf8'
  );

  it('imports only the adjacent STEP 55 pure domain intent module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripPlanningExecutionIntent']);
  });

  it('23. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore|getFirestoreInstance/i);
  });

  it('21. no provider dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|serverBoundary/i);
    expect(source).not.toMatch(/amadeus|googlePlacesService|googleRoutesApi/i);
  });

  it('22. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('24. no network dependency', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('25. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('26. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('27. no booking creation and 28. no payment behavior', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking/i);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout|stripe|paymentMethod/i);
  });

  it('29. no provider execution and no execution-side-effect dispatch', () => {
    expect(source).not.toMatch(/dispatch|executeNow|runNow|executeAll|invoke\s*\(/i);
    expect(source).not.toMatch(/setInterval|setTimeout|onCall/i);
  });

  it('no execution-lifecycle statuses, retries, rollback, or compensation', () => {
    expect(source).not.toMatch(/pending-execution|executing|markApply|markApplied|executionStatus/i);
    expect(source).not.toMatch(/failed|cancelled|retryCount|externalRequestId|externalId/i);
    expect(source).not.toMatch(/retry|rollback|compensa/i);
  });

  it('30. no itinerary mutation and 31. no trip mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('32. no automatic execution', () => {
    expect(source).not.toMatch(/system\.on|process\.on|app\.use\(|listen\(/i);
    expect(source).not.toMatch(/startExecution|beginExecution|fire\(|emit\(/i);
  });
});