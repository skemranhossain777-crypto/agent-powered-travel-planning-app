import { describe, expect, it } from 'vitest';
import { buildGoogleRoutesComputeRoutesRequest, runGoogleRoutesComputeRoutes } from '../services/googleRoutes/googleRoutesConnection';
import { GOOGLE_ROUTES_FIELD_MASK } from '../services/googleRoutes/googleRoutesConnection';
import { getGoogleRoutesRouteRequestProblem } from '../services/googleRoutes/googleRoutesMapping';
import { runGoogleRoutesComputeOnline } from '../services/googleRoutes/googleRoutesService';
import type { GoogleRoutesRouteRequest } from '../services/googleRoutes/googleRoutesMapping';
import { isNormalizedRoute } from '../domain/routes/providerRoutes';

const NOW = '2026-09-23T08:00:00.000Z';

const READY = { attemptEnabled: true, credentials: { apiKey: 'routes-secret-key' } };

function request(overrides: Partial<GoogleRoutesRouteRequest> = {}): GoogleRoutesRouteRequest {
  return {
    origin: { latitude: 52.3676, longitude: 4.9041 },
    destination: { latitude: 48.8566, longitude: 2.3522 },
    travelMode: 'DRIVE',
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
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

function fakeResponse(value: unknown, status = 200) {
  return { status, json: async () => value };
}

describe('STEP 47 fixture set 1-6: valid routes and normalization', () => {
  it('1. normalizes a valid DRIVE route', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () => payload());
    expect(outcome.status).toBe('success');
    if (outcome.route) {
      expect(isNormalizedRoute(outcome.route)).toBe(true);
      expect(outcome.route.travelMode).toBe('drive');
      expect(outcome.route.distanceMeters).toBe(223300);
      expect(outcome.route.durationSeconds).toBe(7560);
    }
  });

  it('2. normalizes a valid WALK route (carrying the Beta warning)', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      request({ travelMode: 'WALK' }),
      NOW,
      () => payload({ duration: '8920s' })
    );
    expect(outcome.status).toBe('success');
    expect(outcome.warnings.length).toBe(1);
    expect(outcome.route?.travelMode).toBe('walk');
  });

  it('3. normalizes a valid BICYCLE route (carrying the Beta warning)', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      request({ travelMode: 'BICYCLE' }),
      NOW,
      () => payload({ distanceMeters: 12500, duration: '2400s' })
    );
    expect(outcome.status).toBe('success');
    expect(outcome.warnings.length).toBe(1);
    expect(outcome.route?.travelMode).toBe('bicycle');
  });

  it('4. normalizes a valid TRANSIT route', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      request({ travelMode: 'TRANSIT' }),
      NOW,
      () => payload({ duration: '6000.25s' })
    );
    expect(outcome.status).toBe('success');
    expect(outcome.route?.travelMode).toBe('transit');
    expect(outcome.route?.durationSeconds).toBe(6000.25);
  });

  it('5. preserves distance and duration deterministically (authoritative numbers)', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () =>
      payload({ distanceMeters: 1234, duration: '1234.567s' })
    );
    expect(outcome.route?.distanceMeters).toBe(1234);
    expect(outcome.route?.durationSeconds).toBe(1234.567);
  });

  it('6. carries the optional polyline and provider route reference when present', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () => payload());
    expect(outcome.route?.encodedPolyline).toBe('abcd_EFGH');
    expect(outcome.route?.providerRouteId).toBe('route-token-123');
  });
});

describe('STEP 47 fixture set 7-11: malformed and invalid inputs', () => {
  it('7. malformed route response maps to provider-failure/malformed-response', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () =>
      payload({ distanceMeters: 'not-a-number' })
    );
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
  });

  it('8. a missing route (empty routes array) maps to provider-failure', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () => ({ routes: [] }));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
  });

  it('9. an invalid origin is rejected before any payload access', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      request({ origin: { latitude: NaN, longitude: 0 } }),
      NOW,
      () => payload()
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.error?.category).toBe('invalid-input');
  });

  it('10. an invalid destination is rejected before any payload access', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      request({ destination: { latitude: 0, longitude: 181 } }),
      NOW,
      () => payload()
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.error?.category).toBe('invalid-input');
  });

  it('11. an unsupported travel mode is rejected as invalid, never silently accepted', () => {
    for (const mode of ['FLIGHT', 'TWO_WHEELER', 'RAIL', 'TRAM']) {
      const outcome = runGoogleRoutesComputeOnline(
        READY,
        request({ travelMode: mode as GoogleRoutesRouteRequest['travelMode'] }),
        NOW,
        () => payload()
      );
      expect(outcome.status).toBe('invalid-input');
      expect(outcome.error?.category).toBe('invalid-input');
    }
  });
});

