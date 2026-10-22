import { describe, expect, it } from 'vitest';
import {
  applyTripPlanningUpdate,
  getDestinationLimitProblem,
  getPlanningUpdateProblem,
  isPlanningUpdateDirty,
  MAX_TRIP_DESTINATIONS,
  normalizeTripPlanningUpdate,
  updateTripAccommodationPlans,
  updateTripBudgetPlan,
  updateTripDateRange,
  updateTripDays,
  updateTripDestinations,
  updateTripNotes,
  updateTripReferences,
  updateTripTasks,
  updateTripTransportPlans,
} from '../domain/trips/tripPlanningEdit';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { Itinerary } from '../types/travel';
import type {
  TripAccommodationPlan,
  TripBudgetPlan,
  TripChecklistItem,
  TripDestination,
  TripItinerarySnapshot,
  TripPlanningReference,
  TripTransportPlan,
  TripWorkspace,
} from '../types/trip';
import { itineraryToTripWorkspace } from '../domain/trips/tripModel';

const NOW = '2026-09-11T12:00:00.000Z';

function makeWorkspace(overrides: Partial<TripWorkspace> = {}): TripWorkspace {
  return {
    ...createDraftTrip({
      ownerId: 'user-1',
      title: 'Island Escape',
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      now: NOW,
    }),
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

function workspaceWithItinerary(): TripWorkspace {
  return makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    itinerary: makeSnapshot(),
  });
}

function referenceWith(overrides: Partial<TripPlanningReference> = {}): TripPlanningReference {
  return { id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', ...overrides };
}

function destinationList(count: number): TripDestination[] {
  return Array.from({ length: count }, (_, i) => ({ id: `d${i + 1}`, name: `City ${i + 1}` }));
}

function transportPlanWith(overrides: Partial<TripTransportPlan> = {}): TripTransportPlan {
  return { id: 'trp-1', mode: 'Flight', ...overrides };
}

function accommodationPlanWith(
  overrides: Partial<TripAccommodationPlan> = {}
): TripAccommodationPlan {
  return { id: 'acp-1', name: 'Padi Hotel', ...overrides };
}

describe('normalizeTripPlanningUpdate', () => {
  it('accepts an empty update (no sections changed)', () => {
    expect(normalizeTripPlanningUpdate({})).toEqual({});
  });

  it('rejects non-objects and unknown keys', () => {
    expect(normalizeTripPlanningUpdate(null)).toBeNull();
    expect(normalizeTripPlanningUpdate('nope')).toBeNull();
    expect(normalizeTripPlanningUpdate(42)).toBeNull();
    expect(normalizeTripPlanningUpdate([])).toBeNull();
    expect(normalizeTripPlanningUpdate({ title: 'X' })).toBeNull();
    expect(normalizeTripPlanningUpdate({ transcript: [] })).toBeNull();
  });

  it('accepts a valid dateRange and a null clear', () => {
    expect(
      normalizeTripPlanningUpdate({ dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' } })
    ).toEqual({ dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' } });
    expect(normalizeTripPlanningUpdate({ dateRange: null })).toEqual({ dateRange: null });
  });

  it('rejects an invalid or malformed dateRange', () => {
    expect(
      normalizeTripPlanningUpdate({ dateRange: { startDate: '2026-09-15', endDate: '2026-09-11' } })
    ).toBeNull();
    expect(normalizeTripPlanningUpdate({ dateRange: 'whenever' })).toBeNull();
    expect(normalizeTripPlanningUpdate({ dateRange: { startDate: 'x' } })).toBeNull();
  });

  it('accepts valid destinations and rejects malformed or duplicate-id lists', () => {
    const good = [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }];
    expect(normalizeTripPlanningUpdate({ destinations: good })).toEqual({ destinations: good });

    expect(normalizeTripPlanningUpdate({ destinations: [] })).toEqual({ destinations: [] });
    expect(normalizeTripPlanningUpdate({ destinations: [{ id: '', name: 'X' }] })).toBeNull();
    expect(normalizeTripPlanningUpdate({ destinations: [{ id: 'd1', name: '' }] })).toBeNull();
    expect(normalizeTripPlanningUpdate({ destinations: 'nope' })).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        destinations: [
          { id: 'd1', name: 'Ubud' },
          { id: 'd1', name: 'Canggu' },
        ],
      })
    ).toBeNull();
  });

  it('accepts valid days and rejects malformed or duplicate-numbered days', () => {
    const good = {
      days: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
    };
    expect(normalizeTripPlanningUpdate(good)).toEqual(good);

    expect(normalizeTripPlanningUpdate({ days: [] })).toEqual({ days: [] });
    expect(
      normalizeTripPlanningUpdate({
        days: [{ dayNumber: 0, title: 'X', theme: 'Y', activities: [] }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        days: [{ dayNumber: 1, title: 'X', theme: 'Y', activities: 'nope' }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        days: [
          { dayNumber: 1, title: 'A', theme: 'Y', activities: [] },
          { dayNumber: 1, title: 'B', theme: 'Y', activities: [] },
        ],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        days: [
          {
            dayNumber: 1,
            title: 'A',
            theme: 'Y',
            activities: [
              {
                time: 42,
                title: '',
                description: '',
                locationName: '',
                category: '',
                estimatedCost: '',
              },
            ],
          },
        ],
      })
    ).toBeNull();
  });

  it('accepts string notes and rejects non-string entries', () => {
    expect(normalizeTripPlanningUpdate({ notes: ['first', 'second'] })).toEqual({
      notes: ['first', 'second'],
    });
    expect(normalizeTripPlanningUpdate({ notes: [] })).toEqual({ notes: [] });
    expect(normalizeTripPlanningUpdate({ notes: ['ok', 42] })).toBeNull();
    expect(normalizeTripPlanningUpdate({ notes: 'nope' })).toBeNull();
  });

  it('accepts valid references and rejects malformed or duplicate-id ones', () => {
    const good = referenceWith();
    expect(normalizeTripPlanningUpdate({ references: [good] })).toEqual({ references: [good] });

    expect(normalizeTripPlanningUpdate({ references: [] })).toEqual({ references: [] });
    expect(
      normalizeTripPlanningUpdate({ references: [{ id: '', kind: 'activity', title: 'X' }] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ references: [{ id: 'a', kind: 'hotel', title: 'X' }] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ references: [good, { ...good, id: 'act-1' }] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ references: [referenceWith({ url: 'javascript:alert(1)' })] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        references: [
          referenceWith({
            provider: 'Google Places',
            providerId: 'ChIJ',
            location: { latitude: 52.36, longitude: 4.885 },
            address: 'Museumstraat 1',
            category: 'museum',
            url: 'https://maps.google.com/?cid=1',
          }),
        ],
      })
    ).toEqual({
      references: [
        referenceWith({
          provider: 'Google Places',
          providerId: 'ChIJ',
          location: { latitude: 52.36, longitude: 4.885 },
          address: 'Museumstraat 1',
          category: 'museum',
          url: 'https://maps.google.com/?cid=1',
        }),
      ],
    });
    expect(
      normalizeTripPlanningUpdate({
        references: [referenceWith({ location: { latitude: 95, longitude: 0 } })],
      })
    ).toBeNull();
  });

  it('rebuilds the update so runtime-only keys are stripped', () => {
    expect(
      normalizeTripPlanningUpdate({ notes: ['x'], runtime: true } as unknown as never)
    ).toBeNull();
  });
});

describe('applyTripPlanningUpdate', () => {
  it('never mutates the input workspace', () => {
    const workspace = workspaceWithItinerary();
    const snapshot = workspace.itinerary as TripItinerarySnapshot;
    const original = JSON.stringify(workspace);

    applyTripPlanningUpdate(workspace, {
      days: [{ dayNumber: 1, title: 'Changed', theme: 'Y', activities: [] }],
      notes: ['new note'],
    });

    expect(JSON.stringify(workspace)).toBe(original);
    expect(snapshot.dayPlans).toHaveLength(0);
  });

  it('clears dateRange when the update asks for null', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    });
    const next = applyTripPlanningUpdate(workspace, { dateRange: null });
    expect(next.dateRange).toBeUndefined();
    expect(workspace.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });
  });

  it('replaces destination records without aliasing persisted state', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      destinations: [{ id: 'd2', name: 'Canggu', country: 'Indonesia' }],
    });
    expect(next.destinations).toEqual([{ id: 'd2', name: 'Canggu', country: 'Indonesia' }]);
    next.destinations[0].name = 'Mutated';
    expect(workspace.destinations[0].name).toBe('Ubud');
  });

  it('replaces day plans without aliasing the snapshot', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
      }),
    });
    const next = applyTripPlanningUpdate(workspace, {
      days: [{ dayNumber: 2, title: 'Beach', theme: 'Relax', activities: [] }],
    });
    expect(next.itinerary?.dayPlans.map((day) => day.dayNumber)).toEqual([2]);
    expect(workspace.itinerary?.dayPlans.map((day) => day.dayNumber)).toEqual([1]);
  });

  it('trims notes and drops empty entries on application', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      notes: ['  Keep  ', '', '   ', 'Second'],
    });
    expect(next.itinerary?.notes).toEqual(['Keep', 'Second']);
  });

  it('replaces references without aliasing persisted state', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ references: [referenceWith()] }),
    });
    const next = applyTripPlanningUpdate(workspace, {
      references: [referenceWith({ id: 'act-2', title: 'Rice Terraces' })],
    });
    expect(next.itinerary?.references?.map((r) => r.id)).toEqual(['act-2']);
    expect(workspace.itinerary?.references?.map((r) => r.id)).toEqual(['act-1']);
  });

  it('preserves identity, lifecycle, and read-only itinerary sections', () => {
    const workspace = makeWorkspace({
      status: 'planning',
      visibility: 'shared',
      memberCount: 2,
      itinerary: makeSnapshot({
        transport: [{ mode: 'Car', route: 'Airport → Ubud', estimatedCost: '$25' }],
        hotels: [
          { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
        ],
        sightseeingCost: '$40',
      }),
    });
    const next = applyTripPlanningUpdate(workspace, { notes: ['n'] });

    expect(next).toMatchObject({
      id: workspace.id,
      ownerId: workspace.ownerId,
      title: workspace.title,
      status: workspace.status,
      visibility: workspace.visibility,
      memberCount: workspace.memberCount,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    });
    expect(next.itinerary?.summary).toBe('A balanced island escape.');
    expect(next.itinerary?.transport).toEqual(workspace.itinerary?.transport);
    expect(next.itinerary?.hotels).toEqual(workspace.itinerary?.hotels);
    expect(next.itinerary?.sightseeingCost).toBe('$40');
  });

  it('ignores itinerary-section edits on a workspace without an itinerary', () => {
    const workspace = makeWorkspace();
    const next = applyTripPlanningUpdate(workspace, {
      days: [{ dayNumber: 1, title: 'X', theme: 'Y', activities: [] }],
      notes: ['n'],
      references: [referenceWith()],
    });
    expect(next.itinerary).toBeUndefined();
  });
});

