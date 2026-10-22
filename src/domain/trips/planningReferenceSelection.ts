/**
 * Pure planning-reference primary selection model (STEP 26).
 *
 * This module owns the read-time interpretation of the section-level primary
 * selection on the transport and accommodation plan sections: the explicitly
 * stored, user-controlled `primaryTransportPlanId` / `primaryAccommodationPlanId`
 * fields. It is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 *
 * Selection semantics that keep it honest and safe:
 *
 * 1. Absence means "no explicit primary". A section without a stored selection
 *    id simply has no primary reference — the first plan in the list is never
 *    auto-promoted and never labeled as primary by any projection.
 * 2. Strict, minimal id shape. A selection id is a non-empty string (trimmed
 *    on normalization, mirroring how plan ids are trimmed on save). Unknown
 *    types and empty/whitespace values are rejected by the strict guard, never
 *    guessed.
 * 3. Only effective-lifecycle `active` plans are eligible. A legacy plan
 *    without lifecycle metadata resolves to `active` at read time (the shared
 *    STEP 24/25 default), so it is eligible. `needs-review`, `replaced`, and
 *    `archived` plans are never assignable as primary.
 * 4. Read-time resolution vocabulary. A stored selection resolves to exactly
 *    one of: `no-explicit-selection`, `valid-explicit-selection`,
 *    `selected-plan-missing` (the id refers to no plan in the section), or
 *    `selected-plan-inactive` (the id refers to a plan that is not effective-
 *    active). The UI renders `missing` / `inactive` as a concise non-blocking
 *    "needs attention" state.
 * 5. No automatic fallback and no mutation. When the selected plan is later
 *    archived, replaced, marked for review, or removed, nothing here (or
 *    anywhere) promotes another plan, rewrites the stored id, or repairs the
 *    selection. The stored id is preserved as-is; the projection reports the
 *    truth.
 * 6. Non-mutating and order-stable. Input arrays are read-only; the partition
 *    returns new arrays that preserve original relative order inside each
 *    group, and plan objects are never modified or cloned.
 * 7. No environment. This module reads no clock, no network, no lifecycle
 *    transition, and no framework, and never touches persistence. It reuses
 *    the single STEP 24 lifecycle vocabulary and the STEP 25 projection
 *    helpers instead of defining a second lifecycle or selection concept.
 */
import type { TripPlanLifecycleState } from '../../types/trip';
import { getEffectiveTripPlanLifecycleState, isActiveReference } from './planningLifecycle';
import type { LifecycleCodedPlan } from './planningReferenceProjection';
import { getEffectivePlanningReferenceState } from './planningReferenceProjection';

/** A plan record shape the selection model can address by stable id. */
export interface SelectablePlan extends LifecycleCodedPlan {
  readonly id: string;
}

/**
 * The read-time state of a section-level primary selection. The vocabulary is
 * deliberately explicit about why a selection is unusable: the referenced plan
 * is missing, or it exists but is not effective-active.
 */
export type PrimarySelectionState =
  | 'no-explicit-selection'
  | 'valid-explicit-selection'
  | 'selected-plan-missing'
  | 'selected-plan-inactive';

/**
 * The resolution of a section-level primary selection at read time. `selectedId`
 * is the stored (trimmed) id when present; `selectedPlan` is the referenced
 * effective-active plan only when the selection resolves as valid. `reason`
 * carries a concise, honest explanation for the non-valid states, and
 * `inactiveState` records the actual lifecycle state behind a
 * `selected-plan-inactive` resolution (informational only).
 */
export interface PrimarySelectionResolution {
  state: PrimarySelectionState;
  selectedId: string | undefined;
  selectedPlan: SelectablePlan | undefined;
  inactiveState: TripPlanLifecycleState | undefined;
  reason: string | null;
}

/**
 * True when `value` is a structurally valid primary selection id: a string
 * with non-whitespace content. Cross-reference validity (does the id name an
 * effective-active plan in the section) is resolved separately and never
 * judged here.
 */
export function isPrimaryPlanId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normalizes an untrusted primary selection id, or returns `null` when it
 * cannot be safely carried (a non-string or empty/whitespace value rejects the
 * owning section/update — never guessed). A present id is stored trimmed,
 * matching how plan ids are trimmed on save so lookups always agree. Absent
 * values are handled by callers; this function only judges a present value.
 * Never throws.
 */
export function normalizePrimaryPlanId(value: unknown): string | null {
  if (!isPrimaryPlanId(value)) return null;
  return value.trim();
}

/**
 * True when a plan is eligible to be explicitly selected as the primary
 * reference: it is effective-lifecycle `active` (including legacy plans that
 * resolve to the read-time `active` default). `needs-review`, `replaced`, and
 * `archived` plans are never eligible.
 */
export function isPlanEligibleAsPrimary(plan: LifecycleCodedPlan): boolean {
  return isActiveReference(getEffectiveTripPlanLifecycleState(plan.lifecycleState));
}

