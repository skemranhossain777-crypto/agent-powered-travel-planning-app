import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PROPOSAL_UPDATE_KEYS,
  MAX_PLANNING_INSTRUCTION_LENGTH,
  mergePlanningProposalIntoDraft,
  normalizeTripPlanningProposal,
  normalizeTripPlanningRequest,
  summarizeProposalChanges,
} from '../domain/trips/tripPlanningProposal';
import { applyTripPlanningUpdate } from '../domain/trips/tripPlanningEdit';
import { createDraftTrip } from '../domain/trips/tripModel';
import { resolvePrimaryAssignmentStatus } from '../domain/trips/planningReferenceConflict';
import {
  classifyPrimaryResolutionDecision,
  getPrimaryResolutionDecisionLabel,
} from '../domain/trips/planningReferenceResolution';
import type { TripPlanningData, TripPlanningProposal } from '../types/trip';

function currentPlanning(): TripPlanningData {
  return {
    dates: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    days: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
    transportation: [],
    accommodation: [],
    transportPlans: [],
    accommodationPlans: [],
    notes: ['Book early'],
    references: [],
  };
}

function proposal(update: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    explanation: '  Shifts the itinerary one day later.  ',
    warnings: ['Day plans shift with the date range.'],
    assumptions: ['Weather stays mild.'],
    update: {
      dateRange: { startDate: '2026-09-12', endDate: '2026-09-16' },
      ...update,
    },
  };
}

describe('normalizeTripPlanningRequest', () => {
  it('normalizes a valid request without throwing', () => {
    const request = normalizeTripPlanningRequest({
      currentPlanning: currentPlanning(),
      instruction: '  Move the beach day to day 2  ',
      constraints: ['within budget', '  '],
    });
    expect(request).not.toBeNull();
    expect(request?.instruction).toBe('Move the beach day to day 2');
    expect(request?.currentPlanning.destinations).toEqual(currentPlanning().destinations);
    expect(request?.constraints).toEqual(['within budget']);
  });

  it('accepts a request without constraints', () => {
    const request = normalizeTripPlanningRequest({
      currentPlanning: currentPlanning(),
      instruction: 'Add a food tour',
    });
    expect(request?.constraints).toBeUndefined();
  });

  it('drops the constraints key when every entry is empty', () => {
    const request = normalizeTripPlanningRequest({
      currentPlanning: currentPlanning(),
      instruction: 'Add a food tour',
      constraints: ['   ', ''],
    });
    expect(request?.constraints).toBeUndefined();
  });

  it('rejects a non-object request', () => {
    expect(normalizeTripPlanningRequest('nope')).toBeNull();
    expect(normalizeTripPlanningRequest(null)).toBeNull();
  });

  it('rejects an empty or whitespace-only instruction', () => {
    expect(
      normalizeTripPlanningRequest({ currentPlanning: currentPlanning(), instruction: '   ' })
    ).toBeNull();
  });

  it('rejects an instruction over the length bound', () => {
    expect(
      normalizeTripPlanningRequest({
        currentPlanning: currentPlanning(),
        instruction: 'x'.repeat(MAX_PLANNING_INSTRUCTION_LENGTH + 1),
      })
    ).toBeNull();
  });

  it('accepts an instruction at exactly the length bound', () => {
    expect(
      normalizeTripPlanningRequest({
        currentPlanning: currentPlanning(),
        instruction: 'x'.repeat(MAX_PLANNING_INSTRUCTION_LENGTH),
      })
    ).not.toBeNull();
  });

  it('rejects constraints that are not all strings', () => {
    expect(
      normalizeTripPlanningRequest({
        currentPlanning: currentPlanning(),
        instruction: 'Add a food tour',
        constraints: ['budget', 42],
      })
    ).toBeNull();
  });

  it('rejects an invalid currentPlanning payload', () => {
    expect(
      normalizeTripPlanningRequest({ currentPlanning: { destinations: 'nope' }, instruction: 'x' })
    ).toBeNull();
    expect(normalizeTripPlanningRequest({ currentPlanning: {}, instruction: 'x' })).toBeNull();
  });

  it('rejects unknown envelope keys', () => {
    expect(
      normalizeTripPlanningRequest({
        currentPlanning: currentPlanning(),
        instruction: 'x',
        ownerId: 'u1',
      })
    ).toBeNull();
  });
});

