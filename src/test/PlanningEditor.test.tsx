import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  PlanningEditor,
  type AiAssistState,
  type PlanningDraft,
  type PlanningSaveState,
} from '../components/trips/PlanningEditor';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { TripItinerarySnapshot, TripPlanningProposal, TripWorkspace } from '../types/trip';

const TRIP_ID = 'trip-2026-09-11T12:00:00.000Z';

function makeWorkspace(overrides: Partial<TripWorkspace> = {}): TripWorkspace {
  return {
    ...createDraftTrip({
      ownerId: 'user-1',
      title: 'Island Escape',
      now: '2026-09-11T12:00:00.000Z',
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

function destinationList(count: number): TripWorkspace['destinations'] {
  return Array.from({ length: count }, (_, i) => ({ id: `d${i + 1}`, name: `City ${i + 1}` }));
}

interface HarnessOptions {
  trip: TripWorkspace;
  saveState?: PlanningSaveState;
  disabled?: boolean;
  aiState?: AiAssistState;
}

function renderEditor(options: HarnessOptions): {
  captured: PlanningDraft[];
  aiGenerated: string[];
  aiApplied: TripPlanningProposal[];
  aiDiscarded: { count: number };
} {
  const captured: PlanningDraft[] = [];
  const aiGenerated: string[] = [];
  const aiApplied: TripPlanningProposal[] = [];
  const aiDiscarded = { count: 0 };
  function Harness() {
    const [draft, setDraft] = useState<PlanningDraft | null>(null);
    return (
      <PlanningEditor
        trip={options.trip}
        draft={draft}
        onChange={setDraft}
        onSave={(drafted) => captured.push({ ...drafted })}
        saveState={options.saveState ?? { status: 'idle' }}
        disabled={options.disabled ?? false}
        aiState={options.aiState ?? { status: 'idle' }}
        onGenerateSuggestion={(instruction) => aiGenerated.push(instruction)}
        onApplySuggestion={(proposal) => aiApplied.push(proposal)}
        onDiscardSuggestion={() => {
          aiDiscarded.count += 1;
        }}
      />
    );
  }
  render(<Harness />);
  return { captured, aiGenerated, aiApplied, aiDiscarded };
}

const workspaceWithItinerary = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    itinerary: makeSnapshot({
      notes: ['Book early'],
      references: [{ id: 'act-1', kind: 'activity', title: 'Monkey Forest' }],
    }),
  });

describe('PlanningEditor', () => {
  it('shows persisted dates, destinations, notes, and references', () => {
    renderEditor({ trip: workspaceWithItinerary() });

    expect(screen.getByLabelText('Start')).toHaveValue('2026-09-11');
    expect(screen.getByLabelText('End')).toHaveValue('2026-09-15');
    expect(screen.getByLabelText('Destination name d1')).toHaveValue('Ubud');
    expect(screen.getByLabelText('Planning notes')).toHaveValue('Book early');
    expect(screen.getByLabelText('Reference title 1')).toHaveValue('Monkey Forest');
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('gates daily plan, notes, and references behind an existing itinerary', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({
      trip: makeWorkspace({
        destinations: [{ id: 'destination-primary', name: 'Bali', country: 'Indonesia' }],
      }),
    });

    expect(screen.getByText(/Add an itinerary to edit the daily plan/)).toBeTruthy();
    expect(screen.queryByText('Daily itinerary')).toBeNull();
    expect(screen.queryByLabelText('Planning notes')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull();

    await user.clear(screen.getByLabelText('Destination name destination-primary'));
    await user.type(screen.getByLabelText('Destination name destination-primary'), 'Canggu');
    const save = screen.getByRole('button', { name: 'Save planning' });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(captured).toHaveLength(1);
    expect(captured[0].destinations?.[0]).toMatchObject({
      id: 'destination-primary',
      name: 'Canggu',
    });
  });

  it('enables save after editing dates and sends the tripKeyed draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: workspaceWithItinerary() });

    await user.clear(screen.getByLabelText('Start'));
    await user.type(screen.getByLabelText('Start'), '2026-09-12');

    const save = screen.getByRole('button', { name: 'Save planning' });
    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await user.click(save);

    expect(captured).toHaveLength(1);
    expect(captured[0].tripId).toBe(TRIP_ID);
    expect(captured[0].dateRange).toEqual({ startDate: '2026-09-12', endDate: '2026-09-15' });
  });

  it('trims planning notes into the draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: workspaceWithItinerary() });

    const notes = screen.getByLabelText('Planning notes');
    fireEvent.change(notes, {
      target: { value: '  Remember sunscreen  \n\nPlan transfer' },
    });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].notes).toEqual(['Remember sunscreen', 'Plan transfer']);
  });

  it('updates daily itinerary fields', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      itinerary: makeSnapshot({
        dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
      }),
    });
    const { captured } = renderEditor({ trip });

    await user.clear(screen.getByLabelText('Day 1 title'));
    await user.type(screen.getByLabelText('Day 1 title'), 'Beach Day');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].days?.[0].title).toBe('Beach Day');
  });

  it('adds destinations, day plans, and references with locally generated ids', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: workspaceWithItinerary() });

    await user.click(screen.getByRole('button', { name: 'Add destination' }));
    const destination = screen.getByLabelText(/^Destination name dst-/);
    expect(destination).toBeTruthy();
    await user.type(destination, 'Canggu');

    await user.click(screen.getByRole('button', { name: 'Add day' }));
    expect(screen.getByLabelText('Day 1 number')).toHaveValue(1);

    await user.click(screen.getByRole('button', { name: 'Add reference' }));
    await user.type(screen.getByLabelText('Reference title 2'), 'Surf Lesson');
    await user.type(screen.getByLabelText('Reference url 2'), 'https://example.com/surf');
    await user.type(screen.getByLabelText('Reference day 2'), '2');

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(captured).toHaveLength(1);

    const addedDestination = captured[0].destinations?.find((d) => d.name === 'Canggu');
    const addedReference = captured[0].references?.find((r) => r.title === 'Surf Lesson');
    expect(addedDestination?.id.startsWith('dst-')).toBe(true);
    expect(addedReference?.id.startsWith('ref-')).toBe(true);
    expect(addedReference?.url).toBe('https://example.com/surf');
    expect(addedReference?.dayNumber).toBe(2);
  }, 20000);

  it('caps destinations at 20, disabling Add and guiding a legacy over-limit trip back under the cap', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({ destinations: destinationList(25) });
    renderEditor({ trip });

    expect(screen.getByRole('button', { name: 'Add destination' })).toBeDisabled();
    expect(screen.getByText(/created before the 20-destination limit/)).toBeTruthy();

    // Removing one still leaves the list over the cap: saving stays blocked.
    await user.click(screen.getByRole('button', { name: 'Remove destination d25' }));
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/at most 20/);

    // Removing down to the cap satisfies it and enables saving; the guidance
    // copy falls back to the plain cap note once the list is no longer over.
    for (const id of ['d24', 'd23', 'd22', 'd21']) {
      await user.click(screen.getByRole('button', { name: `Remove destination ${id}` }));
    }
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
    expect(screen.getByText(/A trip can have at most 20 destinations/)).toBeTruthy();
  }, 20000);

  it('adds activities to an existing day', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      itinerary: makeSnapshot({
        dayPlans: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
      }),
    });
    const { captured } = renderEditor({ trip });

    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    await user.type(screen.getByLabelText('Activity title 1-1'), 'Rafting');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].days?.[0].activities[0].title).toBe('Rafting');
  });

  it('blocks saving on an unsafe reference url and reports a clear problem', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: workspaceWithItinerary() });

    await user.type(screen.getByLabelText('Reference url 1'), 'javascript:alert(1)');
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/safe link/);
  });

  it('physically drops the url key when the field is cleared', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      itinerary: makeSnapshot({
        references: [
          { id: 'act-1', kind: 'activity', title: 'Monkey Forest', url: 'https://example.com/mf' },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });

    const url = screen.getByLabelText('Reference url 1');
    await user.clear(url);
    await user.type(screen.getByLabelText('Reference title 1'), ' Updated');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(Object.prototype.hasOwnProperty.call(captured[0].references?.[0] ?? {}, 'url')).toBe(
      false
    );
  });

  it('keeps edits visible and offers a retry message when a save fails', () => {
    renderEditor({ trip: workspaceWithItinerary(), saveState: { status: 'error' } });

    expect(screen.getByText(/Could not save your planning changes/)).toBeTruthy();
    expect(screen.getByLabelText('Start')).toBeEnabled();
  });

  it('disables inputs and saving while an unrelated in-flight action is running', async () => {
    renderEditor({ trip: workspaceWithItinerary(), disabled: true });

    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByLabelText('Start')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add destination' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add day' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add reference' })).toBeDisabled();
  });

  it('can clear trip dates back to undefined', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: workspaceWithItinerary() });

    await user.click(screen.getByRole('button', { name: 'Clear dates' }));
    await user.type(screen.getByLabelText('Destination name d1'), ' Canggu');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].dateRange).toBeNull();
  });
});

