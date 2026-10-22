import { describe, expect, it } from 'vitest';
import type { TripDiscoveryQuery } from '../domain/providers/discoveryInput';
import type { ProviderCapabilityId } from '../domain/providers/providerCapabilities';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';
import type { ProviderAdapter } from '../domain/providers/providerAdapter';
import type { ProviderSafeErrorCategory } from '../domain/providers/executionOperations';
import {
  isProviderExecutionSuccess,
  providerOperationIsReadOnly,
} from '../domain/providers/executionOperations';
import { normalizeTripProviderResult } from '../domain/providers/providerResults';
import {
  MOCK_ACCOMMODATION_SOURCE_ID,
  MOCK_ACCOMMODATION_SOURCE_NAME,
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
  MOCK_EMPTY_RESULTS_DESTINATION,
  MOCK_MALFORMED_DESTINATION,
  MOCK_PROVIDER_FAILURE_DESTINATION,
  MOCK_RATE_LIMITED_DESTINATION,
  MOCK_RESULT_DISCLAIMER,
  MOCK_RESULT_FRESHNESS_MINUTES,
  MOCK_TIMEOUT_DESTINATION,
  MOCK_TRANSPORT_SOURCE_ID,
  MOCK_TRANSPORT_SOURCE_NAME,
  MOCK_UNKNOWN_FAILURE_DESTINATION,
  addIsoMinutes,
  getMockAvailabilityLabel,
  getMockDestinationFailureCategory,
} from '../services/mockDiscovery/mockFixtures';
import { MOCK_DISCOVERY_ADAPTERS } from '../services/mockDiscovery/mockProviders';
import { mockAccommodationProviderAdapter } from '../services/mockDiscovery/mockAccommodationProvider';
import { mockTransportProviderAdapter } from '../services/mockDiscovery/mockTransportProvider';
import { mockAlternativeTransportProviderAdapter } from '../services/mockDiscovery/mockAlternativeTransportProvider';

const NOW = '2026-09-13T08:00:00.000Z';

function transportQuery(overrides: Partial<TripDiscoveryQuery> = {}): TripDiscoveryQuery {
  return { category: 'transport', destination: 'Tokyo', ...overrides };
}

function accommodationQuery(overrides: Partial<TripDiscoveryQuery> = {}): TripDiscoveryQuery {
  return { category: 'accommodation', destination: 'Tokyo', ...overrides };
}

describe('mock provider registry', () => {
  it('registers exactly the three documented mock adapters in a stable order', () => {
    expect(MOCK_DISCOVERY_ADAPTERS.map((adapter) => adapter.id())).toEqual([
      MOCK_TRANSPORT_SOURCE_ID,
      MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
      MOCK_ACCOMMODATION_SOURCE_ID,
    ]);
  });

  it('exposes mock-only source labels — never a real provider name', () => {
    expect(MOCK_TRANSPORT_SOURCE_NAME).toBe('Mock Transport Provider');
    expect(MOCK_ACCOMMODATION_SOURCE_NAME).toBe('Mock Accommodation Provider');
    expect(MOCK_DISCOVERY_ADAPTERS.every((adapter) => adapter.name().startsWith('Mock '))).toBe(
      true
    );
  });

  it('declares only recognized capability ids', () => {
    for (const adapter of MOCK_DISCOVERY_ADAPTERS) {
      for (const declaration of adapter.profile.capabilities) {
        expect(
          (PROVIDER_CAPABILITY_IDS as ReadonlyArray<string>).includes(declaration.capability)
        ).toBe(true);
      }
    }
  });
});

