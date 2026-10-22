/**
 * Deterministic mock accommodation provider adapter (STEP 21).
 *
 * Implements the STEP 20 `ProviderAdapter` boundary for accommodation search.
 * `search-accommodation` (and detail retrieval of the same sample fixtures) is
 * `available`; every other capability stays `unsupported` so the "check the
 * capability before calling" service path is exercised honestly. Only `search`
 * runs here — nothing books, pays, verifies, retrieves a booking, or cancels.
 *
 * Determinism: every result derives from `now` (passed by the caller) plus the
 * static fixtures; the documented reserved destination sentinels drive the
 * empty and failure paths — including the controlled timeout, rate-limited,
 * malformed-response, and unknown-failure outcomes — and a requested
 * `query.limit` is honored as an upper bound on the returned sample results.
 * No network, no SDK, no credential, no clock.
 */

import type { ProviderExecutionResult } from '../../domain/providers/executionOperations';
import {
  buildProviderExecutionFailure,
  buildProviderExecutionSuccess,
} from '../../domain/providers/executionOperations';
import type { ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import {
  isAdapterCapabilityAvailable,
  type ProviderAdapterProfile,
} from '../../domain/providers/providerAdapter';
import type { TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type { MockDiscoveryAdapter } from './mockProviders';
import {
  MOCK_ACCOMMODATION_SOURCE_ID,
  MOCK_ACCOMMODATION_SOURCE_NAME,
  MOCK_EMPTY_RESULTS_DESTINATION,
  MOCK_PROVIDER_FAILURE_DESTINATION,
  MOCK_RESULT_DISCLAIMER,
  buildMockAccommodationResults,
  buildMockSentinelFailure,
} from './mockFixtures';

const ACCOMMODATION_PROFILE: ProviderAdapterProfile = {
  id: MOCK_ACCOMMODATION_SOURCE_ID,
  name: MOCK_ACCOMMODATION_SOURCE_NAME,
  capabilities: [
    { capability: 'search-accommodation', status: 'available' },
    {
      capability: 'retrieve-accommodation-details',
      status: 'available',
      note: 'Detail lookup reuses the same sample fixtures.',
    },
    { capability: 'verify-reference', status: 'unsupported' },
    { capability: 'retrieve-booking-status', status: 'unsupported' },
    { capability: 'retrieve-cancellation-information', status: 'unsupported' },
  ],
};

/**
 * The mock accommodation adapter. `search` is the only executed operation and
 * is read-only by contract (`providerOperationIsReadOnly('search')`).
 */
export const mockAccommodationProviderAdapter: MockDiscoveryAdapter = {
  get profile() {
    return ACCOMMODATION_PROFILE;
  },
  isOperational(capability: ProviderCapabilityId): boolean {
    return isAdapterCapabilityAvailable(ACCOMMODATION_PROFILE, capability);
  },
  id(): string {
    return ACCOMMODATION_PROFILE.id;
  },
  name(): string {
    return ACCOMMODATION_PROFILE.name;
  },
  search(
    query: TripDiscoveryQuery,
    now: string
  ): ProviderExecutionResult<TripProviderResult[]> | null {
    if (!isAdapterCapabilityAvailable(ACCOMMODATION_PROFILE, 'search-accommodation')) return null;
    if (query.destination === MOCK_PROVIDER_FAILURE_DESTINATION) {
      return buildProviderExecutionFailure(
        'search',
        { id: ACCOMMODATION_PROFILE.id, name: ACCOMMODATION_PROFILE.name },
        'provider-unavailable',
        'The simulated accommodation search could not be completed.',
        now,
        'not-retryable',
        { limitations: [MOCK_RESULT_DISCLAIMER] }
      );
    }
    const sentinelFailure = buildMockSentinelFailure(
      { id: ACCOMMODATION_PROFILE.id, name: ACCOMMODATION_PROFILE.name },
      query.destination,
      now
    );
    if (sentinelFailure !== null) return sentinelFailure;
    const results =
      query.destination === MOCK_EMPTY_RESULTS_DESTINATION
        ? []
        : buildMockAccommodationResults(query, now);
    const boundedResults = query.limit === undefined ? results : results.slice(0, query.limit);
    return buildProviderExecutionSuccess(
      'search',
      { id: ACCOMMODATION_PROFILE.id, name: ACCOMMODATION_PROFILE.name },
      boundedResults,
      now,
      { limitations: [MOCK_RESULT_DISCLAIMER] }
    );
  },
};