describe('normalizeTripPlanningProposal', () => {
  it('normalizes a valid proposal envelope', () => {
    const result = normalizeTripPlanningProposal(proposal());
    expect(result).not.toBeNull();
    expect(result?.explanation).toBe('Shifts the itinerary one day later.');
    expect(result?.warnings).toEqual(['Day plans shift with the date range.']);
    expect(result?.assumptions).toEqual(['Weather stays mild.']);
    expect(result?.update).toEqual({
      dateRange: { startDate: '2026-09-12', endDate: '2026-09-16' },
    });
  });

  it('accepts a proposal without warnings or assumptions', () => {
    const result = normalizeTripPlanningProposal({
      explanation: 'Tighten the notes.',
      update: { notes: ['Pack layers'] },
    });
    expect(result?.warnings).toBeUndefined();
    expect(result?.assumptions).toBeUndefined();
    expect(result?.update.notes).toEqual(['Pack layers']);
  });

  it('supports dateRange null to clear persisted dates', () => {
    const result = normalizeTripPlanningProposal({
      explanation: 'Drop the dates.',
      update: { dateRange: null },
    });
    expect(result?.update.dateRange).toBeNull();
  });

  it('rejects unknown top-level envelope keys (no smuggling)', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {},
        budget: { estimatedTotalCost: '$0' },
      })
    ).toBeNull();
  });

  it('rejects a missing or empty explanation', () => {
    expect(normalizeTripPlanningProposal({ update: {} })).toBeNull();
    expect(normalizeTripPlanningProposal({ explanation: '   ', update: {} })).toBeNull();
  });

  it('rejects non-string warning entries', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        warnings: ['fine', 42],
        update: {},
      })
    ).toBeNull();
  });

  it('drops empty-string warnings and assumptions', () => {
    const result = normalizeTripPlanningProposal({
      explanation: 'x',
      warnings: ['', '  ', 'A warning'],
      assumptions: ['  ', ''],
      update: {},
    });
    expect(result?.warnings).toEqual(['A warning']);
    expect(result?.assumptions).toBeUndefined();
  });

  it('rejects an update with unsupported keys (transport/accommodation/budget)', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { transport: [] },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { accommodation: [] },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { budget: {} },
      })
    ).toBeNull();
  });

  it('keeps STEP 16 user-editable sections out of the AI proposal scope', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { transportPlans: [{ id: 'trp-1', mode: 'Flight' }] },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { accommodationPlans: [{ id: 'acp-1', name: 'Hotel' }] },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { budgetPlan: { totalPlanned: 500 } },
      })
    ).toBeNull();
  });

  it('rejects a malformed date range', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { dateRange: { startDate: '2026-09-20', endDate: '2026-09-10' } },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { dateRange: { startDate: '09-11', endDate: '2026-09-15' } },
      })
    ).toBeNull();
  });

  it('rejects destinations with empty names or duplicate ids', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          destinations: [
            { id: 'd1', name: 'Ubud', country: 'Indonesia' },
            { id: 'd1', name: 'Canggu', country: 'Indonesia' },
          ],
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { destinations: [{ id: 'd1', name: '  ', country: 'Indonesia' }] },
      })
    ).toBeNull();
  });

  it('rejects days with duplicate dayNumbers or malformed activities', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          days: [
            { dayNumber: 1, title: 'A', theme: 'B', activities: [] },
            { dayNumber: 1, title: 'C', theme: 'D', activities: [] },
          ],
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          days: [
            {
              dayNumber: 1,
              title: 'A',
              theme: 'B',
              activities: [{ time: '09:00', title: 'T' }],
            },
          ],
        },
      })
    ).toBeNull();
  });

  it('rejects references with unsafe urls or missing titles', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          references: [{ id: 'r1', kind: 'activity', title: 'T', url: 'javascript:alert(1)' }],
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { references: [{ id: 'r1', kind: 'activity', title: '' }] },
      })
    ).toBeNull();
  });

  it('rejects non-array / malformed section values wholesale', () => {
    expect(
      normalizeTripPlanningProposal({ explanation: 'x', update: { notes: 'text' } })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({ explanation: 'x', update: { days: 'nope' } })
    ).toBeNull();
  });
});