describe('mock provider capability declarations', () => {
  it('transport declares transport search as operational and nothing else relevant', () => {
    const profile = mockTransportProviderAdapter.profile;
    expect(profile.id).toBe(MOCK_TRANSPORT_SOURCE_ID);
    expect(mockTransportProviderAdapter.isOperational('search-transport')).toBe(true);
    expect(mockTransportProviderAdapter.isOperational('retrieve-transport-details')).toBe(true);
    expect(mockTransportProviderAdapter.isOperational('search-accommodation')).toBe(false);
    expect(mockTransportProviderAdapter.isOperational('verify-reference')).toBe(false);
    expect(mockTransportProviderAdapter.isOperational('retrieve-booking-status')).toBe(false);
    expect(mockTransportProviderAdapter.isOperational('retrieve-cancellation-information')).toBe(
      false
    );
  });

  it('accommodation declares accommodation search as operational and nothing else relevant', () => {
    const profile = mockAccommodationProviderAdapter.profile;
    expect(profile.id).toBe(MOCK_ACCOMMODATION_SOURCE_ID);
    expect(mockAccommodationProviderAdapter.isOperational('search-accommodation')).toBe(true);
    expect(mockAccommodationProviderAdapter.isOperational('retrieve-accommodation-details')).toBe(
      true
    );
    expect(mockAccommodationProviderAdapter.isOperational('search-transport')).toBe(false);
  });

  it('alternative transport declares transport search as operational and nothing else relevant', () => {
    const profile = mockAlternativeTransportProviderAdapter.profile;
    expect(profile.id).toBe(MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID);
    expect(mockAlternativeTransportProviderAdapter.isOperational('search-transport')).toBe(true);
    expect(mockAlternativeTransportProviderAdapter.isOperational('search-accommodation')).toBe(
      false
    );
    expect(mockAlternativeTransportProviderAdapter.isOperational('verify-reference')).toBe(false);
    expect(mockAlternativeTransportProviderAdapter.isOperational('retrieve-booking-status')).toBe(
      false
    );
  });

  it('unlisted capabilities count as unsupported', () => {
    const missing: ProviderCapabilityId = 'search-accommodation';
    expect(mockTransportProviderAdapter.isOperational(missing)).toBe(false);
  });
});

describe('mock transport provider search behavior', () => {
  it('returns exactly three normalized transport results for a valid query', () => {
    const envelope = mockTransportProviderAdapter.search(transportQuery(), NOW);
    expect(envelope).not.toBeNull();
    expect(isProviderExecutionSuccess(envelope!)).toBe(true);
    expect(envelope!.operation).toBe('search');
    expect(providerOperationIsReadOnly(envelope!.operation)).toBe(true);
    expect(envelope!.data).toHaveLength(3);
    expect(envelope!.limitations).toContain(MOCK_RESULT_DISCLAIMER);
  });

  it('stamps deterministic freshness timestamps and identities on every result', () => {
    const results = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data!;
    expect(results.length).toBe(3);
    results.forEach((result, index) => {
      expect(normalizeTripProviderResult(result)).not.toBeNull();
      expect(result.providerId).toBe(MOCK_TRANSPORT_SOURCE_ID);
      expect(result.providerName).toBe(MOCK_TRANSPORT_SOURCE_NAME);
      expect(result.resultId).toBe(`mock-transport-${index + 1}`);
      expect(result.category).toBe('transport');
      expect(result.retrievedAt).toBe(NOW);
      expect(result.expiresAt).toBe(addIsoMinutes(NOW, MOCK_RESULT_FRESHNESS_MINUTES));
      expect(result.limitations).toContain(MOCK_RESULT_DISCLAIMER);
      expect(String(result.price!.amount)).toMatch(/^\d/);
    });
  });

  it('builds departure/arrival timestamps relative to the explicit now (deterministic)', () => {
    const a = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data!;
    const b = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data!;
    expect(a).toEqual(b);
    expect(a[0].departureAt).toBe(addIsoMinutes(NOW, 120));
  });

  it('returns the empty set for the documented empty sentinel destination', () => {
    const envelope = mockTransportProviderAdapter.search(
      transportQuery({ destination: MOCK_EMPTY_RESULTS_DESTINATION }),
      NOW
    );
    expect(envelope).not.toBeNull();
    expect(isProviderExecutionSuccess(envelope!)).toBe(true);
    expect(envelope!.data).toEqual([]);
  });

  it('returns a bounded safe failure for the documented failure sentinel destination', () => {
    const envelope = mockTransportProviderAdapter.search(
      transportQuery({ destination: MOCK_PROVIDER_FAILURE_DESTINATION }),
      NOW
    );
    expect(envelope).not.toBeNull();
    expect(envelope!.status).toBe('failure');
    expect(envelope!.error).toEqual(expect.objectContaining({ category: 'provider-unavailable' }));
    expect(envelope!.error!.message).not.toContain(MOCK_PROVIDER_FAILURE_DESTINATION);
    expect(envelope!.data).toBeUndefined();
    expect(envelope!.limitations).toContain(MOCK_RESULT_DISCLAIMER);
  });

  it('mock result text never claims liveness, a booking, or a confirmation', () => {
    const results = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data!;
    const text = results
      .map((r) => [r.title, r.summary, r.cancellationPolicy].join(' '))
      .join(' ')
      .toLowerCase();
    expect(text).not.toMatch(/live|real-time|currently available|confirmed|booked|reserved/);
    expect(results.every((r) => r.title.startsWith('Mock'))).toBe(true);
  });

  it('honors the requested currency in quoted prices', () => {
    const results = mockTransportProviderAdapter.search(
      transportQuery({ currency: 'EUR' }),
      NOW
    )!.data!;
    expect(results.every((r) => r.price?.currency === 'EUR')).toBe(true);
  });
});

