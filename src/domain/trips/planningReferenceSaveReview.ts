/**
 * Pure planning-reference save-review vocabulary (STEP 30).
 *
 * This module decides whether an explicit save needs a final user review for
 * the transport/accommodation planning-reference state, and describes the
 * specific changes being reviewed. It consumes the STEP 29 change-context
 * projection plus the effective draft plans for human-readable labels, and is
 * deliberately side-effect free and dependency-free: no React, Firebase,
 * Router, Zustand, network, clock, `any`, persistence, timestamps, ids, or
 * mutation.
 *
 * Review rules that keep the prompt honest and fatigue-free:
 *
 * 1. Saved vs draft, nothing else. The review is derived from the same two
 *    inputs the STEP 29 context compares — the persisted baseline and the
 *    effective draft. It is a read-time projection for the editor only; it is
 *    never persisted and never restores, reverted, or rewrites anything.
 * 2. A review is about a *decision to persist*. Only changes that decide the
 *    reference state of the plan are review-worthy:
 *      - a new, changed, cleared, or restored primary selection;
 *      - a lifecycle decision that moves a reference between Active, Needs
 *        review, Replaced, and Archived;
 *      - a provenance-kind change (which reference source the label claims);
 *      - a change to a reference's source URL.
 *    Ordinary notes, destinations, dates, budget, checklist tasks, plan text
 *    like mode/route/name/location, and adding/removing a reference never
 *    open a review. Deciding to save more references is not a reference-state
 *    *change*.
 * 3. Unresolved stays unresolved. A draft whose primary assignment is missing
 *    or inactive is surfaced as "will remain unresolved if saved". The review
 *    never auto-selects, auto-clears, restores, repurposes, or guesses — it
 *    communicates the state honestly and lets the user keep editing.
 * 4. Absence is honest. No stored primary on both sides ("legacy absence") is
 *    not a change, and a clear is only reported when the draft actually drops
 *    a stored selection.
 * 5. Deterministic output. Items are ordered primary-first, then by the STEP 29
 *    plan-change order, with transport before accommodation. Identical inputs
 *    always yield identical items and text, and no change ever emits more than
 *    one item.
 */
import {
  buildPlanningReferenceChangeContext,
  getAccommodationPlanReferenceLabel,
  getTransportPlanReferenceLabel,
  type ChangeContextPlan,
  type ChangeContextSections,
  type PlanningReferencePlanChange,
  type PlanningReferencePrimaryChange,
  type PlanningReferenceSection,
  type PlanningReferenceSectionChangeContext,
} from './planningReferenceChangeContext';

/** The review-worthy change kinds a save-confirmation item can describe. */
export type PlanningReferenceSaveReviewItemKind =
  | 'primary-selected'
  | 'primary-changed'
  | 'primary-cleared'
  | 'primary-restored'
  | 'primary-unresolved'
  | 'lifecycle-changed'
  | 'provenance-changed'
  | 'source-changed';

/** One review-worthy reference change the user would persist on save. */
export interface PlanningReferenceSaveReviewItem {
  /** The planning section the change belongs to. */
  section: PlanningReferenceSection;
  /** The kind of review-worthy change. */
  kind: PlanningReferenceSaveReviewItemKind;
  /** Display value before (labels/URLs), or `null` when there was none. */
  previousValue: string | null;
  /** Display value after (labels/URLs), or `null` when it will be cleared. */
  currentValue: string | null;
  /** Deterministic label of the plan the change applies to, when known. */
  planLabel: string | null;
  /** True for changes that deserve extra emphasis (unresolved, deactivation). */
  attention: boolean;
}

/** The review-worthy items collected for one planning section. */
export interface PlanningReferenceSaveReviewSection {
  section: PlanningReferenceSection;
  /** True when saving this section needs explicit confirmation. */
  shouldReview: boolean;
  /** The review-worthy items for this section, in deterministic order. */
  items: ReadonlyArray<PlanningReferenceSaveReviewItem>;
}

/** The complete save-review projection for both planning sections. */
export interface PlanningReferenceSaveReview {
  /** True when saving the draft needs a review-and-confirmation step. */
  shouldReview: boolean;
  transport: PlanningReferenceSaveReviewSection;
  accommodation: PlanningReferenceSaveReviewSection;
  /** All items, transport before accommodation, in deterministic order. */
  items: ReadonlyArray<PlanningReferenceSaveReviewItem>;
}

