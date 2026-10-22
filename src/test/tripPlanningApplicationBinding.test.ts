import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX,
  TRIP_PLANNING_APPLICATION_BINDING_KIND,
  createTripPlanningApplicationBinding,
  getTripPlanningApplicationBindingId,
  isTripPlanningApplicationBinding,
  type TripPlanningApplicationBinding,
} from '../domain/trips/tripPlanningApplicationBinding';
import {
  createTripPlanningApplication,
  TRIP_PLANNING_APPLICATION_ID_PREFIX,
  type TripPlanningApplication,
} from '../domain/trips/tripPlanningApplication';
import {
  createTripPlanningApplicationTarget,
  TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX,
  type TripPlanningApplicationTarget,
} from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import {
  createTripPlanningCompositionProposal,
  TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND,
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

function tamperedBinding(overrides: Record<string, unknown>): Record<string, unknown> {
  const application = validApplication();
  const target = validTarget();
  return {
    id: getTripPlanningApplicationBindingId(application.id, target.id),
    kind: TRIP_PLANNING_APPLICATION_BINDING_KIND,
    applicationId: application.id,
    targetId: target.id,
    ...overrides,
  };
}

describe('STEP 54 binding: structure and identity', () => {
  it('1. valid pending application + valid trip target creates binding', () => {
    const binding = createTripPlanningApplicationBinding(validApplication(), validTarget());
    expect(binding).not.toBeNull();
    expect(binding?.kind).toBe(TRIP_PLANNING_APPLICATION_BINDING_KIND);
  });

  it('2. deterministic binding ID', () => {
    const application = validApplication();
    const target = validTarget();
    const binding = createTripPlanningApplicationBinding(application, target);
    expect(binding?.id).toBe(
      `${TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX}${application.id}:${target.id}`
    );
    expect(binding?.id).toBe(getTripPlanningApplicationBindingId(application.id, target.id));
    expect(binding?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact binding kind', () => {
    expect(TRIP_PLANNING_APPLICATION_BINDING_KIND).toBe('trip-planning-application-binding');
    expect(createTripPlanningApplicationBinding(validApplication(), validTarget())?.kind).toBe(
      TRIP_PLANNING_APPLICATION_BINDING_KIND
    );
  });

  it('4. applicationId preserved', () => {
    const application = validApplication();
    const binding = createTripPlanningApplicationBinding(application, validTarget());
    expect(binding?.applicationId).toBe(application.id);
  });

  it('5. targetId preserved', () => {
    const target = validTarget();
    const binding = createTripPlanningApplicationBinding(validApplication(), target);
    expect(binding?.targetId).toBe(target.id);
  });

  it('6. fresh binding value, distinct from both inputs', () => {
    const application = validApplication();
    const target = validTarget();
    const binding = createTripPlanningApplicationBinding(application, target) as TripPlanningApplicationBinding;
    expect(binding).not.toBe(application);
    expect(binding).not.toBe(target);
    expect(JSON.stringify(binding)).not.toBe(JSON.stringify(application));
    expect(JSON.stringify(binding)).not.toBe(JSON.stringify(target));
  });

  it('33. binding contains identifiers only, not duplicated application/target objects', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    expect(Object.keys(binding).sort()).toEqual(['applicationId', 'id', 'kind', 'targetId']);
    const serialized = JSON.stringify(binding);
    expect(serialized).not.toContain('proposalId');
    expect(serialized).not.toContain('compositionId');
    expect(serialized).not.toContain('originReferenceId');
    expect(serialized).not.toContain('destinationReferenceId');
    expect(serialized).not.toContain('scope');
    expect(serialized).not.toContain('tripId');
  });

  it('binding id space is distinct from proposal, application, and target id spaces', () => {
    expect(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX).not.toBe(
      TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND + ':'
    );
    expect(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX).not.toBe(TRIP_PLANNING_APPLICATION_ID_PREFIX);
    expect(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX).not.toBe(TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX);
    expect(getTripPlanningApplicationBindingId('a', 'b')).not.toBe('a');
    expect(getTripPlanningApplicationBindingId('a', 'b')).not.toBe('b');
  });
});

describe('STEP 54 binding: determinism and immutability', () => {
  it('9. repeated creation is deterministic', () => {
    const application = validApplication();
    const target = validTarget();
    const first = createTripPlanningApplicationBinding(application, target);
    const again = createTripPlanningApplicationBinding(application, target);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('7. application input not mutated', () => {
    const application = validApplication();
    const snapshot = JSON.stringify(application);
    expect(createTripPlanningApplicationBinding(application, validTarget())).not.toBeNull();
    expect(JSON.stringify(application)).toBe(snapshot);
  });

  it('8. target input not mutated', () => {
    const target = validTarget();
    const snapshot = JSON.stringify(target);
    expect(createTripPlanningApplicationBinding(validApplication(), target)).not.toBeNull();
    expect(JSON.stringify(target)).toBe(snapshot);
  });

  it('factory output always passes the binding validator (round-trip)', () => {
    const binding = createTripPlanningApplicationBinding(validApplication(), validTarget());
    expect(isTripPlanningApplicationBinding(binding)).toBe(true);
    expect(isTripPlanningApplicationBinding(JSON.parse(JSON.stringify(binding)))).toBe(true);
  });
});

describe('STEP 54 binding: rejection', () => {
  it('10. malformed application rejected', () => {
    const target = validTarget();
    expect(createTripPlanningApplicationBinding(null as never, target)).toBeNull();
    expect(createTripPlanningApplicationBinding(undefined as never, target)).toBeNull();
    expect(createTripPlanningApplicationBinding('trip' as never, target)).toBeNull();
    expect(createTripPlanningApplicationBinding({} as never, target)).toBeNull();
    const application = validApplication();
    expect(
      createTripPlanningApplicationBinding({ ...application, kind: 'other' } as never, target)
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding({ ...application, id: 'stray' } as never, target)
    ).toBeNull();
  });

  it('11. proposed application rejected', () => {
    const proposal = createTripPlanningCompositionProposal(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a' }),
        destination: placeReference({ id: 'place:b' }),
      }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>
    );
    expect(
      createTripPlanningApplicationBinding(proposal as never, validTarget())
    ).toBeNull();
  });

  it('12. invalid application status rejected', () => {
    const application = JSON.parse(JSON.stringify(validApplication())) as TripPlanningApplication;
    expect(
      createTripPlanningApplicationBinding(
        { ...application, status: 'executed' } as never,
        validTarget()
      )
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        { ...application, status: 'proposed' } as never,
        validTarget()
      )
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        { ...application, status: 'applied' } as never,
        validTarget()
      )
    ).toBeNull();
  });

  it('13. malformed target rejected', () => {
    const application = validApplication();
    expect(createTripPlanningApplicationBinding(application, null as never)).toBeNull();
    expect(createTripPlanningApplicationBinding(application, undefined as never)).toBeNull();
    expect(createTripPlanningApplicationBinding(application, {} as never)).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        application,
        { ...validTarget(), kind: 'other' } as never
      )
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        application,
        { ...validTarget(), id: 'stray' } as never
      )
    ).toBeNull();
  });

  it('14. incompatible application/target rejected', () => {
    const application = validApplication();
    expect(
      createTripPlanningApplicationBinding(
        { ...application, id: `${TRIP_PLANNING_APPLICATION_ID_PREFIX}other` } as never,
        validTarget()
      )
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        application,
        {
          ...validTarget(),
          id: `${TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX}trip:other`,
        } as never
      )
    ).toBeNull();
    expect(
      createTripPlanningApplicationBinding(
        application,
        { ...validTarget(), tripId: 'bad/id' } as never
      )
    ).toBeNull();
  });

  it('15. application ID mismatch cannot be fabricated', () => {
    const application = validApplication();
    const target = validTarget();
    const binding = createTripPlanningApplicationBinding(application, target) as TripPlanningApplicationBinding;
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: 'trip-planning-application:other' })).toBe(
      false
    );
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: target.id })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: 'stray' })).toBe(false);
  });

  it('16. target ID mismatch cannot be fabricated', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: 'trip-planning-target:trip:other' })).toBe(
      false
    );
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: 'stray' })).toBe(false);
  });

  it('17. malformed binding rejected', () => {
    expect(isTripPlanningApplicationBinding(null)).toBe(false);
    expect(isTripPlanningApplicationBinding(undefined)).toBe(false);
    expect(isTripPlanningApplicationBinding({})).toBe(false);
    expect(isTripPlanningApplicationBinding('trip-planning-binding:a:b')).toBe(false);
    expect(isTripPlanningApplicationBinding(['trip-planning-binding:a:b'])).toBe(false);
    expect(isTripPlanningApplicationBinding(42)).toBe(false);
  });

  it('18. wrong kind rejected', () => {
    const binding = tamperedBinding({});
    expect(isTripPlanningApplicationBinding({ ...binding, kind: 'other' })).toBe(false);
    expect(
      isTripPlanningApplicationBinding({ ...binding, kind: 'trip-planning-composition-proposal' })
    ).toBe(false);
  });

  it('19. malformed application ID rejected', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: undefined })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: '' })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: TRIP_PLANNING_APPLICATION_ID_PREFIX })).toBe(
      false
    );
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: 'application:abc' })).toBe(
      false
    );
    expect(isTripPlanningApplicationBinding({ ...binding, applicationId: 7 })).toBe(false);
  });

  it('20. malformed target ID rejected', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: undefined })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: '' })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX })).toBe(
      false
    );
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: 'target:abc' })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, targetId: 7 })).toBe(false);
  });

  it('21. incorrect deterministic binding ID rejected', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    expect(isTripPlanningApplicationBinding({ ...binding, id: 'trip-planning-binding:other' })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, id: binding.applicationId })).toBe(false);
    expect(isTripPlanningApplicationBinding({ ...binding, id: undefined })).toBe(false);
  });

  it('22. missing applicationId rejected', () => {
    const binding = tamperedBinding({ applicationId: undefined });
    expect(isTripPlanningApplicationBinding(binding)).toBe(false);
    const removed = { kind: binding?.kind, id: binding?.id, targetId: binding?.targetId };
    expect(isTripPlanningApplicationBinding(removed)).toBe(false);
  });

  it('23. missing targetId rejected', () => {
    const binding = tamperedBinding({ targetId: undefined });
    expect(isTripPlanningApplicationBinding(binding)).toBe(false);
    const removed = { kind: binding?.kind, id: binding?.id, applicationId: binding?.applicationId };
    expect(isTripPlanningApplicationBinding(removed)).toBe(false);
  });

  it('swapped application/target ids are rejected (fabricated cross)', () => {
    const binding = tamperedBinding({});
    expect(
      isTripPlanningApplicationBinding({
        ...binding,
        applicationId: binding.targetId,
        targetId: binding.applicationId,
      })
    ).toBe(false);
  });
});

