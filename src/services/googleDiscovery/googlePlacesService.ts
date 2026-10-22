/**
 * Google Places discovery service (STEP 44) - bounded provider outcome entry.
 *
 * This is the read-only public entry point for a Google Places discovery
 * attempt UNDER THE NEW BOUNDED DISCOVERY MODEL. It composes the config gate,
 * the mapping layer, and the adapter into a single deterministic
 * `GooglePlacesDiscoveryOutcome` and stays at the very same service layer as
 * the STEP 41 real-discovery service — it does NOT reach into the client UI,
 * and no later step needs to modify this file for the web agent/proxy to use
 * the discovery result.
 *
 * Contract rules:
 *
 * 1. **Default off, secret-free.** The browser default config is always
 *    disabled with no credentials, so the default outcome is the bounded
 *    `not-configured` state. A Google request is only composed after an
 *    explicitly `ready` config and does nothing that writes or mutates.
 * 2. **Bounded statuses.** Outcomes are exactly `success`, `empty` (a valid,
 *    mapped payload with no results — reported honestly, never faked),
 *    `provider-failure`, `invalid-input`, `not-configured`, and
 *    `unexpected-failure`. Each failure carries only a STEP 20 safe error.
 * 3. **No raw provider payloads.** Results are the normalized application
 *    contract `TripProviderResult[]`; the raw Google JSON never appears in an
 *    outcome, and the API key never appears anywhere.
 * 4. **Timestamp injected, not clocked.** `now` is always supplied by the
 *    caller so every test is deterministic and the module itself never reads a
 *    clock.
 *
 * No React, Firebase, Router, Zustand, network, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type {
  GooglePlacesPayloadProvider,
  GooglePlacesPlaceDetailPayloadProvider,
} from './googlePlacesAdapter';
import { createGooglePlacesDiscoveryAdapter } from './googlePlacesAdapter';
import type { GooglePlacesDiscoveryConfig } from './googlePlacesConfig';
import {
  GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE,
  GOOGLE_PLACES_PROVIDER_ID,
  GOOGLE_PLACES_PROVIDER_NAME,
  getGooglePlacesAttemptGate,
  googlePlacesCredentialsMissingError,
} from './googlePlacesConfig';
import type { GooglePlacesNearbyQuery } from './googlePlacesMapping';
import type { GooglePlacesPlaceDetail } from './googlePlacesMapping';
import {
  GOOGLE_PLACES_RESULT_DISCLAIMER,
  getGooglePlacesNearbyQueryProblem,
  getGooglePlacesPlaceIdProblem,
  normalizeGooglePlacesPlaceId,
} from './googlePlacesMapping';

/** The bounded outcome a Google Places discovery attempt can end in. */
export type GooglePlacesDiscoveryOutcomeStatus =
  | 'success'
  | 'empty'
  | 'provider-failure'
  | 'invalid-input'
  | 'not-configured'
  | 'unexpected-failure';

/** The bounded, read-only outcome of one Google Places discovery attempt. */
export interface GooglePlacesDiscoveryOutcome {
  status: GooglePlacesDiscoveryOutcomeStatus;
  providerId: string;
  providerName: string;
  /** Normalized application results present only on `success`. */
  results: TripProviderResult[];
  /** The validated query echoed so a later execution layer can reason on it. */
  query: GooglePlacesNearbyQuery;
  /** Bounded safe error present only on failure statuses. */
  error: ProviderSafeError | null;
  /** The injected attempt timestamp (deterministic in tests). */
  createdAt: string;
  /** Read-only disclaimer always present so consumers never mistake data for a booking. */
  limitations: string[];
}

