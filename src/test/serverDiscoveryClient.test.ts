import { describe, expect, it, vi } from 'vitest';
import {
  discoverRealOptionsViaServer,
  isSafeServerDiscoveryEndpoint,
  loadServerDiscoveryClientOptionsFromEnv,
  SERVER_DISCOVERY_CLIENT_ENABLED_DEFAULT,
  SERVER_DISCOVERY_DEFAULT_ENDPOINT,
  type ServerDiscoveryClientFetch,
  type ServerDiscoveryClientFetchResponse,
} from '../services/serverDiscoveryClient';

const RAW_QUERY = {
  category: 'accommodation',
  destination: 'AMS',
  startDate: '2026-09-20',
  endDate: '2026-09-25',
  travelerCount: 2,
  currency: 'EUR',
  limit: 5,
};

const SUCCESS_BODY = {
  status: 'success',
  adaptersConsulted: [{ id: 'amadeus-self-service', name: 'Amadeus Self-Service' }],
  results: [{ resultId: 'H-1:O-1', providerId: 'amadeus-self-service' }],
  query: { category: 'accommodation', destination: 'AMS' },
  problem: null,
  error: null,
  providerOutcomes: [{ providerId: 'amadeus-self-service', providerName: 'Amadeus Self-Service' }],
};

function makeFetch(response: ServerDiscoveryClientFetchResponse): {
  fetchImpl: ServerDiscoveryClientFetch;
  calls: Array<[string, unknown]>;
} {
  const calls: Array<[string, unknown]> = [];
  const fetchImpl: ServerDiscoveryClientFetch = async (url, init) => {
    calls.push([url, init]);
    return response;
  };
  return { fetchImpl, calls };
}

function okResponse(body: unknown): ServerDiscoveryClientFetchResponse {
  return { status: 200, json: async () => body };
}

function enabledOptions(fetchImpl: ServerDiscoveryClientFetch) {
  return {
    endpoint: '/api/real-discovery',
    enabled: true,
    tokenProvider: async () => 'id-token-1',
    fetchImpl,
  };
}

