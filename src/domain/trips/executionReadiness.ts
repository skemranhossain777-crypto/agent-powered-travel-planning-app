/**
 * Pure, provider-independent execution-readiness foundation (STEP 17, refined
 * in STEP 19).
 *
 * This module is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. It owns three things:
 *
 * 1. The persisted readiness/verification vocabulary —
 *    `TripExecutionReadinessState` and `TripExecutionReadiness` (defined in
 *    `src/types/trip.ts`) — plus the pure helpers that validate, normalize,
 *    label, and gate those values.
 * 2. The future-facing execution-record **contracts** (`TripExecutionRecord`
 *    and friends). These are DRAFT-ONLY type contracts: they are never
 *    persisted, never produced, and never sent anywhere. STEP 19 refines them
 *    to the richer provider-independent verification vocabulary
 *    (`TripVerificationState`, `TripVerificationEvidence`,
 *    `TripBookingCategory`) so a future execution/booking layer can adopt them
 *    without a breaking design. Persistence of execution records is deferred
 *    until an actual execution workflow and producer exist.
 * 3. The vocabulary rules that keep planning data honest: a user-entered
 *    reference is not proof of a booking, a provider name is not a provider
 *    integration, planned data is not externally verified data, and the
 *    application never claims live booking or payment state.
 *
 * No booking, ticket purchase, reservation, payment, cancellation, provider
 * API, live availability, or execution behavior exists here or anywhere in the
 * application today.
 */

import type {
  TripBookingCategory,
  TripExecutionReadiness,
  TripExecutionReadinessState,
  TripVerificationEvidence,
  TripVerificationState,
} from '../../types/trip';

/** The only recognized readiness states (unknown values are always rejected). */
export const TRIP_EXECUTION_READINESS_STATES: ReadonlyArray<TripExecutionReadinessState> = [
  'planned',
  'user-confirmed',
  'externally-verified',
  'cancelled',
  'unknown',
];

/**
 * True when `value` is one of the recognized readiness states. Unknown/arbitrary
 * strings are rejected — they must never reach a persisted record.
 */
export function isTripExecutionReadinessState(
  value: unknown
): value is TripExecutionReadinessState {
  return (
    typeof value === 'string' &&
    (TRIP_EXECUTION_READINESS_STATES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when `value` is a well-formed `TripExecutionReadiness` record: a
 * recognized `state` plus an optional string `note`.
 */
export function isTripExecutionReadiness(value: unknown): value is TripExecutionReadiness {
  return normalizeTripExecutionReadiness(value) !== null;
}

/**
 * Normalizes an untrusted readiness payload into a valid
 * `TripExecutionReadiness`, or returns `null` when the shape cannot be
 * repaired. The `state` is required and must be a recognized value (unknown
 * state values reject the whole record — never guessed); the optional `note` is
 * trimmed and dropped when empty so present-but-empty keys never persist.
 * Never throws.
 */
export function normalizeTripExecutionReadiness(value: unknown): TripExecutionReadiness | null {
  if (!isRecord(value)) return null;
  const { state, note } = value;
  if (!isTripExecutionReadinessState(state)) return null;
  const readiness: TripExecutionReadiness = { state };
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') return null;
    const trimmed = note.trim();
    if (trimmed.length > 0) readiness.note = trimmed;
  }
  return readiness;
}

/**
 * Human-readable label for a readiness state used only by read-only UI
 * presentation. It never claims a booking: a reference label is presented as
 * user-entered, a provider confirmation only as externally verified, and the
 * app's lack of booking integration is stated separately where it is shown.
 */
export function getTripExecutionReadinessLabel(state: TripExecutionReadinessState): string {
  switch (state) {
    case 'planned':
      return 'Planned';
    case 'user-confirmed':
      return 'User-entered reference';
    case 'externally-verified':
      return 'Verified externally';
    case 'cancelled':
      return 'Cancelled';
    case 'unknown':
      return 'Unknown or unavailable';
  }
}

/**
 * True only for the externally-verified state. This is the single predicate
 * that keeps user-entered references distinct from external verification: a
 * `user-confirmed` plan is never treated as proof from an external source.
 */
export function isExternallyVerifiedState(state: TripExecutionReadinessState): boolean {
  return state === 'externally-verified';
}

/**
 * Whether the user-facing editor may set `state` directly. The
 * `externally-verified` state is reserved for a future provider integration and
 * must never be produced by user input — otherwise a user-typed reference could
 * be presented as external confirmation. This is the contradiction-prevention
 * gate for any future readiness editor.
 */
export function canUserSetReadinessState(state: TripExecutionReadinessState): boolean {
  return state !== 'externally-verified';
}

// ---------------------------------------------------------------------------
// Future execution-record contracts (DRAFT-ONLY, STEP 17, refined in STEP 19).
//
// These are provider-independent contracts for records a future execution /
// booking milestone may persist. They are NOT persisted, NOT produced, and NOT
// sent anywhere — no Firestore collection, write path, service, component, or
// test fixture creates them. Until then:
//   - a provider name here is a label, not an integration;
//   - a confirmation reference here is a user-entered label, not verification;
//   - `state` is the rich `TripVerificationState` vocabulary and `verification`
//     is the domain-only `TripVerificationEvidence` model — a user-entered
//     reference can never claim `externally-verified` or `provider-confirmed`;
//   - no payment, passport, identity-document, credential, token, or price data
//     lives in these contracts;
//   - no field ever claims live booking status on any user-producible path.
// ---------------------------------------------------------------------------

/**
 * Provider-independent base contract for a future execution record. Binds a
 * planning component (by its stable plan/component id) to a rich verification
 * state, a future booking category, and the evidence that backs the state.
 * Draft-only — never persisted.
 */
export interface TripExecutionRecordBase {
  /** Stable record id (draft contract — assigned by a future producer/owner). */
  id: string;
  /** Stable id of the planning component this record refers to. */
  componentId: string;
  /** Future booking category (transport, accommodation, activity, other). */
  category: TripBookingCategory;
  /** Provider-independent verification state of the execution record. */
  state: TripVerificationState;
  /** Domain-only evidence backing `state` (future producer-relevant metadata). */
  verification: TripVerificationEvidence[];
  /** Provider name as a label only (not a provider integration). */
  provider?: string;
  /** A reference the user recorded — a label, never proof of a booking. */
  confirmationReference?: string;
  /** Optional plain-text note. */
  note?: string;
}

/** Future transport execution record contract (DRAFT-ONLY, never persisted). */
export interface TripTransportExecutionRecord extends TripExecutionRecordBase {
  category: 'transport';
}

/** Future accommodation execution record contract (DRAFT-ONLY, never persisted). */
export interface TripAccommodationExecutionRecord extends TripExecutionRecordBase {
  category: 'accommodation';
}

/** Future activity execution record contract (DRAFT-ONLY, never persisted). */
export interface TripActivityExecutionRecord extends TripExecutionRecordBase {
  category: 'activity';
}

/** Future other-category booking/reference record contract (DRAFT-ONLY, never persisted). */
export interface TripOtherExecutionRecord extends TripExecutionRecordBase {
  category: 'other';
}

/** Union of all future execution-record contracts (DRAFT-ONLY, never persisted). */
export type TripExecutionRecord =
  | TripTransportExecutionRecord
  | TripAccommodationExecutionRecord
  | TripActivityExecutionRecord
  | TripOtherExecutionRecord;

// ---------------------------------------------------------------------------
// Internal helpers (bounded `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
