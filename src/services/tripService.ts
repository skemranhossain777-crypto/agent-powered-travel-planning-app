/**
 * Persistence for user-owned Trip Workspaces under Firestore `trips/{tripId}`.
 *
 * Ownership is enforced twice: the client always writes `ownerId` from the
 * signed-in user, and `firestore.rules` rejects any create/update that claims a
 * different owner or attempts to transfer ownership (see `firestore.rules`).
 * Reads are also scoped: `getTrip` resolves via Firestore rules, so a user who
 * does not own a trip receives a permission error rather than the document.
 *
 * The constructor is intentionally a no-op so that simply importing this module
 * never initializes Firebase; the Firestore instance is resolved lazily.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirestoreInstance } from './firebase';
import type { TripId, TripStatus, TripPlanningUpdate, TripWorkspace } from '../types/trip';
import { normalizeTripTitle, canTransitionTripStatus } from '../domain/trips/tripModel';
import {
  applyTripPlanningUpdate,
  getDestinationLimitProblem,
  normalizeTripPlanningUpdate,
} from '../domain/trips/tripPlanningEdit';
import {
  serializeTripUpdates,
  tripFromFirestore,
  tripToFirestore,
  isValidStorageId,
  TRIP_STATUSES,
  TripSerializationError,
} from './tripSerialization';

/** The trips collection state is a Firestore instance's own concern; the
 * rule authorizer below never imports the SDK types directly. */
type FirestoreError = { code?: string; message?: string };

export class TripNotFoundError extends Error {
  constructor(message = 'Trip not found.') {
    super(message);
    this.name = 'TripNotFoundError';
  }
}

export class TripPermissionError extends Error {
  constructor(message = 'You do not have access to this trip.') {
    super(message);
    this.name = 'TripPermissionError';
  }
}

export class TripValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripValidationError';
  }
}

export class TripParseError extends Error {
  constructor(message = 'Trip could not be read.') {
    super(message);
    this.name = 'TripParseError';
  }
}

/**
 * True for a non-empty string safe to embed in a Firestore document path
 * segment (max 1500 chars, no slashes, not "." or ".."). Mirrors
 * `isValidStorageId` so the whole path is validated before any SDK call.
 */
export function isValidTripId(value: unknown): value is TripId {
  return isValidStorageId(value);
}

/** Asserts `isValidTripId` and returns the id, throwing a validation error. */
export function assertTripId(tripId: unknown): TripId {
  if (!isValidTripId(tripId)) {
    throw new TripValidationError('Invalid trip id.');
  }
  return tripId;
}

/**
 * Maps raw Firestore SDK errors into the Trip-specific domain errors the UI
 * can safely react to. Unknown errors collapse into a generic safe message so
 * raw Firestore text is never shown to end users.
 */
export function mapFirestoreError(error: unknown): Error {
  const code = isFirestoreError(error) ? error.code : undefined;
  if (code === 'permission-denied') return new TripPermissionError();
  if (code === 'not-found') return new TripNotFoundError();
  return new Error('Could not perform this trip operation right now.');
}

class TripService {
  constructor() {
    // No-op by design: importing this class must not initialize Firebase.
  }

