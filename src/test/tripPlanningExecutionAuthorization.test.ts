import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
  createTripPlanningExecutionAuthorization,
  getTripPlanningExecutionAuthorizationId,
  isTripPlanningExecutionAuthorization,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripPlanningExecutionRequest,
  TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_REQUEST_KIND,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionIntent,
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

function validRequest(): TripPlanningExecutionRequest {
  return createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
}

function tamperedAuthorization(overrides: Record<string, unknown>): Record<string, unknown> {
  const request = validRequest();
  return {
    id: getTripPlanningExecutionAuthorizationId(request.id),
    kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
    requestId: request.id,
    ...overrides,
  };
}

describe('STEP 57 authorization: structure and identity', () => {
  it('1. valid execution request creates authorization', () => {
    const authorization = createTripPlanningExecutionAuthorization(validRequest());
    expect(authorization).not.toBeNull();
    expect(authorization?.kind).toBe(TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND);
  });

  it('2. deterministic authorization ID', () => {
    const request = validRequest();
    const authorization = createTripPlanningExecutionAuthorization(request);
    expect(authorization?.id).toBe(
      `${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}${request.id}`
    );
    expect(authorization?.id).toBe(getTripPlanningExecutionAuthorizationId(request.id));
    expect(authorization?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact authorization kind', () => {
    expect(TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND).toBe('trip-planning-execution-authorization');
    expect(createTripPlanningExecutionAuthorization(validRequest())?.kind).toBe(
      TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND
    );
  });

  it('4. requestId preserved', () => {
    const request = validRequest();
    const authorization = createTripPlanningExecutionAuthorization(request);
    expect(authorization?.requestId).toBe(request.id);
  });

  it('5. fresh authorization value', () => {
    const request = validRequest();
    const authorization = createTripPlanningExecutionAuthorization(
      request
    ) as TripPlanningExecutionAuthorization;
    expect(authorization).not.toBe(request);
    expect(JSON.stringify(authorization)).not.toBe(JSON.stringify(request));
  });

  it('36. fresh output on repeated valid creation', () => {
    const request = validRequest();
    const first = createTripPlanningExecutionAuthorization(
      request
    ) as TripPlanningExecutionAuthorization;
    const second = createTripPlanningExecutionAuthorization(
      request
    ) as TripPlanningExecutionAuthorization;
    expect(Object.is(first, second)).toBe(false);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('6. request input not mutated', () => {
    const request = validRequest();
    const snapshot = JSON.stringify(request);
    expect(createTripPlanningExecutionAuthorization(request)).not.toBeNull();
    expect(JSON.stringify(request)).toBe(snapshot);
  });

  it('7. repeated creation is deterministic', () => {
    const request = validRequest();
    const first = createTripPlanningExecutionAuthorization(request);
    const again = createTripPlanningExecutionAuthorization(request);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('35. deterministic validator behavior', () => {
    const authorization = createTripPlanningExecutionAuthorization(validRequest());
    expect(isTripPlanningExecutionAuthorization(authorization)).toBe(true);
    expect(
      isTripPlanningExecutionAuthorization(JSON.parse(JSON.stringify(authorization)))
    ).toBe(true);
    expect(isTripPlanningExecutionAuthorization(authorization)).toBe(true);
  });

  it('authorization id space is distinct from the request id space', () => {
    expect(TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX).not.toBe(
      TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX
    );
    expect(getTripPlanningExecutionAuthorizationId('i')).not.toBe('i');
  });

  it('request id derivability is enforced (no reassignment)', () => {
    const authorization = tamperedAuthorization({});
    expect(
      isTripPlanningExecutionAuthorization({ ...authorization, requestId: authorization.id })
    ).toBe(false);
  });
});

describe('STEP 57 authorization: rejection', () => {
  it('8. malformed request rejected', () => {
    expect(createTripPlanningExecutionAuthorization(null as never)).toBeNull();
    expect(createTripPlanningExecutionAuthorization(undefined as never)).toBeNull();
    expect(createTripPlanningExecutionAuthorization({} as never)).toBeNull();
    expect(createTripPlanningExecutionAuthorization('trip-planning-execution-request:x' as never)).toBeNull();
    expect(createTripPlanningExecutionAuthorization(42 as never)).toBeNull();
    const request = validRequest();
    expect(createTripPlanningExecutionAuthorization({ ...request, kind: 'other' } as never)).toBeNull();
    expect(createTripPlanningExecutionAuthorization({ ...request, id: 'stray' } as never)).toBeNull();
  });

  it('9. malformed request ID rejected', () => {
    expect(
      isTripPlanningExecutionAuthorization({
        id: TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX + TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX + 'x',
        kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
        requestId: 7,
      })
    ).toBe(false);
    const authorization = tamperedAuthorization({ requestId: '' });
    expect(isTripPlanningExecutionAuthorization(authorization)).toBe(false);
    const notPrefixed = tamperedAuthorization({ requestId: 'request:abc' });
    expect(isTripPlanningExecutionAuthorization(notPrefixed)).toBe(false);
  });

  it('10. missing requestId rejected', () => {
    expect(isTripPlanningExecutionAuthorization(tamperedAuthorization({ requestId: undefined }))).toBe(
      false
    );
    const removed = { kind: tamperedAuthorization({}).kind, id: tamperedAuthorization({}).id };
    expect(isTripPlanningExecutionAuthorization(removed)).toBe(false);
  });

  it('11. wrong kind rejected', () => {
    const authorization = tamperedAuthorization({});
    expect(isTripPlanningExecutionAuthorization({ ...authorization, kind: 'other' })).toBe(false);
    expect(
      isTripPlanningExecutionAuthorization({ ...authorization, kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND })
    ).toBe(false);
  });

  it('12. incorrect deterministic authorization ID rejected', () => {
    const authorization = tamperedAuthorization({});
    expect(
      isTripPlanningExecutionAuthorization({ ...authorization, id: 'trip-planning-execution-authorization:other' })
    ).toBe(false);
    expect(isTripPlanningExecutionAuthorization({ ...authorization, id: authorization.requestId })).toBe(
      false
    );
    expect(isTripPlanningExecutionAuthorization({ ...authorization, id: undefined })).toBe(false);
  });

  it('13. prefix-only request ID rejected', () => {
    const requestId = TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX;
    expect(
      isTripPlanningExecutionAuthorization({
        id: `${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}${requestId}`,
        kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
        requestId,
      })
    ).toBe(false);
  });

  it('malformed authorization object rejected', () => {
    expect(isTripPlanningExecutionAuthorization(null)).toBe(false);
    expect(isTripPlanningExecutionAuthorization(undefined)).toBe(false);
    expect(isTripPlanningExecutionAuthorization({})).toBe(false);
    expect(isTripPlanningExecutionAuthorization('x')).toBe(false);
    expect(isTripPlanningExecutionAuthorization(['x'])).toBe(false);
    expect(isTripPlanningExecutionAuthorization(7)).toBe(false);
  });
});

describe('STEP 57 authorization: data shape and provider neutrality', () => {
  it('15. authorization contains only required identifiers', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    expect(Object.keys(authorization).sort()).toEqual(['id', 'kind', 'requestId']);
  });

  it('14. provider-neutral authorization accepted', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    const serialized = JSON.stringify(authorization);
    expect(serialized).not.toMatch(/google|placeId|providerId|latitude|longitude|apiKey/i);
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('"tripId"');
    expect(serialized).not.toContain('"proposalId"');
    expect(serialized).not.toContain('"intentId"');
    expect(serialized).not.toContain('"bindingId"');
  });

  it('16. no duplicated request object', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    expect(authorization).not.toHaveProperty('intentId');
    expect(JSON.stringify(authorization)).not.toBe(JSON.stringify(validRequest()));
  });

  it('17. no execution-intent duplication', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    expect(authorization).not.toHaveProperty('bindingId');
    expect(Object.keys(authorization).sort()).toEqual(['id', 'kind', 'requestId']);
  });

  it('18. no binding duplication', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    expect(authorization).not.toHaveProperty('applicationId');
    expect(authorization).not.toHaveProperty('targetId');
    expect(Object.keys(authorization).sort()).toEqual(['id', 'kind', 'requestId']);
  });

  it('19. no application duplication and 20. no target duplication', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    const serialized = JSON.stringify(authorization);
    expect(serialized).not.toContain('"originReferenceId"');
    expect(serialized).not.toContain('"compositionId"');
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('"tripId"');
  });

  it('21. no composition duplication', () => {
    const authorization = createTripPlanningExecutionAuthorization(
      validRequest()
    ) as TripPlanningExecutionAuthorization;
    const serialized = JSON.stringify(authorization);
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('"destination"');
    expect(serialized).not.toContain('"transport"');
  });
});

