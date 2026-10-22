import { describe, expect, it } from 'vitest';
import {
  MAX_DISCOVERY_RESULT_LIMIT,
  type TripDiscoveryQuery,
} from '../domain/providers/discoveryInput';
import {
  buildProviderExecutionSuccess,
  buildProviderExecutionRequiresUserAction,
} from '../domain/providers/executionOperations';
import type {
  ProviderExecutionResult,
  ProviderSafeErrorCategory,
} from '../domain/providers/executionOperations';
import { normalizeTripProviderResult } from '../domain/providers/providerResults';
import type { TripProviderResult } from '../domain/providers/providerResults';
import type { MockDiscoveryAdapter } from '../services/mockDiscovery/mockProviders';
import {
  MOCK_ACCOMMODATION_SOURCE_ID,
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
  MOCK_EMPTY_RESULTS_DESTINATION,
  MOCK_MALFORMED_DESTINATION,
  MOCK_PROVIDER_FAILURE_DESTINATION,
  MOCK_RATE_LIMITED_DESTINATION,
  MOCK_TIMEOUT_DESTINATION,
  MOCK_TRANSPORT_SOURCE_ID,
  MOCK_UNKNOWN_FAILURE_DESTINATION,
} from '../services/mockDiscovery/mockFixtures';
import { MOCK_DISCOVERY_CATEGORY_ADAPTER } from '../services/mockDiscovery/mockProviders';
import {
  discoverTripOptions,
  outcomeFromAggregate,
  runDiscoveryWithAdapter,
} from '../services/mockDiscovery/mockDiscoveryService';
import type {
  ProviderDiscoveryAggregateStatus,
  ProviderDiscoveryStageStatus,
} from '../domain/providers/discoveryOrchestration';
import { mockAccommodationProviderAdapter } from '../services/mockDiscovery/mockAccommodationProvider';
import { mockTransportProviderAdapter } from '../services/mockDiscovery/mockTransportProvider';

const NOW = '2026-09-13T08:00:00.000Z';

function validTransportRaw(): Record<string, unknown> {
  return {
    category: 'transport',
    destination: 'Tokyo',
    origin: 'London',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    travelerCount: 2,
    currency: 'eur',
  };
}

describe('discoverTripOptions (registry path)', () => {
  it('returns a success outcome with six normalized mock transport results', () => {
    const outcome = discoverTripOptions(validTransportRaw(), NOW);
    expect(outcome.status).toBe('success');
    expect(outcome.results).toHaveLength(6);
    expect(outcome.error).toBeNull();
    expect(outcome.problem).toBeNull();
    expect(outcome.query).toEqual(
      expect.objectContaining({ category: 'transport', destination: 'Tokyo', currency: 'EUR' })
    );
    expect(outcome.adaptersConsulted.map((adapter) => adapter.id)).toEqual([
      MOCK_TRANSPORT_SOURCE_ID,
      MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
    ]);
    expect(outcome.results.map((r) => r.providerId)).toEqual([
      MOCK_TRANSPORT_SOURCE_ID,
      MOCK_TRANSPORT_SOURCE_ID,
      MOCK_TRANSPORT_SOURCE_ID,
      MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
      MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
      MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
    ]);
  });

  it('returns a success outcome for accommodation search via the accommodation adapter', () => {
    const outcome = discoverTripOptions({ category: 'accommodation', destination: 'Osaka' }, NOW);
    expect(outcome.status).toBe('success');
    expect(outcome.results).toHaveLength(3);
    expect(outcome.adaptersConsulted.map((adapter) => adapter.id)).toEqual([
      MOCK_ACCOMMODATION_SOURCE_ID,
    ]);
  });

  it('is deterministic: identical (raw, now) yields an identical outcome', () => {
    expect(discoverTripOptions(validTransportRaw(), NOW)).toEqual(
      discoverTripOptions(validTransportRaw(), NOW)
    );
  });

  it('returns an empty outcome when the reserved empty sentinel destination is used', () => {
    const outcome = discoverTripOptions(
      { category: 'transport', destination: MOCK_EMPTY_RESULTS_DESTINATION },
      NOW
    );
    expect(outcome.status).toBe('empty');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeNull();
  });

  it('returns a provider-failure outcome with a bounded safe error for the failure sentinel', () => {
    const outcome = discoverTripOptions(
      { category: 'transport', destination: MOCK_PROVIDER_FAILURE_DESTINATION },
      NOW
    );
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toEqual(expect.objectContaining({ category: 'provider-unavailable' }));
    expect(outcome.error!.message).not.toContain(MOCK_PROVIDER_FAILURE_DESTINATION);
  });

  it('returns an invalid-input outcome for a malformed query and never consults an adapter', () => {
    const outcome = discoverTripOptions({ category: 'transport' }, NOW);
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.problem).toEqual(expect.objectContaining({ code: 'missing-destination' }));
    expect(outcome.adaptersConsulted).toEqual([]);
    expect(outcome.results).toEqual([]);
  });

  it('returns an invalid-input outcome for an unknown key and never consults an adapter', () => {
    const outcome = discoverTripOptions(
      { category: 'transport', destination: 'Tokyo', providerId: 'x' },
      NOW
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.problem?.code).toBe('unknown-key');
    expect(outcome.adaptersConsulted).toEqual([]);
  });

  it('returns a provider-failure outcome when the adapter cannot build an envelope from an invalid now', () => {
    const outcome = discoverTripOptions(validTransportRaw(), 'not-a-date');
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toEqual(expect.objectContaining({ category: 'unknown' }));
  });
});

