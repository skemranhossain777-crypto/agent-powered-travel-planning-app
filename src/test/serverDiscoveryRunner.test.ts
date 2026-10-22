import { describe, expect, it } from 'vitest';
import {
  httpStatusForDiscoveryStatus,
  outcomeToServerDiscoveryResponse,
  runServerBoundaryDiscovery,
  SERVER_DISCOVERY_CREDENTIALS_MISSING_MESSAGE,
  SERVER_DISCOVERY_DISABLED_MESSAGE,
  SERVER_DISCOVERY_NO_TRANSPORT_MESSAGE,
  type RunServerDiscoveryInput,
} from '../services/serverBoundary/serverDiscoveryRunner';
import {
  SERVER_DISCOVERY_HTTP_BAD_GATEWAY,
  SERVER_DISCOVERY_HTTP_BAD_REQUEST,
  SERVER_DISCOVERY_HTTP_INTERNAL_SERVER_ERROR,
  SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED,
  SERVER_DISCOVERY_HTTP_OK,
  SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE,
  SERVER_DISCOVERY_HTTP_UNAUTHORIZED,
  SERVER_DISCOVERY_INVALID_TOKEN_MESSAGE,
  type ServerDiscoveryHttpResult,
} from '../services/serverBoundary/serverDiscoveryContract';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
  normalizeRealDiscoveryConfig,
  type AmadeusDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';
import type { AmadeusTransport } from '../services/realDiscovery/amadeusConnection';
import { mapDiscoveryResultToExternalProviderHandoffPlan } from '../domain/discovery/handoff';

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

const DISABLED_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: false,
}) as AmadeusDiscoveryConfig;

const CREDENTIALS_MISSING_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
}) as AmadeusDiscoveryConfig;

const READY_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
  credentials: { clientId: 'client', clientSecret: 'secret' },
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

const PRINCIPAL = { uid: 'user-1' };

function makeTransport(statuses: Array<[number, unknown]>): {
  transport: AmadeusTransport;
  callCount: () => number;
} {
  let index = 0;
  let calls = 0;
  const transport: AmadeusTransport = async () => {
    calls += 1;
    const [status, body] = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return { status, json: async () => body };
  };
  return { transport, callCount: () => calls };
}

function run(overrides: Partial<RunServerDiscoveryInput>): Promise<ServerDiscoveryHttpResult> {
  return runServerBoundaryDiscovery({
    raw: RAW_QUERY,
    config: READY_CONFIG,
    now: NOW,
    principal: PRINCIPAL,
    ...overrides,
  });
}