describe('mergePlanningProposalIntoDraft', () => {
  it('overrides present keys and preserves untouched keys without mutating inputs', () => {
    const base = {
      tripId: 'trip-1',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      notes: ['Original note'],
    };
    const proposal: TripPlanningProposal = {
      explanation: 'x',
      update: { destinations: [{ id: 'dst-1', name: 'Canggu', country: 'Indonesia' }] },
    };
    const baseSnapshot = JSON.stringify(base);
    const proposalSnapshot = JSON.stringify(proposal);

    const merged = mergePlanningProposalIntoDraft({ ...base }, proposal);

    expect(merged.tripId).toBe('trip-1');
    expect(merged.dateRange).toEqual({ startDate: '2026-09-11', endDate: '2026-09-15' });
    expect(merged.notes).toEqual(['Original note']);
    expect(merged.destinations).toEqual([{ id: 'dst-1', name: 'Canggu', country: 'Indonesia' }]);
    expect(JSON.stringify(base)).toBe(baseSnapshot);
    expect(JSON.stringify(proposal)).toBe(proposalSnapshot);
  });

  it('keeps the clear-dates meaning when a proposal sets dateRange to null', () => {
    const base = {
      tripId: 'trip-1',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { dateRange: null },
    });
    expect(merged.dateRange).toBeNull();
  });

  it('builds a full draft from a bare trip key', () => {
    const merged = mergePlanningProposalIntoDraft(
      { tripId: 'trip-9' },
      { explanation: 'x', update: { notes: ['n'] } }
    );
    expect(merged).toEqual({ tripId: 'trip-9', notes: ['n'] });
  });

  it('preserves stable ids: existing ids pass through unchanged and untouched sections keep theirs', () => {
    const base = {
      tripId: 'trip-1',
      destinations: [
        { id: 'dst-1', name: 'Ubud', country: 'Indonesia' },
        { id: 'dst-local', name: 'Canggu', country: 'Indonesia' },
      ],
      days: [
        { dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] },
        { dayNumber: 2, title: 'Temples', theme: 'Culture', activities: [] },
      ],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: {
        destinations: [
          { id: 'dst-1', name: 'Ubud', country: 'Indonesia' },
          { id: 'dst-2', name: 'Nusa Penida', country: 'Indonesia' },
        ],
      },
    });
    expect(merged.destinations?.map((d) => d.id)).toEqual(['dst-1', 'dst-2']);
    expect(merged.days?.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(merged.days).toBe(base.days);
  });

  it('preserves STEP 16 sections when merging a proposal that does not cover them', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      accommodationPlans: [{ id: 'acp-1', name: 'Hotel' }],
      budgetPlan: { currency: 'USD', totalPlanned: 900 },
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged.transportPlans).toEqual(base.transportPlans);
    expect(merged.accommodationPlans).toEqual(base.accommodationPlans);
    expect(merged.budgetPlan).toEqual(base.budgetPlan);
  });

  it('preserves STEP 17 readiness metadata through a proposal merge untouched', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', readiness: { state: 'user-confirmed' as const } },
      ],
      accommodationPlans: [
        { id: 'acp-1', name: 'Hotel', readiness: { state: 'planned' as const, note: 'keep' } },
      ],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.transportPlans).toEqual(base.transportPlans);
    expect(merged.accommodationPlans).toEqual(base.accommodationPlans);
    expect(merged.transportPlans?.[0].readiness).toEqual({ state: 'user-confirmed' });
  });

  it('applies cleanly through the shared workspace boundary and preserves read-only sections', () => {
    const workspace = createDraftTrip({
      ownerId: 'user-1',
      title: 'Trip',
      now: '2026-09-11T12:00:00.000Z',
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    });
    workspace.itinerary = {
      destination: 'Bali',
      country: 'Indonesia',
      durationDays: 5,
      budgetLevel: 'Moderate',
      travelStyle: 'Solo',
      interests: [],
      summary: '',
      estimatedTotalCost: '',
      bestTimeToVisit: '',
      dayPlans: [],
      transport: [{ mode: 'car', route: 'A → B', estimatedCost: '$30' }],
      hotels: [{ name: 'Hotel', area: 'Center', ratePerNight: '$50', estimatedCost: '$250' }],
    };

    const normalized = normalizeTripPlanningProposal({
      explanation: 'x',
      update: {
        destinations: [
          { id: 'd1', name: 'Ubud', country: 'Indonesia' },
          { id: 'dst-1', name: 'Canggu', country: 'Indonesia' },
        ],
      },
    });

    const applied = applyTripPlanningUpdate(workspace, (normalized as TripPlanningProposal).update);
    expect(applied.destinations.map((d) => d.name)).toEqual(['Ubud', 'Canggu']);
    expect(applied.itinerary?.transport).toEqual([
      { mode: 'car', route: 'A → B', estimatedCost: '$30' },
    ]);
    expect(applied.itinerary?.hotels).toEqual([
      { name: 'Hotel', area: 'Center', ratePerNight: '$50', estimatedCost: '$250' },
    ]);
  });
});

