/**
 * Pure structured trip planning model (STEP 13).
 *
 * This module owns the typed, Firebase-independent planning surface for a Trip
 * Workspace. It builds the structured view (`TripPlanningData`) from the
 * canonical persisted fields — `TripWorkspace.dateRange`, `.destinations`, and
 * the `TripItinerarySnapshot` fields — and validates arbitrary payloads of that
 * shape without throwing.
 *
 * It is deliberately side-effect free and dependency-free: no React, Firebase,
 * Router, Zustand, network, clock, or `any`. `buildTripPlanningData` only
 * projects already-persisted data; `normalizeTripPlanningData` repairs or
 * rejects malformed nested records and never invents meaningful user data.
 *
 * STEP 14 additions: the shared guards this module exports (`isTripDateRange`,
 * `isTripDestinationRecord`, `isActivityRecord`, `isTripPlanningReference`, and
 * `isSafeHttpUrl`) validate the bounded editable planning sections before any
 * persisted write.
 *
 * STEP 16 additions: the shared guards and normalizers for the explicitly
 * entered planning sections — `isTripTransportPlan`/`normalizeTripTransportPlan`,
 * `isTripAccommodationPlan`/`normalizeTripAccommodationPlan`, and
 * `isTripBudgetPlan`/`normalizeTripBudgetPlan`. These validate user-entered
 * transport, accommodation, and budget-planning records before any persisted
 * write, and are reused as the strict persistence boundary by the serialization
 * model.
 *
 * STEP 17 additions: the transport and accommodation plan normalizers also carry
 * the optional execution-readiness metadata (`readiness`) through the shared
 * `normalizeTripExecutionReadiness` gate, so unknown state values and malformed
 * records are rejected before any persisted write. Absent or explicit-null
 * readiness stays absent — the field never defaults to a value.
 *
 * STEP 22 additions: the transport and accommodation plan normalizers also
 * validate the optional `sourceUrl` through the shared `isSafeHttpUrl` boundary
 * (the same safe-link guard the STEP 14 references use). A present-but-unsafe or
 * non-string URL rejects the whole plan; an empty value is dropped like any
 * other optional string — so an imported discovery quote can only ever carry a
 * safe http/https link into persisted planning data.
 *
 * STEP 23 additions: the transport and accommodation plan normalizers also
 * validate the optional `provenance` metadata through the shared
 * `normalizeTripPlanProvenance` gate, so an untrusted provenance payload (an
 * unknown kind, an over-long or non-string note, or runtime-only keys) rejects
 * the whole plan before any persisted write. Absent or explicit-null provenance
 * stays absent — legacy records without a provenance label remain valid, and a
 * provenance label is never inferred from text.
 *
 * STEP 24 additions: the transport and accommodation plan normalizers also
 * validate the optional `lifecycleState` through the shared
 * `isTripPlanLifecycleState` gate, so an unknown lifecycle value rejects the
 * whole plan before any persisted write. Absent or explicit-null lifecycle
 * stays absent — legacy records without a lifecycle state remain valid and are
 * treated as `active` at read time only (never written back by being viewed).
 * The normalizers never invent, transition, or timestamp a lifecycle state.
 *
 * STEP 26 additions: the structured planning surface also carries the optional
 * section-level primary selection ids `primaryTransportPlanId` /
 * `primaryAccommodationPlanId`. `buildTripPlanningData` projects them straight
 * through (absent stays absent — no first-reference promotion), and
 * `normalizeTripPlanningData` carries a present, structurally valid id while
 * rejecting an unknown-type or empty one wholesale. No read-time path infers,
 * auto-assigns, repairs, or converts a selection — cross-reference and
 * eligibility checks live in the read-only selection projection
 * (`planningReferenceSelection.ts`), never in persistence normalization.
 */

import { normalizeTripExecutionReadiness } from './executionReadiness';
import { isTripPlanLifecycleState } from './planningLifecycle';
import { normalizePrimaryPlanId } from './planningReferenceSelection';
import { normalizeTripPlanProvenance } from './planningProvenance';
import { getTripDurationDays, isTripDateRangeValid } from './tripModel';
import {
  MAX_NORMALIZED_ROUTE_DISTANCE_METERS,
  MAX_NORMALIZED_ROUTE_DURATION_SECONDS,
  MAX_NORMALIZED_ROUTE_NOTE_LENGTH,
  MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH,
} from '../routes/providerRoutes';
import type {
  Activity,
  BudgetLevel,
  DayPlan,
  HotelOption,
  TransportOption,
} from '../../types/travel';
import type {
  TripAccommodationPlan,
  TripBudgetAllocations,
  TripBudgetPlan,
  TripDateRange,
  TripDestination,
  TripPlanningBudget,
  TripPlanningData,
  TripPlanningReference,
  TripTransportPlan,
  TripWorkspace,
} from '../../types/trip';

