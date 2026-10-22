/**
 * Pure planning-reference lifecycle projection (STEP 25).
 *
 * This module owns the read-time interpretation of plan lifecycle for the
 * read-only planning surfaces. It distinguishes `active` (including legacy
 * records with no lifecycle metadata), `needs-review`, `replaced`, and
 * `archived` references using the single STEP 24 lifecycle vocabulary from
 * `planningLifecycle.ts` — it never defines a second lifecycle concept.
 *
 * Projection rules that keep it honest and safe:
 *
 * 1. Legacy-first read-time default. A plan whose `lifecycleState` is absent
 *    is treated as `active` at read time only; nothing here (or anywhere)
 *    ever writes that value back to the record.
 * 2. Display-only semantics. These helpers classify and partition; they never
 *    transition, timestamp, stale, verify, replace, deduplicate, or delete a
 *    reference, and they never recommend a replacement.
 * 3. Non-mutating and order-stable. Input arrays are read-only; partitions
 *    return new arrays that preserve the original relative order inside each
 *    group, and plan objects are never modified or cloned by the projection.
 * 4. No inference. Lifecycle is never inferred from provenance, notes, dates,
 *    URLs, or timestamps; a plan with provenance but no lifecycle still reads
 *    as `active`/primary, and provenance stays a separate label.
 * 5. No environment. This module reads no clock, no network, and no framework
 *    (no React, Firebase, Router, or Zustand), and never touches persistence.
 */
import type { TripPlanLifecycleState } from '../../types/trip';
import { getEffectiveTripPlanLifecycleState } from './planningLifecycle';

/** A plan record shape that carries the optional STEP 24 lifecycle metadata. */
export interface LifecycleCodedPlan {
  readonly lifecycleState?: TripPlanLifecycleState;
}

/** Deterministic count of references by lifecycle bucket (STEP 25 projection). */
export interface TripPlanReferenceCounts {
  active: number;
  needsReview: number;
  replaced: number;
  archived: number;
  /** `replaced` + `archived` — the references kept off the primary display. */
  secondary: number;
  total: number;
}

/** Order-preserving projection split of plan references (STEP 25). */
export interface TripPlanReferencePartition<T extends LifecycleCodedPlan> {
  primary: T[];
  secondary: T[];
}

/**
 * True when the plan record carries no lifecycle metadata at all. Such legacy
 * records stay absent on disk and are treated as `active` at read time only —
 * never written back merely by being projected or viewed.
 */
export function isLegacyPlanningReference(plan: LifecycleCodedPlan): boolean {
  return plan.lifecycleState === undefined;
}

/**
 * The read-time lifecycle state that drives projected display: the persisted
 * value when present, otherwise the legacy default (`active`). Computed, never
 * stored — this wrapper makes the projection intent explicit at the plan level.
 */
export function getEffectivePlanningReferenceState(
  plan: LifecycleCodedPlan
): TripPlanLifecycleState {
  return getEffectiveTripPlanLifecycleState(plan.lifecycleState);
}

/**
 * True when a plan belongs in the primary planning display: it is `active`
 * (including legacy plans treated as active) or it is `needs-review` (kept in
 * the primary display and visibly marked, never hidden).
 */
export function isPrimaryPlanningReference(plan: LifecycleCodedPlan): boolean {
  const state = getEffectivePlanningReferenceState(plan);
  return state === 'active' || state === 'needs-review';
}

/**
 * True when a plan is kept off the primary display: it is `replaced` or
 * `archived`. Such references always remain accessible in the secondary
 * reading — this is a display decision, never a deletion or a replacement.
 */
export function isSecondaryPlanningReference(plan: LifecycleCodedPlan): boolean {
  const state = getEffectivePlanningReferenceState(plan);
  return state === 'replaced' || state === 'archived';
}

/** True only for the `replaced` state in effect at read time. */
export function isReplacedPlanningReference(plan: LifecycleCodedPlan): boolean {
  return getEffectivePlanningReferenceState(plan) === 'replaced';
}

/** True only for the `archived` state in effect at read time. */
export function isArchivedPlanningReference(plan: LifecycleCodedPlan): boolean {
  return getEffectivePlanningReferenceState(plan) === 'archived';
}

/**
 * Splits plan references into primary (`active`/`needs-review`, legacy
 * resolved to active) and secondary (`replaced`/`archived`) groups. The split
 * is the only transformation: original relative order is preserved inside each
 * group, nothing is deduplicated by name/URL/text, no replacement relationship
 * is inferred, and no replacement is auto-selected. The source array and its
 * plan objects are never mutated; the returned arrays reference the same
 * record objects without copying them.
 */
export function partitionPlanningReferences<T extends LifecycleCodedPlan>(
  plans: ReadonlyArray<T>
): TripPlanReferencePartition<T> {
  const primary: T[] = [];
  const secondary: T[] = [];
  for (const plan of plans) {
    if (isSecondaryPlanningReference(plan)) {
      secondary.push(plan);
    } else {
      primary.push(plan);
    }
  }
  return { primary, secondary };
}

/**
 * Deterministic per-bucket counts for a set of plan references. Totals are
 * derived purely from the records' lifecycle metadata (legacy resolves to
 * `active` at read time), so two projections of the same data always agree.
 */
export function countPlanningReferences(
  plans: ReadonlyArray<LifecycleCodedPlan>
): TripPlanReferenceCounts {
  let active = 0;
  let needsReview = 0;
  let replaced = 0;
  let archived = 0;
  for (const plan of plans) {
    const state = getEffectivePlanningReferenceState(plan);
    if (state === 'active') active += 1;
    else if (state === 'needs-review') needsReview += 1;
    else if (state === 'replaced') replaced += 1;
    else archived += 1;
  }
  return {
    active,
    needsReview,
    replaced,
    archived,
    secondary: replaced + archived,
    total: plans.length,
  };
}

/**
 * Honest read-only display wording for one plan reference. Legacy records with
 * no lifecycle metadata are labeled "Legacy reference — treated as active";
 * secondary references stay visibly labeled "Replaced reference" /
 * "Archived reference". No wording here ever claims verification, live
 * availability, a booking, expiry, or provider-confirmed currency.
 */
export function getPlanningReferenceDisplayLabel(plan: LifecycleCodedPlan): string {
  if (isLegacyPlanningReference(plan)) {
    return 'Legacy reference — treated as active';
  }
  switch (plan.lifecycleState) {
    case 'needs-review':
      return 'Needs review';
    case 'replaced':
      return 'Replaced reference';
    case 'archived':
      return 'Archived reference';
    default:
      return 'Active';
  }
}

/**
 * Deterministic one-line summary of a plan list (for a section caption), e.g.
 * `"2 active · 1 needs review · 1 archived"`. Built only from the bucket
 * counts, so it is stable across renders and identical inputs. An empty list
 * yields `"No references"` (empty collections are handled safely).
 */
export function getPlanningReferenceSummary(plans: ReadonlyArray<LifecycleCodedPlan>): string {
  const counts = countPlanningReferences(plans);
  const parts: string[] = [];
  if (counts.active > 0) parts.push(`${counts.active} active`);
  if (counts.needsReview > 0) parts.push(`${counts.needsReview} needs review`);
  if (counts.replaced > 0) parts.push(`${counts.replaced} replaced`);
  if (counts.archived > 0) parts.push(`${counts.archived} archived`);
  return parts.length > 0 ? parts.join(' · ') : 'No references';
}
