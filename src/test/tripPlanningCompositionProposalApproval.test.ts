import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approveTripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposalApproval';
import {
  TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND,
  createTripPlanningCompositionProposal,
  getTripPlanningCompositionProposalId,
  isTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposal';
import {
  createTripPlanningComposition,
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

function proposedProposal(): TripPlanningCompositionProposal {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    transport: transportReference({
      routeOrigin: ORIGIN_LOCATION,
      routeDestination: DESTINATION_LOCATION,
    }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  return createTripPlanningCompositionProposal(
    composition
  ) as TripPlanningCompositionProposal;
}

function tampered(overrides: Record<string, unknown>): TripPlanningCompositionProposal {
  return { ...proposedProposal(), ...overrides } as TripPlanningCompositionProposal;
}

describe('STEP 51 approval: proposed -> approved', () => {
  it('1. valid proposed proposal -> approved', () => {
    const approved = approveTripPlanningCompositionProposal(proposedProposal());
    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('approved');
  });

  it('2. approved proposal -> approved idempotently', () => {
    const once = approveTripPlanningCompositionProposal(proposedProposal());
    const twice = approveTripPlanningCompositionProposal(once as TripPlanningCompositionProposal);
    expect(twice?.status).toBe('approved');
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('2b. idempotent path returns an equivalent freshly built value', () => {
    const first = approveTripPlanningCompositionProposal(proposedProposal()) as TripPlanningCompositionProposal;
    const again = approveTripPlanningCompositionProposal(first);
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
  });

  it('3. proposal ID preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.id).toBe(proposal.id);
  });

  it('4. compositionId preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.compositionId).toBe(proposal.compositionId);
  });

  it('5. origin reference ID preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.originReferenceId).toBe('place:a');
  });

  it('6. destination reference ID preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.destinationReferenceId).toBe('place:b');
  });

  it('7. transport reference ID preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.transportReferenceId).toBe('transport:route-1');
  });

  it('8. optional transport remains absent when absent', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
    const proposal = createTripPlanningCompositionProposal(composition) as TripPlanningCompositionProposal;
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(proposal.transportReferenceId).toBeUndefined();
    expect(approved?.transportReferenceId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(approved, 'transportReferenceId')).toBe(false);
  });

  it('9. proposal kind preserved', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal);
    expect(approved?.kind).toBe(TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND);
  });
});

describe('STEP 51 approval: validation rejects malformed proposals', () => {
  it('10. malformed proposal rejected', () => {
    expect(approveTripPlanningCompositionProposal(null as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(approveTripPlanningCompositionProposal(undefined as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(approveTripPlanningCompositionProposal('nope' as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(approveTripPlanningCompositionProposal(42 as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(approveTripPlanningCompositionProposal([] as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({ originReferenceId: undefined }))).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({}) as unknown as TripPlanningCompositionProposal)).not.toBeNull();
  });

  it('11. invalid proposal ID rejected', () => {
    expect(
      approveTripPlanningCompositionProposal(tampered({ id: 'trip-planning-proposal:forged' }))
    ).toBeNull();
  });

  it('12. invalid kind rejected', () => {
    expect(
      approveTripPlanningCompositionProposal(tampered({ kind: 'something-else' }))
    ).toBeNull();
  });

  it('13. invalid status rejected', () => {
    expect(approveTripPlanningCompositionProposal(tampered({ status: 'rejected' }))).toBeNull();
    expect(
      approveTripPlanningCompositionProposal(tampered({ status: 'executed' }))
    ).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({ status: '' }))).toBeNull();
  });

  it('14. missing compositionId rejected', () => {
    expect(
      approveTripPlanningCompositionProposal(tampered({ compositionId: '' }))
    ).toBeNull();
    expect(
      approveTripPlanningCompositionProposal(tampered({ compositionId: undefined }))
    ).toBeNull();
    expect(
      approveTripPlanningCompositionProposal(tampered({ id: getTripPlanningCompositionProposalId('') }))
    ).toBeNull();
  });

  it('15. malformed reference ID rejected', () => {
    expect(approveTripPlanningCompositionProposal(tampered({ originReferenceId: '' }))).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({ destinationReferenceId: '' }))).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({ transportReferenceId: '' }))).toBeNull();
    expect(approveTripPlanningCompositionProposal(tampered({ transportReferenceId: 7 }))).toBeNull();
  });

  it('internally inconsistent proposal data rejected', () => {
    const proposal = proposedProposal();
    expect(
      approveTripPlanningCompositionProposal({
        ...proposal,
        originReferenceId: proposal.destinationReferenceId,
      })
    ).toBeNull();
    expect(
      approveTripPlanningCompositionProposal({
        ...proposal,
        transportReferenceId: proposal.originReferenceId,
      })
    ).toBeNull();
  });

  it('16. deterministic id/compositionId mismatch rejected', () => {
    const proposal = proposedProposal();
    expect(
      approveTripPlanningCompositionProposal({
        ...proposal,
        compositionId: 'trip-composition:place:a:place:b:none',
      })
    ).toBeNull();
  });
});

