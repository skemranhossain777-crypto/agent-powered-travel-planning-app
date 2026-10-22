/**
 * Google Routes compute service (STEP 47) - bounded provider outcome entry.
 *
 * This is the read-only public entry point for a Google Routes Compute Routes
 * attempt. It composes the config gate, the mapping layer, and the adapter
 * into a single deterministic `GoogleRoutesComputeOutcome`. It does NOT reach
 * into the client UI, and no later step needs to modify this file for a
 * server-side execution layer to use the result.
 *
 * Contract rules:
 *
 * 1. **Default off, secret-free.** The browser default config is always
 *    disabled with no credentials, so the default outcome is the bounded
 *    `not-configured` state. A Google request is only composed after an
 *    explicitly `ready` config and does nothing that writes or mutates.
 * 2. **Bounded statuses.** Outcomes are exactly `success`, `provider-failure`,
 *    `invalid-input`, `not-configured`, and `unexpected-failure`. Each failure
 *    carries only a STEP 20 safe error.
 * 3. **No raw provider payloads.** The result is the provider-neutral
 *    `NormalizedRoute`; the raw Google JSON never appears in an outcome, and
 *    the API key never appears anywhere.
 * 4. **Transient and read-only.** A computed route is transient provider
 *    output — never persisted, never attached to a trip, never auto-mutating
 *    an itinerary. Persistence and AI reasoning are future explicit workflows.
 * 5. **Timestamp injected, not clocked.** `now` is always supplied by the
 *    caller so every test is deterministic and the module itself never reads a
 *    clock.
 *
 * No React, Firebase, Router, Zustand, network, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { NormalizedRoute } from '../../domain/routes/providerRoutes';
import type { GoogleRoutesPayloadProvider } from './googleRoutesAdapter';
import { createGoogleRoutesComputeAdapter } from './googleRoutesAdapter';
import type { GoogleRoutesConfig } from './googleRoutesConfig';
import {
  GOOGLE_ROUTES_CREDENTIALS_MISSING_MESSAGE,
  GOOGLE_ROUTES_PROVIDER_ID,
  GOOGLE_ROUTES_PROVIDER_NAME,
  getGoogleRoutesAttemptGate,
  googleRoutesCredentialsMissingError,
} from './googleRoutesConfig';
import type { GoogleRoutesRouteRequest } from './googleRoutesMapping';
import {
  GOOGLE_ROUTES_RESULT_DISCLAIMER,
  getGoogleRoutesRouteRequestProblem,
} from './googleRoutesMapping';

/** The bounded outcome a Google Routes compute attempt can end in. */
export type GoogleRoutesComputeOutcomeStatus =
  | 'success'
  | 'provider-failure'
  | 'invalid-input'
  | 'not-configured'
  | 'unexpected-failure';

/** The bounded, read-only outcome of one Google Routes compute attempt. */
export interface GoogleRoutesComputeOutcome {
  status: GoogleRoutesComputeOutcomeStatus;
  providerId: string;
  providerName: string;
  /** The validated request echoed so a later execution layer can reason on it. */
  request: GoogleRoutesRouteRequest;
  /** Normalized provider-neutral route present only on `success`. */
  route: NormalizedRoute | null;
  /** Bounded safe error present only on failure statuses. */
  error: ProviderSafeError | null;
  /** The injected attempt timestamp (deterministic in tests). */
  createdAt: string;
  /** Read-only disclaimer always present so consumers never mistake data for a booking. */
  limitations: string[];
  /** Provider-mandated warnings (e.g. the Beta note for WALK/BICYCLE routes). */
  warnings: string[];
}

/** Bounded outcome when the attempt is disabled at the default (no config, no keys). */
export function googleRoutesNotConfiguredOutcome(
  request: GoogleRoutesRouteRequest,
  now: string
): GoogleRoutesComputeOutcome {
  return {
    status: 'not-configured',
    providerId: GOOGLE_ROUTES_PROVIDER_ID,
    providerName: GOOGLE_ROUTES_PROVIDER_NAME,
    request,
    route: null,
    error: {
      category: 'provider-unavailable',
      message: 'Google Routes is disabled for this build.',
    },
    createdAt: now,
    limitations: [GOOGLE_ROUTES_RESULT_DISCLAIMER],
    warnings: [],
  };
}

/**
 * Runs one read-only Google Routes Compute Routes attempt under the bounded
 * outcome model. `payloadProvider` drives the adapter's payload seam (tests and
 * the future server-side execution layer feed real/payload-free sources through
 * it, so the entire path is proven offline). Never throws.
 */
export function runGoogleRoutesComputeOnline(
  config: GoogleRoutesConfig,
  request: GoogleRoutesRouteRequest,
  now: string,
  payloadProvider: GoogleRoutesPayloadProvider
): GoogleRoutesComputeOutcome {
  const gate = getGoogleRoutesAttemptGate(config);
  if (gate === 'disabled') return googleRoutesNotConfiguredOutcome(request, now);
  if (gate === 'credentials-missing') {
    return buildFailedOutcome('not-configured', request, now, googleRoutesCredentialsMissingError());
  }

  const inputProblem = getGoogleRoutesRouteRequestProblem(request);
  if (inputProblem !== null) {
    return buildFailedOutcome(
      'invalid-input',
      request,
      now,
      { category: 'invalid-input', message: inputProblem.message }
    );
  }

  const adapterOrNull = createGoogleRoutesComputeAdapter(config, payloadProvider);
  const result = adapterOrNull.compute(request, payloadProvider);
  if (!result.ok) {
    return buildFailedOutcome('provider-failure', request, now, result.error);
  }

  return {
    status: 'success',
    providerId: GOOGLE_ROUTES_PROVIDER_ID,
    providerName: GOOGLE_ROUTES_PROVIDER_NAME,
    request,
    route: result.route,
    error: null,
    createdAt: now,
    limitations: [GOOGLE_ROUTES_RESULT_DISCLAIMER],
    warnings: result.route.warnings ?? [],
  };
}

/**
 * A safe helper for the not-yet-wired path: an outcome whose attempt wasn't
 * even prepared, with credentials-missing honesty. Kept pure and offline so a
 * later execution layer has a single story for "not a real request".
 */
export function buildGoogleRoutesNotPreparedOutcome(
  request: GoogleRoutesRouteRequest,
  now: string
): GoogleRoutesComputeOutcome {
  const error = googleRoutesCredentialsMissingError();
  return buildFailedOutcome('not-configured', request, now, error);
}

/** Internal: builds a bounded failure outcome with a safe error only. */
function buildFailedOutcome(
  status: 'provider-failure' | 'invalid-input' | 'not-configured' | 'unexpected-failure',
  request: GoogleRoutesRouteRequest,
  now: string,
  error: ProviderSafeError
): GoogleRoutesComputeOutcome {
  return {
    status,
    providerId: GOOGLE_ROUTES_PROVIDER_ID,
    providerName: GOOGLE_ROUTES_PROVIDER_NAME,
    request,
    route: null,
    error,
    createdAt: now,
    limitations: [GOOGLE_ROUTES_RESULT_DISCLAIMER],
    warnings: [],
  };
}

export {
  GOOGLE_ROUTES_CREDENTIALS_MISSING_MESSAGE,
  GOOGLE_ROUTES_PROVIDER_ID,
  GOOGLE_ROUTES_PROVIDER_NAME,
};