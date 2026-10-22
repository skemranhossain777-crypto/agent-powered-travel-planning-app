/**
 * Pure planning-reference primary-assignment conflict model (STEP 27).
 *
 * This module owns the read-time conflict vocabulary for the section-level
 * primary reference selection: the state of an explicit primary assignment
 * (`none` | `valid` | `missing` | `inactive`) and the honest, user-safe labels
 * and lifecycle-transition predictions built on top of it. It deliberately
 * reuses the STEP 26 selection vocabulary, the STEP 24 lifecycle vocabulary,
 * and the STEP 25 projection helpers — it never defines a parallel planning
 * model.
 *
 * Conflict rules that keep it honest and safe:
 *
 * 1. Composed, not duplicated. `resolvePrimaryAssignmentStatus` delegates to
 *    `resolvePrimarySelection`; eligibility delegates to
 *    `isPlanEligibleAsPrimary`; actual lifecycle states come from
 *    `planningLifecycle` / `planningReferenceProjection`. This module adds only
 *    the compact four-state wording and the transition-impact predicates.
 * 2. Explicit only. Absence is `none` — nothing is promoted, nothing becomes
 *    primary, and a legacy first plan is never claimed as an explicit choice.
 * 3. Read-only and non-mutating. Input arrays and plan objects are never
 *    modified; nothing here clears, writes, rewrites, or repairs a stored
 *    primary id, and nothing falls back to another plan.
 * 4. Honest wording. Labels and details describe a planning designation and
 *    the state of a user-chosen reference. They never claim a booking,
 *    availability, verification, payment, replacement, or an automatic fix.
 * 5. No environment. This module reads no clock, no network, and no framework
 *    (no React, Firebase, Router, or Zustand), and never touches persistence.
 */
import type { TripPlanLifecycleState, TripPlanningData } from '../../types/trip';
import { getTripPlanLifecycleLabel } from './planningLifecycle';
import type { LifecycleCodedPlan } from './planningReferenceProjection';
import {
  type PrimarySelectionResolution,
  type PrimarySelectionState,
  type SelectablePlan,
  isPlanEligibleAsPrimary,
  resolvePrimarySelection,
} from './planningReferenceSelection';

/**
 * The read-time state of an explicit section-level primary assignment. This is
 * a compact, user-facing projection of the STEP 26 resolution vocabulary:
 * - `none` — no explicit primary assignment exists.
 * - `valid` — the selected plan exists and is effective-lifecycle `active`.
 * - `missing` — the selected id does not resolve to any plan in the section.
 * - `inactive` — the selected plan exists but is `needs-review`, `replaced`,
 *   or `archived` (no longer eligible as primary).
 */
export type PrimaryAssignmentStatus = 'none' | 'valid' | 'missing' | 'inactive';

/** Maps the STEP 26 resolution vocabulary onto the STEP 27 status vocabulary. */
function toAssignmentStatus(state: PrimarySelectionState): PrimaryAssignmentStatus {
  switch (state) {
    case 'no-explicit-selection':
      return 'none';
    case 'valid-explicit-selection':
      return 'valid';
    case 'selected-plan-missing':
      return 'missing';
    case 'selected-plan-inactive':
      return 'inactive';
  }
}

/**
 * Resolves the primary-assignment status of one plan collection against its
 * stored selection id. Pure and read-only: plans are never mutated and an
 * invalid selection is never repaired, promoted, or cleared.
 */
export function resolvePrimaryAssignmentStatus(
  selectedId: string | undefined,
  plans: ReadonlyArray<SelectablePlan>
): PrimaryAssignmentStatus {
  return toAssignmentStatus(resolvePrimarySelection(selectedId, plans).state);
}

/**
 * Convenience resolver for the transport section. Reads the stored transport
 * primary id and the transport plan list from the planning projection and
 * resolves their combined assignment status — a read-only view of the section.
 */
export function resolveTransportPrimaryAssignmentStatus(
  planning: TripPlanningData
): PrimaryAssignmentStatus {
  return resolvePrimaryAssignmentStatus(planning.primaryTransportPlanId, planning.transportPlans);
}

/**
 * Convenience resolver for the accommodation section. Reads the stored
 * accommodation primary id and the accommodation plan list from the planning
 * projection and resolves their combined assignment status — read-only.
 */
export function resolveAccommodationPrimaryAssignmentStatus(
  planning: TripPlanningData
): PrimaryAssignmentStatus {
  return resolvePrimaryAssignmentStatus(
    planning.primaryAccommodationPlanId,
    planning.accommodationPlans
  );
}