describe('STEP 57 authorization: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningExecutionAuthorization.ts'),
    'utf8'
  );

  it('imports only the adjacent STEP 56 pure domain request module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripPlanningExecutionRequest']);
  });

  it('24. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore|getFirestoreInstance/i);
  });

  it('22. no provider dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|x-goog-api-key|\bAuthorization\b/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|serverBoundary/i);
    expect(source).not.toMatch(/amadeus|googlePlacesService|googleRoutesApi/i);
  });

  it('23. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('25. no network dependency', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('33. no user/auth/ACL dependency', () => {
    expect(source).not.toMatch(/react-native-google-signin|@react-native-firebase[/\\]auth/i);
    expect(source).not.toMatch(/firebaseAuth|onAuthStateChanged|signInWith|signOut\(|createUserWith|getAuth\(|updateProfile|getIdToken/i);
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|Bearer\s|authorizationHeader|AppCheck/i);
    expect(source).not.toMatch(/\bOAuth\b|\bACL\b|\bRBAC\b|permissionRoles|userRoles|roleBased|identityProvider|subject:|userId:|uid:/i);
  });

  it('no expiry, revocation, renewal, or validity machinery', () => {
    expect(source).not.toMatch(/expiresAt|revokedAt|expiry|revocation|renew|validFor|\bttl\b|slidingWindow/i);
  });

  it('26. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('27. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('28. no booking creation and 29. no payment behavior', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking/i);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout|stripe|paymentMethod/i);
  });

  it('30. no provider execution and no execution-side-effect dispatch', () => {
    expect(source).not.toMatch(/dispatch|executeNow|runNow|executeAll|invoke\s*\(/i);
    expect(source).not.toMatch(/setInterval|setTimeout|onCall/i);
  });

  it('no execution-lifecycle statuses, retries, rollback, or compensation', () => {
    expect(source).not.toMatch(/pending-execution|executing|markApply|markApplied|executionStatus/i);
    expect(source).not.toMatch(/failed|cancelled|retryCount|externalRequestId|externalId/i);
    expect(source).not.toMatch(/retry|rollback|compensa/i);
  });

  it('31. no itinerary mutation and 32. no trip mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('34. no automatic execution', () => {
    expect(source).not.toMatch(/system\.on|process\.on|app\.use\(|listen\(/i);
    expect(source).not.toMatch(/startExecution|beginExecution|fire\(|emit\(/i);
  });
});