/** The effective draft plan collections used for human-readable labels. */
export interface PlanningReferenceSaveReviewPlans {
  readonly transportPlans: ReadonlyArray<ChangeContextPlan>;
  readonly accommodationPlans: ReadonlyArray<ChangeContextPlan>;
}

/** The STEP 29 per-section change contexts consumed by the review. */
export interface PlanningReferenceSaveReviewContextInput {
  readonly transport: PlanningReferenceSectionChangeContext;
  readonly accommodation: PlanningReferenceSectionChangeContext;
}

const SECTION_LABEL: Record<PlanningReferenceSection, string> = {
  transport: 'Transport',
  accommodation: 'Accommodation',
};

/**
 * The short display label for a planning section, used to group review items.
 * Display-only: the internal `PlanningReferenceSection` enum is preserved.
 */
export function getPlanningReferenceSaveReviewSectionLabel(
  section: PlanningReferenceSection
): string {
  return SECTION_LABEL[section];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Decides which review items the STEP 29 change context calls for. Pure and
 * read-only: nothing here mutates the contexts, selects or clears a primary,
 * repairs a lifecycle, or persists anything.
 */
export function classifyPlanningReferenceSaveReview(
  context: PlanningReferenceSaveReviewContextInput,
  plans: PlanningReferenceSaveReviewPlans
): PlanningReferenceSaveReview {
  const transport = classifySection('transport', context.transport, plans.transportPlans);
  const accommodation = classifySection(
    'accommodation',
    context.accommodation,
    plans.accommodationPlans
  );
  const items = [...transport.items, ...accommodation.items];
  return {
    shouldReview: transport.shouldReview || accommodation.shouldReview,
    transport,
    accommodation,
    items,
  };
}

/**
 * Convenience wrapper: build the STEP 29 change context from saved/draft
 * section collections and derive the save review from it in one step.
 */
export function buildPlanningReferenceSaveReview(params: {
  saved: ChangeContextSections | undefined;
  draft: ChangeContextSections | undefined;
}): PlanningReferenceSaveReview {
  const context = buildPlanningReferenceChangeContext(params);
  const savedTransportPlans = params.saved?.transportPlans ?? params.draft?.transportPlans ?? [];
  const savedAccommodationPlans =
    params.saved?.accommodationPlans ?? params.draft?.accommodationPlans ?? [];
  const draftTransportPlans = params.draft?.transportPlans ?? savedTransportPlans;
  const draftAccommodationPlans = params.draft?.accommodationPlans ?? savedAccommodationPlans;
  return classifyPlanningReferenceSaveReview(
    { transport: context.transport, accommodation: context.accommodation },
    { transportPlans: draftTransportPlans, accommodationPlans: draftAccommodationPlans }
  );
}

// ---------------------------------------------------------------------------
// Descriptive text
// ---------------------------------------------------------------------------

/**
 * One honest, deterministic sentence describing a review item for the editor's
 * confirmation panel. The sentence is category-led (for example "Primary
 * reference …" or "Lifecycle …") and intentionally omits the planning section,
 * because the panel renders each section's items under its own heading.
 * Planning-designation wording only; never a booking, payment, verification, or
 * availability claim.
 */
export function describePlanningReferenceSaveReviewItem(
  item: PlanningReferenceSaveReviewItem
): string {
  switch (item.kind) {
    case 'primary-selected':
      return `Primary reference will be set to ${quote(item.currentValue)}.`;
    case 'primary-changed':
      return `Primary reference will change from ${quote(item.previousValue)} to ${quote(
        item.currentValue
      )}.`;
    case 'primary-cleared':
      return 'Primary reference will be cleared.';
    case 'primary-restored':
      return `Primary reference will be restored to Active (${quote(item.currentValue)}).`;
    case 'primary-unresolved':
      return 'Primary reference is unresolved and will remain unresolved if saved.';
    case 'lifecycle-changed':
      return `Lifecycle for ${quote(item.planLabel)} will change from ${quote(
        item.previousValue
      )} to ${quote(item.currentValue)}.`;
    case 'provenance-changed':
      return `Provenance for ${quote(item.planLabel)} will change from ${quote(
        item.previousValue
      )} to ${quote(item.currentValue)}.`;
    case 'source-changed':
      return `Source URL for ${quote(item.planLabel)} will change.`;
  }
}

/**
 * Optional actionable guidance for a review item that needs a decision. Kept
 * neutral and honest: it names the user's own options and never auto-selects,
 * clears, restores, or repairs anything. Returns `null` when no extra guidance
 * is warranted.
 */
export function getPlanningReferenceSaveReviewItemGuidance(
  item: PlanningReferenceSaveReviewItem
): string | null {
  if (item.kind !== 'primary-unresolved') return null;
  return 'Select another active reference, clear the assignment, or restore the plan to active.';
}

function quote(value: string | null): string {
  return `“${value ?? 'none'}”`;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function classifySection(
  section: PlanningReferenceSection,
  context: PlanningReferenceSectionChangeContext,
  draftPlans: ReadonlyArray<ChangeContextPlan>
): PlanningReferenceSaveReviewSection {
  const items: PlanningReferenceSaveReviewItem[] = [];

  if (context.unresolved) {
    items.push({
      section,
      kind: 'primary-unresolved',
      previousValue: context.primary.previousLabel,
      currentValue: context.primary.currentLabel,
      planLabel: context.primary.currentLabel,
      attention: true,
    });
  } else {
    const primaryItem = buildPrimaryItem(section, context.primary);
    if (primaryItem !== null) items.push(primaryItem);
  }

  for (const change of context.planChanges) {
    const item = buildPlanChangeItem(section, change, draftPlans);
    if (item !== null) items.push(item);
  }

  return { section, shouldReview: items.length > 0, items };
}

function buildPrimaryItem(
  section: PlanningReferenceSection,
  primary: PlanningReferencePrimaryChange
): PlanningReferenceSaveReviewItem | null {
  switch (primary.kind) {
    case 'selected':
      return {
        section,
        kind: 'primary-selected',
        previousValue: null,
        currentValue: primary.currentLabel,
        planLabel: primary.currentLabel,
        attention: false,
      };
    case 'changed':
      return {
        section,
        kind: 'primary-changed',
        previousValue: primary.previousLabel,
        currentValue: primary.currentLabel,
        planLabel: primary.currentLabel,
        attention: false,
      };
    case 'cleared':
      return {
        section,
        kind: 'primary-cleared',
        previousValue: primary.previousLabel,
        currentValue: null,
        planLabel: primary.previousLabel,
        attention: false,
      };
    case 'restored':
      return {
        section,
        kind: 'primary-restored',
        previousValue: primary.previousLabel,
        currentValue: primary.currentLabel,
        planLabel: primary.currentLabel,
        attention: false,
      };
    case 'none':
    case 'unresolved':
      // `unresolved` is surfaced by the context.unresolved branch above, never
      // here, so it cannot be emitted twice.
      return null;
  }
}

function buildPlanChangeItem(
  section: PlanningReferenceSection,
  change: PlanningReferencePlanChange,
  draftPlans: ReadonlyArray<ChangeContextPlan>
): PlanningReferenceSaveReviewItem | null {
  switch (change.kind) {
    case 'lifecycle':
      return {
        section,
        kind: 'lifecycle-changed',
        previousValue: change.previousValue,
        currentValue: change.currentValue,
        planLabel: findPlanLabel(section, draftPlans, change.planId),
        attention: change.currentValue !== 'Active',
      };
    case 'provenance':
      return {
        section,
        kind: 'provenance-changed',
        previousValue: change.previousValue,
        currentValue: change.currentValue,
        planLabel: findPlanLabel(section, draftPlans, change.planId),
        attention: false,
      };
    case 'source':
      return {
        section,
        kind: 'source-changed',
        previousValue: change.previousValue,
        currentValue: change.currentValue,
        planLabel: findPlanLabel(section, draftPlans, change.planId),
        attention: false,
      };
    case 'reference-added':
    case 'reference-removed':
      // Saving more or fewer references is not a reference-state change.
      return null;
  }
}

function findPlanLabel(
  section: PlanningReferenceSection,
  plans: ReadonlyArray<ChangeContextPlan>,
  planId: string
): string | null {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (plan === undefined) return null;
  return section === 'transport'
    ? getTransportPlanReferenceLabel(plan)
    : getAccommodationPlanReferenceLabel(plan);
}
