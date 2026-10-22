import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TripNotFoundError,
  TripParseError,
  TripPermissionError,
  TripValidationError,
  assertTripId,
  isValidTripId,
  mapFirestoreError,
  tripService,
} from '../services/tripService';
import { tripToFirestore } from '../services/tripSerialization';
import type { TripChecklistItem, TripItinerarySnapshot, TripWorkspace } from '../types/trip';

const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    addDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
  };
});

vi.mock('firebase/firestore', async () => {
  const collection = (db: unknown, name: string) => ({ kind: 'collection', name });
  const doc = (col: { kind: string; name: string }, id: string) => ({
    kind: 'doc',
    path: `${col.name}/${id}`,
  });
  const query = (
    col: { kind: string; name: string },
    ...constraints: Array<{ field: string; op: string; value: unknown }>
  ) => ({ kind: 'query', name: col.name, constraints });
  const where = (field: string, op: string, value: unknown) => ({ field, op, value });
  return {
    collection,
    doc,
    query,
    where,
    addDoc: h.addDoc,
    getDoc: h.getDoc,
    getDocs: h.getDocs,
    updateDoc: h.updateDoc,
    deleteDoc: h.deleteDoc,
    deleteField: () => ({ __deleteSentinel: true }),
  };
});

vi.mock('../services/firebase', () => ({
  getFirestoreInstance: vi.fn(() => ({ mocked: true })),
}));

