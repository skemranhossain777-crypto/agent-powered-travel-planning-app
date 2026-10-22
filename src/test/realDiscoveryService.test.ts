import { describe, expect, it } from 'vitest';
import {
  discoverRealOptions,
  outcomeFromAggregate,
  REAL_DISCOVERY_ACCOMMODATION_CAPABILITY,
  runRealDiscoveryWithAdapter,
  runRealDiscoveryWithPayload,
  type RealDiscoveryOutcome,
} from '../services/realDiscovery/realDiscoveryService';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
  normalizeRealDiscoveryConfig,
  type AmadeusDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';
import { createAmadeusDiscoveryAdapter } from '../services/realDiscovery/amadeusAdapter';
import type {
  ProviderDiscoveryAggregate,
  ProviderDiscoveryStage,
} from '../domain/providers/discoveryOrchestration';
import {
  normalizeTripDiscoveryQuery,
  type TripDiscoveryQuery,
} from '../domain/providers/discoveryInput';

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

const QUERY = normalizeTripDiscoveryQuery(RAW_QUERY) as TripDiscoveryQuery;

const DISABLED_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: false,
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
        {
          id: 'O-2',
          checkInDate: '2026-09-20',
          checkOutDate: '2026-09-22',
          price: { currency: 'EUR', total: 190 },
          description: { text: 'Suite' },
        },
      ],
    },
  ],
};

async function runWithTransportStatuses(
  statuses: Array<[number, unknown]>
): Promise<RealDiscoveryOutcome> {
  let index = 0;
  const transport = async () => {
    const [status, body] = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return { status, json: async () => body };
  };
  return discoverRealOptions(RAW_QUERY, READY_CONFIG, NOW, { transport });
}

describe('STEP 41 discoverRealOptions is fail-closed by default', () => {
  it('returns not-configured without touching a transport when the switch is off', async () => {
    let touches = 0;
    const outcome = await discoverRealOptions(RAW_QUERY, DISABLED_CONFIG, NOW, {
      transport: async () => {
        touches += 1;
        return { status: 200, json: async () => ({ data: [] }) };
      },
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.query).toBeNull();
    expect(outcome.results).toEqual([]);
    expect(outcome.adaptersConsulted).toEqual([]);
    expect(outcome.providerOutcomes).toEqual([]);
    expect(outcome.error?.category).toBe('not-implemented');
    expect(touches).toBe(0);
  });

  it('returns not-configured with credentials-missing when enabled but unkeyed', async () => {
    const unkeyed: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
      attemptEnabled: true,
    }) as AmadeusDiscoveryConfig;
    const outcome = await discoverRealOptions(RAW_QUERY, unkeyed, NOW);
    expect(outcome.status).toBe('not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
  });
});

describe('STEP 41 discoverRealOptions rejects invalid input before any network', () => {
  it('returns invalid-input with the query problem', async () => {
    const outcome = await discoverRealOptions(
      { category: 'accommodation', destination: '', limit: 999 },
      READY_CONFIG,
      NOW,
      { transport: async () => ({ status: 200, json: async () => ({ data: [] }) }) }
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.problem).not.toBeNull();
    expect(outcome.error).toBeNull();
  });
});

describe('STEP 41 discoverRealOptions ready-but-unwired', () => {
  it('reports provider-failure (not-implemented) when no transport is configured', async () => {
    const outcome = await discoverRealOptions(RAW_QUERY, READY_CONFIG, NOW);
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.query).toEqual(QUERY);
    expect(outcome.error?.category).toBe('not-implemented');
  });
});

describe('STEP 41 discoverRealOptions full success path', () => {
  it('composes the real search through the unchanged orchestrator', async () => {
    const outcome = await runWithTransportStatuses([
      [200, { access_token: 'tok' }],
      [200, PAYLOAD],
    ]);
    expect(outcome.status).toBe('success');
    expect(outcome.query).toEqual(QUERY);
    expect(outcome.error).toBeNull();
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0].providerId).toBe(AMADEUS_PROVIDER_ID);
    expect(outcome.providerOutcomes).toEqual([
      {
        providerId: AMADEUS_PROVIDER_ID,
        providerName: AMADEUS_PROVIDER_NAME,
        status: 'success',
        resultCount: 2,
        error: null,
      },
    ]);
    expect(outcome.adaptersConsulted).toHaveLength(1);
    expect(outcome.adaptersConsulted[0].id).toBe(AMADEUS_PROVIDER_ID);
    expect(outcome.adaptersConsulted[0].capabilities[0].capability).toBe(
      REAL_DISCOVERY_ACCOMMODATION_CAPABILITY
    );
  });

  it('honors a result limit while mapping', async () => {
    const outcome = await runWithTransportStatuses([
      [200, { access_token: 'tok' }],
      [200, PAYLOAD],
    ]);
    expect(outcome.status).toBe('success');
    expect(outcome.results.length).toBeLessThanOrEqual(5);
  });
});

