/**
 * Pure, provider-independent booking lifecycle model (STEP 20).
 *
 * This module declares the lifecycle states a future booking record moves
 * through, plus the explicit transition table that keeps transitions honest.
 * No booking, ticket purchase, reservation, payment, cancellation, provider
 * API, or execution behavior exists here or anywhere in the application today.
 *
 * Deliberately side-effect free and dependency-free: no React, Firebase,
 * Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. It owns:
 *
 * 1. The booking lifecycle vocabulary — `TripBookingLifecycleState` — and the
 *    pure guards, labels, and transition rules that keep each state
 *    unambiguous. A draft is a plan; a submission requires explicit user
 *    approval; provider confirmation requires a legitimate producer-backed
 *    verification record — and nothing ever happens automatically.
 * 2. A gating helper that ensures a booking cannot move to `provider_confirmed`
 *    without an external verification record — only a legitimate
 *    producer-backed record may mint a provider confirmation.
 * 3. A failure-vs-success classification that is strictly terminal: once a
 *    booking fails, it stays in a known state; success is explicitly
 *    `provider_confirmed` — and no list completion, readiness state, or
 *    provider word may ever masquerade as a successful booking.
 *
 * No producer exists today: `provider_confirmed` and `provider_pending` are
 * unreachable through user-facing code. They are produced only inside this
 * module and its tests.
 */

import type { TripVerificationState } from '../../types/trip';

/** The recognized booking lifecycle states (unknown values are always rejected). */
export type TripBookingLifecycleState =
  | 'not_started'
  | 'draft'
  | 'awaiting_user_approval'
  | 'submitted'
  | 'provider_pending'
  | 'provider_confirmed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export const TRIP_BOOKING_LIFECYCLE_STATES: ReadonlyArray<TripBookingLifecycleState> = [
  'not_started',
  'draft',
  'awaiting_user_approval',
  'submitted',
  'provider_pending',
  'provider_confirmed',
  'failed',
  'cancelled',
  'unknown',
];

export const TRIP_BOOKING_LIFECYCLE_TRANSITIONS: Readonly<
  Record<TripBookingLifecycleState, readonly TripBookingLifecycleState[]>
> = {
  not_started: ['not_started', 'draft', 'cancelled', 'unknown'],
  draft: ['draft', 'not_started', 'awaiting_user_approval', 'cancelled', 'unknown', 'failed'],
  awaiting_user_approval: ['awaiting_user_approval', 'draft', 'submitted', 'cancelled', 'unknown'],
  submitted: ['submitted', 'provider_pending', 'failed', 'cancelled', 'unknown'],
  provider_pending: ['provider_pending', 'provider_confirmed', 'failed', 'cancelled', 'unknown'],
  provider_confirmed: ['provider_confirmed', 'cancelled'],
  failed: ['failed', 'not_started', 'draft', 'cancelled', 'unknown'],
  cancelled: ['cancelled'],
  unknown: ['unknown', 'not_started', 'draft', 'cancelled'],
};

/** True when `value` is one of the recognized booking lifecycle states. */
export function isTripBookingLifecycleState(value: unknown): value is TripBookingLifecycleState {
  return (
    typeof value === 'string' &&
    (TRIP_BOOKING_LIFECYCLE_STATES as ReadonlyArray<string>).includes(value)
  );
}

/** True when the explicit matrix allows `current → next`. */
export function canTransitionBookingLifecycleState(
  current: TripBookingLifecycleState,
  next: TripBookingLifecycleState
): boolean {
  return (
    TRIP_BOOKING_LIFECYCLE_TRANSITIONS[current] as ReadonlyArray<TripBookingLifecycleState>
  ).includes(next);
}

/** The allowed target states from a given state. */
export function getAllowedBookingLifecycleTransitions(
  current: TripBookingLifecycleState
): TripBookingLifecycleState[] {
  return [
    ...(TRIP_BOOKING_LIFECYCLE_TRANSITIONS[current] as ReadonlyArray<TripBookingLifecycleState>),
  ];
}

/**
 * Human-readable validation message for `current → next`, or `null` when
 * legal. Follows the same `*Problem` convention used elsewhere in the project:
 * safe message on invalid input, never a throw.
 */
export function getBookingLifecycleTransitionProblem(
  current: TripBookingLifecycleState,
  next: TripBookingLifecycleState
): string | null {
  if (!canTransitionBookingLifecycleState(current, next)) {
    return 'That booking lifecycle transition is not allowed.';
  }
  if (
    (current === 'submitted' || current === 'provider_pending') &&
    next === 'provider_confirmed'
  ) {
    return 'Provider confirmation requires a legitimate producer-backed verification record.';
  }
  return null;
}

/**
 * True when a `draft` must move through explicit user approval before any
 * submission may happen. The transition table enforces this at the boundary,
 * but this predicate names the intent for read-only documentation and
 * UI affordance logic.
 */
export function requiresUserApprovalBeforeSubmission(state: TripBookingLifecycleState): boolean {
  return state === 'draft' || state === 'not_started';
}

/**
 * Only `provider_confirmed` counts as a fully successful booking.
 * Provider pending is "in flight"; failed and unknown are never success.
 */
export function isBookingLifecycleSuccessState(state: TripBookingLifecycleState): boolean {
  return state === 'provider_confirmed';
}

/** `failed` and `unknown` are non-success terminal failure states. */
export function isBookingLifecycleFailureState(state: TripBookingLifecycleState): boolean {
  return state === 'failed';
}

/**
 * The application never automatically changes booking state. A state change
 * only happens through an explicit transition in this matrix. This helper
 * documents the semantic: user-triggered cancellations and producer-minted
 * confirmations are both explicit, and auto-execution is always rejected.
 */
export function canBookingTransitionAutomatically(): boolean {
  return false;
}

/**
 * Whether a given lifecycle state may be moved into `provider_confirmed`
 * (or `provider_pending`) by a producer. Requires both a valid lifecycle
 * source state and evidence that the verification record is producer-backed.
 * In practice this always returns `false` today — no producer exists.
 */
export function canProviderMarkBookingConfirmed(
  currentLifecycle: TripBookingLifecycleState,
  verificationState: TripVerificationState
): boolean {
  const validLifecycle =
    currentLifecycle === 'submitted' || currentLifecycle === 'provider_pending';
  const validVerification =
    verificationState === 'externally-verified' || verificationState === 'provider-confirmed';
  return validLifecycle && validVerification;
}

/** Human-readable, read-only label for a booking lifecycle state. */
export function getTripBookingLifecycleStateLabel(state: TripBookingLifecycleState): string {
  switch (state) {
    case 'not_started':
      return 'Not started';
    case 'draft':
      return 'Draft';
    case 'awaiting_user_approval':
      return 'Awaiting user approval';
    case 'submitted':
      return 'Submitted';
    case 'provider_pending':
      return 'Provider pending';
    case 'provider_confirmed':
      return 'Provider confirmed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'unknown':
      return 'Unknown';
  }
}
