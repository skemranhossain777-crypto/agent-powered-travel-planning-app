/**
 * Pure, provider-independent external-verification vocabulary and evidence
 * model (STEP 19).
 *
 * This module is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. It owns:
 *
 * 1. The seven-state verification vocabulary — `TripVerificationState`
 *    (`user-entered | user-confirmed | manually-reviewed | externally-verified |
 *    provider-confirmed | cancelled | unknown`, defined in `src/types/trip.ts`)
 *    — plus the guards, labels, and explanations that keep a user-entered
 *    reference distinct from external verification and from a real booking.
 * 2. The minimal domain-only evidence model `TripVerificationEvidence`, with a
 *    strict normalizer that reuses the project's safe HTTP/HTTPS URL validation
 *    (`isSafeHttpUrl`) and treats every reference value as plain user text.
 * 3. The controlled state-transition gates: explicit transitions only, no
 *    automatic changes, nothing triggered by checklist completion or by AI.
 * 4. The producer boundary contract: the `externally-verified` and
 *    `provider-confirmed` states are reserved for a future provider-backed
 *    producer and are **never** producible from user input on any path.
 *
 * No booking, ticket purchase, reservation, payment, cancellation, provider
 * API, live availability, external verification, or execution behavior exists
 * here or anywhere in the application today. Nothing in this module is
 * persisted, sent to the AI, or rendered as a control.
 */

import type {
  TripEvidenceSourceKind,
  TripVerificationEvidence,
  TripVerificationState,
} from '../../types/trip';
import { isSafeHttpUrl } from './tripPlanning';

/** The only recognized verification states (unknown values are always rejected). */
export const TRIP_VERIFICATION_STATES: ReadonlyArray<TripVerificationState> = [
  'user-entered',
  'user-confirmed',
  'manually-reviewed',
  'externally-verified',
  'provider-confirmed',
  'cancelled',
  'unknown',
];

/** The only recognized evidence source kinds (unknown values are always rejected). */
export const TRIP_EVIDENCE_SOURCE_KINDS: ReadonlyArray<TripEvidenceSourceKind> = [
  'user-provided-document',
  'public-webpage',
  'provider-communication',
  'provider-system',
  'manual-review',
  'other',
];

/**
 * The verification states only a future provider-backed producer may produce.
 * User input is never allowed to mint these states.
 */
export const TRIP_VERIFICATION_PRODUCER_STATES: ReadonlyArray<TripVerificationState> = [
  'externally-verified',
  'provider-confirmed',
];

/** Upper bounds enforced at the normalization boundary (never silently truncated). */
export const MAX_EVIDENCE_ID_LENGTH = 200;
export const MAX_EVIDENCE_RELATED_RECORD_ID_LENGTH = 200;
export const MAX_EVIDENCE_SOURCE_LABEL_LENGTH = 200;
export const MAX_EVIDENCE_REFERENCE_VALUE_LENGTH = 200;
export const MAX_EVIDENCE_NOTE_LENGTH = 500;

/**
 * True when `value` is one of the recognized verification states. Status words
 * from the execution checklist (`pending`, `in_progress`, `completed`,
 * `skipped`) and ambiguous provider-like words (`booked`, `verified`) are
 * rejected — a checklist completion or a provider word can never be
 * interpreted as a verification transition.
 */
export function isTripVerificationState(value: unknown): value is TripVerificationState {
  return (
    typeof value === 'string' && (TRIP_VERIFICATION_STATES as ReadonlyArray<string>).includes(value)
  );
}

