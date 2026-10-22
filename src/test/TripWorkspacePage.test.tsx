import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripWorkspacePage } from '../components/trips/TripWorkspacePage';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { User } from '../types/travel';
import type {
  TripItinerarySnapshot,
  TripPlanningProposal,
  TripStatus,
  TripWorkspace,
} from '../types/trip';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trips/trip-abc']}>
      <Routes>
        <Route path="/trips/:tripId" element={<TripWorkspacePage />} />
        <Route path="/trips" element={<div>My Trips</div>} />
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

describe('TripWorkspacePage', () => {
  it('loads and shows the workspace for the signed-in owner', async () => {
    h.state.user = makeUser();
    renderPage();

    expect(screen.getByText(/Loading trip…/)).toBeInTheDocument();

    expect(await screen.findByText('Island Escape')).toBeInTheDocument();
    expect(screen.getByText('Ubud')).toBeInTheDocument();
    expect(h.tripService.getTrip).toHaveBeenCalledWith('trip-abc');
  });

  it('shows "not found" when getTrip resolves null', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
  });

  it('shows "not found" when the service throws TripNotFoundError', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockRejectedValue(new h.TripNotFoundError());
    renderPage();

    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
  });

  it('shows the sign-in prompt for permission errors', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockRejectedValue(new h.TripPermissionError());
    renderPage();

    expect(await screen.findByText('Sign in to view this trip')).toBeInTheDocument();
  });

  it('shows a safe error message for unexpected failures', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByText('Could not load trip')).toBeInTheDocument();
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('does not fetch when signed out and shows the sign-in prompt', async () => {
    renderPage();

    expect(await screen.findByText('Sign in to view this trip')).toBeInTheDocument();
    expect(h.tripService.getTrip).not.toHaveBeenCalled();
  });

  it('keeps showing loading while the loaded trip id does not match the URL', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ id: 'trip-zzz' }));
    renderPage();

    expect(screen.getByText(/Loading trip…/)).toBeInTheDocument();
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText(/Loading trip…/)).toBeInTheDocument();
  });

  it('shows a safe error when a stored trip cannot be parsed (malformed snapshot)', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockRejectedValue(new Error('Trip could not be read.'));
    renderPage();

    expect(await screen.findByText('Could not load trip')).toBeInTheDocument();
    expect(screen.getByText('Trip could not be read.')).toBeInTheDocument();
  });

  it('links back to the My Trips list at /trips', async () => {
    renderPage();

    const backLink = screen.getByRole('link', { name: /back to my trips/i });
    expect(backLink).toHaveAttribute('href', '/trips');
  });
});

describe('TripWorkspacePage editing boundary', () => {
  it('prefills title and overview and disables Save when unchanged', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({ itinerary: makeSnapshot(), title: 'Island Escape' })
    );
    renderPage();

    expect(await screen.findByLabelText('Title')).toHaveValue('Island Escape');
    expect(screen.getByLabelText('Overview')).toHaveValue('A balanced island escape.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('shows the unsaved-changes indicator and enables Save when edited', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({ itinerary: makeSnapshot(), title: 'Island Escape' })
    );
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Island Escape 2');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('disables Save when the title is cleared', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });

  it('saves an edited title and overview via updateTrip and reflects the saved trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockResolvedValue(
      makeWorkspace({
        title: 'Island Rewrite',
        itinerary: makeSnapshot({ summary: 'A refreshed island escape.' }),
      })
    );
    renderPage();

    const title = await screen.findByLabelText('Title');
    const overview = screen.getByLabelText('Overview');
    await user.clear(title);
    await user.type(title, 'Island Rewrite');
    await user.clear(overview);
    await user.type(overview, 'A refreshed island escape.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(h.tripService.updateTrip).toHaveBeenCalledWith('trip-abc', {
        title: 'Island Rewrite',
        itinerary: expect.objectContaining({ summary: 'A refreshed island escape.' }),
      })
    );
    expect(await screen.findByText('Island Rewrite')).toBeInTheDocument();
    expect(screen.getByLabelText('Overview')).toHaveValue('A refreshed island escape.');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows an inline error when saving fails', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Island Escape 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your changes.');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('shows the not-found panel when saving reports a missing trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockRejectedValueOnce(new h.TripNotFoundError());
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Island Escape 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
  });

  it('hides the overview editor when the workspace has no itinerary snapshot', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: undefined }));
    renderPage();

    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(screen.queryByLabelText('Overview')).not.toBeInTheDocument();
  });
});

