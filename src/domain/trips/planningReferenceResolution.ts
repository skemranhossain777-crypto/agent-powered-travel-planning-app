/**
 * Pure conflict-resolution vocabulary for section-level primary references
 * (STEP 28).
 *
 * This module owns the explicit user-action classification that describes
 * *how* a primary-assignment conflict was resolved in a draft: selecting
 * another active reference, clearing the primary, restoring the selected
 * inactive plan to active, or leaving the conflict unresolved. It is
 * deliberately side-effect free and dependency-free: no React, Firebase,
 * Router, Zustand, network, clock, `any`, or generic `Record<string, any>`
 * escape hatches.
 *
 * Resolution semantics that keep it honest and safe:
 *
 * 1. Explicit user actions only. A decision represents the owner's
 *    deliberate choice — not an external execution result and not an
 *    inference from a coincidental lifecycle state change.
 * 2. Planning-only. The vocabulary and labels never claim booking,
 *    payment, availability, verification, reservation confirmation,
 *    or an automatic fix.
 * 3. No persistence. Resolution decisions are transient, computed from
 *    the draft at the moment the user acts. No resolution record is
 *    stored on the trip — the resulting primary ID and lifecycle state
 *    are the persisted truth. Legacy trips without any resolution record
 *    are valid and complete.
 * 4. No automatic resolution. Nothing here auto-selects, auto-clears,
 *    auto-promotes, auto-repairs, or auto-resolves a conflict.
 * 5. Honest labels. Each decision has an honest, user-visible label and
 *    description that never implies booking, verification, or execution.
 * 6. Read-only composition. This module composes with the STEP 27
 *    conflict vocabulary (`PrimaryAssignmentStatus`), the STEP 26
 *    selection model (`SelectablePlan`, `isPlanEligibleAsPrimary`), and
 *    the STEP 24 lifecycle model only — it never touches persistence,
 *    normalization, or edit plumbing.
 */
import type { PrimaryAssignmentStatus } from './planningReferenceConflict';
import { type SelectablePlan, isPlanEligibleAsPrimary } from './planningReferenceSelection';

/**
 * The user's explicit resolution decision for a primary-assignment conflict.
 * A decision represents what the owner chose to do, not the external
 * execution result of that choice.
 *
 * - `unresolved` — the user has not explicitly resolved the conflict.
 * - `selected-another` — the user explicitly chose another active reference.
 * - `cleared` — the user explicitly removed the primary assignment.
 * - `restored-selected` — the user explicitly restored the previously
 *   selected inactive plan to active, preserving its primary ID.
 */
export type PrimaryResolutionDecision =
  'unresolved' | 'selected-another' | 'cleared' | 'restored-selected';

/**
 * The explicit user action that produced a resolution decision. Each
 * variant is a precise, minimal description of what the owner did — no
 * timestamps, no user IDs, and no external state.
 */
export type PrimaryResolutionAction =
  { type: 'select'; selectedId: string } | { type: 'clear' } | { type: 'restore'; planId: string };

/**
 * The classified outcome of a user action, containing the decision, a
 * `resolved` flag that indicates whether the prior conflict was actually
 * resolved, and safe, user-facing labels.
 */
export interface PrimaryResolutionOutcome {
  decision: PrimaryResolutionDecision;
  /** True when the prior conflict (missing or inactive) was resolved. */
  resolved: boolean;
  label: string;
  description: string;
}

/**
 * The minimal snapshot of the current draft's primary-assignment state,
 * used by the compatibility checker to determine whether a prior
 * resolution decision is still accurate.
 */
export interface PrimaryAssignmentStateSnapshot {
  status: PrimaryAssignmentStatus;
  selectedId: string | null;
  activePlanIds: ReadonlyArray<string>;
}

/**
 * Input for the classification helper. `priorStatus` is the assignment
 * status *before* the action; `action` is what the user just did; `plans`
 * is the plan list *after* the action is applied (to validate the outcome
 * is consistent with the post-action draft).
 */
export interface PrimaryResolutionClassificationInput {
  priorStatus: PrimaryAssignmentStatus;
  priorSelectedId: string | null;
  action: PrimaryResolutionAction;
  plans: ReadonlyArray<SelectablePlan>;
}

