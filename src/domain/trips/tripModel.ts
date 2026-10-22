/**
 * Pure Trip Workspace model helpers.
 *
 * This module is deliberately free of side effects: it must not touch React,
 * Firebase, Zustand, the network, or any global store. Every helper is
 * deterministic given its inputs, and any time value used must be passed in.
 *
 * Nothing here persists or books anything — it only assembles and queries the
 * in-memory Trip domain model.
 */

import type {
  TripDateRange,
  TripDestination,
  TripItinerarySnapshot,
  TripMemberRole,
  TripStatus,
  TripWorkspace,
} from '../../types/trip';
import type { Itinerary } from '../../types/travel';

const DAY_MS = 86_400_000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateDraftTripInput {
  ownerId: string;
  title: string;
  destinations?: TripDestination[];
  dateRange?: TripDateRange;
  id?: string;
  /** ISO date-time for `createdAt`/`updatedAt`. Deterministic when injected. */
  now?: string;
}

export interface ItineraryToTripWorkspaceOptions {
  ownerId: string;
  id?: string;
  dateRange?: TripDateRange;
}

/**
 * True when the range contains two parseable ISO date strings and the start is
 * not after the end. ISO date strings sort chronologically, so a lexicographic
 * comparison is sufficient after parsing.
 */
export function isTripDateRangeValid(range: TripDateRange): boolean {
  return isIsoDate(range.startDate) && isIsoDate(range.endDate) && range.startDate <= range.endDate;
}

/** Inclusive day count: a same-day range is 1 day; an invalid range is 0 days. */
export function getTripDurationDays(range: TripDateRange): number {
  if (!isTripDateRangeValid(range)) return 0;
  const startUtc = parseIsoDateUtc(range.startDate);
  const endUtc = parseIsoDateUtc(range.endDate);
  return Math.floor((endUtc - startUtc) / DAY_MS) + 1;
}

// ---------------------------------------------------------------------------
// Lifecycle policy
// ---------------------------------------------------------------------------

/**
 * Explicit transition policy for the trip planning lifecycle.
 *
 * Transitions are a small, deliberate matrix: forward single-step progress
 * plus cancellation from any active planning stage. Terminal statuses
 * (`completed`, `cancelled`) are absorbing — a cancelled trip is not revived
 * and a completed trip is never reopened. These are planning/workspace labels
 * only; execution semantics are not implemented, so nothing here books,
 * pays, or monitors anything.
 */
export const TRIP_STATUS_TRANSITIONS: Readonly<Record<TripStatus, ReadonlyArray<TripStatus>>> = {
  draft: ['planning', 'cancelled'],
  planning: ['ready', 'cancelled'],
  ready: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** True for statuses a trip may still progress from (any non-terminal stage). */
export function isEditableTripStatus(status: TripStatus): boolean {
  return TRIP_STATUS_TRANSITIONS[status].length > 0;
}

/** The statuses `status` may legally move to next, per the lifecycle policy. */
export function getAllowedTripStatusTransitions(status: TripStatus): ReadonlyArray<TripStatus> {
  return TRIP_STATUS_TRANSITIONS[status];
}

/** True when `to` is a legal immediate successor of `from`. Self-transitions are never legal. */
export function canTransitionTripStatus(from: TripStatus, to: TripStatus): boolean {
  return TRIP_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Whether an owner may delete a workspace in the given status.
 *
 * The current product has no execution layer, so every known planning status is
 * deletable — these labels are planning state, not live obligations (this also
 * means an unknown/arbitrary status is never deletable). Should a future
 * execution step introduce in-flight obligations, this predicate is the single
 * place to gate deletion status-by-status.
 */
export function canDeleteTrip(status: TripStatus): boolean {
  return TRIP_STATUS_TRANSITIONS[status] !== undefined;
}

/**
 * Normalizes a trip title for the rename boundary: leading/trailing whitespace
 * is trimmed and the result must be non-empty. Titles are never silently
 * truncated — the maximum is intentionally unbounded for now.
 */
export function normalizeTripTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new TypeError('Trip title must be a non-empty title.');
  }
  return normalized;
}

