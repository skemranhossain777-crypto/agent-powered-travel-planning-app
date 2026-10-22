import { describe, expect, it } from 'vitest';
import type { TripTransportReference } from '../types/trip';
import {
  GOOGLE_ROUTES_REFERENCE_ID_PREFIX,
  adaptNormalizedRouteToPlanningReference,
  getGoogleRoutesReferenceId,
} from '../services/googleRoutes/googleRoutesPlanningAdapter';
import { GOOGLE_ROUTES_PROVIDER_NAME } from '../services/googleRoutes/googleRoutesConfig';
import { GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING, getGoogleRoutesModeWarnings } from '../services/googleRoutes/googleRoutesMapping';
import { runGoogleRoutesComputeOnline } from '../services/googleRoutes/googleRoutesService';
import { isTripPlanningReference } from '../domain/trips/tripPlanning';
import { normalizeTripPlanningUpdate } from '../domain/trips/tripPlanningEdit';

function routeFixture(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'google-routes',
    providerName: 'Google Routes',
    origin: { latitude: 52.3676, longitude: 4.9041 },
    destination: { latitude: 48.8566, longitude: 2.3522 },
    travelMode: 'drive',
    distanceMeters: 223300,
    durationSeconds: 7560,
    limitations: ['read-only planning estimate'],
    ...overrides,
  };
}

function transportOf(reference: ReturnType<typeof adaptNormalizedRouteToPlanningReference>): TripTransportReference {
  expect(reference?.kind).toBe('transport');
  return reference as unknown as TripTransportReference;
}

describe('STEP 48 route -> planning reference: valid routes (scenarios 1-4)', () => {
  it('1. adapts a valid DRIVE route into a transport planning reference', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.kind).toBe('transport');
    expect(reference.mode).toBe('drive');
    expect(reference.distanceMeters).toBe(223300);
    expect(reference.durationSeconds).toBe(7560);
    expect(isTripPlanningReference(reference)).toBe(true);
  });

  it('2. adapts a valid WALK route and preserves the Beta advisory warning', () => {
    const reference = transportOf(
      adaptNormalizedRouteToPlanningReference(
        routeFixture({
          travelMode: 'walk',
          distanceMeters: 1000,
          durationSeconds: 900,
          warnings: getGoogleRoutesModeWarnings('WALK'),
        })
      )
    );
    expect(reference.mode).toBe('walk');
    expect(reference.routeWarnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
  });

  it('3. adapts a valid BICYCLE route and preserves the Beta advisory warning', () => {
    const reference = transportOf(
      adaptNormalizedRouteToPlanningReference(
        routeFixture({
          travelMode: 'bicycle',
          distanceMeters: 12500,
          durationSeconds: 2400,
          warnings: getGoogleRoutesModeWarnings('BICYCLE'),
        })
      )
    );
    expect(reference.mode).toBe('bicycle');
    expect(reference.routeWarnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
  });

  it('4. adapts a valid TRANSIT route', () => {
    const reference = transportOf(
      adaptNormalizedRouteToPlanningReference(
        routeFixture({ travelMode: 'transit', distanceMeters: 50000, durationSeconds: 6000.25 })
      )
    );
    expect(reference.mode).toBe('transit');
    expect(reference.distanceMeters).toBe(50000);
    expect(reference.durationSeconds).toBe(6000.25);
    expect(reference.routeWarnings).toBeUndefined();
  });
});

describe('STEP 48 route -> planning reference: field preservation (scenarios 5-9)', () => {
  it('5. preserves origin and destination as route coordinates (not a place location)', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.routeOrigin).toEqual({ latitude: 52.3676, longitude: 4.9041 });
    expect(reference.routeDestination).toEqual({ latitude: 48.8566, longitude: 2.3522 });
    expect(reference.location).toBeUndefined();
    expect(reference.address).toBeUndefined();
    expect(reference.category).toBeUndefined();
  });

  it('6. preserves the neutral travel mode', () => {
    for (const mode of ['drive', 'walk', 'bicycle', 'transit']) {
      const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture({ travelMode: mode })));
      expect(reference.mode).toBe(mode);
    }
  });

  it('7. preserves the authoritative distance', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.distanceMeters).toBe(223300);
  });

  it('8. preserves the authoritative duration', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.durationSeconds).toBe(7560);
  });

  it('9. preserves the encoded polyline only when the contract supplies one', () => {
    const withPolyline = transportOf(
      adaptNormalizedRouteToPlanningReference(routeFixture({ encodedPolyline: 'abcd_EFGH' }))
    );
    expect(withPolyline.encodedPolyline).toBe('abcd_EFGH');
    const without = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(without.encodedPolyline).toBeUndefined();
  });
});

