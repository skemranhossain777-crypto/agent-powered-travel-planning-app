import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripWorkspacePage } from '../components/trips/TripWorkspacePage';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { User } from '../types/travel';
import type { TripItinerarySnapshot, TripWorkspace } from '../types/trip';

const h = vi.hoisted(() => {
  class TripNotFoundError extends Error {
    constructor() {
      super('Trip not found.');
      this.name = 'TripNotFoundError';
    }
  }
  class TripPermissionError extends Error {
    constructor() {
      super('You do not have access to this trip.');
      this.name = 'TripPermissionError';
    }
  }
  class AiPlanningError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AiPlanningError';
    }
  }
  return {
    TripNotFoundError,
    TripPermissionError,
    tripService: {
      getTrip: vi.fn(),
      updateTrip: vi.fn(),
      renameTrip: vi.fn(),
      updateTripStatus: vi.fn(),
      deleteTrip: vi.fn(),
      updateTripPlanning: vi.fn(),
    },
    aiPlanning: {
      generateTripPlanningProposal: vi.fn(),
      AiPlanningError,
    },
    listeners: [] as Array<(user: unknown) => void>,
    state: { user: null as unknown },
  };
});

vi.mock('../services/tripService', () => ({
  tripService: h.tripService,
  TripNotFoundError: h.TripNotFoundError,
  TripPermissionError: h.TripPermissionError,
}));

vi.mock('../services/authService', () => ({
  authService: {
    get user() {
      return h.state.user;
    },
    subscribe: (cb: (user: unknown) => void) => {
      h.listeners.push(cb);
      if (h.state.user !== undefined) cb(h.state.user);
      return () => {
        const index = h.listeners.indexOf(cb);
        if (index >= 0) h.listeners.splice(index, 1);
      };
    },
  },
}));

vi.mock('../services/aiPlanningService', () => ({
  generateTripPlanningProposal: h.aiPlanning.generateTripPlanningProposal,
  AiPlanningError: h.aiPlanning.AiPlanningError,
}));

function makeUser(): User {
  return {
    id: 'user-1',
    username: 'Traveler',
    email: 'traveler@example.com',
    joinDate: '2026-01-01T00:00:00.000Z',
    provider: 'google',
    emailVerified: true,
    profile: {
      displayName: 'Traveler',
      email: 'traveler@example.com',
      interests: ['Culture & Heritage'],
      travelStyles: ['Couples'],
    },
  };
}

