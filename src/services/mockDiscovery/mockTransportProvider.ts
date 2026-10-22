/**
 * Deterministic mock transport provider adapter (STEP 21).
 *
 * Implements the STEP 20 `ProviderAdapter` boundary so discovery can exercise
 * the search path end-to-end without any real provider. Capability declarations
 * are honest: `search-transport` (and the retrieval of the same sample details)
 * is `available`; reference verification is `temporarily-unavailable` because
 * mock results carry no booking reference to verify; booking status and
 * cancellation-information retrieval are `unsupported`. Only `search` runs
 * here — nothing books, pays, verifies, retrieves a booking, or cancels.
 *
 * Determinism: every result derives from `now` (passed by the caller) plus the
 * static fixtures. The empty and failure paths are reached through the
 * documented reserved destination sentinels in `mockFixtures.ts` — including
 * the controlled timeout, rate-limited, malformed-response, and unknown-failure
 * outcomes — and a requested `query.limit` is honored as an upper bound on the
 * returned sample results. No network, no SDK, no credential, no clock.
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
  MOCK_EMPTY_RESULTS_DESTINATION,
  MOCK_PROVIDER_FAILURE_DESTINATION,
  MOCK_RESULT_DISCLAIMER,
  MOCK_TRANSPORT_SOURCE_ID,
  MOCK_TRANSPORT_SOURCE_NAME,
  buildMockSentinelFailure,
  buildMockTransportResults,
} from './mockFixtures';

const TRANSPORT_PROFILE: ProviderAdapterProfile = {
  id: MOCK_TRANSPORT_SOURCE_ID,
  name: MOCK_TRANSPORT_SOURCE_NAME,
  capabilities: [
    { capability: 'search-transport', status: 'available' },
    {
      capability: 'retrieve-transport-details',
      status: 'available',
      note: 'Detail lookup reuses the same sample fixtures.',
    },
    {
      capability: 'verify-reference',
      status: 'temporarily-unavailable',
      note: 'Mock results carry no booking reference to verify.',
    },
    { capability: 'retrieve-booking-status', status: 'unsupported' },
    { capability: 'retrieve-cancellation-information', status: 'unsupported' },
  ],
};

/**
 * The mock transport adapter. `search` is the only executed operation and is
 * read-only by contract (`providerOperationIsReadOnly('search')`).
 */
export const mockTransportProviderAdapter: MockDiscoveryAdapter = {
  get profile() {
    return TRANSPORT_PROFILE;
  },
  isOperational(capability: ProviderCapabilityId): boolean {
    return isAdapterCapabilityAvailable(TRANSPORT_PROFILE, capability);
  },
  id(): string {
    return TRANSPORT_PROFILE.id;
  },
  name(): string {
    return TRANSPORT_PROFILE.name;
  },
  search(
    query: TripDiscoveryQuery,
    now: string
  ): ProviderExecutionResult<TripProviderResult[]> | null {
    if (!isAdapterCapabilityAvailable(TRANSPORT_PROFILE, 'search-transport')) return null;
    if (query.destination === MOCK_PROVIDER_FAILURE_DESTINATION) {
      return buildProviderExecutionFailure(
        'search',
        { id: TRANSPORT_PROFILE.id, name: TRANSPORT_PROFILE.name },
        'provider-unavailable',
        'The simulated transport search could not be completed.',
        now,
        'not-retryable',
        { limitations: [MOCK_RESULT_DISCLAIMER] }
      );
    }
    const sentinelFailure = buildMockSentinelFailure(
      { id: TRANSPORT_PROFILE.id, name: TRANSPORT_PROFILE.name },
      query.destination,
      now
    );
    if (sentinelFailure !== null) return sentinelFailure;
    const results =
      query.destination === MOCK_EMPTY_RESULTS_DESTINATION
        ? []
        : buildMockTransportResults(query, now);
    const boundedResults = query.limit === undefined ? results : results.slice(0, query.limit);
    return buildProviderExecutionSuccess(
      'search',
      { id: TRANSPORT_PROFILE.id, name: TRANSPORT_PROFILE.name },
      boundedResults,
      now,
      { limitations: [MOCK_RESULT_DISCLAIMER] }
    );
  },
};
