/**
 * Pure, provider-independent execution-checklist foundation (STEP 18).
 *
 * This module is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. It owns:
 *
 * 1. The execution-checklist vocabulary — `TripChecklistItem` with its
 *    `TripTaskStatus`, `TripTaskCategory`, and `TripTaskRelatedSection` enums
 *    (defined in `src/types/trip.ts`) — plus the pure helpers that validate,
 *    normalize, and label those values.
 * 2. The strict whole-array duplicate-id gate used by the editing and
 *    persistence boundaries, so no corrupted checklist ever persists.
 * 3. The neutral, human-readable labels used only by read-only UI
 *    presentation. `completed` means the owner marked it complete — never that
 *    an external system confirmed it, and nothing here ever claims a booking,
 *    payment, or live verification.
 *
 * No booking, ticket purchase, reservation, payment, cancellation, provider
 * API, live availability, external task integration, or autonomous execution
 * behavior exists here or anywhere in the application today.
 */

import type {
  TripChecklistItem,
  TripTaskCategory,
  TripTaskRelatedSection,
  TripTaskStatus,
} from '../../types/trip';

/** The only recognized task statuses (unknown values are always rejected). */
export const TRIP_TASK_STATUSES: ReadonlyArray<TripTaskStatus> = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
];

/** The only recognized task categories (unknown values are always rejected). */
export const TRIP_TASK_CATEGORIES: ReadonlyArray<TripTaskCategory> = [
  'transport-preparation',
  'accommodation-preparation',
  'budget-preparation',
  'document-preparation',
  'itinerary-preparation',
  'general',
];

/** The only recognized related planning sections for a task. */
export const TRIP_TASK_RELATED_SECTIONS: ReadonlyArray<TripTaskRelatedSection> = [
  'transport',
  'accommodation',
  'budget',
  'itinerary',
];

/** Upper bounds enforced at the normalization boundary (never silently truncated). */
export const MAX_TASK_TITLE_LENGTH = 120;
export const MAX_TASK_DESCRIPTION_LENGTH = 500;
export const MAX_TASK_NOTE_LENGTH = 500;
export const MAX_TASK_RELATED_PLAN_ID_LENGTH = 200;
export const MAX_TASK_ID_LENGTH = 200;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is one of the recognized task statuses. Unknown/arbitrary
 * strings (including anything provider-like such as `booked`) are rejected —
 * they must never reach a persisted record.
 */
export function isTripTaskStatus(value: unknown): value is TripTaskStatus {
  return typeof value === 'string' && (TRIP_TASK_STATUSES as ReadonlyArray<string>).includes(value);
}

/**
 * True when `value` is one of the six recognized preparation categories.
 */
export function isTripTaskCategory(value: unknown): value is TripTaskCategory {
  return (
    typeof value === 'string' && (TRIP_TASK_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when `value` is one of the recognized related planning sections.
 */
export function isTripTaskRelatedSection(value: unknown): value is TripTaskRelatedSection {
  return (
    typeof value === 'string' &&
    (TRIP_TASK_RELATED_SECTIONS as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when `value` is a well-formed `TripChecklistItem` record.
 */
export function isTripChecklistItem(value: unknown): value is TripChecklistItem {
  return normalizeTripChecklistItem(value) !== null;
}

/**
 * Normalizes an untrusted checklist task into a valid `TripChecklistItem`, or
 * returns `null` when the shape cannot be repaired. Never throws.
 *
 * The record is rebuilt field-by-field so runtime-only keys never persist:
 * required `id`, `category`, `title`, and `status` must be present and valid;
 * optional strings are trimmed and dropped when empty (absent-vs-null input
 * maps to absent — `null` never persists); `dueDate` must be a real ISO
 * calendar date; every recognized enum is validated wholesale (never guessed);
 * and the documented maximum lengths are enforced by rejection, not silent
 * truncation.
 */
export function normalizeTripChecklistItem(value: unknown): TripChecklistItem | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  if (id.trim().length > MAX_TASK_ID_LENGTH) return null;

  if (!isTripTaskCategory(value.category)) return null;

  const title = value.title;
  if (typeof title !== 'string') return null;
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0 || trimmedTitle.length > MAX_TASK_TITLE_LENGTH) return null;

  if (!isTripTaskStatus(value.status)) return null;

  const task: TripChecklistItem = {
    id: id.trim(),
    category: value.category,
    title: trimmedTitle,
    status: value.status,
  };

  const description = normalizeOptionalString(value.description, MAX_TASK_DESCRIPTION_LENGTH);
  if (description === null) return null;
  if (description !== undefined) task.description = description;

  const dueDate = normalizeOptionalDate(value.dueDate);
  if (dueDate === null) return null;
  if (dueDate !== undefined) task.dueDate = dueDate;

  const note = normalizeOptionalString(value.note, MAX_TASK_NOTE_LENGTH);
  if (note === null) return null;
  if (note !== undefined) task.note = note;

  if (value.relatedSection !== undefined && value.relatedSection !== null) {
    if (!isTripTaskRelatedSection(value.relatedSection)) return null;
    task.relatedSection = value.relatedSection;
  }

  const relatedPlanId = normalizeOptionalString(
    value.relatedPlanId,
    MAX_TASK_RELATED_PLAN_ID_LENGTH
  );
  if (relatedPlanId === null) return null;
  if (relatedPlanId !== undefined) task.relatedPlanId = relatedPlanId;

  return task;
}

/**
 * True when every task in `items` carries a distinct, non-empty id. Used by the
 * editing and persistence boundaries so duplicate ids can never be stored.
 */
export function hasUniqueTaskIds(items: ReadonlyArray<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/**
 * Neutral human-readable status label used only by read-only UI presentation.
 * It never claims a booking or external confirmation: `completed` is presented
 * as the owner's own action.
 */
export function getTripTaskStatusLabel(status: TripTaskStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'skipped':
      return 'Skipped';
  }
}

/** Human-readable category label for UI presentation. */
export function getTripTaskCategoryLabel(category: TripTaskCategory): string {
  switch (category) {
    case 'transport-preparation':
      return 'Transport preparation';
    case 'accommodation-preparation':
      return 'Accommodation preparation';
    case 'budget-preparation':
      return 'Budget preparation';
    case 'document-preparation':
      return 'Document preparation';
    case 'itinerary-preparation':
      return 'Itinerary preparation';
    case 'general':
      return 'General';
  }
}

/** Human-readable related-section label for UI presentation. */
export function getTripTaskRelatedSectionLabel(section: TripTaskRelatedSection): string {
  switch (section) {
    case 'transport':
      return 'Transport plans';
    case 'accommodation':
      return 'Accommodation plans';
    case 'budget':
      return 'Budget plan';
    case 'itinerary':
      return 'Daily itinerary';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (bounded `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

/**
 * Normalizes an optional present-only string: trims it, drops it when empty,
 * and returns `null` (rejecting the whole record) when it is not a string or
 * exceeds the documented maximum. `null`/`undefined` input maps to `undefined`
 * (no key in the rebuilt record).
 */
function normalizeOptionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Normalizes an optional ISO calendar date (`YYYY-MM-DD`), or returns `null`
 * when the value is present but not a real date. `null`/`undefined` input maps
 * to `undefined`.
 */
function normalizeOptionalDate(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!ISO_DATE_RE.test(trimmed)) return null;
  const time = Date.parse(`${trimmed}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  if (new Date(time).toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
