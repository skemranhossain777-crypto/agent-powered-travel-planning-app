/**
 * Typed Firestore boundary for `TripWorkspace` documents.
 *
 * This module owns the mapping between the in-memory Trip domain model
 * (`src/types/trip.ts`) and the shape stored under `trips/{tripId}`. It is
 * deliberately SDK-free: no `firebase/firestore` imports, no `any`, and no
 * runtime Firebase types. Firestore Timestamps that sneak in are read via
 * duck-typing (`toDate()`), keeping reads tolerant of how the data was written.
 *
 * No booking, payments, availability, or execution behavior lives here.
 */

import type {
  TripDateRange,
  TripDestination,
  TripItinerarySnapshot,
  TripStatus,
  TripVisibility,
  TripWorkspace,
} from '../types/trip';
import { normalizeTripItinerarySnapshot } from './tripSerializationModel';

export const TRIP_STATUSES: ReadonlyArray<TripStatus> = [
  'draft',
  'planning',
  'ready',
  'in_progress',
  'completed',
  'cancelled',
];

export const TRIP_VISIBILITIES: ReadonlyArray<TripVisibility> = ['private', 'shared'];

/**
 * The persisted fields of a TripWorkspace (everything except the Firestore
 * document id, which is authoritative on the server).
 */
export interface TripDocument {
  ownerId: string;
  title: string;
  status: TripStatus;
  visibility: TripVisibility;
  dateRange?: TripDateRange;
  destinations: TripDestination[];
  memberCount: number;
  itinerary?: TripItinerarySnapshot;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields a caller may mutate through `updateTrip`. `id`, `ownerId`,
 * `createdAt`, and `updatedAt` are not editable.
 */
export const TRIP_UPDATE_FIELDS: ReadonlyArray<keyof TripDocument> = [
  'title',
  'status',
  'visibility',
  'dateRange',
  'destinations',
  'memberCount',
  'itinerary',
];

export interface SerializedTripUpdate {
  /**
   * Plain field values to pass to `updateDoc`. `dateRange` and `itinerary` are
   * only present here when a new value should be set.
   */
  values: Partial<
    Omit<TripDocument, 'dateRange' | 'itinerary'> & {
      dateRange: TripDateRange;
      itinerary: TripItinerarySnapshot;
    }
  >;
  /**
   * Field paths that must be removed via Firestore `FieldValue.delete()`
   * (currently `dateRange` and `itinerary` are clearable this way).
   */
  deletions: Array<'dateRange' | 'itinerary'>;
}

/** Thrown when a TripWorkspace (or field) cannot be safely persisted/re-read. */
export class TripSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripSerializationError';
  }
}

/**
 * True for a non-empty string safe to embed in a Firestore document path
 * segment (max 1500 chars, no slashes, not "." or "..").
 */
export function isValidStorageId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1500) return false;
  return value !== '.' && value !== '..' && !value.includes('/');
}

