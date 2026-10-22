/**
 * STEP 70 - capability-aware execution eligibility.
 *
 * This module is a pure calculation that answers one question, given a request
 * and a capability snapshot the caller already holds:
 *
 *   "Which providers currently *appear* to be able to support the capability
 *    this request needs, according to the server-reported snapshot?"
 *
 * It sits after the STEP 69 client and before any future execution planning:
 *
 *   TripPlanningExecutionRequest (STEP 56)  \
 *                                             >-> TripExecutionEligibility
 *   TripExecutionCapabilitySnapshot (STEP 69)/
 *
 * The single most important property is the one in the module name:
 * **eligibility is not execution.** A provider is reported eligible only when the
 * server explicitly listed the exact capability id the request requires. That
 * says nothing about inventory, availability, a booking, a reservation, a
 * payment, or whether execution ever runs. A caller that treats `eligible: true`
 * as "this will work" has misread the contract; the result deliberately carries
 * no such promise, and the next step in the architecture (planning) still owns
 * every decision about what to actually attempt.
 *
 * This is also deliberately **not** STEP 63. STEP 63 asks which of a
 * caller-supplied list of live provider *objects* supports a request, by calling
 * their own synchronous `supports` method. STEP 70 asks which providers the
 * *server-reported snapshot* says support a capability. Different questions,
 * different inputs, different failure modes; this module neither calls
 * `supports`, nor accepts providers, nor produces a plan, and it does not merge
 * the two responsibilities.
 *
 * ## Why the required capability is usually absent
 *
 * Every execution request in the codebase is identity-only. Step 56's
 * `TripPlanningExecutionRequest` is `{ id, kind, intentId }`; Step 58's dispatch
 * and Step 59's provider request add only their own derived ids. None of them
 * names a capability, and this step does not modify them.
 *
 * That is a deliberate, load-bearing fact rather than an oversight. A request
 * that does not say what it wants cannot be matched against a capability list,
 * so this module **fails closed** with `capability-unspecified` rather than
 * guessing. It specifically refuses to invent a capability from the mere
 * existence of a request: there is no `flight-booking`, `hotel-booking`,
 * `ticket-purchase`, or `payment` anywhere in the recognized vocabulary, and
 * inferring one from an intent id or a request kind would be fabrication. Booking
 * and payment are not Step 20 capabilities at all, and adding them here would
 * mean claiming a capability no provider can report.
 *
 * The capability therefore enters as an explicit, caller-supplied requirement
 * that must be a member of the closed Step 20 `PROVIDER_CAPABILITY_IDS`
 * vocabulary. An unrecognized or absent value is `capability-unspecified`, not a
 * silent default and not a near-miss match.
 *
 * ## Exact matching, in both directions
 *
 * A provider is eligible only if the snapshot lists the required capability id
 * *byte-for-byte identically*. There is no case folding, no trimming, no alias
 * table, no substring or prefix test, and no provider-name heuristic. So
 * `hotel-booking` never matches `hotel`, `Hotel-Booking`, `hotel_booking`, or
 * `hotel-booking-v2`; a capability the server did not report is simply not
 * there. This is why `capabilityIds.includes(required)` is written as-is and
 * never wrapped in a normalizing helper.
 *
 * Provider identities are matched the same way, using the existing execution
 * provider-identity rule (already-trimmed, non-empty, bounded by
 * `MAX_PROVIDER_ID_LENGTH`). A duplicate provider id in the snapshot is a
 * contradiction the client cannot resolve, so it fails the whole evaluation
 * rather than being deduplicated - deduplicating would silently pick a winner and
 * hide a contract violation.
 *
 * ## Order is information, not preference
 *
 * The returned `providerIds` preserve the server's order exactly. Nothing is
 * sorted, ranked, scored, deduplicated, or recommended. There is no "best"
 * provider in this module and no notion of provider quality; ranking is a
 * separate concern with a separate contract, and a capability snapshot is not
 * evidence of quality. This is eligibility, not recommendation.
 *
 * ## Purity
 *
 * No network, no `fetch`, no provider call, no URL construction, no credential
 * or token, no persistence, no clock, no randomness, no environment, no React,
 * no Router, no Zustand, no Firebase. The whole module is safe to run in a
 * browser, in a test, or in a function without changing its answer. The only
 * non-type imports are the Step 20 capability vocabulary and the shared provider
 * id bound, so the recognized capability set has exactly one definition in the
 * codebase and cannot drift from the server's view of it.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isProviderCapabilityId,
  PROVIDER_CAPABILITY_IDS,
  type ProviderCapabilityId,
} from '../../domain/providers/providerCapabilities';
import { isTripPlanningExecutionRequest } from '../../domain/trips/tripPlanningExecutionRequest';
import type { TripExecutionCapabilityStatus } from './tripExecutionCapabilityService';

/**
 * The closed, provider-neutral reason vocabulary for an eligibility result.
 *
 * Every value is a bounded token, never prose and never a server or provider
 * message. `eligible` is the only affirmative value, and it is reachable only
 * through the full valid-input path described in the module docs.
 *
 * Note the deliberate absence of a "no credentials" or "credentials missing"
 * reason: this module never sees a credential and must not report on one. The
 * server already reduced provider state to a bounded `reason` in the snapshot;
 * a provider that cannot serve the capability simply is not eligible, and
 * `no-eligible-provider` says exactly that without leaking provider internals.
 */