const DAY_MS = 86_400_000;

/**
 * True when `value` is a safe external link for a reference: a bounded-length
 * string with an explicit `http://` or `https://` scheme and no whitespace or
 * control characters. The scheme allow-list is the security boundary — values
 * like `javascript:`, `data:`, and `file:` are always rejected. Content of the
 * link (host/path) is not judged here.
 */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * The ISO calendar date (`YYYY-MM-DD`) of `dayNumber` within `dateRange`, or
 * `undefined` when the range is invalid/absent or the day number falls outside
 * it. A day is a valid planning identifier only when it maps onto the trip.
 */
export function getTripDayDate(
  dateRange: TripDateRange | undefined,
  dayNumber: number
): string | undefined {
  if (!dateRange || !isTripDateRangeValid(dateRange)) return undefined;
  const durationDays = getTripDurationDays(dateRange);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > durationDays) return undefined;
  const startUtc = Date.parse(`${dateRange.startDate}T00:00:00Z`);
  return new Date(startUtc + (dayNumber - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Projects a TripWorkspace into the structured planning surface. Never throws
 * and never mutates the workspace: nested arrays are copied so the projection
 * cannot alias persisted state. Dates/budget are present only when the
 * workspace actually carries them; legacy trips map to empty sections.
 */
export function buildTripPlanningData(workspace: TripWorkspace): TripPlanningData {
  const dates =
    workspace.dateRange !== undefined && isTripDateRangeValid(workspace.dateRange)
      ? workspace.dateRange
      : undefined;
  const itinerary = workspace.itinerary;

  let budget: TripPlanningBudget | undefined;
  if (itinerary) {
    budget = {};
    budget.level = itinerary.budgetLevel;
    budget.estimatedTotalCost = itinerary.estimatedTotalCost;
    if (itinerary.sightseeingCost !== undefined) budget.sightseeingCost = itinerary.sightseeingCost;
  }

  return {
    ...(dates ? { dates } : {}),
    destinations: [...workspace.destinations],
    days: [...(itinerary?.dayPlans ?? [])],
    transportation: [...(itinerary?.transport ?? [])],
    accommodation: [...(itinerary?.hotels ?? [])],
    transportPlans: [...(itinerary?.transportPlans ?? [])],
    accommodationPlans: [...(itinerary?.accommodationPlans ?? [])],
    ...(itinerary?.budgetPlan !== undefined ? { budgetPlan: itinerary.budgetPlan } : {}),
    ...(budget ? { budget } : {}),
    notes: (itinerary?.notes ?? []).map((note) => note.trim()).filter((note) => note.length > 0),
    references: [...(itinerary?.references ?? [])],
    ...(itinerary?.primaryTransportPlanId !== undefined &&
    itinerary?.primaryTransportPlanId !== null
      ? { primaryTransportPlanId: itinerary.primaryTransportPlanId }
      : {}),
    ...(itinerary?.primaryAccommodationPlanId !== undefined &&
    itinerary?.primaryAccommodationPlanId !== null
      ? { primaryAccommodationPlanId: itinerary.primaryAccommodationPlanId }
      : {}),
  };
}

/** True when `value` is a well-formed structured planning payload. */
export function isTripPlanningData(value: unknown): value is TripPlanningData {
  return normalizeTripPlanningData(value) !== null;
}

/**
 * Normalizes an untrusted payload into a `TripPlanningData`, or returns `null`
 * when the shape cannot be repaired. Never throws.
 *
 * Required fields (must be present arrays): `destinations`, `days`,
 * `transportation`, `accommodation`, `transportPlans`, `accommodationPlans`,
 * `notes`, `references`. Optional scalar or object fields (`dates`, `budget`,
 * `budgetPlan`) are rejected wholesale when malformed.
 * Malformed list items are dropped (normalization), and `days` whose
 * `dayNumber` falls outside a present date range are filtered out — safe
 * repairs, never invented data. Unknown enum values are rejected, never
 * guessed.
 */
export function normalizeTripPlanningData(value: unknown): TripPlanningData | null {
  if (!isRecord(value)) return null;

  const destinations = value.destinations;
  const rawDays = value.days;
  const transportation = value.transportation;
  const accommodation = value.accommodation;
  const transportPlans = value.transportPlans;
  const accommodationPlans = value.accommodationPlans;
  const notes = value.notes;
  const references = value.references;
  const rawDates = value.dates;
  const rawPrimaryTransportPlanId = value.primaryTransportPlanId;
  const rawPrimaryAccommodationPlanId = value.primaryAccommodationPlanId;

  if (
    !Array.isArray(destinations) ||
    !Array.isArray(rawDays) ||
    !Array.isArray(transportation) ||
    !Array.isArray(accommodation) ||
    !Array.isArray(transportPlans) ||
    !Array.isArray(accommodationPlans) ||
    !Array.isArray(notes) ||
    !Array.isArray(references)
  ) {
    return null;
  }

  let dates: TripDateRange | undefined;
  if (rawDates !== undefined && rawDates !== null) {
    if (!isTripDateRange(rawDates)) return null;
    dates = rawDates;
  }

  let budget: TripPlanningBudget | undefined;
  if (value.budget !== undefined && value.budget !== null) {
    const normalizedBudget = normalizeTripPlanningBudget(value.budget);
    if (normalizedBudget === null) return null;
    budget = normalizedBudget;
  }

  let budgetPlan: TripBudgetPlan | undefined;
  if (value.budgetPlan !== undefined && value.budgetPlan !== null) {
    const normalizedBudgetPlan = normalizeTripBudgetPlan(value.budgetPlan);
    if (normalizedBudgetPlan === null) return null;
    budgetPlan = normalizedBudgetPlan;
  }

  const durationDays = dates ? getTripDurationDays(dates) : undefined;

  let primaryTransportPlanId: string | undefined;
  if (rawPrimaryTransportPlanId !== undefined && rawPrimaryTransportPlanId !== null) {
    const normalizedId = normalizePrimaryPlanId(rawPrimaryTransportPlanId);
    if (normalizedId === null) return null;
    primaryTransportPlanId = normalizedId;
  }

  let primaryAccommodationPlanId: string | undefined;
  if (rawPrimaryAccommodationPlanId !== undefined && rawPrimaryAccommodationPlanId !== null) {
    const normalizedId = normalizePrimaryPlanId(rawPrimaryAccommodationPlanId);
    if (normalizedId === null) return null;
    primaryAccommodationPlanId = normalizedId;
  }

  return {
    ...(dates ? { dates } : {}),
    destinations: destinations.filter(isTripDestinationRecord),
    days: rawDays
      .map(normalizeDayPlan)
      .filter((day): day is DayPlan => day !== null)
      .filter(
        (day) => durationDays === undefined || (day.dayNumber >= 1 && day.dayNumber <= durationDays)
      ),
    transportation: transportation
      .map(normalizeTransportOption)
      .filter((item): item is TransportOption => item !== null),
    accommodation: accommodation
      .map(normalizeHotelOption)
      .filter((item): item is HotelOption => item !== null),
    transportPlans: transportPlans
      .map(normalizeTripTransportPlan)
      .filter((item): item is TripTransportPlan => item !== null),
    accommodationPlans: accommodationPlans
      .map(normalizeTripAccommodationPlan)
      .filter((item): item is TripAccommodationPlan => item !== null),
    ...(budgetPlan ? { budgetPlan } : {}),
    ...(budget ? { budget } : {}),
    notes: notes.filter((note): note is string => typeof note === 'string'),
    references: references.filter(isTripPlanningReference),
    ...(primaryTransportPlanId !== undefined ? { primaryTransportPlanId } : {}),
    ...(primaryAccommodationPlanId !== undefined ? { primaryAccommodationPlanId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal validation helpers (bounded `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` is a valid inclusive `TripDateRange` of ISO dates. */
export function isTripDateRange(value: unknown): value is TripDateRange {
  if (!isRecord(value)) return false;
  return (
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    isTripDateRangeValid({ startDate: value.startDate, endDate: value.endDate })
  );
}

/**
 * True when `value` is a well-formed destination record: a non-empty id and
 * name, plus optional string country and finite-number coordinates.
 */
export function isTripDestinationRecord(value: unknown): value is TripDestination {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (value.country !== undefined && typeof value.country !== 'string') return false;
  if (value.latitude !== undefined && typeof value.latitude !== 'number') return false;
  if (value.longitude !== undefined && typeof value.longitude !== 'number') return false;
  return true;
}

/** True when `value` is a fully-shaped `Activity` record. */
export function isActivityRecord(value: unknown): value is Activity {
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

function isBudgetLevel(value: unknown): value is BudgetLevel {
  return value === 'Budget' || value === 'Moderate' || value === 'Luxury';
}

function normalizeTripPlanningBudget(value: unknown): TripPlanningBudget | null {
  if (!isRecord(value)) return null;
  const level = value.level;
  if (level !== undefined && level !== null && !isBudgetLevel(level)) return null;
  if (value.estimatedTotalCost !== undefined && typeof value.estimatedTotalCost !== 'string') {
    return null;
  }
  if (value.sightseeingCost !== undefined && typeof value.sightseeingCost !== 'string') {
    return null;
  }
  return {
    ...(level !== undefined && level !== null ? { level } : {}),
    ...(value.estimatedTotalCost !== undefined
      ? { estimatedTotalCost: value.estimatedTotalCost }
      : {}),
    ...(value.sightseeingCost !== undefined ? { sightseeingCost: value.sightseeingCost } : {}),
  };
}

function normalizeDayPlan(value: unknown): DayPlan | null {
  if (!isRecord(value)) return null;
  if (!Number.isInteger(value.dayNumber) || (value.dayNumber as number) < 1) return null;
  if (typeof value.title !== 'string' || typeof value.theme !== 'string') return null;
  if (!Array.isArray(value.activities)) return null;
  return {
    dayNumber: value.dayNumber as number,
    title: value.title,
    theme: value.theme,
    activities: value.activities.filter(isActivityRecord),
  };
}

function normalizeTransportOption(value: unknown): TransportOption | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.mode !== 'string' ||
    typeof value.route !== 'string' ||
    typeof value.estimatedCost !== 'string'
  ) {
    return null;
  }
  return { mode: value.mode, route: value.route, estimatedCost: value.estimatedCost };
}

function normalizeHotelOption(value: unknown): HotelOption | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== 'string' ||
    typeof value.area !== 'string' ||
    typeof value.ratePerNight !== 'string' ||
    typeof value.estimatedCost !== 'string'
  ) {
    return null;
  }
  return {
    name: value.name,
    area: value.area,
    ratePerNight: value.ratePerNight,
    estimatedCost: value.estimatedCost,
  };
}

/** True when `value` is a geographically bounded, finite coordinate pair. */
function isValidTripRouteLocation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const latitude = value['latitude'];
  const longitude = value['longitude'];
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return false;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/** True when `value` is a bounded, non-empty string array (STEP 48 route warnings). */
function isBoundedRouteWarnings(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== 'string') return false;
    const trimmed = item.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > MAX_NORMALIZED_ROUTE_NOTE_LENGTH) return false;
  }
  return true;
}

/** Shape-checks an identifier-only bookable-component reference. */
export function isTripPlanningReference(value: unknown): value is TripPlanningReference {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) return false;
  if (value.kind !== 'activity' && value.kind !== 'transport' && value.kind !== 'accommodation') {
    return false;
  }
  for (const key of [
    'provider',
    'providerId',
    'estimatedCost',
    'checkInDate',
    'checkOutDate',
    'mode',
    'address',
    'category',
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  const location = value.location;
  if (location !== undefined && !isValidTripRouteLocation(location)) return false;
  if (value.url !== undefined && !isSafeHttpUrl(value.url)) return false;
  if (value.kind === 'transport') {
    if (value.routeOrigin !== undefined && !isValidTripRouteLocation(value.routeOrigin)) {
      return false;
    }
    if (value.routeDestination !== undefined && !isValidTripRouteLocation(value.routeDestination)) {
      return false;
    }
    if (
      value.distanceMeters !== undefined &&
      (!isNonNegativeNumber(value.distanceMeters) ||
        value.distanceMeters > MAX_NORMALIZED_ROUTE_DISTANCE_METERS)
    ) {
      return false;
    }
    if (
      value.durationSeconds !== undefined &&
      (!isNonNegativeNumber(value.durationSeconds) ||
        value.durationSeconds > MAX_NORMALIZED_ROUTE_DURATION_SECONDS)
    ) {
      return false;
    }
    if (
      value.encodedPolyline !== undefined &&
      (typeof value.encodedPolyline !== 'string' ||
        value.encodedPolyline.trim().length === 0 ||
        value.encodedPolyline.length > MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH)
    ) {
      return false;
    }
    if (value.routeWarnings !== undefined && !isBoundedRouteWarnings(value.routeWarnings)) {
      return false;
    }
  }
  if (
    value.dayNumber !== undefined &&
    (typeof value.dayNumber !== 'number' ||
      !Number.isInteger(value.dayNumber) ||
      (value.dayNumber as number) < 1)
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// STEP 16: explicitly entered transport, accommodation, and budget plans.
//
// These guards normalize user-entered planning records into canonical,
// Firestore-safe shapes. Strings are trimmed and then dropped when empty
// (a present-but-empty key never persists); `null` is treated like `undefined`;
// numeric amounts must be finite and non-negative; `checkOutDate` must not
// precede `checkInDate`. Rebuilding records (rather than returning the input)
// guarantees no `undefined` keys leak into persisted documents.
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/** True when `value` is a real ISO calendar date (`YYYY-MM-DD`). */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** True when `value` is a bounded ISO date-time (hour 00–23, minute 00–59). */
function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  return isIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

/** True when `value` is an ISO date or a bounded ISO date-time. */
function isIsoDateOrDateTime(value: unknown): value is string {
  return isIsoDate(value) || isIsoDateTime(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidCurrencyCode(value: string): boolean {
  return /^[A-Za-z]{1,8}$/.test(value);
}

/** Strings that a plan record carries as trimmed, present-only values. */
const TRANSPORT_PLAN_STRING_KEYS = [
  'mode',
  'provider',
  'departureLocation',
  'arrivalLocation',
  'referenceNumber',
  'notes',
] as const;

/** Strings that an accommodation plan record carries as trimmed, present-only values. */
const ACCOMMODATION_PLAN_STRING_KEYS = [
  'name',
  'location',
  'roomDetails',
  'referenceNumber',
  'notes',
] as const;

/**
 * Normalizes an untrusted transport plan record, or returns `null` when it
 * cannot be repaired (missing `id`, non-string optional fields, malformed ISO
 * times, malformed execution-readiness, provenance, or lifecycle metadata).
 * Optional strings are trimmed and dropped when empty; absent or explicit-null
 * readiness stays absent.
 */
export function normalizeTripTransportPlan(value: unknown): TripTransportPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return null;
  const out: TripTransportPlan = { id: value.id.trim() };
  for (const key of TRANSPORT_PLAN_STRING_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length > 0) out[key] = trimmed;
  }
  for (const key of ['departureTime', 'arrivalTime'] as const) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || !isIsoDateOrDateTime(raw.trim())) return null;
    out[key] = raw.trim();
  }
  const rawSourceUrl = value.sourceUrl;
  if (rawSourceUrl !== undefined && rawSourceUrl !== null) {
    if (typeof rawSourceUrl !== 'string') return null;
    const trimmedSourceUrl = rawSourceUrl.trim();
    if (trimmedSourceUrl.length > 0) {
      if (!isSafeHttpUrl(trimmedSourceUrl)) return null;
      out.sourceUrl = trimmedSourceUrl;
    }
  }
  const rawReadiness = value.readiness;
  if (rawReadiness !== undefined && rawReadiness !== null) {
    const readiness = normalizeTripExecutionReadiness(rawReadiness);
    if (readiness === null) return null;
    out.readiness = readiness;
  }
  const rawProvenance = value.provenance;
  if (rawProvenance !== undefined && rawProvenance !== null) {
    const provenance = normalizeTripPlanProvenance(rawProvenance);
    if (provenance === null) return null;
    out.provenance = provenance;
  }
  const rawLifecycleState = value.lifecycleState;
  if (rawLifecycleState !== undefined && rawLifecycleState !== null) {
    if (!isTripPlanLifecycleState(rawLifecycleState)) return null;
    out.lifecycleState = rawLifecycleState;
  }
  return out;
}

/** True when `value` is a well-formed transport plan record. */
export const isTripTransportPlan = (value: unknown): value is TripTransportPlan =>
  normalizeTripTransportPlan(value) !== null;

/**
 * Normalizes an untrusted accommodation plan record, or returns `null` when it
 * cannot be repaired (missing `id`, malformed/ordered ISO dates, non-string
 * optional fields, malformed execution-readiness, provenance, or lifecycle
 * metadata). Optional strings are trimmed and dropped when empty; absent or
 * explicit-null readiness stays absent.
 */
export function normalizeTripAccommodationPlan(value: unknown): TripAccommodationPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return null;
  const out: TripAccommodationPlan = { id: value.id.trim() };
  for (const key of ACCOMMODATION_PLAN_STRING_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length > 0) out[key] = trimmed;
  }

  let checkInDate: string | undefined;
  if (value.checkInDate !== undefined && value.checkInDate !== null) {
    if (typeof value.checkInDate !== 'string' || !isIsoDate(value.checkInDate.trim())) return null;
    checkInDate = value.checkInDate.trim();
  }
  let checkOutDate: string | undefined;
  if (value.checkOutDate !== undefined && value.checkOutDate !== null) {
    if (typeof value.checkOutDate !== 'string' || !isIsoDate(value.checkOutDate.trim()))
      return null;
    checkOutDate = value.checkOutDate.trim();
  }
  if (checkInDate !== undefined && checkOutDate !== undefined && checkOutDate < checkInDate) {
    return null;
  }
  if (checkInDate !== undefined) out.checkInDate = checkInDate;
  if (checkOutDate !== undefined) out.checkOutDate = checkOutDate;
  const rawSourceUrl = value.sourceUrl;
  if (rawSourceUrl !== undefined && rawSourceUrl !== null) {
    if (typeof rawSourceUrl !== 'string') return null;
    const trimmedSourceUrl = rawSourceUrl.trim();
    if (trimmedSourceUrl.length > 0) {
      if (!isSafeHttpUrl(trimmedSourceUrl)) return null;
      out.sourceUrl = trimmedSourceUrl;
    }
  }
  const rawReadiness = value.readiness;
  if (rawReadiness !== undefined && rawReadiness !== null) {
    const readiness = normalizeTripExecutionReadiness(rawReadiness);
    if (readiness === null) return null;
    out.readiness = readiness;
  }
  const rawProvenance = value.provenance;
  if (rawProvenance !== undefined && rawProvenance !== null) {
    const provenance = normalizeTripPlanProvenance(rawProvenance);
    if (provenance === null) return null;
    out.provenance = provenance;
  }
  const rawLifecycleState = value.lifecycleState;
  if (rawLifecycleState !== undefined && rawLifecycleState !== null) {
    if (!isTripPlanLifecycleState(rawLifecycleState)) return null;
    out.lifecycleState = rawLifecycleState;
  }
  return out;
}

