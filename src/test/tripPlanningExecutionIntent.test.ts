import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_INTENT_KIND,
  createTripPlanningExecutionIntent,
  getTripPlanningExecutionIntentId,
  isTripPlanningExecutionIntent,
  type TripPlanningExecutionIntent,
} from '../domain/trips/tripPlanningExecutionIntent';
import {
  createTripPlanningApplicationBinding,
  TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX,
  TRIP_PLANNING_APPLICATION_BINDING_KIND,
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

function tamperedIntent(overrides: Record<string, unknown>): Record<string, unknown> {
  const binding = validBinding();
  return {
    id: getTripPlanningExecutionIntentId(binding.id),
    kind: TRIP_PLANNING_EXECUTION_INTENT_KIND,
    bindingId: binding.id,
    ...overrides,
  };
}

describe('STEP 55 intent: structure and identity', () => {
  it('1. valid binding creates execution intent', () => {
    const intent = createTripPlanningExecutionIntent(validBinding());
    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe(TRIP_PLANNING_EXECUTION_INTENT_KIND);
  });

  it('2. deterministic intent ID', () => {
    const binding = validBinding();
    const intent = createTripPlanningExecutionIntent(binding);
    expect(intent?.id).toBe(
      `${TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX}${binding.id}`
    );
    expect(intent?.id).toBe(getTripPlanningExecutionIntentId(binding.id));
    expect(intent?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact intent kind', () => {
    expect(TRIP_PLANNING_EXECUTION_INTENT_KIND).toBe('trip-planning-execution-intent');
    expect(createTripPlanningExecutionIntent(validBinding())?.kind).toBe(
      TRIP_PLANNING_EXECUTION_INTENT_KIND
    );
  });

  it('4. bindingId preserved', () => {
    const binding = validBinding();
    const intent = createTripPlanningExecutionIntent(binding);
    expect(intent?.bindingId).toBe(binding.id);
    expect(intent?.bindingId).toBe(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX + binding.id.slice(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX.length));
  });

  it('5. fresh intent value', () => {
    const binding = validBinding();
    const intent = createTripPlanningExecutionIntent(binding) as TripPlanningExecutionIntent;
    expect(intent).not.toBe(binding);
    expect(JSON.stringify(intent)).not.toBe(JSON.stringify(binding));
  });

  it('33. fresh output on repeated valid creation', () => {
    const binding = validBinding();
    const first = createTripPlanningExecutionIntent(binding) as TripPlanningExecutionIntent;
    const second = createTripPlanningExecutionIntent(binding) as TripPlanningExecutionIntent;
    expect(Object.is(first, second)).toBe(false);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('6. binding input not mutated', () => {
    const binding = validBinding();
    const snapshot = JSON.stringify(binding);
    expect(createTripPlanningExecutionIntent(binding)).not.toBeNull();
    expect(JSON.stringify(binding)).toBe(snapshot);
  });

  it('7. repeated creation is deterministic', () => {
    const binding = validBinding();
    const first = createTripPlanningExecutionIntent(binding);
    const again = createTripPlanningExecutionIntent(binding);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('32. deterministic validator behavior', () => {
    const intent = createTripPlanningExecutionIntent(validBinding());
    expect(isTripPlanningExecutionIntent(intent)).toBe(true);
    expect(isTripPlanningExecutionIntent(JSON.parse(JSON.stringify(intent)))).toBe(true);
    expect(isTripPlanningExecutionIntent(intent)).toBe(true);
  });

  it('intent id space is distinct from the binding id space', () => {
    expect(TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX).not.toBe(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX);
    expect(getTripPlanningExecutionIntentId('b')).not.toBe('b');
  });
});

describe('STEP 55 intent: rejection', () => {
  it('8. malformed binding rejected', () => {
    expect(createTripPlanningExecutionIntent(null as never)).toBeNull();
    expect(createTripPlanningExecutionIntent(undefined as never)).toBeNull();
    expect(createTripPlanningExecutionIntent({} as never)).toBeNull();
    expect(createTripPlanningExecutionIntent('trip-planning-binding:a:b' as never)).toBeNull();
    expect(createTripPlanningExecutionIntent(42 as never)).toBeNull();
    const binding = validBinding();
    expect(
      createTripPlanningExecutionIntent({ ...binding, kind: 'other' } as never)
    ).toBeNull();
    expect(
      createTripPlanningExecutionIntent({ ...binding, id: 'stray' } as never)
    ).toBeNull();
  });

  it('9. malformed binding ID rejected', () => {
    const binding = validBinding();
    expect(createTripPlanningExecutionIntent({ ...binding, id: '' } as never)).toBeNull();
    expect(isTripPlanningExecutionIntent({ id: 'x', kind: TRIP_PLANNING_EXECUTION_INTENT_KIND, bindingId: 7 })).toBe(
      false
    );
    expect(isTripPlanningExecutionIntent({ id: 'x', kind: TRIP_PLANNING_EXECUTION_INTENT_KIND, bindingId: '' })).toBe(
      false
    );
    expect(
      isTripPlanningExecutionIntent({ id: 'x', kind: TRIP_PLANNING_EXECUTION_INTENT_KIND, bindingId: 'binding:abc' })
    ).toBe(false);
  });

  it('10. missing bindingId rejected', () => {
    const intent = tamperedIntent({ bindingId: undefined });
    expect(isTripPlanningExecutionIntent(intent)).toBe(false);
    const removed = { kind: tamperedIntent({}).kind, id: tamperedIntent({}).id };
    expect(isTripPlanningExecutionIntent(removed)).toBe(false);
  });

  it('11. wrong kind rejected', () => {
    const intent = tamperedIntent({});
    expect(isTripPlanningExecutionIntent({ ...intent, kind: 'other' })).toBe(false);
    expect(isTripPlanningExecutionIntent({ ...intent, kind: TRIP_PLANNING_APPLICATION_BINDING_KIND })).toBe(
      false
    );
  });

  it('12. incorrect deterministic intent ID rejected', () => {
    const intent = tamperedIntent({});
    expect(isTripPlanningExecutionIntent({ ...intent, id: 'trip-planning-execution-intent:other' })).toBe(false);
    expect(isTripPlanningExecutionIntent({ ...intent, id: intent.bindingId })).toBe(false);
    expect(isTripPlanningExecutionIntent({ ...intent, id: undefined })).toBe(false);
  });

  it('13. prefix-only binding ID rejected', () => {
    const bindingId = TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX;
    expect(
      isTripPlanningExecutionIntent({
        id: `${TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX}${bindingId}`,
        kind: TRIP_PLANNING_EXECUTION_INTENT_KIND,
        bindingId,
      })
    ).toBe(false);
  });

  it('malformed intent object rejected', () => {
    expect(isTripPlanningExecutionIntent(null)).toBe(false);
    expect(isTripPlanningExecutionIntent(undefined)).toBe(false);
    expect(isTripPlanningExecutionIntent({})).toBe(false);
    expect(isTripPlanningExecutionIntent('x')).toBe(false);
    expect(isTripPlanningExecutionIntent(['x'])).toBe(false);
    expect(isTripPlanningExecutionIntent(7)).toBe(false);
  });
});

describe('STEP 55 intent: data shape and provider neutrality', () => {
  it('15. intent contains only required identifiers', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    expect(Object.keys(intent).sort()).toEqual(['bindingId', 'id', 'kind']);
  });

  it('14. provider-neutral intent accepted', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    const serialized = JSON.stringify(intent);
    expect(serialized).not.toMatch(/google|placeId|providerId|latitude|longitude|apiKey/i);
    expect(serialized).not.toContain('scope');
    expect(serialized).not.toContain('tripId');
    expect(serialized).not.toContain('proposalId');
  });

  it('16. no duplicated binding object', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    expect(intent).not.toHaveProperty('applicationId');
    expect(intent).not.toHaveProperty('targetId');
    expect(intent).not.toHaveProperty('proposalId');
    expect(Object.keys(intent).sort()).toEqual(['bindingId', 'id', 'kind']);
    expect(JSON.stringify(intent)).not.toBe(JSON.stringify(validBinding()));
  });

  it('17. no application duplication', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    expect(JSON.stringify(intent)).not.toContain('originReferenceId');
    expect(JSON.stringify(intent)).not.toContain('compositionId');
  });

  it('18. no target duplication', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    expect(JSON.stringify(intent)).not.toContain('targetId');
    expect(JSON.stringify(intent)).not.toContain('"scope"');
  });

  it('19. no composition duplication', () => {
    const intent = createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
    expect(JSON.stringify(intent)).not.toContain('origin');
    expect(JSON.stringify(intent)).not.toContain('destination');
    expect(JSON.stringify(intent)).not.toContain('transport');
  });
});

describe('STEP 55 intent: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningExecutionIntent.ts'),
    'utf8'
  );

  it('imports only the adjacent STEP 54 pure domain binding module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripPlanningApplicationBinding']);
  });

  it('22. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore|getFirestoreInstance/i);
  });

  it('20. no provider dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|serverBoundary/i);
    expect(source).not.toMatch(/amadeus|googlePlacesService|googleRoutesApi/i);
  });

  it('21. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('23. no network dependency', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('24. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('25. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('26. no booking creation and 27. no payment behavior', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking/i);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout|stripe|paymentMethod/i);
  });

  it('28. no execution behavior or execution-lifecycle statuses', () => {
    expect(source).not.toMatch(/pending-execution|executing|markApply|markApplied|executionStatus/i);
    expect(source).not.toMatch(/failed|cancelled|retryCount|externalRequestId/i);
  });

  it('31. no automatic execution', () => {
    expect(source).not.toMatch(/executeNow|runNow|invoke\s*\(|executeAll/i);
    expect(source).not.toMatch(/setInterval|setTimeout|onCall/i);
  });

  it('29. no itinerary mutation and 30. no trip mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });
});