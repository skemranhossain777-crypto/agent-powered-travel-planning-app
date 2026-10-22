import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX,
  TRIP_PLANNING_APPLICATION_TARGET_KIND,
  TRIP_PLANNING_APPLICATION_TARGET_SCOPES,
  TRIP_PLANNING_APPLICATION_TARGET_SCOPE_TRIP,
  canApplyTripPlanningApplicationToTarget,
  createTripPlanningApplicationTarget,
  getTripPlanningApplicationTargetId,
  isTripPlanningApplicationTarget,
  isTripPlanningApplicationTargetScope,
  isValidTripApplicationTargetTripId,
  type TripPlanningApplicationTarget,
} from '../domain/trips/tripPlanningApplicationTarget';
import {
  createTripPlanningApplication,
  isTripPlanningApplication,
  type TripPlanningApplication,
} from '../domain/trips/tripPlanningApplication';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import {
  createTripPlanningCompositionProposal,
  TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX,
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

function tripTarget(tripId = 'trip-abc'): TripPlanningApplicationTarget | null {
  return createTripPlanningApplicationTarget({ scope: 'trip', tripId });
}

function tamperedTarget(overrides: Record<string, unknown>): unknown {
  return {
    id: 'trip-planning-target:trip:trip-abc',
    kind: TRIP_PLANNING_APPLICATION_TARGET_KIND,
    scope: 'trip',
    tripId: 'trip-abc',
    ...overrides,
  };
}

describe('STEP 53 target: structure and identity', () => {
  it('1. valid trip-level target', () => {
    const target = tripTarget();
    expect(target).not.toBeNull();
    expect(target?.id).toBe('trip-planning-target:trip:trip-abc');
    expect(target?.kind).toBe(TRIP_PLANNING_APPLICATION_TARGET_KIND);
    expect(target?.scope).toBe(TRIP_PLANNING_APPLICATION_TARGET_SCOPE_TRIP);
    expect(target?.tripId).toBe('trip-abc');
  });

  it('2. deterministic target ID', () => {
    expect(getTripPlanningApplicationTargetId('trip', 'trip-abc')).toBe(
      `${TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX}trip:trip-abc`
    );
    expect(tripTarget()?.id).toBe(getTripPlanningApplicationTargetId('trip', 'trip-abc'));
    expect(tripTarget()?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. same trip + scope -> same ID and value', () => {
    const first = tripTarget('trip-abc');
    const again = tripTarget('trip-abc');
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('4. different trip -> different ID', () => {
    expect(tripTarget('trip-abc')?.id).not.toBe(tripTarget('trip-xyz')?.id);
    expect(tripTarget('trip-abc')?.tripId).not.toBe(tripTarget('trip-xyz')?.tripId);
  });

  it('5. different scope -> different ID', () => {
    expect(getTripPlanningApplicationTargetId('trip', 'trip-abc')).not.toBe(
      getTripPlanningApplicationTargetId('trip-day', 'trip-abc')
    );
    expect(getTripPlanningApplicationTargetId('trip', 'trip-abc')).not.toBe(
      getTripPlanningApplicationTargetId('trip-segment', 'trip-abc')
    );
  });

  it('id scope separates the trip id segment deterministically', () => {
    expect(getTripPlanningApplicationTargetId('trip', 'trip-abc')).toBe(
      getTripPlanningApplicationTargetId('trip', 'trip-abc')
    );
    expect(getTripPlanningApplicationTargetId('trip', 'trip-abc')).not.toBe(
      getTripPlanningApplicationTargetId('trip', 'trip-AB-C')
    );
  });

  it('scope vocabulary is exactly trip-level; no lower-level scope exists', () => {
    expect(TRIP_PLANNING_APPLICATION_TARGET_SCOPES).toEqual(['trip']);
    expect(isTripPlanningApplicationTargetScope('trip')).toBe(true);
    expect(isTripPlanningApplicationTargetScope('trip-day')).toBe(false);
    expect(isTripPlanningApplicationTargetScope('trip-segment')).toBe(false);
  });

  it('target id prefix is distinct from proposal and application id spaces', () => {
    expect(TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX).not.toBe('trip-planning-proposal:');
    expect(TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX).not.toBe('trip-planning-application:');
    const proposalId = `${TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX}anything`;
    expect(getTripPlanningApplicationTargetId('trip', proposalId)).not.toBe(proposalId);
  });
});

describe('STEP 53 target: validation and factory', () => {
  it('6. invalid/missing trip ID rejected', () => {
    const badIds: unknown[] = [
      undefined,
      null,
      '',
      '.',
      '..',
      'a/b',
      'x'.repeat(1501),
      7,
      ['trip-ab'],
    ];
    for (const tripId of badIds) {
      expect(
        createTripPlanningApplicationTarget({ scope: 'trip', tripId: tripId as string })
      ).toBeNull();
      expect(isValidTripApplicationTargetTripId(tripId)).toBe(false);
    }
    expect(isValidTripApplicationTargetTripId('trip-abc')).toBe(true);
    expect(isValidTripApplicationTargetTripId('x'.repeat(1500))).toBe(true);
  });

  it('7. unsupported scope rejected', () => {
    const badScopes: unknown[] = [
      'trip-day',
      'trip-segment',
      'trip-route',
      'itinerary-day',
      'TRIP',
      'trip-one',
      '',
      null,
      undefined,
      1,
    ];
    for (const scope of badScopes) {
      expect(
        createTripPlanningApplicationTarget({ scope: scope as 'trip', tripId: 'trip-abc' })
      ).toBeNull();
      expect(isTripPlanningApplicationTargetScope(scope)).toBe(false);
    }
  });

  it('8. malformed target input rejected', () => {
    expect(createTripPlanningApplicationTarget(undefined as never)).toBeNull();
    expect(createTripPlanningApplicationTarget(null as never)).toBeNull();
    expect(createTripPlanningApplicationTarget({} as never)).toBeNull();
    expect(createTripPlanningApplicationTarget({ tripId: 'trip-abc' } as never)).toBeNull();
    expect(createTripPlanningApplicationTarget({ scope: 'trip' } as never)).toBeNull();
    expect(createTripPlanningApplicationTarget(7 as never)).toBeNull();
    expect(createTripPlanningApplicationTarget('trip' as never)).toBeNull();
    expect(isTripPlanningApplicationTarget({})).toBe(false);
    expect(isTripPlanningApplicationTarget(null)).toBe(false);
    expect(isTripPlanningApplicationTarget(['trip'])).toBe(false);
  });

  it('9. deterministic target-ID mismatch rejected', () => {
    expect(isTripPlanningApplicationTarget(tamperedTarget({ id: 'trip-planning-target:trip:other' }))).toBe(
      false
    );
    expect(isTripPlanningApplicationTarget(tamperedTarget({ id: 'stray-id' }))).toBe(false);
    expect(isTripPlanningApplicationTarget(tamperedTarget({ id: undefined }))).toBe(false);
  });

  it('factory output always passes the target validator (round-trip)', () => {
    const target = tripTarget();
    expect(isTripPlanningApplicationTarget(target)).toBe(true);
    expect(isTripPlanningApplicationTarget(JSON.parse(JSON.stringify(target)))).toBe(true);
  });

  it('10. provider-neutral target', () => {
    const serialized = JSON.stringify(tripTarget());
    expect(serialized).not.toContain('provider');
    expect(Object.keys(tripTarget() ?? {}).sort()).toEqual(['id', 'kind', 'scope', 'tripId']);
  });

  it('11. no Google-specific or provider fields', () => {
    const serialized = JSON.stringify(tripTarget());
    expect(serialized).not.toMatch(/google|placeId|providerId|latitude|longitude|apiKey/i);
    expect(serialized).not.toContain('title');
    expect(serialized).not.toContain('name');
  });

  it('deterministic id does not include mutable trip names or descriptions', () => {
    const target = tripTarget('trip-abc');
    expect(target?.id).not.toContain('Summer');
    expect(target?.id).not.toContain('description');
    expect(target?.tripId).toBe('trip-abc');
  });

  it('trip id rule mirrors the existing trip-domain rule (max 1500, no slash, not "."/"..")', () => {
    expect(isValidTripApplicationTargetTripId('trip-abc')).toBe(true);
    expect(isValidTripApplicationTargetTripId('trip-'.padEnd(1500, 'a'))).toBe(true);
    expect(isValidTripApplicationTargetTripId('trip-'.padEnd(1501, 'a'))).toBe(false);
    expect(isValidTripApplicationTargetTripId('a/b')).toBe(false);
    expect(isValidTripApplicationTargetTripId('.')).toBe(false);
    expect(isValidTripApplicationTargetTripId('..')).toBe(false);
    expect(isValidTripApplicationTargetTripId('')).toBe(false);
    expect(isValidTripApplicationTargetTripId(7)).toBe(false);
  });
});

describe('STEP 53 target: application compatibility', () => {
  it('12. valid pending application + valid target -> compatible', () => {
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), tripTarget())).toBe(true);
    expect(
      canApplyTripPlanningApplicationToTarget(validApplication(), tripTarget('trip-other-99'))
    ).toBe(true);
  });

  it('13. proposed/invalid application rejected', () => {
    const proposal = createTripPlanningCompositionProposal(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a' }),
        destination: placeReference({ id: 'place:b' }),
      }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>
    );
    expect(canApplyTripPlanningApplicationToTarget(proposal, tripTarget())).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget(null, tripTarget())).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget(undefined, tripTarget())).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget({}, tripTarget())).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget(42, tripTarget())).toBe(false);
  });

  it('14. wrong application status rejected', () => {
    const application = JSON.parse(JSON.stringify(validApplication())) as TripPlanningApplication;
    expect(canApplyTripPlanningApplicationToTarget({ ...application, status: 'executed' }, tripTarget())).toBe(
      false
    );
    expect(canApplyTripPlanningApplicationToTarget({ ...application, status: 'proposed' }, tripTarget())).toBe(
      false
    );
    expect(canApplyTripPlanningApplicationToTarget({ ...application, status: 'applied' }, tripTarget())).toBe(
      false
    );
    expect(isTripPlanningApplication({ ...application, status: 'proposed' } as unknown)).toBe(false);
  });

  it('15. malformed application rejected', () => {
    const application = validApplication();
    expect(canApplyTripPlanningApplicationToTarget({ ...application, id: 'stray' }, tripTarget())).toBe(
      false
    );
    expect(
      canApplyTripPlanningApplicationToTarget(
        { ...application, compositionId: undefined },
        tripTarget()
      )
    ).toBe(false);
    expect(
      canApplyTripPlanningApplicationToTarget(
        { ...application, destinationReferenceId: '' },
        tripTarget()
      )
    ).toBe(false);
    expect(
      canApplyTripPlanningApplicationToTarget(
        { ...application, transportReferenceId: '' },
        tripTarget()
      )
    ).toBe(false);
    const tampered = { ...application, proposalId: undefined };
    expect(canApplyTripPlanningApplicationToTarget(tampered, tripTarget())).toBe(false);
  });

  it('invalid target rejected by compatibility', () => {
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), null)).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), {})).toBe(false);
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), tripTarget('bad/id'))).toBe(false);
  });

  it('16. target remains unchanged by compatibility', () => {
    const target = tripTarget('trip-abc');
    const snapshot = JSON.stringify(target);
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), target)).toBe(true);
    expect(JSON.stringify(target)).toBe(snapshot);
  });

  it('17. application remains unchanged by compatibility', () => {
    const application = validApplication();
    const snapshot = JSON.stringify(application);
    expect(canApplyTripPlanningApplicationToTarget(application, tripTarget())).toBe(true);
    expect(JSON.stringify(application)).toBe(snapshot);
  });

  it('18. repeated compatibility check is deterministic', () => {
    const application = validApplication();
    const target = tripTarget();
    const first = canApplyTripPlanningApplicationToTarget(application, target);
    const second = canApplyTripPlanningApplicationToTarget(application, target);
    const third = canApplyTripPlanningApplicationToTarget(
      JSON.parse(JSON.stringify(application)),
      JSON.parse(JSON.stringify(target))
    );
    expect(first).toBe(true);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('22. no database existence check: compatible for trip ids that exist nowhere', () => {
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), tripTarget('trip-never-created'))).toBe(
      true
    );
    expect(tripTarget('trip-never-created')?.id).toBe('trip-planning-target:trip:trip-never-created');
  });

  it('27. no automatic target selection', () => {
    expect(canApplyTripPlanningApplicationToTarget(validApplication(), undefined)).toBe(false);
    expect(tripTarget()).not.toBeNull();
    expect(createTripPlanningApplicationTarget({ scope: 'trip', tripId: 'trip-picked' })?.tripId).toBe(
      'trip-picked'
    );
  });
});

