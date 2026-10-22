/**
 * Pure bounded validation for the Trip itinerary snapshot (`TripItinerarySnapshot`)
 * at the persistence boundary.
 *
 * This module is deliberately SDK-free and dependency-free: no React, no
 * Firebase, no Zustand, no `any`. It reads only `unknown` values (Firestore
 * payloads or in-memory objects) and either accepts a well-formed snapshot or
 * rejects it wholesale. No arbitrary nested object is silently accepted — every
 * field is shape-checked against the `TripItinerarySnapshot` contract.
 *
 * The top-level object is rebuilt field-by-field (stripping any runtime-only
 * keys such as an itinerary's `id`, `createdAt`, or `saved`), while validated
 * nested arrays are carried through as-is once their items pass shape checks.
 *
 * STEP 16 additions: the explicitly entered planning sections validatate
 * against the shared domain guards — `transportPlans`, `accommodationPlans`
 * (with duplicate-id rejection), and `budgetPlan`.
 *
 * STEP 18 additions: the optional execution-preparation checklist `tasks`
 * validates against the shared `normalizeTripChecklistItem` normalizer with
 * duplicate-id rejection, so runtime-only task keys never persist. Purist
 * content is client-serializer-authoritative (mirroring how the rest of the
 * itinerary snapshot is validated), so no rules change was needed to persist
 * tasks.
 *
 * STEP 26 additions: the optional section-level primary selection ids
 * `primaryTransportPlanId` / `primaryAccommodationPlanId` validate through the
 * shared `normalizePrimaryPlanId` guard — a present, structurally valid id is
 * carried through, an unknown-type or empty one rejects the whole snapshot, and
 * an absent selection stays absent. No reference or eligibility is judged at
 * the persistence boundary (that is read-time projection only).
 */

import type { Activity, BudgetLevel, DayPlan, HotelOption, TransportOption } from '../types/travel';
import type { TripChecklistItem, TripItinerarySnapshot } from '../types/trip';
import {
  isTripAccommodationPlan,
  isTripBudgetPlan,
  isTripPlanningReference,
  isTripTransportPlan,
} from '../domain/trips/tripPlanning';
import { normalizePrimaryPlanId } from '../domain/trips/planningReferenceSelection';
import { normalizeTripChecklistItem } from '../domain/trips/executionChecklist';

/** True when `value` is a complete, well-formed Trip itinerary snapshot. */
export function isTripItinerarySnapshot(value: unknown): value is TripItinerarySnapshot {
  return normalizeTripItinerarySnapshot(value) !== null;
}

/**
 * Returns a sanitized `TripItinerarySnapshot` (only declared keys, runtime-only
 * itinerary fields removed) when `value` matches the contract, or `null` when
 * it does not.
 */
