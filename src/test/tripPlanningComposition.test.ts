import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_PLANNING_COMPOSITION_ID_PREFIX,
  createTripPlanningComposition,
  getTripPlanningCompositionId,
  type TripPlanningComposition,
} from '../domain/trips/tripPlanningComposition';
import { isTripPlanningReference } from '../domain/trips/tripPlanning';
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

function matchingRoute() {
  return transportReference({
    routeOrigin: ORIGIN_LOCATION,
    routeDestination: DESTINATION_LOCATION,
  });
}

describe('STEP 49 composition: structure', () => {
  it('1. composes two places without a transport leg', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    });
    expect(composition).not.toBeNull();
    expect(composition?.kind).toBe('trip-planning-composition');
    expect(composition?.origin.referenceId).toBe('place:a');
    expect(composition?.destination.referenceId).toBe('place:b');
    expect(composition?.origin.location).toEqual(ORIGIN_LOCATION);
    expect(composition?.destination.location).toEqual(DESTINATION_LOCATION);
    expect(composition?.transport).toBeUndefined();
    expect(composition?.transportCorrespondence).toBeUndefined();
  });

  it('2. composes two places with an explicit transport leg', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    expect(composition?.transport?.referenceId).toBe('transport:route-1');
    expect(composition?.transport?.mode).toBe('drive');
    expect(composition?.transport?.routeOrigin).toEqual(ORIGIN_LOCATION);
    expect(composition?.transport?.routeDestination).toEqual(DESTINATION_LOCATION);
    expect(composition?.transportCorrespondence).toBe('exact-coordinate-match');
  });

  it('carries only reference ids and minimal metadata - never the full transport object', () => {
    const full = matchingRoute();
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: full,
    });
    const serialized = JSON.stringify(composition);
    expect(serialized).not.toContain('"url"');
    expect(serialized).not.toContain('estimatedCost');
    expect(serialized).not.toContain('routeWarnings');
    expect(serialized).not.toContain('encodedPolyline');
    expect(serialized).not.toContain('distanceMeters');
    expect(serialized).not.toContain('"provider"');
  });
});

describe('STEP 49 composition: deterministic identity', () => {
  it('3-4. same references produce the same id and the same value', () => {
    const input = {
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    };
    const first = createTripPlanningComposition(input);
    const again = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    });
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(first?.id).toBe(
      getTripPlanningCompositionId({
        originReferenceId: 'place:a',
        destinationReferenceId: 'place:b',
      })
    );
    expect(first?.id).toMatch(new RegExp(`^${TRIP_PLANNING_COMPOSITION_ID_PREFIX}[^\\s]+$`));
  });

  it('5. changing the origin reference changes the id', () => {
    const base = {
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    };
    const changed = createTripPlanningComposition({
      ...base,
      origin: placeReference({ id: 'place:z' }),
    });
    const original = createTripPlanningComposition(base);
    expect(changed?.id).not.toBe(original?.id);
  });

  it('6. changing the destination reference changes the id', () => {
    const base = {
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    };
    const changed = createTripPlanningComposition({
      ...base,
      destination: placeReference({ id: 'place:z' }),
    });
    const original = createTripPlanningComposition(base);
    expect(changed?.id).not.toBe(original?.id);
  });

  it('7. adding, swapping, or removing the transport changes the id', () => {
    const without = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    });
    const withTransport = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
      transport: transportReference({ id: 'transport:r1' }),
    });
    const otherTransport = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
      transport: transportReference({ id: 'transport:r2' }),
    });
    expect(withTransport?.id).not.toBe(without?.id);
    expect(otherTransport?.id).not.toBe(withTransport?.id);
    expect(withTransport?.id).toContain(':transport:r1');
    expect(without?.id).toContain(':none');
  });

  it('15. identity contains no timestamps, randomness, or mutable labels', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    });
    expect(composition?.id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(composition?.id).not.toContain('Alpha Place');
    const serialized = JSON.stringify(composition);
    expect(serialized).not.toContain('createdAt');
    expect(serialized).not.toContain('updatedAt');
  });
});