// ---------------------------------------------------------------------------
// Labels and descriptions (honest, planning-only)
// ---------------------------------------------------------------------------

const DECISION_LABELS: Record<PrimaryResolutionDecision, string> = {
  unresolved: 'Primary assignment remains unresolved.',
  'selected-another': 'Primary reference updated in this draft.',
  cleared: 'Primary assignment cleared in this draft.',
  'restored-selected': 'Existing primary reference restored to active in this draft.',
};

const DECISION_DESCRIPTIONS: Record<PrimaryResolutionDecision, string> = {
  unresolved:
    'The primary assignment is still in a conflict state and has not been explicitly resolved.',
  'selected-another': 'Another active reference was explicitly selected as the primary assignment.',
  cleared:
    'The primary assignment was explicitly removed by the user. The section has no primary reference.',
  'restored-selected':
    'The previously selected plan was explicitly restored to active. Its primary ID is preserved.',
};

/**
 * Honest, user-visible label for a resolution decision. The label
 * describes the user's explicit planning action — never booking,
 * verification, payment, or reservation confirmation.
 */
export function getPrimaryResolutionDecisionLabel(decision: PrimaryResolutionDecision): string {
  return DECISION_LABELS[decision];
}

/**
 * Longer safe description for a resolution decision, suitable for
 * screen-reader text or a tooltip. Honest and planning-only.
 */
export function getPrimaryResolutionDecisionDescription(
  decision: PrimaryResolutionDecision
): string {
  return DECISION_DESCRIPTIONS[decision];
}

// ---------------------------------------------------------------------------
// Pure predicates — direct (section 2, helpers 1–6)
// ---------------------------------------------------------------------------

/**
 * True when the primary-assignment status indicates an unresolved
 * conflict: a missing or inactive selection needs the owner's attention.
 */
export function isPrimaryConflictUnresolved(status: PrimaryAssignmentStatus): boolean {
  return status === 'missing' || status === 'inactive';
}

/**
 * True when the classified user action resolves a *missing* primary
 * (the stored selection references a plan that no longer exists in the
 * section): selecting another active plan resolves the conflict;
 * restoring is invalid (the referenced plan does not exist); clearing
 * also resolves it.
 */
export function doesActionResolveMissingPrimary(
  input: PrimaryResolutionClassificationInput
): boolean {
  const outcome = classifyPrimaryResolutionDecision(input);
  return outcome.resolved && input.priorStatus === 'missing';
}

/**
 * True when the classified user action resolves an *inactive* primary:
 * selecting another active plan, restoring the selected plan to active,
 * or clearing the primary all resolve the conflict.
 */
export function doesActionResolveInactivePrimary(
  input: PrimaryResolutionClassificationInput
): boolean {
  const outcome = classifyPrimaryResolutionDecision(input);
  return outcome.resolved && input.priorStatus === 'inactive';
}

/**
 * True when explicitly selecting another active plan resolves the
 * current conflict. `selectedId` is the target plan id; `priorStatus`
 * and `priorSelectedId` describe the state before the action; `plans`
 * is the post-action plan list.
 */
export function selectingAnotherActivePlanResolvesConflict(params: {
  priorStatus: PrimaryAssignmentStatus;
  priorSelectedId: string | null;
  selectedId: string;
  plans: ReadonlyArray<SelectablePlan>;
}): boolean {
  return (
    isPrimaryConflictUnresolved(params.priorStatus) && params.selectedId !== params.priorSelectedId
  );
}

/**
 * True when explicitly clearing the primary assignment resolves the
 * conflict. Clearing resolves a missing or inactive conflict. Clearing
 * when there is no primary (`none`) or already valid assignment does
 * not resolve a conflict — there was no conflict to resolve.
 */
export function clearingPrimaryResolvesConflict(priorStatus: PrimaryAssignmentStatus): boolean {
  return priorStatus === 'missing' || priorStatus === 'inactive';
}

/**
 * True when restoring the selected inactive plan to active resolves the
 * conflict. The plan must be the currently stored selection, it must
 * exist in the post-action plans as an eligible (active) plan.
 */
