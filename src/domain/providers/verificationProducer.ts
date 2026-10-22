/**
 * Pure, provider-independent verification-producer boundary contract (STEP 20).
 *
 * STEP 19 reserved the `externally-verified` and `provider-confirmed`
 * verification states for a future provider-backed producer and defined the
 * evidence requirement (`describeProducerEvidenceRequirement`). This module is
 * that producer's calling contract: the shape a producer must return when it
 * verifies something, and the gates that keep verification honest.
 *
 * Contract rules:
 *
 * 1. A producer result has exactly one `outcome`. Only the outcomes that mint a
 *    real claim (`verified`, `cancelled`) map to a producer-owned verification
 *    state; `not-verified`, `unavailable`, and `error` never change a state
 *    and never confirm anything.
 * 2. Evidence is minted only when the outcome makes a claim. The minted
 *    evidence must carry a provider source kind, a `verifiedAt` timestamp, and
 *    a bounded reference value or safe source URL — the same boundary
 *    `describeProducerEvidenceRequirement` documented in STEP 19.
 * 3. Staleness is explicit: a result that is expired (or carries no usable
 *    timestamps) is never usable as current verification.
 *
 * No producer exists today: no code path in the application can mint
 * producer-owned states. Results are produced only inside this module and its
 * tests, and never persisted or sent anywhere.
 */

import type { TripVerificationEvidence, TripVerificationState } from '../../types/trip';
import {
  TRIP_VERIFICATION_PRODUCER_STATES,
  describeProducerEvidenceRequirement,
  isTripEvidenceSourceKind,
  isTripVerificationState,
} from '../trips/verificationState';
import { isSafeHttpUrl } from '../trips/tripPlanning';
import { isProviderSafeErrorCategory } from './executionOperations';
import type { ProviderSafeError } from './executionOperations';

/** The only outcomes a verification producer may report. */
export type ProviderVerificationOutcome =
  'verified' | 'not-verified' | 'cancelled' | 'unavailable' | 'error';

/**
 * The normalized contract a future provider-backed producer returns. It names
 * the provider, the outcome, and transports only safe metadata — no tokens,
 * no raw payloads, no credentials.
 */
export interface ProviderVerificationResult {
  /** Provider key used by the adapter layer (bounded). */
  providerId: string;
  /** Human-readable provider label (bounded). */
  providerName: string;
  /** Outcome reported by the producer (required). */
  outcome: ProviderVerificationOutcome;
  /**
   * Evidence minted when the outcome makes a real claim (`verified`,
   * `cancelled`). Absent for `not-verified`, `unavailable`, and `error`.
   */
  evidence?: TripVerificationEvidence;
  /** ISO date-time the producer checked (required). */
  retrievedAt: string;
  /** Optional ISO date-time after which this result is stale. */
  expiresAt?: string;
  /** Stable id of the related planning record (optional). */
  relatedRecordId?: string;
  /** Optional user-facing limitations (each trimmed and bounded). */
  limitations?: string[];
  /** Bounded safe error, only for the `error` outcome. */
  error?: ProviderSafeError;
}

export const PROVIDER_VERIFICATION_OUTCOMES: ReadonlyArray<ProviderVerificationOutcome> = [
  'verified',
  'not-verified',
  'cancelled',
  'unavailable',
  'error',
];

export const MAX_VERIFICATION_PRODUCER_ID_LENGTH = 100;
export const MAX_VERIFICATION_PRODUCER_NAME_LENGTH = 100;
export const MAX_VERIFICATION_RELATED_RECORD_LENGTH = 200;
export const MAX_VERIFICATION_LIMITATION_LENGTH = 200;
export const MAX_VERIFICATION_ERROR_MESSAGE_LENGTH = 500;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderVerificationOutcome(value: unknown): value is ProviderVerificationOutcome {
  return (
    typeof value === 'string' &&
    (PROVIDER_VERIFICATION_OUTCOMES as ReadonlyArray<string>).includes(value)
  );
}

function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalStringArray(value: unknown, maxLength: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > maxLength) return null;
    out.push(trimmed);
  }
  return out;
}

function isRealIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: string): boolean {
  if (!ISO_DATE_TIME_RE.test(value)) return false;
  const match = ISO_DATE_TIME_RE.exec(value)!;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  return isRealIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (ISO_DATE_RE.test(trimmed)) return isRealIsoDate(trimmed) ? trimmed : null;
  return isIsoDateTime(trimmed) ? trimmed : null;
}