describe('STEP 49 composition: validation', () => {
  it('8. rejects a missing origin', () => {
    expect(
      createTripPlanningComposition({
        origin: undefined,
        destination: placeReference({ id: 'place:b' }),
      })
    ).toBeNull();
  });

  it('9. rejects a missing destination', () => {
    expect(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a' }),
        destination: undefined,
      })
    ).toBeNull();
  });

  it('10. rejects a malformed origin reference', () => {
    expect(
      createTripPlanningComposition({ origin: { id: 'place:a' }, destination: placeReference({ id: 'place:b' }) })
    ).toBeNull();
    expect(
      createTripPlanningComposition({ origin: 'not-a-reference', destination: placeReference({ id: 'place:b' }) })
    ).toBeNull();
  });

  it('11. rejects a malformed destination reference', () => {
    expect(
      createTripPlanningComposition({ origin: placeReference({ id: 'place:a' }), destination: null })
    ).toBeNull();
    expect(
      createTripPlanningComposition({ origin: placeReference({ id: 'place:a' }), destination: { title: 'x' } })
    ).toBeNull();
  });

  it('12. rejects a malformed or non-transport transport reference', () => {
    const base = { origin: placeReference({ id: 'place:a' }), destination: placeReference({ id: 'place:b' }) };
    expect(createTripPlanningComposition({ ...base, transport: undefined })).not.toBeNull();
    expect(createTripPlanningComposition({ ...base, transport: placeReference({ id: 'place:c', kind: 'activity' }) }))
      .toBeNull();
    expect(createTripPlanningComposition({ ...base, transport: { kind: 'transport' } })).toBeNull();
  });

  it('rejects an origin identical to the destination', () => {
    expect(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:same' }),
        destination: placeReference({ id: 'place:same' }),
      })
    ).toBeNull();
  });

  it('rejects a routing transport reference placed in the origin or destination role', () => {
    const route = matchingRoute();
    expect(
      createTripPlanningComposition({ origin: route, destination: placeReference({ id: 'place:b' }) })
    ).toBeNull();
    expect(
      createTripPlanningComposition({ origin: placeReference({ id: 'place:a' }), destination: route })
    ).toBeNull();
  });

  it('rejects a transport that is also the origin or destination reference', () => {
    const sameAsOrigin = transportReference({ id: 'place:a' });
    expect(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a' }),
        destination: placeReference({ id: 'place:b' }),
        transport: sameAsOrigin,
      })
    ).toBeNull();
  });

  it('accepts a transport-kind place (a station with a location) in the place role', () => {
    const station = placeReference({
      id: 'place:station',
      title: 'Central Station',
      kind: 'transport',
      location: ORIGIN_LOCATION,
    });
    const composition = createTripPlanningComposition({
      origin: station,
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    expect(composition?.origin.referenceId).toBe('place:station');
    expect(composition?.transportCorrespondence).toBe('exact-coordinate-match');
  });
});

describe('STEP 49 composition: route/reference correspondence', () => {
  it('19. accepts an exact endpoint match and marks it verified', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    expect(composition?.transportCorrespondence).toBe('exact-coordinate-match');
  });

  it('20. rejects a transport whose endpoints do not match the composed places', () => {
    const wrongRoute = transportReference({
      routeOrigin: { latitude: 51.5074, longitude: -0.1278 },
      routeDestination: { latitude: 40.7128, longitude: -74.006 },
    });
    expect(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
        destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
        transport: wrongRoute,
      })
    ).toBeNull();
    const reversed = transportReference({
      routeOrigin: DESTINATION_LOCATION,
      routeDestination: ORIGIN_LOCATION,
    });
    expect(
      createTripPlanningComposition({
        origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
        destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
        transport: reversed,
      })
    ).toBeNull();
  });

  it('21. preserves the composition as unverified when coordinate data is insufficient', () => {
    const noPlaceCoordinates = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    expect(noPlaceCoordinates?.transportCorrespondence).toBe('unverified');
    expect(noPlaceCoordinates).not.toBeNull();

    const noRouteEndpoints = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: transportReference({ id: 'transport:r1', mode: 'drive' }),
    });
    expect(noRouteEndpoints?.transportCorrespondence).toBe('unverified');
    expect(noRouteEndpoints).not.toBeNull();
  });
});