/** Assembles a new `draft`, `private`, owner-only TripWorkspace. */
export function createDraftTrip(input: CreateDraftTripInput): TripWorkspace {
  const ownerId = input.ownerId.trim();
  const title = input.title.trim();
  if (!ownerId) throw new TypeError('createDraftTrip requires a non-empty ownerId.');
  if (!title) throw new TypeError('createDraftTrip requires a non-empty title.');
  if (input.dateRange && !isTripDateRangeValid(input.dateRange)) {
    throw new TypeError('createDraftTrip requires a valid dateRange.');
  }
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `trip-${now}`,
    ownerId,
    title,
    status: 'draft',
    visibility: 'private',
    dateRange: input.dateRange,
    destinations: input.destinations ?? [],
    memberCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Whether `userId` may view the workspace: the owner always may; a known member
 * role (any role) may; and a `shared` workspace is readable by anyone.
 */
export function canViewTrip(
  workspace: Pick<TripWorkspace, 'ownerId' | 'visibility'>,
  userId: string,
  role?: TripMemberRole
): boolean {
  if (workspace.ownerId === userId) return true;
  if (role === 'owner' || role === 'editor' || role === 'viewer') return true;
  return workspace.visibility === 'shared';
}

/** Whether `userId` may edit the workspace: the owner and editors only. */
export function canEditTrip(
  workspace: Pick<TripWorkspace, 'ownerId'>,
  userId: string,
  role?: TripMemberRole
): boolean {
  return workspace.ownerId === userId || role === 'editor';
}

/**
 * Pure adapter from an existing AI-generated `Itinerary` to a TripWorkspace.
 *
 * The mapping is lossy by design: an Itinerary has no owner, dates, destinations
 * list, or visibility, so those come from `options` or sensible fixed defaults.
 * The itinerary has no date range — pass one in `options` if known. No mutation
 * of the source itinerary occurs: nested arrays are deep-copied into the
 * snapshot so the workspace never aliases the ephemeral itinerary.
 */
export function itineraryToTripWorkspace(
  itinerary: Itinerary,
  options: ItineraryToTripWorkspaceOptions
): TripWorkspace {
  const dateRange =
    options.dateRange && isTripDateRangeValid(options.dateRange) ? options.dateRange : undefined;
  const createdAt = itinerary.createdAt;
  return {
    id: options.id ?? `trip-${itinerary.id}`,
    ownerId: options.ownerId,
    title: itinerary.destination,
    status: 'planning',
    visibility: 'private',
    dateRange,
    destinations: [
      {
        id: 'destination-primary',
        name: itinerary.destination,
        country: itinerary.country,
      },
    ],
    memberCount: 1,
    itinerary: toTripItinerarySnapshot(itinerary),
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Maps an `Itinerary` into the persistent `TripItinerarySnapshot`.
 *
 * Only domain-safe fields are carried over; the ephemeral itinerary's `id`,
 * `createdAt`, and `saved` flag do not belong in the workspace snapshot. Nested
 * arrays are copied (new objects) so the snapshot never aliases the source and
 * later edits cannot leak back into the generating itinerary.
 */
export function toTripItinerarySnapshot(itinerary: Itinerary): TripItinerarySnapshot {
  return {
    destination: itinerary.destination,
    country: itinerary.country,
    durationDays: itinerary.durationDays,
    budgetLevel: itinerary.budgetLevel,
    travelStyle: itinerary.travelStyle,
    interests: [...itinerary.interests],
    summary: itinerary.summary,
    estimatedTotalCost: itinerary.estimatedTotalCost,
    bestTimeToVisit: itinerary.bestTimeToVisit,
    dayPlans: itinerary.dayPlans.map((plan) => ({
      dayNumber: plan.dayNumber,
      title: plan.title,
      theme: plan.theme,
      activities: plan.activities.map((activity) => ({ ...activity })),
    })),
    transport: itinerary.transport?.map((option) => ({ ...option })),
    hotels: itinerary.hotels?.map((hotel) => ({ ...hotel })),
    sightseeingCost: itinerary.sightseeingCost,
  };
}

function isIsoDate(value: string): boolean {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  return Number.isFinite(parseIsoDateUtc(value));
}

function parseIsoDateUtc(value: string): number {
  // Force UTC so date-only strings are unambiguous and DST-proof.
  return Date.parse(`${value}T00:00:00Z`);
}