/** Converts an in-memory TripWorkspace into the persisted TripDocument shape. */
export function tripToFirestore(trip: TripWorkspace): TripDocument {
  if (!isValidStorageId(trip.id)) {
    throw new TripSerializationError('Trip id is invalid.');
  }
  if (!isNonEmptyString(trip.ownerId)) {
    throw new TripSerializationError('ownerId must be a non-empty string.');
  }
  if (!isNonEmptyString(trip.title)) {
    throw new TripSerializationError('title must be a non-empty string.');
  }
  if (!isTripStatus(trip.status)) {
    throw new TripSerializationError('status must be a valid TripStatus.');
  }
  if (!isTripVisibility(trip.visibility)) {
    throw new TripSerializationError('visibility must be a valid TripVisibility.');
  }
  if (trip.dateRange !== undefined && !isTripDateRange(trip.dateRange)) {
    throw new TripSerializationError('dateRange must be a valid date range.');
  }
  if (!Array.isArray(trip.destinations) || !trip.destinations.every(isTripDestination)) {
    throw new TripSerializationError('destinations must be an array of valid destinations.');
  }
  if (!isMemberCount(trip.memberCount)) {
    throw new TripSerializationError('memberCount must be a non-negative integer.');
  }
  const itinerary = serializeItinerarySnapshot(trip.itinerary);
  if (!isIsoDateTime(trip.createdAt)) {
    throw new TripSerializationError('createdAt must be an ISO date-time string.');
  }
  if (!isIsoDateTime(trip.updatedAt)) {
    throw new TripSerializationError('updatedAt must be an ISO date-time string.');
  }

  return {
    ownerId: trip.ownerId,
    title: trip.title,
    status: trip.status,
    visibility: trip.visibility,
    ...(trip.dateRange ? { dateRange: trip.dateRange } : {}),
    destinations: trip.destinations,
    memberCount: trip.memberCount,
    ...(itinerary ? { itinerary } : {}),
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}

/**
 * Rebuilds a TripWorkspace from a Firestore document, or returns `null` when
 * the payload is not a valid TripWorkspace. `docId` becomes the trip id, and
 * ISO date-times are read from either plain strings or Timestamp-shaped
 * objects (duck-typed via `toDate()`).
 */
export function tripFromFirestore(docId: string, raw: unknown): TripWorkspace | null {
  if (!isValidStorageId(docId) || typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;

  const ownerId = data.ownerId;
  const title = data.title;
  const status = data.status;
  const visibility = data.visibility;
  const destinations = data.destinations;
  const memberCount = data.memberCount;
  const createdAt = readIsoDateTime(data.createdAt);
  const updatedAt = readIsoDateTime(data.updatedAt);

  if (!isNonEmptyString(ownerId)) return null;
  if (!isNonEmptyString(title)) return null;
  if (!isTripStatus(status)) return null;
  if (!isTripVisibility(visibility)) return null;
  if (!Array.isArray(destinations) || !destinations.every(isTripDestination)) return null;
  if (!isMemberCount(memberCount)) return null;
  if (createdAt === null || updatedAt === null) return null;

  let dateRange: TripDateRange | undefined;
  if (data.dateRange !== undefined && data.dateRange !== null) {
    if (!isTripDateRange(data.dateRange)) return null;
    dateRange = data.dateRange;
  }

  let itinerary: TripItinerarySnapshot | undefined;
  if (data.itinerary !== undefined && data.itinerary !== null) {
    const normalized = normalizeTripItinerarySnapshot(data.itinerary);
    if (normalized === null) return null;
    itinerary = normalized;
  }

  const workspace: TripWorkspace = {
    id: docId,
    ownerId,
    title,
    status,
    visibility,
    destinations,
    memberCount,
    createdAt,
    updatedAt,
  };
  if (dateRange) workspace.dateRange = dateRange;
  if (itinerary) workspace.itinerary = itinerary;
  return workspace;
}

/**
 * Normalizes a partial update into a value/delete payload for `updateDoc`.
 * A `dateRange` key present with `undefined` is treated as "clear the field"
 * and lands in `deletions` (the caller maps it to `FieldValue.delete()`).
 */
export function serializeTripUpdates(
  updates: Partial<Omit<TripWorkspace, 'id' | 'ownerId'>>
): SerializedTripUpdate {
  const values: SerializedTripUpdate['values'] = {};
  const deletions: SerializedTripUpdate['deletions'] = [];

  if ('id' in updates) {
    throw new TripSerializationError('id cannot be updated.');
  }
  if ('ownerId' in updates) {
    throw new TripSerializationError('ownerId cannot be updated.');
  }
  if ('createdAt' in updates) {
    throw new TripSerializationError('createdAt cannot be updated.');
  }
  if ('updatedAt' in updates) {
    throw new TripSerializationError('updatedAt is managed by the trip service.');
  }

  if ('title' in updates) {
    const title = updates.title;
    if (!isNonEmptyString(title)) {
      throw new TripSerializationError('title must be a non-empty string.');
    }
    values.title = title;
  }

  if ('status' in updates) {
    const status = updates.status;
    if (!isTripStatus(status)) {
      throw new TripSerializationError('status must be a valid TripStatus.');
    }
    values.status = status;
  }

  if ('visibility' in updates) {
    const visibility = updates.visibility;
    if (!isTripVisibility(visibility)) {
      throw new TripSerializationError('visibility must be a valid TripVisibility.');
    }
    values.visibility = visibility;
  }

  if ('dateRange' in updates) {
    const dateRange = updates.dateRange;
    if (dateRange === undefined) {
      deletions.push('dateRange');
    } else {
      if (!isTripDateRange(dateRange)) {
        throw new TripSerializationError('dateRange must be a valid date range.');
      }
      values.dateRange = dateRange;
    }
  }

  if ('destinations' in updates) {
    const destinations = updates.destinations;
    if (!Array.isArray(destinations) || !destinations.every(isTripDestination)) {
      throw new TripSerializationError('destinations must be an array of valid destinations.');
    }
    values.destinations = destinations;
  }

  if ('memberCount' in updates) {
    const memberCount = updates.memberCount;
    if (!isMemberCount(memberCount)) {
      throw new TripSerializationError('memberCount must be a non-negative integer.');
    }
    values.memberCount = memberCount;
  }

  if ('itinerary' in updates) {
    const itinerary = updates.itinerary;
    if (itinerary === undefined) {
      deletions.push('itinerary');
    } else {
      const normalized = serializeItinerarySnapshot(itinerary);
      values.itinerary = normalized;
    }
  }

  return { values, deletions };
}

// ---------------------------------------------------------------------------
// Internal validators (duck-typed, `Record<string, unknown>` boundary only).
// ---------------------------------------------------------------------------

/**
 * Validates an in-memory itinerary snapshot via the shared pure normalization
 * guard, sanitizing out any runtime-only keys. Passes `undefined` through;
 * returns the normalized snapshot or throws on malformed content so writes
 * never persist invalid nested data.
 */
function serializeItinerarySnapshot(
  snapshot: TripItinerarySnapshot | undefined
): TripItinerarySnapshot | undefined {
  if (snapshot === undefined) return undefined;
  const normalized = normalizeTripItinerarySnapshot(snapshot);
  if (normalized === null) {
    throw new TripSerializationError('itinerary must be a valid trip itinerary snapshot.');
  }
  return normalized;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTripStatus(value: unknown): value is TripStatus {
  return typeof value === 'string' && (TRIP_STATUSES as ReadonlyArray<string>).includes(value);
}

function isTripVisibility(value: unknown): value is TripVisibility {
  return typeof value === 'string' && (TRIP_VISIBILITIES as ReadonlyArray<string>).includes(value);
}

function isTripDestination(value: unknown): value is TripDestination {
  if (typeof value !== 'object' || value === null) return false;
  const destination = value as Record<string, unknown>;
  if (!isNonEmptyString(destination.id) || !isNonEmptyString(destination.name)) return false;
  if (destination.country !== undefined && typeof destination.country !== 'string') return false;
  if (destination.latitude !== undefined && typeof destination.latitude !== 'number') return false;
  if (destination.longitude !== undefined && typeof destination.longitude !== 'number')
    return false;
  return true;
}

function isTripDateRange(value: unknown): value is TripDateRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as Record<string, unknown>;
  return (
    isIsoDate(range.startDate) &&
    isIsoDate(range.endDate) &&
    typeof range.startDate === 'string' &&
    typeof range.endDate === 'string' &&
    range.startDate <= range.endDate
  );
}

function isMemberCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function isIsoDateTime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Reads an ISO date-time from either a plain string or a Timestamp-shaped
 * object (anything exposing `toDate(): Date` — e.g. Firestore Timestamps).
 * Returns `null` when the value cannot be interpreted safely.
 */
function readIsoDateTime(value: unknown): string | null {
  if (typeof value === 'string') {
    return isIsoDateTime(value) ? value : null;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      const iso = (value as { toDate: () => Date }).toDate().toISOString();
      return isIsoDateTime(iso) ? iso : null;
    } catch {
      return null;
    }
  }
  return null;
}
