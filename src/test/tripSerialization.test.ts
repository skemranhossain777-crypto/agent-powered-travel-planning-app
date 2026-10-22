import { describe, expect, it } from 'vitest';
import {
  TRIP_STATUSES,
  TRIP_VISIBILITIES,
  TripSerializationError,
  isValidStorageId,
  serializeTripUpdates,
  tripFromFirestore,
  tripToFirestore,
} from '../services/tripSerialization';
import type { TripItinerarySnapshot, TripWorkspace } from '../types/trip';

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

const updates = (u: object) => u as Partial<Omit<TripWorkspace, 'id' | 'ownerId'>>;

describe('constants', () => {
  it('declares the six statuses and two visibilities', () => {
    expect(TRIP_STATUSES).toEqual([
      'draft',
      'planning',
      'ready',
      'in_progress',
      'completed',
      'cancelled',
    ]);
    expect(TRIP_VISIBILITIES).toEqual(['private', 'shared']);
  });
});

describe('isValidStorageId', () => {
  it('accepts a normal trip id', () => {
    expect(isValidStorageId('trip-abc')).toBe(true);
  });

  it('rejects empty, dot, dotdot, slash, too-long, and non-string ids', () => {
    expect(isValidStorageId('')).toBe(false);
    expect(isValidStorageId('.')).toBe(false);
    expect(isValidStorageId('..')).toBe(false);
    expect(isValidStorageId('a/b')).toBe(false);
    expect(isValidStorageId('x'.repeat(1501))).toBe(false);
    expect(isValidStorageId(123)).toBe(false);
    expect(isValidStorageId(null)).toBe(false);
  });
});