const planWorkspace = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    itinerary: makeSnapshot({
      transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
      budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
    }),
  });

describe('PlanningEditor STEP 16 explicit sections', () => {
  it('renders persisted sections read-only with edit affordances and captions', () => {
    renderEditor({ trip: planWorkspace() });

    expect(screen.getByText('Transport plans')).toBeTruthy();
    expect(screen.getByText('Accommodation plans')).toBeTruthy();
    expect(screen.getByText('Budget plan')).toBeTruthy();
    expect(screen.getAllByText(/never a booking/).length).toBeGreaterThanOrEqual(2);

    expect(screen.getByLabelText('Transport mode 1')).toHaveValue('Flight');
    expect(screen.getByLabelText('Accommodation name 1')).toHaveValue('Padi Hotel');
    expect(screen.getByLabelText('Budget currency')).toHaveValue('USD');
    expect(screen.getByLabelText('Budget total planned')).toHaveValue(1200);

    expect(screen.getByLabelText('Transport mode 1')).toBeDisabled();
    expect(screen.getByLabelText('Budget currency')).toBeDisabled();
    expect(screen.getByLabelText('Budget total planned')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('requires the Edit affordance before transport edits capture into the draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    const mode = screen.getByLabelText('Transport mode 1');
    expect(mode).toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(mode).toBeEnabled();

    fireEvent.change(mode, { target: { value: 'Seaplane' } });
    fireEvent.change(screen.getByLabelText('Transport from 1'), { target: { value: 'Denpasar' } });
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans).toEqual([
      { id: 'trp-1', mode: 'Seaplane', departureLocation: 'Denpasar' },
    ]);
  });

  it('Cancele reverts an edited section to persisted values and closes editing', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    const mode = screen.getByLabelText('Transport mode 1');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(mode, { target: { value: 'Train' } });
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Transport mode 1')).toHaveValue('Flight');
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    expect(screen.getByLabelText('Transport mode 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(captured).toHaveLength(0);
  });

  it('adds an accommodation plan with a local id from a fresh edit', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Add accommodation plan' }));
    await user.type(screen.getByLabelText('Accommodation name 2'), 'Villa Amar');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    const added = captured[0].accommodationPlans?.[1];
    expect(captured[0].accommodationPlans).toHaveLength(2);
    expect(added?.id.startsWith('acp-')).toBe(true);
    expect(added?.name).toBe('Villa Amar');
  });

  it('removes an existing accommodation plan from the draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Remove accommodation plan 1' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].accommodationPlans).toEqual([]);
  });

  it('clears an existing budget plan to null via the explicit action', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    await user.click(screen.getByRole('button', { name: 'Clear budget plan' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].budgetPlan).toBeNull();
  });

  it('blocks saving negative budget amounts with a clear problem message', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    await user.clear(screen.getByLabelText('Budget total planned'));
    await user.type(screen.getByLabelText('Budget total planned'), '-50');
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/non-negative numbers/);
  });

  it('adds a first budget plan from an empty state when no budget exists', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({}),
    });
    const { captured } = renderEditor({ trip });

    expect(screen.getByText('Budget plan')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    fireEvent.change(screen.getByLabelText('Budget currency'), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText('Budget total planned'), { target: { value: '500' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].budgetPlan).toEqual({ currency: 'EUR', totalPlanned: 500 });
  });
});

describe('PlanningEditor STEP 17 execution-readiness label', () => {
  it('shows a read-only Planned chip per plan and never claims a booking', () => {
    renderEditor({ trip: planWorkspace() });
    expect(screen.getByLabelText('Transport readiness 1')).toHaveTextContent('Planned');
    expect(screen.getByLabelText('Accommodation readiness 1')).toHaveTextContent('Planned');
    expect(screen.queryByText(/Booked|booked|reservation confirmed/)).toBeNull();
  });

  it('reflects persisted readiness state and preserves it on save', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', readiness: { state: 'user-confirmed' } }],
        accommodationPlans: [
          { id: 'acp-1', name: 'Padi Hotel', readiness: { state: 'cancelled' } },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });
    expect(screen.getByLabelText('Transport readiness 1')).toHaveTextContent(
      'User-entered reference'
    );
    expect(screen.getByLabelText('Accommodation readiness 1')).toHaveTextContent('Cancelled');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport mode 1'), { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].readiness).toEqual({ state: 'user-confirmed' });
    expect(captured[0].transportPlans?.[0].mode).toBe('Train');
  });
});

describe('PlanningEditor STEP 23 provenance layer', () => {
  const provenanceWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported from simulated discovery.' },
          },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', provenance: { kind: 'manual' } }],
      }),
    });

  it('shows a read-only provenance chip per plan and keeps labels honest', () => {
    renderEditor({ trip: provenanceWorkspace() });
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent(
      'Simulated discovery'
    );
    expect(screen.getByLabelText('Accommodation provenance 1')).toHaveTextContent(
      'Manual reference'
    );
    expect(screen.queryByText(/Booked|booked|reservation confirmed/)).toBeNull();

    const transportChip = screen.getByLabelText('Transport provenance 1');
    expect(transportChip.getAttribute('title')).toMatch(/simulated discovery/);
    expect(transportChip.getAttribute('title')).toContain('not live availability');
    expect(transportChip.getAttribute('title')).toContain('not a booking');
  });

  it('renders the source-note input with the persisted note when provenance exists', () => {
    renderEditor({ trip: provenanceWorkspace() });
    expect(screen.getByLabelText('Transport source note 1')).toBeDisabled();
    expect(screen.getByLabelText('Transport source note 1')).toHaveValue(
      'Imported from simulated discovery.'
    );
  });

  it('legacy plans show no provenance chip and no source-note input', () => {
    renderEditor({ trip: planWorkspace() });
    expect(screen.queryByLabelText('Transport source note 1')).toBeNull();
    expect(screen.queryByLabelText('Accommodation source note 1')).toBeNull();
    expect(screen.queryByLabelText('Transport provenance 1')).toBeNull();
    expect(screen.queryByLabelText('Accommodation provenance 1')).toBeNull();
  });

  it('merely opening and focusing a legacy plan never creates provenance', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const mode = screen.getByLabelText('Transport mode 1');
    mode.focus();
    fireEvent.change(mode, { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0]).toEqual({ id: 'trp-1', mode: 'Train' });
    expect(captured[0].transportPlans?.[0]).not.toHaveProperty('provenance');
  });

  it('newly added plans default to the honest manual provenance', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Add transport plan' }));
    await user.type(screen.getByLabelText('Transport mode 2'), 'Bus');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].transportPlans).toHaveLength(2);
    expect(captured[0].transportPlans?.[1].provenance).toEqual({ kind: 'manual' });
    expect(captured[0].transportPlans?.[1].mode).toBe('Bus');
  });

  it('edits the source note in-place while preserving the provenance kind', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: provenanceWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const note = screen.getByLabelText('Transport source note 1');
    expect(note).toBeEnabled();
    fireEvent.change(note, { target: { value: 'Refined sample note' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].transportPlans?.[0].provenance).toEqual({
      kind: 'mock-discovery',
      note: 'Refined sample note',
    });
  });

  it('clearing the source note drops just the note and keeps the kind', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: provenanceWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport source note 1'), {
      target: { value: '' },
    });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].transportPlans?.[0].provenance).toEqual({ kind: 'mock-discovery' });
  });

  it('ordinary plan-field edits never change a provenance kind', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: provenanceWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport mode 1'), { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured[0].transportPlans?.[0].mode).toBe('Train');
    expect(captured[0].transportPlans?.[0].provenance?.kind).toBe('mock-discovery');
  });

  it('“Mark as manually entered” is the only kind-changing action and drops the imported note', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: provenanceWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(
      screen.getByRole('button', { name: 'Mark transport plan 1 as manually entered' })
    );
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent('Manual reference');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured[0].transportPlans?.[0].provenance).toEqual({ kind: 'manual' });
    expect(captured[0].transportPlans?.[0].provenance?.note).toBeUndefined();
  });

  it('marks a simulated accommodation plan as manual from a fresh edit', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [],
        accommodationPlans: [
          {
            id: 'acp-1',
            name: 'Tokyo Grand Hotel',
            provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
          },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(
      screen.getByRole('button', { name: 'Mark accommodation plan 1 as manually entered' })
    );
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured[0].accommodationPlans?.[0].provenance).toEqual({ kind: 'manual' });
  });
});

