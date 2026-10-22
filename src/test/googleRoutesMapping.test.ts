import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING,
  GOOGLE_ROUTES_RESULT_DISCLAIMER,
  GOOGLE_ROUTES_TRAVEL_MODES,
  getGoogleRoutesModeWarnings,
  getGoogleRoutesRouteRequestProblem,
  isGoogleRoutesRouteRequest,
  isGoogleRoutesTravelMode,
  mapGoogleRoutesComputeRoutesResponse,
  mapGoogleRoutesTravelMode,
  normalizeGoogleRoutesRouteRequest,
  readGoogleRoutesDurationSeconds,
  type GoogleRoutesRouteRequest,
} from '../services/googleRoutes/googleRoutesMapping';
import {
  isNormalizedRoute,
  isNormalizedRouteTravelMode,
} from '../domain/routes/providerRoutes';

const VALID_REQUEST: GoogleRoutesRouteRequest = {
  origin: { latitude: 52.3676, longitude: 4.9041 },
  destination: { latitude: 48.8566, longitude: 2.3522 },
  travelMode: 'DRIVE',
};

describe('STEP 47 travel-mode vocabulary', () => {
  it('is a fixed allowlist of exactly DRIVE, WALK, BICYCLE, TRANSIT', () => {
    expect(GOOGLE_ROUTES_TRAVEL_MODES).toEqual(['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT']);
    for (const mode of GOOGLE_ROUTES_TRAVEL_MODES) {
      expect(isGoogleRoutesTravelMode(mode)).toBe(true);
      expect(isNormalizedRouteTravelMode(mapGoogleRoutesTravelMode(mode))).toBe(true);
    }
  });

  it('rejects arbitrary provider enum strings (never silently accepted)', () => {
    for (const mode of ['FLIGHT', 'TWO_WHEELER', 'RAIL', 'UNKNOWN', 'drive', 42, null]) {
      expect(isGoogleRoutesTravelMode(mode)).toBe(false);
    }
  });

  it('maps to the neutral lowercase vocabulary deterministically', () => {
    expect(mapGoogleRoutesTravelMode('DRIVE')).toBe('drive');
    expect(mapGoogleRoutesTravelMode('WALK')).toBe('walk');
    expect(mapGoogleRoutesTravelMode('BICYCLE')).toBe('bicycle');
    expect(mapGoogleRoutesTravelMode('TRANSIT')).toBe('transit');
  });
});

describe('STEP 47 route request validation', () => {
  it('accepts exactly one valid origin and one valid destination with an allowlisted mode', () => {
    expect(normalizeGoogleRoutesRouteRequest(VALID_REQUEST)).toEqual(VALID_REQUEST);
    expect(getGoogleRoutesRouteRequestProblem(VALID_REQUEST)).toBeNull();
  });

  it('rejects an invalid origin (non-finite, out of range, or not an object)', () => {
    expect(
      getGoogleRoutesRouteRequestProblem({ ...VALID_REQUEST, origin: { latitude: NaN, longitude: 0 } })
        ?.code
    ).toBe('invalid-origin');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        origin: { latitude: 0, longitude: NaN },
      })?.code
    ).toBe('invalid-origin');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        origin: { latitude: 95, longitude: 0 },
      })?.code
    ).toBe('origin-latitude-out-of-range');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        origin: { latitude: 0, longitude: -181 },
      })?.code
    ).toBe('origin-longitude-out-of-range');
    expect(
      getGoogleRoutesRouteRequestProblem({ ...VALID_REQUEST, origin: 'not-an-object' })?.code
    ).toBe('invalid-origin');
  });

  it('rejects an invalid destination (finite pattern enforced independently)', () => {
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        destination: { latitude: 0, longitude: Infinity },
      })?.code
    ).toBe('invalid-destination');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        destination: { latitude: Infinity, longitude: 0 },
      })?.code
    ).toBe('invalid-destination');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        destination: 'not-an-object',
      })?.code
    ).toBe('invalid-destination');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        destination: { latitude: 91, longitude: 0 },
      })?.code
    ).toBe('destination-latitude-out-of-range');
    expect(
      getGoogleRoutesRouteRequestProblem({
        ...VALID_REQUEST,
        destination: { latitude: 0, longitude: 181 },
      })?.code
    ).toBe('destination-longitude-out-of-range');
  });

  it('rejects an invalid travel mode', () => {
    expect(
      getGoogleRoutesRouteRequestProblem({ ...VALID_REQUEST, travelMode: 'FLIGHT' })?.code
    ).toBe('invalid-travel-mode');
  });

  it('rejects unknown keys so no provider parameter can be smuggled', () => {
    const problem = getGoogleRoutesRouteRequestProblem({
      ...VALID_REQUEST,
      transitPreferences: { routingPreference: 'FEWER_TRANSFERS' },
    });
    expect(problem?.code).toBe('unknown-key');
    expect(problem?.key).toBe('transitPreferences');
  });

  it('rejects non-object input entirely', () => {
    expect(getGoogleRoutesRouteRequestProblem(null)?.code).toBe('not-an-object');
  });

  it('isGoogleRoutesRouteRequest agrees with the validator on valid and invalid inputs', () => {
    expect(isGoogleRoutesRouteRequest(VALID_REQUEST)).toBe(true);
    expect(isGoogleRoutesRouteRequest({ ...VALID_REQUEST, travelMode: 'FLIGHT' })).toBe(false);
    expect(isGoogleRoutesRouteRequest(null)).toBe(false);
    expect(isGoogleRoutesRouteRequest({ origin: 'x', destination: 'y', travelMode: 'DRIVE' })).toBe(
      false
    );
  });
});

