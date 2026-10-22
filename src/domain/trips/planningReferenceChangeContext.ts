/**
 * Pure planning-reference change-context vocabulary (STEP 29).
 *
 * This module owns the transient, user-visible description of how the current
 * draft's transport/accommodation planning sections differ from the persisted
 * snapshot: a new primary selection, a changed or cleared selection, a restored
 * inactive primary, a lifecycle, provenance, or source change on an existing
 * reference, and references added or removed in the draft. It is deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches.
 *
 * Change-context rules that keep it honest and safe:
 *
 * 1. Saved vs draft, nothing else. This module compares a persisted baseline
 *    (the itinerary snapshot's `transportPlans` / `accommodationPlans` and the
 *    stored primary ids) against the effective draft values. It is derived from
 *    those two inputs only — there is no audit log, no history, no timestamps,
 *    and no user identifiers.
 * 2. Transient only. The result is a read-time projection for the editor. No
 *    resolution record, change record, or history is ever persisted, and no
 *    saved value is ever rewritten or repaired by this module.
 * 3. No automatic resolution. Nothing here selects, clears, promotes, restores,
 *    or repairs a primary reference. An unresolved draft simply stays
 *    unresolved and is reported honestly.
 * 4. Absence is honest. A missing primary id on both sides is unchanged (a
 *    legacy trip with no stored id is never reported as "cleared"), and a
 *    legitimate explicit clear is only reported when the draft actually has no
 *    selection where the saved snapshot had one.
 * 5. Effective states, not stored ones. Lifecycle is compared through the
 *    shared STEP 24/25 read-time effective state (`active` for absent legacy
 *    metadata), so an untouched legacy plan is never reported as a lifecycle
 *    change.
 * 6. Deterministic output. Messages are assembled in a fixed order from the
 *    descriptors produced by the comparison, so identical inputs always yield
 *    identical text. One consolidated line per section, joined with single
 *    spaces, and `null` when nothing changed.
 * 7. Honest wording. Every descriptor describes a planning designation and a
 *    draft-vs-saved difference. No wording here claims a booking, verification,
 *    availability, payment, or an automatic fix.
 */
import type {
  TripPlanLifecycleState,
  TripPlanProvenance,
  TripPlanProvenanceKind,
} from '../../types/trip';
import { getEffectiveTripPlanLifecycleState, getTripPlanLifecycleLabel } from './planningLifecycle';
import { getTripPlanProvenanceLabel } from './planningProvenance';
import {
  type PrimaryAssignmentStatus,
  isPrimaryAssignmentAttentionNeeded,
  resolvePrimaryAssignmentStatus,
} from './planningReferenceConflict';

/** The editable planning sections this change context describes. */
export type PlanningReferenceSection = 'transport' | 'accommodation';

/**
 * The section-level change headline. It is derived from the most important
 * difference present: a primary change outranks the plan-level descriptors.
 */
export type PlanningReferenceSectionChangeKind =
  | 'unchanged'
  | 'primary-selected'
  | 'primary-changed'
  | 'primary-cleared'
  | 'primary-restored'
  | 'primary-unresolved'
  | 'lifecycle-changed'
  | 'provenance-changed'
  | 'source-changed'
  | 'reference-added'
  | 'reference-removed';

/** How the section's primary reference changed between saved and draft. */
export type PlanningReferencePrimaryChangeKind =
  'none' | 'selected' | 'changed' | 'cleared' | 'restored' | 'unresolved';

/** The per-plan differences that can be reported by the change context. */
export type PlanningReferencePlanChangeKind =
  'reference-added' | 'reference-removed' | 'lifecycle' | 'provenance' | 'source';

/**
 * The minimal structural plan shape the change context reads. `TripTransportPlan`
 * and `TripAccommodationPlan` both satisfy this shape, so the module stays
 * disconnected from the full persisted plan vocabulary.
 */
export interface ChangeContextPlan {
  readonly id: string;
  readonly lifecycleState?: TripPlanLifecycleState;
  readonly provenance?: TripPlanProvenance;
  readonly sourceUrl?: string;
}