describe('STEP 41 discoverRealOptions failure and empty resolution', () => {
  it('resolves a rate-limited provider response to provider-failure with its category', async () => {
    const outcome = await runWithTransportStatuses([
      [200, { access_token: 'tok' }],
      [429, { errors: [{ code: 9999, title: 'slow down' }] }],
    ]);
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('rate-limited');
    expect(outcome.results).toEqual([]);
  });

  it('resolves an empty data array to the empty outcome', async () => {
    const outcome = await runWithTransportStatuses([
      [200, { access_token: 'tok' }],
      [200, { data: [] }],
    ]);
    expect(outcome.status).toBe('empty');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeNull();
  });

  it('never leaks a transport exception into the outcome', async () => {
    const outcome = await discoverRealOptions(RAW_QUERY, READY_CONFIG, NOW, {
      transport: async () => {
        throw new Error('keep this secret');
      },
    });
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('network-error');
    expect(JSON.stringify(outcome)).not.toContain('keep this secret');
  });
});

describe('STEP 41 runRealDiscoveryWithPayload is the deterministic offline path', () => {
  it('maps a payload through the adapter and orchestrator deterministically', () => {
    const first = runRealDiscoveryWithPayload(RAW_QUERY, READY_CONFIG, PAYLOAD, NOW);
    const second = runRealDiscoveryWithPayload(RAW_QUERY, READY_CONFIG, PAYLOAD, NOW);
    expect(first.status).toBe('success');
    expect(first).toEqual(second);
    expect(first.results).toHaveLength(2);
  });

  it('rejects invalid input without consulting an adapter', () => {
    const outcome = runRealDiscoveryWithPayload(
      { category: 'accommodation', destination: '  ' },
      READY_CONFIG,
      PAYLOAD,
      NOW
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.problem?.code).toBe('missing-destination');
  });
});

describe('STEP 41 runRealDiscoveryWithAdapter and the unsupported path', () => {
  it('reports unsupported when the ready adapter does not support the queried category', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG, () => PAYLOAD);
    const transportQuery: TripDiscoveryQuery = {
      category: 'transport',
      destination: 'AMS',
    };
    const outcome = runRealDiscoveryWithAdapter(transportQuery, adapter, NOW);
    expect(outcome.status).toBe('unsupported');
    expect(outcome.providerOutcomes[0].status).toBe('unsupported');
  });
});

describe('STEP 41 outcomeFromAggregate defensive contract', () => {
  function aggregateWith(
    status: ProviderDiscoveryAggregate['status'],
    stages: ProviderDiscoveryStage[]
  ): ProviderDiscoveryAggregate {
    return { status, query: QUERY, results: [], stages, totalResults: 0 };
  }

  it('passes a failed stage error through as provider-failure', () => {
    const stage: ProviderDiscoveryStage = {
      providerId: AMADEUS_PROVIDER_ID,
      providerName: AMADEUS_PROVIDER_NAME,
      status: 'rate-limited',
      resultCount: 0,
      error: { category: 'rate-limited', message: 'slow down' },
    };
    const aggregate = aggregateWith('failed', [stage]);
    const outcome = outcomeFromAggregate(aggregate);
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('rate-limited');
    expect(outcome.providerOutcomes[0].status).toBe('rate-limited');
  });

  it('reports unexpected-failure for an impossible aggregate status', () => {
    const bogus = {
      status: 'impossible-status',
      query: QUERY,
      results: [],
      stages: [],
      totalResults: 0,
    } as unknown as ProviderDiscoveryAggregate;
    const outcome = outcomeFromAggregate(bogus);
    expect(outcome.status).toBe('unexpected-failure');
    expect(outcome.error?.category).toBe('unknown');
  });

  it('reports unsupported backing for no-adapters aggregates', () => {
    const outcome = outcomeFromAggregate(aggregateWith('no-adapters', []));
    expect(outcome.status).toBe('unsupported');
    expect(outcome.results).toEqual([]);
  });
});