export function normalizeTripItinerarySnapshot(value: unknown): TripItinerarySnapshot | null {
  if (!isRecord(value)) return null;

  const { destination, country, durationDays, budgetLevel, travelStyle, interests } = value;
  const { summary, estimatedTotalCost, bestTimeToVisit, transport, hotels, sightseeingCost } =
    value;
  const { dayPlans, notes, references, transportPlans, accommodationPlans, budgetPlan } = value;
  const { tasks } = value;
  const { primaryTransportPlanId, primaryAccommodationPlanId } = value;

  if (typeof destination !== 'string' || destination.trim().length === 0) return null;
  if (typeof country !== 'string') return null;
  if (!isDurationDays(durationDays)) return null;
  if (!isBudgetLevel(budgetLevel)) return null;
  if (typeof travelStyle !== 'string') return null;
  if (!isStringArray(interests)) return null;
  if (typeof summary !== 'string') return null;
  if (typeof estimatedTotalCost !== 'string') return null;
  if (typeof bestTimeToVisit !== 'string') return null;
  if (!isDayPlans(dayPlans)) return null;
  if (transport !== undefined && !isAll(transport, isTransportOption)) return null;
  if (hotels !== undefined && !isAll(hotels, isHotelOption)) return null;
  if (sightseeingCost !== undefined && typeof sightseeingCost !== 'string') return null;
  if (notes !== undefined && !isStringArray(notes)) return null;
  if (references !== undefined && !isAll(references, isTripPlanningReference)) return null;
  if (transportPlans !== undefined) {
    if (!isAll(transportPlans, isTripTransportPlan)) return null;
    if (!hasUniquePlanIds(transportPlans)) return null;
  }
  if (accommodationPlans !== undefined) {
    if (!isAll(accommodationPlans, isTripAccommodationPlan)) return null;
    if (!hasUniquePlanIds(accommodationPlans)) return null;
  }
  if (budgetPlan !== undefined && !isTripBudgetPlan(budgetPlan)) return null;
  let normalizedTasks: TripChecklistItem[] | null = null;
  if (tasks !== undefined) {
    normalizedTasks = normalizeTaskArray(tasks);
    if (normalizedTasks === null) return null;
    if (!hasUniquePlanIds(normalizedTasks)) return null;
  }
  let normalizedPrimaryTransportPlanId: string | undefined;
  if (primaryTransportPlanId !== undefined && primaryTransportPlanId !== null) {
    const normalizedId = normalizePrimaryPlanId(primaryTransportPlanId);
    if (normalizedId === null) return null;
    normalizedPrimaryTransportPlanId = normalizedId;
  }
  let normalizedPrimaryAccommodationPlanId: string | undefined;
  if (primaryAccommodationPlanId !== undefined && primaryAccommodationPlanId !== null) {
    const normalizedId = normalizePrimaryPlanId(primaryAccommodationPlanId);
    if (normalizedId === null) return null;
    normalizedPrimaryAccommodationPlanId = normalizedId;
  }

  return {
    destination,
    country,
    durationDays,
    budgetLevel,
    travelStyle,
    interests,
    summary,
    estimatedTotalCost,
    bestTimeToVisit,
    dayPlans,
    ...(transport !== undefined ? { transport } : {}),
    ...(hotels !== undefined ? { hotels } : {}),
    ...(sightseeingCost !== undefined ? { sightseeingCost } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(transportPlans !== undefined ? { transportPlans } : {}),
    ...(accommodationPlans !== undefined ? { accommodationPlans } : {}),
    ...(budgetPlan !== undefined ? { budgetPlan } : {}),
    ...(normalizedTasks !== null ? { tasks: normalizedTasks } : {}),
    ...(normalizedPrimaryTransportPlanId !== undefined
      ? { primaryTransportPlanId: normalizedPrimaryTransportPlanId }
      : {}),
    ...(normalizedPrimaryAccommodationPlanId !== undefined
      ? { primaryAccommodationPlanId: normalizedPrimaryAccommodationPlanId }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDurationDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isBudgetLevel(value: unknown): value is BudgetLevel {
  return value === 'Budget' || value === 'Moderate' || value === 'Luxury';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAll<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}

/**
 * Normalizes each checklist task at the persistence boundary so runtime-only
 * keys never persist (mirroring how notes/references are handled). Returns
 * `null` when the array or any task is malformed.
 */
function normalizeTaskArray(value: unknown): TripChecklistItem[] | null {
  if (!Array.isArray(value)) return null;
  const normalized: TripChecklistItem[] = [];
  for (const item of value) {
    const task = normalizeTripChecklistItem(item);
    if (task === null) return null;
    normalized.push(task);
  }
  return normalized;
}

/** True when `items` carry distinct, non-empty string ids. */
function hasUniquePlanIds(items: ReadonlyArray<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function isDayPlans(value: unknown): value is DayPlan[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!isRecord(item)) return false;
      return (
        Number.isInteger(item.dayNumber) &&
        (item.dayNumber as number) >= 1 &&
        typeof item.title === 'string' &&
        typeof item.theme === 'string' &&
        isAll(item.activities, isActivity)
      );
    })
  );
}

function isActivity(value: unknown): value is Activity {
  if (!isRecord(value)) return false;
  if (
    typeof value.time !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.locationName !== 'string' ||
    typeof value.category !== 'string' ||
    typeof value.estimatedCost !== 'string'
  ) {
    return false;
  }
  if (value.coordinates !== undefined) {
    if (!Array.isArray(value.coordinates) || value.coordinates.length !== 2) return false;
    const [lat, lng] = value.coordinates;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return false;
    }
  }
  return true;
}

function isTransportOption(value: unknown): value is TransportOption {
  if (!isRecord(value)) return false;
  return (
    typeof value.mode === 'string' &&
    typeof value.route === 'string' &&
    typeof value.estimatedCost === 'string'
  );
}

function isHotelOption(value: unknown): value is HotelOption {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.area === 'string' &&
    typeof value.ratePerNight === 'string' &&
    typeof value.estimatedCost === 'string'
  );
}