function makeTrip(overrides: Partial<TripWorkspace> = {}): TripWorkspace {
  return {
    id: 'trip-abc',
    ownerId: 'user-1',
    title: 'Island Escape',
    status: 'draft',
    visibility: 'private',
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    memberCount: 1,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TripItinerarySnapshot> = {}): TripItinerarySnapshot {
  return {
    destination: 'Bali',
    country: 'Indonesia',
    durationDays: 5,
    budgetLevel: 'Moderate',
    travelStyle: 'Solo',
    interests: ['beaches'],
    summary: 'A balanced island escape.',
    estimatedTotalCost: '$1,200',
    bestTimeToVisit: 'April–October',
    dayPlans: [],
    ...overrides,
  };
}

function persisted(trip: TripWorkspace): Record<string, unknown> {
  return tripToFirestore(trip) as unknown as Record<string, unknown>;
}

function destinationList(count: number): TripWorkspace['destinations'] {
  return Array.from({ length: count }, (_, i) => ({ id: `d${i + 1}`, name: `City ${i + 1}` }));
}

function firestoreError(code: string): Error {
  const err = new Error(code);
  (err as { code?: string }).code = code;
  return err;
}

beforeEach(() => {
  h.docs.clear();
  h.addDoc.mockReset();
  h.getDoc.mockReset();
  h.getDocs.mockReset();
  h.updateDoc.mockReset();
  h.deleteDoc.mockReset();

  h.addDoc.mockImplementation(async (_col: unknown, data: Record<string, unknown>) => {
    const id = `fixture-${h.docs.size + 1}`;
    h.docs.set(`trips/${id}`, { ...data });
    return { id };
  });

  h.getDoc.mockImplementation(async (ref: { path: string }) => {
    const data = h.docs.get(ref.path);
    return {
      id: ref.path.split('/').pop(),
      exists: () => data !== undefined,
      data: () => data,
    };
  });

  h.getDocs.mockImplementation(
    async (ref: {
      kind: string;
      name: string;
      constraints: Array<{ field: string; op: string; value: unknown }>;
    }) => {
      const owner = ref.constraints.find((c) => c.field === 'ownerId' && c.op === '==');
      const rows: Array<{ id: string; data: () => Record<string, unknown> }> = [];
      h.docs.forEach((data, path) => {
        if (!path.startsWith('trips/')) return;
        if (owner && data.ownerId !== owner.value) return;
        rows.push({ id: path.split('/').pop()!, data: () => data });
      });
      return { docs: rows };
    }
  );

  h.updateDoc.mockImplementation(
    async (ref: { path: string }, payload: Record<string, unknown>) => {
      const current = h.docs.get(ref.path);
      if (current === undefined) throw firestoreError('not-found');
      for (const [key, value] of Object.entries(payload)) {
        const marker = value as { __deleteSentinel?: boolean } | undefined;
        if (marker && marker.__deleteSentinel) {
          delete current[key];
        } else {
          current[key] = value;
        }
      }
    }
  );

  h.deleteDoc.mockImplementation(async (ref: { path: string }) => {
    h.docs.delete(ref.path);
  });
});

describe('createTrip', () => {
  it('persists the trip and returns the Firebase-generated id', async () => {
    const created = await tripService.createTrip(makeTrip());

    expect(created.id).toBe('fixture-1');
    expect(h.docs.get('trips/fixture-1')).toMatchObject({
      ownerId: 'user-1',
      title: 'Island Escape',
      status: 'draft',
      visibility: 'private',
      memberCount: 1,
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    });
  });

  it('rejects an invalid trip before touching Firestore', async () => {
    await expect(tripService.createTrip(makeTrip({ title: ' ' }))).rejects.toThrow(
      /title must be a non-empty string/
    );
    expect(h.addDoc).not.toHaveBeenCalled();
  });

  it('rejects an invalid trip id', async () => {
    await expect(tripService.createTrip(makeTrip({ id: 'bad/id' }))).rejects.toThrow(
      TripValidationError
    );
  });

  it('maps Firestore errors to trip domain errors', async () => {
    h.addDoc.mockRejectedValueOnce(firestoreError('permission-denied'));
    await expect(tripService.createTrip(makeTrip())).rejects.toBeInstanceOf(TripPermissionError);
  });

  it('persists a workspace with an itinerary snapshot', async () => {
    const itinerary = makeSnapshot({
      dayPlans: [
        {
          dayNumber: 1,
          title: 'Arrival',
          theme: 'Settle in',
          activities: [
            {
              time: '10:00',
              title: 'Land in Denpasar',
              description: 'Arrive and check in.',
              locationName: 'Ngurah Rai Airport',
              category: 'Transport',
              estimatedCost: 'Varies',
            },
          ],
        },
      ],
    });

    await tripService.createTrip(makeTrip({ itinerary }));

    expect(h.docs.get('trips/fixture-1')?.itinerary).toEqual(itinerary);
  });

  it('rejects a malformed itinerary snapshot before touching Firestore', async () => {
    await expect(
      tripService.createTrip(
        makeTrip({
          itinerary: { ...makeSnapshot(), summary: 123 } as unknown as TripItinerarySnapshot,
        })
      )
    ).rejects.toThrow(/itinerary/);
    expect(h.addDoc).not.toHaveBeenCalled();
  });
});

describe('getTrip', () => {
  it('returns null when the document does not exist', async () => {
    expect(await tripService.getTrip('does-not-exist')).toBeNull();
  });

  it('reads and maps an existing document', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'planning' })));

    const trip = await tripService.getTrip('trip-abc');
    expect(trip).toMatchObject({ id: 'trip-abc', title: 'Island Escape', status: 'planning' });
  });

  it('maps permission-denied to TripPermissionError', async () => {
    h.getDoc.mockRejectedValueOnce(firestoreError('permission-denied'));
    await expect(tripService.getTrip('trip-abc')).rejects.toBeInstanceOf(TripPermissionError);
  });

  it('maps a not-found SDK error to TripNotFoundError', async () => {
    h.getDoc.mockRejectedValueOnce(firestoreError('not-found'));
    await expect(tripService.getTrip('trip-abc')).rejects.toBeInstanceOf(TripNotFoundError);
  });

  it('throws TripParseError for an unparseable stored document', async () => {
    h.docs.set('trips/trip-abc', { ownerId: 'user-1' });
    await expect(tripService.getTrip('trip-abc')).rejects.toBeInstanceOf(TripParseError);
  });

  it('rejects an invalid trip id before querying', async () => {
    await expect(tripService.getTrip('bad/id')).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });
});

