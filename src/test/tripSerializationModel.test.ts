import { describe, expect, it } from 'vitest';
import {
  isTripItinerarySnapshot,
  normalizeTripItinerarySnapshot,
} from '../services/tripSerializationModel';
import type { TripItinerarySnapshot } from '../types/trip';

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
    ...overrides,
  };
}

describe('isTripItinerarySnapshot', () => {
  it('returns true for a well-formed snapshot', () => {
    expect(isTripItinerarySnapshot(makeSnapshot())).toBe(true);
  });

  it('returns false for null, primitives, and missing required fields', () => {
    expect(isTripItinerarySnapshot(null)).toBe(false);
    expect(isTripItinerarySnapshot('nope')).toBe(false);
    expect(isTripItinerarySnapshot({})).toBe(false);
    expect(isTripItinerarySnapshot({ destination: 'Bali' })).toBe(false);
  });
});

describe('normalizeTripItinerarySnapshot', () => {
  it('returns a sanitized snapshot with only declared keys', () => {
    const raw = {
      ...makeSnapshot(),
      id: 'itin-1',
      createdAt: '2026-01-10T09:00:00.000Z',
      saved: true,
      extraField: 'should be stripped',
    };
    const normalized = normalizeTripItinerarySnapshot(raw);
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('id');
    expect(normalized).not.toHaveProperty('createdAt');
    expect(normalized).not.toHaveProperty('saved');
    expect(normalized).not.toHaveProperty('extraField');
    expect(normalized!.destination).toBe('Bali');
    expect(normalized!.summary).toBe('A balanced island escape.');
  });

  it('returns null for non-object inputs', () => {
    expect(normalizeTripItinerarySnapshot(undefined)).toBeNull();
    expect(normalizeTripItinerarySnapshot(42)).toBeNull();
    expect(normalizeTripItinerarySnapshot([])).toBeNull();
  });

  it('rejects missing or empty destination', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), destination: '' })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), destination: '   ' })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), destination: 123 })).toBeNull();
  });

  it('rejects missing summary', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), summary: 123 })).toBeNull();
  });

  it('rejects invalid durationDays (zero, negative, non-integer)', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), durationDays: 0 })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), durationDays: -1 })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), durationDays: 1.5 })).toBeNull();
  });

  it('rejects invalid budgetLevel', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), budgetLevel: 'Ultra' })).toBeNull();
  });

  it('rejects non-array interests', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), interests: 'solo' })).toBeNull();
  });

  it('accepts valid dayPlans including empty arrays and empty activities', () => {
    const withEmptyDay = makeSnapshot({ dayPlans: [] });
    expect(normalizeTripItinerarySnapshot(withEmptyDay)).not.toBeNull();

    const emptyActivities = makeSnapshot({
      dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
    });
    expect(normalizeTripItinerarySnapshot(emptyActivities)).not.toBeNull();
  });

  it('rejects a dayPlan with a non-positive dayNumber', () => {
    const bad = makeSnapshot({
      dayPlans: [{ dayNumber: 0, title: 'Day 0', theme: 'T', activities: [] }],
    });
    expect(normalizeTripItinerarySnapshot(bad)).toBeNull();
  });

  it('rejects an activity with missing required string fields', () => {
    const bad = makeSnapshot({
      dayPlans: [
        {
          dayNumber: 1,
          title: 'Day 1',
          theme: 'T',
          activities: [
            {
              time: '10:00',
              title: '',
              description: '',
              locationName: '',
              category: '',
              estimatedCost: '',
            },
          ],
        },
      ],
    });
    expect(normalizeTripItinerarySnapshot(bad)).not.toBeNull();

    const badType = {
      ...makeSnapshot(),
      dayPlans: [
        {
          dayNumber: 1,
          title: 'Day 1',
          theme: 'T',
          activities: [
            {
              time: 123,
              title: 'Visit',
              description: '',
              locationName: '',
              category: '',
              estimatedCost: '',
            } as unknown as {
              time: string;
              title: string;
              description: string;
              locationName: string;
              category: string;
              estimatedCost: string;
            },
          ],
        },
      ],
    };
    expect(normalizeTripItinerarySnapshot(badType)).toBeNull();
  });

  it('accepts activities with valid coordinates and rejects malformed ones', () => {
    const validCoord = makeSnapshot({
      dayPlans: [
        {
          dayNumber: 1,
          title: 'Day 1',
          theme: 'T',
          activities: [
            {
              time: '10:00',
              title: 'Visit',
              description: '',
              locationName: '',
              category: '',
              estimatedCost: '',
              coordinates: [1.5, 2.5],
            },
          ],
        },
      ],
    });
    expect(normalizeTripItinerarySnapshot(validCoord)).not.toBeNull();

    const badCoord = makeSnapshot({
      dayPlans: [
        {
          dayNumber: 1,
          title: 'Day 1',
          theme: 'T',
          activities: [
            {
              time: '10:00',
              title: 'Visit',
              description: '',
              locationName: '',
              category: '',
              estimatedCost: '',
              coordinates: [1, 'not-a-number'] as unknown as [number, number],
            },
          ],
        } as unknown as {
          dayNumber: number;
          title: string;
          theme: string;
          activities: {
            time: string;
            title: string;
            description: string;
            locationName: string;
            category: string;
            estimatedCost: string;
            coordinates?: [number, number];
          }[];
        },
      ],
    });
    expect(normalizeTripItinerarySnapshot(badCoord)).toBeNull();
  });

  it('rejects transport and hotel items with missing string fields', () => {
    const badTransport = makeSnapshot({
      transport: [{ mode: 'Car', route: '', estimatedCost: '' }],
    });
    expect(normalizeTripItinerarySnapshot(badTransport)).not.toBeNull();

    const badTransportType = makeSnapshot({
      transport: [
        { mode: 123, route: '', estimatedCost: '' } as unknown as {
          mode: string;
          route: string;
          estimatedCost: string;
        },
      ],
    });
    expect(normalizeTripItinerarySnapshot(badTransportType)).toBeNull();

    const badHotel = makeSnapshot({
      hotels: [{ name: 'H', area: '', ratePerNight: '', estimatedCost: '' }],
    });
    expect(normalizeTripItinerarySnapshot(badHotel)).not.toBeNull();

    const badHotelType = makeSnapshot({
      hotels: [
        { name: 123, area: '', ratePerNight: '', estimatedCost: '' } as unknown as {
          name: string;
          area: string;
          ratePerNight: string;
          estimatedCost: string;
        },
      ],
    });
    expect(normalizeTripItinerarySnapshot(badHotelType)).toBeNull();
  });

  it('accepts snapshot with optional fields omitted', () => {
    const minimal = makeSnapshot({
      transport: undefined,
      hotels: undefined,
      sightseeingCost: undefined,
    });
    expect(normalizeTripItinerarySnapshot(minimal)).not.toBeNull();
  });

  it('accepts optional notes and references and preserves them', () => {
    const withPlanning = makeSnapshot({
      notes: ['Book the beach club early.', 'Bring a rain jacket.'],
      references: [
        {
          id: 'act-1',
          kind: 'activity',
          title: 'Sacred Monkey Forest',
          dayNumber: 1,
          provider: 'TourGuide Co',
          estimatedCost: '$20',
        },
      ],
    });
    const normalized = normalizeTripItinerarySnapshot(withPlanning);
    expect(normalized).not.toBeNull();
    expect(normalized?.notes).toEqual(['Book the beach club early.', 'Bring a rain jacket.']);
    expect(normalized?.references).toEqual([
      {
        id: 'act-1',
        kind: 'activity',
        title: 'Sacred Monkey Forest',
        dayNumber: 1,
        provider: 'TourGuide Co',
        estimatedCost: '$20',
      },
    ]);
  });

  it('rejects malformed notes', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), notes: 'nope' })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), notes: [42] })).toBeNull();
  });

  it('rejects malformed references', () => {
    expect(
      normalizeTripItinerarySnapshot({ ...makeSnapshot(), references: [{ id: 'x' }] })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        references: [{ id: '', kind: 'activity', title: 'A' }],
      })
    ).toBeNull();
  });

  it('keeps notes and references while stripping runtime-only keys', () => {
    const raw = {
      ...makeSnapshot({
        notes: ['n1'],
        references: [{ id: 'a', kind: 'activity', title: 'A' }],
      }),
      id: 'itin-1',
      saved: true,
    };
    const normalized = normalizeTripItinerarySnapshot(raw);
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('id');
    expect(normalized).not.toHaveProperty('saved');
    expect(normalized?.notes).toEqual(['n1']);
    expect(normalized?.references).toEqual([{ id: 'a', kind: 'activity', title: 'A' }]);
  });
});