describe('tripToFirestore', () => {
  it('maps a valid trip into the persisted TripDocument shape', () => {
    const document = tripToFirestore(
      makeTrip({
        status: 'planning',
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      })
    );

    expect(document).toEqual({
      ownerId: 'user-1',
      title: 'Island Escape',
      status: 'planning',
      visibility: 'private',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      memberCount: 1,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    });
  });

  it('omits dateRange when absent', () => {
    const document = tripToFirestore(makeTrip());
    expect(document).not.toHaveProperty('dateRange');
  });

  it('rejects an invalid id, ownerId, and title', () => {
    expect(() => tripToFirestore(makeTrip({ id: 'bad/id' }))).toThrow(TripSerializationError);
    expect(() => tripToFirestore(makeTrip({ ownerId: '  ' }))).toThrow(TripSerializationError);
    expect(() => tripToFirestore(makeTrip({ title: '' }))).toThrow(TripSerializationError);
  });

  it('rejects an invalid status and visibility', () => {
    expect(() =>
      tripToFirestore(makeTrip({ status: 'deleted' as TripWorkspace['status'] }))
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(makeTrip({ visibility: 'public' as TripWorkspace['visibility'] }))
    ).toThrow(TripSerializationError);
  });

  it('rejects an invalid dateRange', () => {
    expect(() =>
      tripToFirestore(makeTrip({ dateRange: { startDate: '2026-09-15', endDate: '2026-09-11' } }))
    ).toThrow(TripSerializationError);
  });

  it('rejects invalid destinations', () => {
    expect(() => tripToFirestore(makeTrip({ destinations: [] as unknown as never }))).not.toThrow();
    expect(() =>
      tripToFirestore(
        makeTrip({
          destinations: [{ id: 'd1' }] as unknown as never,
        })
      )
    ).toThrow(TripSerializationError);
    expect(() => tripToFirestore(makeTrip({ destinations: 'nope' as unknown as never }))).toThrow(
      TripSerializationError
    );
  });

  it('rejects an invalid memberCount', () => {
    expect(() => tripToFirestore(makeTrip({ memberCount: -1 }))).toThrow(TripSerializationError);
    expect(() => tripToFirestore(makeTrip({ memberCount: 1.5 }))).toThrow(TripSerializationError);
  });

  it('rejects invalid createdAt and updatedAt', () => {
    expect(() => tripToFirestore(makeTrip({ createdAt: 'not-a-date' }))).toThrow(
      TripSerializationError
    );
    expect(() => tripToFirestore(makeTrip({ updatedAt: 'not-a-date' }))).toThrow(
      TripSerializationError
    );
  });

  it('maps a valid itinerary snapshot into the document', () => {
    const itinerary = makeSnapshot({
      transport: [{ mode: 'Car', route: 'Airport → Ubud', estimatedCost: '$25' }],
    });
    const document = tripToFirestore(makeTrip({ itinerary }));

    expect(document.itinerary).toEqual(itinerary);
  });

  it('maps an itinerary snapshot with notes and references into the document', () => {
    const itinerary = makeSnapshot({
      notes: ['Book the beach club early.'],
      references: [{ id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 }],
    });
    const document = tripToFirestore(makeTrip({ itinerary }));

    expect(document.itinerary?.notes).toEqual(['Book the beach club early.']);
    expect(document.itinerary?.references).toEqual([
      { id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 },
    ]);
  });

  it('rejects an itinerary snapshot with malformed notes or references on write', () => {
    expect(() =>
      tripToFirestore(
        makeTrip({ itinerary: { ...makeSnapshot(), notes: [42] } } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: {
            ...makeSnapshot(),
            references: [{ id: '', kind: 'activity', title: 'A' }],
          },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: {
            ...makeSnapshot(),
            references: [{ id: 'a', kind: 'activity', title: 'A', url: 'javascript:alert(1)' }],
          },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
  });

  it('omits itinerary when absent', () => {
    const document = tripToFirestore(makeTrip());
    expect(document).not.toHaveProperty('itinerary');
  });

  it('rejects a malformed itinerary snapshot', () => {
    expect(() =>
      tripToFirestore(
        makeTrip({ itinerary: { ...makeSnapshot(), summary: 42 } } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: {
            ...makeSnapshot(),
            dayPlans: [{ dayNumber: 0, title: 'X', theme: 'Y', activities: [] }],
          },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(makeTrip({ itinerary: 'not-a-snapshot' as unknown as never }))
    ).toThrow(TripSerializationError);
  });

  it('sanitizes runtime-only keys out of the itinerary on write', () => {
    const raw = { ...makeSnapshot(), saved: true, createdAt: 'x' };
    const document = tripToFirestore(
      makeTrip({ itinerary: raw as unknown as TripItinerarySnapshot })
    );
    expect(document.itinerary).not.toHaveProperty('saved');
    expect(document.itinerary).not.toHaveProperty('createdAt');
    expect(document.itinerary?.summary).toBe('A balanced island escape.');
  });

  it('maps the STEP 16 plan sections into the document', () => {
    const itinerary = makeSnapshot({
      transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
      budgetPlan: { currency: 'USD', totalPlanned: 1200 },
    });
    const document = tripToFirestore(makeTrip({ itinerary }));
    expect(document.itinerary?.transportPlans).toEqual([{ id: 'trp-1', mode: 'Flight' }]);
    expect(document.itinerary?.accommodationPlans).toEqual([{ id: 'acp-1', name: 'Padi Hotel' }]);
    expect(document.itinerary?.budgetPlan).toEqual({ currency: 'USD', totalPlanned: 1200 });
  });

  it('rejects itinerary snapshots with malformed STEP 16 sections on write', () => {
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: {
            ...makeSnapshot(),
            transportPlans: [{ id: 'a', departureTime: 'tomorrow' }],
          },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: {
            ...makeSnapshot(),
            transportPlans: [{ id: 'a' }, { id: 'a' }],
          },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      tripToFirestore(
        makeTrip({
          itinerary: { ...makeSnapshot(), budgetPlan: { totalPlanned: -5 } },
        } as unknown as TripWorkspace)
      )
    ).toThrow(TripSerializationError);
  });
});

describe('tripFromFirestore', () => {
  const raw = {
    ownerId: 'user-1',
    title: 'Island Escape',
    status: 'planning',
    visibility: 'private',
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    memberCount: 1,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  };

  it('rebuilds a workspace with the document id as the trip id', () => {
    expect(tripFromFirestore('trip-abc', raw)).toEqual({ id: 'trip-abc', ...raw });
  });

  it('omits dateRange when null or absent', () => {
    const { dateRange: _ignored, ...withoutRange } = raw;
    void _ignored;
    const workspace = tripFromFirestore('trip-abc', withoutRange);
    expect(workspace?.dateRange).toBeUndefined();

    expect(tripFromFirestore('trip-abc', { ...raw, dateRange: null })?.dateRange).toBeUndefined();
  });

  it('reads an itinerary snapshot when present', () => {
    const withItinerary = { ...raw, itinerary: makeSnapshot() };
    const workspace = tripFromFirestore('trip-abc', withItinerary);
    expect(workspace?.itinerary).toEqual(makeSnapshot());
  });

  it('reads an itinerary snapshot with notes and references when present', () => {
    const itinerary = makeSnapshot({
      notes: ['Book the beach club early.'],
      references: [{ id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 }],
    });
    const workspace = tripFromFirestore('trip-abc', { ...raw, itinerary });
    expect(workspace?.itinerary?.notes).toEqual(['Book the beach club early.']);
    expect(workspace?.itinerary?.references).toEqual([
      { id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 },
    ]);
  });

  it('reads a reference with a safe external url verbatim', () => {
    const itinerary = makeSnapshot({
      references: [{ id: 'a', kind: 'activity', title: 'A', url: 'https://example.com/x' }],
    });
    const workspace = tripFromFirestore('trip-abc', { ...raw, itinerary });
    expect(workspace?.itinerary?.references?.[0].url).toBe('https://example.com/x');
  });

  it('rejects an itinerary snapshot with an unsafe reference url on read', () => {
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          references: [{ id: 'a', kind: 'activity', title: 'A', url: 'javascript:alert(1)' }],
        },
      })
    ).toBeNull();
  });

  it('rejects an itinerary snapshot with malformed notes or references on read', () => {
    expect(
      tripFromFirestore('trip-abc', { ...raw, itinerary: { ...makeSnapshot(), notes: [42] } })
    ).toBeNull();
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          references: [{ id: '', kind: 'activity', title: 'A' }],
        },
      })
    ).toBeNull();
  });

  it('omits itinerary when null or absent', () => {
    const { trip: _ignored, ...withoutItinerary } = { trip: raw };
    void _ignored;
    const workspace = tripFromFirestore('trip-abc', withoutItinerary);
    expect(workspace?.itinerary).toBeUndefined();

    expect(tripFromFirestore('trip-abc', { ...raw, itinerary: null })?.itinerary).toBeUndefined();
  });

  it('rejects a malformed itinerary snapshot', () => {
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: { ...makeSnapshot(), summary: 42 },
      })
    ).toBeNull();
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: { ...makeSnapshot(), budgetLevel: 'Ultra' },
      })
    ).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, itinerary: 'nope' })).toBeNull();
  });

  it('duck-types Firestore Timestamp-shaped date-times', () => {
    const withTimestamps = {
      ...raw,
      createdAt: { toDate: () => new Date('2026-09-10T08:00:00.000Z') },
      updatedAt: { toDate: () => new Date('2026-09-10T09:00:00.000Z') },
    };
    const workspace = tripFromFirestore('trip-abc', withTimestamps);
    expect(workspace?.createdAt).toBe('2026-09-10T08:00:00.000Z');
    expect(workspace?.updatedAt).toBe('2026-09-10T09:00:00.000Z');
  });

  it('returns null when a Timestamp-shaped date-time throws', () => {
    const broken = {
      ...raw,
      createdAt: {
        toDate: () => {
          throw new Error('clock failure');
        },
      },
    };
    expect(tripFromFirestore('trip-abc', broken)).toBeNull();
  });

  it('reads itinerary STEP 16 plan sections when present', () => {
    const itinerary = makeSnapshot({
      transportPlans: [{ id: 'trp-1', mode: 'Flight', departureTime: '2026-09-11T08:30' }],
      accommodationPlans: [{ id: 'acp-1', checkInDate: '2026-09-11', checkOutDate: '2026-09-15' }],
      budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
    });
    const workspace = tripFromFirestore('trip-abc', { ...raw, itinerary });
    expect(workspace?.itinerary?.transportPlans).toEqual([
      { id: 'trp-1', mode: 'Flight', departureTime: '2026-09-11T08:30' },
    ]);
    expect(workspace?.itinerary?.accommodationPlans).toEqual([
      { id: 'acp-1', checkInDate: '2026-09-11', checkOutDate: '2026-09-15' },
    ]);
    expect(workspace?.itinerary?.budgetPlan).toEqual({
      currency: 'USD',
      totalPlanned: 1200,
      allocations: { food: 300 },
    });
  });

  it('rejects itinerary snapshots with malformed STEP 16 sections on read', () => {
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          transportPlans: [{ id: 'a' }, { id: 'a' }],
        },
      })
    ).toBeNull();
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          accommodationPlans: [{ id: 'a', checkInDate: 'x' }],
        },
      })
    ).toBeNull();
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: { ...makeSnapshot(), budgetPlan: { currency: 'US$' } },
      })
    ).toBeNull();
  });

  it('round-trips a workspace with STEP 16 sections through toFirestore and back', () => {
    const trip = makeTrip({
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', departureTime: '2026-09-11T08:30' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', checkInDate: '2026-09-11' }],
        budgetPlan: { currency: 'USD', totalPlanned: 800, allocations: { other: 200 } },
      }),
    });
    const document = tripToFirestore(trip);
    expect(document.itinerary).toEqual(trip.itinerary);
    const restored = tripFromFirestore('trip-abc', document);
    expect(restored).toEqual(trip);
  });

  it('round-trips STEP 17 readiness metadata through toFirestore and back', () => {
    const trip = makeTrip({
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', readiness: { state: 'user-confirmed', note: 'ABC-123' } },
        ],
        accommodationPlans: [
          { id: 'acp-1', name: 'Padi Hotel', readiness: { state: 'planned' } },
        ],
      }),
    });
    const document = tripToFirestore(trip);
    expect(document.itinerary).toEqual(trip.itinerary);
    const restored = tripFromFirestore('trip-abc', document);
    expect(restored).toEqual(trip);
  });

  it('rejects snapshots with booking-claim readiness on read', () => {
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          transportPlans: [{ id: 'a', readiness: { state: 'booked' } }],
        },
      })
    ).toBeNull();
    expect(
      tripFromFirestore('trip-abc', {
        ...raw,
        itinerary: {
          ...makeSnapshot(),
          accommodationPlans: [{ id: 'a', readiness: { state: 'confirmed-reservation' } }],
        },
      })
    ).toBeNull();
  });

  it('returns null for non-object or malformed payloads', () => {
    expect(tripFromFirestore('trip-abc', null)).toBeNull();
    expect(tripFromFirestore('trip-abc', 'nope')).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, status: 'bogus' })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, ownerId: '' })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, title: 42 })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, visibility: 'public' })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, memberCount: -1 })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, createdAt: 'whenever' })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, updatedAt: null })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, destinations: 'x' })).toBeNull();
    expect(tripFromFirestore('trip-abc', { ...raw, destinations: [{ id: 'd1' }] })).toBeNull();
    expect(
      tripFromFirestore('trip-abc', { ...raw, dateRange: { startDate: 'x', endDate: 'y' } })
    ).toBeNull();
    expect(tripFromFirestore('bad/trip', { ...raw })).toBeNull();
  });
});