describe('mock accommodation provider search behavior', () => {
  it('returns three normalized accommodation results with total nightly-based prices', () => {
    const envelope = mockAccommodationProviderAdapter.search(accommodationQuery(), NOW);
    expect(envelope).not.toBeNull();
    expect(isProviderExecutionSuccess(envelope!)).toBe(true);
    const results = envelope!.data!;
    expect(results).toHaveLength(3);
    expect(providerOperationIsReadOnly(envelope!.operation)).toBe(true);
    results.forEach((result, index) => {
      expect(normalizeTripProviderResult(result)).not.toBeNull();
      expect(result.category).toBe('accommodation');
      expect(result.providerId).toBe(MOCK_ACCOMMODATION_SOURCE_ID);
      expect(result.providerName).toBe(MOCK_ACCOMMODATION_SOURCE_NAME);
      expect(result.resultId).toBe(`mock-accommodation-${index + 1}`);
      expect(result.retrievedAt).toBe(NOW);
      expect(result.arrivalAt).toBeUndefined();
      expect(result.limitations).toContain(MOCK_RESULT_DISCLAIMER);
    });
  });

  it('reports total price and deterministic nightly-total relationship', () => {
    const results = mockAccommodationProviderAdapter.search(
      accommodationQuery({ currency: 'USD' }),
      NOW
    )!.data!;
    expect(results[0].price!.amount).toBe(140 * 3);
    expect(results[1].price!.amount).toBe(92 * 3);
    expect(results[2].price!.amount).toBe(210 * 3);
  });

  it('returns the empty set and failure for the sentinels like the transport adapter', () => {
    const empty = mockAccommodationProviderAdapter.search(
      accommodationQuery({ destination: MOCK_EMPTY_RESULTS_DESTINATION }),
      NOW
    );
    expect(empty!.data).toEqual([]);
    const failure = mockAccommodationProviderAdapter.search(
      accommodationQuery({ destination: MOCK_PROVIDER_FAILURE_DESTINATION }),
      NOW
    );
    expect(failure!.status).toBe('failure');
    expect(failure!.error).toEqual(expect.objectContaining({ category: 'provider-unavailable' }));
  });

  it('mock fixture labeling never claims a real property or booking', () => {
    const results = mockAccommodationProviderAdapter.search(accommodationQuery(), NOW)!.data!;
    expect(results.every((r) => r.title.startsWith('Mock'))).toBe(true);
    const text = results
      .map((r) => r.title)
      .join(' ')
      .toLowerCase();
    expect(text).not.toMatch(/live|confirmed|booked|currently available/);
  });
});

describe('mock fixture helpers', () => {
  it('addIsoMinutes is deterministic and returns input unchanged for invalid input', () => {
    expect(addIsoMinutes(NOW, 60)).toBe('2026-09-13T09:00:00.000Z');
    expect(addIsoMinutes('not-a-date', 60)).toBe('not-a-date');
  });

  it('availability labels are explicitly simulated', () => {
    expect(getMockAvailabilityLabel('available')).toMatch(/^Simulated availability:/);
    expect(getMockAvailabilityLabel('limited')).toMatch(/^Simulated availability:/);
    expect(getMockAvailabilityLabel('unavailable')).toMatch(/^Simulated availability:/);
    expect(getMockAvailabilityLabel('unknown')).toMatch(/^Simulated availability:/);
  });

  it('the disclaimer is a prominent single sentence', () => {
    expect(MOCK_RESULT_DISCLAIMER).toContain('Simulated sample data');
    expect(MOCK_RESULT_DISCLAIMER).toContain('not live availability or a booking');
  });
});

