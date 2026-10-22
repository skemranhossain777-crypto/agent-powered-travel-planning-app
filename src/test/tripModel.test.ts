import { describe, expect, it } from 'vitest';
import {
  canDeleteTrip,
  canEditTrip,
  canTransitionTripStatus,
  canViewTrip,
  createDraftTrip,
  getAllowedTripStatusTransitions,
  getTripDurationDays,
  isEditableTripStatus,
  isTripDateRangeValid,
  itineraryToTripWorkspace,
  normalizeTripTitle,
} from '../domain/trips/tripModel';
import type { TripDateRange, TripDestination, TripStatus } from '../types/trip';
import type { Itinerary } from '../types/travel';

function makeItinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    id: 'itin-1',
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
    createdAt: '2026-01-10T09:00:00.000Z',
    ...overrides,
  };
}

describe('isTripDateRangeValid', () => {
  it('accepts a valid multi-day range', () => {
    expect(isTripDateRangeValid({ startDate: '2026-09-11', endDate: '2026-09-13' })).toBe(true);
  });

  it('accepts a same-day range', () => {
    expect(isTripDateRangeValid({ startDate: '2026-09-11', endDate: '2026-09-11' })).toBe(true);
  });

  it('rejects a reversed range', () => {
    expect(isTripDateRangeValid({ startDate: '2026-09-13', endDate: '2026-09-11' })).toBe(false);
  });

  it('rejects malformed date strings', () => {
    expect(isTripDateRangeValid({ startDate: '09/11/2026', endDate: '2026-09-13' })).toBe(false);
    expect(isTripDateRangeValid({ startDate: '2026-99-99', endDate: '2026-09-13' })).toBe(false);
    expect(isTripDateRangeValid({ startDate: '', endDate: '2026-09-13' })).toBe(false);
  });
});

describe('getTripDurationDays', () => {
  it('counts a multi-day range inclusively', () => {
    expect(getTripDurationDays({ startDate: '2026-09-11', endDate: '2026-09-13' })).toBe(3);
  });

  it('counts a same-day range as one day', () => {
    expect(getTripDurationDays({ startDate: '2026-09-11', endDate: '2026-09-11' })).toBe(1);
  });

  it('returns 0 for an invalid or reversed range', () => {
    expect(getTripDurationDays({ startDate: '2026-09-13', endDate: '2026-09-11' })).toBe(0);
    expect(getTripDurationDays({ startDate: 'not-a-date', endDate: '2026-09-11' })).toBe(0);
  });
});