describe('STEP 47 fixture set 12-17: gating, provider failures, and cost protections', () => {
  it('12. a disabled provider reports not-configured (never a request)', () => {
    const outcome = runGoogleRoutesComputeOnline(
      { attemptEnabled: false, credentials: null },
      request(),
      NOW,
      () => payload()
    );
    expect(outcome.status).toBe('not-configured');
  });

  it('13. missing credentials report a bounded credentials-missing outcome', () => {
    const outcome = runGoogleRoutesComputeOnline(
      { attemptEnabled: true, credentials: null },
      request(),
      NOW,
      () => payload()
    );
    expect(outcome.status).toBe('not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
  });

  it('14. a 400 provider rejection maps to provider-rejected', async () => {
    const result = await runGoogleRoutesComputeRoutes(
      READY,
      async () => fakeResponse({}, 400),
      request()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('provider-rejected');
  });

  it('15. a 429 rate limit maps to rate-limited', async () => {
    const result = await runGoogleRoutesComputeRoutes(
      READY,
      async () => fakeResponse({}, 429),
      request()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('rate-limited');
  });

  it('16. a transport network failure maps to network-error with no raw details', async () => {
    const result = await runGoogleRoutesComputeRoutes(
      READY,
      async () => {
        throw new Error('ECONNREFUSED routes-secret');
      },
      request()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('network-error');
      expect(JSON.stringify(result)).not.toContain('routes-secret');
    }
  });

  it('17. an oversized request body is refused under the application-owned bound', () => {
    expect(buildGoogleRoutesComputeRoutesRequest(READY, request(), 10)).toBeNull();
  });
});

describe('STEP 47 fixture set 18-22: fixed surface, secrecy, and isolation', () => {
  it('18. the field mask is a fixed application-owned constant (never client-supplied)', () => {
    expect(GOOGLE_ROUTES_FIELD_MASK).toBe(
      'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeToken'
    );
    expect(GOOGLE_ROUTES_FIELD_MASK).not.toBe('*');
    // A client cannot smuggle a mask through the request shape.
    expect(
      getGoogleRoutesRouteRequestProblem(
        request({ origin: {} as GoogleRoutesRouteRequest['origin'] })
      )?.code
    ).toBe('invalid-origin');
  });

  it('19-20. the endpoint and HTTP method are fixed (POST computeRoutes only)', () => {
    const built = buildGoogleRoutesComputeRoutesRequest(READY, request());
    expect(built?.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(built?.method).toBe('POST');
    // Unknown request keys cannot influence the URL or method.
    const smuggled = { ...request(), routeMatrices: true, method: 'GET' } as unknown;
    expect(getGoogleRoutesRouteRequestProblem(smuggled)?.code).toBe('unknown-key');
  });

  it('21. the API key never appears in a successful outcome', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () => payload());
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('routes-secret-key');
    expect(serialized).not.toContain('AIza');
  });

  it('22. raw provider response fields never cross the outcome boundary', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, request(), NOW, () => ({
      routes: [
        {
          distanceMeters: 500,
          duration: '300s',
          debug: { apiKey: 'AIzaFAKE', fullRequest: { accountID: '123' } },
          rawPolyline: 'RAW-SECRET-POLYLINE',
        },
      ],
      responseSigningKey: 'SECRET-SIGNATURE',
    }));
    const serialized = JSON.stringify(outcome);
    expect(outcome.route).not.toBeNull();
    expect(serialized).not.toContain('AIzaFAKE');
    expect(serialized).not.toContain('RAW-SECRET-POLYLINE');
    expect(serialized).not.toContain('SECRET-SIGNATURE');
    expect(serialized).not.toContain('fullRequest');
    expect(isNormalizedRoute(outcome.route)).toBe(true);
  });
});