describe('STEP 39 discovery service controlled outcomes and limits', () => {
  it('maps the controlled failure sentinels to provider-failure with their honest categories', () => {
    const cases: Array<{ sentinel: string; category: ProviderSafeErrorCategory }> = [
      { sentinel: MOCK_TIMEOUT_DESTINATION, category: 'timeout' },
      { sentinel: MOCK_RATE_LIMITED_DESTINATION, category: 'rate-limited' },
      { sentinel: MOCK_MALFORMED_DESTINATION, category: 'malformed-response' },
      { sentinel: MOCK_UNKNOWN_FAILURE_DESTINATION, category: 'unknown' },
    ];
    for (const { sentinel, category } of cases) {
      const outcome = discoverTripOptions({ category: 'transport', destination: sentinel }, NOW);
      expect(outcome.status).toBe('provider-failure');
      expect(outcome.results).toEqual([]);
      expect(outcome.error).toEqual(expect.objectContaining({ category }));
      expect(outcome.error!.message).not.toContain(sentinel);
    }
  });

  it('propagates a requested limit through the service to the adapter', () => {
    const outcome = discoverTripOptions(
      { category: 'transport', destination: 'Tokyo', limit: 2 },
      NOW
    );
    expect(outcome.status).toBe('success');
    expect(outcome.results.map((r) => r.resultId)).toEqual([
      'mock-transport-1',
      'mock-transport-2',
      'mock-alternative-transport-1',
      'mock-alternative-transport-2',
    ]);
    expect(outcome.query?.limit).toBe(2);
  });

  it('rejects an invalid or out-of-range limit as invalid-input before any adapter runs', () => {
    const badType = discoverTripOptions(
      { category: 'transport', destination: 'Tokyo', limit: '2' },
      NOW
    );
    expect(badType.status).toBe('invalid-input');
    expect(badType.problem?.code).toBe('invalid-limit');
    expect(badType.adaptersConsulted).toEqual([]);

    const tooLarge = discoverTripOptions(
      { category: 'transport', destination: 'Tokyo', limit: MAX_DISCOVERY_RESULT_LIMIT + 1 },
      NOW
    );
    expect(tooLarge.status).toBe('invalid-input');
    expect(tooLarge.problem?.code).toBe('limit-out-of-range');
    expect(tooLarge.adaptersConsulted).toEqual([]);
  });
});

describe('runDiscoveryWithAdapter (capability-gated path)', () => {
  it('returns unsupported and never calls search when the adapter lacks the category capability', () => {
    const calls: string[] = [];
    const spyAdapter: MockDiscoveryAdapter = {
      get profile() {
        return mockAccommodationProviderAdapter.profile;
      },
      isOperational: mockAccommodationProviderAdapter.isOperational,
      id: mockAccommodationProviderAdapter.id,
      name: mockAccommodationProviderAdapter.name,
      search() {
        calls.push('search');
        return null;
      },
    };

    const outcome = runDiscoveryWithAdapter(
      { category: 'transport', destination: 'Tokyo' },
      spyAdapter,
      NOW
    );
    expect(outcome.status).toBe('unsupported');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeNull();
    expect(outcome.adaptersConsulted.map((adapter) => adapter.id)).toEqual([
      MOCK_ACCOMMODATION_SOURCE_ID,
    ]);
    expect(calls).toEqual([]);
  });

  it('returns success when the adapter supports the category capability', () => {
    const outcome = runDiscoveryWithAdapter(
      { category: 'transport', destination: 'Tokyo' },
      mockTransportProviderAdapter,
      NOW
    );
    expect(outcome.status).toBe('success');
    expect(outcome.results).toHaveLength(3);
  });

  it('returns provider-failure when the adapter returns a null envelope', () => {
    const nullAdapter: MockDiscoveryAdapter = {
      get profile() {
        return mockTransportProviderAdapter.profile;
      },
      isOperational: mockTransportProviderAdapter.isOperational,
      id: mockTransportProviderAdapter.id,
      name: mockTransportProviderAdapter.name,
      search() {
        return null;
      },
    };
    const outcome = runDiscoveryWithAdapter(
      { category: 'transport', destination: 'Tokyo' },
      nullAdapter,
      NOW
    );
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toEqual(expect.objectContaining({ category: 'unknown' }));
  });

  it('returns provider-failure when the envelope reports a non-search operation', () => {
    const wrongOperationAdapter: MockDiscoveryAdapter = {
      get profile() {
        return mockTransportProviderAdapter.profile;
      },
      isOperational: mockTransportProviderAdapter.isOperational,
      id: mockTransportProviderAdapter.id,
      name: mockTransportProviderAdapter.name,
      search(
        query: TripDiscoveryQuery,
        now: string
      ): ProviderExecutionResult<TripProviderResult[]> | null {
        return buildProviderExecutionSuccess('verify', { id: 'mock-x', name: 'Mock X' }, [], now);
      },
    };
    const outcome = runDiscoveryWithAdapter(
      { category: 'transport', destination: 'Tokyo' },
      wrongOperationAdapter,
      NOW
    );
    expect(outcome.status).toBe('provider-failure');
  });

  it('returns provider-failure for a requires-user-action envelope (safe approval-grade error)', () => {
    const requiresUserAdapter: MockDiscoveryAdapter = {
      get profile() {
        return mockTransportProviderAdapter.profile;
      },
      isOperational: mockTransportProviderAdapter.isOperational,
      id: mockTransportProviderAdapter.id,
      name: mockTransportProviderAdapter.name,
      search(
        query: TripDiscoveryQuery,
        now: string
      ): ProviderExecutionResult<TripProviderResult[]> | null {
        return buildProviderExecutionRequiresUserAction(
          'search',
          { id: 'mock-x', name: 'Mock X' },
          'A simulated approval would be needed.',
          now
        );
      },
    };
    const outcome = runDiscoveryWithAdapter(
      { category: 'transport', destination: 'Tokyo' },
      requiresUserAdapter,
      NOW
    );
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error).toEqual(expect.objectContaining({ category: 'approval-required' }));
  });
});