describe('createDraftTrip', () => {
  const now = '2026-09-11T12:00:00.000Z';

  it('creates a draft, private, owner-only workspace with deterministic timestamps', () => {
    const trip = createDraftTrip({ ownerId: 'user-1', title: 'Island Escape', now });

    expect(trip).toMatchObject({
      id: `trip-${now}`,
      ownerId: 'user-1',
      title: 'Island Escape',
      status: 'draft',
      visibility: 'private',
      memberCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(trip.dateRange).toBeUndefined();
    expect(trip.destinations).toEqual([]);
  });

  it('accepts explicit id, destinations, and a valid date range', () => {
    const destinations: TripDestination[] = [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }];
    const dateRange: TripDateRange = { startDate: '2026-09-11', endDate: '2026-09-15' };

    const trip = createDraftTrip({
      ownerId: 'user-1',
      title: 'Island Escape',
      id: 'trip-abc',
      destinations,
      dateRange,
      now,
    });

    expect(trip.id).toBe('trip-abc');
    expect(trip.destinations).toEqual(destinations);
    expect(trip.dateRange).toEqual(dateRange);
  });

  it('throws on empty ownerId or title', () => {
    expect(() => createDraftTrip({ ownerId: '  ', title: 'Island Escape', now })).toThrow(
      /non-empty ownerId/
    );
    expect(() => createDraftTrip({ ownerId: 'user-1', title: '  ', now })).toThrow(
      /non-empty title/
    );
  });

  it('throws on an invalid date range', () => {
    expect(() =>
      createDraftTrip({
        ownerId: 'user-1',
        title: 'Island Escape',
        dateRange: { startDate: '2026-09-13', endDate: '2026-09-11' },
        now,
      })
    ).toThrow(/valid dateRange/);
  });
});

describe('permission helpers', () => {
  const workspace = { ownerId: 'owner-1', visibility: 'private' as const };

  it('canViewTrip allows the owner and any known member role', () => {
    expect(canViewTrip(workspace, 'owner-1')).toBe(true);
    expect(canViewTrip(workspace, 'someone', 'editor')).toBe(true);
    expect(canViewTrip(workspace, 'someone', 'viewer')).toBe(true);
  });

  it('canViewTrip denies non-members on a private workspace and allows them on a shared one', () => {
    expect(canViewTrip(workspace, 'someone')).toBe(false);
    expect(canViewTrip({ ownerId: 'owner-1', visibility: 'shared' }, 'someone')).toBe(true);
  });

  it('canEditTrip allows the owner and editors only', () => {
    expect(canEditTrip({ ownerId: 'owner-1' }, 'owner-1')).toBe(true);
    expect(canEditTrip({ ownerId: 'owner-1' }, 'someone', 'editor')).toBe(true);
    expect(canEditTrip({ ownerId: 'owner-1' }, 'someone', 'viewer')).toBe(false);
    expect(canEditTrip({ ownerId: 'owner-1' }, 'someone')).toBe(false);
  });
});

describe('itineraryToTripWorkspace', () => {
  it('maps a generated itinerary to a planning workspace', () => {
    const itinerary = makeItinerary();
    const trip = itineraryToTripWorkspace(itinerary, { ownerId: 'user-1' });

    expect(trip).toMatchObject({
      id: 'trip-itin-1',
      ownerId: 'user-1',
      title: 'Bali',
      status: 'planning',
      visibility: 'private',
      memberCount: 1,
      createdAt: itinerary.createdAt,
      updatedAt: itinerary.createdAt,
    });
    expect(trip.destinations).toEqual([
      { id: 'destination-primary', name: 'Bali', country: 'Indonesia' },
    ]);
  });

  it('honors explicit id and a valid date range, and drops an invalid one', () => {
    const trip = itineraryToTripWorkspace(makeItinerary(), {
      ownerId: 'user-1',
      id: 'trip-custom',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    });
    expect(trip.id).toBe('trip-custom');
    expect(trip.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });

    const invalid = itineraryToTripWorkspace(makeItinerary(), {
      ownerId: 'user-1',
      dateRange: { startDate: '2026-09-15', endDate: '2026-09-11' },
    });
    expect(invalid.dateRange).toBeUndefined();
  });

  it('does not mutate the source itinerary', () => {
    const itinerary = makeItinerary();
    const snapshot = JSON.stringify(itinerary);

    itineraryToTripWorkspace(itinerary, { ownerId: 'user-1' });

    expect(JSON.stringify(itinerary)).toBe(snapshot);
  });

  it('carries an itinerary snapshot with the editable overview and nested plans', () => {
    const itinerary = makeItinerary({
      transport: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
      hotels: [
        { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
      ],
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

    const trip = itineraryToTripWorkspace(itinerary, { ownerId: 'user-1' });

    expect(trip.itinerary).toEqual({
      destination: 'Bali',
      country: 'Indonesia',
      durationDays: 5,
      budgetLevel: 'Moderate',
      travelStyle: 'Solo',
      interests: ['beaches'],
      summary: 'A balanced island escape.',
      estimatedTotalCost: '$1,200',
      bestTimeToVisit: 'April–October',
      transport: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
      hotels: [
        { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
      ],
      dayPlans: itinerary.dayPlans,
    });
  });

  it('strips runtime-only itinerary fields from the snapshot', () => {
    const trip = itineraryToTripWorkspace(makeItinerary(), { ownerId: 'user-1' });
    expect(trip.itinerary).not.toHaveProperty('id');
    expect(trip.itinerary).not.toHaveProperty('createdAt');
    expect(trip.itinerary).not.toHaveProperty('saved');
  });

  it('deep-copies nested snapshot arrays so edits never alias the source itinerary', () => {
    const itinerary = makeItinerary();
    itinerary.dayPlans = [
      {
        dayNumber: 1,
        title: 'Arrival',
        theme: 'Settle in',
        activities: [
          {
            time: '10:00',
            title: 'Land in Denpasar',
            description: 'Arrive.',
            locationName: 'Ngurah Rai Airport',
            category: 'Transport',
            estimatedCost: 'Varies',
          },
        ],
      },
    ];

    const trip = itineraryToTripWorkspace(itinerary, { ownerId: 'user-1' });
    expect(trip.itinerary?.dayPlans).not.toBe(itinerary.dayPlans);
    expect(trip.itinerary?.dayPlans[0].activities).not.toBe(itinerary.dayPlans[0].activities);
    expect(trip.itinerary?.interests).not.toBe(itinerary.interests);

    trip.itinerary!.dayPlans[0].activities[0].title = 'Changed';
    expect(itinerary.dayPlans[0].activities[0].title).toBe('Land in Denpasar');
  });
});

describe('normalizeTripTitle', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeTripTitle('  Island Escape  ')).toBe('Island Escape');
  });

  it('preserves internal whitespace', () => {
    expect(normalizeTripTitle('Bali  Island')).toBe('Bali  Island');
  });

  it('returns the title unchanged when already trimmed', () => {
    expect(normalizeTripTitle('Island Escape')).toBe('Island Escape');
  });

  it('throws a TypeError for an empty or whitespace-only title', () => {
    expect(() => normalizeTripTitle('')).toThrow(/non-empty title/);
    expect(() => normalizeTripTitle('   ')).toThrow(/non-empty title/);
  });
});