/** Transport plan shape extended for deterministic reference labels. */
export interface TransportReferenceChangePlan extends ChangeContextPlan {
  readonly mode?: string;
  readonly departureLocation?: string;
  readonly arrivalLocation?: string;
}

/** Accommodation plan shape extended for deterministic reference labels. */
export interface AccommodationReferenceChangePlan extends ChangeContextPlan {
  readonly name?: string;
  readonly location?: string;
}

/** Inputs for one section: the persisted baseline vs the effective draft values. */
export interface PlanningReferenceSectionInput {
  /** The persisted baseline plan list (`trip.itinerary.transportPlans` etc). */
  savedPlans: ReadonlyArray<ChangeContextPlan>;
  /** The persisted baseline primary id, when one is stored. */
  savedPrimaryPlanId: string | null | undefined;
  /** The effective draft plan list (mirrors the saved list when untouched). */
  draftPlans: ReadonlyArray<ChangeContextPlan>;
  /** The effective draft primary id (`null` stages an explicit clear). */
  draftPrimaryPlanId: string | null | undefined;
}

/** The primary-change portion of a section context. */
export interface PlanningReferencePrimaryChange {
  kind: PlanningReferencePrimaryChangeKind;
  /** The saved selection id, or `null` when absent. */
  previousId: string | null;
  /** The draft selection id, or `null` when absent/cleared. */
  currentId: string | null;
  /** Deterministic plan label for the saved selection (fallback: the id). */
  previousLabel: string | null;
  /** Deterministic plan label for the draft selection (fallback: the id). */
  currentLabel: string | null;
  /** The saved primary-assignment status (`null` only when previousId is null). */
  previousStatus: PrimaryAssignmentStatus | null;
  /** The draft primary-assignment status. */
  currentStatus: PrimaryAssignmentStatus;
}

/** One reported per-plan difference between saved and draft. */
export interface PlanningReferencePlanChange {
  planId: string;
  kind: PlanningReferencePlanChangeKind;
  /** Display value before (lifecycle/provenance labels; trimmed source URLs). */
  previousValue: string;
  /** Display value after (lifecycle/provenance labels; trimmed source URLs). */
  currentValue: string;
}

/** The change context for one planning section. */
export interface PlanningReferenceSectionChangeContext {
  section: PlanningReferenceSection;
  /** True when the draft differs from the saved snapshot for this section. */
  changed: boolean;
  /** The headline change kind (`unchanged` when nothing differs). */
  kind: PlanningReferenceSectionChangeKind;
  /** The primary-change classification. */
  primary: PlanningReferencePrimaryChange;
  /** Every reported per-plan difference, in deterministic order. */
  planChanges: ReadonlyArray<PlanningReferencePlanChange>;
  /** True when the *draft* primary assignment is still in a conflict state. */
  unresolved: boolean;
  /**
   * One consolidated, deterministic line of descriptors, or `null` when
   * unchanged. `null` always means "no change to report".
   */
  message: string | null;
}

/** The combined change context for both planning sections. */
export interface PlanningReferenceChangeContext {
  /** True when either section changed. */
  changed: boolean;
  transport: PlanningReferenceSectionChangeContext;
  accommodation: PlanningReferenceSectionChangeContext;
}

/** Saved/draft section collections accepted by the combined convenience helper. */
export interface ChangeContextSections {
  readonly transportPlans?: ReadonlyArray<ChangeContextPlan>;
  readonly accommodationPlans?: ReadonlyArray<ChangeContextPlan>;
  readonly primaryTransportPlanId?: string | null;
  readonly primaryAccommodationPlanId?: string | null;
}

// ---------------------------------------------------------------------------
// Descriptor strings (honest, planning-only, deterministic)
// ---------------------------------------------------------------------------

const PRIMARY_SELECTED_MESSAGE = 'Primary reference selected in this draft.';
const PRIMARY_CLEARED_MESSAGE = 'Primary assignment cleared in this draft.';
const PRIMARY_RESTORED_MESSAGE = 'Existing primary reference restored to active in this draft.';
const PRIMARY_UNRESOLVED_MESSAGE = 'Primary assignment remains unresolved.';
const SOURCE_CHANGED_MESSAGE = 'Planning reference source URL changed in this draft.';
const REFERENCE_ADDED_MESSAGE = 'A planning reference was added in this draft.';
const REFERENCE_REMOVED_MESSAGE = 'A planning reference was removed in this draft.';
const NO_PROVENANCE_LABEL = 'No provenance';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Deterministic display label for a transport reference (STEP 29). Route
 * labels read like `Flight (Jakarta → Bali)`; a plan without a route falls back
 * to the mode or the neutral `Transport plan` placeholder. Never empty.
 */