describe('PlanningEditor STEP 24 lifecycle layer', () => {
  const lifecycleWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
            lifecycleState: 'needs-review',
            readiness: { state: 'planned' },
          },
        ],
        accommodationPlans: [
          {
            id: 'acp-1',
            name: 'Padi Hotel',
            provenance: { kind: 'manual' },
            lifecycleState: 'archived',
            readiness: { state: 'user-confirmed' },
          },
        ],
      }),
    });

  it('shows a read-only lifecycle chip per plan with honest labels and descriptions', () => {
    renderEditor({ trip: lifecycleWorkspace() });
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Needs review');
    expect(screen.getByLabelText('Accommodation lifecycle 1')).toHaveTextContent('Archived');
    expect(
      screen.queryByText(/Expired|Outdated|Unavailable|Price changed|Verified stale/)
    ).toBeNull();

    const transportChip = screen.getByLabelText('Transport lifecycle 1');
    const chipTitle = (transportChip.getAttribute('title') ?? '').toLowerCase();
    expect(chipTitle).toContain('review before relying on this reference');
    expect(chipTitle).toContain('user-marked');
  });

  it('renders provenance and lifecycle as separate, independent labels side by side', () => {
    renderEditor({ trip: lifecycleWorkspace() });
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent(
      'Simulated discovery'
    );
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Needs review');
    expect(screen.getByLabelText('Accommodation provenance 1')).toHaveTextContent(
      'Manual reference'
    );
    expect(screen.getByLabelText('Accommodation lifecycle 1')).toHaveTextContent('Archived');
  });

  it('legacy plans render an Active chip without ever persisting a lifecycle', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Active');
    expect(screen.getByLabelText('Accommodation lifecycle 1')).toHaveTextContent('Active');
    expect(screen.queryByRole('button', { name: 'Archive Transport plan 1' })).toBeNull();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByRole('button', { name: 'Archive Transport plan 1' })).toBeInTheDocument();
    const mode = screen.getByLabelText('Transport mode 1');
    fireEvent.change(mode, { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0]).toEqual({ id: 'trp-1', mode: 'Train' });
    expect(captured[0].transportPlans?.[0]).not.toHaveProperty('lifecycleState');
  });

  it('marks a plan needing review via the explicit action and saves it', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Needs review');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('needs-review');
  });

  it('marks a needs-review plan as active via the explicit action', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: lifecycleWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Active');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('active');
  });

  it('replaces a plan through the explicit action (decision only, no new record)', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as replaced' }));
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Replaced');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0]).toEqual({
      id: 'trp-1',
      mode: 'Flight',
      lifecycleState: 'replaced',
    });
  });

  it('archives a plan without deleting it and keeps its data and provenance intact', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
          },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Archive Transport plan 1' }));

    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Archived');
    expect(screen.getByLabelText('Transport mode 1')).toHaveValue('Flight');
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent(
      'Simulated discovery'
    );
    expect(screen.getByRole('button', { name: 'Restore Transport plan 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0]).toEqual({
      id: 'trp-1',
      mode: 'Flight',
      provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
      lifecycleState: 'archived',
    });
  });

  it('restores an archived accommodation plan back to active', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: lifecycleWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    expect(
      screen.getByRole('button', { name: 'Restore Accommodation plan 1' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore Accommodation plan 1' }));
    expect(screen.getByLabelText('Accommodation lifecycle 1')).toHaveTextContent('Active');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured[0].accommodationPlans?.[0].lifecycleState).toBe('active');
    expect(captured[0].accommodationPlans?.[0]).toEqual(
      expect.objectContaining({ id: 'acp-1', name: 'Padi Hotel', provenance: { kind: 'manual' } })
    );
  });

  it('a lifecycle change never touches readiness, provenance, or checklist tasks', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
            readiness: { state: 'planned' },
          },
        ],
        accommodationPlans: [],
      }),
    });
    const { captured } = renderEditor({ trip });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0]).toEqual({
      id: 'trp-1',
      mode: 'Flight',
      provenance: { kind: 'mock-discovery', note: 'Imported sample.' },
      readiness: { state: 'planned' },
      lifecycleState: 'needs-review',
    });
    expect(captured[0]).not.toHaveProperty('tasks');
  });
});

const TEST_PROPOSAL: TripPlanningProposal = {
  explanation: 'Moves the beach day to day 2 and adds a sunset cruise.',
  warnings: ['Day numbering shifts if you reorder days.'],
  assumptions: ['The sunset cruise operator is available that day.'],
  update: {
    dateRange: { startDate: '2026-09-12', endDate: '2026-09-16' },
    destinations: [
      { id: 'd1', name: 'Ubud', country: 'Indonesia' },
      { id: 'dst-1', name: 'Canggu', country: 'Indonesia' },
    ],
  },
};