describe('isPlanningUpdateDirty', () => {
  it('is false for an empty update and for matching persisted values', () => {
    const workspace = workspaceWithItinerary();
    expect(isPlanningUpdateDirty(workspace, {})).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { dateRange: workspace.dateRange })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { destinations: workspace.destinations })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { days: workspace.itinerary?.dayPlans ?? [] })).toBe(
      false
    );
    expect(isPlanningUpdateDirty(workspace, { notes: workspace.itinerary?.notes ?? [] })).toBe(
      false
    );
    expect(
      isPlanningUpdateDirty(workspace, { references: workspace.itinerary?.references ?? [] })
    ).toBe(false);
  });

  it('is true when a section differs', () => {
    const workspace = workspaceWithItinerary();
    expect(
      isPlanningUpdateDirty(workspace, {
        dateRange: { startDate: '2026-09-12', endDate: '2026-09-15' },
      })
    ).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { dateRange: null })).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { destinations: [{ id: 'd2', name: 'Canggu' }] })).toBe(
      true
    );
    expect(
      isPlanningUpdateDirty(workspace, {
        days: [{ dayNumber: 1, title: 'X', theme: 'Y', activities: [] }],
      })
    ).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { notes: ['new'] })).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, { references: [referenceWith({ title: 'Other' })] })
    ).toBe(true);
  });

  it('treats trimmed-equivalent notes as unchanged', () => {
    const workspace = makeWorkspace({ itinerary: makeSnapshot({ notes: ['  Book early  '] }) });
    expect(isPlanningUpdateDirty(workspace, { notes: ['Book early'] })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { notes: ['Different'] })).toBe(true);
  });
});

describe('getPlanningUpdateProblem', () => {
  it('returns null for an empty or well-formed update', () => {
    expect(getPlanningUpdateProblem({})).toBeNull();
    expect(
      getPlanningUpdateProblem({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        destinations: [{ id: 'd1', name: 'Ubud' }],
        notes: ['ok'],
      })
    ).toBeNull();
  });

  it('reports invalid dates, destinations, days, notes, and references', () => {
    expect(getPlanningUpdateProblem({ dateRange: { startDate: 'x', endDate: 'y' } })).toMatch(
      /start and end date/
    );
    expect(getPlanningUpdateProblem({ destinations: [{ id: 'd1', name: '' }] })).toMatch(/name/);
    expect(
      getPlanningUpdateProblem({
        days: [{ dayNumber: 0, title: 'X', theme: 'Y', activities: [] }],
      })
    ).toMatch(/Every day/);
    expect(getPlanningUpdateProblem({ notes: ['ok', 42] as never })).toMatch(/plain text/);
    expect(
      getPlanningUpdateProblem({ references: [referenceWith({ url: 'ftp://example.com' })] })
    ).toMatch(/safe link/);
  });

  it('reports duplicate ids and day numbers', () => {
    expect(
      getPlanningUpdateProblem({
        destinations: [
          { id: 'd1', name: 'A' },
          { id: 'd1', name: 'B' },
        ],
      })
    ).toMatch(/unique/);
    expect(
      getPlanningUpdateProblem({
        days: [
          { dayNumber: 1, title: 'A', theme: 'X', activities: [] },
          { dayNumber: 1, title: 'B', theme: 'X', activities: [] },
        ],
      })
    ).toMatch(/unique/);
  });
});

