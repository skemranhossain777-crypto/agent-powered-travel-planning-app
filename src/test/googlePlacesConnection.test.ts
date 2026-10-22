import { describe, expect, it } from 'vitest';
import {
  GOOGLE_PLACES_BASE_URL,
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_NEARBY_SEARCH_PATH,
  GOOGLE_PLACES_RANK_PREFERENCE,
  buildGooglePlacesNearbySearchRequest,
  createGooglePlacesFetchTransport,
  googlePlacesTransportStatusToError,
  parseGooglePlacesNearbyResponse,
  runGooglePlacesNearbySearch,
  type GooglePlacesTransportRequest,
} from '../services/googleDiscovery/googlePlacesConnection';
import { GOOGLE_PLACES_PROVIDER_NAME } from '../services/googleDiscovery/googlePlacesConfig';

const QUERY = {
  latitude: 52.3676,
  longitude: 4.9041,
  radiusMeters: 5000,
  category: 'museums' as const,
  resultLimit: 5,
};

const READY_CONFIG = {
  attemptEnabled: true,
  credentials: { apiKey: 'secret-key' },
};

function fakeResponse(payload: unknown, status = 200) {
  return { status, json: async () => payload };
}

describe('STEP 44 Google Places connection contract', () => {
  it('uses the fixed Nearby Search host, path, method, ranking, and field mask', () => {
    expect(GOOGLE_PLACES_BASE_URL).toBe('https://places.googleapis.com');
    expect(GOOGLE_PLACES_NEARBY_SEARCH_PATH).toBe('/v1/places:searchNearby');
    expect(GOOGLE_PLACES_RANK_PREFERENCE).toBe('POPULARITY');
    expect(GOOGLE_PLACES_FIELD_MASK).toBe(
      'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.rating,places.userRatingCount,places.googleMapsUri'
    );
  });

  it('builds a POST request with the key in the header and the approved body only', () => {
    const request = buildGooglePlacesNearbySearchRequest(READY_CONFIG, QUERY);
    expect(request).not.toBeNull();
    expect(request?.url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(request?.method).toBe('POST');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['x-goog-api-key']).toBe('secret-key');
    expect(request?.headers['x-goog-fieldmask']).toBe(GOOGLE_PLACES_FIELD_MASK);
    const body = JSON.parse(request?.body as string);
    expect(body).toEqual({
      includedTypes: ['museum', 'art_gallery'],
      maxResultCount: 5,
      rankPreference: 'POPULARITY',
      locationRestriction: {
        circle: { center: { latitude: 52.3676, longitude: 4.9041 }, radius: 5000 },
      },
    });
  });

  it('returns null when credentials are missing (bounded credentials-missing gate)', () => {
    expect(
      buildGooglePlacesNearbySearchRequest({ attemptEnabled: true, credentials: null }, QUERY)
    ).toBeNull();
    expect(
      buildGooglePlacesNearbySearchRequest(
        { attemptEnabled: false, credentials: null },
        QUERY
      )
    ).toBeNull();
  });

  it('never includes the API key in a parsed response', () => {
    const parsed = parseGooglePlacesNearbyResponse({ ok: true });
    expect(parsed.ok).toBe(true);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('secret-key');
  });
});

describe('STEP 44 running a Nearby Search through the transport seam', () => {
  it('runs one read-only POST and returns the payload on a 200', async () => {
    const requests: GooglePlacesTransportRequest[] = [];
    const transport = async (request: GooglePlacesTransportRequest) => {
      requests.push(request);
      return fakeResponse({ places: [] });
    };
    const result = await runGooglePlacesNearbySearch(READY_CONFIG, transport, QUERY);
    expect(result).toEqual({ ok: true, payload: { places: [] } });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://places.googleapis.com/v1/places:searchNearby');
  });

  it('maps a missing-key config to a bounded credentials-missing error', async () => {
    const transport = async () => fakeResponse({});
    const result = await runGooglePlacesNearbySearch(
      { attemptEnabled: true, credentials: null },
      transport,
      QUERY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('credentials-missing');
  });

  it('captures network failures as bounded network-error without raw details', async () => {
    const transport = async () => {
      throw new Error('ECONNREFUSED secret');
    };
    const result = await runGooglePlacesNearbySearch(READY_CONFIG, transport, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('network-error');
      expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  it('maps HTTP statuses to the documented safe categories', async () => {
    const cases: Array<[number, string]> = [
      [401, 'authentication-required'],
      [403, 'authentication-required'],
      [400, 'provider-rejected'],
      [429, 'rate-limited'],
      [404, 'provider-unavailable'],
      [503, 'provider-unavailable'],
    ];
    for (const [status, expectedCategory] of cases) {
      const transport = async () => fakeResponse({}, status);
      const result = await runGooglePlacesNearbySearch(READY_CONFIG, transport, QUERY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.category).toBe(expectedCategory);
        expect(JSON.stringify(result)).not.toContain('secret-key');
      }
    }
  });

  it('parses only object bodies; unreadable JSON becomes malformed-response', async () => {
    const transport = async () => ({ status: 200, json: async () => 'not-an-object' });
    const badBody = await runGooglePlacesNearbySearch(READY_CONFIG, transport, QUERY);
    expect(badBody.ok).toBe(false);
    if (!badBody.ok) expect(badBody.error.category).toBe('malformed-response');

    const throwingTransport = async () => ({
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const unreadable = await runGooglePlacesNearbySearch(READY_CONFIG, throwingTransport, QUERY);
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(unreadable.error.category).toBe('malformed-response');
  });
});

describe('STEP 44 transport status mapping', () => {
  it('returns stable, bounded safe errors for every gateway status', () => {
    expect(googlePlacesTransportStatusToError(401, 'f').category).toBe('authentication-required');
    expect(googlePlacesTransportStatusToError(403, 'f').category).toBe('authentication-required');
    expect(googlePlacesTransportStatusToError(400, 'f').category).toBe('provider-rejected');
    expect(googlePlacesTransportStatusToError(429, 'f').category).toBe('rate-limited');
    expect(googlePlacesTransportStatusToError(404, 'f').category).toBe('provider-unavailable');
    expect(googlePlacesTransportStatusToError(500, 'f').category).toBe('provider-unavailable');
    expect(googlePlacesTransportStatusToError(422, 'f').category).toBe('provider-rejected');
  });
});

describe('STEP 44 fetch transport adapter', () => {
  it('adapts a fetch implementation into the transport seam', async () => {
    const fetchImpl: typeof fetch = async () =>
      ({ status: 200, json: async () => ({ places: [] }) }) as Response;
    const transport = createGooglePlacesFetchTransport(fetchImpl);
    const result = await transport({
      url: 'https://places.googleapis.com/v1/places:searchNearby',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ places: [] });
  });
});

describe('STEP 44 connection considerations', () => {
  it('the module has no global fetch call or provider-name import in its code surface', async () => {
    const fsModule: typeof import('node:fs') = await import('node:fs');
    const path = 'src/services/googleDiscovery/googlePlacesConnection.ts';
    const raw = fsModule.readFileSync(path, 'utf8');
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(source).not.toMatch(/(^|[^A-Za-z_$])fetch\(/);
    expect(source).not.toContain('GOOGLE_PLACES_PROVIDER_NAME');
  });

  it('keeps the provider name stable off the connection module surface', () => {
    expect(GOOGLE_PLACES_PROVIDER_NAME).toBe('Google Places');
  });
});