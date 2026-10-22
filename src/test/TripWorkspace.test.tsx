import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TripWorkspaceView } from '../components/trips/TripWorkspace';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { TripItinerarySnapshot, TripWorkspace } from '../types/trip';

afterEach(cleanup);

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

describe('TripWorkspaceView', () => {
  it('renders the trip title, status, and destinations', () => {
    render(<TripWorkspaceView workspace={makeWorkspace()} />);

    expect(screen.getByRole('heading', { name: 'Island Escape' })).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('Ubud')).toBeInTheDocument();
    expect(screen.getByText('Indonesia')).toBeInTheDocument();
    expect(screen.getByText('Workspace foundation')).toBeInTheDocument();
  });

  it('renders the date range when present', () => {
    render(
      <TripWorkspaceView
        workspace={makeWorkspace({
          dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        })}
      />
    );

    expect(screen.getByText('2026-09-11 → 2026-09-15')).toBeInTheDocument();
  });

  it('omits the date range when absent', () => {
    render(<TripWorkspaceView workspace={makeWorkspace()} />);

    expect(screen.queryByText('→')).not.toBeInTheDocument();
  });

  it('shows a placeholder when there are no destinations', () => {
    render(<TripWorkspaceView workspace={makeWorkspace({ destinations: [] })} />);

    expect(screen.getByText('No destinations yet.')).toBeInTheDocument();
    expect(screen.queryByText('Ubud')).not.toBeInTheDocument();
  });

  it('renders the itinerary overview and meta when a snapshot is present', () => {
    render(<TripWorkspaceView workspace={makeWorkspace({ itinerary: makeSnapshot() })} />);

    expect(screen.getByText('Itinerary overview')).toBeInTheDocument();
    expect(screen.getByText('A balanced island escape.')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
    expect(screen.getByText('Estimated total: $1,200')).toBeInTheDocument();
    expect(screen.getByText('Best time: April–October')).toBeInTheDocument();
  });

  it('shows a fallback when the itinerary overview is empty', () => {
    render(
      <TripWorkspaceView
        workspace={makeWorkspace({ itinerary: makeSnapshot({ summary: '  ' }) })}
      />
    );

    expect(screen.getByText('No overview yet.')).toBeInTheDocument();
  });

  it('shows a fallback when the itinerary has no day plans', () => {
    render(<TripWorkspaceView workspace={makeWorkspace({ itinerary: makeSnapshot() })} />);

    expect(screen.getByText('No day-by-day plan yet.')).toBeInTheDocument();
  });

  it('renders day plans, activities, transport, and hotels from the snapshot', () => {
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
      transport: [{ mode: 'Private car', route: 'Airport → Ubud', estimatedCost: '$25' }],
      hotels: [
        { name: 'Padi Hotel', area: 'Campuhan', ratePerNight: '$60', estimatedCost: '$300' },
      ],
    });
    render(<TripWorkspaceView workspace={makeWorkspace({ itinerary })} />);

    expect(screen.getByText('Day 1 — Arrival')).toBeInTheDocument();
    expect(screen.getByText('Land in Denpasar')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText(/Ngurah Rai Airport/)).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('Private car')).toBeInTheDocument();
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.getByText('Padi Hotel')).toBeInTheDocument();
  });

  it('omits itinerary-only sections when the workspace has no snapshot', () => {
    render(<TripWorkspaceView workspace={makeWorkspace()} />);

    expect(screen.queryByText('Itinerary overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Day-by-day plan')).not.toBeInTheDocument();
    expect(screen.queryByText('No day-by-day plan yet.')).not.toBeInTheDocument();
  });

  describe('structured planning plan projection (STEP 25)', () => {
    it('renders active plan references as primary with an Active chip', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Flight', provider: 'Nusa Air', lifecycleState: 'active' },
          ],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Transport plans')).toBeInTheDocument();
      expect(screen.getByText('Flight · Nusa Air')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('visibly marks needs-review plan references', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Ferry', lifecycleState: 'needs-review' }],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Ferry')).toBeInTheDocument();
      expect(screen.getByText('Needs review')).toBeInTheDocument();
    });

    it('keeps replaced and archived references in the always-visible subgroup', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Flight', lifecycleState: 'active' },
            { id: 't2', mode: 'Bus', lifecycleState: 'replaced' },
            { id: 't3', mode: 'Taxi', lifecycleState: 'archived' },
          ],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Replaced / archived (2)')).toBeInTheDocument();
      expect(screen.getByText('Replaced reference')).toBeInTheDocument();
      expect(screen.getByText('Archived reference')).toBeInTheDocument();
      expect(screen.getAllByText('Active')).toHaveLength(1);
    });

    it('treats a legacy plan without lifecycle as active and notes it honestly', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Train' }],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText(/Legacy reference — treated as active/)).toBeInTheDocument();
      expect(screen.getByText('Train')).toBeInTheDocument();
      expect(screen.queryByText('Replaced / archived')).not.toBeInTheDocument();
    });

    it('shows provenance and lifecycle as separate labels on the same row', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            {
              id: 't1',
              mode: 'Shuttle',
              lifecycleState: 'active',
              provenance: { kind: 'mock-discovery' },
            },
          ],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Simulated discovery')).toBeInTheDocument();
    });

    it('renders accommodation plan references with the same lifecycle grouping', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          accommodationPlans: [
            { id: 'a1', name: 'Padi Hotel', lifecycleState: 'active' },
            { id: 'a2', name: 'Old Resort', lifecycleState: 'replaced' },
          ],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Accommodation plans')).toBeInTheDocument();
      expect(screen.getByText('Padi Hotel')).toBeInTheDocument();
      expect(screen.getByText('Replaced / archived (1)')).toBeInTheDocument();
      expect(screen.getByText('Replaced reference')).toBeInTheDocument();
    });

    it('omits the plan sections when the plan fields stay empty', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({ transportPlans: [], accommodationPlans: [] }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByText('Transport plans')).not.toBeInTheDocument();
      expect(screen.queryByText('Accommodation plans')).not.toBeInTheDocument();
    });

    it('exposes no editing controls on the read-only projection', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Bus', lifecycleState: 'needs-review' },
            { id: 't2', mode: 'Taxi', lifecycleState: 'archived' },
          ],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark for review/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /replace/i })).not.toBeInTheDocument();
    });
  });

  describe('structured planning primary selection (STEP 26)', () => {
    it('renders "Primary reference" chip for the valid selected plan and lists it first', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Flight', lifecycleState: 'active' },
            { id: 't2', mode: 'Train', lifecycleState: 'active' },
          ],
          primaryTransportPlanId: 't2',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      const chips = screen.getAllByText('Primary reference');
      expect(chips).toHaveLength(1);
      expect(screen.getByText('Train')).toBeInTheDocument();
      expect(screen.getByText('Flight')).toBeInTheDocument();

      const rows = screen.getAllByRole('listitem');
      const trainRow = rows.find((el) => el.textContent?.includes('Train'));
      const flightRow = rows.find((el) => el.textContent?.includes('Flight'));
      expect(trainRow).toBeDefined();
      expect(flightRow).toBeDefined();
      expect(rows.indexOf(trainRow!)).toBeLessThan(rows.indexOf(flightRow!));
    });

    it('shows no "Primary reference" chip and no attention notice when no selection is persisted', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Bus', lifecycleState: 'active' }],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
      expect(screen.queryByText(/Primary selected/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Primary assignment needs attention/)).not.toBeInTheDocument();
    });

    it('shows a needs-attention notice when the primary references a missing plan', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Bus', lifecycleState: 'active' }],
          primaryTransportPlanId: 't-missing',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText(/Primary assignment needs attention/)).toBeInTheDocument();
      expect(screen.getByText(/t-missing/)).toBeInTheDocument();
      expect(screen.getByText('Bus')).toBeInTheDocument();
      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
    });

    it('shows a needs-attention notice when the primary references an archived plan', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Ferry', lifecycleState: 'archived' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(
        screen.getAllByText(/Primary assignment needs attention/).length
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText(
          /The selected primary reference "t1" is not an active reference \(archived\)/
        )
      ).toBeInTheDocument();
    });

    it('renders the primary accommodation selection independently of transport', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          accommodationPlans: [
            { id: 'a1', name: 'Padi Hotel', lifecycleState: 'active' },
            { id: 'a2', name: 'Luxury Villa', lifecycleState: 'active' },
          ],
          primaryAccommodationPlanId: 'a2',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Accommodation plans')).toBeInTheDocument();
      expect(screen.getByText('Primary reference')).toBeInTheDocument();
      expect(screen.getByText('Luxury Villa')).toBeInTheDocument();
      expect(screen.getByText('Padi Hotel')).toBeInTheDocument();
    });

    it('does not show a Primary reference chip for an inactive selection', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Ferry', lifecycleState: 'replaced' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
      expect(
        screen.getAllByText(/Primary assignment needs attention/).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('omits the primary section when there are no plans', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [],
          primaryTransportPlanId: undefined,
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByText('Transport plans')).not.toBeInTheDocument();
    });
  });

  describe('structured planning primary reference lifecycle integrity (STEP 27)', () => {
    it('shows the muted caption when plans exist and no explicit primary is selected', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Flight', lifecycleState: 'active' }],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(screen.getByText('No primary reference selected.')).toBeInTheDocument();
    });

    it('omits the muted caption when there is an explicit selection', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Flight', lifecycleState: 'active' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(screen.queryByText('No primary reference selected.')).not.toBeInTheDocument();
    });

    it('omits the muted caption when the section is empty', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({ transportPlans: [] }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(screen.queryByText('No primary reference selected.')).not.toBeInTheDocument();
    });

    it('marks the referenced-but-inactive plan row with the amber attention chip in the main group', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Ferry', lifecycleState: 'needs-review' },
            { id: 't2', mode: 'Bus', lifecycleState: 'active' },
          ],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(
        screen.getAllByText('Primary assignment needs attention').length
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Ferry/)).toBeInTheDocument();
    });

    it('marks the referenced-but-inactive plan row with the amber attention chip in the secondary group', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Ferry', lifecycleState: 'archived' },
            { id: 't2', mode: 'Bus', lifecycleState: 'active' },
          ],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(
        screen.getAllByText('Primary assignment needs attention').length
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Replaced / archived (1)')).toBeInTheDocument();
      expect(screen.getByText('Ferry')).toBeInTheDocument();
    });

    it('restores the green Primary reference chip when the inactive plan is reactivated at the data layer', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Ferry', lifecycleState: 'archived' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);
      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
      expect(
        screen.getAllByText('Primary assignment needs attention').length
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('structured planning primary reference resolution outcomes (STEP 28)', () => {
    it('renders the resolved-by-selection outcome as a valid explicit assignment', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Flight', lifecycleState: 'active' },
            { id: 't2', mode: 'Train', lifecycleState: 'active' },
          ],
          primaryTransportPlanId: 't2',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Primary reference')).toBeInTheDocument();
      expect(screen.queryByText(/Primary assignment needs attention/)).not.toBeInTheDocument();
      expect(screen.queryByText('No primary reference selected.')).not.toBeInTheDocument();
    });

    it('renders the resolved-by-clear outcome as a healthy absent assignment', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Bus', lifecycleState: 'active' }],
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
      expect(screen.queryByText(/Primary assignment needs attention/)).not.toBeInTheDocument();
      expect(screen.getByText('No primary reference selected.')).toBeInTheDocument();
    });

    it('renders the resolved-by-restore outcome as a recovered assignment', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Ferry', lifecycleState: 'active' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Primary reference')).toBeInTheDocument();
      expect(screen.queryByText(/Primary assignment needs attention/)).not.toBeInTheDocument();
    });

    it('renders transport and accommodation resolution outcomes independently', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 't1', mode: 'Flight', lifecycleState: 'active' },
            { id: 't2', mode: 'Train', lifecycleState: 'active' },
          ],
          primaryTransportPlanId: 't1',
          accommodationPlans: [{ id: 'a1', name: 'Padi Hotel', lifecycleState: 'active' }],
          primaryAccommodationPlanId: 'a1-missing',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(screen.getByText('Primary reference')).toBeInTheDocument();
      expect(screen.getByText(/Primary assignment needs attention/)).toBeInTheDocument();
      expect(screen.getByText(/a1-missing/)).toBeInTheDocument();
    });

    it('echoes an unresolved state in the read-only view and never fabricates a resolution', () => {
      const workspace = makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 't1', mode: 'Flight', lifecycleState: 'archived' }],
          primaryTransportPlanId: 't1',
        }),
      });
      render(<TripWorkspaceView workspace={workspace} />);

      expect(
        screen.getAllByText(/Primary assignment needs attention/).length
      ).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Primary reference')).not.toBeInTheDocument();
      expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument();
      expect(screen.getByText(/t1/)).toBeInTheDocument();
    });
  });
});