describe('STEP 16 itinerary snapshot sections', () => {
  const transportPlan = { id: 'trp-1', mode: 'Flight', departureTime: '2026-09-11T08:30' };
  const accommodationPlan = {
    id: 'acp-1',
    name: 'Padi Hotel',
    checkInDate: '2026-09-11',
    checkOutDate: '2026-09-15',
  };
  const budgetPlan = { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } };

  it('accepts and returns all three STEP 16 plan sections', () => {
    const normalized = normalizeTripItinerarySnapshot(
      makeSnapshot({
        transportPlans: [transportPlan],
        accommodationPlans: [accommodationPlan],
        budgetPlan,
      })
    );
    expect(normalized).not.toBeNull();
    expect(normalized?.transportPlans).toEqual([transportPlan]);
    expect(normalized?.accommodationPlans).toEqual([accommodationPlan]);
    expect(normalized?.budgetPlan).toEqual(budgetPlan);
  });

  it('accepts their absence on legacy snapshots', () => {
    const normalized = normalizeTripItinerarySnapshot(makeSnapshot());
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('transportPlans');
    expect(normalized).not.toHaveProperty('accommodationPlans');
    expect(normalized).not.toHaveProperty('budgetPlan');
  });

  it('rejects null plan sections', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), transportPlans: null })).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({ ...makeSnapshot(), accommodationPlans: null })
    ).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), budgetPlan: null })).toBeNull();
  });

  it('rejects malformed plan records and duplicate ids', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', departureTime: 'tomorrow' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [transportPlan, transportPlan],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', checkInDate: '2026-09-15', checkOutDate: '2026-09-11' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [accommodationPlan, accommodationPlan],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({ ...makeSnapshot(), budgetPlan: { totalPlanned: -5 } })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({ ...makeSnapshot(), budgetPlan: { currency: 'US$' } })
    ).toBeNull();
  });

  it('accepts STEP 17 readiness metadata inside transport/accommodation plans', () => {
    const withReadiness = {
      transportPlans: [{ id: 'trp-1', mode: 'Flight', readiness: { state: 'planned' } }],
      accommodationPlans: [
        { id: 'acp-1', readiness: { state: 'user-confirmed', note: '  K-77  ' } },
      ],
    };
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      ...withReadiness,
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.transportPlans).toEqual([
      { id: 'trp-1', mode: 'Flight', readiness: { state: 'planned' } },
    ]);
    expect(normalized?.accommodationPlans).toEqual([
      { id: 'acp-1', readiness: { state: 'user-confirmed', note: '  K-77  ' } },
    ]);
  });

  it('rejects snapshots whose plan readiness claims a booking or is malformed', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', readiness: { state: 'booked' } }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', readiness: 'confirmed' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', readiness: { state: 'planned', note: 7 } }],
      })
    ).toBeNull();
  });

  it('round-trips safe sourceUrl fields on transport and accommodation plans (STEP 22)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [{ id: 'trp-1', mode: 'Flight', sourceUrl: 'https://mock.example/result-1' }],
      accommodationPlans: [{ id: 'acp-1', sourceUrl: 'https://mock.example/stay-1' }],
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.transportPlans).toEqual([
      { id: 'trp-1', mode: 'Flight', sourceUrl: 'https://mock.example/result-1' },
    ]);
    expect(normalized?.accommodationPlans).toEqual([
      { id: 'acp-1', sourceUrl: 'https://mock.example/stay-1' },
    ]);
  });

  it('rejects snapshots carrying an unsafe sourceUrl (STEP 22)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', sourceUrl: 'javascript:alert(1)' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', sourceUrl: 'not-a-url' }],
      })
    ).toBeNull();
  });

  it('round-trips provenance metadata on plan records (STEP 23)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [
        {
          id: 'trp-1',
          mode: 'Flight',
          provenance: { kind: 'mock-discovery', note: 'imported sample' },
        },
      ],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', provenance: { kind: 'manual' } }],
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.transportPlans).toEqual([
      {
        id: 'trp-1',
        mode: 'Flight',
        provenance: { kind: 'mock-discovery', note: 'imported sample' },
      },
    ]);
    expect(normalized?.accommodationPlans).toEqual([
      { id: 'acp-1', name: 'Padi Hotel', provenance: { kind: 'manual' } },
    ]);
  });

  it('rejects snapshots carrying malformed provenance (STEP 23)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', provenance: { kind: 'live-listing' } }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', provenance: 'booked' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', provenance: { kind: 'manual', note: 9 } }],
      })
    ).toBeNull();
  });

  it('keeps legacy plans without provenance valid through the snapshot guard (STEP 23)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
      })
    ).not.toBeNull();
  });

  it('round-trips lifecycle state on plan records (STEP 24)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'needs-review' }],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'archived' }],
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.transportPlans).toEqual([
      { id: 'trp-1', mode: 'Flight', lifecycleState: 'needs-review' },
    ]);
    expect(normalized?.accommodationPlans).toEqual([
      { id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'archived' },
    ]);
  });

  it('rejects snapshots carrying malformed lifecycle state (STEP 24)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'a', lifecycleState: 'expired' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        accommodationPlans: [{ id: 'a', lifecycleState: 'verified' }],
      })
    ).toBeNull();
  });

  it('keeps legacy plans without lifecycle valid through the snapshot guard (STEP 24)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
      })
    ).not.toBeNull();
  });
});