/** True when `value` is one of the recognized evidence source kinds. */
export function isTripEvidenceSourceKind(value: unknown): value is TripEvidenceSourceKind {
  return (
    typeof value === 'string' &&
    (TRIP_EVIDENCE_SOURCE_KINDS as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True only for the states that make external-or-booking claims
 * (`externally-verified`, `provider-confirmed`). This is the single predicate
 * that keeps user-entered references distinct from external verification.
 */
export function isProducerOnlyVerificationState(state: TripVerificationState): boolean {
  return (TRIP_VERIFICATION_PRODUCER_STATES as ReadonlyArray<string>).includes(state);
}

/**
 * True only for the states the owner can meaningfully author (`user-entered`,
 * `user-confirmed`, `manually-reviewed`). `cancelled`/`unknown` are separate
 * classifications, and producer states are never user-owned.
 */
export function isUserOwnedVerificationState(state: TripVerificationState): boolean {
  return state === 'user-entered' || state === 'user-confirmed' || state === 'manually-reviewed';
}

/**
 * Whether the user-facing editor may set `state` directly. The
 * `externally-verified` and `provider-confirmed` states always need a
 * legitimate provider-backed producer, so user input can never claim them.
 */
export function canUserSetTripVerificationState(state: TripVerificationState): boolean {
  return !isProducerOnlyVerificationState(state);
}

/**
 * The producer-boundary contract: only a future provider-backed producer may
 * mint the `externally-verified` and `provider-confirmed` states. This function
 * documents that boundary; no producer exists today and nothing calls it.
 */
export function canProducerSetTripVerificationState(state: TripVerificationState): boolean {
  return isProducerOnlyVerificationState(state);
}

/**
 * Human-readable label for a verification state used only by read-only UI
 * presentation. Every label is unambiguous: a user-entered reference is never
 * called "booked", a manual review is never called live/provider confirmation,
 * and only `provider-confirmed` is ever labelled as a booking.
 */
export function getTripVerificationStateLabel(state: TripVerificationState): string {
  switch (state) {
    case 'user-entered':
      return 'User-entered reference';
    case 'user-confirmed':
      return 'User-confirmed plan';
    case 'manually-reviewed':
      return 'Manually reviewed';
    case 'externally-verified':
      return 'Externally verified';
    case 'provider-confirmed':
      return 'Provider-confirmed booking';
    case 'cancelled':
      return 'Cancelled';
    case 'unknown':
      return 'Unknown or unavailable';
  }
}

/**
 * One-sentence plain-text explanation of a verification state, for read-only
 * presentation and documentation. It never claims a booking for user states and
 * never claims live/provider confirmation without a producer.
 */
export function getTripVerificationStateExplanation(state: TripVerificationState): string {
  switch (state) {
    case 'user-entered':
      return 'A reference the owner typed in. It is not proof of a booking.';
    case 'user-confirmed':
      return 'The owner reviewed and confirmed their own information. Not external verification.';
    case 'manually-reviewed':
      return 'The owner manually checked the information. Not live or provider confirmation.';
    case 'externally-verified':
      return 'Confirmed by a future provider-backed producer, never by user input.';
    case 'provider-confirmed':
      return 'A provider-confirmed booking produced by a future provider-backed producer.';
    case 'cancelled':
      return 'The reference is marked cancelled.';
    case 'unknown':
      return 'No verification state is known or the information is unavailable.';
  }
}

// ---------------------------------------------------------------------------
// State-transition gates (pure, explicit, no automatic transitions).
// ---------------------------------------------------------------------------

/**
 * The explicit transition matrix. Every edge lists the states a record may
 * move to from the current state. There are no automatic edges — nothing in
 * the application ever triggers a transition by itself, and checklist
 * completion or AI output can never influence this table.
 */
const TRIP_VERIFICATION_TRANSITIONS: Readonly<
  Record<TripVerificationState, readonly TripVerificationState[]>
> = {
  'user-entered': [
    'user-entered',
    'user-confirmed',
    'manually-reviewed',
    'cancelled',
    'externally-verified',
    'provider-confirmed',
  ],
  'user-confirmed': [
    'user-confirmed',
    'user-entered',
    'manually-reviewed',
    'cancelled',
    'externally-verified',
    'provider-confirmed',
  ],
  'manually-reviewed': [
    'manually-reviewed',
    'user-entered',
    'user-confirmed',
    'cancelled',
    'externally-verified',
    'provider-confirmed',
  ],
  'externally-verified': ['externally-verified', 'provider-confirmed', 'cancelled'],
  'provider-confirmed': ['provider-confirmed', 'cancelled'],
  cancelled: ['cancelled', 'user-entered'],
  unknown: ['unknown', 'user-entered', 'user-confirmed', 'manually-reviewed', 'cancelled'],
};

/**
 * True when the matrix explicitly allows the `current → next` transition.
 * The producer-gated edges exist in the matrix so a future producer contract
 * is expressible, but they are unreachable through the user affordance gates.
 */
export function canTransitionTripVerificationState(
  current: TripVerificationState,
  next: TripVerificationState
): boolean {
  return (TRIP_VERIFICATION_TRANSITIONS[current] as ReadonlyArray<TripVerificationState>).includes(
    next
  );
}

/**
 * True when the user affordance permits `current → next`: the edge must exist
 * in the matrix **and** `next` must be a user-settable state. Users can never
 * move into `externally-verified` or `provider-confirmed`.
 */
export function canUserTransitionTripVerificationState(
  current: TripVerificationState,
  next: TripVerificationState
): boolean {
  if (isProducerOnlyVerificationState(current)) return false;
  if (!canUserSetTripVerificationState(next)) return false;
  return canTransitionTripVerificationState(current, next);
}

/**
 * The ordered list of transitions the user affordance may offer from `current`.
 * Producer-only states are wholly producer-owned and excluded entirely, so the
 * UI can never render a "verify", "confirm booking", or producer-owned cancel
 * action and no user transition can ever originate from a producer state.
 */
export function getAllowedUserVerificationTransitions(
  current: TripVerificationState
): TripVerificationState[] {
  if (isProducerOnlyVerificationState(current)) return [];
  return (TRIP_VERIFICATION_TRANSITIONS[current] as ReadonlyArray<TripVerificationState>).filter(
    canUserSetTripVerificationState
  );
}

/**
 * Human-readable validation message for a `current → next` transition, or
 * `null` when the transition is legal. Matches the existing
 * `getPlanningUpdateProblem` convention: invalid input produces a safe
 * message, never a throw.
 */
export function getTripVerificationTransitionProblem(
  current: TripVerificationState,
  next: TripVerificationState
): string | null {
  if (!canTransitionTripVerificationState(current, next)) {
    return 'That verification-state transition is not allowed.';
  }
  if (isProducerOnlyVerificationState(current) || isProducerOnlyVerificationState(next)) {
    return 'Externally verified and provider-confirmed states are owned by a future provider-backed producer.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Evidence model (domain-only; never persisted).
// ---------------------------------------------------------------------------

/** True when `value` is a well-formed `TripVerificationEvidence` record. */
export function isTripVerificationEvidence(value: unknown): value is TripVerificationEvidence {
  return normalizeTripVerificationEvidence(value) !== null;
}

/**
 * Normalizes an untrusted evidence payload into a valid
 * `TripVerificationEvidence`, or returns `null` when the shape cannot be
 * repaired. Never throws.
 *
 * Rules:
 * - Required `id`, `state`, and `sourceKind` must be present and valid.
 * - **Producer states are rejected outright on this user-facing normalizer**:
 *   no provider-backed producer exists, so no user-entered payload can ever
 *   claim `externally-verified` or `provider-confirmed` — even when it carries
 *   timestamps or URLs. There is no fake manual path.
 * - Optional strings are trimmed and dropped when empty; `sourceUrl` must pass
 *   the shared `isSafeHttpUrl` boundary (a present-but-unsafe URL rejects the
 *   whole record); timestamps must be valid ISO dates or date-times when
 *   present; documented maximum lengths are enforced by rejection.
 * - Reference values are treated as user-entered text — never as proof of
 *   external verification or booking.
 * - The record is rebuilt field-by-field so runtime-only keys never leak.
 */
export function normalizeTripVerificationEvidence(value: unknown): TripVerificationEvidence | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  if (id.trim().length > MAX_EVIDENCE_ID_LENGTH) return null;

  if (!isTripVerificationState(value.state)) return null;
  if (isProducerOnlyVerificationState(value.state)) return null;

  if (!isTripEvidenceSourceKind(value.sourceKind)) return null;

  const evidence: TripVerificationEvidence = {
    id: id.trim(),
    state: value.state,
    sourceKind: value.sourceKind,
  };

  const relatedRecordId = normalizeOptionalString(
    value.relatedRecordId,
    MAX_EVIDENCE_RELATED_RECORD_ID_LENGTH
  );
  if (relatedRecordId === null) return null;
  if (relatedRecordId !== undefined) evidence.relatedRecordId = relatedRecordId;

  const sourceLabel = normalizeOptionalString(value.sourceLabel, MAX_EVIDENCE_SOURCE_LABEL_LENGTH);
  if (sourceLabel === null) return null;
  if (sourceLabel !== undefined) evidence.sourceLabel = sourceLabel;

  if (value.sourceUrl !== undefined && value.sourceUrl !== null) {
    if (!isSafeHttpUrl(value.sourceUrl)) return null;
    evidence.sourceUrl = value.sourceUrl;
  }

  const referenceValue = normalizeOptionalString(
    value.referenceValue,
    MAX_EVIDENCE_REFERENCE_VALUE_LENGTH
  );
  if (referenceValue === null) return null;
  if (referenceValue !== undefined) evidence.referenceValue = referenceValue;

  const verifiedAt = normalizeOptionalIsoDateTime(value.verifiedAt);
  if (verifiedAt === null) return null;
  if (verifiedAt !== undefined) evidence.verifiedAt = verifiedAt;

  const humanReviewedAt = normalizeOptionalIsoDateTime(value.humanReviewedAt);
  if (humanReviewedAt === null) return null;
  if (humanReviewedAt !== undefined) evidence.humanReviewedAt = humanReviewedAt;

  const notes = normalizeOptionalString(value.notes, MAX_EVIDENCE_NOTE_LENGTH);
  if (notes === null) return null;
  if (notes !== undefined) evidence.notes = notes;

  const expiresAt = normalizeOptionalIsoDateTime(value.expiresAt);
  if (expiresAt === null) return null;
  if (expiresAt !== undefined) evidence.expiresAt = expiresAt;

  return evidence;
}

/**
 * The producer-boundary contract for future external-verification producers:
 * describes the evidence-bearing metadata a producer-state record must carry,
 * or `null` for states a producer never mints. Contract-only — a future STEP
 * wires an actual producer, but nothing in the application today can reach
 * these states or mint this evidence.
 */
export function describeProducerEvidenceRequirement(state: TripVerificationState): string | null {
  if (state === 'externally-verified') {
    return 'A future provider-backed verification producer must mint evidence with a provider-system or provider-communication source kind, a verifiedAt timestamp, and a bounded reference value or safe source URL.';
  }
  if (state === 'provider-confirmed') {
    return 'A future provider-backed booking producer must mint evidence with a provider-system or provider-communication source kind and a verifiedAt timestamp.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers (bounded `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Normalizes an optional present-only string: trims it, drops it when empty,
 * and returns `null` (rejecting the whole record) when it is not a string or
 * exceeds the documented maximum. `null`/`undefined` input maps to `undefined`.
 */
function normalizeOptionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Normalizes an optional ISO date or ISO date-time, or returns `null` when the
 * value is present but not a real timestamp. `null`/`undefined` maps to
 * `undefined` (absent key).
 */
function normalizeOptionalIsoDateTime(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (ISO_DATE_RE.test(trimmed)) return isRealIsoDate(trimmed) ? trimmed : null;
  return isIsoDateTime(trimmed) ? trimmed : null;
}

/** True when `value` is a real ISO calendar date (`YYYY-MM-DD`). */
function isRealIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** True when `value` is a bounded ISO date-time (hour 00–23, minute 00–59). */
function isIsoDateTime(value: string): boolean {
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  return isRealIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