describe('TripWorkspacePage structured planning', () => {
  it('loads planning sections into the editor and saves them via updateTripPlanning', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot({ notes: ['Book early'] }),
      })
    );
    renderPage();

    expect(await screen.findByLabelText('Start')).toHaveValue('2026-09-11');
    expect(screen.getByLabelText('Planning notes')).toHaveValue('Book early');
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Start'));
    await user.type(screen.getByLabelText('Start'), '2026-09-12');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await waitFor(() =>
      expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith('trip-abc', 'user-1', {
        dateRange: { startDate: '2026-09-12', endDate: '2026-09-15' },
      })
    );
    expect(await screen.findByLabelText('Start')).toBeEnabled();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('keeps planning edits open and shows a retry message when the save fails', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.tripService.updateTripPlanning.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    await screen.findByLabelText('Start');
    await user.clear(screen.getByLabelText('Start'));
    await user.type(screen.getByLabelText('Start'), '2026-09-12');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your planning changes.'
    );
    expect(screen.getByLabelText('Start')).toHaveValue('2026-09-12');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('shows the not-found panel when a planning save reports a missing trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.tripService.updateTripPlanning.mockRejectedValueOnce(new h.TripNotFoundError());
    renderPage();

    await screen.findByLabelText('Start');
    await user.clear(screen.getByLabelText('Start'));
    await user.type(screen.getByLabelText('Start'), '2026-09-12');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
  });

  it('shows the sign-in prompt when a planning save reports a permission error', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTripPlanning.mockRejectedValueOnce(new h.TripPermissionError());
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Add destination' }));
    await user.type(screen.getByLabelText(/^Destination name dst-/), 'Canggu');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(await screen.findByText('Sign in to view this trip')).toBeInTheDocument();
  });

  it('disables the planning editor while a title save is in flight', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    await screen.findByLabelText('Title');
    await user.type(screen.getByLabelText('Title'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByLabelText('Start')).toBeDisabled();
  });

  it('disables title, status, and delete controls while a planning save is in flight', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.tripService.updateTripPlanning.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    await screen.findByLabelText('Start');
    await user.clear(screen.getByLabelText('Start'));
    await user.type(screen.getByLabelText('Start'), '2026-09-12');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update status' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete trip' })).toBeDisabled();
  });
});

function validProposal(): TripPlanningProposal {
  return {
    explanation: 'Extends the trip by one day.',
    update: { dateRange: { startDate: '2026-09-11', endDate: '2026-09-16' } },
  };
}

