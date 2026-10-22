/**
 * Google Routes compute adapter factory (STEP 47).
 *
 * Translates Google Routes `computeRoutes` payloads into the shared
 * provider-neutral `NormalizedRoute` contract. It is a *factory* (not a
 * singleton) because real-provider readiness depends on the injected config:
 * the browser default is always `attemptEnabled: false`, so the very same
 * source produces either a safe, honest non-operational adapter or a
 * fully-keyed one with zero app code changes between builds.
 *
 * Contract rules:
 *
 * 1. **Envelope-faithful.** `compute` is the single executed operation and
 *    stays read-only; it returns a normalized `NormalizedRoute` on success or
 *    a bounded STEP 20 safe error otherwise. Nothing books, pays, navigates,
 *    or persists.
 * 2. **Gate-derived readiness.** `isOperational()` is true only in the `ready`
 *    gate state; otherwise `compute` reports a bounded `credentials-missing`
 *    failure without ever touching a payload or network.
 * 3. **Payload source is injected and deterministic.** `compute` maps whatever
 *    payload the caller-supplied `payloadProvider` yields; tests (and a future
 *    server path) feed fixture payloads through this seam so the entire success
 *    path is proven offline with no network. A missing or failing payload
 *    source is a bounded `provider-unavailable`, never a throw.
 * 4. **Beta-mode honesty.** WALK and BICYCLE routes carry the documented
 *    Google Beta warning so the presentation layer can surface it.
 * 5. **Secrets never appear in results.** The normalized route carries only
 *    provider id/name and application-owned fields; the API key stays in
 *    config/connection, never in a result.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { NormalizedRoute } from '../../domain/routes/providerRoutes';
import type { GoogleRoutesConfig } from './googleRoutesConfig';
import {
  GOOGLE_ROUTES_PROVIDER_ID,
  GOOGLE_ROUTES_PROVIDER_NAME,
  isGoogleRoutesReady,
} from './googleRoutesConfig';
import type { GoogleRoutesRouteRequest } from './googleRoutesMapping';
import {
  GOOGLE_ROUTES_RESULT_DISCLAIMER,
  getGoogleRoutesModeWarnings,
  getGoogleRoutesRouteRequestProblem,
  mapGoogleRoutesComputeRoutesResponse,
} from './googleRoutesMapping';

/** Supplies the raw Google Routes payload for a request; `null` when none is available. */
export type GoogleRoutesPayloadProvider = (request: GoogleRoutesRouteRequest) => unknown | null;

/** The stable message used when a payload cannot be produced (never a raw payload). */
export const GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE =
  'The Google Routes payload source is not available for this build.';

/** Bounded result of one adapter `compute` operation. */
export type GoogleRoutesAdapterComputeResult =
  | { ok: true; route: NormalizedRoute }
  | { ok: false; error: ProviderSafeError };

/** The application-facing shape of the Google Routes adapter. */
export interface GoogleRoutesAdapter {
  /** True only when the config gate is `ready` (a real request may run). */
  isOperational(): boolean;
  id(): string;
  name(): string;
  /** The single read-only compute operation; payload comes from the injected provider. */
  compute(
    request: GoogleRoutesRouteRequest,
    payloadProvider: GoogleRoutesPayloadProvider
  ): GoogleRoutesAdapterComputeResult;
}

/**
 * Creates a boundary-conforming Google Routes compute adapter for `config`.
 * The optional `payloadProvider` lets callers and tests drive the success path
 * offline; without one, an operationally-ready adapter reports a bounded
 * provider failure when its operation is actually invoked.
 */
export function createGoogleRoutesComputeAdapter(
  config: GoogleRoutesConfig,
  payloadProvider?: GoogleRoutesPayloadProvider
): GoogleRoutesAdapter {
  const ready = isGoogleRoutesReady(config);

  return {
    isOperational(): boolean {
      return ready;
    },
    id(): string {
      return GOOGLE_ROUTES_PROVIDER_ID;
    },
    name(): string {
      return GOOGLE_ROUTES_PROVIDER_NAME;
    },
    compute(
      request: GoogleRoutesRouteRequest,
      provider: GoogleRoutesPayloadProvider
    ): GoogleRoutesAdapterComputeResult {
      if (!ready) {
        return {
          ok: false,
          error: {
            category: 'credentials-missing',
            message: 'Google Routes compute is not configured for this build.',
          },
        };
      }
      const problem = getGoogleRoutesRouteRequestProblem(request);
      if (problem !== null) {
        return {
          ok: false,
          error: { category: 'invalid-input', message: problem.message },
        };
      }
      const effectiveProvider = provider ?? payloadProvider;
      if (effectiveProvider === undefined) {
        return {
          ok: false,
          error: {
            category: 'provider-unavailable',
            message: GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          },
        };
      }
      let payload: unknown | null;
      try {
        payload = effectiveProvider(request);
      } catch {
        payload = null;
      }
      if (payload === null || payload === undefined) {
        return {
          ok: false,
          error: {
            category: 'provider-unavailable',
            message: GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE,
          },
        };
      }
      const route = mapGoogleRoutesComputeRoutesResponse(payload, request);
      if (route === null) {
        return {
          ok: false,
          error: {
            category: 'malformed-response',
            message: 'The Google Routes payload could not be normalized.',
          },
        };
      }
      const modeWarnings = getGoogleRoutesModeWarnings(request.travelMode);
      if (modeWarnings.length > 0) {
        route.warnings = [...modeWarnings, ...(route.warnings ?? [])];
      }
      return { ok: true, route };
    },
  };
}

export { GOOGLE_ROUTES_RESULT_DISCLAIMER };