describe('destination cap', () => {
  it('exposes a cap of 20 destinations', () => {
    expect(MAX_TRIP_DESTINATIONS).toBe(20);
  });

  it('accepts a list at the cap and rejects a changed over-limit list', () => {
    expect(getDestinationLimitProblem(destinationList(0), [])).toBeNull();
    expect(getDestinationLimitProblem(destinationList(20), [])).toBeNull();
    expect(getDestinationLimitProblem(destinationList(21), [])).toMatch(/at most 20/);
  });

  it('keeps an unchanged over-limit legacy list acceptable', () => {
    const legacy = destinationList(25);
    expect(getDestinationLimitProblem(legacy, legacy)).toBeNull();
    expect(getDestinationLimitProblem(destinationList(25), destinationList(25))).toBeNull();

    const changed = destinationList(25);
    changed[0] = { id: 'd1', name: 'Changed' };
    expect(getDestinationLimitProblem(changed, legacy)).toMatch(/at most 20/);
  });

  it('threads the persisted list through getPlanningUpdateProblem', () => {
    const legacy = destinationList(25);
    // Without the persisted context the cap is not applied (structural check only).
    expect(getPlanningUpdateProblem({ destinations: destinationList(21) })).toBeNull();
    // With the persisted context a changed over-limit list is reported.
    expect(
      getPlanningUpdateProblem({ destinations: destinationList(21) }, { existingDestinations: [] })
    ).toMatch(/at most 20/);
    // The unchanged legacy list stays valid.
    expect(
      getPlanningUpdateProblem({ destinations: legacy }, { existingDestinations: legacy })
    ).toBeNull();
  });
});

describe('section update helpers', () => {
  it('updateTripDateRange sets and clears dates, rejecting invalid input', () => {
    const workspace = makeWorkspace();
    const withDates = updateTripDateRange(workspace, {
      startDate: '2026-09-11',
      endDate: '2026-09-15',
    });
    expect(withDates.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });

    expect(updateTripDateRange(withDates, null).dateRange).toBeUndefined();
    expect(() =>
      updateTripDateRange(workspace, { startDate: '2026-09-15', endDate: '2026-09-11' })
    ).toThrow(TypeError);
  });

  it('updateTripDestinations replaces destinations and validates input', () => {
    const workspace = workspaceWithItinerary();
    expect(updateTripDestinations(workspace, []).destinations).toEqual([]);
    expect(() => updateTripDestinations(workspace, [{ id: '', name: 'X' }])).toThrow(TypeError);
  });

  it('updateTripDays replaces day plans and validates input', () => {
    const workspace = workspaceWithItinerary();
    const days = [{ dayNumber: 1, title: 'Beach', theme: 'Relax', activities: [] }];
    expect(updateTripDays(workspace, days).itinerary?.dayPlans).toEqual(days);
    expect(() =>
      updateTripDays(workspace, [{ dayNumber: 0, title: 'X', theme: 'Y', activities: [] }])
    ).toThrow(TypeError);
  });

  it('updateTripNotes trims notes and validates input', () => {
    const workspace = workspaceWithItinerary();
    expect(updateTripNotes(workspace, ['  a  ', '', 'b']).itinerary?.notes).toEqual(['a', 'b']);
    expect(() => updateTripNotes(workspace, ['ok', 42] as never)).toThrow(TypeError);
  });

  it('updateTripReferences replaces references and validates unsafe urls', () => {
    const workspace = workspaceWithItinerary();
    const next = updateTripReferences(workspace, [
      referenceWith({ url: 'https://example.com/things' }),
    ]);
    expect(next.itinerary?.references?.[0].url).toBe('https://example.com/things');
    expect(() =>
      updateTripReferences(workspace, [referenceWith({ url: 'javascript:alert(1)' })])
    ).toThrow(TypeError);
  });
});

describe('editable planning never touches booking/execution semantics', () => {
  it('runs over an itinerary-promoted workspace and preserves the generating itinerary', () => {
    const itinerary: Itinerary = {
      id: 'itin-1',
      destination: 'Bali',
      country: 'Indonesia',
      durationDays: 3,
      budgetLevel: 'Moderate',
      travelStyle: 'Solo',
      interests: ['beaches'],
      summary: 'A short island escape.',
      estimatedTotalCost: '$900',
      bestTimeToVisit: 'April–October',
      dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
      createdAt: NOW,
      saved: true,
    };
    const workspace = itineraryToTripWorkspace(itinerary, {
      ownerId: 'user-1',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-13' },
    });

    const next = applyTripPlanningUpdate(workspace, { notes: ['Remember sunscreen'] });

    expect(next.itinerary?.notes).toEqual(['Remember sunscreen']);
    expect(workspace.itinerary?.notes).toBeUndefined();
    expect(itinerary.dayPlans).toHaveLength(1);
  });
});

describe('STEP 16 transport plan updates', () => {
  it('normalizes transport plans by trimming strings and dropping empty optional keys', () => {
    const normalized = normalizeTripPlanningUpdate({
      transportPlans: [
        {
          id: '  trp-1  ',
          mode: '  Flight  ',
          provider: '   ',
          departureLocation: 'Denpasar',
          departureTime: '2026-09-11T08:30',
          notes: 'window seat',
        } as unknown as TripTransportPlan,
      ],
    });
    expect(normalized).toEqual({
      transportPlans: [
        {
          id: 'trp-1',
          mode: 'Flight',
          departureLocation: 'Denpasar',
          departureTime: '2026-09-11T08:30',
          notes: 'window seat',
        },
      ],
    });
  });

  it('rejects malformed, non-string, missing-id, or duplicate-id transport plans', () => {
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', departureTime: 'not-a-time' }],
      })
    ).toBeNull();
    expect(normalizeTripPlanningUpdate({ transportPlans: [{ id: '', mode: 'X' }] })).toBeNull();
    expect(normalizeTripPlanningUpdate({ transportPlans: [{ id: 'a', mode: 42 }] })).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ transportPlans: [transportPlanWith(), transportPlanWith()] })
    ).toBeNull();
    expect(normalizeTripPlanningUpdate({ transportPlans: 'nope' })).toBeNull();
  });

  it('accepts a full ISO datetime as well as a plain ISO date', () => {
    const late = { id: 'trp-1', departureTime: '2026-09-11T23:45:00.000Z' };
    const day = { id: 'trp-1', arrivalTime: '2026-09-15' };
    expect(normalizeTripPlanningUpdate({ transportPlans: [late] })).toEqual({
      transportPlans: [late],
    });
    expect(normalizeTripPlanningUpdate({ transportPlans: [day] })).toEqual({
      transportPlans: [day],
    });
  });

  it('applies transport plans when an itinerary exists and rejects without one', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, { transportPlans: [transportPlanWith()] });
    expect(next.itinerary?.transportPlans).toEqual([transportPlanWith()]);
    expect(workspace.itinerary?.transportPlans).toBeUndefined();

    const blank = applyTripPlanningUpdate(makeWorkspace(), {
      transportPlans: [transportPlanWith()],
    });
    expect(blank.itinerary).toBeUndefined();
  });

  it('reports a clear problem for malformed transport plans', () => {
    expect(
      getPlanningUpdateProblem({ transportPlans: [{ id: 'a', departureTime: 'nope' }] })
    ).toMatch(/transport plan/);
    expect(
      getPlanningUpdateProblem({ transportPlans: [transportPlanWith(), transportPlanWith()] })
    ).toMatch(/unique/);
  });

  it('updateTripTransportPlans replaces plans and validates input', () => {
    const workspace = workspaceWithItinerary();
    const plans = [transportPlanWith({ arrivalTime: '2026-09-11T12:00' })];
    expect(updateTripTransportPlans(workspace, plans).itinerary?.transportPlans).toEqual(plans);
    expect(() => updateTripTransportPlans(workspace, [{ id: 'a', arrivalTime: 'nope' }])).toThrow(
      TypeError
    );
  });
});