/**
 * True when the assignment requires the owner's explicit attention: the stored
 * selection references a plan that is missing from the section or that is no
 * longer effective-active. These states are surfaced as a concise non-blocking
 * "needs attention" state; nothing auto-repairs them.
 */
export function isPrimaryAssignmentAttentionNeeded(status: PrimaryAssignmentStatus): boolean {
  return status === 'missing' || status === 'inactive';
}

/**
 * Honest read-only status wording for a primary assignment state. `missing`
 * and `inactive` share the same headline ("needs attention") because both defer
 * to the user; the distinguishing detail is carried by
 * `getPrimaryAssignmentConflictDetail`. No wording here ever claims a booking,
 * availability, verification, payment, or an automatic promotion.
 */
export function getPrimaryAssignmentStatusLabel(status: PrimaryAssignmentStatus): string {
  switch (status) {
    case 'none':
      return 'No primary reference selected';
    case 'valid':
      return 'Primary reference selected';
    case 'missing':
    case 'inactive':
      return 'Primary assignment needs attention';
  }
}

/**
 * A concise, plain-english explanation of a primary-assignment conflict for a
 * resolution that needs the owner's attention. The `missing` detail names the
 * stored id and the absence; the `inactive` detail names the selected plan's
 * actual lifecycle state. Both end with the explicit, user-controlled options
 * (select another active reference, clear the assignment, or — where the plan
 * still exists — restore it to active). Returns `null` when the resolution is
 * `no-explicit-selection` or `valid-explicit-selection` (no conflict to explain).
 */
export function getPrimaryAssignmentConflictDetail(
  resolution: PrimarySelectionResolution
): string | null {
  switch (resolution.state) {
    case 'selected-plan-missing': {
      const id = resolution.selectedId ?? 'the stored id';
      return `The selected primary reference "${id}" is no longer present in this section. Choose an active reference or clear the assignment to resolve it.`;
    }
    case 'selected-plan-inactive': {
      const state = resolution.inactiveState ?? 'active';
      const label = getTripPlanLifecycleLabel(state);
      const id = resolution.selectedId ?? 'the stored id';
      return `The selected primary reference "${id}" is marked ${label.toLowerCase()} and is no longer eligible as primary. Restore this plan to Active, select another active reference, or clear the assignment.`;
    }
    default:
      return null;
  }
}

/**
 * True when a plan may be explicitly selected as the primary reference. A
 * thin, explicitly-composed wrapper over the STEP 26 eligibility rule so this
 * module offers the concept without re-implementing the lifecycle judgment.
 */
export function isPlanSelectableAsPrimary(plan: LifecycleCodedPlan): boolean {
  return isPlanEligibleAsPrimary(plan);
}

/**
 * True when transitioning `targetPlanId` to `targetState` would leave the
 * section's stored primary assignment in a conflict (`missing` or `inactive`).
 *
 * Semantics:
 * - A valid selection becomes a conflict when its selected plan is moved to
 *   `needs-review`, `replaced`, or `archived`.
 * - An already-inactive selection stays a conflict when its selected plan is
 *   moved to any non-active state (the transition does not repair it).
 * - Transitions that do not involve the selected plan, a `none` resolution, or
 *   a `missing` resolution (the stored id names no plan) have no effect on the
 *   conflict and return `false`.
 *
 * Pure prediction only: this helper never writes a lifecycle or primary value.
 */
export function doesLifecycleTransitionCreatePrimaryConflict(
  resolution: PrimarySelectionResolution,
  targetPlanId: string,
  targetState: TripPlanLifecycleState
): boolean {
  if (resolution.selectedId !== targetPlanId) return false;
  const selectedIsTarget = resolution.state === 'valid-explicit-selection';
  const inactiveIsTarget = resolution.state === 'selected-plan-inactive';
  if (!selectedIsTarget && !inactiveIsTarget) return false;
  return targetState !== 'active';
}

/**
 * True when transitioning `targetPlanId` to `targetState` would resolve an
 * existing `inactive` primary-conflict: the stored selected plan is currently
 * non-active and is being restored to `active`. Restoring never writes or
 * rewrites a primary id — it only makes the existing selection eligible again
 * through read-time resolution.
 */
export function doesLifecycleTransitionResolvePrimaryConflict(
  resolution: PrimarySelectionResolution,
  targetPlanId: string,
  targetState: TripPlanLifecycleState
): boolean {
  return (
    resolution.state === 'selected-plan-inactive' &&
    resolution.selectedId === targetPlanId &&
    targetState === 'active'
  );
}