describe('STEP 39 controlled failure sentinels', () => {
  it('maps each failure sentinel to its honest safe error category with a generic message', () => {
    const cases: Array<{ sentinel: string; category: ProviderSafeErrorCategory }> = [
      { sentinel: MOCK_TIMEOUT_DESTINATION, category: 'timeout' },
      { sentinel: MOCK_RATE_LIMITED_DESTINATION, category: 'rate-limited' },
      { sentinel: MOCK_MALFORMED_DESTINATION, category: 'malformed-response' },
      { sentinel: MOCK_UNKNOWN_FAILURE_DESTINATION, category: 'unknown' },
    ];
    for (const { sentinel, category } of cases) {
      expect(getMockDestinationFailureCategory(sentinel)).toBe(category);
      for (const adapter of MOCK_DISCOVERY_ADAPTERS) {
        const query: TripDiscoveryQuery =
          adapter.id() === MOCK_TRANSPORT_SOURCE_ID
            ? transportQuery({ destination: sentinel })
            : accommodationQuery({ destination: sentinel });
        const envelope = adapter.search(query, NOW);
        expect(envelope).not.toBeNull();
        expect(envelope!.status).toBe('failure');
        expect(envelope!.error).toEqual(expect.objectContaining({ category }));
        expect(envelope!.data).toBeUndefined();
        expect(envelope!.error!.message).not.toContain(sentinel);
        expect(envelope!.limitations).toContain(MOCK_RESULT_DISCLAIMER);
      }
    }
  });

  it('normal destinations are never failure sentinels', () => {
    expect(getMockDestinationFailureCategory('Tokyo')).toBeNull();
    expect(getMockDestinationFailureCategory(MOCK_PROVIDER_FAILURE_DESTINATION)).toBeNull();
    expect(getMockDestinationFailureCategory(MOCK_EMPTY_RESULTS_DESTINATION)).toBeNull();
  });
});

describe('STEP 39 result limits and provider metadata', () => {
  it('honors query.limit as an upper bound in stable fixture order', () => {
    const one = mockTransportProviderAdapter.search(transportQuery({ limit: 1 }), NOW);
    expect(one!.data!.map((r) => r.resultId)).toEqual(['mock-transport-1']);
    const two = mockTransportProviderAdapter.search(transportQuery({ limit: 2 }), NOW);
    expect(two!.data!.map((r) => r.resultId)).toEqual(['mock-transport-1', 'mock-transport-2']);

    const accommodation = mockAccommodationProviderAdapter.search(
      accommodationQuery({ limit: 1 }),
      NOW
    );
    expect(accommodation!.data!.map((r) => r.resultId)).toEqual(['mock-accommodation-1']);
  });

  it('returns all fixtures when no limit is requested', () => {
    const envelope = mockTransportProviderAdapter.search(transportQuery(), NOW);
    expect(envelope!.data).toHaveLength(3);
  });

  it('attaches isolated sample metadata to every result', () => {
    const transport = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data!;
    expect(transport.every((r) => r.metadata)).toBe(true);
    expect(transport[0].metadata).toEqual([
      { key: 'vehicle-class', value: 'sample high-speed rail' },
    ]);
    const accommodation = mockAccommodationProviderAdapter.search(accommodationQuery(), NOW)!.data!;
    expect(accommodation[0].metadata).toEqual([{ key: 'property-type', value: 'sample hotel' }]);
  });

  it('metadata stays isolated sample labels and survives normalization', () => {
    const result = mockTransportProviderAdapter.search(transportQuery(), NOW)!.data![0];
    expect(normalizeTripProviderResult(result)).not.toBeNull();
    expect(result.metadata![0].value.startsWith('sample ')).toBe(true);
  });

  it('mock adapters satisfy the provider-neutral ProviderAdapter surface (MockDiscoveryAdapter alias)', () => {
    const adapters: ReadonlyArray<ProviderAdapter> = MOCK_DISCOVERY_ADAPTERS;
    expect(adapters.every((adapter) => typeof adapter.search === 'function')).toBe(true);
    for (const adapter of MOCK_DISCOVERY_ADAPTERS) {
      const envelope = adapter.search(
        {
          category: adapter.id() === MOCK_TRANSPORT_SOURCE_ID ? 'transport' : 'accommodation',
          destination: 'Oslo',
        },
        NOW
      );
      expect(providerOperationIsReadOnly(envelope!.operation)).toBe(true);
    }
  });
});