describe('summarizeProposalChanges', () => {
  const current = currentPlanning();

  it('lists only the sections present in the proposal update', () => {
    const rows = summarizeProposalChanges(
      {
        explanation: 'x',
        update: { destinations: [{ id: 'dst-1', name: 'Canggu', country: 'Indonesia' }] },
      },
      current
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe('destinations');
    expect(rows[0].current).toBe('Ubud');
    expect(rows[0].proposed).toBe('Canggu');
  });

  it('formats dates and the clear-dates case', () => {
    const dates = summarizeProposalChanges(
      {
        explanation: 'x',
        update: { dateRange: { startDate: '2026-09-12', endDate: '2026-09-16' } },
      },
      current
    );
    expect(dates[0].current).toBe('2026-09-11 → 2026-09-15');
    expect(dates[0].proposed).toBe('2026-09-12 → 2026-09-16');

    const cleared = summarizeProposalChanges(
      { explanation: 'x', update: { dateRange: null } },
      current
    );
    expect(cleared[0].current).toBe('2026-09-11 → 2026-09-15');
    expect(cleared[0].proposed).toBe('Clear dates');
  });

  it('formats day summaries', () => {
    const rows = summarizeProposalChanges(
      {
        explanation: 'x',
        update: {
          days: [
            { dayNumber: 1, title: 'Beach Day', theme: 'Sun', activities: [] },
            { dayNumber: 2, title: 'Temple', theme: 'Culture', activities: [] },
          ],
        },
      },
      current
    );
    expect(rows[0].section).toBe('days');
    expect(rows[0].current).toBe('Day 1: Arrival');
    expect(rows[0].proposed).toBe('Day 1: Beach Day; Day 2: Temple');
  });

  it('summarizes notes and references', () => {
    const rows = summarizeProposalChanges(
      {
        explanation: 'x',
        update: {
          notes: ['Pack layers', 'Book transfer'],
          references: [{ id: 'ref-1', kind: 'activity', title: 'Surf Lesson' }],
        },
      },
      current
    );
    expect(rows.find((r) => r.section === 'notes')?.current).toBe('1 note(s)');
    expect(rows.find((r) => r.section === 'notes')?.proposed).toBe('2 note(s)');
    expect(rows.find((r) => r.section === 'references')?.current).toBe('None');
    expect(rows.find((r) => r.section === 'references')?.proposed).toBe('Surf Lesson');
  });

  it('does not mutate inputs', () => {
    const p = { explanation: 'x', update: { notes: ['a'] } } as TripPlanningProposal;
    const currentSnapshot = JSON.stringify(current);
    summarizeProposalChanges(p, current);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
  });
});

describe('STEP 18 checklist stays out of the AI proposal boundary', () => {
  it('rejects proposals that try to set checklist tasks (no AI-authored tasks)', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          tasks: [{ id: 't', category: 'general', title: 'Task', status: 'pending' }],
        },
      })
    ).toBeNull();
  });

  it('rejects proposals smuggling checklist tasks under a wrapper object', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {},
        checklist: [{ id: 't', category: 'general', title: 'Task', status: 'pending' }],
      })
    ).toBeNull();
  });

  it('merging a proposal preserves existing draft tasks untouched', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
      tasks: [
        {
          id: 'tsk-1',
          category: 'document-preparation' as const,
          title: 'Apply for e-visa',
          status: 'in_progress' as const,
        },
      ],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged.tasks).toEqual(base.tasks);
    expect(merged.tasks?.[0].status).toBe('in_progress');
  });
});

