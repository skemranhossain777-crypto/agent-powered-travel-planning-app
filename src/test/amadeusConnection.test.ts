import { describe, expect, it } from 'vitest';
import {
  AMADEUS_PRODUCTION_BASE_URL,
  AMADEUS_TEST_BASE_URL,
  buildAmadeusHotelSearchRequest,
  buildAmadeusTokenRequest,
  createAmadeusFetchTransport,
  getAmadeusBaseUrl,
  parseAmadeusHotelSearchResponse,
  parseAmadeusTokenResponse,
  runAmadeusHotelSearch,
  transportStatusToError,
  type AmadeusTransport,
  type AmadeusTransportRequest,
  type AmadeusTransportResponse,
} from '../services/realDiscovery/amadeusConnection';
import {
  normalizeRealDiscoveryConfig,
  type AmadeusDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';
import type { TripDiscoveryQuery } from '../domain/providers/discoveryInput';

const READY_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
  credentials: { clientId: 'client-1', clientSecret: 'secret-1' },
}) as AmadeusDiscoveryConfig;

const READY_PROD_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
  credentials: {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    environment: 'production',
  },
}) as AmadeusDiscoveryConfig;

const QUERY: TripDiscoveryQuery = {
  category: 'accommodation',
  destination: 'AMS',
  startDate: '2026-09-20',
  endDate: '2026-09-25',
  travelerCount: 2,
  currency: 'eur',
  limit: 5,
};

function response(status: number, body: unknown): AmadeusTransportResponse {
  return { status, json: async () => body };
}

function queueTransport(...responses: AmadeusTransportResponse[]): {
  transport: AmadeusTransport;
  requests: AmadeusTransportRequest[];
} {
  const requests: AmadeusTransportRequest[] = [];
  let index = 0;
  const transport: AmadeusTransport = async (request) => {
    requests.push(request);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return next;
  };
  return { transport, requests };
}

describe('STEP 41 base-url and token-request building', () => {
  it('resolves the test host by default and the production host only for production', () => {
    expect(getAmadeusBaseUrl(READY_CONFIG)).toBe(AMADEUS_TEST_BASE_URL);
    expect(getAmadeusBaseUrl(READY_PROD_CONFIG)).toBe(AMADEUS_PRODUCTION_BASE_URL);
  });

  it('returns null for the token request when credentials are missing', () => {
    const config: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
      attemptEnabled: false,
    }) as AmadeusDiscoveryConfig;
    expect(buildAmadeusTokenRequest(config)).toBeNull();
  });

  it('builds a POST x-www-form-urlencoded client-credentials request', () => {
    const request = buildAmadeusTokenRequest(READY_CONFIG);
    expect(request).not.toBeNull();
    expect(request?.url).toBe(`${AMADEUS_TEST_BASE_URL}/v1/security/oauth2/token`);
    expect(request?.method).toBe('POST');
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(request?.body).toContain('grant_type=client_credentials');
    expect(request?.body).toContain('client_id=client-1');
    expect(request?.body).toContain('client_secret=secret-1');
  });
});

