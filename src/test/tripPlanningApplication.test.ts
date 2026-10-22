import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_APPLICATION_ID_PREFIX,
  TRIP_PLANNING_APPLICATION_KIND,
  createTripPlanningApplication,
  getTripPlanningApplicationId,
  type TripPlanningApplication,
} from '../domain/trips/tripPlanningApplication';
import {
  TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX,
  createTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposal';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
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

function approvedProposal(): TripPlanningCompositionProposal {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    transport: transportReference({
      routeOrigin: ORIGIN_LOCATION,
      routeDestination: DESTINATION_LOCATION,
    }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  const proposal = createTripPlanningCompositionProposal(
    composition
  ) as TripPlanningCompositionProposal;
  return approveTripPlanningCompositionProposal(proposal) as TripPlanningCompositionProposal;
}

function tampered(overrides: Record<string, unknown>): TripPlanningCompositionProposal {
  return { ...approvedProposal(), ...overrides } as TripPlanningCompositionProposal;
}

describe('STEP 52 application: structure and identity', () => {
  it('1. valid approved proposal -> application', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application).not.toBeNull();
    expect(application?.kind).toBe(TRIP_PLANNING_APPLICATION_KIND);
    expect(application?.status).toBe('pending-application');
  });

  it('2. deterministic application id from the proposal id', () => {
    const proposal = approvedProposal();
    const application = createTripPlanningApplication(proposal) as TripPlanningApplication;
    expect(application.id).toBe(getTripPlanningApplicationId(proposal.id));
    expect(application.id).toBe(
      `${TRIP_PLANNING_APPLICATION_ID_PREFIX}${proposal.id}`
    );
    expect(application.id).toMatch(
      new RegExp(`^${TRIP_PLANNING_APPLICATION_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. same approved proposal -> same application id and value', () => {
    const first = createTripPlanningApplication(approvedProposal());
    const again = createTripPlanningApplication(approvedProposal());
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('4. different proposal -> different application id', () => {
    const base = createTripPlanningApplication(approvedProposal());
    const other = createTripPlanningApplication(
      approveTripPlanningCompositionProposal(
        createTripPlanningCompositionProposal(
          createTripPlanningComposition({
            origin: placeReference({ id: 'place:a' }),
            destination: placeReference({ id: 'place:z' }),
          }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>
        ) as TripPlanningCompositionProposal
      ) as TripPlanningCompositionProposal
    );
    expect(base?.id).not.toBe(other?.id);
  });

  it('2b. id helper is deterministic and proposal-scoped', () => {
    const proposalId = `${TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX}trip-composition:place:a:place:b:transport:route-1`;
    expect(getTripPlanningApplicationId(proposalId)).toBe(`trip-planning-application:${proposalId}`);
    expect(getTripPlanningApplicationId(proposalId)).toBe(getTripPlanningApplicationId(proposalId));
    expect(getTripPlanningApplicationId('another')).not.toBe(getTripPlanningApplicationId(proposalId));
  });
});

describe('STEP 52 application: identity preservation and mapping', () => {
  it('5. source proposal id preserved', () => {
    const proposal = approvedProposal();
    const application = createTripPlanningApplication(proposal) as TripPlanningApplication;
    expect(application.proposalId).toBe(proposal.id);
  });

  it('6. source composition id preserved', () => {
    const proposal = approvedProposal();
    const application = createTripPlanningApplication(proposal) as TripPlanningApplication;
    expect(application.compositionId).toBe(proposal.compositionId);
  });

  it('7. origin reference id preserved', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application?.originReferenceId).toBe('place:a');
  });

  it('8. destination reference id preserved', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application?.destinationReferenceId).toBe('place:b');
  });

  it('9. transport reference id preserved', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application?.transportReferenceId).toBe('transport:route-1');
  });

  it('10. no-transport proposal supported', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
    const proposal = createTripPlanningCompositionProposal(composition) as TripPlanningCompositionProposal;
    const approved = approveTripPlanningCompositionProposal(proposal) as TripPlanningCompositionProposal;
    const application = createTripPlanningApplication(approved);
    expect(application).not.toBeNull();
    expect(application?.transportReferenceId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(application, 'transportReferenceId')).toBe(false);
  });

  it('11. application kind preserved', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application?.kind).toBe(TRIP_PLANNING_APPLICATION_KIND);
  });

  it('12. application starts in the explicit pending state', () => {
    const application = createTripPlanningApplication(approvedProposal());
    expect(application?.status).toBe('pending-application');
    expect(JSON.stringify(application)).not.toContain('applied');
    expect(JSON.stringify(application)).not.toContain('executed');
    expect(JSON.stringify(application)).not.toContain('booked');
  });

  it('application never retains the proposal status vocabulary', () => {
    const application = createTripPlanningApplication(approvedProposal()) as TripPlanningApplication;
    const serialized = JSON.stringify(application);
    expect(serialized).not.toContain('"proposed"');
    expect(serialized).not.toContain('"approved"');
    expect(serialized).not.toContain('"rejected"');
    expect(application.status).toBe('pending-application');
  });
});

describe('STEP 52 application: approved-only boundary', () => {
  it('13. proposed proposal rejected', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
    const proposed = createTripPlanningCompositionProposal(
      composition
    ) as TripPlanningCompositionProposal;
    expect(proposed.status).toBe('proposed');
    expect(createTripPlanningApplication(proposed)).toBeNull();
  });

  it('17. rejected and unsupported statuses rejected', () => {
    expect(createTripPlanningApplication(tampered({ status: 'rejected' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ status: 'executed' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ status: '' }))).toBeNull();
  });

  it('an already-approved proposal produces the same deterministic application', () => {
    const first = createTripPlanningApplication(approvedProposal());
    const reapproved = approveTripPlanningCompositionProposal(
      approveTripPlanningCompositionProposal(approvedProposal()) as TripPlanningCompositionProposal
    ) as TripPlanningCompositionProposal;
    const second = createTripPlanningApplication(reapproved);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('STEP 52 application: validation rejection', () => {
  it('14. malformed proposal rejected', () => {
    expect(createTripPlanningApplication(null as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(createTripPlanningApplication(undefined as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(createTripPlanningApplication('application' as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(createTripPlanningApplication(42 as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(createTripPlanningApplication([] as unknown as TripPlanningCompositionProposal)).toBeNull();
    expect(createTripPlanningApplication(tampered({ originReferenceId: undefined }))).toBeNull();
  });

  it('15. invalid proposal id rejected', () => {
    expect(createTripPlanningApplication(tampered({ id: 'trip-planning-proposal:forged' }))).toBeNull();
  });

  it('16. invalid proposal kind rejected', () => {
    expect(createTripPlanningApplication(tampered({ kind: 'something-else' }))).toBeNull();
  });

  it('18. missing composition id rejected', () => {
    expect(createTripPlanningApplication(tampered({ compositionId: '' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ compositionId: undefined }))).toBeNull();
  });

  it('19. malformed reference id rejected', () => {
    expect(createTripPlanningApplication(tampered({ originReferenceId: '' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ destinationReferenceId: '' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ transportReferenceId: '' }))).toBeNull();
    expect(createTripPlanningApplication(tampered({ transportReferenceId: 7 }))).toBeNull();
  });

  it('20. proposal identity/composition mismatch rejected', () => {
    const proposal = approvedProposal();
    expect(
      createTripPlanningApplication({
        ...proposal,
        compositionId: 'trip-composition:place:a:place:b:none',
      })
    ).toBeNull();
  });

  it('internally inconsistent proposal data rejected', () => {
    const proposal = approvedProposal();
    expect(
      createTripPlanningApplication({
        ...proposal,
        originReferenceId: proposal.destinationReferenceId,
      })
    ).toBeNull();
    expect(
      createTripPlanningApplication({
        ...proposal,
        transportReferenceId: proposal.originReferenceId,
      })
    ).toBeNull();
  });
});

describe('STEP 52 application: immutability, determinism, and purity', () => {
  it('21. input proposal is not mutated', () => {
    const original = approvedProposal();
    const snapshot = JSON.stringify(original);
    Object.freeze(original);
    const application = createTripPlanningApplication(original);
    expect(application).not.toBeNull();
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(original.status).toBe('approved');
  });

  it('22. repeated factory call is deterministic', () => {
    const results = Array.from({ length: 5 }, () =>
      createTripPlanningApplication(approvedProposal())
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
  });

  it('an application is never the same object as its proposal', () => {
    const proposal = approvedProposal();
    const application = createTripPlanningApplication(proposal) as TripPlanningApplication;
    expect(application).not.toBe(proposal);
  });

  it('30. no provider-specific fields, 31. no credentials/HTTP data', () => {
    const application = createTripPlanningApplication(approvedProposal()) as TripPlanningApplication;
    const serialized = JSON.stringify(application);
    for (const token of ['google', 'placeId', 'routeToken', 'computeRoutes', 'apiKey', 'Authorization', 'x-goog-api-key', 'providerId', '"url"', 'estimatedCost', 'distanceMeters', 'encodedPolyline', 'payload', 'bookingId', 'paymentIntent']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('27. no persistence and 28/29. no itinerary/trip mutation fields', () => {
    const application = createTripPlanningApplication(approvedProposal()) as TripPlanningApplication;
    const serialized = JSON.stringify(application);
    for (const token of ['firestore', 'localStorage', 'setDoc', 'addDoc', 'serverTimestamp', 'updateTripPlanning', 'dateRange', 'transportPlans', 'accommodationPlans', 'budgetPlan', 'lifecycleState', 'primary', 'dayNumber', '"tripId"', 'itinerary']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('23/24. no timestamps, clock, randomness, or UUID', () => {
    const first = createTripPlanningApplication(approvedProposal()) as TripPlanningApplication;
    const again = createTripPlanningApplication(approvedProposal()) as TripPlanningApplication;
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(JSON.stringify(first)).not.toContain('Date');
  });
});

describe('STEP 52 application: module boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningApplication.ts'),
    'utf8'
  );

  it('imports only the STEP 50 proposal module', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    );
    expect(imports).toEqual(['./tripPlanningCompositionProposal']);
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
});