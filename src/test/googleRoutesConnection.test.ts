import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ROUTES_BASE_URL,
  GOOGLE_ROUTES_COMPUTE_ROUTES_PATH,
  GOOGLE_ROUTES_FIELD_MASK,
  buildGoogleRoutesComputeRoutesRequest,
  createGoogleRoutesFetchTransport,
  googleRoutesTransportStatusToError,
  runGoogleRoutesComputeRoutes,
  type GoogleRoutesTransportRequest,
} from '../services/googleRoutes/googleRoutesConnection';
import type { GoogleRoutesRouteRequest } from '../services/googleRoutes/googleRoutesMapping';

const REQUEST: GoogleRoutesRouteRequest = {
  origin: { latitude: 52.3676, longitude: 4.9041 },
  destination: { latitude: 48.8566, longitude: 2.3522 },
  travelMode: 'DRIVE',
};

const READY_CONFIG = {
  attemptEnabled: true,
  credentials: { apiKey: 'routes-secret-key' },
};

function fakeResponse(payload: unknown, status = 200) {
  return { status, json: async () => payload };
}

describe('STEP 47 Google Routes connection contract', () => {
  it('uses the fixed computeRoutes host, path, method, and field mask', () => {
    expect(GOOGLE_ROUTES_BASE_URL).toBe('https://routes.googleapis.com');
    expect(GOOGLE_ROUTES_COMPUTE_ROUTES_PATH).toBe('/directions/v2:computeRoutes');
    expect(GOOGLE_ROUTES_FIELD_MASK).toBe(
      'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeToken'
    );
  });

  it('builds a POST request with the key in the header and the approved bounded body only', () => {
    const request = buildGoogleRoutesComputeRoutesRequest(READY_CONFIG, REQUEST);
    expect(request).not.toBeNull();
    expect(request?.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(request?.method).toBe('POST');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['x-goog-api-key']).toBe('routes-secret-key');
    expect(request?.headers['x-goog-fieldmask']).toBe(GOOGLE_ROUTES_FIELD_MASK);
    const body = JSON.parse(request?.body as string);
    expect(body).toEqual({
      origin: { location: { latLng: { latitude: 52.3676, longitude: 4.9041 } } },
      destination: { location: { latLng: { latitude: 48.8566, longitude: 2.3522 } } },
      travelMode: 'DRIVE',
    });
  });

  it('returns null when credentials are missing (bounded credentials-missing gate)', () => {
    expect(
      buildGoogleRoutesComputeRoutesRequest({ attemptEnabled: true, credentials: null }, REQUEST)
    ).toBeNull();
    expect(
      buildGoogleRoutesComputeRoutesRequest({ attemptEnabled: false, credentials: null }, REQUEST)
    ).toBeNull();
  });

  it('refuses an oversized request body under the application-owned bound', () => {
    expect(buildGoogleRoutesComputeRoutesRequest(READY_CONFIG, REQUEST, 10)).toBeNull();
    expect(
      buildGoogleRoutesComputeRoutesRequest(READY_CONFIG, REQUEST, 100000)
    ).not.toBeNull();
  });
});

describe('STEP 47 running Compute Routes through the transport seam', () => {
  it('runs one read-only POST and returns the payload on a 200', async () => {
    const requests: GoogleRoutesTransportRequest[] = [];
    const transport = async (request: GoogleRoutesTransportRequest) => {
      requests.push(request);
      return fakeResponse({ routes: [] });
    };
    const result = await runGoogleRoutesComputeRoutes(READY_CONFIG, transport, REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual({ routes: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
  });

  it('maps a missing-key config to a bounded credentials-missing error', async () => {
    const transport = async () => fakeResponse({});
    const result = await runGoogleRoutesComputeRoutes(
      { attemptEnabled: true, credentials: null },
      transport,
      REQUEST
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('credentials-missing');
  });

  it('captures network failures as bounded network-error without raw details', async () => {
    const transport = async () => {
      throw new Error('ECONNREFUSED routes-secret');
    };
    const result = await runGoogleRoutesComputeRoutes(READY_CONFIG, transport, REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('network-error');
      expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(result)).not.toContain('routes-secret');
    }
  });

  it('maps HTTP statuses to the documented safe categories', async () => {
    const cases: Array<[number, string]> = [
      [400, 'provider-rejected'],
      [401, 'authentication-required'],
      [403, 'authentication-required'],
      [404, 'provider-unavailable'],
      [429, 'rate-limited'],
      [500, 'provider-unavailable'],
      [503, 'provider-unavailable'],
      [418, 'provider-rejected'],
    ];
    for (const [status, expected] of cases) {
      const transport = async () => fakeResponse({}, status);
      const result = await runGoogleRoutesComputeRoutes(READY_CONFIG, transport, REQUEST);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.category).toBe(expected);
    }
  });

  it('treats an unreadable response body as malformed-response', async () => {
    const transport = async () => ({ status: 200, json: async () => { throw new Error('bad json'); } });
    const result = await runGoogleRoutesComputeRoutes(READY_CONFIG, transport, REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('malformed-response');
  });

  it('never includes the API key in a parsed outcome', async () => {
    const transport = async () => fakeResponse({ routes: [] });
    const result = await runGoogleRoutesComputeRoutes(READY_CONFIG, transport, REQUEST);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('routes-secret-key');
  });
});

describe('STEP 47 status mapping helper', () => {
  it('returns a fixed message with the expected category for every status', () => {
    expect(
      googleRoutesTransportStatusToError(401, 'fallback').category
    ).toBe('authentication-required');
    expect(googleRoutesTransportStatusToError(400, 'fallback').category).toBe('provider-rejected');
    expect(googleRoutesTransportStatusToError(429, 'fallback').category).toBe('rate-limited');
    expect(googleRoutesTransportStatusToError(500, 'fallback').category).toBe('provider-unavailable');
    expect(googleRoutesTransportStatusToError(418, 'fallback').category).toBe('provider-rejected');
    expect(googleRoutesTransportStatusToError(418, 'fallback').message).toBe('fallback');
  });

  it('adapts a fetch-shaped implementation into the transport seam', () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = (async (url: unknown, init?: unknown) => {
      calls.push([String(url), (init ?? {}) as RequestInit]);
      return { status: 200, json: async () => ({ ok: true }) } as Response;
    }) as unknown as typeof fetch;
    const transport = createGoogleRoutesFetchTransport(fetchImpl);
    return transport({
      url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
      method: 'POST',
      headers: { 'x-goog-api-key': 'k' },
      body: '{}',
    }).then((response) => {
      expect(response.status).toBe(200);
      expect(calls[0][0]).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
      expect(calls[0][1].method).toBe('POST');
      expect(calls[0][1].body).toBe('{}');
    });
  });
});