export const TRIP_EXECUTION_ELIGIBILITY_REASONS = [
  'eligible',
  'request-invalid',
  'capability-unspecified',
  'snapshot-missing',
  'snapshot-malformed',
  'provider-identity-invalid',
  'provider-identity-duplicate',
  'no-eligible-provider',
] as const;

/** The provider-neutral eligibility reason vocabulary. */
export type TripExecutionEligibilityReason =
  (typeof TRIP_EXECUTION_ELIGIBILITY_REASONS)[number];

/**
 * The pure result of one eligibility evaluation.
 *
 * Every field is a safe identity or a bounded token. There is no booking, no
 * payment, no inventory, no address, no credential, no provider message, and no
 * claim that execution was attempted, succeeded, or is possible.
 */
export interface TripExecutionEligibility {
  /** True only when every eligibility condition held; never true on partial input. */
  eligible: boolean;
  /**
   * The validated request id this result describes, or `null` when the request
   * was too malformed to expose one. A safe echo, never a repair.
   */
  requestId: string | null;
  /**
   * The capability that was required, when one was explicitly supplied and
   * recognized. `null` whenever the requirement was absent or unrecognized -
   * never a guessed default.
   */
  requiredCapabilityId: ProviderCapabilityId | null;
  /**
   * The eligible provider identities in exact server-reported order. Empty
   * whenever `eligible` is false. Never sorted, ranked, scored, or deduplicated.
   */
  providerIds: readonly string[];
  /**
   * The capability ids the eligible providers explicitly reported. This is the
   * single required capability when eligible, and empty otherwise. Carrying it
   * explicitly is what keeps the result a statement about *capability support*
   * rather than an implied claim that a booking or payment is possible.
   */
  capabilityIds: readonly string[];
  /** The bounded reason for this verdict. */
  reason: TripExecutionEligibilityReason;
}

/**
 * The inputs to one eligibility evaluation, as an explicit record so that a
 * caller cannot pass a value in the wrong position.
 *
 * `requiredCapabilityId` is a *requirement*, not a claim: it names what the
 * caller needs and is matched against what the server reported. It is validated
 * against the closed Step 20 vocabulary, so an arbitrary string - including a
 * plausible-looking `flight-booking` - is rejected rather than searched for. No
 * provider URL, credential, token, or configuration is accepted anywhere here.
 */