describe('lifecycle status policy', () => {
  it('allows forward single-step progressions', () => {
    expect(canTransitionTripStatus('draft', 'planning')).toBe(true);
    expect(canTransitionTripStatus('planning', 'ready')).toBe(true);
    expect(canTransitionTripStatus('ready', 'in_progress')).toBe(true);
    expect(canTransitionTripStatus('in_progress', 'completed')).toBe(true);
  });

  it('allows cancellation from any active planning stage', () => {
    expect(canTransitionTripStatus('draft', 'cancelled')).toBe(true);
    expect(canTransitionTripStatus('planning', 'cancelled')).toBe(true);
    expect(canTransitionTripStatus('ready', 'cancelled')).toBe(true);
    expect(canTransitionTripStatus('in_progress', 'cancelled')).toBe(true);
  });

  it('rejects skipped steps', () => {
    expect(canTransitionTripStatus('draft', 'ready')).toBe(false);
    expect(canTransitionTripStatus('draft', 'completed')).toBe(false);
    expect(canTransitionTripStatus('planning', 'in_progress')).toBe(false);
  });

  it('rejects self-transitions', () => {
    expect(canTransitionTripStatus('draft', 'draft')).toBe(false);
    expect(canTransitionTripStatus('completed', 'completed')).toBe(false);
  });

  it('rejects all transitions from terminal statuses', () => {
    expect(canTransitionTripStatus('completed', 'cancelled')).toBe(false);
    expect(canTransitionTripStatus('cancelled', 'draft')).toBe(false);
    expect(canTransitionTripStatus('cancelled', 'planning')).toBe(false);
  });

  it('getAllowedTripStatusTransitions returns the correct allowed set', () => {
    expect(getAllowedTripStatusTransitions('draft')).toEqual(['planning', 'cancelled']);
    expect(getAllowedTripStatusTransitions('completed')).toEqual([]);
    expect(getAllowedTripStatusTransitions('cancelled')).toEqual([]);
  });

  it('isEditableTripStatus is true only for non-terminal statuses', () => {
    const allStatuses: TripStatus[] = [
      'draft',
      'planning',
      'ready',
      'in_progress',
      'completed',
      'cancelled',
    ];
    const editable: TripStatus[] = ['draft', 'planning', 'ready', 'in_progress'];
    for (const s of allStatuses) {
      expect(isEditableTripStatus(s)).toBe(editable.includes(s));
    }
  });
});

describe('canDeleteTrip', () => {
  it('allows deletion for every status', () => {
    const allStatuses: TripStatus[] = [
      'draft',
      'planning',
      'ready',
      'in_progress',
      'completed',
      'cancelled',
    ];
    for (const s of allStatuses) {
      expect(canDeleteTrip(s)).toBe(true);
    }
  });
});