describe('STEP 47 duration parsing', () => {
  it('parses only strict, non-negative protobuf-style durations', () => {
    expect(readGoogleRoutesDurationSeconds('0s')).toBe(0);
    expect(readGoogleRoutesDurationSeconds('2334s')).toBe(2334);
    expect(readGoogleRoutesDurationSeconds('2334.5s')).toBe(2334.5);
    expect(readGoogleRoutesDurationSeconds('0.001s')).toBe(0.001);
    expect(readGoogleRoutesDurationSeconds('864000s')).toBe(864000);
  });

  it('rejects malformed, negative, unbounded, or non-string durations', () => {
    for (const bad of [
      '2334',
      '-2334s',
      '2334.5',
      '2334ss',
      '1e3s',
      '2334 ms',
      '',
      2334,
      null,
      '864001s',
      '007s',
    ]) {
      expect(readGoogleRoutesDurationSeconds(bad)).toBeNull();
    }
  });
});

function drivePayload(overrides: Record<string, unknown> = {}) {
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

describe('STEP 47 response normalization', () => {
  it('normalizes a valid DRIVE route into the neutral contract', () => {
    const route = mapGoogleRoutesComputeRoutesResponse(drivePayload(), VALID_REQUEST);
    expect(route).not.toBeNull();
    expect(route?.providerId).toBe('google-routes');
    expect(route?.providerName).toBe('Google Routes');
    expect(route?.travelMode).toBe('drive');
    expect(route?.origin).toEqual(VALID_REQUEST.origin);
    expect(route?.destination).toEqual(VALID_REQUEST.destination);
    expect(isNormalizedRoute(route)).toBe(true);
    expect(route?.distanceMeters).toBe(223300);
    expect(route?.durationSeconds).toBe(7560);
    expect(route?.encodedPolyline).toBe('abcd_EFGH');
    expect(route?.providerRouteId).toBe('route-token-123');
    expect(route?.limitations).toContain(GOOGLE_ROUTES_RESULT_DISCLAIMER);
  });

  it('derives the neutral travel mode from the validated request, not the payload', () => {
    const walkRoute = mapGoogleRoutesComputeRoutesResponse(drivePayload(), {
      ...VALID_REQUEST,
      travelMode: 'WALK',
    });
    expect(walkRoute?.travelMode).toBe('walk');
  });

  it('omits polyline and routeToken when the provider does not return them', () => {
    const stripped = mapGoogleRoutesComputeRoutesResponse(
      drivePayload({ polyline: undefined, routeToken: undefined }),
      VALID_REQUEST
    );
    expect(stripped).not.toBeNull();
    expect(stripped?.encodedPolyline).toBeUndefined();
    expect(stripped?.providerRouteId).toBeUndefined();
    expect(isNormalizedRoute(stripped)).toBe(true);
  });

  it('returns null for a missing routes array or a structurally unusable route', () => {
    expect(mapGoogleRoutesComputeRoutesResponse(null, VALID_REQUEST)).toBeNull();
    expect(mapGoogleRoutesComputeRoutesResponse({}, VALID_REQUEST)).toBeNull();
    expect(mapGoogleRoutesComputeRoutesResponse({ routes: [] }, VALID_REQUEST)).toBeNull();
    expect(mapGoogleRoutesComputeRoutesResponse({ routes: [null] }, VALID_REQUEST)).toBeNull();
    expect(mapGoogleRoutesComputeRoutesResponse({ routes: [{}] }, VALID_REQUEST)).toBeNull();
  });

  it('rejects an invalid or out-of-bounds distance', () => {
    expect(
      mapGoogleRoutesComputeRoutesResponse(drivePayload({ distanceMeters: -1 }), VALID_REQUEST)
    ).toBeNull();
    expect(
      mapGoogleRoutesComputeRoutesResponse(drivePayload({ distanceMeters: 1.5 }), VALID_REQUEST)
    ).toBeNull();
    expect(
      mapGoogleRoutesComputeRoutesResponse(
        drivePayload({ distanceMeters: 100_000_001 }),
        VALID_REQUEST
      )
    ).toBeNull();
  });

  it('rejects an invalid or out-of-bounds duration', () => {
    expect(
      mapGoogleRoutesComputeRoutesResponse(drivePayload({ duration: '7560' }), VALID_REQUEST)
    ).toBeNull();
    expect(
      mapGoogleRoutesComputeRoutesResponse(drivePayload({ duration: '864001s' }), VALID_REQUEST)
    ).toBeNull();
  });

  it('strips raw provider fields and never leaks payload internals through normalization', () => {
    const route = mapGoogleRoutesComputeRoutesResponse(
      drivePayload({
        apiSecret: 'AIzaFAKEKEY',
        rawRequest: { originLat: 1 },
      }),
      VALID_REQUEST
    );
    const serialized = JSON.stringify(route);
    expect(serialized).not.toContain('AIzaFAKEKEY');
    expect(serialized).not.toContain('rawRequest');
    expect(isNormalizedRoute(route)).toBe(true);
  });
});

describe('STEP 47 walking/bicycling Beta warning', () => {
  it('attaches the documented Beta warning only to WALK and BICYCLE', () => {
    expect(getGoogleRoutesModeWarnings('WALK')).toEqual([GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING]);
    expect(getGoogleRoutesModeWarnings('BICYCLE')).toEqual([GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING]);
    expect(getGoogleRoutesModeWarnings('DRIVE')).toEqual([]);
    expect(getGoogleRoutesModeWarnings('TRANSIT')).toEqual([]);
  });
});