describe('listTripsForOwner', () => {
  it('queries the trips collection filtered by ownerId', async () => {
    h.docs.set('trips/trip-1', persisted(makeTrip({ id: 'trip-1', title: 'One' })));
    h.docs.set(
      'trips/trip-2',
      persisted(makeTrip({ id: 'trip-2', ownerId: 'user-2', title: 'Two' }))
    );

    const trips = await tripService.listTripsForOwner('user-1');

    expect(trips.map((t) => t.title)).toEqual(['One']);
    expect(h.getDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'query',
        name: 'trips',
        constraints: [{ field: 'ownerId', op: '==', value: 'user-1' }],
      })
    );
  });

  it('returns an empty list when the owner has no workspaces', async () => {
    expect(await tripService.listTripsForOwner('user-1')).toEqual([]);
  });

  it('skips malformed documents and returns the valid ones', async () => {
    h.docs.set('trips/trip-ok', persisted(makeTrip({ id: 'trip-ok', title: 'Valid' })));
    h.docs.set('trips/trip-bad', { ownerId: 'user-1' });
    h.docs.set('trips/trip-minimal', persisted(makeTrip({ id: 'trip-minimal', title: 'Minimal' })));

    const trips = await tripService.listTripsForOwner('user-1');

    expect(trips.map((t) => t.title)).toEqual(['Valid', 'Minimal']);
  });

  it('orders results by updatedAt newest first', async () => {
    h.docs.set(
      'trips/trip-old',
      persisted(makeTrip({ id: 'trip-old', title: 'Old', updatedAt: '2026-09-01T00:00:00.000Z' }))
    );
    h.docs.set(
      'trips/trip-new',
      persisted(makeTrip({ id: 'trip-new', title: 'New', updatedAt: '2026-09-12T00:00:00.000Z' }))
    );

    const trips = await tripService.listTripsForOwner('user-1');

    expect(trips.map((t) => t.id)).toEqual(['trip-new', 'trip-old']);
  });

  it('carries itinerary snapshots through the serialization boundary', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ itinerary: makeSnapshot() })));

    const [trip] = await tripService.listTripsForOwner('user-1');

    expect(trip.itinerary?.summary).toBe('A balanced island escape.');
  });

  it('maps Firestore errors to trip domain errors', async () => {
    h.getDocs.mockRejectedValueOnce(firestoreError('permission-denied'));
    await expect(tripService.listTripsForOwner('user-1')).rejects.toBeInstanceOf(
      TripPermissionError
    );
  });

  it('rejects a missing ownerId before querying', async () => {
    await expect(tripService.listTripsForOwner('  ')).rejects.toThrow(TripValidationError);
    expect(h.getDocs).not.toHaveBeenCalled();
  });
});

describe('updateTrip', () => {
  it('applies a partial update, refreshes updatedAt, and re-reads the trip', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ updatedAt: '2020-01-01T00:00:00.000Z' })));

    const updated = await tripService.updateTrip('trip-abc', {
      title: 'New Title',
      status: 'ready',
    });

    expect(updated.title).toBe('New Title');
    expect(updated.status).toBe('ready');
    expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(h.docs.get('trips/trip-abc')?.title).toBe('New Title');
  });

  it('clears dateRange through Firestore delete semantics', async () => {
    h.docs.set(
      'trips/trip-abc',
      persisted(makeTrip({ dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' } }))
    );

    const updated = await tripService.updateTrip('trip-abc', { dateRange: undefined });

    expect(updated.dateRange).toBeUndefined();
    expect(h.docs.get('trips/trip-abc')).not.toHaveProperty('dateRange');
  });

  it('saves a changed title and itinerary overview and re-reads the trip', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ itinerary: makeSnapshot() })));

    const updated = await tripService.updateTrip('trip-abc', {
      title: 'Island Rewrite',
      itinerary: { ...makeSnapshot(), summary: 'A refreshed island escape.' },
    });

    expect(updated.title).toBe('Island Rewrite');
    expect(updated.itinerary?.summary).toBe('A refreshed island escape.');
    const storedItinerary = h.docs.get('trips/trip-abc')?.itinerary as
      TripItinerarySnapshot | undefined;
    expect(storedItinerary?.summary).toBe('A refreshed island escape.');
  });

  it('rejects a malformed itinerary update before touching Firestore', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));

    await expect(
      tripService.updateTrip('trip-abc', {
        itinerary: { ...makeSnapshot(), durationDays: 0 } as TripItinerarySnapshot,
      })
    ).rejects.toThrow(/itinerary/);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects identity and timestamp mutations before touching Firestore', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));

    const idUpdate = { id: 'x' } as unknown as Partial<Omit<TripWorkspace, 'id' | 'ownerId'>>;
    const ownerUpdate = { ownerId: 'u2' } as unknown as Partial<
      Omit<TripWorkspace, 'id' | 'ownerId'>
    >;
    const createdAtUpdate = { createdAt: 'x' } as unknown as Partial<
      Omit<TripWorkspace, 'id' | 'ownerId'>
    >;

    await expect(tripService.updateTrip('trip-abc', idUpdate)).rejects.toThrow(
      'id cannot be updated'
    );
    await expect(tripService.updateTrip('trip-abc', ownerUpdate)).rejects.toThrow(
      'ownerId cannot be updated'
    );
    await expect(tripService.updateTrip('trip-abc', createdAtUpdate)).rejects.toThrow(
      'createdAt cannot be updated'
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects invalid field values', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(tripService.updateTrip('trip-abc', { memberCount: -1 })).rejects.toThrow(
      /memberCount/
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('maps a missing document to TripNotFoundError', async () => {
    await expect(tripService.updateTrip('trip-abc', { title: 'X' })).rejects.toBeInstanceOf(
      TripNotFoundError
    );
  });
});

