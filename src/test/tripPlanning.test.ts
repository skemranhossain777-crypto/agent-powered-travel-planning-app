import { describe, expect, it } from 'vitest';
import {
  buildTripPlanningData,
  getTripDayDate,
  isSafeHttpUrl,
  isTripAccommodationPlan,
  isTripBudgetPlan,
  isTripPlanningData,
  isTripPlanningReference,
  isTripTransportPlan,
  normalizeTripAccommodationPlan,
  normalizeTripPlanningData,
  normalizeTripTransportPlan,
} from '../domain/trips/tripPlanning';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { TripItinerarySnapshot, TripPlanningData, TripWorkspace } from '../types/trip';

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

function makePlanningData(overrides: Partial<TripPlanningData> = {}): TripPlanningData {
  return {
    dates: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    days: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
    transportation: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
    accommodation: [
      { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
    ],
    transportPlans: [],
    accommodationPlans: [],
    budget: { level: 'Moderate', estimatedTotalCost: '$1,200', sightseeingCost: '$40' },
    notes: ['Book the beach club early.'],
    references: [
      {
        id: 'act-1',
        kind: 'activity',
        title: 'Sacred Monkey Forest',
        dayNumber: 1,
        provider: 'TourGuide Co',
        providerId: 'tg-101',
        estimatedCost: '$20',
      },
    ],
    ...overrides,
  };
}

describe('buildTripPlanningData', () => {
  it('projects the canonical workspace fields into the structured model', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      itinerary: makeSnapshot({
        dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
        transport: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
        hotels: [
          { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
        ],
        sightseeingCost: '$40',
        notes: ['  Book the beach club early.  ', '   '],
        references: [
          {
            id: 'act-1',
            kind: 'activity',
            title: 'Sacred Monkey Forest',
            dayNumber: 1,
            estimatedCost: '$20',
          },
        ],
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provider: 'Nusa Air',
            departureLocation: 'Denpasar',
            arrivalLocation: 'Ubud',
            departureTime: '2026-09-11T08:30',
            referenceNumber: 'NK-881',
          },
        ],
        accommodationPlans: [
          {
            id: 'acp-1',
            name: 'Padi Hotel',
            location: 'Campuhan',
            checkInDate: '2026-09-11',
            checkOutDate: '2026-09-15',
          },
        ],
        budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
      }),
    });

    expect(buildTripPlanningData(workspace)).toEqual({
      dates: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      days: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
      transportation: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
      accommodation: [
        { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
      ],
      transportPlans: [
        {
          id: 'trp-1',
          mode: 'Flight',
          provider: 'Nusa Air',
          departureLocation: 'Denpasar',
          arrivalLocation: 'Ubud',
          departureTime: '2026-09-11T08:30',
          referenceNumber: 'NK-881',
        },
      ],
      accommodationPlans: [
        {
          id: 'acp-1',
          name: 'Padi Hotel',
          location: 'Campuhan',
          checkInDate: '2026-09-11',
          checkOutDate: '2026-09-15',
        },
      ],
      budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
      budget: { level: 'Moderate', estimatedTotalCost: '$1,200', sightseeingCost: '$40' },
      notes: ['Book the beach club early.'],
      references: [
        {
          id: 'act-1',
          kind: 'activity',
          title: 'Sacred Monkey Forest',
          dayNumber: 1,
          estimatedCost: '$20',
        },
      ],
    });
  });

  it('maps a legacy workspace without an itinerary to empty sections', () => {
    const planning = buildTripPlanningData(makeWorkspace());

    expect(planning).toEqual({
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      days: [],
      transportation: [],
      accommodation: [],
      transportPlans: [],
      accommodationPlans: [],
      notes: [],
      references: [],
    });
    expect(planning.dates).toBeUndefined();
    expect(planning.budget).toBeUndefined();
  });

  it('omits dates when the date range is invalid', () => {
    const planning = buildTripPlanningData(
      makeWorkspace({ dateRange: { startDate: '2026-09-15', endDate: '2026-09-11' } })
    );
    expect(planning.dates).toBeUndefined();
  });

  it('trims notes and drops empty entries', () => {
    const planning = buildTripPlanningData(
      makeWorkspace({
        itinerary: makeSnapshot({ notes: ['  First  ', '', '   ', 'Second'] }),
      })
    );
    expect(planning.notes).toEqual(['First', 'Second']);
  });

  it('copies nested arrays instead of aliasing persisted state', () => {
    const workspace = makeWorkspace({ itinerary: makeSnapshot() });
    const planning = buildTripPlanningData(workspace);
    planning.days.push({
      dayNumber: 99,
      title: 'Ghost',
      theme: 'No',
      activities: [],
    } as never);
    planning.references.push({ id: 'x', kind: 'activity', title: 'Y' } as never);
    expect(workspace.itinerary?.dayPlans).toHaveLength(0);
    expect(workspace.itinerary?.references).toBeUndefined();
  });
});