describe('STEP 19 verification state stays out of the AI proposal boundary', () => {
  it('rejects proposals that try to set verification metadata (no AI-authored evidence)', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          verification: {
            state: 'provider-confirmed',
            evidence: [{ id: 'ev-1', state: 'provider-confirmed', sourceKind: 'provider-system' }],
          },
        },
      })
    ).toBeNull();
  });

  it('rejects proposals smuggling execution status or readiness into the update', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { executionStatus: 'confirmed' },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { readiness: { state: 'provider-confirmed' } },
      })
    ).toBeNull();
  });

  it('rejects proposals that try to write execution records (no AI-authored bookings)', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          executionRecords: [
            {
              id: 'exec-1',
              componentId: 'trp-1',
              category: 'transport',
              state: 'provider-confirmed',
              verification: [],
            },
          ],
        },
      })
    ).toBeNull();
  });

  it('merging a proposal never introduces verification keys into the draft', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged).not.toHaveProperty('verification');
    expect(merged).not.toHaveProperty('executionRecords');
    expect(merged).not.toHaveProperty('readiness');
    expect(merged).not.toHaveProperty('executionStatus');
  });
});

describe('STEP 20 provider/execution architecture stays out of the AI proposal boundary', () => {
  const forbiddenKeys = [
    'capabilities',
    'providerResults',
    'adapter',
    'adapterProfile',
    'verificationResult',
    'producerResult',
    'bookingLifecycle',
    'bookingState',
    'lifecycle',
    'lifecycleState',
    'executionOperation',
    'executionResult',
    'auditEvent',
    'approvalState',
    'providerOperations',
  ];

  it('rejects every STEP 20 architecture key from an AI proposal update', () => {
    for (const key of forbiddenKeys) {
      expect(
        normalizeTripPlanningProposal({
          explanation: 'x',
          update: { [key]: {} },
        })
      ).toBeNull();
    }
  });

  it('rejects provider nested payloads anywhere in the proposal update', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          providerResults: [
            { providerId: 'a', providerName: 'A', resultId: 'r', category: 'transport' },
          ],
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { bookingState: 'provider_confirmed' },
      })
    ).toBeNull();
  });

  it('the AI proposal whitelist still contains exactly the five STEP 14 keys', () => {
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).toEqual([
      'dateRange',
      'destinations',
      'days',
      'notes',
      'references',
    ]);
  });
});

describe('STEP 21 read-only mock discovery stays out of the AI proposal boundary', () => {
  const forbiddenKeys = [
    'discovery',
    'discoveryQuery',
    'discoveryResults',
    'mockResults',
    'providerSearch',
    'simulatedOptions',
    'discoveryOutcome',
    'mockDiscovery',
    'adaptersConsulted',
    'availability',
  ];

  it('rejects every STEP 21 discovery key from an AI proposal update', () => {
    for (const key of forbiddenKeys) {
      expect(
        normalizeTripPlanningProposal({
          explanation: 'x',
          update: { [key]: {} },
        })
      ).toBeNull();
    }
  });

  it('rejects provider result payloads smuggled into the proposal update', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          discovery: {
            status: 'success',
            results: [{ providerId: 'mock-transport-provider', resultId: 'r-1' }],
          },
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { simulatedOptions: [{ title: 'Mock Express Rail', price: 149 }] },
      })
    ).toBeNull();
  });

  it('merging a proposal never introduces discovery keys into the draft', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged).not.toHaveProperty('discovery');
    expect(merged).not.toHaveProperty('discoveryResults');
    expect(merged).not.toHaveProperty('mockResults');
    expect(merged).not.toHaveProperty('simulatedOptions');
  });
});

describe('STEP 26 primary selection scope lock for AI proposals', () => {
  it('allows only the original five STEP-14 keys in ALLOWED_PROPOSAL_UPDATE_KEYS', () => {
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).toEqual([
      'dateRange',
      'destinations',
      'days',
      'notes',
      'references',
    ]);
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('transportPlans');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('accommodationPlans');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('budgetPlan');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('tasks');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('primaryTransportPlanId');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('primaryAccommodationPlanId');
  });

  it('rejects a proposal containing primaryTransportPlanId as an unknown key', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryTransportPlanId: 'trp-1' },
      })
    ).toBeNull();
  });

  it('rejects a proposal containing primaryAccommodationPlanId as an unknown key', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryAccommodationPlanId: 'acp-1' },
      })
    ).toBeNull();
  });

  it('rejects a proposal containing both primary keys as unknown keys', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          primaryTransportPlanId: 'trp-1',
          primaryAccommodationPlanId: 'acp-1',
        },
      })
    ).toBeNull();
  });

  it('merging a proposal never introduces primary selection keys into the draft', () => {
    const base = {
      tripId: 'trip-1',
      notes: ['n'],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged).not.toHaveProperty('primaryTransportPlanId');
    expect(merged).not.toHaveProperty('primaryAccommodationPlanId');
  });
});

