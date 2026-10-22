/**
 * Google Places discovery adapter factory (STEP 44).
 *
 * Translates Google Places Nearby Search payloads into the normalized
 * application execution envelope (the STEP 20 `ProviderExecutionResult`
 * vocabulary) exactly like the STEP 41 Amadeus adapter does on its side. It is
 * a *factory* (not a singleton) because real-provider readiness depends on the
 * injected config: the browser default is always `attemptEnabled: false`, so
 * the very same source produces either a safe, honest non-operational adapter
 * or a fully-keyed one with zero app code changes between builds.
 *
 * Contract rules:
 *
 * 1. **Envelope-faithful.** `search` is the single executed operation and stays
 *    read-only; it returns a normalized envelope holding `TripProviderResult[]`
 *    on success or a bounded STEP 20 safe error otherwise. Nothing books, pays,
 *    verifies, or persists.
 * 2. **Gate-derived readiness.** `isOperational()` is true only in the `ready`
 *    gate state; otherwise `search` reports a bounded `credentials-missing`
 *    failure without ever touching a payload or network.
 * 3. **Payload source is injected and deterministic.** `search` maps whatever
 *    payload the caller-supplied `payloadProvider` yields; tests (and a future
 *    server path) feed fixture payloads through this seam so the entire success
 *    path is proven offline with no network. A missing or failing payload
 *    source is a bounded `provider-unavailable`, never a throw.
 * 4. **Secrets never appear in envelopes.** The normalized result carries only
 *    provider id/name/resultId and user-visible fields; the API key stays in
 *    config/connection, never in a result.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  buildProviderExecutionFailure,
  buildProviderExecutionSuccess,
  type ProviderExecutionResult,
} from '../../domain/providers/executionOperations';
import type { ProviderAdapterProfile } from '../../domain/providers/providerAdapter';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type { GooglePlacesDiscoveryConfig } from './googlePlacesConfig';
import {
  GOOGLE_PLACES_PROVIDER_ID,
  GOOGLE_PLACES_PROVIDER_NAME,
  isGooglePlacesReady,
} from './googlePlacesConfig';
import type { GooglePlacesNearbyQuery } from './googlePlacesMapping';
import type { GooglePlacesPlaceDetail } from './googlePlacesMapping';
import {
  GOOGLE_PLACES_RESULT_DISCLAIMER,
  mapGooglePlacesNearbyResponse,
  normalizeGooglePlacesPlaceDetail,
  normalizeGooglePlacesPlaceId,
} from './googlePlacesMapping';

/** Supplies the raw Google Places payload for a query; returns `null` when none is available. */
export type GooglePlacesPayloadProvider = (
  query: GooglePlacesNearbyQuery,
  now: string
) => unknown | null;

/** Supplies the raw Google Places detail payload for a Place ID; `null` when none is available. */
export type GooglePlacesPlaceDetailPayloadProvider = (
  placeId: string,
  now: string
) => unknown | null;

/** The stable message used when a payload cannot be produced (never a raw payload). */
export const GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE =
  'The Google Places payload source is not available for this build.';

/** The application-facing shape of the Google Places adapter. */
export interface GooglePlacesAdapter {
  readonly profile: ProviderAdapterProfile;
  /** True only when the config gate is `ready` (a real request may run). */
  isOperational(): boolean;
  id(): string;
  name(): string;
  /** The single read-only discovery operation; payload comes from the injected provider. */
  search(
    query: GooglePlacesNearbyQuery,
    now: string,
    payloadProvider: GooglePlacesPayloadProvider
  ): ProviderExecutionResult<TripProviderResult[]> | null;
  /** The read-only Place Details operation (STEP 45); payload comes from the injected provider. */
  details(
    placeId: string,
    now: string,
    payloadProvider: GooglePlacesPlaceDetailPayloadProvider
  ): ProviderExecutionResult<GooglePlacesPlaceDetail> | null;
}

/**
 * Creates a boundary-conforming Google Places discovery adapter for `config`.
 * The optional `payloadProvider`/`detailsPayloadProvider` let callers and tests
 * drive the success path offline; without one, an operationally-ready adapter
 * reports a bounded provider failure when its operation is actually invoked.
 * The adapter profile carries no accommodation/transport capability because
 * Google Places is a place-discovery provider, not a booking-capable inventory
 * provider.
 */
export function createGooglePlacesDiscoveryAdapter(
  config: GooglePlacesDiscoveryConfig,
  payloadProvider?: GooglePlacesPayloadProvider,
  detailsPayloadProvider?: GooglePlacesPlaceDetailPayloadProvider
): GooglePlacesAdapter {
  const ready = isGooglePlacesReady(config);

  const profile: ProviderAdapterProfile = {
    id: GOOGLE_PLACES_PROVIDER_ID,
    name: GOOGLE_PLACES_PROVIDER_NAME,
    capabilities: [],
  };

  const source = { id: GOOGLE_PLACES_PROVIDER_ID, name: GOOGLE_PLACES_PROVIDER_NAME };

  return {
    get profile() {
      return profile;
    },
    isOperational(): boolean {
      return ready;
    },
    id(): string {
      return GOOGLE_PLACES_PROVIDER_ID;
    },
    name(): string {
      return GOOGLE_PLACES_PROVIDER_NAME;
    },
    search(
      query: GooglePlacesNearbyQuery,
      now: string,
      provider: GooglePlacesPayloadProvider
    ): ProviderExecutionResult<TripProviderResult[]> | null {
      if (!ready) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'credentials-missing',
          'Google Places discovery is not configured for this build.',
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      const effectiveProvider = provider ?? payloadProvider;
      if (effectiveProvider === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      let payload: unknown | null;
      try {
        payload = effectiveProvider(query, now);
      } catch {
        payload = null;
      }
      if (payload === null || payload === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      const mapped = mapGooglePlacesNearbyResponse(payload, query, now);
      const boundedResults = mapped.slice(0, query.resultLimit);
      return buildProviderExecutionSuccess('search', source, boundedResults, now, {
        limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
      });
    },
    details(
      placeId: string,
      now: string,
      provider: GooglePlacesPlaceDetailPayloadProvider
    ): ProviderExecutionResult<GooglePlacesPlaceDetail> | null {
      if (!ready) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'credentials-missing',
          'Google Places details are not configured for this build.',
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      const normalized = normalizeGooglePlacesPlaceId(placeId);
      if (normalized === null) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'invalid-input',
          'The Google Places place id is not valid.',
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      const effectiveProvider = provider ?? detailsPayloadProvider;
      if (effectiveProvider === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      let payload: unknown | null;
      try {
        payload = effectiveProvider(normalized, now);
      } catch {
        payload = null;
      }
      if (payload === null || payload === undefined) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'provider-unavailable',
          GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      const detail = normalizeGooglePlacesPlaceDetail(payload, now);
      if (detail === null) {
        return buildProviderExecutionFailure(
          'search',
          source,
          'malformed-response',
          'The Google Places place detail could not be normalized.',
          now,
          'not-retryable',
          { limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER] }
        );
      }
      return buildProviderExecutionSuccess('search', source, detail, now, {
        limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
      });
    },
  };
}