describe('isTripPlanningData', () => {
  it('returns true for a well-formed planning payload', () => {
    expect(isTripPlanningData(makePlanningData())).toBe(true);
  });

  it('returns false for null, primitives, and missing required arrays', () => {
    expect(isTripPlanningData(null)).toBe(false);
    expect(isTripPlanningData('nope')).toBe(false);
    expect(isTripPlanningData(42)).toBe(false);
    expect(isTripPlanningData([])).toBe(false);
    expect(isTripPlanningData({})).toBe(false);
    expect(
      isTripPlanningData({
        destinations: [],
        transportation: [],
        accommodation: [],
        notes: [],
        references: [],
      })
    ).toBe(false);
  });
});

describe('normalizeTripPlanningData', () => {
  it('returns a well-formed payload unchanged', () => {
    const payload = makePlanningData();
    expect(normalizeTripPlanningData(payload)).toEqual(payload);
  });

  it('returns null for non-object inputs', () => {
    expect(normalizeTripPlanningData(undefined)).toBeNull();
    expect(normalizeTripPlanningData(null)).toBeNull();
    expect(normalizeTripPlanningData(42)).toBeNull();
    expect(normalizeTripPlanningData([])).toBeNull();
  });

  it('rejects payloads missing required arrays', () => {
    const base = makePlanningData();
    for (const key of [
      'destinations',
      'days',
      'transportation',
      'accommodation',
      'transportPlans',
      'accommodationPlans',
      'notes',
      'references',
    ] as const) {
      const { [key]: _removed, ...without } = base;
      void _removed;
      expect(normalizeTripPlanningData(without)).toBeNull();
    }
    expect(normalizeTripPlanningData({ ...base, notes: 'nope' })).toBeNull();
    expect(normalizeTripPlanningData({ ...base, days: 'nope' })).toBeNull();
    expect(normalizeTripPlanningData({ ...base, transportPlans: 'nope' })).toBeNull();
    expect(normalizeTripPlanningData({ ...base, accommodationPlans: 'nope' })).toBeNull();
  });

  it('drops malformed list items and keeps valid ones', () => {
    const payload = makePlanningData({
      destinations: [
        { id: '', name: 'Broken' },
        { id: 'd2', name: 'Canggu', country: 'Indonesia' },
      ],
      days: [
        { dayNumber: 0, title: 'Bad', theme: 'X', activities: [] },
        { dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] },
      ],
      transportation: [
        { mode: 123, route: '', estimatedCost: '' },
        { mode: 'Bicycle', route: 'Ubud → Canggu', estimatedCost: 'Free' },
      ],
      accommodation: [{ name: 123, area: '', ratePerNight: '', estimatedCost: '' }],
      notes: ['Keep', 42, 'Drop'],
      references: [{}, 'nope'],
    } as unknown as TripPlanningData);

    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized?.destinations).toEqual([{ id: 'd2', name: 'Canggu', country: 'Indonesia' }]);
    expect(normalized?.days).toEqual([
      { dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] },
    ]);
    expect(normalized?.transportation).toEqual([
      { mode: 'Bicycle', route: 'Ubud → Canggu', estimatedCost: 'Free' },
    ]);
    expect(normalized?.accommodation).toEqual([]);
    expect(normalized?.notes).toEqual(['Keep', 'Drop']);
    expect(normalized?.references).toEqual([]);
  });

  it('drops malformed activities within a valid day and keeps the day', () => {
    const payload = makePlanningData({
      days: [
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
    } as unknown as TripPlanningData);

    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized?.days).toHaveLength(1);
    expect(normalized?.days?.[0].activities).toHaveLength(1);
    expect(normalized?.days?.[0].activities[0].title).toBe('Land in Denpasar');
  });

  it('rejects a malformed budget (unknown level or wrong-typed costs)', () => {
    expect(
      normalizeTripPlanningData(
        makePlanningData({ budget: { level: 'Ultra' } } as unknown as TripPlanningData)
      )
    ).toBeNull();
    expect(
      normalizeTripPlanningData(
        makePlanningData({
          budget: { level: 'Moderate', estimatedTotalCost: 42 },
        } as unknown as TripPlanningData)
      )
    ).toBeNull();
    expect(
      normalizeTripPlanningData(
        makePlanningData({ budget: 'cheap' } as unknown as TripPlanningData)
      )
    ).toBeNull();
  });

  it('accepts a budget-less payload and omits budget', () => {
    const payload = makePlanningData({ budget: undefined });
    const normalized = normalizeTripPlanningData({ ...payload });
    expect(normalized).not.toBeNull();
    expect(normalized?.budget).toBeUndefined();
  });

  it('rejects a malformed date range', () => {
    expect(
      normalizeTripPlanningData(
        makePlanningData({
          dates: { startDate: '2026-09-15', endDate: '2026-09-11' },
        })
      )
    ).toBeNull();
    expect(
      normalizeTripPlanningData(
        makePlanningData({ dates: 'whenever' } as unknown as TripPlanningData)
      )
    ).toBeNull();
  });

  it('filters out-of-range day numbers only when dates are present', () => {
    const withDates = makePlanningData({
      days: [
        { dayNumber: 1, title: 'One', theme: 'A', activities: [] },
        { dayNumber: 6, title: 'Six', theme: 'A', activities: [] },
        { dayNumber: 2, title: 'Two', theme: 'A', activities: [] },
      ],
    }) as unknown as TripPlanningData;
    const normalized = normalizeTripPlanningData(withDates);
    expect(normalized?.days.map((day) => day.dayNumber)).toEqual([1, 2]);

    const withoutDates = makePlanningData({
      dates: undefined,
      days: [
        { dayNumber: 1, title: 'One', theme: 'A', activities: [] },
        { dayNumber: 6, title: 'Six', theme: 'A', activities: [] },
      ],
    });
    expect(normalizeTripPlanningData(withoutDates)?.days.map((day) => day.dayNumber)).toEqual([
      1, 6,
    ]);
  });

  it('drops invalid references and keeps valid ones', () => {
    const payload = makePlanningData({
      references: [
        { id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 },
        { id: '', kind: 'activity', title: 'Broken' },
        { id: 'ac-2', kind: 'accommodation', title: 'Padi Hotel', provider: 'Booking' },
        { id: 'tr-3', kind: 'transport', title: 'Airport transfer', mode: 'Car' },
        { id: 'bad', kind: 'hotel', title: 'Wrong kind' },
        { id: 'act-4', kind: 'activity', title: 'Fine', dayNumber: 0 },
      ],
    } as unknown as TripPlanningData);

    const normalized = normalizeTripPlanningData(payload);
    expect(normalized?.references).toEqual([
      { id: 'act-1', kind: 'activity', title: 'Sacred Monkey Forest', dayNumber: 1 },
      { id: 'ac-2', kind: 'accommodation', title: 'Padi Hotel', provider: 'Booking' },
      { id: 'tr-3', kind: 'transport', title: 'Airport transfer', mode: 'Car' },
    ]);
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts http and https urls with a host', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('https://example.com/things?q=1#top')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http schemes, junk, and whitespace-laden urls', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html;base64,abc')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com')).toBe(false);
    expect(isSafeHttpUrl('https://example.com/evil space')).toBe(false);
    expect(isSafeHttpUrl('https://example.com/evil\u0000inject')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
  });

  it('caps url length', () => {
    expect(isSafeHttpUrl(`https://example.com/${'a'.repeat(1981)}`)).toBe(false);
    expect(isSafeHttpUrl(`https://example.com/${'a'.repeat(1980)}`)).toBe(true);
  });
});

