/**
 * Pure, bounded editing utilities for the structured planning sections (STEP 14,
 * expanded in STEP 16 and STEP 18).
 *
 * This module owns the only typed way to mutate the editable planning
 * sections of a Trip Workspace — trip dates, destinations, daily itinerary,
 * planning notes, external references, explicitly entered transport plans,
 * accommodation plans, the numeric budget plan (STEP 16), and the
 * execution-preparation checklist `tasks` (STEP 18). It is deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches.
 *
 * Semantics of `TripPlanningUpdate`:
 * - A present key means "persist this section"; an absent key leaves the
 *   persisted section untouched.
 * - `dateRange: null` explicitly clears the trip dates.
 * - `budgetPlan: null` explicitly clears the budget plan (STEP 16).
 * - Validation is strict and wholesale: a malformed section rejects the whole
 *   update (mirroring the persistence-boundary strictness in
 *   `src/services/tripSerializationModel.ts`) rather than silently dropping
 *   items. No bookable component, payment, availability, or execution field
 *   passes through here.
 *
 * STEP 17: the transport and accommodation plan helpers now also validate and
 * carry the optional execution-readiness metadata (`readiness`) through the
 * shared plan normalizers. Applying or cloning a plan deep-copies the readiness
 * object so a successor workspace never aliases it. The AI proposal scope lock
 * in `tripPlanningProposal.ts` is unchanged — readiness rides inside the
 * user-edited plans, which AI proposals cannot touch.
 *
 * STEP 18: the checklist tasks section rides through the exact same boundary as
 * the STEP 16 sections. It is user-authored only — the AI proposal whitelist
 * (`ALLOWED_PROPOSAL_UPDATE_KEYS`) admits only the five STEP 14 sections, so no
 * proposal can ever create, edit, complete, or skip a task.
 *
 * STEP 23: the transport and accommodation plan helpers now also validate and
 * carry the optional provenance metadata (`provenance`) through the shared plan
 * normalizers. Applying or cloning a plan deep-copies the provenance object so
 * a successor workspace never aliases it. An absent provenance on a legacy plan
 * stays absent, and the dirty-check compares it like any other plan field.
 *
 * STEP 24: the transport and accommodation plan helpers now also validate and
 * carry the optional user-managed lifecycle metadata (`lifecycleState`) through
 * the shared plan normalizers. It is a scalar string, so the plain spread in
 * `clonePlanWithMetadata` copies it without aliasing risk. An absent lifecycle
 * on a legacy plan stays absent (treated as `active` at read time only), and
 * the dirty-check compares it like any other plan field.
 *
 * STEP 26: the update model also carries the optional section-level primary
 * selection ids `primaryTransportPlanId` / `primaryAccommodationPlanId`.
 * Present keys are persisted on the itinerary snapshot (a `null` value clears
 * the selection, mirroring the `budgetPlan: null` clear semantics); absent
 * keys leave the persisted selection untouched; a present-but-malformed id
 * rejects the whole update. Nothing here infers, auto-assigns, converts, or
 * repairs a selection — cross-reference and eligibility live in the read-only
 * selection projection.
 */

import type { Activity, DayPlan } from '../../types/travel';
import type {
  TripAccommodationPlan,
  TripBudgetPlan,
  TripChecklistItem,
  TripDateRange,
  TripDestination,
  TripExecutionReadiness,
  TripItinerarySnapshot,
  TripPlanProvenance,
  TripPlanningReference,
  TripPlanningUpdate,
  TripTransportPlan,
  TripWorkspace,
} from '../../types/trip';

/**
 * Maximum number of destinations a single trip may hold. Mirrors the bounded
 * destination-list guard in `firestore.rules`; the two bounds must stay in step.
 */
export const MAX_TRIP_DESTINATIONS = 20;

/** A partial planning edit owned by the page, keyed to the loaded trip id. */
export type PlanningDraft = { tripId: string } & TripPlanningUpdate;