export interface TripExecutionEligibilityInput {
  /** The STEP 56 execution request being evaluated. Validated, never repaired. */
  request: unknown;
  /** The STEP 69 snapshot, or `null`/absent when no snapshot was obtained. */
  snapshot: unknown;
  /**
   * The capability the request requires. Must be an exact member of
   * `PROVIDER_CAPABILITY_IDS`; anything else yields `capability-unspecified`.
   */
  requiredCapabilityId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The existing execution provider-identity rule, restated so this module does
 * not depend on a private helper: non-empty, already-trimmed, and bounded.
 * Deliberately no case folding and no character filtering: a provider id is an
 * exact key, and the Step 20 vocabulary plus the server's own validation already
 * constrain its shape.
 */
function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

function isCapabilityStatus(value: unknown): value is TripExecutionCapabilityStatus {
  return value === 'available' || value === 'unavailable' || value === 'unsupported';
}

/** The bounded STEP 69 problem tokens, restated for snapshot re-validation. */
const KNOWN_PROBLEMS: ReadonlyArray<string> = Object.freeze([
  'unsupported-method',
  'unexpected-body',
  'unexpected-failure',
]);

/** The bounded STEP 69 provider-reason tokens, restated for re-validation. */
const KNOWN_REASONS: ReadonlyArray<string> = Object.freeze([
  'execution-disabled',
  'credentials-missing',
  'no-executable-capability',
  'malformed-provider-capability',
  'unexpected-failure',
]);

function ineligible(
  reason: TripExecutionEligibilityReason,
  requestId: string | null,
  requiredCapabilityId: ProviderCapabilityId | null
): TripExecutionEligibility {
  return {
    eligible: false,
    requestId,
    requiredCapabilityId,
    providerIds: [],
    capabilityIds: [],
    reason,
  };
}

/**
 * Validates the snapshot the caller supplied, reusing the Step 69 vocabulary
 * without importing that module's internals. Returns the ordered provider
 * entries, or `null` when the snapshot is malformed.
 *
 * This re-validation is intentional. The snapshot is treated as untrusted
 * input even though Step 69 validated it on the way in: a caller may have
 * assembled it from somewhere else, and an eligibility claim must rest only on
 * a snapshot that still satisfies the contract. `problem` is checked as a known
 * token when present, because a snapshot that reports a problem is not a
 * statement about which providers support what.
 */
function readSnapshotProviders(
  snapshot: unknown
): ReadonlyArray<{ providerId: string; status: TripExecutionCapabilityStatus; capabilityIds: readonly string[] }> | null {
  if (!isRecord(snapshot)) return null;
  if (!Array.isArray(snapshot.providers)) return null;

  const rawProviders = snapshot.providers;
  const providers: Array<{ providerId: string; status: TripExecutionCapabilityStatus; capabilityIds: readonly string[] }> = [];

  for (const entry of rawProviders) {
    if (!isRecord(entry)) return null;
    if (!isSafeProviderId(entry.providerId)) return null;
    if (!isCapabilityStatus(entry.status)) return null;

    const rawIds = entry.capabilityIds;
    if (!Array.isArray(rawIds)) return null;
    // Every reported id must be a recognized capability. A snapshot that names
    // something outside the vocabulary is malformed, not a provider that
    // supports something exotic.
    for (const id of rawIds) {
      if (!isProviderCapabilityId(id)) return null;
    }

    // The provider's own reason must be consistent with its status. An
    // `available` entry that still carries a non-executable reason is a
    // contradiction, and trusting its capability list on the strength of the
    // status alone would be exactly the partial trust this module refuses.
    const reason = entry.reason;
    if (reason !== null && reason !== undefined) {
      if (typeof reason !== 'string') return null;
      if (!KNOWN_REASONS.includes(reason)) return null;
      if (entry.status === 'available') return null;
    }
    if (entry.status !== 'available' && (reason === null || reason === undefined)) {
      return null;
    }

    providers.push({
      providerId: entry.providerId,
      status: entry.status,
      capabilityIds: rawIds as readonly string[],
    });
  }

  if (snapshot.problem !== null && snapshot.problem !== undefined) {
    if (typeof snapshot.problem !== 'string') return null;
    if (!KNOWN_PROBLEMS.includes(snapshot.problem)) return null;
  }

  return providers;
}

/**
 * The pure, synchronous eligibility evaluation.
 *
 * The order of checks is the fail-closed contract, and it is intentionally
 * ordered from "is this input usable at all" to "does anything match":
 *
 * 1. the request must be a valid STEP 56 execution request
 * 2. a snapshot must be present at all
 * 3. the snapshot must be structurally valid
 * 4. the required capability must be explicitly supplied and recognized
 * 5. every provider identity must be valid
 * 6. no provider id may repeat
 * 7. at least one provider must explicitly report the exact capability
 *
 * Only after all seven hold is `eligible: true` returned. Anything else returns
 * `eligible: false` with an empty provider list, so a partially-trusted snapshot
 * can never present itself as a partial success.
 *
 * The function never throws for untrusted input, never mutates its arguments,
 * never calls a provider, never performs I/O, and never consults a clock.
 */
export function evaluateTripExecutionEligibility(
  input: TripExecutionEligibilityInput
): TripExecutionEligibility {
  if (!isRecord(input)) {
    return ineligible('request-invalid', null, null);
  }

  const { request, snapshot } = input;

  // 1. The request is validated with the STEP 56 validator and never repaired.
  if (!isTripPlanningExecutionRequest(request)) {
    return ineligible('request-invalid', null, null);
  }
  const requestId = request.id;

  // 2. A missing snapshot is not an empty capability set; it is an absent
  //    answer, and it must not be read as "nothing can run".
  if (snapshot === null || snapshot === undefined) {
    return ineligible('snapshot-missing', requestId, null);
  }

  // 3. A malformed snapshot fails closed rather than being partially trusted.
  const providers = readSnapshotProviders(snapshot);
  if (providers === null) {
    return ineligible('snapshot-malformed', requestId, null);
  }

  // 4. The required capability must be explicit and recognized. No execution
  //    request names a capability, so this is the ordinary path for a bare
  //    request - and it fails closed rather than guessing a booking or payment.
  const required = input.requiredCapabilityId;
  if (!isProviderCapabilityId(required)) {
    return ineligible('capability-unspecified', requestId, null);
  }

  // 5. Every provider identity in the snapshot must be valid. An unusable
  //    identity invalidates the snapshot rather than being skipped, because a
  //    skipped entry could have been the one that would have matched.
  for (const provider of providers) {
    if (!isSafeProviderId(provider.providerId)) {
      return ineligible('provider-identity-invalid', requestId, required);
    }
  }

  // 6. A repeated provider id is a contradiction. Deduplicating would silently
  //    choose a winner and conceal it, so the whole evaluation fails instead.
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.providerId)) {
      return ineligible('provider-identity-duplicate', requestId, required);
    }
    seen.add(provider.providerId);
  }

  // 7. Exact, byte-for-byte capability match, in server-reported order. Only an
  //    `available` provider that explicitly listed the required id is eligible;
  //    an empty list is the valid "nothing supports this" answer.
  const providerIds: string[] = [];
  for (const provider of providers) {
    if (provider.status !== 'available') continue;
    if (!provider.capabilityIds.includes(required)) continue;
    providerIds.push(provider.providerId);
  }

  if (providerIds.length === 0) {
    return ineligible('no-eligible-provider', requestId, required);
  }

  return {
    eligible: true,
    requestId,
    requiredCapabilityId: required,
    providerIds,
    capabilityIds: [required],
    reason: 'eligible',
  };
}

/**
 * The recognized capability ids, re-exported so a caller can read the closed
 * vocabulary from the eligibility module without importing the provider domain
 * directly. The array is the same frozen list, not a copy with its own rules.
 */
export { PROVIDER_CAPABILITY_IDS };