describe('TripWorkspacePage AI planning suggestions', () => {
  it('drafts a suggestion but persists only after explicit approval', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockResolvedValue(validProposal());
    renderPage();

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    expect(await screen.findByText('Extends the trip by one day.')).toBeInTheDocument();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    expect(screen.getByText(/Applied to your draft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() =>
      expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith('trip-abc', 'user-1', {
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-16' },
      })
    );
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1);
  });

  it('merges an approved proposal into the existing draft instead of replacing it', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockResolvedValue(validProposal());
    renderPage();

    await screen.findByLabelText('Destination name d1');
    await user.clear(screen.getByLabelText('Destination name d1'));
    await user.type(screen.getByLabelText('Destination name d1'), 'Canggu');

    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByText('Extends the trip by one day.');
    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await waitFor(() =>
      expect(h.tripService.updateTripPlanning).toHaveBeenCalledWith('trip-abc', 'user-1', {
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-16' },
        destinations: [{ id: 'd1', name: 'Canggu', country: 'Indonesia' }],
      })
    );
  });

  it('restores the previous draft when an applied suggestion is discarded', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockResolvedValue(validProposal());
    renderPage();

    await screen.findByLabelText('Destination name d1');
    await user.clear(screen.getByLabelText('Destination name d1'));
    await user.type(screen.getByLabelText('Destination name d1'), 'Canggu');

    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByText('Extends the trip by one day.');
    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }));

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByText('Extends the trip by one day.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply suggestion' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Start')).toHaveValue('2026-09-11');
    expect(screen.getByLabelText('Destination name d1')).toHaveValue('Canggu');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  }, 20000);

  it('keeps an approved suggestion applied when the save fails', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockResolvedValue(validProposal());
    h.tripService.updateTripPlanning.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByText('Extends the trip by one day.');
    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }));

    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your planning changes.'
    );
    expect(screen.getByText(/Applied to your draft/)).toBeInTheDocument();
    expect(screen.getByLabelText('Start')).toHaveValue('2026-09-11');
    expect(screen.getByLabelText('End')).toHaveValue('2026-09-16');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
    expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1);
  });

  it('shows a safe error when generation fails and never persists', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockRejectedValue(
      new h.aiPlanning.AiPlanningError('The planning assistant is busy right now.')
    );
    renderPage();

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The planning assistant is busy right now.'
    );
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
  });

  it('shows a generic safe message for unexpected generation failures', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockRejectedValue(new Error('raw provider detail'));
    renderPage();

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not generate a planning suggestion right now.');
    expect(alert.textContent).not.toMatch(/raw provider detail/);
  });

  it('disables title, status, delete, and planning controls while generating', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
        itinerary: makeSnapshot(),
      })
    );
    h.aiPlanning.generateTripPlanningProposal.mockImplementation(() => new Promise(() => {}));
    renderPage();

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));

    expect(screen.getByText(/Generating a suggestion…/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete trip' })).toBeDisabled();
  });

  it('does not surface a suggestion that arrives after navigating to another trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockImplementation((id: string) =>
      Promise.resolve(
        makeWorkspace({
          id,
          title: id === 'trip-abc' ? 'Island Escape' : 'Second Trip',
          dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
          itinerary: makeSnapshot(),
        })
      )
    );
    let resolveProposal!: (proposal: TripPlanningProposal) => void;
    h.aiPlanning.generateTripPlanningProposal.mockImplementation(
      () =>
        new Promise<TripPlanningProposal>((resolve) => {
          resolveProposal = resolve;
        })
    );

    function NavButton() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/trips/trip-xyz')}>Go other</button>;
    }

    render(
      <MemoryRouter initialEntries={['/trips/trip-abc']}>
        <Routes>
          <Route
            path="/trips/:tripId"
            element={
              <>
                <TripWorkspacePage />
                <NavButton />
              </>
            }
          />
          <Route path="/trips" element={<div>My Trips</div>} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByLabelText('Start');
    await user.type(screen.getByLabelText('AI planning instruction'), 'Add one more day');
    await user.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    expect(screen.getByText(/Generating a suggestion…/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go other' }));
    expect(await screen.findByText('Second Trip')).toBeInTheDocument();

    resolveProposal(validProposal());
    await waitFor(() => expect(h.aiPlanning.generateTripPlanningProposal).toHaveBeenCalledTimes(1));

    expect(screen.queryByText('Extends the trip by one day.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply suggestion' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Generating a suggestion…/)).not.toBeInTheDocument();
  });

  it('hides the AI assistant on a workspace without an itinerary', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: undefined }));
    renderPage();

    await screen.findByLabelText('Title');
    expect(
      screen.getByText('Attach an itinerary to use AI planning suggestions.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('AI planning instruction')).not.toBeInTheDocument();
  });
});