describe('STEP 16 accommodation plan updates', () => {
  it('normalizes accommodation plans and rejects reversed or malformed dates', () => {
    expect(
      normalizeTripPlanningUpdate({
        accommodationPlans: [
          {
            id: '  acp-1  ',
            name: '  Padi Hotel  ',
            checkInDate: '2026-09-11',
            checkOutDate: '2026-09-15',
          } as unknown as TripAccommodationPlan,
        ],
      })
    ).toEqual({
      accommodationPlans: [
        { id: 'acp-1', name: 'Padi Hotel', checkInDate: '2026-09-11', checkOutDate: '2026-09-15' },
      ],
    });

    expect(
      normalizeTripPlanningUpdate({
        accommodationPlans: [{ id: 'a', checkInDate: '2026-09-15', checkOutDate: '2026-09-11' }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ accommodationPlans: [{ id: 'a', checkInDate: 'Sept 11' }] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ accommodationPlans: [{ id: 'a' }, { id: 'a' }] })
    ).toBeNull();
  });

  it('applies accommodation plans when an itinerary exists and rejects without one', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      accommodationPlans: [accommodationPlanWith()],
    });
    expect(next.itinerary?.accommodationPlans).toEqual([accommodationPlanWith()]);
    expect(workspace.itinerary?.accommodationPlans).toBeUndefined();
  });

  it('reports a clear problem for malformed accommodation plans', () => {
    expect(
      getPlanningUpdateProblem({
        accommodationPlans: [{ id: 'a', checkInDate: '2026-09-15', checkOutDate: '2026-09-11' }],
      })
    ).toMatch(/accommodation plan/);
    expect(
      getPlanningUpdateProblem({
        accommodationPlans: [accommodationPlanWith(), accommodationPlanWith()],
      })
    ).toMatch(/unique/);
  });

  it('updateTripAccommodationPlans replaces plans and validates dates', () => {
    const workspace = workspaceWithItinerary();
    const plans = [accommodationPlanWith({ checkInDate: '2026-09-11' })];
    expect(updateTripAccommodationPlans(workspace, plans).itinerary?.accommodationPlans).toEqual(
      plans
    );
    expect(() => updateTripAccommodationPlans(workspace, [{ id: 'a', checkInDate: 'x' }])).toThrow(
      TypeError
    );
  });
});

describe('STEP 16 budget plan updates', () => {
  it('normalizes a budget plan by trimming strings and dropping unknown allocations', () => {
    const normalized = normalizeTripPlanningUpdate({
      budgetPlan: {
        currency: '  usd  ',
        totalPlanned: 1200,
        allocations: { food: 300, other: 50, gadgets: 999 },
        notes: '  split across cards  ',
      } as unknown as TripBudgetPlan,
    });
    expect(normalized).toEqual({
      budgetPlan: {
        currency: 'usd',
        totalPlanned: 1200,
        allocations: { food: 300, other: 50 },
        notes: 'split across cards',
      },
    });
  });

  it('accepts a null clear and an explicitly empty budget plan', () => {
    expect(normalizeTripPlanningUpdate({ budgetPlan: null })).toEqual({ budgetPlan: null });
    expect(normalizeTripPlanningUpdate({ budgetPlan: {} })).toEqual({ budgetPlan: {} });
  });

  it('rejects malformed, negative, or non-numeric budget plans', () => {
    expect(normalizeTripPlanningUpdate({ budgetPlan: { currency: 'US$' } })).toBeNull();
    expect(normalizeTripPlanningUpdate({ budgetPlan: { totalPlanned: -5 } })).toBeNull();
    expect(normalizeTripPlanningUpdate({ budgetPlan: { totalPlanned: '1200' } })).toBeNull();
    expect(normalizeTripPlanningUpdate({ budgetPlan: { allocations: 'lots' } })).toBeNull();
    expect(normalizeTripPlanningUpdate({ budgetPlan: { allocations: { food: -1 } } })).toBeNull();
    expect(normalizeTripPlanningUpdate({ budgetPlan: 'nope' })).toBeNull();
  });

  it('applies the budget plan, clears via null, and collapses an empty object', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ budgetPlan: { currency: 'USD', totalPlanned: 900 } }),
    });
    expect(
      applyTripPlanningUpdate(workspace, { budgetPlan: null }).itinerary?.budgetPlan
    ).toBeUndefined();
    expect(
      applyTripPlanningUpdate(workspace, { budgetPlan: {} }).itinerary?.budgetPlan
    ).toBeUndefined();
    expect(
      applyTripPlanningUpdate(workspace, { budgetPlan: { currency: 'EUR', totalPlanned: 100 } })
        .itinerary?.budgetPlan
    ).toEqual({ currency: 'EUR', totalPlanned: 100 });
    expect(workspace.itinerary?.budgetPlan).toEqual({ currency: 'USD', totalPlanned: 900 });
  });

  it('is a no-op for the budget plan on a workspace without an itinerary', () => {
    const next = applyTripPlanningUpdate(makeWorkspace(), { budgetPlan: { totalPlanned: 1 } });
    expect(next.itinerary).toBeUndefined();
  });

  it('reports a clear problem for malformed budget plans and null for valid ones', () => {
    expect(getPlanningUpdateProblem({ budgetPlan: { totalPlanned: -5 } })).toMatch(
      /non-negative numbers/
    );
    expect(getPlanningUpdateProblem({ budgetPlan: { currency: 'US$' } })).toMatch(/currency/);
    expect(getPlanningUpdateProblem({ budgetPlan: null })).toBeNull();
    expect(getPlanningUpdateProblem({ budgetPlan: { currency: 'USD' } })).toBeNull();
    expect(
      getPlanningUpdateProblem({
        transportPlans: [transportPlanWith()],
        accommodationPlans: [accommodationPlanWith()],
      })
    ).toBeNull();
  });

  it('updateTripBudgetPlan sets and clears the plan with validation', () => {
    const workspace = workspaceWithItinerary();
    const plan = { currency: 'USD', totalPlanned: 500 };
    expect(updateTripBudgetPlan(workspace, plan).itinerary?.budgetPlan).toEqual(plan);
    expect(updateTripBudgetPlan(workspace, null).itinerary?.budgetPlan).toBeUndefined();
    expect(() => updateTripBudgetPlan(workspace, { totalPlanned: -1 })).toThrow(TypeError);
  });
});