describe('STEP 42 server boundary runs authenticated read-only discovery', () => {
  it('returns HTTP 200 with normalized results for an authenticated valid request', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(result.body.status).toBe('success');
    if (result.body.status !== 'success') return;
    expect(result.body.results.length).toBeGreaterThan(0);
    expect(result.body.adaptersConsulted[0]?.id).toBe(AMADEUS_PROVIDER_ID);
    expect(result.body.adaptersConsulted[0]?.name).toBe(AMADEUS_PROVIDER_NAME);
  });

  it('returns HTTP 200 empty (not an error) when the provider reports no availability', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, { data: [] }],
    ]);
    const result = await run({ transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(result.body.status).toBe('empty');
    if (result.body.status !== 'empty') return;
    expect(result.body.results).toEqual([]);
  });

  it('maps a provider authentication failure to HTTP 502 (never a misleading 200)', async () => {
    const { transport } = makeTransport([[401, { errors: [] }]]);
    const result = await run({ transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_GATEWAY);
    expect(result.body).toMatchObject({
      status: 'provider-failure',
      error: { category: 'authentication-required' },
    });
  });

  it('maps an unreadable provider payload to HTTP 502', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, { not: 'a search payload' }],
    ]);
    const result = await run({ transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_GATEWAY);
    expect(result.body).toMatchObject({
      status: 'provider-failure',
      error: { category: 'malformed-response' },
    });
  });

  it('returns HTTP 503 with credentials-missing when enabled but unkeyed (no provider touch)', async () => {
    const { transport, callCount } = makeTransport([[200, { access_token: 'tok-1' }]]);
    const result = await run({ config: CREDENTIALS_MISSING_CONFIG, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE);
    expect(result.body).toMatchObject({
      status: 'not-configured',
      error: {
        category: 'credentials-missing',
        message: SERVER_DISCOVERY_CREDENTIALS_MISSING_MESSAGE,
      },
    });
    expect(callCount()).toBe(0);
  });

  it('returns HTTP 501 when the attempt switch is off (no provider touch)', async () => {
    const { transport, callCount } = makeTransport([[200, { access_token: 'tok-1' }]]);
    const result = await run({ config: DISABLED_CONFIG, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED);
    expect(result.body).toMatchObject({
      status: 'not-configured',
      error: { category: 'not-implemented', message: SERVER_DISCOVERY_DISABLED_MESSAGE },
    });
    expect(callCount()).toBe(0);
  });

  it('returns HTTP 401 when the request is unauthenticated (before validation or provider)', async () => {
    const { transport, callCount } = makeTransport([[200, { access_token: 'tok-1' }]]);
    const result = await run({ principal: null, transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_UNAUTHORIZED);
    expect(result.body).toMatchObject({
      kind: 'server-discovery-auth-error',
      status: 'unauthenticated',
    });
    expect(callCount()).toBe(0);
  });

  it('returns HTTP 400 with a bounded problem for invalid input (no provider touch)', async () => {
    const { transport, callCount } = makeTransport([[200, { access_token: 'tok-1' }]]);
    const result = await run({
      raw: { category: 'accommodation', destination: '' },
      transport,
    });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_REQUEST);
    expect(result.body).toMatchObject({
      status: 'invalid-input',
      problem: { code: 'missing-destination' },
    });
    expect(callCount()).toBe(0);
  });

  it('attributes the normalized result to the real provider that produced it', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    if (result.body.status !== 'success') throw new Error('expected success');
    expect(result.body.providerOutcomes[0]).toMatchObject({
      providerId: AMADEUS_PROVIDER_ID,
      providerName: AMADEUS_PROVIDER_NAME,
    });
    expect(result.body.results[0]?.providerId).toBe(AMADEUS_PROVIDER_ID);
  });

  it('preserves the deterministic provider result identity end to end', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    if (result.body.status !== 'success') throw new Error('expected success');
    expect(result.body.results[0]?.resultId).toBe('H-1:O-1');
  });

  it('hands off with external-provider provenance and still never auto-assigns a primary', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    if (result.body.status !== 'success') throw new Error('expected success');
    const first = result.body.results[0];
    if (first === undefined) throw new Error('expected a result');
    const handoff = mapDiscoveryResultToExternalProviderHandoffPlan(first, NOW, 'handoff-H-1:O-1');
    expect(handoff).not.toBeNull();
    if (handoff === null) return;
    expect(handoff.plan.provenance?.kind).toBe('external-provider');
    expect(handoff.plan.readiness?.state).toBe('planned');
    expect('primaryAccommodationPlanId' in handoff.plan).toBe(false);
    expect('primaryTransportPlanId' in handoff.plan).toBe(false);
    expect(handoff.plan.notes).toContain('Not a booking or reservation');
  });

  it('consults only the real Amadeus adapter — the mock path is untouched', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    if (result.body.status !== 'success') throw new Error('expected success');
    expect(result.body.adaptersConsulted).toHaveLength(1);
    expect(result.body.adaptersConsulted[0]?.id).toBe(AMADEUS_PROVIDER_ID);
  });

  it('persists nothing and returns a pure, serializable, secret-free body', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [200, PAYLOAD],
    ]);
    const result = await run({ transport });
    expect(() => JSON.stringify(result.body)).not.toThrow();
    const serialized = JSON.stringify(result.body);
    for (const forbidden of ['secret', 'clientId', 'clientSecret', 'access_token', 'tok-1']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('STEP 42 server boundary maps every HTTP status without ambiguity', () => {
  const cases: Array<[string, number, Partial<RunServerDiscoveryInput>]> = [
    ['invalid input', SERVER_DISCOVERY_HTTP_BAD_REQUEST, { raw: { category: 'accommodation' } }],
    ['unauthenticated', SERVER_DISCOVERY_HTTP_UNAUTHORIZED, { principal: null }],
    ['disabled', SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED, { config: DISABLED_CONFIG }],
    [
      'credentials missing',
      SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE,
      { config: CREDENTIALS_MISSING_CONFIG },
    ],
  ];

  for (const [label, status, overrides] of cases) {
    it(`never returns HTTP 200 for ${label}`, async () => {
      const { transport } = makeTransport([[200, { access_token: 'tok-1' }]]);
      const result = await run({ ...overrides, transport });
      expect(result.httpStatus).toBe(status);
      expect(result.httpStatus).not.toBe(SERVER_DISCOVERY_HTTP_OK);
    });
  }

  it('maps rate limiting to a bounded 502 failure', async () => {
    const { transport } = makeTransport([
      [200, { access_token: 'tok-1' }],
      [429, {}],
    ]);
    const result = await run({ transport });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_GATEWAY);
    expect(result.body).toMatchObject({
      status: 'provider-failure',
      error: { category: 'rate-limited' },
    });
  });

  it('maps a thrown transport error to a bounded 502 network failure', async () => {
    const result = await run({
      transport: async () => {
        throw new Error('socket hang up');
      },
    });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_GATEWAY);
    expect(result.body).toMatchObject({
      status: 'provider-failure',
      error: { category: 'network-error' },
    });
  });
});