function makeWorkspace(overrides: Partial<TripWorkspace> = {}): TripWorkspace {
  return {
    ...createDraftTrip({
      ownerId: 'user-1',
      title: 'Island Escape',
      id: 'trip-abc',
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      now: '2026-09-10T08:00:00.000Z',
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

const reviewGroup = () => screen.getByRole('group', { name: 'Review changes before saving' });

/**
 * STEP 35/36 frame-scoped toggle: the review panel lives inside the editor's
 * editable section frames. The page also renders a read-only "Structured
 * planning" overview card (TripWorkspaceView) that repeats the very same frame
 * titles, so the title is disambiguated by selecting the one whose header row
 * directly owns an Edit/Cancel toggle rather than by button index or raw text.
 */
const findFrameToggle = (sectionTitle: string, toggleName: string) => {
  const frameTitles = screen
    .getAllByText(sectionTitle, { selector: 'p' })
    .map((node) => node as HTMLElement)
    .filter((node) => {
      const headerRow = node.parentElement?.parentElement ?? null;
      return (
        headerRow !== null &&
        within(headerRow).queryByRole('button', { name: /^(Edit|Cancel)$/ }) !== null
      );
    });
  expect(frameTitles).toHaveLength(1);
  const column = frameTitles[0].parentElement as HTMLElement;
  const headerRow = column.parentElement as HTMLElement;
  return within(headerRow).getByRole('button', { name: toggleName });
};

/** Two active transport plans, no persisted primary. */
const noPrimarySeed = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    itinerary: makeSnapshot({
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
        { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
      ],
    }),
  });

/** Persisted primary trp-1 plus a second active candidate (and one accommodation). */
const persistedPrimarySeed = () =>
  makeWorkspace({
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    itinerary: makeSnapshot({
      transportPlans: [
        { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
        { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
      ],
      accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
      primaryTransportPlanId: 'trp-1',
    }),
  });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trips/trip-abc']}>
      <Routes>
        <Route path="/trips/:tripId" element={<TripWorkspacePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  h.listeners.length = 0;
  h.state.user = null;
  h.tripService.getTrip.mockReset();
  h.tripService.getTrip.mockResolvedValue(makeWorkspace());
  h.tripService.updateTrip.mockReset();
  h.tripService.updateTrip.mockResolvedValue(makeWorkspace());
  h.tripService.renameTrip.mockReset();
  h.tripService.renameTrip.mockResolvedValue(makeWorkspace());
  h.tripService.updateTripStatus.mockReset();
  h.tripService.updateTripStatus.mockResolvedValue(makeWorkspace());
  h.tripService.deleteTrip.mockReset();
  h.tripService.deleteTrip.mockResolvedValue(undefined);
  h.tripService.updateTripPlanning.mockReset();
  h.tripService.updateTripPlanning.mockResolvedValue(makeWorkspace());
  h.aiPlanning.generateTripPlanningProposal.mockReset();
});

/**
 * STEP 36 browser-level visual/interaction verification of the planning
 * reference review panel, driven through the real /trips/:tripId page rather
 * than the bare component. jsdom has no layout engine, so "browser-like DOM
 * testing" here is the strongest available alternative: real route wiring,
 * real trips, real keyboard-driven edits, computed-inline-style assertions and
 * a fixed-width inventory of the panel subtree substitute for pixel overflow
 * measurement, which is documented as a limitation in the final report.
 */
describe('TripWorkspacePage STEP 36 review-panel page-level verification', () => {
  it('renders the combined transport + accommodation review with correct ordering, grouping, and heading hierarchy', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 'trp-1', mode: 'Flight', lifecycleState: 'active' },
            { id: 'trp-2', mode: 'Train', lifecycleState: 'active' },
          ],
          accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
        }),
      })
    );
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 2 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    const heading = screen.getByRole('heading', { name: 'Review changes before saving' });
    expect(heading.tagName).toBe('H3');
    expect(panel).toHaveAttribute('aria-labelledby', heading.id);
    expect(panel).toHaveAccessibleName('Review changes before saving');
    expect(panel).toHaveTextContent('You are in control.');

    const transportGroup = within(panel).getByRole('group', { name: 'Transport changes' });
    const accommodationGroup = within(panel).getByRole('group', { name: 'Accommodation changes' });
    expect(within(transportGroup).getByRole('heading', { name: 'Transport' }).tagName).toBe('H4');
    expect(within(accommodationGroup).getByRole('heading', { name: 'Accommodation' }).tagName).toBe(
      'H4'
    );
    expect(
      transportGroup.compareDocumentPosition(accommodationGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Lifecycle for “Train”');
    expect(items[1]).toHaveTextContent('Lifecycle for “Padi Hotel”');
  }, 20000);

  it('omits the accommodation group entirely for a transport-only review', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(noPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(reviewGroup()).getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
    expect(within(reviewGroup()).queryByRole('heading', { name: 'Accommodation' })).toBeNull();
    expect(
      within(reviewGroup()).queryByRole('group', { name: 'Accommodation changes' })
    ).toBeNull();
  }, 20000);

  it('omits the transport group entirely for an accommodation-only review', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot({
          transportPlans: [],
          accommodationPlans: [{ id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active' }],
        }),
      })
    );
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Accommodation plans', 'Edit'));
    await user.click(screen.getByRole('button', { name: 'Mark Accommodation plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(within(reviewGroup()).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(reviewGroup()).getByRole('heading', { name: 'Accommodation' })
    ).toBeInTheDocument();
    expect(within(reviewGroup()).queryByRole('heading', { name: 'Transport' })).toBeNull();
    expect(within(reviewGroup()).queryByRole('group', { name: 'Transport changes' })).toBeNull();
  }, 20000);

  it('renders long labels in full, never leaks source URLs, and applies the wrapping rule to review items', async () => {
    const user = userEvent.setup();
    const longLabel = 'Flight from Jakarta to Denpasar via Makassar and Surabaya';
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
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
      })
    );
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
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
    expect(reviewGroup()).toHaveTextContent(longLabel);
  }, 20000);

  it('marks unresolved-primary items with a real-text attention badge and guidance, not color alone', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(noPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Mark Transport plan 1 for review' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('is unresolved and will remain unresolved if saved');
    expect(items[1]).toHaveTextContent('Lifecycle for “Flight”');
    const badges = within(reviewGroup()).getAllByText('Needs attention');
    expect(badges).toHaveLength(2);
    expect(reviewGroup()).toHaveTextContent('Select another active reference');
    expect(reviewGroup()).toHaveTextContent('or restore the plan to active');
    expect(badges[0]).toHaveStyle({ color: 'rgb(251, 191, 36)' });
    expect(badges[0]).toHaveStyle({ background: 'rgba(251, 191, 36, 0.12)' });
  }, 20000);

  it('keeps the panel free of fixed widths and applies the editor radius, min-width, and wrap primitives', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    expect(panel).toHaveStyle({ borderRadius: '14px', flexBasis: '100%' });

    const offenders: Array<{ tag: string; props: Array<[string, string]> }> = [];
    const inspect = (el: Element) => {
      const style = (el as HTMLElement).style;
      const fixed: Array<[string, string]> = [];
      for (const prop of ['width', 'minWidth', 'maxWidth'] as const) {
        const value = style[prop];
        if (/^-?\d+(\.\d+)?px$/.test(value) && parseFloat(value) > 0) {
          fixed.push([prop, value]);
        }
      }
      if (fixed.length > 0) offenders.push({ tag: el.tagName, props: fixed });
    };
    inspect(panel);
    panel.querySelectorAll('*').forEach(inspect);
    expect(offenders).toEqual([]);

    const transportGroup = within(panel).getByRole('group', {
      name: 'Transport changes',
    });
    expect(window.getComputedStyle(transportGroup).minWidth).toBe('0');
    const list = within(transportGroup).getByRole('list');
    expect(window.getComputedStyle(list).minWidth).toBe('0');

    const keepButton = screen.getByRole('button', { name: 'Keep editing' });
    expect(keepButton.parentElement).toHaveStyle({ flexWrap: 'wrap' });
  }, 20000);

  it('exposes the intended accessibility structure and keeps the buttons keyboard-reachable without a focus trap', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    expect(screen.getAllByRole('group', { name: 'Review changes before saving' })).toHaveLength(1);
    expect(within(panel).getAllByRole('list')).toHaveLength(1);
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    const heading = screen.getByRole('heading', { name: 'Review changes before saving' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();

    await user.tab();
    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    expect(confirm).toHaveFocus();
    await user.tab();
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(keep).toHaveFocus();
    await user.tab();
    expect(confirm).not.toHaveFocus();
    expect(keep).not.toHaveFocus();

    expect(screen.getAllByRole('button', { name: 'Save planning changes' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Keep editing' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
  }, 20000);

  it('opens with heading focus exactly on the pivot and returns focus to Save via Keep editing with the draft intact', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(screen.getByRole('heading', { name: 'Review changes before saving' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save planning' })).toHaveFocus()
    );
    expect(screen.getByLabelText('Primary transport plan reference')).toHaveValue('trp-2');
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
  }, 20000);

  it('keeps the panel open and the confirmation disabled while the save is in flight', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    h.tripService.updateTripPlanning.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled();
    expect(reviewGroup()).toBeInTheDocument();
  }, 20000);

  it('keeps the review intact on a failed save and allows a retry that succeeds and relocates focus', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    h.tripService.updateTripPlanning
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your planning changes.'
    );
    expect(reviewGroup()).toBeInTheDocument();
    const items = within(reviewGroup()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('will change from “Flight” to “Train”');
    const confirm = screen.getByRole('button', { name: 'Save planning changes' });
    expect(confirm).toBeEnabled();
    await waitFor(() => expect(confirm).toHaveFocus());

    await user.click(confirm);

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(findFrameToggle('Transport plans', 'Edit')).toHaveFocus();
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith(
      'trip-abc',
      'user-1',
      expect.objectContaining({ primaryTransportPlanId: 'trp-2' })
    );
  }, 20000);

  it('closes the review on success and relocates focus to the first section action with no stale panel', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    h.tripService.updateTripPlanning.mockResolvedValue(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-2');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('heading', { name: 'Review changes before saving' })).toBeNull();
    expect(findFrameToggle('Transport plans', 'Edit')).toHaveFocus();
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith(
      'trip-abc',
      'user-1',
      expect.objectContaining({ primaryTransportPlanId: 'trp-2' })
    );
  }, 20000);
});

/**
 * STEP 37 page-level regression coverage for the three review classifications
 * that were only exercised at the component layer before: primary-selected
 * (setting a primary with no persisted assignment), primary-cleared (clearing a
 * persisted primary), and provenance-changed (marking a simulated reference as
 * manually entered). Each drives the real /trips/:tripId page end-to-end and
 * verifies the review wording plus the persisted payload.
 */
describe('TripWorkspacePage STEP 37 planning-reference page-level regression gaps', () => {
  it('lists a primary-selected change through the review panel and persists it on confirmation', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(noPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), 'trp-1');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Primary reference will be set to “Flight”.');
    expect(within(panel).queryByText('Needs attention')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith(
      'trip-abc',
      'user-1',
      expect.objectContaining({ primaryTransportPlanId: 'trp-1' })
    );
  }, 20000);

  it('lists a primary-cleared change through the review panel and stages a null primary on confirmation', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(persistedPrimarySeed());
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.selectOptions(screen.getByLabelText('Primary transport plan reference'), '');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Primary reference will be cleared.');

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith(
      'trip-abc',
      'user-1',
      expect.objectContaining({ primaryTransportPlanId: null })
    );
  }, 20000);

  it('lists a provenance-kind change through the review panel and persists the manual kind without the note', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot({
          transportPlans: [
            {
              id: 'trp-1',
              mode: 'Flight',
              provenance: { kind: 'mock-discovery', note: 'Imported from simulated discovery.' },
            },
          ],
        }),
      })
    );
    renderPage();
    await screen.findByText('Island Escape');

    await user.click(findFrameToggle('Transport plans', 'Edit'));
    await user.click(
      screen.getByRole('button', { name: 'Mark transport plan 1 as manually entered' })
    );
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent('Manual reference');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    const panel = reviewGroup();
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(
      'Provenance for “Flight” will change from “Simulated discovery” to “Manual reference”.'
    );

    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Review changes before saving' })
      ).not.toBeInTheDocument()
    );
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith(
      'trip-abc',
      'user-1',
      expect.objectContaining({
        transportPlans: [expect.objectContaining({ id: 'trp-1', provenance: { kind: 'manual' } })],
      })
    );
  }, 20000);
});