function compareTimestamps(a: string, b: string): number {
  return ms(a) - ms(b);
}

function ms(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
}

export function isProviderVerificationResult(value: unknown): value is ProviderVerificationResult {
  return normalizeProviderVerificationResult(value) !== null;
}

/**
 * Normalizes an untrusted producer payload into a `ProviderVerificationResult`,
 * or returns `null` when the shape cannot be repaired. Never throws.
 *
 * Rules:
 * - `providerId`/`providerName` are required, trimmed, and bounded;
 *   `outcome` must be a recognized outcome.
 * - `retrievedAt` is required; `expiresAt` is optional and must not precede it.
 * - Evidence is rebuilt (never trusted as-is) through the same strict
 *   `normalizeProducerEvidence` boundary below, so a producer can never smuggle
 *   arbitrary/generic payloads or unsafe URLs into the model.
 * - Safe errors are accepted only for the `error` outcome.
 */
export function normalizeProviderVerificationResult(
  value: unknown
): ProviderVerificationResult | null {
  if (!isRecord(value)) return null;
  const providerId = requireString(value.providerId, MAX_VERIFICATION_PRODUCER_ID_LENGTH);
  if (providerId === null) return null;
  const providerName = requireString(value.providerName, MAX_VERIFICATION_PRODUCER_NAME_LENGTH);
  if (providerName === null) return null;
  if (!isProviderVerificationOutcome(value.outcome)) return null;

  const retrievedAt = optionalTimestamp(value.retrievedAt);
  if (retrievedAt === null || retrievedAt === undefined) return null;
  const expiresAt = optionalTimestamp(value.expiresAt);
  if (expiresAt === null) return null;
  if (expiresAt !== undefined && compareTimestamps(expiresAt, retrievedAt) < 0) return null;

  const relatedRecordId = optionalString(
    value.relatedRecordId,
    MAX_VERIFICATION_RELATED_RECORD_LENGTH
  );
  if (relatedRecordId === null) return null;

  const limitations = optionalStringArray(value.limitations, MAX_VERIFICATION_LIMITATION_LENGTH);
  if (limitations === null) return null;

  const result: ProviderVerificationResult = {
    providerId,
    providerName,
    outcome: value.outcome,
    retrievedAt,
  };
  if (expiresAt !== undefined) result.expiresAt = expiresAt;
  if (relatedRecordId !== undefined) result.relatedRecordId = relatedRecordId;
  if (limitations.length > 0) result.limitations = limitations;

  if (value.evidence !== undefined && value.evidence !== null) {
    const evidence = normalizeProducerEvidence(value.evidence);
    if (evidence === null) return null;
    result.evidence = evidence;
  }

  if (value.error !== undefined && value.error !== null) {
    if (value.outcome !== 'error') return null;
    if (!isRecord(value.error)) return null;
    const category = value.error.category;
    if (!isProviderSafeErrorCategory(category)) return null;
    const message = requireString(value.error.message, MAX_VERIFICATION_ERROR_MESSAGE_LENGTH);
    if (message === null) return null;
    result.error = { category, message };
  }

  return result;
}

/**
 * Normalizes evidence from a producer. Unlike the user-facing
 * `normalizeTripVerificationEvidence`, a producer may mint the two
 * producer-owned states — but only with the STEP 19 producer evidence
 * requirement: a provider source kind plus a `verifiedAt` timestamp plus a
 * bounded reference value or safe source URL. Threats like a `provider-confirmed`
 * result that carries no verifiedAt, or an evidence from a user-marked source
 * that claims to be verifier-minted, are rejected.
 */