describe('STEP 16 dirty-checking', () => {
  it('is not dirty when the STEP 16 sections match the persisted snapshot', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith()],
        accommodationPlans: [],
        budgetPlan: { currency: 'USD', totalPlanned: 1200 },
      }),
    });
    expect(isPlanningUpdateDirty(workspace, { transportPlans: [transportPlanWith()] })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { accommodationPlans: [] })).toBe(false);
    expect(
      isPlanningUpdateDirty(workspace, { budgetPlan: { currency: 'USD', totalPlanned: 1200 } })
    ).toBe(false);
  });

  it('is dirty when a STEP 16 section differs', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith()],
        accommodationPlans: [accommodationPlanWith()],
        budgetPlan: { currency: 'USD', totalPlanned: 1200 },
      }),
    });
    expect(isPlanningUpdateDirty(workspace, { transportPlans: [] })).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, {
        accommodationPlans: [accommodationPlanWith({ id: 'acp-2' })],
      })
    ).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, { budgetPlan: { currency: 'USD', totalPlanned: 1300 } })
    ).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { budgetPlan: null })).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { budgetPlan: {} })).toBe(true);
  });

  it('treats empty STEP 16 sections against a legacy workspace as unchanged', () => {
    const workspace = makeWorkspace();
    expect(isPlanningUpdateDirty(workspace, { transportPlans: [] })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { accommodationPlans: [] })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { budgetPlan: null })).toBe(false);
  });
});

describe('STEP 16 section helpers', () => {
  it('replace STEP 16 sections without aliasing persisted state', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith()],
        budgetPlan: { currency: 'USD', totalPlanned: 900 },
      }),
    });
    const next = applyTripPlanningUpdate(workspace, {
      transportPlans: [transportPlanWith({ id: 'trp-2', mode: 'Train' })],
      budgetPlan: { currency: 'EUR', totalPlanned: 100 },
    });
    (next.itinerary as TripItinerarySnapshot).transportPlans![0].mode = 'Mutated';
    expect(workspace.itinerary?.transportPlans?.[0].mode).toBe('Flight');
    expect(workspace.itinerary?.budgetPlan).toEqual({ currency: 'USD', totalPlanned: 900 });
  });

  it('updateTripBudgetPlan applies a typed plan and rejects malformed input', () => {
    const workspace = workspaceWithItinerary();
    const plan: TripBudgetPlan = { allocations: { accommodation: 400 } };
    expect(updateTripBudgetPlan(workspace, plan).itinerary?.budgetPlan).toEqual(plan);
    expect(() =>
      updateTripBudgetPlan(workspace, { notes: 3 } as unknown as TripBudgetPlan)
    ).toThrow(TypeError);
  });
});

describe('STEP 17 execution-readiness in plan updates', () => {
  it('carries valid readiness through normalization and trims its note', () => {
    const normalized = normalizeTripPlanningUpdate({
      transportPlans: [
        {
          id: 'trp-1',
          readiness: { state: 'user-confirmed', note: '  ABC-123  ' },
        },
      ],
      accommodationPlans: [
        {
          id: 'acp-1',
          readiness: { state: 'planned', note: '   ' },
        },
      ],
    });
    expect(normalized).toEqual({
      transportPlans: [{ id: 'trp-1', readiness: { state: 'user-confirmed', note: 'ABC-123' } }],
      accommodationPlans: [{ id: 'acp-1', readiness: { state: 'planned' } }],
    });
  });

  it('rejects the whole update on malformed readiness, including booking-claim states', () => {
    expect(
      normalizeTripPlanningUpdate({ transportPlans: [{ id: 'a', readiness: { state: 'booked' } }] })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        accommodationPlans: [{ id: 'a', readiness: { state: 'planned', note: 42 } }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', readiness: 'confirmed-by-airline' }],
      })
    ).toBeNull();
  });

  it('applies and deep-clones readiness when editing plan sections', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      transportPlans: [
        transportPlanWith({ readiness: { state: 'cancelled', note: 'changed my mind' } }),
      ],
      accommodationPlans: [
        accommodationPlanWith({ readiness: { state: 'user-confirmed', note: 'K-77' } }),
      ],
    });
    expect(next.itinerary?.transportPlans?.[0].readiness).toEqual({
      state: 'cancelled',
      note: 'changed my mind',
    });
    expect(next.itinerary?.accommodationPlans?.[0].readiness).toEqual({
      state: 'user-confirmed',
      note: 'K-77',
    });

    (next.itinerary as TripItinerarySnapshot).transportPlans![0].readiness!.note = 'Mutated';
    expect(workspace.itinerary?.transportPlans).toBeUndefined();
  });

  it('cloneSnapshot deep-copies readiness so successors cannot alias it', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith({ readiness: { state: 'planned' } })],
        accommodationPlans: [],
      }),
    });
    const updated = applyTripPlanningUpdate(workspace, {});
    (updated.itinerary as TripItinerarySnapshot).transportPlans![0].readiness!.state = 'cancelled';
    expect(workspace.itinerary?.transportPlans?.[0].readiness).toEqual({ state: 'planned' });
  });

  it('dirty-checking treats readiness differences and equality correctly', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith({ readiness: { state: 'planned' } })],
      }),
    });
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ readiness: { state: 'planned' } })],
      })
    ).toBe(false);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ readiness: { state: 'user-confirmed' } })],
      })
    ).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith()],
      })
    ).toBe(true);
  });

  it('updateTripTransportPlans / updateTripAccommodationPlans accept readiness', () => {
    const workspace = workspaceWithItinerary();
    const plans = [transportPlanWith({ readiness: { state: 'user-confirmed' } })];
    expect(updateTripTransportPlans(workspace, plans).itinerary?.transportPlans).toEqual(plans);
    const stays = [accommodationPlanWith({ readiness: { state: 'cancelled' } })];
    expect(updateTripAccommodationPlans(workspace, stays).itinerary?.accommodationPlans).toEqual(
      stays
    );
  });
});