/** Drops the trip-key from a draft so only editable sections are sent. */
export function stripTripId(draft: PlanningDraft): TripPlanningUpdate {
  const { tripId: _tripId, ...rest } = draft;
  void _tripId;
  return rest;
}
import {
  isActivityRecord,
  isTripDateRange,
  isTripDestinationRecord,
  isTripPlanningReference,
  normalizeTripAccommodationPlan,
  normalizeTripBudgetPlan,
  normalizeTripTransportPlan,
} from './tripPlanning';
import { normalizePrimaryPlanId } from './planningReferenceSelection';
import { normalizeTripChecklistItem } from './executionChecklist';

/**
 * Normalizes an untrusted payload into a valid `TripPlanningUpdate`, or returns
 * `null` when the shape cannot be repaired. Never throws. Present sections are
 * rebuilt field-by-field so runtime-only keys are stripped; a malformed section
 * (including duplicate ids) rejects the whole update.
 */
export function normalizeTripPlanningUpdate(value: unknown): TripPlanningUpdate | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_UPDATE_KEYS.includes(key))) return null;

  const update: TripPlanningUpdate = {};

  if (value.dateRange !== undefined) {
    if (value.dateRange === null) {
      update.dateRange = null;
    } else {
      if (!isTripDateRange(value.dateRange)) return null;
      update.dateRange = value.dateRange;
    }
  }

  if (value.destinations !== undefined) {
    const destinations = filterValid(value.destinations, isTripDestinationRecord);
    if (destinations === null) return null;
    if (!hasUniqueIds(destinations.map((d) => d.id))) return null;
    update.destinations = destinations;
  }

  if (value.days !== undefined) {
    const days = filterValid(value.days, isDayPlanStrict);
    if (days === null) return null;
    if (!hasUniqueDayNumbers(days)) return null;
    update.days = days;
  }

  if (value.notes !== undefined) {
    const notes = value.notes;
    if (!Array.isArray(notes) || notes.some((note) => typeof note !== 'string')) return null;
    update.notes = notes;
  }

  if (value.references !== undefined) {
    const references = filterValid(value.references, isTripPlanningReference);
    if (references === null) return null;
    if (!hasUniqueIds(references.map((reference) => reference.id))) return null;
    update.references = references;
  }

  if (value.transportPlans !== undefined) {
    const transportPlans = normalizePlanArray(value.transportPlans, normalizeTripTransportPlan);
    if (transportPlans === null) return null;
    if (!hasUniqueIds(transportPlans.map((plan) => plan.id))) return null;
    update.transportPlans = transportPlans;
  }

  if (value.accommodationPlans !== undefined) {
    const accommodationPlans = normalizePlanArray(
      value.accommodationPlans,
      normalizeTripAccommodationPlan
    );
    if (accommodationPlans === null) return null;
    if (!hasUniqueIds(accommodationPlans.map((plan) => plan.id))) return null;
    update.accommodationPlans = accommodationPlans;
  }

  if (value.budgetPlan !== undefined) {
    if (value.budgetPlan === null) {
      update.budgetPlan = null;
    } else {
      const budgetPlan = normalizeTripBudgetPlan(value.budgetPlan);
      if (budgetPlan === null) return null;
      update.budgetPlan = budgetPlan;
    }
  }

  if (value.tasks !== undefined) {
    if (value.tasks === null) {
      update.tasks = null;
    } else {
      const tasks = normalizePlanArray(value.tasks, normalizeTripChecklistItem);
      if (tasks === null) return null;
      if (!hasUniqueIds(tasks.map((task) => task.id))) return null;
      update.tasks = tasks;
    }
  }

  if (value.primaryTransportPlanId !== undefined) {
    if (value.primaryTransportPlanId === null) {
      update.primaryTransportPlanId = null;
    } else {
      const normalizedId = normalizePrimaryPlanId(value.primaryTransportPlanId);
      if (normalizedId === null) return null;
      update.primaryTransportPlanId = normalizedId;
    }
  }

  if (value.primaryAccommodationPlanId !== undefined) {
    if (value.primaryAccommodationPlanId === null) {
      update.primaryAccommodationPlanId = null;
    } else {
      const normalizedId = normalizePrimaryPlanId(value.primaryAccommodationPlanId);
      if (normalizedId === null) return null;
      update.primaryAccommodationPlanId = normalizedId;
    }
  }

  return update;
}