export function restoringSelectedPlanResolvesConflict(params: {
  planId: string;
  priorStatus: PrimaryAssignmentStatus;
  priorSelectedId: string | null;
  plans: ReadonlyArray<SelectablePlan>;
}): boolean {
  if (params.priorStatus !== 'inactive') return false;
  if (params.priorSelectedId !== params.planId) return false;
  const plan = params.plans.find((p) => p.id === params.planId);
  return plan !== undefined && isPlanEligibleAsPrimary(plan);
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a user's explicit primary-resolution action against the
 * draft state prior to the action. The `plans` array should reflect
 * the draft *after* the action is applied, so the classifier can
 * validate the action's outcome is consistent with the post-action
 * draft.
 *
 * Invalid or inconsistent actions are classified as `unresolved` with
 * `resolved: false` — they never silently resolve a conflict.
 */
export function classifyPrimaryResolutionDecision(
  input: PrimaryResolutionClassificationInput
): PrimaryResolutionOutcome {
  const { priorStatus, priorSelectedId, action, plans } = input;

  switch (action.type) {
    case 'clear': {
      if (priorStatus === 'none') {
        return makeOutcome(
          'unresolved',
          false,
          'There is no primary assignment to clear; no conflict was resolved.'
        );
      }
      const resolved = priorStatus === 'missing' || priorStatus === 'inactive';
      return makeOutcome('cleared', resolved, DECISION_DESCRIPTIONS.cleared);
    }

    case 'select': {
      const { selectedId } = action;
      const plan = plans.find((p) => p.id === selectedId);
      if (plan === undefined || !isPlanEligibleAsPrimary(plan)) {
        return makeOutcome(
          'unresolved',
          false,
          `The selected plan "${selectedId}" is not an active eligible reference.`
        );
      }
      if (selectedId === priorSelectedId && priorStatus === 'valid') {
        return makeOutcome(
          'unresolved',
          false,
          'No change; the selected plan is already the primary reference.'
        );
      }
      if (selectedId === priorSelectedId && priorStatus === 'inactive') {
        return makeOutcome(
          'unresolved',
          false,
          'The selected plan is still inactive; selecting it again does not resolve the conflict.'
        );
      }
      if (isPrimaryConflictUnresolved(priorStatus) && selectedId !== priorSelectedId) {
        return makeOutcome('selected-another', true, DECISION_DESCRIPTIONS['selected-another']);
      }
      return makeOutcome(
        'unresolved',
        false,
        'Primary reference changed; there was no conflict to resolve.'
      );
    }

    case 'restore': {
      const { planId } = action;
      if (priorStatus !== 'inactive' || priorSelectedId !== planId) {
        return makeOutcome(
          'unresolved',
          false,
          'Restoring a plan that is not the selected primary reference does not resolve the primary assignment.'
        );
      }
      const plan = plans.find((p) => p.id === planId);
      if (plan === undefined || !isPlanEligibleAsPrimary(plan)) {
        return makeOutcome(
          'unresolved',
          false,
          'The plan is not an active eligible reference after the restore action.'
        );
      }
      return makeOutcome('restored-selected', true, DECISION_DESCRIPTIONS['restored-selected']);
    }
  }
}

// ---------------------------------------------------------------------------
// Compatibility checker (for rendering stale feedback)
// ---------------------------------------------------------------------------

/**
 * True when a prior resolution decision is still consistent with the
 * current draft's primary-assignment state. Used to suppress stale
 * transient feedback in the editor when the user's subsequent
 * actions have moved the draft away from the decision's conditions.
 */
export function isPrimaryResolutionDecisionCompatible(
  decision: PrimaryResolutionDecision,
  state: PrimaryAssignmentStateSnapshot
): boolean {
  switch (decision) {
    case 'unresolved':
      return isPrimaryConflictUnresolved(state.status);
    case 'cleared':
      return state.selectedId === null;
    case 'selected-another':
    case 'restored-selected':
      return state.status === 'valid' && state.selectedId !== null;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function makeOutcome(
  decision: PrimaryResolutionDecision,
  resolved: boolean,
  description: string
): PrimaryResolutionOutcome {
  return {
    decision,
    resolved,
    label: DECISION_LABELS[decision],
    description,
  };
}