describe('deleteTrip', () => {
  it('deletes an existing trip', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await tripService.deleteTrip('trip-abc');
    expect(h.docs.has('trips/trip-abc')).toBe(false);
  });

  it('maps Firestore errors on delete', async () => {
    h.deleteDoc.mockRejectedValueOnce(firestoreError('permission-denied'));
    await expect(tripService.deleteTrip('trip-abc')).rejects.toBeInstanceOf(TripPermissionError);
  });

  it('rejects an invalid trip id before querying', async () => {
    await expect(tripService.deleteTrip('bad/id')).rejects.toThrow(TripValidationError);
    expect(h.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('renameTrip', () => {
  it('renames a trip, trimming whitespace, and returns the updated workspace', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));

    const updated = await tripService.renameTrip('trip-abc', 'user-1', '  Island Rewrite  ');

    expect(updated.title).toBe('Island Rewrite');
    expect(updated.ownerId).toBe('user-1');
    expect(h.docs.get('trips/trip-abc')?.title).toBe('Island Rewrite');
    expect(updated.updatedAt).not.toBe(makeTrip().updatedAt);
  });

  it('rejects an empty or whitespace-only title before writing', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(tripService.renameTrip('trip-abc', 'user-1', '   ')).rejects.toThrow(
      TripValidationError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects a missing trip with TripNotFoundError', async () => {
    await expect(tripService.renameTrip('trip-abc', 'user-1', 'Renamed')).rejects.toBeInstanceOf(
      TripNotFoundError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects renaming another user trip with TripPermissionError', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ ownerId: 'user-2' })));
    await expect(tripService.renameTrip('trip-abc', 'user-1', 'Renamed')).rejects.toBeInstanceOf(
      TripPermissionError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an invalid ownerId before any query', async () => {
    await expect(tripService.renameTrip('trip-abc', '  ', 'Renamed')).rejects.toThrow(
      TripValidationError
    );
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('rejects an invalid trip id before any query', async () => {
    await expect(tripService.renameTrip('bad/id', 'user-1', 'Renamed')).rejects.toThrow(
      TripValidationError
    );
    expect(h.getDoc).not.toHaveBeenCalled();
  });
});

describe('updateTripStatus', () => {
  it('applies a legal forward transition', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'draft' })));

    const updated = await tripService.updateTripStatus('trip-abc', 'user-1', 'planning');

    expect(updated.status).toBe('planning');
    expect(h.docs.get('trips/trip-abc')?.status).toBe('planning');
  });

  it('applies a legal cancellation transition', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'ready' })));

    const updated = await tripService.updateTripStatus('trip-abc', 'user-1', 'cancelled');

    expect(updated.status).toBe('cancelled');
  });

  it('rejects an illegal transition before writing', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'draft' })));
    await expect(tripService.updateTripStatus('trip-abc', 'user-1', 'ready')).rejects.toThrow(
      TripValidationError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects a self-transition to the current status', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'planning' })));
    await expect(tripService.updateTripStatus('trip-abc', 'user-1', 'planning')).rejects.toThrow(
      TripValidationError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary status string', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(
      tripService.updateTripStatus('trip-abc', 'user-1', 'archived' as TripWorkspace['status'])
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('rejects a transition from a terminal status', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ status: 'completed' })));
    await expect(tripService.updateTripStatus('trip-abc', 'user-1', 'cancelled')).rejects.toThrow(
      TripValidationError
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects a missing trip with TripNotFoundError', async () => {
    await expect(
      tripService.updateTripStatus('trip-abc', 'user-1', 'ready')
    ).rejects.toBeInstanceOf(TripNotFoundError);
  });

  it('rejects updating another user trip with TripPermissionError', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ ownerId: 'user-2' })));
    await expect(
      tripService.updateTripStatus('trip-abc', 'user-1', 'ready')
    ).rejects.toBeInstanceOf(TripPermissionError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an empty ownerId before any query', async () => {
    await expect(tripService.updateTripStatus('trip-abc', '', 'ready')).rejects.toThrow(
      TripValidationError
    );
    expect(h.getDoc).not.toHaveBeenCalled();
  });
});