describe('TripWorkspacePage lifecycle controls', () => {
  it('shows a status select with current + allowed transitions', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ status: 'draft' as TripStatus }));
    renderPage();

    await screen.findByLabelText('Title');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('draft');
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['draft', 'planning', 'cancelled']);
  });

  it('disables the status select on a terminal status and shows a hint', async () => {
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ status: 'completed' as TripStatus }));
    renderPage();

    await screen.findByLabelText('Title');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('completed');
    expect(select).toBeDisabled();
    expect(screen.getByText('This status is final.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update status' })).toBeDisabled();
  });

  it('calls updateTripStatus on a legal transition and reflects the saved trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    const draft = makeWorkspace({ status: 'draft' as TripStatus });
    h.tripService.getTrip.mockResolvedValue(draft);
    h.tripService.updateTripStatus.mockResolvedValue({
      ...draft,
      status: 'planning' as TripStatus,
    });
    renderPage();

    await screen.findByLabelText('Title');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    await user.selectOptions(select, 'planning');
    await user.click(screen.getByRole('button', { name: 'Update status' }));

    await waitFor(() =>
      expect(h.tripService.updateTripStatus).toHaveBeenCalledWith('trip-abc', 'user-1', 'planning')
    );
    expect(select.value).toBe('planning');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('shows an inline error when updateTripStatus fails', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    const draft = makeWorkspace({ status: 'draft' as TripStatus });
    h.tripService.getTrip.mockResolvedValue(draft);
    h.tripService.updateTripStatus.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    await screen.findByLabelText('Title');
    await user.selectOptions(screen.getByLabelText('Status') as HTMLSelectElement, 'planning');
    await user.click(screen.getByRole('button', { name: 'Update status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the trip status.');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('planning');
  });

  it('disables the status and save controls while an edit save is in flight', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    await screen.findByLabelText('Title');
    await user.type(screen.getByLabelText('Title'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.selectOptions(screen.getByLabelText('Status') as HTMLSelectElement, 'planning');

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update status' })).toBeDisabled();
  });

  it('renames via renameTrip when the workspace has no itinerary', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    const draft = makeWorkspace({ itinerary: undefined });
    h.tripService.getTrip.mockResolvedValue(draft);
    h.tripService.renameTrip.mockResolvedValue({ ...draft, title: 'Renamed' });
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(h.tripService.renameTrip).toHaveBeenCalledWith('trip-abc', 'user-1', 'Renamed')
    );
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
    expect(await screen.findByText('Renamed')).toBeInTheDocument();
  });

  it('preserves draft and shows an error when renameTrip fails', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: undefined }));
    h.tripService.renameTrip.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Boom');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your changes.');
    expect(title).toHaveValue('Boom');
  });

  it('requires confirmation before deleting the trip', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));

    expect(h.tripService.deleteTrip).not.toHaveBeenCalled();
    expect(screen.getByText(/Are you sure\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete trip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep trip' })).toBeInTheDocument();
  });

  it('cancels delete without calling the service', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    await user.click(screen.getByRole('button', { name: 'Keep trip' }));

    expect(h.tripService.deleteTrip).not.toHaveBeenCalled();
    expect(screen.queryByText(/Are you sure\?/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete trip' })).toBeInTheDocument();
  });

  it('navigates to the trips list on successful delete', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete trip' }));

    await waitFor(() =>
      expect(h.tripService.deleteTrip).toHaveBeenCalledWith('trip-abc', 'user-1')
    );
    expect(await screen.findByText('My Trips')).toBeInTheDocument();
  });

  it('stays on the page when delete fails and shows a safe error', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.deleteTrip.mockRejectedValueOnce(new Error('network'));
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete trip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete the trip.');
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('shows the not-found panel when delete reports the trip was removed', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.deleteTrip.mockRejectedValueOnce(new h.TripNotFoundError());
    renderPage();

    await screen.findByLabelText('Title');
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete trip' }));

    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
  });

  it('disables Delete trip while another in-flight save is active', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTrip.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    await screen.findByLabelText('Title');
    await user.type(screen.getByLabelText('Title'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    // delete button should be disabled while save is in flight
    expect(screen.getByRole('button', { name: 'Delete trip' })).toBeDisabled();
  });
});