describe('PlanningEditor AI planning suggestion', () => {
  it('requests a suggestion with the trimmed instruction', async () => {
    const user = userEvent.setup();
    const { aiGenerated } = renderEditor({ trip: workspaceWithItinerary() });

    await user.type(screen.getByLabelText('AI planning instruction'), '  Surf lesson  ');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    expect(aiGenerated).toEqual(['Surf lesson']);
  });

  it('keeps the Generate button disabled until an instruction is typed', async () => {
    renderEditor({ trip: workspaceWithItinerary() });
    expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeDisabled();
  });

  it('shows a loading indicator while generating', () => {
    renderEditor({ trip: workspaceWithItinerary(), aiState: { status: 'generating' } });
    expect(screen.getByText(/Generating a suggestion…/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate suggestion' })).toBeNull();
  });

  it('shows a safe error message and dismisses it', async () => {
    const user = userEvent.setup();
    const { aiDiscarded } = renderEditor({
      trip: workspaceWithItinerary(),
      aiState: { status: 'error', message: 'The planning assistant is busy right now.' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The planning assistant is busy right now.'
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(aiDiscarded.count).toBe(1);
  });

  it('previews a ready proposal with current vs proposed changes', () => {
    renderEditor({
      trip: workspaceWithItinerary(),
      aiState: {
        status: 'ready',
        tripId: TRIP_ID,
        proposal: TEST_PROPOSAL,
        previousDraft: null,
        applied: false,
      },
    });

    expect(screen.getByText('Moves the beach day to day 2 and adds a sunset cruise.')).toBeTruthy();
    expect(screen.getByText('Day numbering shifts if you reorder days.')).toBeTruthy();
    expect(screen.getByText('The sunset cruise operator is available that day.')).toBeTruthy();

    expect(screen.getByText('Dates')).toBeTruthy();
    expect(screen.getByText('2026-09-11 → 2026-09-15')).toBeTruthy();
    expect(screen.getByText('2026-09-12 → 2026-09-16')).toBeTruthy();
    expect(screen.getAllByText('Destinations')).toHaveLength(2);
    expect(screen.getByText('Ubud')).toBeTruthy();
    expect(screen.getByText('Ubud, Canggu')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Apply suggestion' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
  });

  it('passes the approved proposal to the apply callback', async () => {
    const user = userEvent.setup();
    const { aiApplied } = renderEditor({
      trip: workspaceWithItinerary(),
      aiState: {
        status: 'ready',
        tripId: TRIP_ID,
        proposal: TEST_PROPOSAL,
        previousDraft: null,
        applied: false,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    expect(aiApplied).toEqual([TEST_PROPOSAL]);
  });

  it('discards a ready proposal', async () => {
    const user = userEvent.setup();
    const { aiDiscarded } = renderEditor({
      trip: workspaceWithItinerary(),
      aiState: {
        status: 'ready',
        tripId: TRIP_ID,
        proposal: TEST_PROPOSAL,
        previousDraft: null,
        applied: false,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(aiDiscarded.count).toBe(1);
  });

  it('shows an applied state with Apply disabled', async () => {
    renderEditor({
      trip: workspaceWithItinerary(),
      aiState: {
        status: 'ready',
        tripId: TRIP_ID,
        proposal: TEST_PROPOSAL,
        previousDraft: null,
        applied: true,
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('Applied to your draft');
    expect(screen.getByRole('button', { name: 'Applied' })).toBeDisabled();
    expect(screen.getByText('Applied — review before saving')).toBeTruthy();
  });

  it('hides the assistant on a workspace without an itinerary', () => {
    renderEditor({
      trip: makeWorkspace({
        destinations: [{ id: 'destination-primary', name: 'Bali', country: 'Indonesia' }],
      }),
    });
    expect(screen.getByText('Attach an itinerary to use AI planning suggestions.')).toBeTruthy();
    expect(screen.queryByLabelText('AI planning instruction')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate suggestion' })).toBeNull();
  });

  it('disables suggestion inputs while saving', () => {
    renderEditor({ trip: workspaceWithItinerary(), saveState: { status: 'saving' } });
    expect(screen.getByLabelText('AI planning instruction')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeDisabled();
  });

  it('disables suggestion inputs while an unrelated action is in flight', () => {
    renderEditor({ trip: workspaceWithItinerary(), disabled: true });
    expect(screen.getByLabelText('AI planning instruction')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeDisabled();
  });

  it('disables Apply suggestion while a save is in flight', () => {
    renderEditor({
      trip: workspaceWithItinerary(),
      saveState: { status: 'saving' },
      aiState: {
        status: 'ready',
        tripId: TRIP_ID,
        proposal: TEST_PROPOSAL,
        previousDraft: null,
        applied: false,
      },
    });
    expect(screen.getByRole('button', { name: 'Apply suggestion' })).toBeDisabled();
  });
});

describe('PlanningEditor STEP 18 checklist section', () => {
  const taskWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
        budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
        tasks: [
          {
            id: 'tsk-1',
            category: 'document-preparation',
            title: 'Apply for e-visa',
            status: 'in_progress',
            dueDate: '2026-09-20',
          },
        ],
      }),
    });

  it('renders the checklist section read-only with neutral task details and an Edit affordance', () => {
    renderEditor({ trip: taskWorkspace() });

    expect(screen.getByText('Checklist')).toBeTruthy();
    expect(
      screen.getByText('Your own preparation tasks — full control, never autopilot.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Task title 1')).toHaveValue('Apply for e-visa');
    expect(screen.getByLabelText('Task status 1')).toHaveValue('in_progress');
    expect(screen.getByLabelText('Task category 1')).toHaveValue('document-preparation');
    expect(screen.getByLabelText('Task due date 1')).toHaveValue('2026-09-20');
    expect(screen.getByLabelText('Task title 1')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.queryByText(/verified|reservation confirmed|ticket issued/)).toBeNull();
  });

  it('shows an empty state and never claims a booking or external verification', () => {
    renderEditor({ trip: planWorkspace() });
    expect(screen.getByText('Checklist')).toBeTruthy();
    expect(
      screen.getByText('No tasks yet. Add one to track an execution-preparation step.')
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('requires the Edit affordance before task edits capture into the draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });

    const title = screen.getByLabelText('Task title 1');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    expect(title).toBeEnabled();

    await user.clear(title);
    await user.type(title, 'Renew passport');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].tasks).toEqual([
      {
        id: 'tsk-1',
        category: 'document-preparation',
        title: 'Renew passport',
        status: 'in_progress',
        dueDate: '2026-09-20',
      },
    ]);
  });

  it('adds a task with a local id, default category, and pending status', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText('Task title 2'), 'Book airport transfer');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    const added = captured[0].tasks?.[1];
    expect(captured[0].tasks).toHaveLength(2);
    expect(added?.id.startsWith('tsk-')).toBe(true);
    expect(added?.category).toBe('general');
    expect(added?.status).toBe('pending');
    expect(added?.title).toBe('Book airport transfer');
  });

  it('captures a changed status, category, and due date', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.selectOptions(screen.getByLabelText('Task status 1'), 'completed');
    await user.selectOptions(screen.getByLabelText('Task category 1'), 'budget-preparation');
    await user.clear(screen.getByLabelText('Task due date 1'));
    await user.type(screen.getByLabelText('Task due date 1'), '2026-09-25');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].tasks?.[0].status).toBe('completed');
    expect(captured[0].tasks?.[0].category).toBe('budget-preparation');
    expect(captured[0].tasks?.[0].dueDate).toBe('2026-09-25');
  });

  it('removes an existing task from the draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].tasks).toEqual([]);
  });

  it('blocks saving an untitled task with a clear problem message', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: taskWorkspace() });

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(
      /category, a title, and a valid due date/
    );

    await user.type(screen.getByLabelText('Task title 2'), 'Packing list');
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
  });

  it('Cancel reverts task edits and closes editing without saving', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });

    const title = screen.getByLabelText('Task title 1');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.clear(title);
    await user.type(title, 'Wrong title');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Task title 1')).toHaveValue('Apply for e-visa');
    expect(screen.getByLabelText('Task title 1')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(captured).toHaveLength(0);
  });

  it('disables task inputs while saving', () => {
    renderEditor({ trip: taskWorkspace(), saveState: { status: 'saving' } });
    expect(screen.getByLabelText('Task title 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
  });

  it('mentions the preparation checklist in the no-itinerary empty state', () => {
    renderEditor({
      trip: makeWorkspace({
        destinations: [{ id: 'destination-primary', name: 'Bali', country: 'Indonesia' }],
      }),
    });
    expect(screen.getByText(/preparation checklist/)).toBeTruthy();
  });
});

describe('PlanningEditor STEP 26 primary selection', () => {
  const primaryWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
          { id: 'trp-3', mode: 'Bus', lifecycleState: 'needs-review' },
          { id: 'trp-4', mode: 'Ferry', lifecycleState: 'archived' },
        ],
        accommodationPlans: [
          { id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' },
          { id: 'acp-2', name: 'Old Resort', lifecycleState: 'replaced' },
        ],
      }),
    });

  it('shows "No primary selected" when no selection is persisted', () => {
    renderEditor({ trip: primaryWorkspace() });
    expect(screen.getByLabelText('Primary transport plan selection status')).toHaveTextContent(
      'No primary selected'
    );
    expect(screen.getByLabelText('Primary accommodation plan selection status')).toHaveTextContent(
      'No primary selected'
    );
  });

  it('lists only eligible active plans in the select (needs-review and archived excluded)', async () => {
    renderEditor({ trip: primaryWorkspace() });
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const select = screen.getByLabelText('Primary transport plan reference');
    const options = Array.from(select.querySelectorAll('option')).map((opt) => opt.textContent);

    expect(options).toContain('No primary selected');
    expect(options).toContainEqual(expect.stringContaining('Flight'));
    expect(options).toContainEqual(expect.stringContaining('Train'));
    expect(options).not.toContainEqual(expect.stringContaining('Bus'));
    expect(options).not.toContainEqual(expect.stringContaining('Ferry'));
  });

  it('selecting a plan stages it in the draft and saves it', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: primaryWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    const select = screen.getByLabelText('Primary transport plan reference');
    await user.selectOptions(select, 'trp-1');
    expect(screen.getByText('Primary selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
  });

  it('clearing the selection stages null', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    expect(screen.getByText('Primary selected')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const select = screen.getByLabelText('Primary transport plan reference');
    await user.selectOptions(select, '');
    expect(screen.getByLabelText('Primary transport plan selection status')).toHaveTextContent(
      'No primary selected'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBeNull();
  });

  it('does not auto-select when entering edit mode (local draft only)', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: primaryWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    // Make an unrelated edit to dirty the draft without touching primary
    await user.type(screen.getByLabelText('Planning notes'), 'Note');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
  });

  it('disables the primary select while inputs are disabled (in-flight save)', () => {
    renderEditor({ trip: primaryWorkspace(), disabled: true });
    const select = screen.getByLabelText('Primary transport plan reference');
    expect(select).toBeDisabled();
  });

  it('shows "Primary selected" for a persisted valid selection', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByText('Primary selected')).toBeInTheDocument();
  });

  it('shows attention state for a persisted selection referencing a missing plan', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByText('Primary assignment needs attention')).toBeInTheDocument();
  });

  it('shows attention state for a persisted selection referencing an inactive plan', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByLabelText('Primary transport plan selection status')).toHaveTextContent(
      'Primary assignment needs attention'
    );
  });

  it('shows attention state for a needs-review selection', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'needs-review' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByLabelText('Primary transport plan selection status')).toHaveTextContent(
      'Primary assignment needs attention'
    );
  });

  it('omits the primary select when the section has no plans', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({ transportPlans: [] }),
    });
    renderEditor({ trip: workspace });
    expect(screen.queryByLabelText('Primary transport plan reference')).not.toBeInTheDocument();
  });

  it('a primary selection never serializes plan readiness, provenance, or lifecycle', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'imported' },
            readiness: { state: 'planned' },
          },
        ],
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    // Only the primary key is staged; the untouched plan records are not reserialized.
    expect(captured[0]).not.toHaveProperty('transportPlans');
    expect(captured[0]).not.toHaveProperty('accommodationPlans');
    expect(captured[0]).not.toHaveProperty('budgetPlan');
    expect(captured[0]).not.toHaveProperty('tasks');
  });
});

describe('PlanningEditor STEP 27 primary reference lifecycle integrity', () => {
  it('marks the selected-valid plan card with the green Primary reference chip', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByLabelText('Transport primary reference 1')).toHaveTextContent(
      'Primary reference'
    );
    expect(screen.queryByLabelText('Transport primary reference 2')).not.toBeInTheDocument();
  });

  it('never shows the valid chip for a referenced-but-inactive plan; shows the amber attention chip instead', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.queryByLabelText('Transport primary reference 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transport primary attention 1')).toHaveTextContent(
      'Primary assignment needs attention'
    );
  });

  it('shows the amber attention chip and honest guidance for inactive transport and accommodation selections', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'replaced' }],
        primaryTransportPlanId: 'trp-1',
        primaryAccommodationPlanId: 'acp-1',
      }),
    });
    renderEditor({ trip: workspace });
    expect(screen.getByLabelText('Transport primary attention 1')).toHaveTextContent(
      'Primary assignment needs attention'
    );
    expect(screen.getByLabelText('Accommodation primary attention 1')).toHaveTextContent(
      'Primary assignment needs attention'
    );
    expect(screen.getByLabelText('Primary transport plan assignment guidance')).toHaveTextContent(
      'Restore this plan to Active'
    );
    expect(
      screen.getByLabelText('Primary accommodation plan assignment guidance')
    ).toHaveTextContent('Restore this plan to Active');
  });

  it('shows honest guidance (not an availability claim) for a missing selection', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    const guidance = screen.getByLabelText('Primary transport plan assignment guidance');
    expect(guidance).toHaveTextContent('no longer present in this section');
    expect(guidance).toHaveTextContent('Choose an active reference');
  });

  it('shows the disclaimer legend that Primary is a planning designation, not a booking', () => {
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({ transportPlans: [{ id: 'trp-1', mode: 'Flight' }] }),
    });
    renderEditor({ trip: workspace });
    expect(
      screen.getAllByText(/planning designation, not a booking/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('warns during a lifecycle edit that moving the selected primary away from Active leaves it unresolved', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByLabelText('Transport plan 1 primary lifecycle hint')).toHaveTextContent(
      'Moving the primary reference away from Active'
    );
  });

  it('offers a restore hint when the referenced-but-inactive plan can be reactivated', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByLabelText('Transport plan 1 primary lifecycle hint')).toHaveTextContent(
      'Restoring this plan to Active resolves the primary assignment.'
    );
  });

  it('archiving the selected primary plan stages only the lifecycle and never clears the stored id', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Archive Transport plan 1' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('archived');
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
  });

  it('reactivating the referenced inactive plan stages active and keeps the stored primary untouched', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('active');
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
  });
});

