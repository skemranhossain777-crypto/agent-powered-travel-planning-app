import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX,
  TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND,
  createTripPlanningCompositionProposal,
  getTripPlanningCompositionProposalId,
  type TripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposal';
import {
  TRIP_PLANNING_COMPOSITION_ID_PREFIX,
  createTripPlanningComposition,
  isTripPlanningComposition,
  type TripPlanningComposition,
} from '../domain/trips/tripPlanningComposition';
import type {
  TripPlanningReference,
  TripTransportReference,
} from '../types/trip';

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

function transportReference(overrides: Record<string, unknown> = {}): TripTransportReference {
  return {
    id: 'transport:route-1',
    title: 'Test Provider drive route',
    kind: 'transport',
    provider: 'Test Provider',
    mode: 'drive',
    ...overrides,
  } as TripTransportReference;
}

function composeWithoutTransport(): TripPlanningComposition {
  return createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  }) as TripPlanningComposition;
}

function composeWithTransport(): TripPlanningComposition {
  return createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    transport: transportReference({
      routeOrigin: ORIGIN_LOCATION,
      routeDestination: DESTINATION_LOCATION,
    }),
  }) as TripPlanningComposition;
}

describe('STEP 50 composition proposal: structure and identity', () => {
  it('1. valid composition (without transport) -> proposal', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithoutTransport());
    expect(proposal).not.toBeNull();
    expect(proposal?.kind).toBe(TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND);
    expect(proposal?.status).toBe('proposed');
    expect(proposal?.transportReferenceId).toBeUndefined();
  });

  it('2. valid composition (with transport) -> proposal carrying transport identity', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport());
    expect(proposal?.transportReferenceId).toBe('transport:route-1');
    expect(proposal?.compositionId).toBe(composeWithTransport().id);
  });

  it('3. deterministic proposal id from the composition id', () => {
    const composition = composeWithoutTransport();
    const proposal = createTripPlanningCompositionProposal(composition);
    expect(proposal?.id).toBe(
      getTripPlanningCompositionProposalId(composition.id)
    );
    expect(proposal?.id).toBe(
      `${TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX}${composition.id}`
    );
    expect(proposal?.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('4. same composition -> same proposal id and equal value', () => {
    const first = createTripPlanningCompositionProposal(composeWithTransport());
    const again = createTripPlanningCompositionProposal(composeWithTransport());
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('5. different composition -> different proposal id', () => {
    const base = createTripPlanningCompositionProposal(
      composeWithoutTransport()
    );
    const other = createTripPlanningCompositionProposal(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
        destination: placeReference({ id: 'place:z', location: DESTINATION_LOCATION }),
      }) as TripPlanningComposition
    );
    const withTransport = createTripPlanningCompositionProposal(
      composeWithTransport()
    );
    expect(base?.id).not.toBe(other?.id);
    expect(base?.id).not.toBe(withTransport?.id);
  });

  it('deterministic output for repeated calls (#24)', () => {
    const composition = composeWithTransport();
    const calls = Array.from({ length: 5 }, () =>
      createTripPlanningCompositionProposal(composition)
    );
    calls.forEach((proposal) => {
      expect(proposal).toEqual(calls[0]);
    });
  });
});

describe('STEP 50 composition proposal: member identity preservation', () => {
  it('6. origin identity preserved', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport());
    expect(proposal?.originReferenceId).toBe('place:a');
  });

  it('7. destination identity preserved', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport());
    expect(proposal?.destinationReferenceId).toBe('place:b');
  });

  it('8. transport identity preserved', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport());
    expect(proposal?.transportReferenceId).toBe('transport:route-1');
  });

  it('9. composition without transport supported', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithoutTransport());
    expect(proposal).not.toBeNull();
    expect(proposal?.transportReferenceId).toBeUndefined();
    expect(proposal?.compositionId).toContain(':none');
  });
});