describe('STEP 23 provenance in plan updates', () => {
  it('normalizes and carries provenance, trimming its note', () => {
    const normalized = normalizeTripPlanningUpdate({
      transportPlans: [
        {
          id: 'trp-1',
          provenance: { kind: 'mock-discovery', note: '  sample import  ' },
        },
      ],
      accommodationPlans: [
        {
          id: 'acp-1',
          provenance: { kind: 'manual', note: '   ' },
        },
      ],
    });
    expect(normalized).toEqual({
      transportPlans: [
        { id: 'trp-1', provenance: { kind: 'mock-discovery', note: 'sample import' } },
      ],
      accommodationPlans: [{ id: 'acp-1', provenance: { kind: 'manual' } }],
    });
  });

  it('rejects the whole update on malformed or booking-claiming provenance', () => {
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', provenance: { kind: 'live-listing' } }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        accommodationPlans: [{ id: 'a', provenance: { kind: 'booked' } }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', provenance: 'manual' }],
      })
    ).toBeNull();
  });

  it('applies and deep-copies provenance so successors cannot alias it', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      transportPlans: [
        transportPlanWith({
          provenance: { kind: 'mock-discovery', note: 'from panel' },
        }),
      ],
      accommodationPlans: [accommodationPlanWith({ provenance: { kind: 'manual' } })],
    });
    expect(next.itinerary?.transportPlans?.[0].provenance).toEqual({
      kind: 'mock-discovery',
      note: 'from panel',
    });
    expect(next.itinerary?.accommodationPlans?.[0].provenance).toEqual({
      kind: 'manual',
    });

    (next.itinerary as TripItinerarySnapshot).transportPlans![0].provenance!.note = 'Mutated';
    expect(workspace.itinerary?.transportPlans).toBeUndefined();
  });

  it('cloneSnapshot deep-copies provenance so successors cannot alias it', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [
          transportPlanWith({
            provenance: { kind: 'mock-discovery', note: 'original note' },
          }),
        ],
        accommodationPlans: [],
      }),
    });
    const updated = applyTripPlanningUpdate(workspace, {});
    (updated.itinerary as TripItinerarySnapshot).transportPlans![0].provenance!.note = 'Mutated';
    expect(workspace.itinerary?.transportPlans?.[0].provenance).toEqual({
      kind: 'mock-discovery',
      note: 'original note',
    });
  });

  it('dirty-checking treats provenance differences and equality correctly', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith({ provenance: { kind: 'mock-discovery' } })],
      }),
    });
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ provenance: { kind: 'mock-discovery' } })],
      })
    ).toBe(false);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ provenance: { kind: 'manual' } })],
      })
    ).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith()],
      })
    ).toBe(true);
  });

  it('updateTripTransportPlans / updateTripAccommodationPlans accept provenance', () => {
    const workspace = workspaceWithItinerary();
    const plans = [transportPlanWith({ provenance: { kind: 'manual' } })];
    const stays = [accommodationPlanWith({ provenance: { kind: 'mock-discovery' } })];
    expect(updateTripTransportPlans(workspace, plans).itinerary?.transportPlans).toEqual(plans);
    expect(updateTripAccommodationPlans(workspace, stays).itinerary?.accommodationPlans).toEqual(
      stays
    );
  });
});

describe('STEP 24 lifecycle in plan updates', () => {
  it('normalizes and carries a lifecycle state on both plan types', () => {
    const normalized = normalizeTripPlanningUpdate({
      transportPlans: [{ id: 'trp-1', lifecycleState: 'needs-review' }],
      accommodationPlans: [{ id: 'acp-1', lifecycleState: 'archived' }],
    });
    expect(normalized).toEqual({
      transportPlans: [{ id: 'trp-1', lifecycleState: 'needs-review' }],
      accommodationPlans: [{ id: 'acp-1', lifecycleState: 'archived' }],
    });
  });

  it('rejects the whole update on malformed or staleness-claiming lifecycle', () => {
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', lifecycleState: 'expired' }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        accommodationPlans: [{ id: 'a', lifecycleState: 'verified' }],
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningUpdate({
        transportPlans: [{ id: 'a', lifecycleState: { state: 'active' } }],
      })
    ).toBeNull();
  });

  it('keeps lifecycle, provenance, and readiness independent within a plan update', () => {
    const normalized = normalizeTripPlanningUpdate({
      transportPlans: [
        {
          id: 'trp-1',
          provenance: { kind: 'manual' },
          lifecycleState: 'replaced',
          readiness: { state: 'planned' },
        },
      ],
    });
    expect(normalized).toEqual({
      transportPlans: [
        {
          id: 'trp-1',
          provenance: { kind: 'manual' },
          lifecycleState: 'replaced',
          readiness: { state: 'planned' },
        },
      ],
    });
  });

  it('applies lifecycle without aliasing: mutating a successor plan never mutates the source', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      transportPlans: [transportPlanWith({ lifecycleState: 'archived' })],
      accommodationPlans: [accommodationPlanWith({ lifecycleState: 'needs-review' })],
    });
    expect(next.itinerary?.transportPlans?.[0].lifecycleState).toBe('archived');
    expect(next.itinerary?.accommodationPlans?.[0].lifecycleState).toBe('needs-review');

    (next.itinerary as TripItinerarySnapshot).transportPlans![0].lifecycleState = 'active';
    expect(workspace.itinerary?.transportPlans).toBeUndefined();
  });

  it('cloneSnapshot isolates lifecycle and deep-copies provenance so successors cannot alias them', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [
          transportPlanWith({
            provenance: { kind: 'mock-discovery', note: 'original note' },
            lifecycleState: 'replaced',
          }),
        ],
        accommodationPlans: [],
      }),
    });
    const updated = applyTripPlanningUpdate(workspace, {});
    const successorPlan = (updated.itinerary as TripItinerarySnapshot).transportPlans![0];
    expect(successorPlan.lifecycleState).toBe('replaced');

    successorPlan.lifecycleState = 'active';
    successorPlan.provenance!.note = 'Mutated';
    expect(workspace.itinerary?.transportPlans?.[0].lifecycleState).toBe('replaced');
    expect(workspace.itinerary?.transportPlans?.[0].provenance).toEqual({
      kind: 'mock-discovery',
      note: 'original note',
    });
  });

  it('dirty-checking treats lifecycle differences and equality correctly', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith({ lifecycleState: 'active' })],
      }),
    });
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ lifecycleState: 'active' })],
      })
    ).toBe(false);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith({ lifecycleState: 'needs-review' })],
      })
    ).toBe(true);
    expect(
      isPlanningUpdateDirty(workspace, {
        transportPlans: [transportPlanWith()],
      })
    ).toBe(true);
  });

  it('updateTripTransportPlans / updateTripAccommodationPlans accept lifecycle', () => {
    const workspace = workspaceWithItinerary();
    const plans = [transportPlanWith({ lifecycleState: 'needs-review' })];
    const stays = [accommodationPlanWith({ lifecycleState: 'archived' })];
    expect(updateTripTransportPlans(workspace, plans).itinerary?.transportPlans).toEqual(plans);
    expect(updateTripAccommodationPlans(workspace, stays).itinerary?.accommodationPlans).toEqual(
      stays
    );
  });
});