describe('isTripPlanningReference', () => {
  it('accepts valid activity, transport, and accommodation references', () => {
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A' })).toBe(true);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        url: 'https://example.com/activity',
      })
    ).toBe(true);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        dayNumber: 3,
        provider: 'B',
      })
    ).toBe(true);
    expect(
      isTripPlanningReference({
        id: 't',
        kind: 'transport',
        title: 'T',
        mode: 'Car',
        dayNumber: 2,
        provider: 'P',
        providerId: '1',
      })
    ).toBe(true);
    expect(
      isTripPlanningReference({
        id: 'h',
        kind: 'accommodation',
        title: 'H',
        checkInDate: '2026-09-11',
        checkOutDate: '2026-09-16',
        estimatedCost: '$300',
      })
    ).toBe(true);
    expect(
      isTripPlanningReference({
        id: 'p',
        kind: 'activity',
        title: 'Place',
        provider: 'Google Places',
        providerId: 'pl-1',
        location: { latitude: 52.36, longitude: 4.885 },
        address: 'Museumstraat 1',
        category: 'museum',
        url: 'https://maps.google.com/?cid=1',
      })
    ).toBe(true);
  });

  it('rejects malformed references and unsafe urls', () => {
    expect(isTripPlanningReference(null)).toBe(false);
    expect(isTripPlanningReference('nope')).toBe(false);
    expect(isTripPlanningReference({})).toBe(false);
    expect(isTripPlanningReference({ id: '', kind: 'activity', title: 'A' })).toBe(false);
    expect(isTripPlanningReference({ id: 'a', kind: 'fire', title: 'A' })).toBe(false);
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 42 })).toBe(false);
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', dayNumber: 0 })).toBe(
      false
    );
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', providerId: 5 })).toBe(
      false
    );
    expect(
      isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', url: 'javascript:alert(1)' })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        url: '  https://example.com',
      })
    ).toBe(false);
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', url: 42 })).toBe(false);
    expect(
      isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', location: 'Amsterdam' })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        location: { latitude: '52', longitude: 4.885 },
      })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        location: { latitude: 95, longitude: 4.885 },
      })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        location: { latitude: 52.36, longitude: -200 },
      })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        location: { latitude: 52.36 },
      })
    ).toBe(false);
    expect(
      isTripPlanningReference({
        id: 'a',
        kind: 'activity',
        title: 'A',
        location: { latitude: Infinity, longitude: 4.885 },
      })
    ).toBe(false);
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', address: 5 })).toBe(
      false
    );
    expect(isTripPlanningReference({ id: 'a', kind: 'activity', title: 'A', category: false })).toBe(
      false
    );
  });
});