describe('STEP 42 browser client is fail-closed and provider-neutral', () => {
  it('returns the not-configured outcome and never touches the network when disabled', async () => {
    const { fetchImpl, calls } = makeFetch(okResponse(SUCCESS_BODY));
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, {
      ...enabledOptions(fetchImpl),
      enabled: false,
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.error?.category).toBe('not-implemented');
    expect(calls).toHaveLength(0);
  });

  it('defaults to disabled unless explicit enablement is read from the env', () => {
    expect(SERVER_DISCOVERY_CLIENT_ENABLED_DEFAULT).toBe(false);
    expect(loadServerDiscoveryClientOptionsFromEnv({})).toEqual({
      enabled: false,
      endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT,
    });
  });

  it('reads the public capability flags without ever needing secrets', () => {
    expect(
      loadServerDiscoveryClientOptionsFromEnv({
        VITE_REAL_DISCOVERY_SERVER_ENABLED: 'true',
        VITE_REAL_DISCOVERY_SERVER_ENDPOINT: '/custom',
      })
    ).toEqual({ enabled: true, endpoint: '/custom' });
    expect(
      loadServerDiscoveryClientOptionsFromEnv({ VITE_REAL_DISCOVERY_SERVER_ENABLED: '1' })
    ).toEqual({
      enabled: true,
      endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT,
    });
  });

  it('honors the Vite-inlined flag keys and ignores unprefixed copies', () => {
    expect(
      loadServerDiscoveryClientOptionsFromEnv({
        VITE_REAL_DISCOVERY_SERVER_ENABLED: 'true',
        VITE_REAL_DISCOVERY_SERVER_ENDPOINT: '/api/from-vite',
      })
    ).toEqual({ enabled: true, endpoint: '/api/from-vite' });
    expect(
      loadServerDiscoveryClientOptionsFromEnv({
        REAL_DISCOVERY_SERVER_ENABLED: 'true',
        REAL_DISCOVERY_SERVER_ENDPOINT: '/api/from-plain-env',
      })
    ).toEqual({ enabled: false, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT });
  });

  it('maps a successful discovery response to the normalized outcome', async () => {
    const { fetchImpl } = makeFetch(okResponse(SUCCESS_BODY));
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('success');
    expect(outcome.results[0]?.resultId).toBe('H-1:O-1');
    expect(outcome.adaptersConsulted[0]?.id).toBe('amadeus-self-service');
  });

  it('sends exactly the normalized query with a bearer token and json content type', async () => {
    const { fetchImpl, calls } = makeFetch(okResponse(SUCCESS_BODY));
    await discoverRealOptionsViaServer(RAW_QUERY, {
      ...enabledOptions(fetchImpl),
      endpoint: '/api/real-discovery',
    });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe('/api/real-discovery');
    const request = init as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['authorization']).toBe('Bearer id-token-1');
    expect(request.body).toBe(JSON.stringify(RAW_QUERY));
    expect(request.body).not.toContain('secret');
  });

  it('never sends provider credentials in the request (the browser has none)', async () => {
    const { fetchImpl, calls } = makeFetch(okResponse(SUCCESS_BODY));
    await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    const body = JSON.stringify(calls[0][1]);
    for (const forbidden of ['clientId', 'clientSecret', 'amadeus', 'access_token']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('maps an authentication-required server response to a bounded outcome', async () => {
    const { fetchImpl } = makeFetch(
      okResponse({
        kind: 'server-discovery-auth-error',
        status: 'unauthenticated',
        message: 'You must be signed in to run real-provider discovery.',
      })
    );
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('authentication-required');
    expect(outcome.error?.message).toBe('You must be signed in to run real-provider discovery.');
  });

  it('maps a server invalid-input response to the normalized invalid-input outcome', async () => {
    const { fetchImpl } = makeFetch(
      okResponse({
        status: 'invalid-input',
        adaptersConsulted: [],
        results: [],
        query: null,
        problem: { code: 'missing-destination', message: 'A destination is required.' },
        error: null,
        providerOutcomes: [],
      })
    );
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.problem?.code).toBe('missing-destination');
  });

  it('maps a server provider-failure response without inventing a success', async () => {
    const { fetchImpl } = makeFetch(
      okResponse({
        status: 'provider-failure',
        adaptersConsulted: [],
        results: [],
        query: null,
        problem: null,
        error: { category: 'rate-limited', message: 'The provider rate-limited the request.' },
        providerOutcomes: [],
      })
    );
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('rate-limited');
  });

  it('maps a network throw to a bounded network-error outcome', async () => {
    const fetchImpl: ServerDiscoveryClientFetch = async () => {
      throw new Error('offline');
    };
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('network-error');
  });

  it('maps an unreadable response body to a bounded malformed-response outcome', async () => {
    const fetchImpl: ServerDiscoveryClientFetch = async () => ({
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
  });

  it('maps an unexpected response shape to a bounded malformed-response outcome', async () => {
    const { fetchImpl } = makeFetch(okResponse({ unexpected: true }));
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
  });

  it('maps a token-provider failure to a bounded authentication-required outcome', async () => {
    const tokenProvider = vi.fn(async () => {
      throw new Error('no user');
    });
    const { fetchImpl, calls } = makeFetch(okResponse(SUCCESS_BODY));
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, {
      ...enabledOptions(fetchImpl),
      tokenProvider,
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.error?.category).toBe('authentication-required');
    expect(calls).toHaveLength(0);
  });

  it('maps an invalid-token auth error to the same bounded authentication outcome', async () => {
    const { fetchImpl } = makeFetch(
      okResponse({
        kind: 'server-discovery-auth-error',
        status: 'invalid-token',
        message: 'The session token could not be verified. Please sign in again.',
      })
    );
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('authentication-required');
  });

  it('rejects non-object response bodies as malformed', async () => {
    for (const body of [[], null, 'text']) {
      const { fetchImpl } = makeFetch(okResponse(body));
      const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
      expect(outcome.status).toBe('provider-failure');
      expect(outcome.error?.category).toBe('malformed-response');
    }
  });

  it('defaults missing collection fields instead of trusting a partial body', async () => {
    const { fetchImpl } = makeFetch(
      okResponse({ status: 'empty', query: null, problem: null, error: null })
    );
    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, enabledOptions(fetchImpl));
    expect(outcome.status).toBe('empty');
    expect(outcome.adaptersConsulted).toEqual([]);
    expect(outcome.results).toEqual([]);
    expect(outcome.providerOutcomes).toEqual([]);
  });

  it('falls back to the default endpoint when the configured one is blank', () => {
    expect(
      loadServerDiscoveryClientOptionsFromEnv({
        VITE_REAL_DISCOVERY_SERVER_ENABLED: 'false',
        VITE_REAL_DISCOVERY_SERVER_ENDPOINT: '   ',
      })
    ).toEqual({ enabled: false, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT });
  });
});

describe('STEP 42 server-discovery endpoint is same-origin and fail-closed', () => {
  it('accepts the default and custom same-origin API paths', () => {
    expect(isSafeServerDiscoveryEndpoint(SERVER_DISCOVERY_DEFAULT_ENDPOINT)).toBe(true);
    expect(isSafeServerDiscoveryEndpoint('/api/real-discovery')).toBe(true);
    expect(isSafeServerDiscoveryEndpoint('/api/real-discovery/custom')).toBe(true);
    expect(isSafeServerDiscoveryEndpoint('/v1/real-discovery-2')).toBe(true);
  });

  it('rejects absolute HTTP(S) URLs and other scheme/authority values', () => {
    expect(isSafeServerDiscoveryEndpoint('https://example.com/api/real-discovery')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('http://example.com/api/real-discovery')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('//example.com/api/real-discovery')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('ftp://example.com/api')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('javascript:alert(1)')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('example.com/api')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/\\example.com/api')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api\\..\\admin')).toBe(false);
  });

  it('rejects traversal, empty segments, query, fragment, and malformed paths', () => {
    expect(isSafeServerDiscoveryEndpoint('/api/../admin')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/./api')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api//real-discovery')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/real-discovery/')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/%2e%2e/%2e%2e/admin')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/..%2fadmin')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/real-discovery?x=1')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/real-discovery#frag')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('api/real-discovery')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/')).toBe(false);
  });

  it('rejects empty, whitespace-only, and control-character values', () => {
    expect(isSafeServerDiscoveryEndpoint('')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('   ')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/\u0000real')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/\nreal')).toBe(false);
    expect(isSafeServerDiscoveryEndpoint('/api/real discovery')).toBe(false);
  });

  it('keeps the same-origin default for blank configuration without changing enablement', () => {
    expect(
      loadServerDiscoveryClientOptionsFromEnv({
        VITE_REAL_DISCOVERY_SERVER_ENABLED: 'true',
        VITE_REAL_DISCOVERY_SERVER_ENDPOINT: '   ',
      })
    ).toEqual({ enabled: true, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT });
    expect(loadServerDiscoveryClientOptionsFromEnv({})).toEqual({
      enabled: false,
      endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT,
    });
  });

  it('fails closed on an unsafe endpoint: capability off and safe default path', () => {
    for (const unsafe of [
      'https://example.com/api/real-discovery',
      'http://example.com/api/real-discovery',
      '//evil.example/api/real-discovery',
      '/\\evil.example/api',
      '/api/../admin',
      '/api/real-discovery?x=1',
    ]) {
      expect(
        loadServerDiscoveryClientOptionsFromEnv({
          VITE_REAL_DISCOVERY_SERVER_ENABLED: 'true',
          VITE_REAL_DISCOVERY_SERVER_ENDPOINT: unsafe,
        })
      ).toEqual({ enabled: false, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT });
    }
  });

  it('never sends a request (or the ID token) when the endpoint is unsafe', async () => {
    const { fetchImpl, calls } = makeFetch(okResponse(SUCCESS_BODY));
    const loaded = loadServerDiscoveryClientOptionsFromEnv({
      VITE_REAL_DISCOVERY_SERVER_ENABLED: 'true',
      VITE_REAL_DISCOVERY_SERVER_ENDPOINT: 'https://example.com/api/real-discovery',
    });
    const tokenProvider = vi.fn(async () => 'id-token-1');

    const outcome = await discoverRealOptionsViaServer(RAW_QUERY, {
      endpoint: loaded.endpoint,
      enabled: loaded.enabled,
      tokenProvider,
      fetchImpl,
    });

    expect(loaded.enabled).toBe(false);
    expect(outcome.status).toBe('not-configured');
    expect(calls).toHaveLength(0);
    expect(tokenProvider).not.toHaveBeenCalled();
  });
});