export function getTransportPlanReferenceLabel(plan: TransportReferenceChangePlan): string {
  const route =
    plan.departureLocation !== undefined && plan.arrivalLocation !== undefined
      ? `${plan.departureLocation} → ${plan.arrivalLocation}`
      : (plan.departureLocation ?? plan.arrivalLocation);
  if (plan.mode !== undefined && plan.mode !== '') {
    return route !== undefined ? `${plan.mode} (${route})` : plan.mode;
  }
  return route !== undefined ? route : 'Transport plan';
}

/**
 * Deterministic display label for an accommodation reference (STEP 29).
 * Prefers `Name (Location)`, then the name, then `Stay in <location>`, falling
 * back to the neutral `Accommodation plan` placeholder. Never empty.
 */
export function getAccommodationPlanReferenceLabel(plan: AccommodationReferenceChangePlan): string {
  if (plan.name !== undefined && plan.name !== '') {
    return plan.location !== undefined && plan.location !== ''
      ? `${plan.name} (${plan.location})`
      : plan.name;
  }
  return plan.location !== undefined && plan.location !== ''
    ? `Stay in ${plan.location}`
    : 'Accommodation plan';
}

function findPlanLabel(
  section: PlanningReferenceSection,
  plans: ReadonlyArray<ChangeContextPlan>,
  planId: string
): string {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (plan === undefined) return planId;
  return section === 'transport'
    ? getTransportPlanReferenceLabel(plan)
    : getAccommodationPlanReferenceLabel(plan);
}

// ---------------------------------------------------------------------------
// Change comparison
// ---------------------------------------------------------------------------

/**
 * Compares one section's persisted baseline against its effective draft values
 * and reports the transient user-visible change context. Pure and read-only:
 * plans are never mutated, nothing is auto-selected, auto-cleared, or repaired,
 * and no result is persisted. `null`/empty/whitespace primary ids are treated
 * as absent on both sides (matching the STEP 26/28 selection semantics).
 */
export function comparePlanningReferenceSectionChange(
  section: PlanningReferenceSection,
  input: PlanningReferenceSectionInput
): PlanningReferenceSectionChangeContext {
  const savedId = normalizePrimaryId(input.savedPrimaryPlanId);
  const draftId = normalizePrimaryId(input.draftPrimaryPlanId);
  const savedStatus = resolvePrimaryAssignmentStatus(savedId, input.savedPlans);
  const draftStatus = resolvePrimaryAssignmentStatus(draftId, input.draftPlans);

  const primary = classifyPrimaryChange(
    section,
    savedId,
    draftId,
    savedStatus,
    draftStatus,
    input.savedPlans,
    input.draftPlans
  );
  const planChanges = collectPlanChanges(input.savedPlans, input.draftPlans);
  const descriptors = buildDescriptors(primary, planChanges);

  let message: string | null;
  if (descriptors.length > 0) {
    message = descriptors.join(' ');
  } else if (primary.kind === 'unresolved') {
    message = PRIMARY_UNRESOLVED_MESSAGE;
  } else {
    message = null;
  }

  return {
    section,
    changed: primary.kind !== 'none' || planChanges.length > 0,
    kind: deriveSectionKind(primary.kind, planChanges),
    primary,
    planChanges,
    unresolved: isPrimaryAssignmentAttentionNeeded(draftStatus),
    message,
  };
}

/**
 * Combine the transport and accommodation section contexts. `saved` is the
 * persisted itinerary snapshot sections; `draft` is the effective draft
 * sections (which mirror `saved` when untouched). When `draft` is undefined
 * there is nothing new to report — an absent draft is never read as a clear.
 */
