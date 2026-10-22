/**
 * Real Amadeus discovery adapter factory (STEP 41).
 *
 * Implements the STEP 20 `ProviderAdapter` boundary for the FIRST real external
 * discovery provider in the app. It is a *factory* (not a singleton) because a
 * real provider's readiness depends on injected config: the browser default is
 * always `attemptEnabled: false`, so the very same source produces either a
 * safe, honest non-operational adapter or a fully-keyed one, with zero app
 * code changes between builds.
 *
 * Contract rules:
 *
 * 1. **Boundary-faithful.** This is the only place where the Amadeus raw
 *    vocabulary is translated into the normalized app contracts. `search` is
 *    the single executed operation and stays read-only (`providerOperationIsReadOnly('search')`);
 *    it returns a normalized execution envelope holding `TripProviderResult[]`
 *    on success or a bounded safe error otherwise. Nothing books, pays,
 *    verifies, or persists.
 * 2. **Capability-gated.** `search-accommodation` is declared via
 *    `getRealProviderCapabilityStatus(config)`: `available` only in the `ready`
 *    gate state, otherwise `unavailable-missing-credentials`. The STEP 39/40
 *    orchestrator therefore never invokes a not-ready adapter's `search`.
 * 3. **Payload source is injected and deterministic.** `search` maps whatever
 *    payload the caller-supplied `payloadProvider` yields; tests (and a future
 *    server path) feed fixture payloads through this seam so the entire success
 *    path is proven offline with no network. A missing or failing payload
 *    source is a bounded `provider-failure`, never a throw.
 * 4. **Secrets never appear in envelopes.** The normalized result carries only
 *    provider id/name/resultId and user-visible fields; credentials and tokens
 *    stay in config/connection, never in a result.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderExecutionResult } from '../../domain/providers/executionOperations';
import {
  buildProviderExecutionFailure,
  buildProviderExecutionSuccess,
} from '../../domain/providers/executionOperations';
import type { ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import {
  isAdapterCapabilityAvailable,
  type ProviderAdapter,
  type ProviderAdapterProfile,
} from '../../domain/providers/providerAdapter';
import type { TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type { AmadeusDiscoveryConfig } from './amadeusConfig';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
  getRealProviderCapabilityStatus,
} from './amadeusConfig';
import { AMADEUS_RESULT_DISCLAIMER, mapAmadeusHotelOffersResponse } from './amadeusMapping';

/** Supplies the raw Amadeus payload for a query; returns `null` when none is available. */
export type AmadeusPayloadProvider = (query: TripDiscoveryQuery, now: string) => unknown | null;

/** The stable message used when a payload cannot be produced (never a raw payload). */
export const AMADEUS_PAYLOAD_SOURCE_ERROR_MESSAGE =
  'The Amadeus payload source is not available for this build.';

/**
 * Creates a boundary-conforming Amadeus discovery adapter for `config`. The
 * optional `payloadProvider` lets callers and tests drive the success path
 * offline; without one, an operationally-ready adapter reports a bounded
 * provider failure when its `search` is actually invoked.
 */
export function createAmadeusDiscoveryAdapter(
  config: AmadeusDiscoveryConfig,
  payloadProvider?: AmadeusPayloadProvider
): ProviderAdapter {
  const searchStatus = getRealProviderCapabilityStatus(config);

  const profile: ProviderAdapterProfile = {
    id: AMADEUS_PROVIDER_ID,
    name: AMADEUS_PROVIDER_NAME,
    capabilities: [
      { capability: 'search-accommodation', status: searchStatus },
      { capability: 'retrieve-accommodation-details', status: 'unsupported' },
      { capability: 'verify-reference', status: 'unsupported' },
      { capability: 'retrieve-booking-status', status: 'unsupported' },
      { capability: 'retrieve-cancellation-information', status: 'unsupported' },
    ],
  };

  const source = { id: profile.id, name: profile.name };

  return {
    get profile() {
      return profile;
    },
    isOperational(capability: ProviderCapabilityId): boolean {
      return isAdapterCapabilityAvailable(profile, capability);
    },
    id(): string {
      return profile.id;
    },
    name(): string {
      return profile.name;
    },
    search(
      query: TripDiscoveryQuery,
      now: string
    ): ProviderExecutionResult<TripProviderResult[]> | null {
      if (!isAdapterCapabilityAvailable(profile, 'search-accommodation')) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'credentials-missing',
          'Amadeus discovery is not configured for this build.',
          now,
          'not-retryable',
          { limitations: [AMADEUS_RESULT_DISCLAIMER] }
        );
      }
      if (payloadProvider === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          AMADEUS_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [AMADEUS_RESULT_DISCLAIMER] }
        );
      }
      let payload: unknown | null;
      try {
        payload = payloadProvider(query, now);
      } catch {
        payload = null;
      }
      if (payload === null || payload === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          AMADEUS_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [AMADEUS_RESULT_DISCLAIMER] }
        );
      }
      const mapped = mapAmadeusHotelOffersResponse(payload, now);
      const boundedResults = query.limit === undefined ? mapped : mapped.slice(0, query.limit);
      return buildProviderExecutionSuccess('search', source, boundedResults, now, {
        limitations: [AMADEUS_RESULT_DISCLAIMER],
      });
    },
  };
}