describe('STEP 50 composition proposal: validation', () => {
  it('10. missing and malformed composition rejected', () => {
    expect(createTripPlanningCompositionProposal(undefined)).toBeNull();
    expect(createTripPlanningCompositionProposal(null)).toBeNull();
    expect(createTripPlanningCompositionProposal(42)).toBeNull();
    expect(createTripPlanningCompositionProposal('not a composition')).toBeNull();
    expect(createTripPlanningCompositionProposal([])).toBeNull();
    expect(
      createTripPlanningCompositionProposal({
        ...composeWithoutTransport(),
        kind: 'something-else',
      })
    ).toBeNull();
  });

  it('11. invalid origin rejected', () => {
    const composition = composeWithoutTransport();
    const tampered = {
      ...composition,
      origin: { ...composition.origin, referenceId: '' },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
    expect(isTripPlanningComposition(tampered)).toBe(false);
  });

  it('12. invalid destination rejected', () => {
    const composition = composeWithoutTransport();
    const tampered = {
      ...composition,
      destination: { ...composition.destination, referenceId: 7 },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
    expect(isTripPlanningComposition(tampered)).toBe(false);
  });

  it('13. invalid transport rejected', () => {
    const composition = composeWithTransport();
    const tampered = {
      ...composition,
      transport: { ...(composition.transport as NonNullable<(typeof composition)['transport']>), referenceId: '' },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
    expect(isTripPlanningComposition(tampered)).toBe(false);
  });

  it('14. invalid composition identity rejected', () => {
    const composition = composeWithTransport();
    const tampered = { ...composition, id: 'trip-composition:forged' };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
    expect(isTripPlanningComposition(tampered)).toBe(false);
  });

  it('inconsistent composition contents rejected (members disagree with the id)', () => {
    const composition = composeWithoutTransport();
    const tampered = {
      ...composition,
      origin: { ...composition.origin, referenceId: 'place:z' },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
  });

  it('origin==destination self-leg rejected', () => {
    const composition = composeWithoutTransport();
    const tampered = {
      ...composition,
      destination: { ...composition.destination, referenceId: composition.origin.referenceId },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
  });

  it('transport colliding with a place identity rejected', () => {
    const composition = composeWithTransport();
    const tampered = {
      ...composition,
      transport: {
        ...(composition.transport as NonNullable<(typeof composition)['transport']>),
        referenceId: composition.origin.referenceId,
      },
    };
    expect(createTripPlanningCompositionProposal(tampered)).toBeNull();
  });

  it('correspondence without transport, or unknown correspondence, rejected', () => {
    const composition = composeWithoutTransport();
    expect(
      createTripPlanningCompositionProposal({ ...composition, transportCorrespondence: 'exact-coordinate-match' })
    ).toBeNull();
    const withTransport = composeWithTransport();
    expect(
      createTripPlanningCompositionProposal({
        ...withTransport,
        transportCorrespondence: 'fabricated',
      })
    ).toBeNull();
  });

  it('validation reuses the STEP 49 composition validator', () => {
    const composition = composeWithTransport();
    expect(isTripPlanningComposition(composition)).toBe(true);
    expect(createTripPlanningCompositionProposal(composition)).not.toBeNull();
  });
});

describe('STEP 50 composition proposal: provider neutrality and purity', () => {
  const SHARED_COMPOSITION = composeWithTransport();

  it('16. provider-neutral proposal, 17. no Google-specific fields, 18. no raw provider payload', () => {
    const proposal = createTripPlanningCompositionProposal(SHARED_COMPOSITION) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain('google');
    expect(serialized).not.toContain('placeId');
    expect(serialized).not.toContain('routeToken');
    expect(serialized).not.toContain('computeRoutes');
    expect(serialized).not.toContain('fieldMask');
    expect(serialized).not.toContain('providerId');
    expect(serialized).not.toContain('"url"');
    expect(serialized).not.toContain('estimatedCost');
    expect(serialized).not.toContain('distanceMeters');
    expect(serialized).not.toContain('durationSeconds');
    expect(serialized).not.toContain('encodedPolyline');
    expect(serialized).not.toContain('routeWarnings');
    expect(serialized).not.toContain('"provider"');
    expect(serialized).not.toContain('"payload"');
  });

  it('19. no API credentials in the proposal', () => {
    const proposal = createTripPlanningCompositionProposal(SHARED_COMPOSITION) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('x-goog-api-key');
    expect(serialized).not.toContain('token');
  });

  it('25. input composition remains unchanged', () => {
    const composition = composeWithTransport();
    const snapshot = JSON.stringify(composition);
    createTripPlanningCompositionProposal(composition);
    createTripPlanningCompositionProposal(composition);
    expect(JSON.stringify(composition)).toBe(snapshot);
  });
});

describe('STEP 50 composition proposal: status and lifecycle', () => {
  it('20. starts in the neutral pre-approval state', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport());
    expect(proposal?.status).toBe('proposed');
  });

  it('21. is not automatically approved', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport()) as TripPlanningCompositionProposal;
    expect(proposal.status).not.toBe('approved');
    expect(proposal.status).not.toBe('rejected');
    expect(Object.keys(proposal).some((k) => proposal[k as keyof TripPlanningCompositionProposal] === 'approved')).toBe(false);
  });

  it('22. no lifecycle mutation - proposal carries no activation/primary/lifecycle state', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport()) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain('lifecycleState');
    expect(serialized).not.toContain('primary');
    expect(serialized).not.toContain('active');
    expect(serialized).not.toContain('dayNumber');
  });

  it('23. no itinerary mutation - proposal is not an itinerary edit payload', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport()) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain('"update"');
    expect(serialized).not.toContain('dateRange');
    expect(serialized).not.toContain('"days"');
    expect(serialized).not.toContain('destinations');
    expect(serialized).not.toContain('transportPlans');
    expect(serialized).not.toContain('accommodationPlans');
    expect(serialized).not.toContain('budgetPlan');
  });

  it('24b. no persistence fields in the proposal', () => {
    const proposal = createTripPlanningCompositionProposal(composeWithTransport()) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(proposal);
    expect(serialized).not.toContain('localStorage');
    expect(serialized).not.toContain('firestore');
    expect(serialized).not.toContain('firebase');
    expect(serialized).not.toContain('serverTimestamp');
  });
});