describe('updateTripPlanning', () => {
  it('persists editable planning sections and returns the updated workspace', async () => {
    const original = makeTrip({ itinerary: makeSnapshot() });
    h.docs.set('trips/trip-abc', persisted(original));

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd2', name: 'Canggu', country: 'Indonesia' }],
      days: [{ dayNumber: 1, title: 'Beach Day', theme: 'Relax', activities: [] }],
      notes: ['  Book early  ', ''],
      references: [
        { id: 'act-1', kind: 'activity', title: 'Surf Lesson', url: 'https://example.com/surf' },
      ],
    });

    expect(updated.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });
    expect(updated.destinations).toEqual([{ id: 'd2', name: 'Canggu', country: 'Indonesia' }]);
    expect(updated.itinerary?.dayPlans.map((day) => day.title)).toEqual(['Beach Day']);
    expect(updated.itinerary?.notes).toEqual(['Book early']);
    expect(updated.itinerary?.references?.[0].url).toBe('https://example.com/surf');
    expect(updated.updatedAt).not.toBe(original.updatedAt);

    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });
    expect(stored.itinerary?.notes).toEqual(['Book early']);
  });

  it('patches only the changed planning sections, leaving the rest of the document alone', async () => {
    const original = makeTrip({
      dateRange: { startDate: '2026-09-10', endDate: '2026-09-10' },
      itinerary: makeSnapshot({
        transport: [{ mode: 'Car', route: 'Airport → Ubud', estimatedCost: '$25' }],
        summary: 'A balanced island escape.',
      }),
    });
    h.docs.set('trips/trip-abc', persisted(original));

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    });

    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.destinations).toEqual(original.destinations);
    expect(stored.itinerary?.dayPlans).toEqual([]);
    expect(stored.itinerary?.transport).toEqual(original.itinerary?.transport);
    expect(stored.itinerary?.summary).toBe('A balanced island escape.');
    expect(updated.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });
  });

  it('clears dateRange when the update asks for null', async () => {
    h.docs.set(
      'trips/trip-abc',
      persisted(makeTrip({ dateRange: { startDate: '2026-09-10', endDate: '2026-09-10' } }))
    );

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', { dateRange: null });

    expect(updated.dateRange).toBeUndefined();
    expect(h.docs.get('trips/trip-abc')).not.toHaveProperty('dateRange');
  });

  it('accepts a no-op update and still returns a fresh workspace', async () => {
    const original = makeTrip({
      itinerary: makeSnapshot({ notes: ['Book early'] }),
    });
    h.docs.set('trips/trip-abc', persisted(original));

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      notes: ['Book early'],
    });

    expect(updated.itinerary?.notes).toEqual(['Book early']);
  });

  it('rejects a malformed update before any query', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ itinerary: makeSnapshot() })));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        days: [{ dayNumber: 0, title: 'X', theme: 'Y', activities: [] }],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();

    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        references: [{ id: 'a', kind: 'activity', title: 'A', url: 'javascript:alert(1)' }],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();

    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', { runtimeKey: 'x' } as never)
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('rejects itinerary-section edits on a workspace without an itinerary', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        notes: ['n'],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('caps destinations at 20 unless the list is an unchanged legacy list', async () => {
    const legacy = makeTrip({ destinations: destinationList(25) });

    // Growing an in-cap list past the cap is rejected before any write.
    h.docs.set('trips/trip-abc', persisted(makeTrip({ destinations: destinationList(20) })));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        destinations: destinationList(21),
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.updateDoc).not.toHaveBeenCalled();

    // An over-limit legacy list persists untouched alongside an unrelated edit.
    h.docs.set('trips/trip-abc', persisted({ ...legacy, itinerary: makeSnapshot() }));
    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      destinations: destinationList(25),
      notes: ['keep'],
    });
    expect(updated.destinations).toHaveLength(25);
    expect(updated.itinerary?.notes).toEqual(['keep']);

    // Shrinking an over-limit legacy list is still a change, so it is rejected.
    h.docs.set('trips/trip-abc', persisted({ ...legacy, itinerary: makeSnapshot() }));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        destinations: destinationList(24),
      })
    ).rejects.toThrow(TripValidationError);

    // Shrinking to or below the cap is allowed.
    h.docs.set('trips/trip-abc', persisted({ ...legacy, itinerary: makeSnapshot() }));
    const trimmed = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      destinations: destinationList(20),
    });
    expect(trimmed.destinations).toHaveLength(20);
  });

  it('rejects a missing trip with TripNotFoundError', async () => {
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      })
    ).rejects.toBeInstanceOf(TripNotFoundError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects updating another user trip with TripPermissionError', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ ownerId: 'user-2' })));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      })
    ).rejects.toBeInstanceOf(TripPermissionError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an invalid trip id or owner id before any query', async () => {
    await expect(tripService.updateTripPlanning('bad/id', 'user-1', {})).rejects.toThrow(
      TripValidationError
    );
    await expect(tripService.updateTripPlanning('trip-abc', '  ', {})).rejects.toThrow(
      TripValidationError
    );
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('persists the STEP 16 plan sections and returns the updated workspace', async () => {
    const original = makeTrip({ itinerary: makeSnapshot() });
    h.docs.set('trips/trip-abc', persisted(original));

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      transportPlans: [
        {
          id: 'trp-1',
          mode: 'Flight',
          departureLocation: '  Denpasar  ',
          departureTime: '2026-09-11T08:30',
          provider: '   ',
        } as unknown as never,
      ],
      accommodationPlans: [
        { id: 'acp-1', name: 'Padi Hotel', checkInDate: '2026-09-11', checkOutDate: '2026-09-15' },
      ],
      budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
    } as never);

    expect(updated.itinerary?.transportPlans).toEqual([
      {
        id: 'trp-1',
        mode: 'Flight',
        departureLocation: 'Denpasar',
        departureTime: '2026-09-11T08:30',
      },
    ]);
    expect(updated.itinerary?.accommodationPlans).toEqual([
      { id: 'acp-1', name: 'Padi Hotel', checkInDate: '2026-09-11', checkOutDate: '2026-09-15' },
    ]);
    expect(updated.itinerary?.budgetPlan).toEqual({
      currency: 'USD',
      totalPlanned: 1200,
      allocations: { food: 300 },
    });
    expect(updated.updatedAt).not.toBe(original.updatedAt);

    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.itinerary?.transportPlans).toEqual(updated.itinerary?.transportPlans);
    expect(stored.itinerary?.accommodationPlans).toEqual(updated.itinerary?.accommodationPlans);
    expect(stored.itinerary?.budgetPlan).toEqual(updated.itinerary?.budgetPlan);
    expect(stored.itinerary?.transportPlans?.[0]).not.toHaveProperty('provider');
    expect(stored.itinerary?.transportPlans?.[0]).not.toHaveProperty('notes');
  });

  it('persists STEP 17 readiness metadata and rejects booking-claim readiness', async () => {
    const original = makeTrip({ itinerary: makeSnapshot() });
    h.docs.set('trips/trip-abc', persisted(original));

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      transportPlans: [
        {
          id: 'trp-1',
          mode: 'Flight',
          readiness: { state: 'user-confirmed', note: '  ABC-123  ' },
        },
      ],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', readiness: { state: 'planned' } }],
    } as never);

    expect(updated.itinerary?.transportPlans).toEqual([
      { id: 'trp-1', mode: 'Flight', readiness: { state: 'user-confirmed', note: 'ABC-123' } },
    ]);
    expect(updated.itinerary?.accommodationPlans).toEqual([
      { id: 'acp-1', name: 'Padi Hotel', readiness: { state: 'planned' } },
    ]);
    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.itinerary?.transportPlans?.[0].readiness).toEqual({
      state: 'user-confirmed',
      note: 'ABC-123',
    });
    expect(stored.itinerary?.accommodationPlans?.[0].readiness).toEqual({ state: 'planned' });

    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        transportPlans: [{ id: 'trp-2', mode: 'Flight', readiness: { state: 'booked' } }],
      } as never)
    ).rejects.toThrow(TripValidationError);
  });

  it('clears an existing budget plan when the update sends null', async () => {
    h.docs.set(
      'trips/trip-abc',
      persisted(
        makeTrip({
          itinerary: makeSnapshot({ budgetPlan: { currency: 'USD', totalPlanned: 900 } }),
        })
      )
    );

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', {
      budgetPlan: null,
    } as never);

    expect(updated.itinerary?.budgetPlan).toBeUndefined();
    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.itinerary?.budgetPlan).toBeUndefined();
  });

  it('rejects malformed STEP 16 sections before any query', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ itinerary: makeSnapshot() })));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        transportPlans: [{ id: 'a', departureTime: 'tomorrow' }],
      })
    ).rejects.toThrow(TripValidationError);
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        accommodationPlans: [{ id: 'a', checkInDate: '2026-09-15', checkOutDate: '2026-09-11' }],
      })
    ).rejects.toThrow(TripValidationError);
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        budgetPlan: { totalPlanned: -5 },
      })
    ).rejects.toThrow(TripValidationError);
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        transportPlans: [{ id: 'a' }, { id: 'a' }],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('rejects STEP 16 itinerary-section edits on a workspace without an itinerary', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      })
    ).rejects.toThrow(TripValidationError);
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        budgetPlan: { totalPlanned: 1 },
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});