describe('serializeTripUpdates', () => {
  it('serializes each mutable field', () => {
    const result = serializeTripUpdates(
      updates({
        title: 'New Title',
        status: 'ready',
        visibility: 'shared',
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-13' },
        destinations: [{ id: 'd2', name: 'Canggu', country: 'Indonesia' }],
        memberCount: 3,
      })
    );

    expect(result).toEqual({
      values: {
        title: 'New Title',
        status: 'ready',
        visibility: 'shared',
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-13' },
        destinations: [{ id: 'd2', name: 'Canggu', country: 'Indonesia' }],
        memberCount: 3,
      },
      deletions: [],
    });
  });

  it('treats an undefined dateRange as a clear (deletion)', () => {
    const result = serializeTripUpdates(updates({ dateRange: undefined }));
    expect(result.values).not.toHaveProperty('dateRange');
    expect(result.deletions).toEqual(['dateRange']);
  });

  it('returns empty payloads for an empty update', () => {
    expect(serializeTripUpdates({})).toEqual({ values: {}, deletions: [] });
  });

  it('serializes an itinerary snapshot and treats undefined as a clear', () => {
    const itinerary = makeSnapshot();
    const setResult = serializeTripUpdates(updates({ itinerary }));
    expect(setResult.values.itinerary).toEqual(itinerary);
    expect(setResult.deletions).toEqual([]);

    const clearResult = serializeTripUpdates(updates({ itinerary: undefined }));
    expect(clearResult.values).not.toHaveProperty('itinerary');
    expect(clearResult.deletions).toEqual(['itinerary']);
  });

  it('serializes an itinerary snapshot with notes and references', () => {
    const itinerary = makeSnapshot({
      notes: ['n1'],
      references: [{ id: 'a', kind: 'activity', title: 'A' }],
    });
    const result = serializeTripUpdates(updates({ itinerary }));
    expect(result.values.itinerary).toEqual(itinerary);
    expect(result.deletions).toEqual([]);
  });

  it('rejects a malformed itinerary snapshot in updates', () => {
    expect(() =>
      serializeTripUpdates(
        updates({ itinerary: { ...makeSnapshot(), durationDays: 0 } as TripItinerarySnapshot })
      )
    ).toThrow(TripSerializationError);
    expect(() =>
      serializeTripUpdates(
        updates({
          itinerary: {
            ...makeSnapshot(),
            references: [{ id: 'a', kind: 'activity', title: 'A', url: 'file:///etc/passwd' }],
          } as TripItinerarySnapshot,
        })
      )
    ).toThrow(TripSerializationError);
  });

  it('rejects identity and managed timestamps', () => {
    expect(() =>
      serializeTripUpdates({ id: 'x' } as unknown as Partial<Omit<TripWorkspace, 'id' | 'ownerId'>>)
    ).toThrow('id cannot be updated');
    expect(() =>
      serializeTripUpdates({ ownerId: 'u2' } as unknown as Partial<
        Omit<TripWorkspace, 'id' | 'ownerId'>
      >)
    ).toThrow('ownerId cannot be updated');
    expect(() =>
      serializeTripUpdates({ createdAt: 'x' } as unknown as Partial<
        Omit<TripWorkspace, 'id' | 'ownerId'>
      >)
    ).toThrow('createdAt cannot be updated');
    expect(() =>
      serializeTripUpdates({ updatedAt: 'x' } as unknown as Partial<
        Omit<TripWorkspace, 'id' | 'ownerId'>
      >)
    ).toThrow('updatedAt is managed');
  });

  it('rejects invalid field values', () => {
    expect(() => serializeTripUpdates(updates({ title: '  ' }))).toThrow(TripSerializationError);
    expect(() =>
      serializeTripUpdates(updates({ status: 'deleted' as TripWorkspace['status'] }))
    ).toThrow(TripSerializationError);
    expect(() =>
      serializeTripUpdates(updates({ visibility: 'public' as TripWorkspace['visibility'] }))
    ).toThrow(TripSerializationError);
    expect(() =>
      serializeTripUpdates(
        updates({ dateRange: { startDate: '2026-09-15', endDate: '2026-09-11' } })
      )
    ).toThrow(TripSerializationError);
    expect(() => serializeTripUpdates(updates({ memberCount: -2 }))).toThrow(
      TripSerializationError
    );
    expect(() => serializeTripUpdates(updates({ destinations: {} as unknown as never }))).toThrow(
      TripSerializationError
    );
  });
});