describe('STEP 18 checklist tasks in itinerary snapshots', () => {
  const validTask = {
    id: 'tsk-1',
    category: 'general',
    title: 'Book airport transfer',
    status: 'pending',
  };

  it('accepts and strictly validates checklist tasks on a snapshot', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      tasks: [
        validTask,
        { ...validTask, id: 'tsk-2', category: 'document-preparation', dueDate: '2026-09-20' },
      ],
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.tasks).toEqual([
      validTask,
      { ...validTask, id: 'tsk-2', category: 'document-preparation', dueDate: '2026-09-20' },
    ]);
  });

  it('accepts snapshot tasks with a runtime-only key stripped at the boundary', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      tasks: [{ ...validTask, runtimeKey: 'drop me' }],
    });
    expect(normalized?.tasks).toEqual([validTask]);
    expect(normalized?.tasks?.[0]).not.toHaveProperty('runtimeKey');
  });

  it('accepts their absence on legacy snapshots', () => {
    const normalized = normalizeTripItinerarySnapshot(makeSnapshot());
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('tasks');
  });

  it('rejects null, malformed, or duplicate-id task sets wholesale', () => {
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), tasks: null })).toBeNull();
    expect(normalizeTripItinerarySnapshot({ ...makeSnapshot(), tasks: 'nope' })).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        tasks: [{ ...validTask, status: 'booked' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        tasks: [{ ...validTask, title: '' }],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        tasks: [validTask, validTask],
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        tasks: [{ ...validTask, dueDate: 'soon' }],
      })
    ).toBeNull();
  });

  it('round-trips valid primary ids on the snapshot (STEP 26)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      primaryTransportPlanId: 'trp-1',
      primaryAccommodationPlanId: 'acp-1',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
    expect(normalized?.primaryAccommodationPlanId).toBe('acp-1');
  });

  it('rejects a non-string primary id (STEP 26)', () => {
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        primaryTransportPlanId: 123,
      })
    ).toBeNull();
    expect(
      normalizeTripItinerarySnapshot({
        ...makeSnapshot(),
        primaryAccommodationPlanId: true,
      })
    ).toBeNull();
  });

  it('accepts snapshots without primary ids (STEP 26 legacy)', () => {
    const normalized = normalizeTripItinerarySnapshot(makeSnapshot());
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('primaryTransportPlanId');
    expect(normalized).not.toHaveProperty('primaryAccommodationPlanId');
  });
});

describe('STEP 27 primary reference integrity in itinerary serialization', () => {
  it('preserves a primary id that references no plan in the snapshot (missing selection)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [{ id: 'trp-2', mode: 'Flight' }],
      primaryTransportPlanId: 'trp-1',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
  });

  it('preserves a primary id that references an inactive plan (no silent clear, no drop)', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
      primaryTransportPlanId: 'trp-1',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
    expect(normalized?.transportPlans?.[0]?.lifecycleState).toBe('archived');
  });

  it('preserves a valid primary id verbatim alongside its active plan', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      primaryTransportPlanId: 'trp-1',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
  });

  it('never re-assigns a stored primary id to a different plan on save', () => {
    const normalized = normalizeTripItinerarySnapshot({
      ...makeSnapshot(),
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'replaced' },
        { id: 'trp-2', mode: 'Train' },
      ],
      primaryTransportPlanId: 'trp-1',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.primaryTransportPlanId).toBe('trp-1');
    expect(normalized?.primaryTransportPlanId).not.toBe('trp-2');
  });
});