describe('deleteTrip with owner verification', () => {
  it('deletes the owned trip when the owner matches', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));

    await tripService.deleteTrip('trip-abc', 'user-1');

    expect(h.docs.has('trips/trip-abc')).toBe(false);
  });

  it('rejects a missing trip with TripNotFoundError', async () => {
    await expect(tripService.deleteTrip('trip-abc', 'user-1')).rejects.toBeInstanceOf(
      TripNotFoundError
    );
    expect(h.deleteDoc).not.toHaveBeenCalled();
  });

  it('rejects deleting another user trip with TripPermissionError', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ ownerId: 'user-2' })));
    await expect(tripService.deleteTrip('trip-abc', 'user-1')).rejects.toBeInstanceOf(
      TripPermissionError
    );
    expect(h.deleteDoc).not.toHaveBeenCalled();
  });

  it('rejects an empty ownerId before any query', async () => {
    await expect(tripService.deleteTrip('trip-abc', '  ')).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('still deletes without an ownerId (rules-scoped path)', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await tripService.deleteTrip('trip-abc');
    expect(h.docs.has('trips/trip-abc')).toBe(false);
  });
});

describe('trip id helpers', () => {
  it('isValidTripId accepts sane ids and rejects unusable ones', () => {
    expect(isValidTripId('trip-abc')).toBe(true);
    expect(isValidTripId('')).toBe(false);
    expect(isValidTripId('.')).toBe(false);
    expect(isValidTripId('..')).toBe(false);
    expect(isValidTripId('a/b')).toBe(false);
    expect(isValidTripId('x'.repeat(1501))).toBe(false);
    expect(isValidTripId(7)).toBe(false);
  });

  it('assertTripId returns the id or throws TripValidationError', () => {
    expect(assertTripId('trip-abc')).toBe('trip-abc');
    expect(() => assertTripId('a/b')).toThrow(TripValidationError);
  });
});

