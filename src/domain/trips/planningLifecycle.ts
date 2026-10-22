/**
 * Pure planning-reference lifecycle vocabulary (STEP 24).
 *
 * This module owns the only lifecycle vocabulary for explicitly-entered
 * transport/accommodation plans: the four user-managed states (`active`,
 * `needs-review`, `replaced`, `archived`) plus the pure helpers that validate,
 * normalize, label, describe, and classify them. It is deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches.
 *
 * Lifecycle answers "what does the owner intend to do with this reference" —
 * it is strictly separate from provenance ("where did this record come from")
 * and from execution readiness ("how far along is the plan"). It never implies
 * availability, pricing, verification, a booking, a replacement record, or a
 * provider claim.
 *
 * Truthfulness and control rules:
 *
 * 1. Strictly user-controlled. Nothing here ever transitions a reference
 *    automatically: there is no staleness detection, no date math, no clock,
 *    no external freshness, and no code path that writes a lifecycle value on
 *    its own. Only explicit user actions set these states.
 * 2. Honest wording. A `needs-review` reference is "user-marked for review",
 *    never "expired", "outdated", "unavailable", or "price changed". Nothing
 *    here claims verification, live availability, a changed price, or expiry.
 * 3. Replace / archive are decisions, not deletions. `replaced` records that
 *    the owner superseded this reference with another one; `archived` keeps
 *    the reference (data, provenance, and readiness intact) but marks it not
 *    active. Neither invents a replacement record nor deletes anything.
 * 4. Legacy-first. An absent lifecycle on a legacy record is valid and stays
 *    absent — it is treated as `active` at read time only, and never written
 *    back merely by being viewed. An untrusted present value is rejected,
 *    never guessed.
 */
import type { TripPlanLifecycleState } from '../../types/trip';

/** The only recognized lifecycle states (unknown values are always rejected). */
export const TRIP_PLAN_LIFECYCLE_STATES: ReadonlyArray<TripPlanLifecycleState> = [
  'active',
  'needs-review',
  'replaced',
  'archived',
];

/**
 * The effective read-time default for a legacy record that carries no
 * lifecycle metadata: it is treated as an `active` reference. This is a
 * display/behavior default only — it is never written back to the record.
 */
export const DEFAULT_TRIP_PLAN_LIFECYCLE_STATE: TripPlanLifecycleState = 'active';

/**
 * True when `value` is one of the recognized lifecycle states. Unknown or
 * arbitrary strings are rejected — they must never reach a persisted record.
 */
export function isTripPlanLifecycleState(value: unknown): value is TripPlanLifecycleState {
  return (
    typeof value === 'string' &&
    (TRIP_PLAN_LIFECYCLE_STATES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Normalizes an untrusted lifecycle value into a recognized state, or returns
 * `null` when it cannot be repaired (an unknown state rejects the whole record —
 * never guessed). `null`/`undefined` map to `null` here so the plan normalizers
 * can treat a missing value exactly like a legacy record: present-and-valid
 * values are carried, everything else stays absent. Never throws.
 */
export function normalizeTripPlanLifecycleState(value: unknown): TripPlanLifecycleState | null {
  return isTripPlanLifecycleState(value) ? value : null;
}

/**
 * The lifecycle state that should drive read-time behavior: the persisted
 * value when present, otherwise the legacy default (`active`). This never
 * mutates anything — the effective state is computed, not stored.
 */
export function getEffectiveTripPlanLifecycleState(
  state: TripPlanLifecycleState | undefined
): TripPlanLifecycleState {
  return state ?? DEFAULT_TRIP_PLAN_LIFECYCLE_STATE;
}

/**
 * Human-readable label for a lifecycle state, used only by read-only UI
 * presentation. Every label stays honest and user-controlled: "Needs review"
 * means the owner asked to revisit a reference, never that data went stale.
 */
export function getTripPlanLifecycleLabel(state: TripPlanLifecycleState): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'needs-review':
      return 'Needs review';
    case 'replaced':
      return 'Replaced';
    case 'archived':
      return 'Archived';
  }
}

/**
 * Short description for a lifecycle state used as read-only tooltip text.
 * Wording never claims expiry, provider staleness, price changes, verification,
 * or a booking — `needs-review` is explicitly user-marked.
 */
export function getTripPlanLifecycleDescription(state: TripPlanLifecycleState): string {
  switch (state) {
    case 'active':
      return 'Active planning reference — you intend to use it as-is.';
    case 'needs-review':
      return 'User-marked for review — review before relying on this reference.';
    case 'replaced':
      return 'Superseded by another user-selected reference.';
    case 'archived':
      return 'Archived — kept for reference but not active.';
  }
}

/** True only for the `active` state (including the legacy read-time default). */
export function isActiveReference(state: TripPlanLifecycleState): boolean {
  return state === 'active';
}

/**
 * True only for the `needs-review` state. The single predicate that flags a
 * reference the owner has asked to revisit before relying on it.
 */
export function requiresPlanReview(state: TripPlanLifecycleState): boolean {
  return state === 'needs-review';
}

/** True only for the `archived` state (the UI presents these separately). */
export function isArchivedReference(state: TripPlanLifecycleState): boolean {
  return state === 'archived';
}
