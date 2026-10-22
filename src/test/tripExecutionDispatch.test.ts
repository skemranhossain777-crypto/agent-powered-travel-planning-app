import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
  createTripExecutionDispatchInstruction,
  getTripExecutionDispatchId,
  isTripExecutionDispatchInstruction,
  type TripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripPlanningExecutionRequest,
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

function validAuthorization(): TripPlanningExecutionAuthorization {
  return createTripPlanningExecutionAuthorization(
    validRequest()
  ) as TripPlanningExecutionAuthorization;
}

function tamperedInstruction(overrides: Record<string, unknown>): Record<string, unknown> {
  const authorization = validAuthorization();
  return {
    id: getTripExecutionDispatchId(authorization.id),
    kind: TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
    authorizationId: authorization.id,
    ...overrides,
  };
}

describe('STEP 58 dispatch: structure and identity', () => {
  it('1. valid authorization creates dispatch instruction', () => {
    const instruction = createTripExecutionDispatchInstruction(validAuthorization());
    expect(instruction).not.toBeNull();
    expect(instruction?.kind).toBe(TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND);
  });

  it('2. deterministic dispatch ID', () => {
    const authorization = validAuthorization();
    const instruction = createTripExecutionDispatchInstruction(authorization);
    expect(instruction?.id).toBe(`${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${authorization.id}`);
    expect(instruction?.id).toBe(getTripExecutionDispatchId(authorization.id));
    expect(instruction?.id).toMatch(
      new RegExp(`^${TRIP_EXECUTION_DISPATCH_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact dispatch kind', () => {
    expect(TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND).toBe('trip-execution-dispatch-instruction');
    expect(createTripExecutionDispatchInstruction(validAuthorization())?.kind).toBe(
      TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND
    );
  });

  it('4. authorizationId preserved', () => {
    const authorization = validAuthorization();
    const instruction = createTripExecutionDispatchInstruction(authorization);
    expect(instruction?.authorizationId).toBe(authorization.id);
  });

  it('5. fresh instruction value', () => {
    const authorization = validAuthorization();
    const instruction = createTripExecutionDispatchInstruction(
      authorization
    ) as TripExecutionDispatchInstruction;
    expect(instruction).not.toBe(authorization);
    expect(JSON.stringify(instruction)).not.toBe(JSON.stringify(authorization));
  });

  it('36. fresh output on repeated valid creation', () => {
    const authorization = validAuthorization();
    const first = createTripExecutionDispatchInstruction(
      authorization
    ) as TripExecutionDispatchInstruction;
    const second = createTripExecutionDispatchInstruction(
      authorization
    ) as TripExecutionDispatchInstruction;
    expect(Object.is(first, second)).toBe(false);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('6. authorization input not mutated', () => {
    const authorization = validAuthorization();
    const snapshot = JSON.stringify(authorization);
    expect(createTripExecutionDispatchInstruction(authorization)).not.toBeNull();
    expect(JSON.stringify(authorization)).toBe(snapshot);
  });

  it('7. repeated creation is deterministic', () => {
    const authorization = validAuthorization();
    const first = createTripExecutionDispatchInstruction(authorization);
    const again = createTripExecutionDispatchInstruction(authorization);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('35. deterministic validator behavior', () => {
    const instruction = createTripExecutionDispatchInstruction(validAuthorization());
    expect(isTripExecutionDispatchInstruction(instruction)).toBe(true);
    expect(
      isTripExecutionDispatchInstruction(JSON.parse(JSON.stringify(instruction)))
    ).toBe(true);
    expect(isTripExecutionDispatchInstruction(instruction)).toBe(true);
  });

  it('dispatch id space is distinct from the authorization id space', () => {
    expect(TRIP_EXECUTION_DISPATCH_ID_PREFIX).not.toBe(TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX);
    expect(getTripExecutionDispatchId('i')).not.toBe('i');
  });

  it('authorization id derivability is enforced (no reassignment)', () => {
    const instruction = tamperedInstruction({});
    expect(
      isTripExecutionDispatchInstruction({
        ...instruction,
        authorizationId: instruction.id,
      })
    ).toBe(false);
  });
});

describe('STEP 58 dispatch: rejection', () => {
  it('8. malformed authorization rejected', () => {
    expect(createTripExecutionDispatchInstruction(null as never)).toBeNull();
    expect(createTripExecutionDispatchInstruction(undefined as never)).toBeNull();
    expect(createTripExecutionDispatchInstruction({} as never)).toBeNull();
    expect(createTripExecutionDispatchInstruction('trip-planning-execution-authorization:x' as never)).toBeNull();
    expect(createTripExecutionDispatchInstruction(42 as never)).toBeNull();
    const authorization = validAuthorization();
    expect(createTripExecutionDispatchInstruction({ ...authorization, kind: 'other' } as never)).toBeNull();
    expect(createTripExecutionDispatchInstruction({ ...authorization, id: 'stray' } as never)).toBeNull();
  });

  it('9. malformed authorization ID rejected', () => {
    expect(
      isTripExecutionDispatchInstruction({
        id: TRIP_EXECUTION_DISPATCH_ID_PREFIX + TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX + 'x',
        kind: TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
        authorizationId: 7,
      })
    ).toBe(false);
    const instruction = tamperedInstruction({ authorizationId: '' });
    expect(isTripExecutionDispatchInstruction(instruction)).toBe(false);
    const notPrefixed = tamperedInstruction({ authorizationId: 'authorization:abc' });
    expect(isTripExecutionDispatchInstruction(notPrefixed)).toBe(false);
  });

  it('10. missing authorizationId rejected', () => {
    expect(isTripExecutionDispatchInstruction(tamperedInstruction({ authorizationId: undefined }))).toBe(
      false
    );
    const removed = {
      kind: tamperedInstruction({}).kind,
      id: tamperedInstruction({}).id,
    };
    expect(isTripExecutionDispatchInstruction(removed)).toBe(false);
  });

  it('11. wrong kind rejected', () => {
    const instruction = tamperedInstruction({});
    expect(isTripExecutionDispatchInstruction({ ...instruction, kind: 'other' })).toBe(false);
    expect(
      isTripExecutionDispatchInstruction({
        ...instruction,
        kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
      })
    ).toBe(false);
  });

  it('12. incorrect deterministic dispatch ID rejected', () => {
    const instruction = tamperedInstruction({});
    expect(
      isTripExecutionDispatchInstruction({ ...instruction, id: 'trip-execution-dispatch:other' })
    ).toBe(false);
    expect(isTripExecutionDispatchInstruction({ ...instruction, id: instruction.authorizationId })).toBe(
      false
    );
    expect(isTripExecutionDispatchInstruction({ ...instruction, id: undefined })).toBe(false);
  });

  it('13. prefix-only authorization ID rejected', () => {
    const authorizationId = TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX;
    expect(
      isTripExecutionDispatchInstruction({
        id: `${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${authorizationId}`,
        kind: TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
        authorizationId,
      })
    ).toBe(false);
  });

  it('malformed instruction object rejected', () => {
    expect(isTripExecutionDispatchInstruction(null)).toBe(false);
    expect(isTripExecutionDispatchInstruction(undefined)).toBe(false);
    expect(isTripExecutionDispatchInstruction({})).toBe(false);
    expect(isTripExecutionDispatchInstruction('x')).toBe(false);
    expect(isTripExecutionDispatchInstruction(['x'])).toBe(false);
    expect(isTripExecutionDispatchInstruction(7)).toBe(false);
  });
});

describe('STEP 58 dispatch: data shape and provider neutrality', () => {
  it('15. instruction contains only required identifiers', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    expect(Object.keys(instruction).sort()).toEqual(['authorizationId', 'id', 'kind']);
  });

  it('14. provider-neutral instruction accepted', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    const serialized = JSON.stringify(instruction);
    expect(serialized).not.toMatch(
      /google|googleRoutes|amadeus|placeId|providerId|latitude|longitude|apiKey/i
    );
    expect(serialized).not.toContain('"requestId"');
    expect(serialized).not.toContain('"intentId"');
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('"tripId"');
    expect(serialized).not.toContain('"provider"');
  });

  it('16. no duplicated authorization object', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    expect(instruction).not.toHaveProperty('requestId');
    expect(JSON.stringify(instruction)).not.toBe(JSON.stringify(validAuthorization()));
  });

  it('17. no request duplication', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    expect(instruction).not.toHaveProperty('intentId');
    expect(Object.keys(instruction).sort()).toEqual(['authorizationId', 'id', 'kind']);
  });

  it('18. no execution-intent duplication', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    expect(instruction).not.toHaveProperty('bindingId');
    expect(Object.keys(instruction).sort()).toEqual(['authorizationId', 'id', 'kind']);
  });

  it('19. no binding duplication', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    expect(instruction).not.toHaveProperty('applicationId');
    expect(instruction).not.toHaveProperty('targetId');
    expect(Object.keys(instruction).sort()).toEqual(['authorizationId', 'id', 'kind']);
  });

  it('20. no application duplication and 21. no target duplication', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    const serialized = JSON.stringify(instruction);
    expect(serialized).not.toContain('"originReferenceId"');
    expect(serialized).not.toContain('"compositionId"');
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('"tripId"');
  });

  it('22. no composition duplication', () => {
    const instruction = createTripExecutionDispatchInstruction(
      validAuthorization()
    ) as TripExecutionDispatchInstruction;
    const serialized = JSON.stringify(instruction);
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('"destination"');
    expect(serialized).not.toContain('"transport"');
  });
});

describe('STEP 58 dispatch: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionDispatch.ts'),
    'utf8'
  );

  it('imports only the STEP 57 domain authorization contract', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['../../domain/trips/tripPlanningExecutionAuthorization']);
  });

  it('25. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore|getFirestoreInstance/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(firestoreService|dataConnectService|authService)/i);
  });

  it('23 and 34. no provider dependency and no automatic provider selection', () => {
    expect(source).not.toMatch(
      /from\s+['"][^'"]*(axios|googleDiscovery|googleRoutes|realDiscovery|mockDiscovery|amadeus)/i
    );
    expect(source).not.toMatch(
      /googlePlacesAdapter|googleRoutesAdapter|amadeusAdapter|realDiscoveryService|mockDiscoveryService/i
    );
    expect(source).not.toMatch(/serverDiscoveryClient|serverBoundary/i);
    expect(source).not.toMatch(
      /createProviderAdapter|selectProvider|defaultProvider|providerRegistry|lookupProvider|getAdapterFor|providerFactory/i
    );
    expect(source).not.toMatch(/executeProvider|callProvider|runAdapter|sendTo|dispatchTo/i);
  });

  it('24. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('26. no network dependency and no transport details', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiEndpoint|requestMethod|httpMethod/i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('27. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('28. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('29. no booking behavior and 30. no payment behavior', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking|refund/i);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout|\bstripe\b|paymentMethod/i);
  });

  it('31. no provider execution and no execution side effects', () => {
    expect(source).not.toMatch(/invoke\s*\(|launch\s*\(|executeProvider/i);
    expect(source).not.toMatch(/setInterval|setTimeout|onCall/i);
  });

  it('no execution-lifecycle statuses, retries, rollback, or compensation', () => {
    expect(source).not.toMatch(/pending-execution|executing|markApply|markApplied|executionStatus/i);
    expect(source).not.toMatch(/failed|cancelled|retryCount|externalRequestId|externalId/i);
    expect(source).not.toMatch(/retry|rollback|compensa/i);
  });

  it('32. no itinerary mutation and 33. no trip mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('no automatic execution entrypoints', () => {
    expect(source).not.toMatch(/system\.on|process\.on|app\.use\(|listen\(/i);
    expect(source).not.toMatch(/startExecution|beginExecution|fire\(|emit\(/i);
  });
});