describe('getTripDayDate', () => {
  it('returns the start date for day 1 and ISO dates for later days', () => {
    const dateRange = { startDate: '2026-09-11', endDate: '2026-09-15' };
    expect(getTripDayDate(dateRange, 1)).toBe('2026-09-11');
    expect(getTripDayDate(dateRange, 5)).toBe('2026-09-15');
  });

  it('returns undefined for out-of-range days and missing/invalid ranges', () => {
    const dateRange = { startDate: '2026-09-11', endDate: '2026-09-15' };
    expect(getTripDayDate(dateRange, 0)).toBeUndefined();
    expect(getTripDayDate(dateRange, 6)).toBeUndefined();
    expect(getTripDayDate(dateRange, 1.5)).toBeUndefined();
    expect(getTripDayDate(undefined, 1)).toBeUndefined();
    expect(getTripDayDate({ startDate: '2026-09-15', endDate: '2026-09-11' }, 1)).toBeUndefined();
  });
});

describe('STEP 16 plan guards', () => {
  it('isTripTransportPlan accepts full records and drops empty optional strings', () => {
    expect(
      isTripTransportPlan({
        id: 'trp-1',
        mode: '  Flight  ',
        provider: '   ',
        departureTime: '2026-09-11T08:30',
        arrivalTime: '2026-09-11T12:00',
      })
    ).toBe(true);
    expect(isTripTransportPlan({ id: 'trp-1' })).toBe(true);
    expect(isTripTransportPlan({ id: '' })).toBe(false);
    expect(isTripTransportPlan({ id: 'a', departureTime: 'tomorrow' })).toBe(false);
    expect(isTripTransportPlan({ id: 'a', mode: 3 })).toBe(false);
    expect(isTripTransportPlan('nope')).toBe(false);
  });

  it('isTripAccommodationPlan validates ids and dates', () => {
    expect(
      isTripAccommodationPlan({
        id: 'acp-1',
        checkInDate: '2026-09-11',
        checkOutDate: '2026-09-15',
      })
    ).toBe(true);
    expect(isTripAccommodationPlan({ id: 'a', checkInDate: 'x' })).toBe(false);
    expect(isTripAccommodationPlan({ id: 'a' })).toBe(true);
    expect(isTripAccommodationPlan({ id: '', name: 'X' })).toBe(false);
    expect(
      isTripAccommodationPlan({ id: 'a', checkInDate: '2026-09-15', checkOutDate: '2026-09-11' })
    ).toBe(false);
  });

  it('isTripBudgetPlan validates currency, amounts, and allocation shapes', () => {
    expect(
      isTripBudgetPlan({
        currency: 'USD',
        totalPlanned: 1200,
        allocations: { transport: 0, other: 5.5 },
      })
    ).toBe(true);
    expect(isTripBudgetPlan({})).toBe(true);
    expect(isTripBudgetPlan({ currency: 'US$' })).toBe(false);
    expect(isTripBudgetPlan({ totalPlanned: -1 })).toBe(false);
    expect(isTripBudgetPlan({ totalPlanned: 1.2 })).toBe(true);
    expect(isTripBudgetPlan({ allocations: { food: 'lots' } })).toBe(false);
    expect(isTripBudgetPlan({ allocations: { food: 5, gadgets: 9 } })).toBe(true);
    expect(isTripBudgetPlan('nope')).toBe(false);
  });
});

