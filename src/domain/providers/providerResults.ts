/**
 * Pure, provider-independent normalized search/quote result contract (STEP 20).
 *
 * A future provider adapter receives a provider-specific response and must map
 * it into this single normalized `TripProviderResult` shape before the result
 * can be used anywhere in the application — the app never speaks a provider's
 * raw vocabulary. Deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. Results are **live-planning quotes for the future**, never bookings: no
 *    reservation, confirmation, payment, or issued-ticket state lives here.
 * 2. Every string is trimmed and bounded; prices are finite non-negative
 *    numbers with a bounded currency code; timestamps are real ISO dates /
 *    date-times; `sourceUrl` passes the shared `isSafeHttpUrl` boundary. Any
 *    present-but-invalid value rejects the whole record — nothing is guessed.
 * 3. `retrievedAt` is required and `expiresAt` is optional. Staleness is
 *    explicit: a result that is old (or carries no freshness bound) is never
 *    presented as current, and `getTripProviderResultRecencyWarning` only
 *    reports expiry, never invents fresh quotes.
 * 4. Unknown keys are stripped during normalization (the record is rebuilt),
 *    so a provider's raw payload can never leak into the model. No provider
 *    ids or credentials from the provider domain ever appear here.
 * 5. `metadata` is an optional auxiliary list of opaque key/value pairs a
 *    provider attaches to a result. It is isolation-safe: every item is a
 *    trimmed, bounded `{ key, value }` pair, and the list is never interpreted
 *    as structured planning data, never copied into planning records, and
 *    never used to infer bookings, verification, or availability.
 *
 * No provider exists today: results are produced only inside this module and
 * its tests. They are never persisted, never sent to the AI, and never shown
 * as a control.
 */

import type { TripBookingCategory } from '../../types/trip';
import { isSafeHttpUrl } from '../trips/tripPlanning';

/** The recognized availability labels for a normalized provider result. */
export type TripProviderResultAvailability = 'available' | 'limited' | 'unavailable' | 'unknown';

/** A bounded price a future provider returned. */
export interface ProviderResultPrice {
  /** Canonical amount (finite, non-negative). */
  amount: number;
  /** Bounded ISO 4217-style currency code (letters only, 1–8 chars). */
  currency: string;
}

/**
 * A single isolated provider metadata pair attached to a result. Opaque by
 * design: `key`/`value` carry display-only provider context and are never
 * interpreted as structured planning data.
 */
export interface ProviderResultMetadata {
  /** Bounded label for the piece of metadata (e.g. `vehicle-class`). */
  key: string;
  /** Bounded value for the piece of metadata (e.g. `sample high-speed rail`). */
  value: string;
}

/**
 * The single normalized shape every future provider search/quote result maps
 * into. Optional fields are present only when the provider returned them and
 * they passed validation; nothing here is ever a booking or a confirmation.
 */
export interface TripProviderResult {
  /** Provider key used by the adapter layer (bounded). */
  providerId: string;
  /** Human-readable provider label for display only (bounded). */
  providerName: string;
  /** The provider's own identifier for this result (bounded, opaque label). */
  resultId: string;
  /** Future booking category this result belongs to. */
  category: TripBookingCategory;
  /** Short display title (required, bounded). */
  title: string;
  /** Optional one-line summary. */
  summary?: string;
  /** Optional origin/outbound label (e.g. an airport code). */
  origin?: string;
  /** Optional destination label. */
  destination?: string;
  /** Optional ISO date-time the journey/stay starts. */
  departureAt?: string;
  /** Optional ISO date-time the journey/stay ends. */
  arrivalAt?: string;
  /** Optional positive whole number of minutes. */
  durationMinutes?: number;
  /** Optional normalized price quote. */
  price?: ProviderResultPrice;
  /** Optional plain-text cancellation/refund policy note. */
  cancellationPolicy?: string;
  /** Optional safe HTTP/HTTPS source URL (validated). */
  sourceUrl?: string;
  /** ISO date-time the result was retrieved (required). */
  retrievedAt: string;
  /** Optional ISO date-time after which the quote is stale. */
  expiresAt?: string;
  /** Availability label as returned by the provider, `unknown` when absent. */
  availability: TripProviderResultAvailability;
  /** Optional user-facing limitations (each trimmed and bounded). */
  limitations?: string[];
  /** Optional user-facing warnings (each trimmed and bounded). */
  warnings?: string[];
  /**
   * Optional isolated provider metadata pairs (display-only, bounded). Never
   * interpreted as structured planning data and never copied into planning
   * records.
   */
  metadata?: ProviderResultMetadata[];
}

export const TRIP_PROVIDER_RESULT_AVAILABILITIES: ReadonlyArray<TripProviderResultAvailability> = [
  'available',
  'limited',
  'unavailable',
  'unknown',
];