describe('STEP 18 checklist task updates', () => {
  function taskWith(overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
    return {
      id: 'tsk-1',
      category: 'general',
      title: 'Book airport transfer',
      status: 'pending',
      ...overrides,
    };
  }

  it('normalizes checklist tasks by trimming strings and dropping present-only keys', () => {
    const normalized = normalizeTripPlanningUpdate({
      tasks: [
        {
          id: '  tsk-1  ',
          category: 'document-preparation',
          title: '  Apply for e-visa  ',
          description: '  Check validity  ',
          status: 'in_progress',
          dueDate: ' 2026-09-20 ',
          note: '   ',
          relatedSection: 'itinerary',
          relatedPlanId: '  trp-7  ',
        },
      ],
    });
    expect(normalized).toEqual({
      tasks: [
        {
          id: 'tsk-1',
          category: 'document-preparation',
          title: 'Apply for e-visa',
          description: 'Check validity',
          status: 'in_progress',
          dueDate: '2026-09-20',
          relatedSection: 'itinerary',
          relatedPlanId: 'trp-7',
        },
      ],
    });
  });

  it('rejects the whole update on malformed tasks or duplicate ids', () => {
    expect(
      normalizeTripPlanningUpdate({ tasks: [{ ...taskWith(), status: 'booked' }] })
    ).toBeNull();
    expect(normalizeTripPlanningUpdate({ tasks: [{ ...taskWith(), id: '' }] })).toBeNull();
    expect(
      normalizeTripPlanningUpdate({ tasks: [taskWith(), taskWith({ id: 'tsk-1' })] })
    ).toBeNull();
    expect(normalizeTripPlanningUpdate({ tasks: 'nope' })).toBeNull();
  });

  it('accepts clearing tasks with null or an empty array', () => {
    expect(normalizeTripPlanningUpdate({ tasks: null })).toEqual({ tasks: null });
    expect(normalizeTripPlanningUpdate({ tasks: [] })).toEqual({ tasks: [] });
  });

  it('applies and deep-clones checklist tasks without aliasing persisted state', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ tasks: [taskWith()] }),
    });
    const next = applyTripPlanningUpdate(workspace, {
      tasks: [taskWith({ id: 'tsk-2', title: 'Buy snorkel gear' })],
    });
    expect(next.itinerary?.tasks).toEqual([taskWith({ id: 'tsk-2', title: 'Buy snorkel gear' })]);
    expect(workspace.itinerary?.tasks).toEqual([taskWith()]);

    (next.itinerary as TripItinerarySnapshot).tasks![0].title = 'Mutated';
    expect(workspace.itinerary?.tasks?.[0].title).toBe('Book airport transfer');
  });

  it('clears tasks via null and is a no-op without an itinerary', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ tasks: [taskWith()] }),
    });
    expect(applyTripPlanningUpdate(workspace, { tasks: null }).itinerary?.tasks).toBeUndefined();
    expect(applyTripPlanningUpdate(workspace, { tasks: [] }).itinerary?.tasks).toBeUndefined();
    expect(
      applyTripPlanningUpdate(makeWorkspace(), { tasks: [taskWith()] }).itinerary
    ).toBeUndefined();
  });

  it('reports clear problems for malformed tasks and null for valid ones', () => {
    expect(getPlanningUpdateProblem({ tasks: [{ ...taskWith(), title: '' }] })).toMatch(
      /category, a title, and a valid due date/
    );
    expect(getPlanningUpdateProblem({ tasks: [taskWith(), taskWith()] })).toMatch(
      /ids must be unique/
    );
    expect(getPlanningUpdateProblem({ tasks: null })).toBeNull();
    expect(
      getPlanningUpdateProblem({
        tasks: [taskWith(), taskWith({ id: 'tsk-2', category: 'budget-preparation' })],
      })
    ).toBeNull();
  });

  it('dirty-checks checklist task differences and equality', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ tasks: [taskWith()] }),
    });
    expect(isPlanningUpdateDirty(workspace, { tasks: [taskWith({ id: 'tsk-1' })] })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { tasks: [taskWith({ status: 'completed' })] })).toBe(
      true
    );
    expect(isPlanningUpdateDirty(workspace, { tasks: [] })).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { tasks: null })).toBe(true);
    expect(isPlanningUpdateDirty(makeWorkspace(), { tasks: [] })).toBe(false);
    expect(isPlanningUpdateDirty(makeWorkspace(), { tasks: null })).toBe(false);
  });

  it('updateTripTasks sets and clears tasks with validation', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({ tasks: [] }),
    });
    const tasks = [taskWith(), taskWith({ id: 'tsk-2', category: 'document-preparation' })];
    expect(updateTripTasks(workspace, tasks).itinerary?.tasks).toEqual(tasks);
    expect(updateTripTasks(workspace, null).itinerary?.tasks).toBeUndefined();
    expect(() => updateTripTasks(workspace, [taskWith(), taskWith({ id: 'tsk-1' })])).toThrow(
      TypeError
    );
    expect(updateTripTasks(makeWorkspace(), tasks).itinerary).toBeUndefined();
  });
});