/**
 * Resolves a section's stored primary selection id against its plan list.
 * Absent selection ids resolve to `no-explicit-selection` (an explicit `null`
 * — the persisted STEP 28 "cleared" outcome — is treated as absent too); a
 * present id that names no plan in the section resolves to
 * `selected-plan-missing`; a present id naming a plan whose effective
 * lifecycle is not `active` resolves to `selected-plan-inactive` (with the
 * actual state recorded). Only an effective `active` match resolves as
 * `valid-explicit-selection`. Pure and read-only: plans are never mutated and
 * nothing is ever repaired or auto-promoted.
 */
export function resolvePrimarySelection(
  selectedId: string | null | undefined,
  plans: ReadonlyArray<SelectablePlan>
): PrimarySelectionResolution {
  if (selectedId === undefined || selectedId === null || selectedId.trim().length === 0) {
    return {
      state: 'no-explicit-selection',
      selectedId: undefined,
      selectedPlan: undefined,
      inactiveState: undefined,
      reason: null,
    };
  }
  const plan = plans.find((candidate) => candidate.id === selectedId);
  if (plan === undefined) {
    return {
      state: 'selected-plan-missing',
      selectedId,
      selectedPlan: undefined,
      inactiveState: undefined,
      reason: `The selected primary reference "${selectedId}" is missing from this section.`,
    };
  }
  if (!isPlanEligibleAsPrimary(plan)) {
    return {
      state: 'selected-plan-inactive',
      selectedId,
      selectedPlan: undefined,
      inactiveState: getEffectivePlanningReferenceState(plan),
      reason: `The selected primary reference "${selectedId}" is not an active reference (${getEffectivePlanningReferenceState(plan)}).`,
    };
  }
  return {
    state: 'valid-explicit-selection',
    selectedId,
    selectedPlan: plan,
    inactiveState: undefined,
    reason: null,
  };
}

/**
 * Order-preserving projection partition of plan references that distinguishes
 * the explicitly selected primary reference from the remaining eligible active
 * references, plus the two review/retirement groups:
 * - `selected` — the explicitly selected effective-active plan, when the
 *   selection resolves as valid (exactly zero or one record).
 * - `eligibleActive` — every other effective-active reference (legacy plans
 *   included). When the selection is absent or invalid this is every active
 *   reference; nothing is promoted into `selected`.
 * - `needsReview` — references the owner marked for review.
 * - `secondary` — replaced/archived references (the existing STEP 25 group).
 */
export interface PrimaryReferencePartition<T extends SelectablePlan> {
  selected: T[];
  eligibleActive: T[];
  needsReview: T[];
  secondary: T[];
}

/**
 * Partitions `plans` by lifecycle with the section's explicit primary
 * selection applied. The returned `resolution` is what the UI should use to
 * render the "Primary selected / No primary selected / needs attention" states;
 * the `partition` is purely derived from the resolution and the lifecycle
 * buckets. Non-mutating and order-stable: plans are never modified, original
 * relative order is preserved inside each group, and an invalid or absent
 * selection never promotes an automatic primary.
 */
export function partitionPlanningReferencesWithPrimary<T extends SelectablePlan>(
  plans: ReadonlyArray<T>,
  selectedId: string | null | undefined
): { partition: PrimaryReferencePartition<T>; resolution: PrimarySelectionResolution } {
  const resolution = resolvePrimarySelection(selectedId, plans);
  const partition: PrimaryReferencePartition<T> = {
    selected: [],
    eligibleActive: [],
    needsReview: [],
    secondary: [],
  };
  for (const plan of plans) {
    const state = getEffectivePlanningReferenceState(plan);
    if (state === 'active') {
      if (resolution.state === 'valid-explicit-selection' && plan.id === resolution.selectedId) {
        partition.selected.push(plan);
      } else {
        partition.eligibleActive.push(plan);
      }
    } else if (state === 'needs-review') {
      partition.needsReview.push(plan);
    } else {
      partition.secondary.push(plan);
    }
  }
  return { partition, resolution };
}

/**
 * True when a primary-selection resolution needs the owner's attention: the
 * stored selection references a plan that is missing from the section or that
 * is not effective-active. These states render as a concise non-blocking
 * "Primary assignment needs attention" notice; nothing auto-repairs them.
 */
export function isPrimarySelectionAttentionState(state: PrimarySelectionState): boolean {
  return state === 'selected-plan-missing' || state === 'selected-plan-inactive';
}

/**
 * Honest read-only status wording for a primary selection state (STEP 26). A
 * valid selection says "Primary selected"; no selection says "No primary
 * selected"; a missing or inactive selection says "Primary assignment needs
 * attention". No wording here ever claims a booking, verification, availability,
 * or an automatic promotion.
 */
export function getPrimarySelectionStatusLabel(state: PrimarySelectionState): string {
  switch (state) {
    case 'no-explicit-selection':
      return 'No primary selected';
    case 'valid-explicit-selection':
      return 'Primary selected';
    case 'selected-plan-missing':
    case 'selected-plan-inactive':
      return 'Primary assignment needs attention';
  }
}