describe('MockDiscoveryOutcome shape', () => {
  it('carries exactly the seven documented fields and no persistence or mutation hooks', () => {
    const outcome = discoverTripOptions(validTransportRaw(), NOW);
    expect(Object.keys(outcome).sort()).toEqual([
      'adaptersConsulted',
      'error',
      'problem',
      'providerOutcomes',
      'query',
      'results',
      'status',
    ]);
    const keys = Object.keys(outcome.results[0]);
    expect(keys).not.toContain('verification');
    expect(keys).not.toContain('bookingState');
    expect(keys).not.toContain('confirmationReference');
    expect(keys).not.toContain('payment');
  });

  it('exposes only adapter profiles for identity — never credentials or raw payloads', () => {
    const outcome = discoverTripOptions(validTransportRaw(), NOW);
    const profile = outcome.adaptersConsulted[0];
    expect(Object.keys(profile).sort()).toEqual([
      'adapterType',
      'capabilities',
      'id',
      'name',
      'sourceDomain',
    ]);
  });
});

describe('read-only guarantees', () => {
  it('passing the same fixture module data across searches produces identical outcome sets', () => {
    const first = discoverTripOptions(validTransportRaw(), NOW);
    const second = discoverTripOptions(validTransportRaw(), NOW);
    expect(first).toEqual(second);
    expect(first.results.map((r) => r.resultId)).toEqual([
      'mock-transport-1',
      'mock-transport-2',
      'mock-transport-3',
      'mock-alternative-transport-1',
      'mock-alternative-transport-2',
      'mock-alternative-transport-3',
    ]);
  });

  it('all success results are normalized app-contract values (normalizeTripProviderResult passes)', () => {
    const outcome = discoverTripOptions(validTransportRaw(), NOW);
    for (const result of outcome.results) {
      expect(normalizeTripProviderResult(result)).not.toBeNull();
    }
  });
});

describe('registry integrity', () => {
  it('categories always resolve to a registered adapter', () => {
    expect(MOCK_DISCOVERY_CATEGORY_ADAPTER.transport).toBe(mockTransportProviderAdapter);
    expect(MOCK_DISCOVERY_CATEGORY_ADAPTER.accommodation).toBe(mockAccommodationProviderAdapter);
  });
});

describe('defensive outcome composition (STEP 40)', () => {
  it('composes a safe unexpected-failure outcome for an aggregate the orchestrator could never produce', () => {
    const syntheticAggregate = {
      status: 'not-a-real-status' as ProviderDiscoveryAggregateStatus,
      query: { category: 'transport' as const, destination: 'Tokyo' },
      results: [],
      totalResults: 0,
      stages: [
        {
          providerId: 'mock-provider-synthetic',
          providerName: 'Mock Synthetic Provider',
          status: 'unknown-failure' as ProviderDiscoveryStageStatus,
          resultCount: 0,
          error: null,
        },
      ],
    };
    const outcome = outcomeFromAggregate(syntheticAggregate);
    expect(outcome.status).toBe('unexpected-failure');
    expect(outcome.error).toEqual({
      category: 'unknown',
      message: 'The simulated search returned an unexpected result.',
    });
    expect(outcome.results).toEqual([]);
    expect(outcome.adaptersConsulted.map((adapter) => adapter.id)).toEqual([
      'mock-provider-synthetic',
    ]);
    expect(outcome.providerOutcomes).toEqual([]);
    expect(outcome.query).toEqual({ category: 'transport', destination: 'Tokyo' });
  });
});