describe('STEP 17 execution-readiness on plan guards', () => {
  it('accepts valid readiness metadata on transport and accommodation plans', () => {
    expect(isTripTransportPlan({ id: 'trp-1', readiness: { state: 'planned' } })).toBe(true);
    expect(
      isTripTransportPlan({
        id: 'trp-1',
        readiness: { state: 'user-confirmed', note: '  Ref saved from confirmation email  ' },
      })
    ).toBe(true);
    expect(
      isTripAccommodationPlan({
        id: 'acp-1',
        readiness: { state: 'cancelled', note: 'change of plans' },
      })
    ).toBe(true);
  });

  it('rejects plans whose readiness state is unknown or malformed', () => {
    expect(isTripTransportPlan({ id: 'trp-1', readiness: { state: 'booked' } })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', readiness: { state: 'planned', note: 7 } })).toBe(
      false
    );
    expect(isTripTransportPlan({ id: 'trp-1', readiness: 'planned' })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', readiness: null })).toBe(true);
    expect(
      isTripAccommodationPlan({ id: 'acp-1', readiness: { state: 'confirmed-by-airline' } })
    ).toBe(false);
    expect(isTripAccommodationPlan({ id: 'acp-1', readiness: 42 })).toBe(false);
  });

  it('treats absent readiness as valid and never fabricates a value', () => {
    expect(isTripTransportPlan({ id: 'trp-1' })).toBe(true);
    expect(isTripAccommodationPlan({ id: 'acp-1' })).toBe(true);
  });
});

describe('STEP 22 source URL on plan guards', () => {
  it('accepts safe http/https source URLs on transport and accommodation plans', () => {
    expect(isTripTransportPlan({ id: 'trp-1', sourceUrl: 'https://mock.example/result-1' })).toBe(
      true
    );
    expect(
      isTripAccommodationPlan({ id: 'acp-1', sourceUrl: 'http://mock.example/result-1' })
    ).toBe(true);
    expect(
      isTripTransportPlan({ id: 'trp-1', sourceUrl: '  https://mock.example/result-1  ' })
    ).toBe(true);
  });

  it('rejects plans whose source URL is unsafe or malformed', () => {
    expect(isTripTransportPlan({ id: 'trp-1', sourceUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isTripAccommodationPlan({ id: 'acp-1', sourceUrl: 'not-a-url' })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', sourceUrl: 42 })).toBe(false);
  });

  it('drops whitespace-only source URLs like other optional strings', () => {
    expect(isTripTransportPlan({ id: 'trp-1', sourceUrl: '   ' })).toBe(true);
    expect(isTripAccommodationPlan({ id: 'acp-1', sourceUrl: '   ' })).toBe(true);
  });
});

describe('STEP 23 provenance on plan guards', () => {
  it('accepts every recognized provenance kind on transport and accommodation plans', () => {
    for (const kind of ['manual', 'ai-generated', 'mock-discovery', 'external-provider']) {
      expect(isTripTransportPlan({ id: 'trp-1', provenance: { kind } })).toBe(true);
      expect(isTripAccommodationPlan({ id: 'acp-1', provenance: { kind } })).toBe(true);
    }
  });

  it('accepts a bounded provenance note and trims or drops it on normalization', () => {
    const normalized = normalizeTripTransportPlan({
      id: 'trp-1',
      provenance: { kind: 'manual', note: '  From the owner  ' },
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.provenance).toEqual({ kind: 'manual', note: 'From the owner' });

    const withoutNote = normalizeTripTransportPlan({
      id: 'trp-1',
      provenance: { kind: 'mock-discovery', note: '   ' },
    });
    expect(withoutNote).not.toBeNull();
    expect(withoutNote?.provenance).toEqual({ kind: 'mock-discovery' });
  });

  it('rejects plans whose provenance kind is unknown or malformed', () => {
    expect(isTripTransportPlan({ id: 'trp-1', provenance: { kind: 'live-listing' } })).toBe(false);
    expect(isTripAccommodationPlan({ id: 'acp-1', provenance: { kind: 'booked' } })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', provenance: { kind: 7 } })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', provenance: 'manual' })).toBe(false);
    expect(isTripAccommodationPlan({ id: 'acp-1', provenance: { kind: 'manual', note: 9 } })).toBe(
      false
    );
    expect(
      isTripTransportPlan({
        id: 'trp-1',
        provenance: { kind: 'manual', note: 'x'.repeat(501) },
      })
    ).toBe(false);
  });

  it('treats absent or explicit-null provenance as valid and never fabricates it', () => {
    expect(isTripTransportPlan({ id: 'trp-1' })).toBe(true);
    expect(isTripAccommodationPlan({ id: 'acp-1' })).toBe(true);
    expect(isTripTransportPlan({ id: 'trp-1', provenance: null })).toBe(true);
    const normalized = normalizeTripAccommodationPlan({ id: 'acp-1', provenance: null });
    expect(normalized).not.toBeNull();
    expect(normalized?.provenance).toBeUndefined();
  });

  it('strips runtime-only keys and contradicts pessimistic provenance never persists', () => {
    const normalized = normalizeTripTransportPlan({
      id: 'trp-1',
      provenance: { kind: 'mock-discovery', note: 'sample', runtimeFlag: true },
    });
    expect(normalized?.provenance).toEqual({ kind: 'mock-discovery', note: 'sample' });
  });
});

describe('STEP 24 lifecycle on plan guards', () => {
  it('accepts every recognized lifecycle state on transport and accommodation plans', () => {
    for (const lifecycleState of ['active', 'needs-review', 'replaced', 'archived']) {
      expect(isTripTransportPlan({ id: 'trp-1', lifecycleState })).toBe(true);
      expect(isTripAccommodationPlan({ id: 'acp-1', lifecycleState })).toBe(true);
    }
  });

  it('carries a valid lifecycle state through normalization on both plan types', () => {
    expect(normalizeTripTransportPlan({ id: 'trp-1', lifecycleState: 'needs-review' })).toEqual({
      id: 'trp-1',
      lifecycleState: 'needs-review',
    });
    expect(normalizeTripAccommodationPlan({ id: 'acp-1', lifecycleState: 'archived' })).toEqual({
      id: 'acp-1',
      lifecycleState: 'archived',
    });
  });

  it('rejects plans whose lifecycle state is unknown or malformed', () => {
    expect(isTripTransportPlan({ id: 'trp-1', lifecycleState: 'expired' })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', lifecycleState: 'outdated' })).toBe(false);
    expect(isTripAccommodationPlan({ id: 'acp-1', lifecycleState: 'verified' })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', lifecycleState: 7 })).toBe(false);
    expect(isTripTransportPlan({ id: 'trp-1', lifecycleState: { state: 'active' } })).toBe(false);
    expect(normalizeTripTransportPlan({ id: 'trp-1', lifecycleState: 'live' })).toBeNull();
    expect(normalizeTripAccommodationPlan({ id: 'acp-1', lifecycleState: 'stale' })).toBeNull();
  });

  it('treats absent or explicit-null lifecycle as valid and never fabricates it', () => {
    expect(isTripTransportPlan({ id: 'trp-1' })).toBe(true);
    expect(isTripAccommodationPlan({ id: 'acp-1' })).toBe(true);
    expect(isTripTransportPlan({ id: 'trp-1', lifecycleState: null })).toBe(true);
    const normalized = normalizeTripAccommodationPlan({ id: 'acp-1', lifecycleState: null });
    expect(normalized).not.toBeNull();
    expect(normalized?.lifecycleState).toBeUndefined();
  });

  it('keeps lifecycle, provenance, and readiness structurally independent', () => {
    const normalized = normalizeTripTransportPlan({
      id: 'trp-1',
      provenance: { kind: 'mock-discovery' },
      lifecycleState: 'archived',
      readiness: { state: 'planned' },
    });
    expect(normalized).toEqual({
      id: 'trp-1',
      provenance: { kind: 'mock-discovery' },
      lifecycleState: 'archived',
      readiness: { state: 'planned' },
    });
  });
});

describe('STEP 26 primary selection in planning data', () => {
  it('buildTripPlanningData projects primary ids from the itinerary snapshot', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        primaryTransportPlanId: 'trp-1',
        primaryAccommodationPlanId: 'acp-1',
      }),
    });
    const data = buildTripPlanningData(workspace);
    expect(data.primaryTransportPlanId).toBe('trp-1');
    expect(data.primaryAccommodationPlanId).toBe('acp-1');
  });

  it('buildTripPlanningData omits primary ids when absent from the snapshot', () => {
    const workspace = makeWorkspace({ itinerary: makeSnapshot() });
    const data = buildTripPlanningData(workspace);
    expect(data).not.toHaveProperty('primaryTransportPlanId');
    expect(data).not.toHaveProperty('primaryAccommodationPlanId');
  });

  it('normalizeTripPlanningData accepts a well-formed payload with primary ids', () => {
    const payload = makePlanningData({
      primaryTransportPlanId: 'trp-1',
      primaryAccommodationPlanId: 'acp-1',
    });
    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
    expect(normalized?.primaryAccommodationPlanId).toBe('acp-1');
  });

  it('normalizeTripPlanningData treats null primary ids as absent', () => {
    const payload = makePlanningData({
      primaryTransportPlanId: null,
      primaryAccommodationPlanId: null,
    } as unknown as TripPlanningData);
    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('primaryTransportPlanId');
    expect(normalized).not.toHaveProperty('primaryAccommodationPlanId');
  });

  it('normalizeTripPlanningData rejects malformed primary ids (non-string)', () => {
    expect(
      normalizeTripPlanningData(
        makePlanningData({ primaryTransportPlanId: 42 } as unknown as TripPlanningData)
      )
    ).toBeNull();
    expect(
      normalizeTripPlanningData(
        makePlanningData({ primaryAccommodationPlanId: true } as unknown as TripPlanningData)
      )
    ).toBeNull();
  });

  it('normalizeTripPlanningData rejects empty or whitespace-only primary ids', () => {
    expect(
      normalizeTripPlanningData(
        makePlanningData({ primaryTransportPlanId: '' } as unknown as TripPlanningData)
      )
    ).toBeNull();
    expect(
      normalizeTripPlanningData(
        makePlanningData({ primaryAccommodationPlanId: '   ' } as unknown as TripPlanningData)
      )
    ).toBeNull();
  });

  it('normalizeTripPlanningData accepts legacy payloads without primary ids', () => {
    const payload = makePlanningData();
    delete (payload as unknown as Record<string, unknown>).primaryTransportPlanId;
    delete (payload as unknown as Record<string, unknown>).primaryAccommodationPlanId;
    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('primaryTransportPlanId');
  });
});