describe('TripWorkspacePage read-only mock discovery', () => {
  it('runs mock discovery and presents results without persisting anything', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    expect(await screen.findByText('Mock Express Rail')).toBeInTheDocument();
    expect(screen.getByText('Mock Transport Provider · mock-transport-1')).toBeInTheDocument();
    expect(screen.getByText('149.00 USD')).toBeInTheDocument();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });

  it('shows the empty state for the empty sentinel without persisting', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'MOCK-EMPTY-RESULTS');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    expect(await screen.findByText('No sample options matched this search.')).toBeInTheDocument();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });

  it('surfaces a bounded provider failure without persisting', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'MOCK-PROVIDER-FAILURE');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Provider unavailable');
    expect(alert).toHaveTextContent('The simulated transport search could not be completed.');
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });

  it('rejects an end date without a start date and never persists', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.type(screen.getByLabelText('End date'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An end date is only valid together with a start date.');
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });

  it('clears results with the Clear results action without persisting', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getByRole('button', { name: 'Clear results' }));

    expect(screen.queryByText('Mock Express Rail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear results' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Search to see simulated sample options from the mock providers/)
    ).toBeInTheDocument();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
    expect(h.tripService.updateTrip).not.toHaveBeenCalled();
  });
});

describe('TripWorkspacePage STEP 22 discovery-to-planning handoff', () => {
  it('imports a selected result into the planning draft and saves it explicitly', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    h.tripService.updateTripPlanning.mockResolvedValue(
      makeWorkspace({ itinerary: makeSnapshot() })
    );
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    const importButtons = screen.getAllByRole('button', { name: 'Use as planning reference' });
    await user.click(importButtons[0]);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Added “Mock Express Rail” to your planning draft as a user-entered reference.'
    );
    expect(screen.getByText('Added to planning draft')).toBeInTheDocument();
    expect(screen.getByLabelText('Transport source URL 1')).toHaveValue(
      'https://mock.example/transport/result-1'
    );
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    const savedPlan = h.tripService.updateTripPlanning.mock.calls[0][2].transportPlans[0];
    expect(savedPlan).toMatchObject({
      id: 'handoff-mock-transport-1',
      provider: 'Mock Transport Provider',
      departureLocation: 'LHR',
      arrivalLocation: 'Tokyo',
      referenceNumber: 'mock-transport-1',
      sourceUrl: 'https://mock.example/transport/result-1',
      readiness: {
        state: 'planned',
        note: expect.stringContaining('simulated discovery'),
      },
      provenance: {
        kind: 'mock-discovery',
        note: expect.stringContaining('simulated discovery'),
      },
    });
    expect(savedPlan.notes).toContain('Sample data — not live availability');
    expect(savedPlan.notes).toContain('Not a booking or reservation');
    expect(savedPlan.notes).toContain('Sample price: 149.00 USD');
    expect(savedPlan.notes).toContain('Provider: Mock Transport Provider');
  });

  it('treats an already-present handoff plan id as imported and refuses a duplicate', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            {
              id: 'handoff-mock-transport-1',
              provider: 'Existing provider',
              referenceNumber: 'mock-transport-1',
            },
          ],
        }),
      })
    );
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    expect(screen.getByText('Added to planning draft')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Use as planning reference' })).toHaveLength(5);
  });

  it('discards an imported draft plan without persisting', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);
    expect(screen.getByLabelText('Transport source URL 1')).toHaveValue(
      'https://mock.example/transport/result-1'
    );
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Remove from draft' }));

    expect(screen.queryByText('Added to planning draft')).not.toBeInTheDocument();
    expect(screen.queryByText(/Added “Mock Express Rail”/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Transport source URL 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save planning' })).toBeDisabled();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();
  });

  it('edits the imported source URL and carries the trimmed value into save', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Transport source URL 1'));
    await user.type(screen.getByLabelText('Transport source URL 1'), 'https://example.com/updated');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));

    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    expect(h.tripService.updateTripPlanning.mock.calls[0][2].transportPlans[0].sourceUrl).toBe(
      'https://example.com/updated'
    );
  });

  it('labels an imported plan as simulated and re-labels it manually before save (STEP 23)', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent(
      'Simulated discovery'
    );
    expect(screen.getByLabelText('Transport source note 1')).toHaveValue(
      'Imported from simulated discovery as a user-entered planning reference.'
    );

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(
      screen.getByRole('button', { name: 'Mark transport plan 1 as manually entered' })
    );
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent('Manual reference');
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    expect(h.tripService.updateTripPlanning.mock.calls[0][2].transportPlans[0].provenance).toEqual({
      kind: 'manual',
    });
  });
});