  /**
   * Persists a new Trip Workspace. The Firestore-generated document id is
   * authoritative — the returned TripWorkspace carries `ref.id`, even when the
   * caller supplied a different draft id.
   */
  async createTrip(trip: TripWorkspace): Promise<TripWorkspace> {
    assertTripId(trip.id);
    const document = tripToFirestore(trip);
    try {
      const ref = await addDoc(collection(getFirestoreInstance(), 'trips'), document);
      return { ...trip, id: ref.id };
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  /**
   * Reads a Trip Workspace by id. Returns `null` only when the document does
   * not exist or has been removed; a document that exists but cannot be parsed
   * throws `TripParseError`, and an owned-but-unreadable document surfaces as
   * `TripPermissionError` via the rules layer.
   */
  async getTrip(tripId: TripId): Promise<TripWorkspace | null> {
    assertTripId(tripId);
    try {
      const snap = await getDoc(doc(collection(getFirestoreInstance(), 'trips'), tripId));
      if (!snap.exists()) return null;
      const mapped = tripFromFirestore(snap.id, snap.data());
      if (mapped === null) throw new TripParseError();
      return mapped;
    } catch (err) {
      if (err instanceof TripParseError) throw err;
      throw mapFirestoreError(err);
    }
  }

  /**
   * Applies a partial update to a Trip Workspace and returns the freshly read
   * document. `id`, `ownerId`, `createdAt`, and `updatedAt` are not editable;
   * `updatedAt` is always refreshed by the service.
   */
  async updateTrip(
    tripId: TripId,
    updates: Partial<Omit<TripWorkspace, 'id' | 'ownerId'>>
  ): Promise<TripWorkspace> {
    assertTripId(tripId);
    const { values, deletions } = serializeTripUpdates(updates);

    const deletionsPayload =
      deletions.length > 0
        ? Object.fromEntries(deletions.map((field) => [field, deleteField()]))
        : {};

    try {
      await updateDoc(doc(collection(getFirestoreInstance(), 'trips'), tripId), {
        ...values,
        updatedAt: new Date().toISOString(),
        ...deletionsPayload,
      });
    } catch (err) {
      throw mapFirestoreError(err);
    }

    const updated = await this.getTrip(tripId);
    if (updated === null) throw new TripNotFoundError();
    return updated;
  }

  /**
   * Applies a bounded structured-planning update to a Trip Workspace (STEP 14,
   * expanded in STEP 16 and STEP 18).
   *
   * Only the nine editable planning sections pass through this method — trip
   * dates, destinations, daily itinerary, planning notes, external references,
   * transport plans, accommodation plans, the numeric budget plan (STEP 16),
   * and the user-authored execution-preparation checklist `tasks` (STEP 18).
   * `ownerId` must come from the authenticated session; ownership and existence
   * are verified against the persisted document before any write.
   *
     * The update is normalized through the pure domain boundary first (malformed
     * sections are rejected wholesale), itinerary-section edits are rejected on
     * legacy workspaces without an itinerary snapshot, and the resulting change
     * is written through the existing `updateTrip` whitelist so `updatedAt`, the
     * ownership guard, and error mapping are reused. Unrelated workbook fields
     * (title, status, transport, hotels, budget summary) are never touched.
     *
     * Destination lists are capped at `MAX_TRIP_DESTINATIONS` (20). A trip that
     * already holds more than the cap (created before the cap was introduced)
     * stays editable only while its destination list is left unchanged, so no
     * over-limit list can grow but legacy trips are not bricked.
     */
  async updateTripPlanning(
    tripId: TripId,
    ownerId: string,
    planningUpdate: TripPlanningUpdate
  ): Promise<TripWorkspace> {
    assertTripId(tripId);
    assertOwnerId(ownerId);
    const normalized = normalizeTripPlanningUpdate(planningUpdate);
    if (normalized === null) {
      throw new TripValidationError('Invalid planning update.');
    }
    const current = await this.getTrip(tripId);
    if (current === null) throw new TripNotFoundError();
    if (current.ownerId !== ownerId) throw new TripPermissionError();
    if (normalized.destinations !== undefined) {
      const limitProblem = getDestinationLimitProblem(
        normalized.destinations,
        current.destinations
      );
      if (limitProblem !== null) throw new TripValidationError(limitProblem);
    }
    if (
      current.itinerary === undefined &&
      (normalized.days !== undefined ||
        normalized.notes !== undefined ||
        normalized.references !== undefined ||
        normalized.transportPlans !== undefined ||
        normalized.accommodationPlans !== undefined ||
        normalized.budgetPlan !== undefined ||
        normalized.tasks !== undefined)
    ) {
      throw new TripValidationError(
        'Cannot edit itinerary sections on a trip without an itinerary.'
      );
    }

    const next = applyTripPlanningUpdate(current, normalized);
    const patches: Partial<Omit<TripWorkspace, 'id' | 'ownerId'>> = {};

    if (!jsonEqual(current.dateRange ?? null, next.dateRange ?? null)) {
      patches.dateRange = next.dateRange;
    }
    if (!jsonEqual(current.destinations, next.destinations)) {
      patches.destinations = next.destinations;
    }
    if (!jsonEqual(current.itinerary ?? null, next.itinerary ?? null)) {
      patches.itinerary = next.itinerary;
    }

    return this.updateTrip(tripId, patches);
  }

  /**
   * Renames a Trip Workspace. `ownerId` must come from the authenticated
   * session — the URL `tripId` is only an identifier, never an authorization
   * source. Ownership is verified against the persisted document before any
   * write, the title is normalized through the pure domain boundary (trimmed,
   * non-empty), and the change persists via the existing update path.
   */
  async renameTrip(tripId: TripId, ownerId: string, title: string): Promise<TripWorkspace> {
    assertTripId(tripId);
    assertOwnerId(ownerId);
    const current = await this.getTrip(tripId);
    if (current === null) throw new TripNotFoundError();
    if (current.ownerId !== ownerId) throw new TripPermissionError();
    let normalizedTitle: string;
    try {
      normalizedTitle = normalizeTripTitle(title);
    } catch {
      throw new TripValidationError('Trip title must be a non-empty string.');
    }
    return this.updateTrip(tripId, { title: normalizedTitle });
  }

  /**
   * Applies the lifecycle transition policy. The persisted trip is read first
   * so the authoritative current status (never a caller-supplied value) drives
   * the transition check; arbitrary status strings and illegal transitions are
   * rejected before any write.
   */
  async updateTripStatus(
    tripId: TripId,
    ownerId: string,
    status: TripStatus
  ): Promise<TripWorkspace> {
    assertTripId(tripId);
    assertOwnerId(ownerId);
    if (!isKnownTripStatus(status)) {
      throw new TripValidationError('status must be a valid TripStatus.');
    }
    const current = await this.getTrip(tripId);
    if (current === null) throw new TripNotFoundError();
    if (current.ownerId !== ownerId) throw new TripPermissionError();
    if (!canTransitionTripStatus(current.status, status)) {
      throw new TripValidationError(
        `Cannot change trip status from ${current.status} to ${status}.`
      );
    }
    return this.updateTrip(tripId, { status });
  }

  /**
   * Lists Trip Workspaces owned by a single user, newest activity first.
   *
   * Authorization is the caller's responsibility: `ownerId` must always be
   * derived from the authenticated user (never from an untrusted client field).
   * The query filters `where('ownerId', '==', ownerId)` so the request stays
   * within the owner's own documents, and `firestore.rules` enforces
   * owner-only listing on the server as well.
   *
   * Documents that fail the serialization boundary are skipped (never thrown),
   * so one corrupt trip cannot break the whole list. Ordering is done
   * client-side after validation to avoid requiring a composite index for the
   * `where` + `orderBy` pair — intentionally no server-side ordering.
   */
  async listTripsForOwner(ownerId: string): Promise<TripWorkspace[]> {
    if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
      throw new TripValidationError('ownerId must be a non-empty string.');
    }
    try {
      const tripsRef = collection(getFirestoreInstance(), 'trips');
      const snapshot = await getDocs(query(tripsRef, where('ownerId', '==', ownerId)));
      const trips: TripWorkspace[] = [];
      for (const snap of snapshot.docs) {
        const mapped = tripFromFirestore(snap.id, snap.data());
        if (mapped === null) continue;
        trips.push(mapped);
      }
      trips.sort((a, b) => {
        if (a.updatedAt < b.updatedAt) return 1;
        if (a.updatedAt > b.updatedAt) return -1;
        return 0;
      });
      return trips;
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  /**
   * Deletes a Trip Workspace. When `ownerId` is supplied (derived from the
   * authenticated session) ownership and existence are verified client-side
   * before the delete; the Firestore rules layer enforces owner-only deletes
   * regardless. Calling with no `ownerId` preserves the historical owner-scoped
   * behavior (rules only).
   */
  async deleteTrip(tripId: TripId, ownerId?: string): Promise<void> {
    assertTripId(tripId);
    if (ownerId !== undefined) {
      assertOwnerId(ownerId);
      const current = await this.getTrip(tripId);
      if (current === null) throw new TripNotFoundError();
      if (current.ownerId !== ownerId) throw new TripPermissionError();
    }
    try {
      await deleteDoc(doc(collection(getFirestoreInstance(), 'trips'), tripId));
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }
}

function isFirestoreError(error: unknown): error is FirestoreError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isKnownTripStatus(value: unknown): value is TripStatus {
  return typeof value === 'string' && (TRIP_STATUSES as ReadonlyArray<string>).includes(value);
}

/** Asserts a non-empty owner id derived from the authenticated session. */
function assertOwnerId(ownerId: unknown): string {
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
    throw new TripValidationError('ownerId must be a non-empty string.');
  }
  return ownerId;
}

/** Order-insensitive deep equality used to diff planning patches before writes. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const tripService = new TripService();
export type { TripService };
export { TripSerializationError };
