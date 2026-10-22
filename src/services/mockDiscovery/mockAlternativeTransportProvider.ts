/**
 * Deterministic mock alternative-transport provider adapter (STEP 40).
 *
 * Implements the STEP 20 `ProviderAdapter` boundary the same way
 * `mockTransportProvider.ts` does, but with a distinct source identity and its
 * own normalized alternative fixtures (`mockAlternative...` in `mockFixtures`)
 * so discovery can attribute results to a second transport provider. Capability
 * declarations are honest and deliberately mirror the primary transport mock:
 * `search-transport` (and sample detail retrieval) is `available`;
 * `verify-reference` is `temporarily-unavailable` because mock results carry no
 * booking reference to verify; `retrieve-booking-status` and
 * `retrieve-cancellation-information` are `unsupported`. Only `search` runs
 * here — nothing books, pays, verifies, retrieves a booking, or cancels.
 *
 * Determinism: every result derives from `now` (passed by the caller) plus the
 * static fixtures. The empty and failure paths are reached through the same
 * documented reserved destination sentinels in `mockFixtures.ts` — including
 * the controlled timeout, rate-limited, malformed, and unknown-failure
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
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME,
  MOCK_EMPTY_RESULTS_DESTINATION,
  MOCK_PROVIDER_FAILURE_DESTINATION,
  MOCK_RESULT_DISCLAIMER,
  buildMockAlternativeTransportResults,
  buildMockSentinelFailure,
} from './mockFixtures';

const ALTERNATIVE_TRANSPORT_PROFILE: ProviderAdapterProfile = {
  id: MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
  name: MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME,
  capabilities: [
    { capability: 'search-transport', status: 'available' },
    {
      capability: 'retrieve-transport-details',
      status: 'available',
      note: 'Detail lookup reuses the same sample alternative fixtures.',
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
 * The mock alternative-transport adapter. `search` is the only executed
 * operation and is read-only by contract (`providerOperationIsReadOnly`).
 * All sample outcomes are deterministic in `(query, now)`.
 */
export const mockAlternativeTransportProviderAdapter: MockDiscoveryAdapter = {
  get profile() {
    return ALTERNATIVE_TRANSPORT_PROFILE;
  },
  isOperational(capability: ProviderCapabilityId): boolean {
    return isAdapterCapabilityAvailable(ALTERNATIVE_TRANSPORT_PROFILE, capability);
  },
  id(): string {
    return ALTERNATIVE_TRANSPORT_PROFILE.id;
  },
  name(): string {
    return ALTERNATIVE_TRANSPORT_PROFILE.name;
  },
  search(
    query: TripDiscoveryQuery,
    now: string
  ): ProviderExecutionResult<TripProviderResult[]> | null {
    if (!isAdapterCapabilityAvailable(ALTERNATIVE_TRANSPORT_PROFILE, 'search-transport')) {
      return null;
    }
    if (query.destination === MOCK_PROVIDER_FAILURE_DESTINATION) {
      return buildProviderExecutionFailure(
        'search',
        { id: ALTERNATIVE_TRANSPORT_PROFILE.id, name: ALTERNATIVE_TRANSPORT_PROFILE.name },
        'provider-unavailable',
        'The simulated alternative-transport search could not be completed.',
        now,
        'not-retryable',
        { limitations: [MOCK_RESULT_DISCLAIMER] }
      );
    }
    const sentinelFailure = buildMockSentinelFailure(
      { id: ALTERNATIVE_TRANSPORT_PROFILE.id, name: ALTERNATIVE_TRANSPORT_PROFILE.name },
      query.destination,
      now
    );
    if (sentinelFailure !== null) return sentinelFailure;
    const results =
      query.destination === MOCK_EMPTY_RESULTS_DESTINATION
        ? []
        : buildMockAlternativeTransportResults(query, now);
    const boundedResults = query.limit === undefined ? results : results.slice(0, query.limit);
    return buildProviderExecutionSuccess(
      'search',
      { id: ALTERNATIVE_TRANSPORT_PROFILE.id, name: ALTERNATIVE_TRANSPORT_PROFILE.name },
      boundedResults,
      now,
      { limitations: [MOCK_RESULT_DISCLAIMER] }
    );
  },
};