export function buildPlanningReferenceChangeContext(params: {
  saved: ChangeContextSections | undefined;
  draft: ChangeContextSections | undefined;
}): PlanningReferenceChangeContext {
  if (params.draft === undefined) {
    return {
      changed: false,
      transport: comparePlanningReferenceSectionChange('transport', {
        savedPlans: params.saved?.transportPlans ?? [],
        savedPrimaryPlanId: params.saved?.primaryTransportPlanId,
        draftPlans: params.saved?.transportPlans ?? [],
        draftPrimaryPlanId: params.saved?.primaryTransportPlanId,
      }),
      accommodation: comparePlanningReferenceSectionChange('accommodation', {
        savedPlans: params.saved?.accommodationPlans ?? [],
        savedPrimaryPlanId: params.saved?.primaryAccommodationPlanId,
        draftPlans: params.saved?.accommodationPlans ?? [],
        draftPrimaryPlanId: params.saved?.primaryAccommodationPlanId,
      }),
    };
  }
  const transport = comparePlanningReferenceSectionChange('transport', {
    savedPlans: params.saved?.transportPlans ?? [],
    savedPrimaryPlanId: params.saved?.primaryTransportPlanId,
    draftPlans: params.draft.transportPlans ?? [],
    draftPrimaryPlanId: params.draft.primaryTransportPlanId,
  });
  const accommodation = comparePlanningReferenceSectionChange('accommodation', {
    savedPlans: params.saved?.accommodationPlans ?? [],
    savedPrimaryPlanId: params.saved?.primaryAccommodationPlanId,
    draftPlans: params.draft.accommodationPlans ?? [],
    draftPrimaryPlanId: params.draft.primaryAccommodationPlanId,
  });
  return {
    changed: transport.changed || accommodation.changed,
    transport,
    accommodation,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function normalizePrimaryId(id: string | null | undefined): string | undefined {
  if (id === undefined || id === null) return undefined;
  const trimmed = id.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function classifyPrimaryChange(
  section: PlanningReferenceSection,
  savedId: string | undefined,
  draftId: string | undefined,
  savedStatus: PrimaryAssignmentStatus,
  draftStatus: PrimaryAssignmentStatus,
  savedPlans: ReadonlyArray<ChangeContextPlan>,
  draftPlans: ReadonlyArray<ChangeContextPlan>
): PlanningReferencePrimaryChange {
  const previousId = savedId ?? null;
  const currentId = draftId ?? null;
  const previousLabel = savedId !== undefined ? findPlanLabel(section, savedPlans, savedId) : null;
  const currentLabel = draftId !== undefined ? findPlanLabel(section, draftPlans, draftId) : null;

  let kind: PlanningReferencePrimaryChangeKind;
  if (savedId === draftId && savedStatus === draftStatus) {
    kind = 'none';
  } else if (savedStatus === 'none' && draftStatus === 'valid') {
    kind = 'selected';
  } else if (draftStatus === 'valid' && savedId !== draftId) {
    kind = 'changed';
  } else if (savedId === draftId && savedStatus === 'inactive' && draftStatus === 'valid') {
    kind = 'restored';
  } else if (savedId === draftId && savedStatus === 'missing' && draftStatus === 'valid') {
    kind = 'selected';
  } else if (draftStatus === 'none') {
    kind = 'cleared';
  } else {
    kind = 'unresolved';
  }

  return {
    kind,
    previousId,
    currentId,
    previousLabel,
    currentLabel,
    previousStatus: previousId !== null ? savedStatus : null,
    currentStatus: draftStatus,
  };
}

function collectPlanChanges(
  savedPlans: ReadonlyArray<ChangeContextPlan>,
  draftPlans: ReadonlyArray<ChangeContextPlan>
): ReadonlyArray<PlanningReferencePlanChange> {
  const savedById = new Map<string, ChangeContextPlan>();
  for (const plan of savedPlans) savedById.set(plan.id, plan);
  const draftById = new Map<string, ChangeContextPlan>();
  for (const plan of draftPlans) draftById.set(plan.id, plan);

  const changes: PlanningReferencePlanChange[] = [];
  for (const plan of draftPlans) {
    const saved = savedById.get(plan.id);
    if (saved === undefined) {
      changes.push({
        planId: plan.id,
        kind: 'reference-added',
        previousValue: '',
        currentValue: '',
      });
      continue;
    }
    const previousLifecycle = getEffectiveTripPlanLifecycleState(saved.lifecycleState);
    const currentLifecycle = getEffectiveTripPlanLifecycleState(plan.lifecycleState);
    if (previousLifecycle !== currentLifecycle) {
      changes.push({
        planId: plan.id,
        kind: 'lifecycle',
        previousValue: getTripPlanLifecycleLabel(previousLifecycle),
        currentValue: getTripPlanLifecycleLabel(currentLifecycle),
      });
    }
    const previousKind: TripPlanProvenanceKind | undefined = saved.provenance?.kind;
    const currentKind: TripPlanProvenanceKind | undefined = plan.provenance?.kind;
    if (previousKind !== currentKind) {
      changes.push({
        planId: plan.id,
        kind: 'provenance',
        previousValue:
          previousKind !== undefined
            ? getTripPlanProvenanceLabel(previousKind)
            : NO_PROVENANCE_LABEL,
        currentValue:
          currentKind !== undefined ? getTripPlanProvenanceLabel(currentKind) : NO_PROVENANCE_LABEL,
      });
    }
    const previousUrl = (saved.sourceUrl ?? '').trim();
    const currentUrl = (plan.sourceUrl ?? '').trim();
    if (previousUrl !== currentUrl) {
      changes.push({
        planId: plan.id,
        kind: 'source',
        previousValue: previousUrl,
        currentValue: currentUrl,
      });
    }
  }
  for (const plan of savedPlans) {
    if (!draftById.has(plan.id)) {
      changes.push({
        planId: plan.id,
        kind: 'reference-removed',
        previousValue: '',
        currentValue: '',
      });
    }
  }
  return changes;
}

function buildDescriptors(
  primary: PlanningReferencePrimaryChange,
  planChanges: ReadonlyArray<PlanningReferencePlanChange>
): string[] {
  const descriptors: string[] = [];
  switch (primary.kind) {
    case 'selected':
      descriptors.push(PRIMARY_SELECTED_MESSAGE);
      break;
    case 'changed':
      descriptors.push(
        `Primary reference changed from "${primary.previousLabel}" to "${primary.currentLabel}" in this draft.`
      );
      break;
    case 'cleared':
      descriptors.push(PRIMARY_CLEARED_MESSAGE);
      break;
    case 'restored':
      descriptors.push(PRIMARY_RESTORED_MESSAGE);
      break;
    case 'none':
    case 'unresolved':
      break;
  }
  for (const change of planChanges) {
    switch (change.kind) {
      case 'lifecycle':
        descriptors.push(
          `Planning reference lifecycle changed from "${change.previousValue}" to "${change.currentValue}" in this draft.`
        );
        break;
      case 'provenance':
        descriptors.push(
          `Planning reference provenance changed from "${change.previousValue}" to "${change.currentValue}" in this draft.`
        );
        break;
      case 'source':
        descriptors.push(SOURCE_CHANGED_MESSAGE);
        break;
      case 'reference-added':
        descriptors.push(REFERENCE_ADDED_MESSAGE);
        break;
      case 'reference-removed':
        descriptors.push(REFERENCE_REMOVED_MESSAGE);
        break;
    }
  }
  return descriptors;
}

function deriveSectionKind(
  primaryKind: PlanningReferencePrimaryChangeKind,
  planChanges: ReadonlyArray<PlanningReferencePlanChange>
): PlanningReferenceSectionChangeKind {
  switch (primaryKind) {
    case 'selected':
      return 'primary-selected';
    case 'changed':
      return 'primary-changed';
    case 'cleared':
      return 'primary-cleared';
    case 'restored':
      return 'primary-restored';
    case 'unresolved':
      return 'primary-unresolved';
    case 'none':
      break;
  }
  const first = planChanges[0];
  switch (first?.kind) {
    case 'lifecycle':
      return 'lifecycle-changed';
    case 'provenance':
      return 'provenance-changed';
    case 'source':
      return 'source-changed';
    case 'reference-added':
      return 'reference-added';
    case 'reference-removed':
      return 'reference-removed';
    default:
      return 'unchanged';
  }
}