describe('STEP 27 primary reference lifecycle integrity for AI proposals', () => {
  it('an AI proposal can never stage a plan lifecycle change or a selection change', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: {
          transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryTransportPlanId: null },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryAccommodationPlanId: 'acp-1' },
      })
    ).toBeNull();
  });

  it('merging a valid proposal preserves an existing staged primary selection in the draft', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      primaryTransportPlanId: 'trp-1',
      primaryAccommodationPlanId: 'acp-1',
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.notes).toEqual(['m']);
    expect(merged.primaryTransportPlanId).toBe('trp-1');
    expect(merged.primaryAccommodationPlanId).toBe('acp-1');
  });

  it('a proposal applied over an inactive selection still resolves as attention-needing after apply', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
      primaryTransportPlanId: 'trp-1',
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged.primaryTransportPlanId).toBe('trp-1');
    expect(merged.transportPlans?.[0].lifecycleState).toBe('archived');
  });
});

describe('STEP 28 explicit primary-resolution semantics for AI proposals', () => {
  it('the AI proposal whitelist never includes resolution vocabulary keys', () => {
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('explicitResolution');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('primaryResolution');
    expect(ALLOWED_PROPOSAL_UPDATE_KEYS).not.toContain('resolutions');
  });

  it('rejects a proposal carrying resolution vocabulary as an unknown key', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { explicitResolution: 'selected-another' },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { resolutions: {} },
      })
    ).toBeNull();
  });

  it('an AI proposal can never stage a resolution by clearing or selecting a primary', () => {
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryTransportPlanId: null },
      })
    ).toBeNull();
    expect(
      normalizeTripPlanningProposal({
        explanation: 'x',
        update: { primaryAccommodationPlanId: 'acp-1' },
      })
    ).toBeNull();
  });

  it('applying a proposal over a resolved-by-selection draft keeps the resolution intact', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
        { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
      ],
      primaryTransportPlanId: 'trp-2',
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    const outcome = classifyPrimaryResolutionDecision({
      priorStatus: 'valid',
      priorSelectedId: 'trp-2',
      action: { type: 'select', selectedId: 'trp-2' },
      plans: merged.transportPlans ?? [],
    });
    expect(merged.primaryTransportPlanId).toBe('trp-2');
    expect(outcome.resolved).toBe(false);
    expect(resolvePrimaryAssignmentStatus('trp-2', merged.transportPlans ?? [])).toBe('valid');
  });

  it('applying a proposal over a resolved-by-restore draft keeps the recovered assignment', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Ferry', lifecycleState: 'active' }],
      primaryTransportPlanId: 'trp-1',
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(resolvePrimaryAssignmentStatus('trp-1', merged.transportPlans ?? [])).toBe('valid');
    expect(getPrimaryResolutionDecisionLabel('restored-selected')).toBe(
      'Existing primary reference restored to active in this draft.'
    );
  });

  it('applying a proposal over an unresolved draft never auto-resolves the conflict', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
      primaryTransportPlanId: 'trp-1',
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(resolvePrimaryAssignmentStatus('trp-1', merged.transportPlans ?? [])).toBe('inactive');
    const outcome = classifyPrimaryResolutionDecision({
      priorStatus: 'inactive',
      priorSelectedId: 'trp-1',
      action: { type: 'restore', planId: 'trp-1' },
      plans: merged.transportPlans ?? [],
    });
    expect(outcome.resolved).toBe(false);
  });

  it('applying a proposal over a cleared draft never invents a primary', () => {
    const base: Parameters<typeof mergePlanningProposalIntoDraft>[0] = {
      tripId: 'trip-1',
      notes: ['n'],
      transportPlans: [{ id: 'trp-1', mode: 'Bus', lifecycleState: 'active' }],
    };
    const merged = mergePlanningProposalIntoDraft(base, {
      explanation: 'x',
      update: { notes: ['m'] },
    });
    expect(merged).not.toHaveProperty('primaryTransportPlanId');
    expect(merged).not.toHaveProperty('primaryAccommodationPlanId');
    expect(resolvePrimaryAssignmentStatus(undefined, merged.transportPlans ?? [])).toBe('none');
  });
});