describe('PlanningEditor STEP 28 explicit primary-resolution semantics', () => {
  const conflictWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-missing',
      }),
    });

  it('shows "remains unresolved" for a conflict and never before an explicit action', () => {
    renderEditor({ trip: conflictWorkspace() });
    const feedback = screen.getByLabelText('Transport primary resolution feedback');
    expect(feedback).toHaveTextContent('Primary assignment remains unresolved.');
    expect(screen.queryByText('Primary reference updated in this draft.')).not.toBeInTheDocument();
  });

  it('selecting another active plan resolves the conflict and shows explicit feedback', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: conflictWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary reference updated in this draft.'
    );
    expect(screen.queryByText('Primary assignment remains unresolved.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-2');
  });

  it('clearing the primary on a conflict shows the cleared feedback and stages null', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: conflictWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), '');
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary assignment cleared in this draft.'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBeNull();
  });

  it('restoring the selected inactive plan shows the restore feedback and preserves the stored id', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Existing primary reference restored to active in this draft.'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('active');
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
  });

  it('only the relevant primary key is staged; no unrelated fields change', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: conflictWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    expect(captured[0]).not.toHaveProperty('transportPlans');
    expect(captured[0]).not.toHaveProperty('accommodationPlans');
    expect(captured[0]).not.toHaveProperty('notes');
    expect(captured[0]).not.toHaveProperty('primaryAccommodationPlanId');
  });

  it('a re-selection of the already-valid primary shows no resolution feedback', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    expect(
      screen.queryByLabelText('Transport primary resolution feedback')
    ).not.toBeInTheDocument();
  });

  it('re-creating the conflict clears a stale explicit resolution and shows unresolved again', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        primaryTransportPlanId: 'trp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary reference updated in this draft.'
    );
    await user.click(screen.getByRole('button', { name: 'Archive Transport plan 1' }));
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary assignment remains unresolved.'
    );
  });

  it('lifecycle and provenance controls remain available after a resolution', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active', provenance: { kind: 'manual' } },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Existing primary reference restored to active in this draft.'
    );
    expect(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' })).toBeEnabled();
    expect(screen.getAllByText('Manual reference')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Archive Transport plan 2' })).toBeEnabled();
  });

  it('accommodation section shows the same clear-feedback semantics', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
        primaryAccommodationPlanId: 'acp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.selectOptions(
      screen.getByLabelText('Primary accommodation plan reference'),
      'acp-1'
    );
    expect(screen.getByLabelText('Accommodation primary resolution feedback')).toHaveTextContent(
      'Primary reference updated in this draft.'
    );
  });
});

describe('PlanningEditor STEP 29 reference change context', () => {
  const step29Workspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
      }),
    });

  it('shows no change-context line on a clean render without a draft', () => {
    renderEditor({ trip: step29Workspace() });
    expect(screen.queryByLabelText('Transport planning changes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Accommodation planning changes')).not.toBeInTheDocument();
  });

  it('a fresh primary selection reports "selected" in the transport change line', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Primary reference selected in this draft.'
    );
    expect(screen.queryByLabelText('Accommodation planning changes')).not.toBeInTheDocument();
  });

  it('changing the primary reference reports the previous and current labels', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Primary reference changed from "Flight" to "Train" in this draft.'
    );
  });

  it('resolving a missing reference reports the changed labels alongside the updated feedback', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Primary reference changed from "trp-missing" to "Train" in this draft.'
    );
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary reference updated in this draft.'
    );
  });

  it('clearing the primary on a conflict shows exactly one cleared message (change context deduped)', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight' },
          { id: 'trp-2', mode: 'Train' },
        ],
        primaryTransportPlanId: 'trp-missing',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), '');
    expect(screen.getAllByText('Primary assignment cleared in this draft.')).toHaveLength(1);
    expect(screen.queryByLabelText('Transport planning changes')).not.toBeInTheDocument();
  });

  it('restoring the selected inactive plan shows the change line alongside the restore feedback', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    const changeLine = screen.getByLabelText('Transport planning changes');
    expect(changeLine).toHaveTextContent(
      'Existing primary reference restored to active in this draft.'
    );
    expect(changeLine).toHaveTextContent(
      'Planning reference lifecycle changed from "Archived" to "Active" in this draft.'
    );
    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Existing primary reference restored to active in this draft.'
    );
  });

  it('a lifecycle change on a non-primary plan reports the lifecycle labels', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Archive Transport plan 1' }));
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Planning reference lifecycle changed from "Active" to "Archived" in this draft.'
    );
  });

  it('a provenance kind change reports the honest provenance labels', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported from simulated discovery.' },
          },
        ],
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(
      screen.getByRole('button', { name: 'Mark transport plan 1 as manually entered' })
    );
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Planning reference provenance changed from "Simulated discovery" to "Manual reference" in this draft.'
    );
  });

  it('adding a transport plan reports the reference-added descriptor', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Add transport plan' }));
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'A planning reference was added in this draft.'
    );
  });

  it('removing a transport plan reports the reference-removed descriptor', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Remove transport plan 1' }));
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'A planning reference was removed in this draft.'
    );
  });

  it('a source URL edit reports the source-changed descriptor', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', sourceUrl: 'https://example.com/original' },
        ],
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(screen.getByLabelText('Transport source URL 1'), 'https://example.com/updated');
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'Planning reference source URL changed in this draft.'
    );
  });

  it('accommodation changes are reported independently of transport', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Remove accommodation plan 1' }));
    expect(screen.getByLabelText('Accommodation planning changes')).toHaveTextContent(
      'A planning reference was removed in this draft.'
    );
    expect(screen.queryByLabelText('Transport planning changes')).not.toBeInTheDocument();
  });

  it('Cancel reverts an added transport reference and clears the change line', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: step29Workspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Add transport plan' }));
    expect(screen.getByLabelText('Transport planning changes')).toHaveTextContent(
      'A planning reference was added in this draft.'
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Transport planning changes')).not.toBeInTheDocument();
  });
});