describe('STEP 41 hotel-search request building', () => {
  it('maps only the supported query fields onto the read-only endpoint', () => {
    const request = buildAmadeusHotelSearchRequest(READY_CONFIG, 'ACCESS-TOKEN', QUERY);
    expect(request.method).toBe('GET');
    expect(request.headers['authorization']).toBe('Bearer ACCESS-TOKEN');
    expect(request.headers['accept']).toBe('application/json');
    const url = new URL(request.url);
    expect(url.origin).toBe(AMADEUS_TEST_BASE_URL);
    expect(url.pathname).toBe('/v3/shopping/hotel-offers');
    expect(url.searchParams.get('cityCode')).toBe('AMS');
    expect(url.searchParams.get('checkInDate')).toBe('2026-09-20');
    expect(url.searchParams.get('checkOutDate')).toBe('2026-09-25');
    expect(url.searchParams.get('adults')).toBe('2');
    expect(url.searchParams.get('currency')).toBe('eur');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('omits optional query params that were not supplied', () => {
    const request = buildAmadeusHotelSearchRequest(READY_CONFIG, 'T', {
      category: 'accommodation',
      destination: 'AMS',
    });
    const url = new URL(request.url);
    expect(url.searchParams.has('checkInDate')).toBe(false);
    expect(url.searchParams.has('checkOutDate')).toBe(false);
    expect(url.searchParams.has('adults')).toBe(false);
    expect(url.searchParams.has('currency')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
  });
});

describe('STEP 41 parsing token and search bodies', () => {
  it('accepts a readable access token and trims it', () => {
    expect(parseAmadeusTokenResponse({ access_token: ' tok ' })).toEqual({
      ok: true,
      accessToken: 'tok',
    });
  });

  it('rejects a token response without a usable token as malformed', () => {
    for (const body of [{}, { access_token: 42 }, { access_token: '' }, null, 'nope']) {
      const result = parseAmadeusTokenResponse(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.category).toBe('malformed-response');
    }
  });

  it('accepts a search body with an array data node', () => {
    expect(parseAmadeusHotelSearchResponse({ data: [] })).toEqual({
      ok: true,
      payload: { data: [] },
    });
  });

  it('rejects a search body without an array data node as malformed', () => {
    for (const body of [{}, { data: 'x' }, { data: {} }, null, 'nope']) {
      const result = parseAmadeusHotelSearchResponse(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.category).toBe('malformed-response');
    }
  });
});

describe('STEP 41 transport status to bounded safe error', () => {
  it('maps 401/403 to authentication-required', () => {
    expect(transportStatusToError(401, 'x').category).toBe('authentication-required');
    expect(transportStatusToError(403, 'x').category).toBe('authentication-required');
  });

  it('maps 400 and other client statuses to provider-rejected', () => {
    expect(transportStatusToError(400, 'fallback').category).toBe('provider-rejected');
    expect(transportStatusToError(418, 'fallback').category).toBe('provider-rejected');
  });

  it('maps 429 to rate-limited', () => {
    expect(transportStatusToError(429, 'x').category).toBe('rate-limited');
  });

  it('maps 404 and any 5xx to provider-unavailable', () => {
    expect(transportStatusToError(404, 'x').category).toBe('provider-unavailable');
    expect(transportStatusToError(500, 'x').category).toBe('provider-unavailable');
    expect(transportStatusToError(503, 'x').category).toBe('provider-unavailable');
  });
});

describe('STEP 41 createAmadeusFetchTransport', () => {
  it('adapts a fetch implementation into the transport seam', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    };
    const transport = createAmadeusFetchTransport(fakeFetch as unknown as typeof fetch);
    const result = await transport({
      url: 'https://example.test/x',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://example.test/x');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe('{"a":1}');
  });
});

describe('STEP 41 runAmadeusHotelSearch', () => {
  it('runs a token exchange then the search and returns the mapped payload', async () => {
    const { transport, requests } = queueTransport(
      response(200, { access_token: 'tok-1' }),
      response(200, { data: [] })
    );
    const result = await runAmadeusHotelSearch(READY_CONFIG, transport, QUERY);
    expect(result).toEqual({ ok: true, payload: { data: [] } });
    expect(requests).toHaveLength(2);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toContain('/v1/security/oauth2/token');
    expect(requests[1].method).toBe('GET');
    expect(requests[1].url).toContain('/v3/shopping/hotel-offers');
    expect(requests[1].headers['authorization']).toBe('Bearer tok-1');
  });

  it('reports credentials-missing before any transport call when unkeyed', async () => {
    const config: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
      attemptEnabled: true,
    }) as AmadeusDiscoveryConfig;
    const { transport, requests } = queueTransport(response(200, { data: [] }));
    const result = await runAmadeusHotelSearch(config, transport, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('credentials-missing');
    expect(requests).toHaveLength(0);
  });

  it('bounds a failed credential exchange to a safe status category', async () => {
    const { transport, requests } = queueTransport(
      response(401, { errors: [{ code: 999, title: 'bad' }] }),
      response(200, { data: [] })
    );
    const result = await runAmadeusHotelSearch(READY_CONFIG, transport, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('authentication-required');
    expect(requests).toHaveLength(1);
  });

  it('bounds a thrown transport to network-error without leaking the exception', async () => {
    const throwing: AmadeusTransport = async () => {
      throw new Error('socket exploded');
    };
    const result = await runAmadeusHotelSearch(READY_CONFIG, throwing, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('network-error');
      expect(result.error.message).not.toContain('socket exploded');
    }
  });

  it('bounds an unreadable token body to malformed-response', async () => {
    const badJson: AmadeusTransportResponse = {
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    };
    const result = await runAmadeusHotelSearch(
      READY_CONFIG,
      queueTransport(badJson).transport,
      QUERY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('malformed-response');
  });

  it('bounds a rate-limited search response', async () => {
    const { transport } = queueTransport(
      response(200, { access_token: 'tok' }),
      response(429, { errors: [{ code: 9999, title: 'slow down' }] })
    );
    const result = await runAmadeusHotelSearch(READY_CONFIG, transport, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('rate-limited');
  });

  it('bounds a search body without a data array to malformed-response', async () => {
    const { transport } = queueTransport(
      response(200, { access_token: 'tok' }),
      response(200, { error: 'nope' })
    );
    const result = await runAmadeusHotelSearch(READY_CONFIG, transport, QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('malformed-response');
  });
});