/** True when `value` is a well-formed accommodation plan record. */
export const isTripAccommodationPlan = (value: unknown): value is TripAccommodationPlan =>
  normalizeTripAccommodationPlan(value) !== null;

/** The only recognized allocation categories in a budget plan. */
const ALLOCATION_KEYS = ['transport', 'accommodation', 'food', 'activities', 'other'] as const;

/**
 * Normalizes untrusted allocation amounts. Unknown keys are dropped (never
 * persisted); present values must be finite non-negative numbers.
 */
export function normalizeTripBudgetAllocations(value: unknown): TripBudgetAllocations | null {
  if (!isRecord(value)) return null;
  const out: TripBudgetAllocations = {};
  for (const key of ALLOCATION_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (!isNonNegativeNumber(raw)) return null;
    out[key] = raw;
  }
  return out;
}

/**
 * Normalizes an untrusted budget plan, or returns `null` when it cannot be
 * repaired (malformed currency, non-numeric amounts, invalid allocations).
 * Optional strings are trimmed and dropped when empty; an empty object is a
 * valid partial plan.
 */
export function normalizeTripBudgetPlan(value: unknown): TripBudgetPlan | null {
  if (!isRecord(value)) return null;
  const out: TripBudgetPlan = {};

  if (value.currency !== undefined && value.currency !== null) {
    if (typeof value.currency !== 'string') return null;
    const trimmed = value.currency.trim();
    if (trimmed.length > 0) {
      if (!isValidCurrencyCode(trimmed)) return null;
      out.currency = trimmed;
    }
  }
  if (value.totalPlanned !== undefined && value.totalPlanned !== null) {
    if (!isNonNegativeNumber(value.totalPlanned)) return null;
    out.totalPlanned = value.totalPlanned;
  }
  if (value.allocations !== undefined && value.allocations !== null) {
    const allocations = normalizeTripBudgetAllocations(value.allocations);
    if (allocations === null) return null;
    out.allocations = allocations;
  }
  if (value.notes !== undefined && value.notes !== null) {
    if (typeof value.notes !== 'string') return null;
    const trimmed = value.notes.trim();
    if (trimmed.length > 0) out.notes = trimmed;
  }
  return out;
}

/** True when `value` is a well-formed budget plan record. */
export const isTripBudgetPlan = (value: unknown): value is TripBudgetPlan =>
  normalizeTripBudgetPlan(value) !== null;