describe('TripWorkspacePage STEP 24 planning-reference lifecycle', () => {
  it('imports a reference as active, archives it, and saves the decision explicitly', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(makeWorkspace({ itinerary: makeSnapshot() }));
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);

    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Active');
    expect(screen.getByLabelText('Transport provenance 1')).toHaveTextContent(
      'Simulated discovery'
    );
    expect(screen.queryByText(/Needs review|Expired|Outdated/)).toBeNull();
    expect(h.tripService.updateTripPlanning).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Archive Transport plan 1' }));
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Archived');
    expect(screen.getByRole('button', { name: 'Restore Transport plan 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    const savedPlan = h.tripService.updateTripPlanning.mock.calls[0][2].transportPlans[0];
    expect(savedPlan.lifecycleState).toBe('archived');
    expect(savedPlan.provenance).toMatchObject({ kind: 'mock-discovery' });
    expect(savedPlan.readiness).toMatchObject({ state: 'planned' });
    expect(savedPlan).not.toHaveProperty('checkedAt');
    expect(savedPlan).not.toHaveProperty('verifiedAt');
  });

  it('restores an archived reference back to active and persists it', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            {
              id: 'trp-1',
              mode: 'Flight',
              provider: 'Existing provider',
              lifecycleState: 'archived',
            },
          ],
        }),
      })
    );
    renderPage();

    await screen.findByText('Island Escape');
    expect(screen.getByLabelText('Transport lifecycle 1')).toHaveTextContent('Archived');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'Restore Transport plan 1' }));
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await screen.findByRole('heading', { name: 'Review changes before saving' });
    await user.click(screen.getByRole('button', { name: 'Save planning changes' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    expect(h.tripService.updateTripPlanning.mock.calls[0][2].transportPlans[0].lifecycleState).toBe(
      'active'
    );
  });
});

describe('TripWorkspacePage STEP 27 handoff primary-selection integrity', () => {
  it('handoff save payload never carries a selection and preserves the archived plan verbatim', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [
            { id: 'trp-existing', mode: 'Train', provider: 'Existing Rail' },
            { id: 'trp-archived', mode: 'Bus', provider: 'Old Bus', lifecycleState: 'archived' },
          ],
          primaryTransportPlanId: 'trp-existing',
        }),
      })
    );
    h.tripService.updateTripPlanning.mockResolvedValue(makeWorkspace());
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    const update = h.tripService.updateTripPlanning.mock.calls[0][2];
    expect(update.primaryTransportPlanId).toBeUndefined();
    expect(update.primaryAccommodationPlanId).toBeUndefined();

    const archived = update.transportPlans.find((p: { id: string }) => p.id === 'trp-archived');
    expect(archived).toMatchObject({ mode: 'Bus', lifecycleState: 'archived' });

    const imported = update.transportPlans.find(
      (p: { id: string }) => p.id === 'handoff-mock-transport-1'
    );
    expect(imported).toBeDefined();
    expect(imported).not.toHaveProperty('primaryTransportPlanId');
    expect(imported).not.toHaveProperty('primaryAccommodationPlanId');
  });

  it('handoff save over an absent selection does not invent one', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.getTrip.mockResolvedValue(
      makeWorkspace({
        itinerary: makeSnapshot({
          transportPlans: [{ id: 'trp-existing', mode: 'Train', provider: 'Existing Rail' }],
        }),
      })
    );
    h.tripService.updateTripPlanning.mockResolvedValue(makeWorkspace());
    renderPage();

    await screen.findByText('Island Escape');
    await user.type(screen.getByLabelText(/^Destination \*/), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));
    await screen.findByText('Mock Express Rail');

    await user.click(screen.getAllByRole('button', { name: 'Use as planning reference' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save planning' }));
    await waitFor(() => expect(h.tripService.updateTripPlanning).toHaveBeenCalledTimes(1));

    const update = h.tripService.updateTripPlanning.mock.calls[0][2];
    expect(update.primaryTransportPlanId).toBeUndefined();
    expect(update.primaryAccommodationPlanId).toBeUndefined();
  });
});