describe('STEP 54 binding: provider neutrality and no auto-selection', () => {
  it('24. provider-neutral binding accepted', () => {
    const binding = createTripPlanningApplicationBinding(
      validApplication(),
      validTarget()
    ) as TripPlanningApplicationBinding;
    const serialized = JSON.stringify(binding);
    expect(serialized).not.toMatch(/google|placeId|providerId|latitude|longitude|apiKey/i);
    expect(serialized).not.toContain('scope');
    expect(serialized).not.toContain('tripId');
  });

  it('30. no automatic target selection', () => {
    expect(createTripPlanningApplicationBinding(validApplication(), null as never)).toBeNull();
    expect(createTripPlanningApplicationBinding(validApplication(), undefined as never)).toBeNull();
    expect(
      createTripPlanningApplicationBinding(validApplication(), validTarget())
    ).not.toBeNull();
  });
});

describe('STEP 54 binding: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningApplicationBinding.ts'),
    'utf8'
  );

  it('imports only the adjacent STEP 52/53 pure domain modules', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripPlanningApplication', './tripPlanningApplicationTarget']);
  });

  it('25. no persistence or database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore|getFirestoreInstance/i);
  });

  it('26. no provider dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|serverBoundary/i);
    expect(source).not.toMatch(/amadeus|places\s*\(/i);
  });

  it('27. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent|serverBoundary/i);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('28. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('29. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('no execution, status-transition, or booking vocabulary', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout/);
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/activate\(|promote\(|archive\(|needs-review/);
    expect(source).not.toMatch(/markApply|markApplied|executionStatus/);
  });

  it('31. no itinerary mutation and 32. no trip mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });
});