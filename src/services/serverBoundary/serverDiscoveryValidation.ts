/**
 * Strict server-side discovery request validation (STEP 42).
 *
 * The server never trusts browser-supplied values just because the UI normally
 * generates them. Before any provider code runs, the raw request body must be a
 * well-formed discovery query per the existing STEP 21 boundary:
 *
 * - Exactly the known query keys are accepted; any other key (a provider id,
 *   a URL, headers, an endpoint, credentials, a token, ...) rejects the whole
 *   request — the endpoint can never become a generic HTTP proxy.
 * - String lengths are bounded (destination ≤120, origin ≤120, currency ≤8);
 * - dates must be real ISO calendar dates with `endDate` not before `startDate`
 *   and `endDate` only valid together with `startDate`;
 * - `travelerCount` must be a whole number within 1..50 and `limit` within
 *   1..MAX_DISCOVERY_RESULT_LIMIT (25);
 * - `category` must be one of the two discovery categories.
 *
 * The server constructs the provider request from this validated, normalized
 * query alone — unvalidated input never reaches an Amadeus URL.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

import type {
  TripDiscoveryQuery,
  TripDiscoveryQueryProblem,
} from '../../domain/providers/discoveryInput';
import {
  getTripDiscoveryQueryProblem,
  normalizeTripDiscoveryQuery,
} from '../../domain/providers/discoveryInput';

/** Re-exported so the host can reference the bounds without re-importing. */
export { MAX_DISCOVERY_RESULT_LIMIT } from '../../domain/providers/discoveryInput';

/** The result of strict request validation. */
export type ServerDiscoveryValidationResult =
  { ok: true; query: TripDiscoveryQuery } | { ok: false; problem: TripDiscoveryQueryProblem };

/**
 * Validates an untrusted discovery request body server-side. Returns the
 * normalized query or the first bounded validation problem. Never throws; the
 * provider is never invoked when the result is not `ok`.
 */
export function validateServerDiscoveryRequest(raw: unknown): ServerDiscoveryValidationResult {
  const query = normalizeTripDiscoveryQuery(raw);
  if (query !== null) return { ok: true, query };

  // `normalizeTripDiscoveryQuery` and `getTripDiscoveryQueryProblem` share one
  // deterministic analyzer, so a null query always carries a non-null problem.
  return {
    ok: false,
    problem: getTripDiscoveryQueryProblem(raw) as TripDiscoveryQueryProblem,
  };
}
