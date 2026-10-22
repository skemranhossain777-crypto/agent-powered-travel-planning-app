import { describe, expect, it } from 'vitest';
import {
  AMADEUS_PAYLOAD_SOURCE_ERROR_MESSAGE,
  createAmadeusDiscoveryAdapter,
  type AmadeusPayloadProvider,
} from '../services/realDiscovery/amadeusAdapter';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
  normalizeRealDiscoveryConfig,
  type AmadeusDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';
import { AMADEUS_RESULT_DISCLAIMER } from '../services/realDiscovery/amadeusMapping';
import type { TripDiscoveryQuery } from '../domain/providers/discoveryInput';

const NOW = '2026-09-13T08:00:00.000Z';

const DISABLED_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: false,
}) as AmadeusDiscoveryConfig;

const READY_CONFIG: AmadeusDiscoveryConfig = normalizeRealDiscoveryConfig({
  attemptEnabled: true,
  credentials: { clientId: 'client', clientSecret: 'secret' },
}) as AmadeusDiscoveryConfig;

const QUERY: TripDiscoveryQuery = {
  category: 'accommodation',
  destination: 'AMS',
  startDate: '2026-09-20',
  endDate: '2026-09-25',
  travelerCount: 2,
  currency: 'EUR',
  limit: 5,
};

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

function payloadProvider(fixture: unknown): AmadeusPayloadProvider {
  return () => fixture;
}

describe('STEP 41 the Amadeus adapter profile', () => {
  it('declares the accommodation search as unavailable until the gate is ready', () => {
    const adapter = createAmadeusDiscoveryAdapter(DISABLED_CONFIG);
    const search = adapter.profile.capabilities.find(
      (c) => c.capability === 'search-accommodation'
    );
    expect(search?.status).toBe('unavailable-missing-credentials');
    expect(adapter.isOperational('search-accommodation')).toBe(false);
    expect(adapter.isOperational('search-transport')).toBe(false);
  });

  it('declares every other capability as unsupported and never invents transport', () => {
    for (const config of [DISABLED_CONFIG, READY_CONFIG]) {
      const adapter = createAmadeusDiscoveryAdapter(config);
      for (const capability of adapter.profile.capabilities) {
        if (capability.capability === 'search-accommodation') continue;
        expect(capability.status).toBe('unsupported');
      }
      expect(adapter.id()).toBe(AMADEUS_PROVIDER_ID);
      expect(adapter.name()).toBe(AMADEUS_PROVIDER_NAME);
      expect(adapter.isOperational('search-transport')).toBe(false);
    }
  });

  it('becomes operational exactly when the config gate is ready', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG);
    const search = adapter.profile.capabilities.find(
      (c) => c.capability === 'search-accommodation'
    );
    expect(search?.status).toBe('available');
    expect(adapter.isOperational('search-accommodation')).toBe(true);
  });
});

describe('STEP 41 adapter search-before-ready behavior', () => {
  it('fails closed with credentials-missing for a disabled config', () => {
    const adapter = createAmadeusDiscoveryAdapter(DISABLED_CONFIG);
    const envelope = adapter.search(QUERY, NOW);
    expect(envelope).not.toBeNull();
    expect(envelope?.operation).toBe('search');
    expect(envelope?.status).toBe('failure');
    expect(envelope?.error?.category).toBe('credentials-missing');
    expect(envelope?.providerId).toBe(AMADEUS_PROVIDER_ID);
    expect(envelope?.providerName).toBe(AMADEUS_PROVIDER_NAME);
    expect(envelope?.error?.message).toContain('not configured');
    expect(envelope?.limitations).toEqual([AMADEUS_RESULT_DISCLAIMER]);
  });
});

describe('STEP 41 ready adapter success path', () => {
  it('maps the injected payload into a normalized success envelope', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG, payloadProvider(PAYLOAD));
    const envelope = adapter.search(QUERY, NOW);
    expect(envelope?.status).toBe('success');
    expect(envelope?.operation).toBe('search');
    expect(envelope?.providerId).toBe(AMADEUS_PROVIDER_ID);
    expect(envelope?.providerName).toBe(AMADEUS_PROVIDER_NAME);
    expect(envelope?.performedAt).toBe(NOW);
    expect(envelope?.data).toHaveLength(2);
    expect(envelope?.data?.[0].resultId).toBe('H-1:O-1');
    expect(envelope?.limitations).toEqual([AMADEUS_RESULT_DISCLAIMER]);
  });

  it('honors the query limit as an upper bound on returned results', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG, payloadProvider(PAYLOAD));
    const quickQuery: TripDiscoveryQuery = { ...QUERY, limit: 1 };
    const envelope = adapter.search(quickQuery, NOW);
    expect(envelope?.status).toBe('success');
    expect(envelope?.data).toHaveLength(1);
  });

  it('reports provider-unavailable when no payload source exists', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG);
    const envelope = adapter.search(QUERY, NOW);
    expect(envelope?.status).toBe('failure');
    expect(envelope?.error?.category).toBe('provider-unavailable');
    expect(envelope?.error?.message).toBe(AMADEUS_PAYLOAD_SOURCE_ERROR_MESSAGE);
  });

  it('reports provider-unavailable when the payload source returns null', () => {
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG, payloadProvider(null));
    const envelope = adapter.search(QUERY, NOW);
    expect(envelope?.status).toBe('failure');
    expect(envelope?.error?.category).toBe('provider-unavailable');
  });

  it('reports provider-unavailable when the payload source throws', () => {
    const throwing: AmadeusPayloadProvider = () => {
      throw new Error('boom');
    };
    const adapter = createAmadeusDiscoveryAdapter(READY_CONFIG, throwing);
    const envelope = adapter.search(QUERY, NOW);
    expect(envelope?.status).toBe('failure');
    expect(envelope?.error?.category).toBe('provider-unavailable');
    expect(envelope?.error?.message).not.toContain('boom');
  });
});