export const MAX_PROVIDER_ID_LENGTH = 100;
export const MAX_PROVIDER_NAME_LENGTH = 100;
export const MAX_RESULT_ID_LENGTH = 200;
export const MAX_RESULT_TITLE_LENGTH = 200;
export const MAX_RESULT_SUMMARY_LENGTH = 500;
export const MAX_RESULT_LOCATION_LENGTH = 200;
export const MAX_RESULT_POLICY_LENGTH = 500;
export const MAX_RESULT_ITEM_LENGTH = 200;
/** Metadata keys and values are bounded like every other result string. */
export const MAX_RESULT_METADATA_KEY_LENGTH = 100;
export const MAX_RESULT_METADATA_VALUE_LENGTH = 200;
/** A bounded number of metadata pairs per result. */
export const MAX_RESULT_METADATA_ITEMS = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/** True when `value` is one of the recognized availability labels. */
export function isTripProviderResultAvailability(
  value: unknown
): value is TripProviderResultAvailability {
  return (
    typeof value === 'string' &&
    (TRIP_PROVIDER_RESULT_AVAILABILITIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when `value` is a well-formed normalized provider result. A result must
 * be safely convertible or it is rejected entirely — partial or invented
 * results are never accepted.
 */
export function isTripProviderResult(value: unknown): value is TripProviderResult {
  return normalizeTripProviderResult(value) !== null;
}

/**
 * Normalizes an untrusted provider response into a valid `TripProviderResult`,
 * or returns `null` when the shape cannot be repaired. Never throws.
 *
 * Rules:
 * - Required string fields must be present, bounded after trimming, and
 *   non-empty. Optional strings are trimmed and dropped when empty; the same
 *   max-length rule applies when present.
 * - `category` is required and must be a `TripBookingCategory`; unknown
 *   categories reject the record.
 * - `retrievedAt` is required and must be a real ISO date or date-time.
 *   `expiresAt` is optional and, when present, must be a real ISO date or
 *   date-time on or after `retrievedAt` (identical timestamps allowed).
 * - `durationMinutes` must be a positive integer; `price.amount` a finite
 *   non-negative number; `price.currency` letters only (1–8).
 * - `sourceUrl` must pass the shared `isSafeHttpUrl` boundary; a present-but-
 *   unsafe URL rejects the whole record.
 * - `availability` defaults to `unknown` when absent.
 * - `limitations`/`warnings` are optional arrays of non-empty trimmed strings.
 * - `metadata` is an optional array of `{ key: string; value: string }` pairs;
 *   every pair is required to be an object with trimmed, bounded, non-empty
 *   strings, and any malformed pair rejects the record.
 * - The record is rebuilt field-by-field so unknown keys (including any raw
 *   provider payload) never leak into the model.
 */
export function normalizeTripProviderResult(value: unknown): TripProviderResult | null {
  if (!isRecord(value)) return null;

  const providerId = requireString(value.providerId, MAX_PROVIDER_ID_LENGTH);
  if (providerId === null) return null;
  const providerName = requireString(value.providerName, MAX_PROVIDER_NAME_LENGTH);
  if (providerName === null) return null;
  const resultId = requireString(value.resultId, MAX_RESULT_ID_LENGTH);
  if (resultId === null) return null;

  const category = value.category;
  if (
    category !== 'transport' &&
    category !== 'accommodation' &&
    category !== 'activity' &&
    category !== 'other'
  ) {
    return null;
  }

  const title = requireString(value.title, MAX_RESULT_TITLE_LENGTH);
  if (title === null) return null;

  const retrievedAt = requireIsoDateOrDateTime(value.retrievedAt);
  if (retrievedAt === 'INVALID' || retrievedAt === undefined) return null;

  const expiresAt =
    value.expiresAt === undefined ? undefined : requireIsoDateOrDateTime(value.expiresAt);
  if (expiresAt === 'INVALID') return null;
  if (expiresAt !== undefined && compareDates(expiresAt, retrievedAt) < 0) return null;

  let availability: TripProviderResultAvailability = 'unknown';
  if (value.availability !== undefined && value.availability !== null) {
    if (!isTripProviderResultAvailability(value.availability)) return null;
    availability = value.availability;
  }

  const result: TripProviderResult = {
    providerId,
    providerName,
    resultId,
    category,
    title,
    retrievedAt,
    availability,
  };

  const summary = optionalString(value.summary, MAX_RESULT_SUMMARY_LENGTH);
  if (summary === null) return null;
  if (summary !== undefined) result.summary = summary;

  const origin = optionalString(value.origin, MAX_RESULT_LOCATION_LENGTH);
  if (origin === null) return null;
  if (origin !== undefined) result.origin = origin;

  const destination = optionalString(value.destination, MAX_RESULT_LOCATION_LENGTH);
  if (destination === null) return null;
  if (destination !== undefined) result.destination = destination;

  const departureAt =
    value.departureAt === undefined ? undefined : requireIsoDateOrDateTime(value.departureAt);
  if (departureAt === 'INVALID') return null;
  if (departureAt !== undefined) result.departureAt = departureAt;

  const arrivalAt =
    value.arrivalAt === undefined ? undefined : requireIsoDateOrDateTime(value.arrivalAt);
  if (arrivalAt === 'INVALID') return null;
  if (arrivalAt !== undefined) result.arrivalAt = arrivalAt;

  if (value.durationMinutes !== undefined && value.durationMinutes !== null) {
    const durationMinutes = value.durationMinutes;
    if (
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0
    ) {
      return null;
    }
    result.durationMinutes = durationMinutes;
  }

  if (value.price !== undefined && value.price !== null) {
    if (!isRecord(value.price)) return null;
    const amount = value.price.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
    if (typeof value.price.currency !== 'string' || !/^[A-Za-z]{1,8}$/.test(value.price.currency)) {
      return null;
    }
    result.price = { amount, currency: value.price.currency };
  }

  const cancellationPolicy = optionalString(value.cancellationPolicy, MAX_RESULT_POLICY_LENGTH);
  if (cancellationPolicy === null) return null;
  if (cancellationPolicy !== undefined) result.cancellationPolicy = cancellationPolicy;

  if (value.sourceUrl !== undefined && value.sourceUrl !== null) {
    if (!isSafeHttpUrl(value.sourceUrl)) return null;
    result.sourceUrl = value.sourceUrl;
  }
  if (expiresAt !== undefined) result.expiresAt = expiresAt;

  const limitations = optionalStringArray(value.limitations);
  if (limitations === null) return null;
  if (limitations.length > 0) result.limitations = limitations;

  const warnings = optionalStringArray(value.warnings);
  if (warnings === null) return null;
  if (warnings.length > 0) result.warnings = warnings;

  const metadata = optionalResultMetadata(value.metadata);
  if (metadata === null) return null;
  if (metadata.length > 0) result.metadata = metadata;

  return result;
}

/**
 * True when a normalized result is already stale at `now` (an ISO date or
 * date-time string): it has an `expiresAt` on or before `now`.
 */
export function isTripProviderResultExpired(result: TripProviderResult, now: string): boolean {
  if (result.expiresAt === undefined) return false;
  return compareDates(now, result.expiresAt) >= 0;
}

/**
 * A user-facing plain-text warning when a result is expired or has no
 * freshness bound, or `undefined` when the result is still current. This is
 * the only staleness ever reported: an old result is never refreshed to a
 * fake "live" quote and a missing expiry is never reported as fresh.
 */
export function getTripProviderResultRecencyWarning(
  result: TripProviderResult,
  now: string
): string | undefined {
  if (result.expiresAt === undefined) {
    return 'This result has no freshness bound and must not be treated as current availability.';
  }
  if (compareDates(now, result.expiresAt) >= 0) {
    return 'This result is expired and must not be treated as current.';
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/** Returns `INVALID`, `undefined` (absent), or the normalized timestamp string. */
function requireIsoDateOrDateTime(value: unknown): string | 'INVALID' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return 'INVALID';
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'INVALID';
  if (ISO_DATE_RE.test(trimmed)) return isRealIsoDate(trimmed) ? trimmed : 'INVALID';
  if (isIsoDateTime(trimmed)) return trimmed;
  return 'INVALID';
}

function isRealIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: string): boolean {
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  return isRealIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

/** Compares two ISO strings by their UTC milliseconds. */
function compareDates(a: string, b: string): number {
  return ms(a) - ms(b);
}

function ms(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
}

function optionalStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_RESULT_ITEM_LENGTH) return null;
    out.push(trimmed);
  }
  return out;
}

/**
 * Normalizes an optional provider metadata list. Every item must be an object
 * whose `key` and `value` are trimmed, non-empty, bounded strings; a malformed
 * item rejects the whole record. Returns `[]` when absent so callers can treat
 * it like `optionalStringArray`.
 */
function optionalResultMetadata(value: unknown): ProviderResultMetadata[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_RESULT_METADATA_ITEMS) return null;
  const out: ProviderResultMetadata[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const key = requireString(item.key, MAX_RESULT_METADATA_KEY_LENGTH);
    if (key === null) return null;
    const metaValue = requireString(item.value, MAX_RESULT_METADATA_VALUE_LENGTH);
    if (metaValue === null) return null;
    out.push({ key, value: metaValue });
  }
  return out;
}