export function normalizeProducerEvidence(value: unknown): TripVerificationEvidence | null {
  if (!isRecord(value)) return null;

  const id = requireString(value.id, 200);
  if (id === null) return null;

  if (!isTripVerificationState(value.state)) return null;
  if (!(TRIP_VERIFICATION_PRODUCER_STATES as ReadonlyArray<string>).includes(value.state)) {
    return null;
  }

  if (!isTripEvidenceSourceKind(value.sourceKind)) return null;
  if (value.sourceKind !== 'provider-system' && value.sourceKind !== 'provider-communication') {
    return null;
  }

  const verifiedAt = optionalTimestamp(value.verifiedAt);
  if (verifiedAt === null || verifiedAt === undefined) return null;

  const referenceValue = optionalString(value.referenceValue, 200);
  if (referenceValue === null) return null;
  const sourceUrl = optionalString(value.sourceUrl, 2000);
  if (sourceUrl === null) return null;
  if (sourceUrl !== undefined && !isSafeHttpUrl(sourceUrl)) return null;
  if (referenceValue === undefined && sourceUrl === undefined) return null;

  const relatedRecordId = optionalString(value.relatedRecordId, 200);
  if (relatedRecordId === null) return null;
  const sourceLabel = optionalString(value.sourceLabel, 200);
  if (sourceLabel === null) return null;

  const evidence: TripVerificationEvidence = {
    id,
    state: value.state,
    sourceKind: value.sourceKind,
    verifiedAt,
  };
  if (referenceValue !== undefined) evidence.referenceValue = referenceValue;
  if (sourceUrl !== undefined) evidence.sourceUrl = sourceUrl;
  if (relatedRecordId !== undefined) evidence.relatedRecordId = relatedRecordId;
  if (sourceLabel !== undefined) evidence.sourceLabel = sourceLabel;
  return evidence;
}

/**
 * The verification state a producer outcome is allowed to mint, or `null` when
 * the outcome makes no state claim. `verified` → `externally-verified`;
 * `cancelled` → `cancelled`; every other outcome never mints a state.
 */
export function getProducerVerificationProofOfEvidence(
  outcome: ProviderVerificationOutcome
): TripVerificationState | null {
  if (outcome === 'verified') return 'externally-verified';
  if (outcome === 'cancelled') return 'cancelled';
  return null;
}

/**
 * True when a producer result carries enough evidence to mint a state claim.
 * Requires a producer-mintable outcome, a well-formed producer-evidence record
 * that matches the outcome's target state, and a non-expired result relative to
 * `now`. Stale or missing evidence can never mint `externally-verified` or
 * `provider-confirmed`.
 */
export function canMintStateFromProducerResult(
  result: ProviderVerificationResult,
  now: string
): boolean {
  if (result.outcome !== 'verified' && result.outcome !== 'cancelled') return false;
  if (result.evidence === undefined) return false;
  if (result.expiresAt !== undefined && compareTimestamps(now, result.expiresAt) >= 0) {
    return false;
  }
  const target = getProducerVerificationProofOfEvidence(result.outcome);
  if (target === null) return false;
  return evidenceSupportsProducerState(result.evidence, target);
}

/**
 * True when evidence legitimately backs a producer-owned state: it carries a
 * provider source kind, a verifiedAt timestamp, and a safe reference/URL — the
 * STEP 19 producer evidence requirement.
 */
export function evidenceSupportsProducerState(
  evidence: TripVerificationEvidence,
  state: TripVerificationState
): boolean {
  if (evidence.state !== state) return false;
  if (
    evidence.sourceKind !== 'provider-system' &&
    evidence.sourceKind !== 'provider-communication'
  ) {
    return false;
  }
  if (evidence.verifiedAt === undefined) return false;
  if (evidence.referenceValue === undefined && evidence.sourceUrl === undefined) return false;
  return true;
}

/**
 * One-sentence statement of what a producer result actually proves — read-only
 * prose that never over-claims: `not-verified`, `unavailable`, and `error`
 * never confirm anything, and a stale result is labelled stale.
 */
export function describeProducerVerificationClaim(
  result: ProviderVerificationResult,
  now: string
): string {
  if (result.outcome === 'error') {
    return `The provider reported an error and no verification state changed. Error: ${result.error?.message ?? 'unspecified'}.`;
  }
  if (result.outcome === 'unavailable') {
    return 'The provider is unavailable; no verification state changed.';
  }
  if (result.outcome === 'not-verified') {
    return 'The provider could not verify the reference; no verification state changed.';
  }
  if (result.expiresAt !== undefined && compareTimestamps(now, result.expiresAt) >= 0) {
    return 'This verification result is stale and must not be treated as current.';
  }
  if (result.outcome === 'verified') {
    return 'Producer-verified against provider-system evidence.';
  }
  if (result.outcome === 'cancelled') {
    return 'Producer-confirmed cancellation.';
  }
  return 'The producer result is not usable as verification.';
}

export { describeProducerEvidenceRequirement };