describe('PlanningEditor STEP 30 save review and confirmation', () => {
  const primaryWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
          { id: 'trp-3', mode: 'Bus', lifecycleState: 'needs-review' },
          { id: 'trp-4', mode: 'Ferry', lifecycleState: 'archived' },
        ],
        accommodationPlans: [
          { id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' },
          { id: 'acp-2', name: 'Old Resort', lifecycleState: 'replaced' },
        ],
      }),
    });

  const taskWorkspace = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel' }],
        budgetPlan: { currency: 'USD', totalPlanned: 1200, allocations: { food: 300 } },
        tasks: [
          {
            id: 'tsk-1',
            category: 'document-preparation',
            title: 'Apply for e-visa',
            status: 'in_progress',
            dueDate: '2026-09-20',
          },
        ],
      }),
    });

  const reviewGroup = () => screen.getByRole('group', { name: 'Review changes before saving' });

  it('clean drafts and ordinary field edits never show the review panel, even after a save', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });

    expect(screen.queryByRole('group', { name: 'Review changes before saving' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review changes before saving' })).toBeNull();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport mode 1'), { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].mode).toBe('Train');
    expect(screen.queryByRole('group', { name: 'Review changes before saving' })).toBeNull();
  });

  it('a primary selection pauses the save, disables the main button, and confirms exactly once', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: primaryWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(captured).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
  });

  it('Keep editing closes the review and preserves the unsaved draft, which re-opens on the next save', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: primaryWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('group', { name: 'Review changes before saving' })).toBeNull();
    expect(captured).toHaveLength(0);
    expect(screen.getByLabelText('Primary transport plan reference')).toHaveValue('trp-2');

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-2');
  });

  it('the confirm payload is exactly what the direct save path would carry', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport mode 1'), { target: { value: 'Train' } });
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0]).toEqual({
      id: 'trp-1',
      mode: 'Train',
    });
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
  });

  it('lists transport items before accommodation items with honest wording and no booking claims', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'active' }],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'archived' }],
      }),
    });
    renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Restore Accommodation plan 1' }));
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Lifecycle for “Flight”');
    expect(items[0]).toHaveTextContent('“Active” to “Needs review”');
    expect(items[1]).toHaveTextContent('Lifecycle for “Padi Hotel”');
    expect(items[1]).toHaveTextContent('“Archived” to “Active”');
    expect(within(reviewGroup()).getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
    expect(
      within(reviewGroup()).getByRole('heading', { name: 'Accommodation' })
    ).toBeInTheDocument();
    expect(reviewGroup()).not.toHaveTextContent(/booking|booked|confirmed|verified|reservation/);
  });

  it('restoring an archived primary lists the restore ahead of its lifecycle change', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'archived' }],
        primaryAccommodationPlanId: 'acp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Restore Accommodation plan 1' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Primary reference');
    expect(items[0]).toHaveTextContent('will be restored to Active');
    expect(items[1]).toHaveTextContent('Lifecycle for “Padi Hotel”');
    expect(items[1]).toHaveTextContent('“Archived” to “Active”');
    expect(
      within(reviewGroup()).getByRole('heading', { name: 'Accommodation' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].accommodationPlans?.[0].lifecycleState).toBe('active');
  });

  it('clearing a persisted primary lists a cleared item and stages null on confirmation', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'active' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), '');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('Primary reference will be cleared.');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBeNull();
  });

  it('an unresolved conflict demands review even when the only change is unrelated, and never auto-repairs', async () => {
    const user = userEvent.setup();
    const workspace = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderEditor({ trip: workspace });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Transport mode 1'), { target: { value: 'Train' } });
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent(
      'Primary reference is unresolved and will remain unresolved if saved.'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].mode).toBe('Train');
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
  });

  it('a lifecycle move off Active lists a change that names both values and confirms it', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('Lifecycle for “Flight”');
    expect(reviewGroup()).toHaveTextContent('“Active” to “Needs review”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0].lifecycleState).toBe('needs-review');
  });

  it('a provenance re-label on a persisted plan lists a change and confirms the new kind', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            provenance: { kind: 'mock-discovery', note: 'Imported.' },
          },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(
      screen.getByRole('button', { name: 'Mark transport plan 1 as manually entered' })
    );
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('Provenance for “Flight”');
    expect(reviewGroup()).toHaveTextContent('“Simulated discovery” to “Manual reference”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0].provenance).toEqual({ kind: 'manual' });
  });

  it('a source URL edit on a persisted plan lists a change and confirms the new URL', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', sourceUrl: 'https://example.com/original' },
        ],
      }),
    });
    const { captured } = renderEditor({ trip });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(screen.getByLabelText('Transport source URL 1'), 'https://example.com/updated');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('Source URL for “Flight”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured[0].transportPlans?.[0].sourceUrl).toBe('https://example.com/updated');
  });

  it('the review panel auto-closes when the underlying change is reverted', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: planWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('group', { name: 'Review changes before saving' })
    ).not.toBeInTheDocument();
    expect(captured).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('opens with keyboard focus on the heading and stays inside one labelled group with no duplicate status', async () => {
    const user = userEvent.setup();
    renderEditor({ trip: primaryWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const heading = screen.getByRole('heading', { name: 'Review changes before saving' });
    expect(heading).toHaveFocus();
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getAllByRole('group', { name: 'Review changes before saving' })).toHaveLength(1);
    expect(within(reviewGroup()).queryAllByRole('status')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled();
  });

  it('dates, destinations, notes, budget, and task edits bypass the review entirely', async () => {
    const user = userEvent.setup();
    const { captured } = renderEditor({ trip: taskWorkspace() });
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    await user.clear(screen.getByLabelText('Budget total planned'));
    await user.type(screen.getByLabelText('Budget total planned'), '1500');
    await user.type(screen.getByLabelText('Planning notes'), 'Great trip');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    await user.type(screen.getByLabelText('Task title 1'), ' refreshed');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(screen.queryByRole('group', { name: 'Review changes before saving' })).toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('primaryTransportPlanId');
    expect(captured[0]).not.toHaveProperty('primaryAccommodationPlanId');
    expect(captured[0]).not.toHaveProperty('transportPlans');
    expect(captured[0]).not.toHaveProperty('accommodationPlans');
  });
});

/* STEP 31/32 shared harness and review baselines (module scope so both
   describes reuse the page-contract save flow). */
const noPrimaryBaseline = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    itinerary: makeSnapshot({
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
        { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
      ],
    }),
  });

/** Persisted primary trp-1 plus a second active candidate. */
const persistedPrimaryBaseline = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    itinerary: makeSnapshot({
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
        { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
      ],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
      primaryTransportPlanId: 'trp-1',
    }),
  });

/** Archived accommodation primary that can be restored (STEP 24/27). */
const restoreBaseline = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    itinerary: makeSnapshot({
      transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'active' }],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'archived' }],
      primaryAccommodationPlanId: 'acp-1',
    }),
  });

const reviewGroup = () => screen.getByRole('group', { name: 'Review changes before saving' });

/**
 * Models the page contract: onSave pushes the exact draft and immediately
 * flips saveState to 'saving'; the test then resolves success (idle +
 * draft cleared) or failure (error + draft kept) or swaps in a new persisted
 * baseline. Everything else mirrors the real TripWorkspacePage flow.
 */
function renderSaveIntegrityEditor(initialTrip: TripWorkspace): {
  captured: PlanningDraft[];
  completeSaveSuccess: () => void;
  completeSaveFailure: () => void;
  rerenderTrip: (trip: TripWorkspace) => void;
} {
  const api: {
    captured: PlanningDraft[];
    completeSaveSuccess: () => void;
    completeSaveFailure: () => void;
    rerenderTrip: (trip: TripWorkspace) => void;
  } = {
    captured: [],
    completeSaveSuccess: () => undefined,
    completeSaveFailure: () => undefined,
    rerenderTrip: () => undefined,
  };
  function Harness({ trip }: { trip: TripWorkspace }) {
    const [draft, setDraft] = useState<PlanningDraft | null>(null);
    const [saveState, setSaveState] = useState<PlanningSaveState>({ status: 'idle' });
    api.completeSaveSuccess = () => {
      setSaveState({ status: 'idle' });
      setDraft(null);
    };
    api.completeSaveFailure = () => {
      setSaveState({ status: 'error' });
    };
    return (
      <PlanningEditor
        trip={trip}
        draft={draft}
        onChange={setDraft}
        onSave={(saved) => {
          api.captured.push(saved);
          setSaveState({ status: 'saving' });
        }}
        saveState={saveState}
        disabled={false}
        aiState={{ status: 'idle' }}
        onGenerateSuggestion={() => undefined}
        onApplySuggestion={() => undefined}
        onDiscardSuggestion={() => undefined}
      />
    );
  }
  const rendered = render(<Harness trip={initialTrip} />);
  api.rerenderTrip = (nextTrip: TripWorkspace) => rendered.rerender(<Harness trip={nextTrip} />);
  return api;
}