describe('STEP 50 composition proposal: module boundary', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src',
      'domain',
      'trips',
      'tripPlanningCompositionProposal.ts'
    ),
    'utf8'
  );

  it('imports only the STEP 49 composition module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    );
    expect(imports).toEqual(['./tripPlanningComposition']);
  });

  it('no Firebase, Firestore, or localStorage imports or calls', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage\s*[.[]/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('no environment variables or browser APIs', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
    expect(source).not.toMatch(/window\.|document\.|navigator\.|sessionStorage/);
  });

  it('no network, Google credentials, or Authorization headers', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
  });

  it('no clock, randomness, or UUID', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b/i);
  });

  it('no provider invocation or AI calls', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini/i);
  });

  it('no itinerary mutation, persistence, or approval execution', () => {
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/mergePlanningProposalIntoDraft/);
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
  });
});

describe('STEP 50 composition proposal: id helper', () => {
  it('derives deterministically from the composition id only', () => {
    const compositionId = `${TRIP_PLANNING_COMPOSITION_ID_PREFIX}place:a:place:b:none`;
    const id = getTripPlanningCompositionProposalId(compositionId);
    expect(id).toBe(`trip-planning-proposal:${compositionId}`);
    expect(getTripPlanningCompositionProposalId(compositionId)).toBe(id);
    expect(getTripPlanningCompositionProposalId('anything:else')).not.toBe(id);
  });
});