/**
 * Applies an editable planning update to a Trip Workspace, returning a new
 * workspace (the input is never mutated) with deep-copied nested data and
 * unchanged identity/lifecycle fields (`id`, `ownerId`, `status`,
 * `visibility`, `memberCount`, `createdAt`, `updatedAt`). Never throws.
 *
 * Notes are trimmed and empty entries dropped on application (matching the
 * projection in `buildTripPlanningData`). Itinerary-section edits (`days`,
 * `notes`, `references`, and the STEP 16/18 sections `transportPlans`,
 * `accommodationPlans`, `budgetPlan`, `tasks`) are no-ops on a legacy workspace
 * without an itinerary snapshot — routing that combination to the service
 * rejects it up front. An empty given budget plan collapses to "no plan" so
 * that clearing every field has the same effect as the explicit
 * `budgetPlan: null` clear. The STEP 26 section-level primary selection ids
 * follow the same itinerary-scoped rule: they apply only when the workspace
 * carries an itinerary snapshot, and `primary*PlanId: null` clears the
 * selection.
 */
export function applyTripPlanningUpdate(
  workspace: TripWorkspace,
  update: TripPlanningUpdate
): TripWorkspace {
  const next: TripWorkspace = {
    ...workspace,
    destinations: workspace.destinations.map(cloneDestination),
  };
  if (workspace.dateRange !== undefined) next.dateRange = { ...workspace.dateRange };
  if (workspace.itinerary) next.itinerary = cloneSnapshot(workspace.itinerary);

  if (update.dateRange === undefined) {
    // No change requested.
  } else if (update.dateRange === null) {
    delete next.dateRange;
  } else {
    next.dateRange = { startDate: update.dateRange.startDate, endDate: update.dateRange.endDate };
  }

  if (update.destinations !== undefined) {
    next.destinations = update.destinations.map(cloneDestination);
  }

  if (update.days !== undefined && next.itinerary) {
    next.itinerary.dayPlans = update.days.map(cloneDayPlan);
  }

  if (update.notes !== undefined && next.itinerary) {
    next.itinerary.notes = normalizeNotes(update.notes);
  }

  if (update.references !== undefined && next.itinerary) {
    next.itinerary.references = update.references.map((reference) => ({ ...reference }));
  }

  if (update.transportPlans !== undefined && next.itinerary) {
    next.itinerary.transportPlans = update.transportPlans.map(clonePlanWithMetadata);
  }

  if (update.accommodationPlans !== undefined && next.itinerary) {
    next.itinerary.accommodationPlans = update.accommodationPlans.map(clonePlanWithMetadata);
  }

  if (update.budgetPlan !== undefined && next.itinerary) {
    if (collapseEmptyBudgetPlan(update.budgetPlan) === null) {
      delete next.itinerary.budgetPlan;
    } else {
      next.itinerary.budgetPlan = cloneBudgetPlan(update.budgetPlan as TripBudgetPlan);
    }
  }

  if (update.tasks !== undefined && next.itinerary) {
    if (update.tasks === null || update.tasks.length === 0) {
      delete next.itinerary.tasks;
    } else {
      next.itinerary.tasks = update.tasks.map((task) => ({ ...task }));
    }
  }

  if (update.primaryTransportPlanId !== undefined && next.itinerary) {
    if (update.primaryTransportPlanId === null) {
      delete next.itinerary.primaryTransportPlanId;
    } else {
      next.itinerary.primaryTransportPlanId = update.primaryTransportPlanId;
    }
  }

  if (update.primaryAccommodationPlanId !== undefined && next.itinerary) {
    if (update.primaryAccommodationPlanId === null) {
      delete next.itinerary.primaryAccommodationPlanId;
    } else {
      next.itinerary.primaryAccommodationPlanId = update.primaryAccommodationPlanId;
    }
  }

  return next;
}