describe('PlanningEditor STEP 31 save-state integrity', () => {
  it('keeps the review pinned to the live draft and confirms the exact latest draft', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent(
      'will be set to “Train”'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].tripId).toBe(TRIP_ID);
    expect(captured[0].primaryTransportPlanId).toBe('trp-2');
    expect(captured[0]).not.toHaveProperty('transportPlans');
  });

  it('collapses a primary A→B→C sequence into one final A→C review entry', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
          { id: 'trp-3', mode: 'Bus', lifecycleState: 'active' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured } = renderSaveIntegrityEditor(trip);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-3');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('will change from “Flight” to “Bus”');
    expect(items[0]).not.toHaveTextContent('Train');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-3');
  });

  it('re-derives a cleared primary inside an open review and confirms the clear', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent(
      'will change from “Flight” to “Train”'
    );

    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), '');
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent('will be cleared.');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBeNull();
  });

  it('adds a restore that happens while the review is open, live', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(restoreBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    const initialItems = within(reviewGroup()).getAllByRole('listitem');
    expect(initialItems).toHaveLength(2);
    expect(initialItems[0]).toHaveTextContent('Primary reference will be set to “Flight”');
    expect(initialItems[1]).toHaveTextContent('is unresolved and will remain unresolved if saved');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Restore Accommodation plan 1' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Primary reference will be set to “Flight”');
    expect(items[1]).toHaveTextContent('Primary reference');
    expect(items[1]).toHaveTextContent('will be restored to Active');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].accommodationPlans?.[0].lifecycleState).toBe('active');
  });

  it('reflects a lifecycle move made while the review is open and confirms it', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('Lifecycle for “Train”');
    expect(items[1]).toHaveTextContent('“Active” to “Needs review”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    expect(captured[0].transportPlans?.[1].lifecycleState).toBe('needs-review');
  });

  it('closes the review the moment the draft stops containing the meaningful change', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    expect(
      screen.queryByRole('group', { name: 'Review changes before saving' })
    ).not.toBeInTheDocument();
    expect(captured).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('confirms once, keeps the review visible while saving, and clears it on success', async () => {
    const user = userEvent.setup();
    const { captured, completeSaveSuccess } = renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(reviewGroup()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(captured).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  });

  it('blocks a repeated confirmation and the original Save while the save is in flight', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
  });

  it('keyboard activation of the confirm submits once, and a second keystroke while saving is inert', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await user.tab();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toHaveFocus();
    await user.keyboard('{Enter}{Enter}');

    expect(captured).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeDisabled();
  });

  it('preserves the draft, baseline, error, and review after a failed save, then allows a retry', async () => {
    const user = userEvent.setup();
    const { captured, completeSaveFailure } = renderSaveIntegrityEditor(planWorkspace());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport mode 1'));
    await user.type(screen.getByLabelText('Transport mode 1'), 'Train');
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(reviewGroup()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);

    completeSaveFailure();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your planning changes.'
    );
    expect(screen.getByLabelText('Transport mode 1')).toHaveValue('Train');
    expect(screen.getByLabelText('Primary transport plan reference')).toHaveValue('trp-1');
    expect(reviewGroup()).toBeInTheDocument();
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/saved successfully|changes were saved|Saved\./i)).toBeNull();
    // The review stays open after a failure, so the main Save stays behind the
    // open panel; the retry path is the (now re-enabled) confirmation button.
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(2);
    expect(captured[1].primaryTransportPlanId).toBe('trp-1');
  });

  it('computes a fresh review against the new saved baseline after a successful save', async () => {
    const user = userEvent.setup();
    const trip = planWorkspace();
    const saved = makeWorkspace({
      dateRange: trip.dateRange,
      destinations: trip.destinations,
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    const { captured, completeSaveSuccess, rerenderTrip } = renderSaveIntegrityEditor(trip);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent(
      'will be set to “Flight”'
    );
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);

    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );

    rerenderTrip(saved);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('will change from “Flight” to “Train”');
    expect(items[0]).not.toHaveTextContent('will be set to');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(2);
    expect(captured[1].primaryTransportPlanId).toBe('trp-2');
  });

  it('keeps STEP 28 resolution feedback beside the review without duplication and unique save names', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'archived' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    renderSaveIntegrityEditor(trip);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(screen.getByLabelText('Transport primary resolution feedback')).toHaveTextContent(
      'Primary reference updated in this draft.'
    );
    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('will change from “Flight” to “Train”');
    expect(reviewGroup()).not.toHaveTextContent('Primary reference updated in this draft.');

    expect(screen.getAllByRole('button', { name: /^Save planning/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeEnabled();
  });
});

describe('PlanningEditor STEP 32 review accessibility and interaction hardening', () => {
  it('associates the review group with its heading via aria-labelledby and keeps the panel free of live-region roles', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const group = reviewGroup();
    const heading = screen.getByRole('heading', { name: 'Review changes before saving' });
    expect(group).toHaveAccessibleName('Review changes before saving');
    expect(group).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading.id).toBeTruthy();
    expect(group.getAttribute('aria-label')).toBeNull();
    expect(within(group).queryAllByRole('status')).toHaveLength(0);
    expect(within(group).queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the page Save, review Save, and Keep editing names unique and unambiguous', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(screen.getAllByRole('button', { name: 'Save planning' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Save planning changes' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Keep editing' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Save planning/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled();
  });

  it('Keep editing returns focus to the Save control the review was opened from without saving', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(screen.getByRole('heading', { name: 'Review changes before saving' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(
      screen.queryByRole('group', { name: 'Review changes before saving' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toHaveFocus();
    expect(captured).toHaveLength(0);
    expect(screen.getByLabelText('Primary transport plan reference')).toHaveValue('trp-2');
  });

  it('a draft change behind the open review never steals focus back to the heading', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    const heading = screen.getByRole('heading', { name: 'Review changes before saving' });
    expect(heading).toHaveFocus();
    expect(reviewGroup()).toHaveTextContent('will be set to “Flight”');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toHaveFocus();

    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');

    expect(heading).not.toHaveFocus();
    expect(screen.getByLabelText('Primary transport plan reference')).toHaveFocus();
    expect(reviewGroup()).not.toHaveTextContent('“Flight”');
    expect(reviewGroup()).toHaveTextContent('will be set to “Train”');
  });

  it('confirming keeps focus on the disabled confirmation while the save is in flight', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured).toHaveLength(1);
    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Review changes before saving' })).not.toHaveFocus();
    expect(reviewGroup()).toBeInTheDocument();
  });

  it('leaves the user on the re-enabled confirmation inside the intact review after a failed save', async () => {
    const user = userEvent.setup();
    const { completeSaveFailure } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    completeSaveFailure();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your planning changes.'
    );
    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    expect(reviewGroup()).toBeInTheDocument();
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/saved successfully|changes were saved|Saved\./i)).toBeNull();
  });

  it('relocates focus off the removed review to the first section action after a successful save', async () => {
    const user = userEvent.setup();
    const { completeSaveSuccess } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    completeSaveSuccess();

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('heading', { name: 'Review changes before saving' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toHaveFocus();
  });

  it('reopens a fresh review with fresh content and heading focus after a successful save', async () => {
    const user = userEvent.setup();
    const { completeSaveSuccess } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('will change from “Flight” to “Train”');
    expect(screen.getByRole('heading', { name: 'Review changes before saving' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeEnabled();
  });

  it('labels exactly one unambiguous control while saving and disables every submit path', async () => {
    const user = userEvent.setup();
    const { captured } = renderSaveIntegrityEditor(persistedPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(captured).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Saving…' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save planning changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save planning' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// STEP 33 component-level transition matrix (A–J coverage)
// ---------------------------------------------------------------------------

describe('PlanningEditor STEP 33 component-level regression matrix', () => {
  it('round-trips a primary plan through select → confirm → save → lifecycle → restore across two saved baselines', async () => {
    const user = userEvent.setup();
    const { captured, completeSaveSuccess, rerenderTrip } =
      renderSaveIntegrityEditor(noPrimaryBaseline());

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent(
      'will be set to “Flight”'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );

    const withPrimary = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    rerenderTrip(withPrimary);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    const lifecycleItems = within(reviewGroup()).getAllByRole('listitem');
    expect(lifecycleItems).toHaveLength(2);
    expect(lifecycleItems[0]).toHaveTextContent('will remain unresolved if saved');
    expect(lifecycleItems[1]).toHaveTextContent('“Active” to “Needs review”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(2);
    expect(captured[1].transportPlans?.[0].lifecycleState).toBe('needs-review');
    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );

    const withNeedsReview = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'needs-review' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    rerenderTrip(withNeedsReview);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 as active' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    const restoreItems = within(reviewGroup()).getAllByRole('listitem');
    expect(restoreItems[0]).toHaveTextContent('Primary reference');
    expect(restoreItems[0]).toHaveTextContent('will be restored to Active');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(3);
    expect(captured[2].transportPlans?.[0].lifecycleState).toBe('active');
    expect(captured[2]).not.toHaveProperty('primaryTransportPlanId');
  }, 20000);

  it('combines a source URL edit and a primary selection in one draft — both listed as separate transport items', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: 'Flight',
            sourceUrl: 'https://old.example.com',
            lifecycleState: 'active',
          },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
      }),
    });
    const { captured } = renderSaveIntegrityEditor(trip);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(screen.getByLabelText('Transport source URL 1'), 'https://new.example.com');
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('will be set to “Flight”');
    expect(items[1]).toHaveTextContent('Source URL for “Flight”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    expect(captured[0].transportPlans?.[0].sourceUrl).toBe('https://new.example.com');
  });

  it('a transport primary selection and an accommodation lifecycle move in one draft yield two sections with correct ordering', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
      }),
    });
    const { captured } = renderSaveIntegrityEditor(trip);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Primary reference will be set to “Flight”.');
    expect(items[1]).toHaveTextContent('Lifecycle for “Padi Hotel”');
    expect(items[1]).toHaveTextContent('“Active” to “Needs review”');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].primaryTransportPlanId).toBe('trp-1');
    expect(captured[0].accommodationPlans?.[0].lifecycleState).toBe('needs-review');
  });

  it('after a successful primary save, a new source URL edit in the next session opens a fresh source-only review', async () => {
    const user = userEvent.setup();
    const { captured, completeSaveSuccess, rerenderTrip } =
      renderSaveIntegrityEditor(noPrimaryBaseline());

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    completeSaveSuccess();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );

    const savedAfterPrimary = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [{ id: 'trp-1', mode: 'Flight', lifecycleState: 'active' }],
        primaryTransportPlanId: 'trp-1',
      }),
    });
    rerenderTrip(savedAfterPrimary);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(screen.getByLabelText('Transport source URL 1'), 'https://new.example.com');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Source URL for “Flight”');
    expect(items[0]).not.toHaveTextContent('Primary');
    expect(items[0]).not.toHaveTextContent('primary');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(2);
    expect(captured[1].transportPlans?.[0].sourceUrl).toBe('https://new.example.com');
    expect(captured[1]).not.toHaveProperty('primaryTransportPlanId');
  });
});