describe('mapFirestoreError', () => {
  it('maps permission-denied and not-found codes to trip errors', () => {
    expect(mapFirestoreError(firestoreError('permission-denied'))).toBeInstanceOf(
      TripPermissionError
    );
    expect(mapFirestoreError(firestoreError('not-found'))).toBeInstanceOf(TripNotFoundError);
  });

  it('collapses unknown errors into a generic safe message', () => {
    const mapped = mapFirestoreError(new Error('secret internal detail'));
    expect(mapped).not.toBeInstanceOf(TripPermissionError);
    expect(mapped).not.toBeInstanceOf(TripNotFoundError);
    expect(mapped.message).not.toContain('secret internal detail');
  });

  it('handles non-error throws', () => {
    expect(() => mapFirestoreError('nope')).not.toThrow();
    expect(() => mapFirestoreError(null)).not.toThrow();
  });
});

describe('updateTripPlanning STEP 18 checklist tasks', () => {
  it('persists checklist tasks and returns them on the workspace', async () => {
    const original = makeTrip({ itinerary: makeSnapshot() });
    h.docs.set('trips/trip-abc', persisted(original));

    const tasks: TripChecklistItem[] = [
      {
        id: 'tsk-1',
        category: 'document-preparation',
        title: 'Apply for e-visa',
        status: 'in_progress',
        dueDate: '2026-09-20',
      },
      { id: 'tsk-2', category: 'general', title: 'Book airport transfer', status: 'pending' },
    ];
    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', { tasks });

    expect(updated.itinerary?.tasks).toEqual(tasks);

    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.itinerary?.tasks).toEqual(tasks);
  });

  it('patches only the tasks section, leaving the rest of the itinerary intact', async () => {
    const original = makeTrip({
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        summary: 'A balanced island escape.',
      }),
    });
    h.docs.set('trips/trip-abc', persisted(original));

    await tripService.updateTripPlanning('trip-abc', 'user-1', {
      tasks: [{ id: 'tsk-1', category: 'general', title: 'Pack', status: 'pending' }],
    });

    const stored = h.docs.get('trips/trip-abc') as Record<string, unknown> & {
      itinerary?: TripItinerarySnapshot;
    };
    expect(stored.itinerary?.transportPlans).toEqual([{ id: 'trp-1', mode: 'Flight' }]);
    expect(stored.itinerary?.summary).toBe('A balanced island escape.');
    expect(stored.itinerary?.tasks).toEqual([
      { id: 'tsk-1', category: 'general', title: 'Pack', status: 'pending' },
    ]);
  });

  it('clears checklist tasks via null', async () => {
    h.docs.set(
      'trips/trip-abc',
      persisted(
        makeTrip({
          itinerary: makeSnapshot({
            tasks: [{ id: 't', category: 'general', title: 'T', status: 'pending' }],
          }),
        })
      )
    );

    const updated = await tripService.updateTripPlanning('trip-abc', 'user-1', { tasks: null });

    expect(updated.itinerary?.tasks).toBeUndefined();
    expect(
      (
        h.docs.get('trips/trip-abc') as Record<string, unknown> & {
          itinerary?: TripItinerarySnapshot;
        }
      ).itinerary
    ).not.toHaveProperty('tasks');
  });

  it('rejects malformed update tasks before any query', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip({ itinerary: makeSnapshot() })));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        tasks: [
          {
            id: 'a',
            category: 'general',
            title: 'T',
            status: 'booked',
          } as unknown as TripChecklistItem,
        ],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();

    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        tasks: [
          { id: 'a', category: 'general', title: 'T', status: 'pending' },
          { id: 'a', category: 'general', title: 'T2', status: 'pending' },
        ],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.getDoc).not.toHaveBeenCalled();
  });

  it('rejects checklist task edits on a workspace without an itinerary', async () => {
    h.docs.set('trips/trip-abc', persisted(makeTrip()));
    await expect(
      tripService.updateTripPlanning('trip-abc', 'user-1', {
        tasks: [{ id: 'a', category: 'general', title: 'T', status: 'pending' }],
      })
    ).rejects.toThrow(TripValidationError);
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});