describe('STEP 48 end-to-end handoff: provider online path -> planning reference', () => {
  const NOW = '2026-09-23T08:00:00.000Z';
  const READY = { attemptEnabled: true, credentials: { apiKey: 'routes-secret-key' } };

  function payloadRoute(overrides: Record<string, unknown> = {}) {
    return {
      routes: [
        {
          distanceMeters: 223300,
          duration: '7560s',
          polyline: { encodedPolyline: 'abcd_EFGH' },
          routeToken: 'route-token-123',
          ...overrides,
        },
      ],
    };
  }

  it('a real WALK online outcome hands off with its advisory, provenance, and neutral mode intact', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      {
        origin: { latitude: 52.3676, longitude: 4.9041 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        travelMode: 'WALK',
      },
      NOW,
      () => payloadRoute({ duration: '8920s' })
    );
    expect(outcome.status).toBe('success');
    expect(outcome.route?.warnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);

    const reference = transportOf(adaptNormalizedRouteToPlanningReference(outcome.route));
    expect(reference.mode).toBe('walk');
    expect(reference.provider).toBe('Google Routes');
    expect(reference.providerId).toBe('route-token-123');
    expect(reference.encodedPolyline).toBe('abcd_EFGH');
    expect(reference.routeWarnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
    expect(isTripPlanningReference(reference)).toBe(true);
    expect(reference.location).toBeUndefined();
  });

  it('a real DRIVE online outcome hands off without the active-mode advisory', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      {
        origin: { latitude: 52.3676, longitude: 4.9041 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        travelMode: 'DRIVE',
      },
      NOW,
      () => payloadRoute()
    );
    expect(outcome.status).toBe('success');
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(outcome.route));
    expect(reference.mode).toBe('drive');
    expect(reference.routeWarnings).toBeUndefined();
    expect(reference.distanceMeters).toBe(223300);
    expect(reference.durationSeconds).toBe(7560);
    expect(reference.provider).toBe(GOOGLE_ROUTES_PROVIDER_NAME);
  });
});

describe('STEP 48 provenance and deterministic identity (scenarios 10-13)', () => {
  it('10. provider provenance is exactly Google Routes', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.provider).toBe(GOOGLE_ROUTES_PROVIDER_NAME);
    expect(reference.provider).toBe('Google Routes');
  });

  it('carries the provider route reference only when the contract supplied one', () => {
    const withToken = transportOf(
      adaptNormalizedRouteToPlanningReference(routeFixture({ providerRouteId: 'route-token-123' }))
    );
    expect(withToken.providerId).toBe('route-token-123');
    const without = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(without.providerId).toBeUndefined();
  });

  it('11-13. derives a deterministic, input-scoped identity from validated inputs', () => {
    const first = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    const again = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(first.id).toBe(again.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));

    const otherOrigin = routeFixture({ origin: { latitude: 51.5074, longitude: -0.1278 } });
    const other = transportOf(adaptNormalizedRouteToPlanningReference(otherOrigin));
    expect(other.id).not.toBe(first.id);

    const otherMode = routeFixture({ travelMode: 'walk' });
    const byMode = transportOf(adaptNormalizedRouteToPlanningReference(otherMode));
    expect(byMode.id).not.toBe(first.id);

    expect(first.id).toMatch(new RegExp(`^${GOOGLE_ROUTES_REFERENCE_ID_PREFIX}[^\\s]+$`));
    const identityA = getGoogleRoutesReferenceId(routeFixture());
    const identityB = getGoogleRoutesReferenceId(routeFixture({ origin: { latitude: 52.3676, longitude: 4.9041 } }));
    expect(identityA).toBe(identityB);
    expect(identityA).toBe(first.id);
  });
});