describe('STEP 42 server boundary covers every bounded rejection path', () => {
  it('returns HTTP 401 with invalid-token when the host reports a failed token check', async () => {
    const result = await run({ principal: null, authProblem: 'invalid-token' });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_UNAUTHORIZED);
    expect(result.body).toMatchObject({
      kind: 'server-discovery-auth-error',
      status: 'invalid-token',
      message: SERVER_DISCOVERY_INVALID_TOKEN_MESSAGE,
    });
  });

  it('returns HTTP 502 with a bounded not-implemented error when no transport is wired', async () => {
    const result = await run({ transport: undefined });
    expect(result.httpStatus).toBe(SERVER_DISCOVERY_HTTP_BAD_GATEWAY);
    expect(result.body).toMatchObject({
      status: 'provider-failure',
      error: { category: 'not-implemented', message: SERVER_DISCOVERY_NO_TRANSPORT_MESSAGE },
    });
  });

  it('maps every discovery status to an explicit HTTP status', () => {
    expect(httpStatusForDiscoveryStatus('success', null)).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(httpStatusForDiscoveryStatus('partial', null)).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(httpStatusForDiscoveryStatus('empty', null)).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(httpStatusForDiscoveryStatus('unsupported', null)).toBe(SERVER_DISCOVERY_HTTP_OK);
    expect(httpStatusForDiscoveryStatus('invalid-input', null)).toBe(
      SERVER_DISCOVERY_HTTP_BAD_REQUEST
    );
    expect(httpStatusForDiscoveryStatus('not-configured', null)).toBe(
      SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED
    );
    expect(
      httpStatusForDiscoveryStatus('not-configured', {
        category: 'credentials-missing',
        message: 'missing',
      })
    ).toBe(SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE);
    expect(httpStatusForDiscoveryStatus('provider-failure', null)).toBe(
      SERVER_DISCOVERY_HTTP_BAD_GATEWAY
    );
    expect(httpStatusForDiscoveryStatus('unexpected-failure', null)).toBe(
      SERVER_DISCOVERY_HTTP_INTERNAL_SERVER_ERROR
    );
  });

  it('projects a normalized outcome field-by-field without adding hidden fields', () => {
    const outcome = {
      status: 'partial' as const,
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: null,
      providerOutcomes: [],
    };
    const body = outcomeToServerDiscoveryResponse(outcome);
    expect(Object.keys(body)).toEqual([
      'status',
      'adaptersConsulted',
      'results',
      'query',
      'problem',
      'error',
      'providerOutcomes',
    ]);
    expect(body.status).toBe('partial');
  });
});