describe('STEP 26 primary selection in planning updates', () => {
  it('normalizes a valid primary transport plan id', () => {
    expect(normalizeTripPlanningUpdate({ primaryTransportPlanId: 'trp-1' })).toEqual({
      primaryTransportPlanId: 'trp-1',
    });
  });

  it('normalizes and trims a primary accommodation plan id', () => {
    expect(normalizeTripPlanningUpdate({ primaryAccommodationPlanId: '  acp-1  ' })).toEqual({
      primaryAccommodationPlanId: 'acp-1',
    });
  });

  it('accepts null to explicitly clear a selection', () => {
    expect(normalizeTripPlanningUpdate({ primaryTransportPlanId: null })).toEqual({
      primaryTransportPlanId: null,
    });
    expect(normalizeTripPlanningUpdate({ primaryAccommodationPlanId: null })).toEqual({
      primaryAccommodationPlanId: null,
    });
  });

  it('rejects malformed primary ids (non-string, empty, whitespace-only)', () => {
    expect(normalizeTripPlanningUpdate({ primaryTransportPlanId: 42 })).toBeNull();
    expect(normalizeTripPlanningUpdate({ primaryTransportPlanId: '' })).toBeNull();
    expect(normalizeTripPlanningUpdate({ primaryTransportPlanId: '   ' })).toBeNull();
    expect(normalizeTripPlanningUpdate({ primaryAccommodationPlanId: true })).toBeNull();
    expect(normalizeTripPlanningUpdate({ primaryAccommodationPlanId: {} })).toBeNull();
  });

  it('applies and clears primary ids when an itinerary exists', () => {
    const workspace = workspaceWithItinerary();
    const withTransport = applyTripPlanningUpdate(workspace, {
      primaryTransportPlanId: 'trp-1',
    });
    expect(withTransport.itinerary?.primaryTransportPlanId).toBe('trp-1');

    const cleared = applyTripPlanningUpdate(withTransport, {
      primaryTransportPlanId: null,
    });
    expect(cleared.itinerary?.primaryTransportPlanId).toBeUndefined();
    expect(withTransport.itinerary?.primaryTransportPlanId).toBe('trp-1');
  });

  it('applies and clears accommodation primary ids', () => {
    const workspace = workspaceWithItinerary();
    const withAccom = applyTripPlanningUpdate(workspace, {
      primaryAccommodationPlanId: 'acp-1',
    });
    expect(withAccom.itinerary?.primaryAccommodationPlanId).toBe('acp-1');

    const cleared = applyTripPlanningUpdate(withAccom, {
      primaryAccommodationPlanId: null,
    });
    expect(cleared.itinerary?.primaryAccommodationPlanId).toBeUndefined();
  });

  it('is a no-op for primary ids without an itinerary', () => {
    const result = applyTripPlanningUpdate(makeWorkspace(), {
      primaryTransportPlanId: 'trp-1',
      primaryAccommodationPlanId: 'acp-1',
    });
    expect(result.itinerary).toBeUndefined();
  });

  it('does not alias the source snapshot when setting a primary id', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      primaryAccommodationPlanId: 'acp-1',
    });
    expect(next.itinerary?.primaryAccommodationPlanId).toBe('acp-1');
    expect(workspace.itinerary?.primaryAccommodationPlanId).toBeUndefined();
  });

  it('dirty-checks primary selection differences correctly', () => {
    const workspace = workspaceWithItinerary();
    // both absent → null for comparison: unchanged
    expect(isPlanningUpdateDirty(workspace, { primaryTransportPlanId: null })).toBe(false);
    expect(isPlanningUpdateDirty(workspace, { primaryAccommodationPlanId: null })).toBe(false);

    // set a new value: dirty
    expect(isPlanningUpdateDirty(workspace, { primaryTransportPlanId: 'trp-1' })).toBe(true);
    expect(isPlanningUpdateDirty(workspace, { primaryAccommodationPlanId: 'acp-1' })).toBe(true);

    // matching persisted value: not dirty
    const withId = makeWorkspace({
      itinerary: makeSnapshot({
        primaryTransportPlanId: 'trp-1',
        primaryAccommodationPlanId: 'acp-1',
      }),
    });
    expect(isPlanningUpdateDirty(withId, { primaryTransportPlanId: 'trp-1' })).toBe(false);
    expect(isPlanningUpdateDirty(withId, { primaryAccommodationPlanId: 'acp-1' })).toBe(false);

    // clearing a set value: dirty
    expect(isPlanningUpdateDirty(withId, { primaryTransportPlanId: null })).toBe(true);
    expect(isPlanningUpdateDirty(withId, { primaryAccommodationPlanId: null })).toBe(true);

    // changing to a different value: dirty
    expect(isPlanningUpdateDirty(withId, { primaryTransportPlanId: 'trp-2' })).toBe(true);
  });

  it('reports null problem for valid selections and clear', () => {
    expect(getPlanningUpdateProblem({ primaryTransportPlanId: 'trp-1' })).toBeNull();
    expect(getPlanningUpdateProblem({ primaryTransportPlanId: null })).toBeNull();
    expect(getPlanningUpdateProblem({ primaryAccommodationPlanId: 'acp-1' })).toBeNull();
    expect(getPlanningUpdateProblem({ primaryAccommodationPlanId: null })).toBeNull();
  });

  it('reports clear problem messages for malformed primary ids', () => {
    expect(getPlanningUpdateProblem({ primaryTransportPlanId: '' })).toMatch(
      /primary transport reference/
    );
    expect(getPlanningUpdateProblem({ primaryTransportPlanId: 42 as never })).toMatch(
      /primary transport reference/
    );
    expect(getPlanningUpdateProblem({ primaryAccommodationPlanId: true as never })).toMatch(
      /primary accommodation reference/
    );
    expect(getPlanningUpdateProblem({ primaryAccommodationPlanId: '   ' })).toMatch(
      /primary accommodation reference/
    );
  });

  it('allows primary selection alongside other sections without conflict', () => {
    const workspace = workspaceWithItinerary();
    const next = applyTripPlanningUpdate(workspace, {
      notes: ['Remember sunscreen'],
      primaryTransportPlanId: 'trp-1',
      accommodationPlans: [accommodationPlanWith()],
    });
    expect(next.itinerary?.notes).toEqual(['Remember sunscreen']);
    expect(next.itinerary?.primaryTransportPlanId).toBe('trp-1');
    expect(next.itinerary?.accommodationPlans).toEqual([accommodationPlanWith()]);
  });
});

describe('STEP 27 primary reference lifecycle integrity in planning updates', () => {
  it('a lifecycle-only transport plan edit leaves the persisted primary id untouched', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith()],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const next = updateTripTransportPlans(workspace, [
      transportPlanWith({ lifecycleState: 'archived' }),
    ]);
    expect(next.itinerary?.primaryTransportPlanId).toBe('trp-1');
  });

  it('a lifecycle-only accommodation plan edit leaves the persisted primary id untouched', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        accommodationPlans: [accommodationPlanWith()],
        primaryAccommodationPlanId: 'acp-1',
      }),
    });
    const next = updateTripAccommodationPlans(workspace, [
      accommodationPlanWith({ lifecycleState: 'replaced' }),
    ]);
    expect(next.itinerary?.primaryAccommodationPlanId).toBe('acp-1');
  });

  it('marking the selected primary plan inactive never clears or auto-reassigns the stored id', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith(), transportPlanWith({ id: 'trp-2' })],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const next = updateTripTransportPlans(workspace, [
      transportPlanWith({ lifecycleState: 'archived' }),
      transportPlanWith({ id: 'trp-2' }),
    ]);
    expect(next.itinerary?.primaryTransportPlanId).toBe('trp-1');
    expect(next.itinerary?.primaryTransportPlanId).not.toBe('trp-2');
    expect(next.itinerary?.transportPlans?.[0]?.lifecycleState).toBe('archived');
  });

  it('restoring a stored selection later keeps the id and writes only the lifecycle', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith({ lifecycleState: 'archived' })],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const next = updateTripTransportPlans(workspace, [
      transportPlanWith({ lifecycleState: 'active' }),
    ]);
    expect(next.itinerary?.transportPlans?.[0]?.lifecycleState).toBe('active');
    expect(next.itinerary?.primaryTransportPlanId).toBe('trp-1');
  });

  it('a non-plan section edit beside a primary selection keeps the id and lifecycle intact', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        transportPlans: [transportPlanWith()],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const next = applyTripPlanningUpdate(workspace, {
      notes: ['Remember sunscreen'],
      primaryTransportPlanId: 'trp-1',
    });
    expect(next.itinerary?.primaryTransportPlanId).toBe('trp-1');
    expect(next.itinerary?.notes).toEqual(['Remember sunscreen']);
    expect(next.itinerary?.transportPlans?.[0]?.lifecycleState).toBeUndefined();
  });
});
