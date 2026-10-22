import { describe, expect, it } from 'vitest';
import {
  runServerBoundaryDiscovery,
  type RunServerDiscoveryInput,
} from '../services/serverBoundary/serverDiscoveryRunner';
import {
  SERVER_DISCOVERY_HTTP_BAD_REQUEST,
  SERVER_DISCOVERY_HTTP_UNAUTHORIZED,
  type ServerDiscoveryHttpResult,
} from '../services/serverBoundary/serverDiscoveryContract';
import {
  AMADEUS_TEST_BASE_URL,
  type AmadeusTransport,
  type AmadeusTransportRequest,
} from '../services/realDiscovery/amadeusConnection';
import {
  normalizeRealDiscoveryConfig,
  type AmadeusDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';

const NOW = '2026-09-13T08:00:00.000Z';

const RAW_QUERY = {
  category: 'accommodation',
  destination: 'AMS',
  startDate: '2026-09-20',
  endDate: '2026-09-25',
  travelerCount: 2,
  currency: 'EUR',
  limit: 5,
};

const SECRET = 'super-secret-value';
const CLIENT_ID = 'client-id-value';

const READY_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
  credentials: { clientId: CLIENT_ID, clientSecret: SECRET },
}) as AmadeusDiscoveryConfig;

const PAYLOAD = {
  data: [
    {
      hotel: { hotelId: 'H-1', name: 'Hotel One', cityCode: 'AMS', available: true },
      offers: [
        {
          id: 'O-1',
          checkInDate: '2026-09-20',
          checkOutDate: '2026-09-22',
          price: { currency: 'EUR', total: 120 },
          description: { text: 'Room' },
        },
      ],
    },
  ],
};

function makeTransport(
  token: unknown,
  payload: unknown
): { transport: AmadeusTransport; requests: AmadeusTransportRequest[] } {
  const requests: AmadeusTransportRequest[] = [];
  let index = 0;
  const bodies = [token, payload];
  const transport: AmadeusTransport = async (request) => {
    requests.push(request);
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return { status: 200, json: async () => body };
  };
  return { transport, requests };
}

function run(overrides: Partial<RunServerDiscoveryInput>): Promise<ServerDiscoveryHttpResult> {
  return runServerBoundaryDiscovery({
    raw: RAW_QUERY,
    config: READY_CONFIG,
    now: NOW,
    principal: { uid: 'user-1' },
    ...overrides,
  });
}

describe('STEP 42 boundary never leaks credentials or raw provider data', () => {
  it('never serializes the client id, client secret, or access token into the response', async () => {
    const { transport } = makeTransport({ access_token: 'tok-supersecret' }, PAYLOAD);
    const result = await run({ transport });
    const serialized = JSON.stringify(result.body);
    for (const forbidden of [
      SECRET,
      CLIENT_ID,
      'tok-supersecret',
      'clientSecret',
      'access_token',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('never serializes secrets into a failure response either', async () => {
    const { transport } = makeTransport({ errors: [] }, {});
    const result = await run({ transport });
    const serialized = JSON.stringify(result.body);
    for (const forbidden of [SECRET, CLIENT_ID, 'clientSecret', 'Authorization']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('normalizes results so raw provider payload vocabulary never crosses the boundary', async () => {
    const { transport } = makeTransport({ access_token: 'tok-1' }, PAYLOAD);
    const result = await run({ transport });
    if (result.body.status !== 'success') throw new Error('expected success');
    const first = result.body.results[0];
    if (first === undefined) throw new Error('expected a result');
    expect(Object.keys(first)).not.toContain('hotel');
    expect(Object.keys(first)).not.toContain('offers');
    expect(Object.keys(first)).not.toContain('total');
    expect(JSON.stringify(first)).not.toContain('"offers"');
  });

  it('rejects any browser-supplied endpoint, url, method, header, path, or provider field', async () => {
    const injections: Array<Record<string, unknown>> = [
      { endpoint: 'https://evil.example.invalid' },
      { url: 'https://evil.example.invalid' },
      { method: 'DELETE' },
      { headers: { authorization: 'Bearer x' } },
      { path: '/v1/anything' },
      { provider: 'some-other-provider' },
      { token: 'browser-supplied-token' },
      { apiBaseUrl: 'https://evil.example.invalid' },
    ];
    for (const injection of injections) {
      let calls = 0;
      const transport: AmadeusTransport = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      const result = await run({ raw: { ...RAW_QUERY, ...injection }, transport });
      expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_REQUEST);
      expect(result.body).toMatchObject({
        status: 'invalid-input',
        problem: { code: 'unknown-key' },
      });
      expect(calls).toBe(0);
    }
  });

  it('can only ever reach the fixed Amadeus host, never a browser-selected URL', async () => {
    const { transport, requests } = makeTransport({ access_token: 'tok-1' }, PAYLOAD);
    await run({ transport });
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.url.startsWith(AMADEUS_TEST_BASE_URL)).toBe(true);
    }
  });

  it('cannot be used as a generic authenticated proxy (no arbitrary provider selection)', async () => {
    const { requests, transport } = makeTransport({ access_token: 'tok-1' }, PAYLOAD);
    await run({ transport });
    for (const request of requests) {
      expect(request.url).not.toContain('evil.example.invalid');
    }
  });

  it('does not treat the request body as an identity source', async () => {
    const { transport } = makeTransport({ access_token: 'tok-1' }, PAYLOAD);
    const result = await run({ raw: { ...RAW_QUERY, uid: 'attacker' }, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_REQUEST);
    expect(result.body).toMatchObject({
      status: 'invalid-input',
      problem: { code: 'unknown-key' },
    });
  });

  it('blocks an unauthenticated caller before any validation or provider access', async () => {
    let calls = 0;
    const transport: AmadeusTransport = async () => {
      calls += 1;
      return { status: 200, json: async () => ({}) };
    };
    const result = await run({ principal: null, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_UNAUTHORIZED);
    expect(calls).toBe(0);
  });

  it('caps the requested result limit server-side regardless of the body', async () => {
    let calls = 0;
    const transport: AmadeusTransport = async () => {
      calls += 1;
      return { status: 200, json: async () => ({}) };
    };
    const result = await run({ raw: { ...RAW_QUERY, limit: 5000 }, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_REQUEST);
    expect(calls).toBe(0);
  });
});