/** Bounded outcome when the attempt is disabled at the default (no config, no keys). */
export function googlePlacesNotConfiguredOutcome(
  query: GooglePlacesNearbyQuery,
  now: string
): GooglePlacesDiscoveryOutcome {
  return {
    status: 'not-configured',
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    results: [],
    query,
    error: {
      category: 'provider-unavailable',
      message: 'Google Places discovery is disabled for this build.',
    },
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

/**
 * Runs one read-only Google Places discovery attempt under the bounded outcome
 * model. `payloadProvider` drives the adapter's payload seam (tests and the
 * future server-side execution layer feed real/payload-free sources through it,
 * so the entire path is proven offline). Never throws.
 */
export function runGooglePlacesDiscoveryOnline(
  config: GooglePlacesDiscoveryConfig,
  query: GooglePlacesNearbyQuery,
  now: string,
  payloadProvider: GooglePlacesPayloadProvider
): GooglePlacesDiscoveryOutcome {
  const gate = getGooglePlacesAttemptGate(config);
  if (gate === 'disabled') return googlePlacesNotConfiguredOutcome(query, now);
  if (gate === 'credentials-missing') {
    return buildFailedOutcome('not-configured', query, now, googlePlacesCredentialsMissingError());
  }

  const inputProblem = getGooglePlacesNearbyQueryProblem(query);
  if (inputProblem !== null) {
    return buildFailedOutcome(
      'invalid-input',
      query,
      now,
      { category: 'invalid-input', message: inputProblem.message }
    );
  }

  const adapterOrNull = createGooglePlacesDiscoveryAdapter(config, payloadProvider);
  if (adapterOrNull === null) {
    return buildFailedOutcome(
      'unexpected-failure',
      query,
      now,
      { category: 'unknown', message: 'Google Places adapter could not be composed.' }
    );
  }
  const envelope = adapterOrNull.search(query, now, payloadProvider);
  if (envelope === null) {
    return buildFailedOutcome(
      'unexpected-failure',
      query,
      now,
      { category: 'unknown', message: 'Google Places adapter returned no result.' }
    );
  }

  if (envelope.status === 'failure') {
    const error =
      envelope.error ??
      ({ category: 'provider-rejected', message: 'Google Places search failed.' } as ProviderSafeError);
    return buildFailedOutcome('provider-failure', query, now, error);
  }

  const results = Array.isArray(envelope.data) ? envelope.data : [];
  if (results.length === 0) {
    return buildEmptyOutcome(query, now);
  }

  return {
    status: 'success',
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    results,
    query,
    error: null,
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

/**
 * A safe helper for the not-yet-wired path: an outcome whose attempt wasn't
 * even prepared, with credentials-missing honesty. Kept pure and offline so a
 * later execution layer has a single story for "not a real request".
 */
export function buildGooglePlacesNotPreparedOutcome(
  query: GooglePlacesNearbyQuery,
  now: string
): GooglePlacesDiscoveryOutcome {
  const error = googlePlacesCredentialsMissingError();
  return buildFailedOutcome('not-configured', query, now, error);
}

/**
 * Maps a google-safe error (or a raw failure) into a bounded outcome. The
 * safe-error passthrough keeps any legacy envelope's bounded-error contract
 * without letting raw provider payloads into the outcome.
 */
export function googlePlacesSafeErrorToOutcome(
  error: ProviderSafeError,
  query: GooglePlacesNearbyQuery,
  now: string
): GooglePlacesDiscoveryOutcome {
  return buildFailedOutcome('provider-failure', query, now, error);
}

/** True only for `success` and `empty` outcomes (a Google attempt produced a kept result). */
export function isGooglePlacesDiscoveryAvailable(
  outcome: GooglePlacesDiscoveryOutcome
): boolean {
  return outcome.status === 'success' || outcome.status === 'empty';
}

/** Coarse accommodation/place usability flag for a bounded outcome. */
export function hasGooglePlacesDiscoveryResults(
  outcome: GooglePlacesDiscoveryOutcome
): boolean {
  return outcome.status === 'success' && outcome.results.length > 0;
}

// ---------------------------------------------------------------------------
// STEP 45 - Place Details (read-only retrieval) under the same bounded model.
// ---------------------------------------------------------------------------

/** The bounded, read-only outcome of one Google Places Place Details attempt. */
export interface GooglePlacesPlaceDetailOutcome {
  status: GooglePlacesDiscoveryOutcomeStatus;
  providerId: string;
  providerName: string;
  /** The validated Place ID (normalized/bounded), or '' when the input was not valid. */
  placeId: string;
  /** Normalized application detail present only on `success`. */
  detail: GooglePlacesPlaceDetail | null;
  /** Bounded safe error present only on failure statuses. */
  error: ProviderSafeError | null;
  /** The injected attempt timestamp (deterministic in tests). */
  createdAt: string;
  /** Read-only disclaimer always present. */
  limitations: string[];
}

/**
 * Runs one read-only Google Places Place Details attempt (STEP 45) for a Place
 * ID under the same bounded outcome model as discovery: disabled config yields
 * `not-configured`, an unsafe input yields `invalid-input`, payload/mapping
 * problems yield `provider-failure`, and a normalized result yields `success`.
 * `payloadProvider` drives the adapter's seam so the whole path is proven
 * offline. Never throws.
 */
export function runGooglePlacesPlaceDetailsOnline(
  config: GooglePlacesDiscoveryConfig,
  placeId: string,
  now: string,
  payloadProvider: GooglePlacesPlaceDetailPayloadProvider
): GooglePlacesPlaceDetailOutcome {
  const gate = getGooglePlacesAttemptGate(config);
  if (gate === 'disabled') {
    return buildDetailFailedOutcome('not-configured', placeId, now, {
      category: 'provider-unavailable',
      message: 'Google Places details are disabled for this build.',
    });
  }
  if (gate === 'credentials-missing') {
    return buildDetailFailedOutcome('not-configured', placeId, now, googlePlacesCredentialsMissingError());
  }

  const problem = getGooglePlacesPlaceIdProblem(placeId);
  if (problem !== null) {
    return buildDetailFailedOutcome('invalid-input', placeId, now, {
      category: 'invalid-input',
      message: problem.message,
    });
  }

  const adapterOrNull = createGooglePlacesDiscoveryAdapter(config, undefined, payloadProvider);
  if (adapterOrNull === null) {
    return buildDetailFailedOutcome(
      'unexpected-failure',
      placeId,
      now,
      { category: 'unknown', message: 'Google Places adapter could not be composed.' }
    );
  }
  const envelope = adapterOrNull.details(placeId, now, payloadProvider);
  if (envelope === null) {
    return buildDetailFailedOutcome(
      'unexpected-failure',
      placeId,
      now,
      { category: 'unknown', message: 'Google Places adapter returned no result.' }
    );
  }

  if (envelope.status === 'failure') {
    const error =
      envelope.error ??
      ({ category: 'provider-rejected', message: 'Google Places details failed.' } as ProviderSafeError);
    return buildDetailFailedOutcome('provider-failure', placeId, now, error);
  }

  const detail = envelope.data ?? null;
  if (detail === null) {
    return buildDetailFailedOutcome('provider-failure', placeId, now, {
      category: 'malformed-response',
      message: 'The Google Places place detail could not be normalized.',
    });
  }

  return {
    status: 'success',
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    placeId: normalizeGooglePlacesPlaceId(placeId) ?? '',
    detail,
    error: null,
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

/** True only for a delivered Place Detail (status `success`). */
export function isGooglePlacesPlaceDetailAvailable(
  outcome: GooglePlacesPlaceDetailOutcome
): boolean {
  return outcome.status === 'success';
}

/** True when a bounded outcome actually carries a normalized detail object. */
export function hasGooglePlacesPlaceDetail(
  outcome: GooglePlacesPlaceDetailOutcome
): boolean {
  return outcome.status === 'success' && outcome.detail !== null;
}

/** Internal: builds a bounded Place Details failure outcome with a safe error only. */
function buildDetailFailedOutcome(
  status: 'provider-failure' | 'invalid-input' | 'not-configured' | 'unexpected-failure',
  placeId: string,
  now: string,
  error: ProviderSafeError
): GooglePlacesPlaceDetailOutcome {
  return {
    status,
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    placeId: normalizeGooglePlacesPlaceId(placeId) ?? '',
    detail: null,
    error,
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

/** Internal: builds a bounded failure outcome with a safe error only. */
function buildFailedOutcome(
  status: 'provider-failure' | 'invalid-input' | 'not-configured' | 'unexpected-failure',
  query: GooglePlacesNearbyQuery,
  now: string,
  error: ProviderSafeError
): GooglePlacesDiscoveryOutcome {
  return {
    status,
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    results: [],
    query,
    error,
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

/** Internal: bounded empty outcome (valid attempt, no usable results). */
function buildEmptyOutcome(query: GooglePlacesNearbyQuery, now: string): GooglePlacesDiscoveryOutcome {
  return {
    status: 'empty',
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    results: [],
    query,
    error: null,
    createdAt: now,
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };
}

export {
  GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE,
  GOOGLE_PLACES_PROVIDER_ID,
  GOOGLE_PLACES_PROVIDER_NAME,
};