describe('STEP 53 target: additive application validator (STEP 52 module)', () => {
  it('round-trips a factory-created application', () => {
    const application = validApplication();
    expect(isTripPlanningApplication(application)).toBe(true);
    expect(isTripPlanningApplication(JSON.parse(JSON.stringify(application)))).toBe(true);
  });

  it('rejects wrong kind, status, id, and empty identities', () => {
    const application = validApplication();
    expect(isTripPlanningApplication({ ...application, kind: 'other' })).toBe(false);
    expect(isTripPlanningApplication({ ...application, status: 'executed' })).toBe(false);
    expect(isTripPlanningApplication({ ...application, id: getTripPlanningApplicationTargetId('trip', 'x') })).toBe(
      false
    );
    expect(isTripPlanningApplication({ ...application, proposalId: '' })).toBe(false);
    expect(isTripPlanningApplication(null)).toBe(false);
    expect(isTripPlanningApplication(undefined)).toBe(false);
    expect(isTripPlanningApplication('trip-planning-application:x')).toBe(false);
  });
});

describe('STEP 53 target: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningApplicationTarget.ts'),
    'utf8'
  );

  it('imports only the STEP 52 application validator module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['./tripPlanningApplication']);
  });

  it('no Firebase, Firestore, or localStorage access', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('no environment access or browser APIs', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
    expect(source).not.toMatch(/window\.|document\.|navigator\./);
  });

  it('no network, provider credentials, or raw responses', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|serverBoundary/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
  });

  it('no clock, randomness, UUID, GPS, or AI invocation', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b|geolocation/i);
    expect(source).not.toMatch(/aiPlanningService|gemini/i);
  });

  it('no booking, payment, activation, or auto-selection vocabulary', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice|checkout/);
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/activate\(|promote\(|archive\(|needs-review/);
  });

  it('no itinerary or trip mutation vocabulary', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
  });
});