/**
 * True when at least one present section in `update` differs from the
 * persisted workspace value. Absent keys are ignored, so partial drafts only
 * compare the sections they actually carry. Empty notes normalizes to `[]` for
 * comparison so "cleared" matches a snapshot with no notes.
 */
export function isPlanningUpdateDirty(
  workspace: TripWorkspace,
  update: TripPlanningUpdate
): boolean {
  if (update.dateRange !== undefined) {
    const current = workspace.dateRange ?? null;
    if (!jsonEqual(current, update.dateRange)) return true;
  }
  if (update.destinations !== undefined) {
    if (!jsonEqual(workspace.destinations, update.destinations)) return true;
  }
  if (update.days !== undefined) {
    if (!jsonEqual(workspace.itinerary?.dayPlans ?? [], update.days)) return true;
  }
  if (update.notes !== undefined) {
    if (!jsonEqual(normalizeNotes(workspace.itinerary?.notes ?? []), normalizeNotes(update.notes)))
      return true;
  }
  if (update.references !== undefined) {
    if (!jsonEqual(workspace.itinerary?.references ?? [], update.references)) return true;
  }
  if (update.transportPlans !== undefined) {
    if (!jsonEqual(workspace.itinerary?.transportPlans ?? [], update.transportPlans)) return true;
  }
  if (update.accommodationPlans !== undefined) {
    if (!jsonEqual(workspace.itinerary?.accommodationPlans ?? [], update.accommodationPlans)) {
      return true;
    }
  }
  if (update.budgetPlan !== undefined) {
    if (
      !jsonEqual(
        collapseEmptyBudgetPlan(workspace.itinerary?.budgetPlan),
        collapseEmptyBudgetPlan(update.budgetPlan)
      )
    ) {
      return true;
    }
  }
  if (update.tasks !== undefined) {
    if (
      !jsonEqual(collapseTripTasks(workspace.itinerary?.tasks), collapseTripTasks(update.tasks))
    ) {
      return true;
    }
  }
  if (update.primaryTransportPlanId !== undefined) {
    if (
      !jsonEqual(
        workspace.itinerary?.primaryTransportPlanId ?? null,
        update.primaryTransportPlanId
      )
    ) {
      return true;
    }
  }
  if (update.primaryAccommodationPlanId !== undefined) {
    if (
      !jsonEqual(
        workspace.itinerary?.primaryAccommodationPlanId ?? null,
        update.primaryAccommodationPlanId
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns a message when `destinations` exceeds `MAX_TRIP_DESTINATIONS` and is
 * not an unchanged legacy list, or `null` when the list is acceptable.
 *
 * A list that exactly matches `existingDestinations` stays writable even when it
 * exceeds the cap, so trips created before the cap was introduced remain fully
 * editable until their destination list is next changed. `firestore.rules`
 * grants the same unchanged-list exception on update.
 */
export function getDestinationLimitProblem(
  destinations: TripDestination[],
  existingDestinations: TripDestination[]
): string | null {
  if (destinations.length <= MAX_TRIP_DESTINATIONS) return null;
  if (jsonEqual(destinations, existingDestinations)) return null;
  return `A trip can have at most ${MAX_TRIP_DESTINATIONS} destinations.`;
}

/** Options that let `getPlanningUpdateProblem` reason about the persisted trip. */
export interface PlanningUpdateProblemOptions {
  /**
   * The destinations currently persisted on the trip. When provided, an
   * over-limit destination list is accepted only when it exactly matches the
   * persisted list (the legacy-unchanged case).
   */
  existingDestinations?: TripDestination[];
}

/**
 * Returns a human-readable validation message for a draft `TripPlanningUpdate`,
 * or `null` when the update is well formed. Used by the UI to explain why Save
 * is disabled without leaking internal details.
 */
export function getPlanningUpdateProblem(
  update: TripPlanningUpdate,
  options?: PlanningUpdateProblemOptions
): string | null {
  if (
    update.dateRange !== undefined &&
    update.dateRange !== null &&
    !isTripDateRange(update.dateRange)
  ) {
    return 'Please choose a valid start and end date.';
  }

  if (update.destinations !== undefined) {
    if (filterValid(update.destinations, isTripDestinationRecord) === null) {
      return 'Every destination needs a name.';
    }
    if (!hasUniqueIds(update.destinations.map((d) => d.id))) {
      return 'Destination ids must be unique.';
    }
    if (options?.existingDestinations !== undefined) {
      const limitProblem = getDestinationLimitProblem(
        update.destinations,
        options.existingDestinations
      );
      if (limitProblem !== null) return limitProblem;
    }
  }

  if (update.days !== undefined) {
    if (filterValid(update.days, isDayPlanStrict) === null) {
      return 'Every day needs a number, title, theme, and valid activities.';
    }
    if (!hasUniqueDayNumbers(update.days)) {
      return 'Day numbers must be unique.';
    }
  }

  if (update.notes !== undefined) {
    const notes = update.notes;
    if (!Array.isArray(notes) || notes.some((note) => typeof note !== 'string')) {
      return 'Notes must be plain text.';
    }
  }

  if (update.references !== undefined) {
    if (filterValid(update.references, isTripPlanningReference) === null) {
      return 'Every reference needs a title and a safe link (http or https only).';
    }
    if (!hasUniqueIds(update.references.map((r) => r.id))) {
      return 'Reference ids must be unique.';
    }
  }

  if (update.transportPlans !== undefined) {
    if (normalizePlanArray(update.transportPlans, normalizeTripTransportPlan) === null) {
      return 'Every transport plan needs an id and well-formed departure/arrival times.';
    }
    if (!hasUniqueIds(update.transportPlans.map((plan) => plan.id))) {
      return 'Transport plan ids must be unique.';
    }
  }

  if (update.accommodationPlans !== undefined) {
    if (normalizePlanArray(update.accommodationPlans, normalizeTripAccommodationPlan) === null) {
      return 'Every accommodation plan needs an id, well-formed dates, and an end date on or after the start.';
    }
    if (!hasUniqueIds(update.accommodationPlans.map((plan) => plan.id))) {
      return 'Accommodation plan ids must be unique.';
    }
  }

  if (update.budgetPlan !== undefined && update.budgetPlan !== null) {
    if (normalizeTripBudgetPlan(update.budgetPlan) === null) {
      return 'Budget amounts must be non-negative numbers with a valid currency code.';
    }
  }

  if (update.tasks !== undefined && update.tasks !== null) {
    if (normalizePlanArray(update.tasks, normalizeTripChecklistItem) === null) {
      return 'Every checklist task needs a category, a title, and a valid due date.';
    }
    if (!hasUniqueIds(update.tasks.map((task) => task.id))) {
      return 'Checklist task ids must be unique.';
    }
  }

  if (
    update.primaryTransportPlanId !== undefined &&
    update.primaryTransportPlanId !== null &&
    normalizePrimaryPlanId(update.primaryTransportPlanId) === null
  ) {
    return 'The chosen primary transport reference is not a valid plan id.';
  }

  if (
    update.primaryAccommodationPlanId !== undefined &&
    update.primaryAccommodationPlanId !== null &&
    normalizePrimaryPlanId(update.primaryAccommodationPlanId) === null
  ) {
    return 'The chosen primary accommodation reference is not a valid plan id.';
  }

  return null;
}

/**
 * Section-scoped update helpers: each applies exactly one editable section to a
 * Trip Workspace. They are total — the section is strictly validated first and
 * an invalid value throws `TypeError` rather than silently dropping input.
 */

export function updateTripDateRange(
  workspace: TripWorkspace,
  dateRange: TripDateRange | null
): TripWorkspace {
  if (dateRange !== null && !isTripDateRange(dateRange)) {
    throw new TypeError('Invalid date range.');
  }
  return applyTripPlanningUpdate(workspace, { dateRange });
}

export function updateTripDestinations(
  workspace: TripWorkspace,
  destinations: TripDestination[]
): TripWorkspace {
  if (normalizeTripPlanningUpdate({ destinations }) === null) {
    throw new TypeError('Invalid destinations.');
  }
  return applyTripPlanningUpdate(workspace, { destinations });
}

export function updateTripDays(workspace: TripWorkspace, days: DayPlan[]): TripWorkspace {
  if (normalizeTripPlanningUpdate({ days }) === null) {
    throw new TypeError('Invalid day plans.');
  }
  return applyTripPlanningUpdate(workspace, { days });
}

export function updateTripNotes(workspace: TripWorkspace, notes: string[]): TripWorkspace {
  if (normalizeTripPlanningUpdate({ notes }) === null) {
    throw new TypeError('Invalid notes.');
  }
  return applyTripPlanningUpdate(workspace, { notes });
}

export function updateTripReferences(
  workspace: TripWorkspace,
  references: TripPlanningReference[]
): TripWorkspace {
  if (normalizeTripPlanningUpdate({ references }) === null) {
    throw new TypeError('Invalid references.');
  }
  return applyTripPlanningUpdate(workspace, { references });
}

export function updateTripTransportPlans(
  workspace: TripWorkspace,
  transportPlans: TripTransportPlan[]
): TripWorkspace {
  if (normalizeTripPlanningUpdate({ transportPlans }) === null) {
    throw new TypeError('Invalid transport plans.');
  }
  return applyTripPlanningUpdate(workspace, { transportPlans });
}

export function updateTripAccommodationPlans(
  workspace: TripWorkspace,
  accommodationPlans: TripAccommodationPlan[]
): TripWorkspace {
  if (normalizeTripPlanningUpdate({ accommodationPlans }) === null) {
    throw new TypeError('Invalid accommodation plans.');
  }
  return applyTripPlanningUpdate(workspace, { accommodationPlans });
}

export function updateTripBudgetPlan(
  workspace: TripWorkspace,
  budgetPlan: TripBudgetPlan | null
): TripWorkspace {
  if (budgetPlan !== null && normalizeTripPlanningUpdate({ budgetPlan }) === null) {
    throw new TypeError('Invalid budget plan.');
  }
  return applyTripPlanningUpdate(workspace, { budgetPlan });
}

export function updateTripTasks(
  workspace: TripWorkspace,
  tasks: TripChecklistItem[] | null
): TripWorkspace {
  if (tasks !== null && normalizeTripPlanningUpdate({ tasks }) === null) {
    throw new TypeError('Invalid checklist tasks.');
  }
  return applyTripPlanningUpdate(workspace, { tasks });
}

// ---------------------------------------------------------------------------
// Internal helpers (bounded `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

const ALLOWED_UPDATE_KEYS: ReadonlyArray<string> = [
  'dateRange',
  'destinations',
  'days',
  'notes',
  'references',
  'transportPlans',
  'accommodationPlans',
  'budgetPlan',
  'tasks',
  'primaryTransportPlanId',
  'primaryAccommodationPlanId',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the normalized list of `items` when every element normalizes, or
 * `null` when the value is not an array or any element is malformed — strict
 * whole-update rejection, never silent drops. Each item is rebuilt by its
 * normalizer so runtime-only keys are stripped.
 */
function normalizePlanArray<T>(items: unknown, normalize: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(items)) return null;
  const normalized: T[] = [];
  for (const item of items) {
    const plan = normalize(item);
    if (plan === null) return null;
    normalized.push(plan);
  }
  return normalized;
}

/**
 * Collapses an empty given budget plan to "no plan" so clearing every field has
 * the same persisted effect as the explicit `budgetPlan: null` clear.
 */
function collapseEmptyBudgetPlan(plan: TripBudgetPlan | null | undefined): TripBudgetPlan | null {
  if (plan === undefined || plan === null) return null;
  return Object.keys(plan).length === 0 ? null : plan;
}

function cloneBudgetPlan(plan: TripBudgetPlan): TripBudgetPlan {
  return {
    ...plan,
    ...(plan.allocations ? { allocations: { ...plan.allocations } } : {}),
  };
}

/**
 * Collapses an empty or absent checklist into the same persisted effect as the
 * explicit `tasks: null` clear, so dirty-checking treats "no checklist" as
 * unchanged on a prior-less workspace.
 */
function collapseTripTasks(
  tasks: TripChecklistItem[] | null | undefined
): TripChecklistItem[] | null {
  if (tasks === undefined || tasks === null || tasks.length === 0) return null;
  return tasks;
}

/**
 * Shallow-clones a plan record while deep-cloning its optional readiness
 * metadata (STEP 17) and provenance metadata (STEP 23), so a successor
 * workspace never aliases those nested objects from the previous one. The
 * user-managed lifecycle metadata (`lifecycleState`, STEP 24) is a scalar
 * string, so the plain spread already carries it with no aliasing risk.
 */
function clonePlanWithMetadata<
  TPlan extends { readiness?: TripExecutionReadiness; provenance?: TripPlanProvenance },
>(plan: TPlan): TPlan {
  const clone = { ...plan };
  if (plan.readiness !== undefined) {
    clone.readiness = { ...plan.readiness };
  }
  if (plan.provenance !== undefined) {
    clone.provenance = { ...plan.provenance };
  }
  return clone;
}

/**
 * Returns `items` when every element passes `check` (rebuilding the array so
 * runtime-only keys are stripped), or `null` when any element is malformed —
 * strict whole-update rejection, never silent drops.
 */
function filterValid<T>(items: unknown, check: (value: unknown) => value is T): T[] | null {
  if (!Array.isArray(items)) return null;
  const valid: T[] = [];
  for (const item of items) {
    if (!check(item)) return null;
    valid.push(item);
  }
  return valid;
}

function isDayPlanStrict(value: unknown): value is DayPlan {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.dayNumber) || (value.dayNumber as number) < 1) return false;
  if (typeof value.title !== 'string' || typeof value.theme !== 'string') return false;
  if (!Array.isArray(value.activities) || !value.activities.every(isActivityRecord)) return false;
  return true;
}

function hasUniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

function hasUniqueDayNumbers(days: DayPlan[]): boolean {
  return new Set(days.map((day) => day.dayNumber)).size === days.length;
}

function normalizeNotes(notes: string[]): string[] {
  return notes.map((note) => note.trim()).filter((note) => note.length > 0);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneDestination(destination: TripDestination): TripDestination {
  return { ...destination };
}

function cloneSnapshot(snapshot: TripItinerarySnapshot): TripItinerarySnapshot {
  return {
    ...snapshot,
    interests: [...snapshot.interests],
    dayPlans: snapshot.dayPlans.map(cloneDayPlan),
    transport: snapshot.transport?.map((option) => ({ ...option })),
    hotels: snapshot.hotels?.map((hotel) => ({ ...hotel })),
    notes: snapshot.notes ? [...snapshot.notes] : undefined,
    references: snapshot.references?.map((reference) => ({ ...reference })),
    transportPlans: snapshot.transportPlans?.map(clonePlanWithMetadata),
    accommodationPlans: snapshot.accommodationPlans?.map(clonePlanWithMetadata),
    budgetPlan: snapshot.budgetPlan ? cloneBudgetPlan(snapshot.budgetPlan) : undefined,
    tasks: snapshot.tasks?.map((task) => ({ ...task })),
  };
}

function cloneDayPlan(plan: DayPlan): DayPlan {
  return {
    dayNumber: plan.dayNumber,
    title: plan.title,
    theme: plan.theme,
    activities: plan.activities.map(cloneActivity),
  };
}

function cloneActivity(activity: Activity): Activity {
  return {
    ...activity,
    ...(activity.coordinates ? { coordinates: [...activity.coordinates] as [number, number] } : {}),
  };
}