describe('STEP 49 composition: provider neutrality and lifecycle safety', () => {
  it('13. composes equally across arbitrary providers', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'mock:a', provider: 'Mock Discovery', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'amadeus:b', provider: 'Amadeus', location: DESTINATION_LOCATION }),
      transport: transportReference({
        id: 'routes:c',
        provider: 'Some Future Router',
        routeOrigin: ORIGIN_LOCATION,
        routeDestination: DESTINATION_LOCATION,
      }),
    });
    expect(composition).not.toBeNull();
    expect(composition?.origin.referenceId).toBe('mock:a');
    expect(composition?.destination.referenceId).toBe('amadeus:b');
    expect(composition?.transport?.referenceId).toBe('routes:c');
    expect(composition?.transportCorrespondence).toBe('exact-coordinate-match');
  });

  it('14. the composition value contains no provider-specific or HTTP fields', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    const serialized = JSON.stringify(composition);
    for (const token of [
      'google',
      'placeId',
      'routeToken',
      'computeRoutes',
      'placeDetails',
      'fieldMask',
      'x-goog-api-key',
      'Authorization',
      'apiKey',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it('16. has no persistence side effects and stays pure', () => {
    const input = {
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    };
    const serialized = JSON.stringify(createTripPlanningComposition(input));
    for (const token of ['firestore', 'localStorage', 'setDoc', 'addDoc', 'updateDoc', 'save(']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('17. performs no provider invocation and resolves no new data', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a' }),
      destination: placeReference({ id: 'place:b' }),
    });
    const serialized = JSON.stringify(composition);
    for (const token of ['computeRoutes', 'search-places', 'discover', 'fetch(', 'weather', 'traffic']) {
      expect(serialized).not.toContain(token);
    }
  });

  it('18. preserves the existing lifecycle: no activation, no primary, no day', () => {
    const composition = createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
      transport: matchingRoute(),
    });
    const serialized = JSON.stringify(composition);
    for (const token of [
      'lifecycleState',
      'dayNumber',
      'primaryTransportPlanId',
      'primaryAccommodationPlanId',
      'isActive',
      'readiness',
    ]) {
      expect(serialized).not.toContain(token);
    }
    // The member references are untouched and remain independently valid.
    expect(isTripPlanningReference(placeReference({ id: 'place:a', location: ORIGIN_LOCATION }))).toBe(true);
    expect(isTripPlanningReference(matchingRoute())).toBe(true);
  });

  it('22. never mutates its input references', () => {
    const origin = placeReference({ id: 'place:a', location: ORIGIN_LOCATION });
    const destination = placeReference({ id: 'place:b', location: DESTINATION_LOCATION });
    const transport = matchingRoute();
    const before = JSON.stringify({ origin, destination, transport });
    Object.freeze(origin);
    Object.freeze(destination);
    Object.freeze(transport);
    const composition = createTripPlanningComposition({ origin, destination, transport });
    expect(composition).not.toBeNull();
    expect(JSON.stringify({ origin, destination, transport })).toBe(before);
  });
});

describe('STEP 49 boundary: the composition domain stays pure, secret-free, and provider-free', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'domain', 'trips', 'tripPlanningComposition.ts'), 'utf8');

  it('imports only trip-planning domain vocabulary and pure types', () => {
    expect(source).toMatch(/from\s+['"]\.\/tripPlanning['"]/);
    expect(source).toMatch(/from\s+['"]\.\.\/\.\.\/types\/trip['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/services\//);
    expect(source).not.toMatch(/from\s+['"].*firestore.*['"]/);
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/updateTripPlanning\s*\(/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  });

  it('has no network, clock, randomness, or environment access', () => {
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/axios|stripe|provider-api|@google-cloud/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/import\.meta\.env/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/\bDate\b/);
  });

  it('has no booking, payment, activation, or auto-selection vocabulary', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking/);
    expect(source).not.toMatch(/charge|payment-intent|paid|invoice/);
    expect(source).not.toMatch(/autoPrimary|defaultPrimary|selectDefault|assignPrimary/);
    expect(source).not.toMatch(/lifecycleState|activate\(|promote\(/);
  });

  it('declares a stable composition type usable as typed value', () => {
    const composition: TripPlanningComposition = {
      id: getTripPlanningCompositionId({
        originReferenceId: 'place:a',
        destinationReferenceId: 'place:b',
      }),
      kind: 'trip-planning-composition',
      origin: { referenceId: 'place:a' },
      destination: { referenceId: 'place:b' },
    };
    expect(composition.origin.referenceId).toBe('place:a');
    expect(composition.kind).toBe('trip-planning-composition');
  });
});