describe('STEP 48 honest rejection (scenarios 14-20)', () => {
  it('14. rejects malformed route input', () => {
    expect(adaptNormalizedRouteToPlanningReference(null)).toBeNull();
    expect(adaptNormalizedRouteToPlanningReference({})).toBeNull();
    expect(adaptNormalizedRouteToPlanningReference('routes')).toBeNull();
  });

  it('15. rejects invalid or non-finite coordinates', () => {
    expect(
      adaptNormalizedRouteToPlanningReference(
        routeFixture({ origin: { latitude: Number.NaN, longitude: 4.9041 } })
      )
    ).toBeNull();
    expect(
      adaptNormalizedRouteToPlanningReference(
        routeFixture({ destination: { latitude: 91, longitude: 2.3522 } })
      )
    ).toBeNull();
  });

  it('16. rejects a missing origin', () => {
    expect(
      adaptNormalizedRouteToPlanningReference(routeFixture({ origin: undefined }))
    ).toBeNull();
  });

  it('17. rejects a missing destination', () => {
    expect(
      adaptNormalizedRouteToPlanningReference(routeFixture({ destination: { latitude: 48.8566 } }))
    ).toBeNull();
  });

  it('18. rejects negative distance', () => {
    expect(
      adaptNormalizedRouteToPlanningReference(routeFixture({ distanceMeters: -1 }))
    ).toBeNull();
  });

  it('19. rejects malformed duration', () => {
    expect(
      adaptNormalizedRouteToPlanningReference(routeFixture({ durationSeconds: Number.NaN }))
    ).toBeNull();
    expect(
      adaptNormalizedRouteToPlanningReference(routeFixture({ durationSeconds: -5 }))
    ).toBeNull();
  });

  it('20. rejects unsupported travel modes', () => {
    for (const mode of ['flight', 'rail', 'jetpack', 'DRIVE', '']) {
      expect(adaptNormalizedRouteToPlanningReference(routeFixture({ travelMode: mode }))).toBeNull();
    }
  });
});

describe('STEP 48 secrecy, lifecycle, and side-effect freedom (scenarios 21-24)', () => {
  it('21. raw provider payload can never cross the adapter boundary', () => {
    const raw = routeFixture({
      apiSecret: 'AIzaFAKEKEY',
      rawResponse: { status: 'OK', totalDuration: '24h' },
      fullRequest: { accountID: 'secret-account' },
      debug: { cacheKey: 'x' },
    });
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(raw));
    const serialized = JSON.stringify(reference);
    expect(serialized).not.toContain('AIzaFAKEKEY');
    expect(serialized).not.toContain('rawResponse');
    expect(serialized).not.toContain('fullRequest');
    expect(serialized).not.toContain('cacheKey');
    expect(serialized).not.toContain('accountID');
  });

  it('22. lifecycle fields are not automatically activated or assigned', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(reference.dayNumber).toBeUndefined();
    expect('lifecycleState' in reference).toBe(false);
    expect('provenance' in reference).toBe(false);
    expect('readiness' in reference).toBe(false);
  });

  it('23. produces a candidate only; no itinerary mutation is triggered', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    const normalized = normalizeTripPlanningUpdate({ references: [reference] });
    expect(normalized).not.toBeNull();
    expect(normalized?.references).toHaveLength(1);
    expect(normalized?.references?.[0].kind).toBe('transport');
    const again = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(JSON.stringify(again)).toBe(JSON.stringify(reference));
  });

  it('24. no persistence or network side effect ever materializes', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    const serialized = JSON.stringify(reference);
    expect(serialized).not.toContain('firestore');
    expect(serialized).not.toContain('setDoc');
    expect(serialized).not.toContain('fetch(');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('x-goog-api-key');
  });
});

describe('STEP 48 additive domain validation stays transport-scoped', () => {
  it('the adapted reference passes the shared domain validator', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture()));
    expect(isTripPlanningReference(reference)).toBe(true);
  });

  it('rejects a transport reference with invalid route fields at the domain gate', () => {
    const reference = transportOf(adaptNormalizedRouteToPlanningReference(routeFixture())) as unknown as Record<string, unknown>;
    expect(isTripPlanningReference({ ...reference, distanceMeters: -5 })).toBe(false);
    expect(
      isTripPlanningReference({ ...reference, routeOrigin: { latitude: 95, longitude: 0 } })
    ).toBe(false);
    expect(isTripPlanningReference({ ...reference, routeWarnings: ['ok', ''] })).toBe(false);
    expect(
      isTripPlanningReference({ ...reference, encodedPolyline: 'x'.repeat(30001) })
    ).toBe(false);
  });

  it('does not weaken existing place-reference validation', () => {
    const placeReference = {
      id: 'google-places:ChIJ',
      title: 'Museum',
      provider: 'Google Places',
      providerId: 'ChIJ',
      location: { latitude: 52.3676, longitude: 4.9041 },
      category: 'museum',
      kind: 'activity',
    };
    expect(isTripPlanningReference(placeReference)).toBe(true);
    expect(
      isTripPlanningReference({ ...placeReference, location: { latitude: 91, longitude: 0 } })
    ).toBe(false);
  });
});