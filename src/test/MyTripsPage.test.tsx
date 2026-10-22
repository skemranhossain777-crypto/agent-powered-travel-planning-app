import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTripsPage } from '../components/trips/MyTripsPage';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { User } from '../types/travel';
import type { TripWorkspace } from '../types/trip';

const h = vi.hoisted(() => {
  class TripPermissionError extends Error {
    constructor() {
      super('You do not have access to this list.');
      this.name = 'TripPermissionError';
    }
  }
  return {
    TripPermissionError,
    tripService: { listTripsForOwner: vi.fn() },
    listeners: [] as Array<(user: unknown) => void>,
    state: { user: null as unknown },
  };
});

vi.mock('../services/tripService', () => ({
  tripService: h.tripService,
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

function makeUser(overrides: Partial<User> = {}): User {
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
      interests: [],
      travelStyles: [],
    },
    ...overrides,
  };
}

function makeTrip(id: string, title: string): TripWorkspace {
  return createDraftTrip({
    ownerId: 'user-1',
    title,
    id,
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
    now: '2026-09-10T08:00:00.000Z',
  });
}

function WorkspaceProbe() {
  const { tripId } = useParams<{ tripId: string }>();
  return <div data-testid="workspace">{tripId}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trips']}>
      <Routes>
        <Route path="/trips" element={<MyTripsPage />} />
        <Route path="/trips/:tripId" element={<WorkspaceProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  h.listeners.length = 0;
  h.state.user = null;
  h.tripService.listTripsForOwner.mockReset();
  h.tripService.listTripsForOwner.mockResolvedValue([]);
});

describe('MyTripsPage', () => {
  it('loads and lists the signed-in user trips, newest activity first', async () => {
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockImplementation(async () => [
      makeTrip('trip-a', 'Trip A'),
      makeTrip('trip-b', 'Trip B'),
    ]);
    renderPage();

    expect(await screen.findByText('Trip A')).toBeInTheDocument();
    expect(screen.getByText('Trip B')).toBeInTheDocument();
    expect(h.tripService.listTripsForOwner).toHaveBeenCalledWith('user-1');
  });

  it('shows the empty state when the owner has no workspaces', async () => {
    h.state.user = makeUser();
    renderPage();

    expect(await screen.findByText(/No trips yet/)).toBeInTheDocument();
    expect(h.tripService.listTripsForOwner).toHaveBeenCalledWith('user-1');
  });

  it('shows a safe error and hides raw failure text when the list fails', async () => {
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByText(/Could not load your trips/)).toBeInTheDocument();
    expect(screen.getByText('Please try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it('shows a permission message for a permission-denied list error', async () => {
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockRejectedValue(new h.TripPermissionError());
    renderPage();

    expect(await screen.findByText(/Could not load your trips/)).toBeInTheDocument();
    expect(screen.getByText('You do not have access to this list.')).toBeInTheDocument();
  });

  it('shows the sign-in prompt and does not fetch when signed out', async () => {
    renderPage();

    expect(await screen.findByText(/Sign in to view your trips/)).toBeInTheDocument();
    expect(h.tripService.listTripsForOwner).not.toHaveBeenCalled();
  });

  it('opens the selected trip workspace route', async () => {
    const user = userEvent.setup();
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockResolvedValue([makeTrip('trip-abc', 'Island Escape')]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /island escape/i }));

    expect(screen.getByTestId('workspace')).toHaveTextContent('trip-abc');
  });

  it('re-fetches when the signed-in user changes to another owner', async () => {
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockImplementation(async (ownerId: string) =>
      ownerId === 'user-1' ? [makeTrip('trip-a', 'Trip A')] : [makeTrip('trip-b', 'Trip B')]
    );
    renderPage();

    expect(await screen.findByText('Trip A')).toBeInTheDocument();

    h.state.user = makeUser({ id: 'user-2' });
    h.listeners.forEach((cb) => cb(h.state.user));

    expect(await screen.findByText('Trip B')).toBeInTheDocument();
    expect(h.tripService.listTripsForOwner).toHaveBeenLastCalledWith('user-2');
  });

  it('falls back to the sign-in prompt when the user logs out mid-session', async () => {
    h.state.user = makeUser();
    h.tripService.listTripsForOwner.mockResolvedValue([makeTrip('trip-a', 'Trip A')]);
    renderPage();

    expect(await screen.findByText('Trip A')).toBeInTheDocument();

    h.state.user = null;
    h.listeners.forEach((cb) => cb(h.state.user));

    expect(await screen.findByText(/Sign in to view your trips/)).toBeInTheDocument();
  });

  it('links back to explore', async () => {
    renderPage();

    const backLink = screen.getByRole('link', { name: /back to explore/i });
    expect(backLink).toHaveAttribute('href', '/explore');
  });
});