describe('PlanningEditor STEP 34 review panel UX refinement', () => {
  it('heads the review with a short supporting sentence and groups items under named section headings', async () => {
    const user = userEvent.setup();
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
      }),
    });
    renderSaveIntegrityEditor(trip);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toHaveTextContent('You are in control.');
    expect(reviewGroup()).toHaveTextContent('Nothing is saved until you confirm');
    expect(within(reviewGroup()).getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
    expect(
      within(reviewGroup()).getByRole('heading', { name: 'Accommodation' })
    ).toBeInTheDocument();
    expect(
      within(reviewGroup()).getByRole('group', { name: 'Transport changes' })
    ).toBeInTheDocument();
    expect(
      within(reviewGroup()).getByRole('group', { name: 'Accommodation changes' })
    ).toBeInTheDocument();

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Lifecycle for “Train”');
    expect(items[1]).toHaveTextContent('Lifecycle for “Padi Hotel”');
  });

  it('badges unresolved and deactivation items with Needs attention text and guides unresolved ones', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('is unresolved and will remain unresolved if saved');
    expect(items[1]).toHaveTextContent('Lifecycle for “Flight”');
    expect(within(reviewGroup()).getAllByText('Needs attention')).toHaveLength(2);
    expect(reviewGroup()).toHaveTextContent('Select another active reference');
    expect(reviewGroup()).toHaveTextContent('or restore the plan to active');
  });

  it('keeps ordinary primary selections free of attention badges and guidance', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(within(reviewGroup()).queryAllByText('Needs attention')).toHaveLength(0);
    expect(within(reviewGroup()).queryByText('Select another active reference')).toBeNull();
    expect(within(reviewGroup()).getAllByRole('listitem')[0]).toHaveTextContent(
      'Primary reference will be set to “Flight”.'
    );
  });

  it('renders long plan labels in full, omits raw source URLs, and wraps text', async () => {
    const user = userEvent.setup();
    const longLabel = 'Flight from Jakarta to Denpasar via Makassar and Surabaya';
    const trip = makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          {
            id: 'trp-1',
            mode: longLabel,
            sourceUrl: 'https://old.example.com/path',
            lifecycleState: 'active',
          },
        ],
      }),
    });
    const { captured } = renderSaveIntegrityEditor(trip);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(
      screen.getByLabelText('Transport source URL 1'),
      'https://new.example.com/longer/path'
    );
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(`Source URL for “${longLabel}”`);
    expect(items[0]).not.toHaveTextContent('https://old.example.com');
    expect(items[0]).not.toHaveTextContent('https://new.example.com');
    expect(items[0]).toHaveStyle({ overflowWrap: 'anywhere' });

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    expect(captured).toHaveLength(1);
    expect(captured[0].transportPlans?.[0].sourceUrl).toBe('https://new.example.com/longer/path');
  });
});

// ---------------------------------------------------------------------------
// STEP 35 review-panel visual/interaction consistency + single-section behavior
// ---------------------------------------------------------------------------

describe('PlanningEditor STEP 35 review panel consistency', () => {
  const twoSectionTrip = () =>
    makeWorkspace({
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      itinerary: makeSnapshot({
        transportPlans: [
          { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
          { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
        ],
        accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
      }),
    });

  /** Locates a section frame by its title and returns its Edit/ Cancel toggle. */
  const findFrameToggle = (sectionTitle: string, toggleName: string) => {
    const column = screen.getByText(sectionTitle, { selector: 'p' }).closest('div') as HTMLElement;
    const headerRow = column.parentElement as HTMLElement;
    return within(headerRow).getByRole('button', { name: toggleName });
  };

  it('keeps heading levels stable and names section groups in predictable order', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(twoSectionTrip());

    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const headings = within(reviewGroup()).getAllByRole('heading');
    expect(headings.map((h) => h.tagName)).toEqual(['H3', 'H4', 'H4']);
    expect(headings.map((h) => h.textContent)).toEqual([
      'Review changes before saving',
      'Transport',
      'Accommodation',
    ]);
    expect(within(reviewGroup()).getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(within(reviewGroup()).getAllByRole('heading', { level: 4 })).toHaveLength(2);

    const groups = within(reviewGroup()).getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAccessibleName('Transport changes');
    expect(groups[1]).toHaveAccessibleName('Accommodation changes');

    expect(reviewGroup()).toHaveTextContent('You are in control.');
    expect(reviewGroup()).toHaveTextContent('Nothing is saved until you confirm');
  });

  it('styles section headings with the editor section-title recipe', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const heading = within(reviewGroup()).getByRole('heading', { name: 'Transport' });
    expect(heading).toHaveStyle({ textTransform: 'uppercase' });
    expect(heading).toHaveStyle({ letterSpacing: '0.05em' });
    expect(heading).toHaveStyle({ fontWeight: '800' });
  });

  it('omits the accommodation section entirely for a transport-only review', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toBeInTheDocument();
    expect(within(reviewGroup()).queryByRole('heading', { name: 'Accommodation' })).toBeNull();
    expect(
      within(reviewGroup()).queryByRole('group', { name: 'Accommodation changes' })
    ).toBeNull();
    expect(within(reviewGroup()).getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
    expect(within(reviewGroup()).getAllByRole('group')).toHaveLength(1);
    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('omits the transport section entirely for an accommodation-only review', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(twoSectionTrip());
    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(reviewGroup()).toBeInTheDocument();
    expect(within(reviewGroup()).queryByRole('heading', { name: 'Transport' })).toBeNull();
    expect(within(reviewGroup()).queryByRole('group', { name: 'Transport changes' })).toBeNull();
    const groups = within(reviewGroup()).getAllByRole('group');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName('Accommodation changes');
    expect(within(groups[0]).getAllByRole('listitem')[0]).toHaveTextContent(
      'Lifecycle for “Padi Hotel”'
    );
  });

  it('orders sections transport-first and keeps one- and multi-item groups intact', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(twoSectionTrip());

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const groups = within(reviewGroup()).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Transport changes',
      'Accommodation changes',
    ]);
    expect(within(groups[0]).getAllByRole('listitem')).toHaveLength(2);
    expect(within(groups[1]).getAllByRole('listitem')).toHaveLength(1);
  });

  it('drops the reverted section group while keeping the review open for the other section', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(twoSectionTrip());

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(within(reviewGroup()).getAllByRole('group')).toHaveLength(2);

    await user.click(findFrameToggle('Accommodation plans', 'Cancel'));

    expect(reviewGroup()).toBeInTheDocument();
    const groups = within(reviewGroup()).getAllByRole('group');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName('Transport changes');
    expect(within(groups[0]).getAllByRole('listitem')[0]).toHaveTextContent(
      'Lifecycle for “Train”'
    );
  });

  it('places the Needs attention marker and guidance inside the item they describe', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(reviewGroup()).getAllByText('Needs attention')).toHaveLength(2);

    const unresolved = items[0];
    const deactivation = items[1];
    expect(unresolved).toHaveTextContent('is unresolved and will remain unresolved if saved');
    expect(unresolved).toHaveTextContent('Needs attention');
    expect(unresolved).toHaveTextContent('Select another active reference');
    expect(unresolved).toHaveTextContent('or restore the plan to active');
    expect(deactivation).toHaveTextContent('Lifecycle for “Flight”');
    expect(deactivation).toHaveTextContent('Needs attention');
    expect(deactivation).not.toHaveTextContent('Select another active reference');
    expect(deactivation).not.toHaveTextContent('or restore the plan to active');
  });

  it('keeps the editor button variants on the confirm and keep-editing actions', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    const keepEditing = screen.getByRole('button', { name: 'Keep editing' });
    expect(confirm).toHaveClass('btn-primary');
    expect(keepEditing).toHaveClass('btn-secondary');
    expect(confirm).toBeEnabled();
    expect(keepEditing).toBeEnabled();

    const actionRow = confirm.parentElement as HTMLElement;
    expect(actionRow).toHaveStyle({ display: 'flex' });
    expect(actionRow).toHaveStyle({ flexWrap: 'wrap' });
  });

  it('applies the editor attention color family and card radius to the badge and panel', async () => {
    const user = userEvent.setup();
    renderSaveIntegrityEditor(noPrimaryBaseline());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const badge = within(reviewGroup()).getByText('Needs attention');
    expect(badge).toHaveStyle({ color: 'rgb(251, 191, 36)' });
    expect(badge).toHaveStyle({ backgroundColor: 'rgba(251, 191, 36, 0.12)' });
    expect(badge).toHaveStyle({ borderTopColor: 'rgba(251, 191, 36, 0.4)' });
    expect(badge).toHaveStyle({ textTransform: 'uppercase' });

    expect(reviewGroup()).toHaveStyle({ borderRadius: '14px' });
  });
});