describe('STEP 27 primary reference lifecycle integrity in planning data', () => {
  it('buildTripPlanningData projects a missing primary id verbatim (no repair)', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-2', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const data = buildTripPlanningData(workspace);
    expect(data.primaryTransportPlanId).toBe('trp-1');
  });

  it('buildTripPlanningData projects an inactive primary id verbatim alongside the inactive plan', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const data = buildTripPlanningData(workspace);
    expect(data.primaryTransportPlanId).toBe('trp-1');
    expect(data.transportPlans[0].lifecycleState).toBe('archived');
  });

  it('buildTripPlanningData never promotes an alternate plan to primary', () => {
    const workspace = makeWorkspace({
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'replaced' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const data = buildTripPlanningData(workspace);
    expect(data.primaryTransportPlanId).toBe('trp-1');
    expect(data.primaryTransportPlanId).not.toBe('trp-2');
  });

  it('normalizeTripPlanningData preserves lifecycle and primary integrity without reassignment', () => {
    const payload = makePlanningData({
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'needs-review' },
        { id: 'trp-2', mode: 'Train' },
      ],
      primaryTransportPlanId: 'trp-1',
    });
    const normalized = normalizeTripPlanningData(payload);
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
    expect(normalized?.transportPlans?.[0]?.lifecycleState).toBe('needs-review');
  });
});
