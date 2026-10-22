import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { useUiStore } from '../stores/uiStore';

const h = vi.hoisted(() => {
  return {
    getTrip: vi.fn(),
    listTripsForOwner: vi.fn(),
    trip: {
      id: 'trip-xyz',
      ownerId: 'user-1',
      title: 'Island Escape',
      status: 'planning' as const,
      visibility: 'private' as const,
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      memberCount: 1,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    },
  };
});

vi.mock('../services/authService', () => ({
  authService: {
    subscribe: vi.fn(() => () => undefined),
    user: {
      id: 'user-1',
      username: 'Traveler',
      email: 'traveler@example.com',
      provider: 'google',
      profile: { interests: [], travelStyles: [] },
    },
  },
}));

vi.mock('../services/tripService', () => ({
  tripService: { getTrip: h.getTrip, listTripsForOwner: h.listTripsForOwner },
  TripNotFoundError: class extends Error {},
  TripPermissionError: class extends Error {},
}));

vi.mock('../services/dataConnectService', () => ({
  dataConnect: {
    getCategories: vi.fn(async () => []),
    getPlaces: vi.fn(async () => []),
    getPlaceById: vi.fn(async () => undefined),
    getMyBookmarks: vi.fn(async () => []),
    getSavedItineraries: vi.fn(async () => []),
    getActivity: vi.fn(() => []),
    toggleBookmark: vi.fn(async () => false),
    createReview: vi.fn(async () => undefined),
    saveItinerary: vi.fn(async () => undefined),
    deleteItinerary: vi.fn(async () => undefined),
  },
}));

vi.mock('../services/aiTravelAgent', () => ({
  aiAgent: {
    discoverPlaces: vi.fn(async () => []),
  },
}));

vi.mock('../services/geolocation', () => ({
  getCurrentLocation: vi.fn(async () => null),
  reverseGeocode: vi.fn(async () => null),
}));

vi.mock('../services/placeImages', () => ({
  enrichPlacesWithImages: vi.fn(async () => undefined),
}));

beforeEach(() => {
  useUiStore.setState({ activeView: 'explore' });
  h.getTrip.mockReset();
  h.getTrip.mockResolvedValue(h.trip);
  h.listTripsForOwner.mockReset();
  h.listTripsForOwner.mockResolvedValue([]);
});

describe('trip route integration', () => {
  it('renders the workspace page at /trips/:tripId and fetches the trip', async () => {
    render(
      <MemoryRouter initialEntries={['/trips/trip-xyz']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText('Island Escape')).toBeInTheDocument();
    expect(h.getTrip).toHaveBeenCalledWith('trip-xyz');
    expect(screen.getByText('planning')).toBeInTheDocument();
    expect(screen.getByText('2026-09-11 → 2026-09-15')).toBeInTheDocument();
  });

  it('keeps the known view routes working alongside the trip route', async () => {
    render(
      <MemoryRouter initialEntries={['/explore']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('explore');
  });

  it('still redirects unknown paths to /explore', async () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();
  });
});