describe('STEP 51 approval: immutability, determinism, and side-effect freedom', () => {
  it('17. input object is not mutated', () => {
    const original = proposedProposal();
    const snapshot = JSON.stringify(original);
    Object.freeze(original);
    const approved = approveTripPlanningCompositionProposal(original);
    expect(approved).not.toBeNull();
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(original.status).toBe('proposed');
  });

  it('18. repeated approval is deterministic', () => {
    const proposal = proposedProposal();
    const results = Array.from({ length: 5 }, () =>
      approveTripPlanningCompositionProposal(proposal)
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
  });

  it('24. no lifecycle side effects beyond the status transition', () => {
    const proposal = proposedProposal();
    const approved = approveTripPlanningCompositionProposal(proposal) as TripPlanningCompositionProposal;
    const { status, ...proposalRest } = proposal;
    const { status: approvedStatus, ...approvedRest } = approved;
    expect(status).toBe('proposed');
    expect(approvedStatus).toBe('approved');
    expect(approvedRest).toEqual(proposalRest);
  });

  it('19. no timestamp/clock, 20. no randomness/UUID', () => {
    const proposal = proposedProposal();
    const first = approveTripPlanningCompositionProposal(proposal) as TripPlanningCompositionProposal;
    const again = approveTripPlanningCompositionProposal(proposal) as TripPlanningCompositionProposal;
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(first.id).toBe(proposal.id);
    expect(JSON.stringify(first)).not.toContain('Date');
  });

  it('25. no provider-specific fields introduced; 26. no credentials/HTTP data', () => {
    const approved = approveTripPlanningCompositionProposal(proposedProposal()) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(approved);
    for (const token of ['google', 'placeId', 'routeToken', 'computeRoutes', 'apiKey', 'Authorization', 'x-goog-api-key', 'providerId', '"url"', 'estimatedCost', 'distanceMeters', 'encodedPolyline', 'payload']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('approving an approved proposal does not change the id or data', () => {
    const first = approveTripPlanningCompositionProposal(proposedProposal()) as TripPlanningCompositionProposal;
    const second = approveTripPlanningCompositionProposal(first) as TripPlanningCompositionProposal;
    expect(second.id).toBe(first.id);
    expect(second.compositionId).toBe(first.compositionId);
    expect(second.originReferenceId).toBe(first.originReferenceId);
    expect(second.destinationReferenceId).toBe(first.destinationReferenceId);
    expect(second.transportReferenceId).toBe(first.transportReferenceId);
    expect(second.kind).toBe(first.kind);
    expect(second.status).toBe('approved');
  });

  it('22. no persistence and 23. no itinerary mutation in the approved value', () => {
    const approved = approveTripPlanningCompositionProposal(proposedProposal()) as TripPlanningCompositionProposal;
    const serialized = JSON.stringify(approved);
    for (const token of ['firestore', 'localStorage', 'setDoc', 'addDoc', 'serverTimestamp', 'updateTripPlanning', 'dateRange', 'transportPlans', 'accommodationPlans', 'budgetPlan', 'lifecycleState', 'primary', 'dayNumber']) {
      expect(serialized).not.toContain(token);
    }
  });
});

describe('STEP 51 validator: isTripPlanningCompositionProposal', () => {
  it('accepts valid proposed and approved proposals', () => {
    const proposed = proposedProposal();
    expect(isTripPlanningCompositionProposal(proposed)).toBe(true);
    const approved = approveTripPlanningCompositionProposal(proposed) as TripPlanningCompositionProposal;
    expect(isTripPlanningCompositionProposal(approved)).toBe(true);
  });

  it('rejects malformed, missing, and inconsistent shapes', () => {
    expect(isTripPlanningCompositionProposal(null)).toBe(false);
    expect(isTripPlanningCompositionProposal(undefined)).toBe(false);
    expect(isTripPlanningCompositionProposal('proposal')).toBe(false);
    expect(isTripPlanningCompositionProposal({})).toBe(false);
    expect(isTripPlanningCompositionProposal(tampered({ kind: 'x' }))).toBe(false);
    expect(isTripPlanningCompositionProposal(tampered({ id: 'bad' }))).toBe(false);
    expect(isTripPlanningCompositionProposal(tampered({ status: 'executed' }))).toBe(false);
    expect(isTripPlanningCompositionProposal(tampered({ originReferenceId: '' }))).toBe(false);
    expect(isTripPlanningCompositionProposal(tampered({ compositionId: 'x' }))).toBe(false);
  });
});

describe('STEP 51 approval: module boundary', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src',
      'domain',
      'trips',
      'tripPlanningCompositionProposalApproval.ts'
    ),
    'utf8'
  );

  it('imports only the STEP 50 proposal module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    );
    expect(imports).toEqual(['./tripPlanningCompositionProposal']);
  });

  it('no Firebase, Firestore, localStorage, or persistence calls', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('no environment access or browser APIs', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
    expect(source).not.toMatch(/window\.|document\.|navigator\./);
  });

  it('no network, Google credentials, or Authorization headers', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*(axios|compute|@google-cloud|provider-api)/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bapiKey\b|Authorization|x-goog-api-key/);
    expect(source).not.toMatch(/googleRoutesService|serverDiscoveryClient|aiPlanningService|gemini/i);
  });

  it('no React, Router, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
  });

  it('no clock, randomness, UUID, or GPS', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|\buuid\b/i);
    expect(source).not.toMatch(/geolocation|navigator\.geolocation/);
  });

  it('no booking, payment, activation, or auto-selection vocabulary', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/activate\(|promote\(|archive\(|needs-review/);
  });
});