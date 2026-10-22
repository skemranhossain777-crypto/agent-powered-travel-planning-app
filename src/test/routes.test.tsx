import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { useUiStore } from '../stores/uiStore';
import { pathToView } from '../routes';

vi.mock('../services/authService', () => ({
  authService: {
    subscribe: vi.fn(() => () => undefined),
    user: null,
  },
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function RouterControls() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate(-1)}>
        go-back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        go-forward
      </button>
    </div>
  );
}

function renderAt(initialEntries: string[], initialIndex = 0) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <AppRoutes />
      <LocationProbe />
      <RouterControls />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useUiStore.setState({ activeView: 'explore' });
});

describe('AppRoutes', () => {
  it('redirects the root path to /explore and renders the explore view', async () => {
    renderAt(['/']);

    expect(await screen.findByTestId('location')).toHaveTextContent('/explore');
    expect(useUiStore.getState().activeView).toBe('explore');
    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();
  });

  it('renders the explore view at /explore', async () => {
    renderAt(['/explore']);

    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('explore');
  });

  it('renders the bookmarks view at /bookmarks', async () => {
    renderAt(['/bookmarks']);

    expect(await screen.findByText(/Sign in to see your saved places/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('bookmarks');
  });

  it('renders the itineraries view at /itineraries', async () => {
    renderAt(['/itineraries']);

    expect(await screen.findByText(/No Active AI Trip Yet/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('itineraries');
  });

  it('renders the profile view at /profile', async () => {
    renderAt(['/profile']);

    expect(await screen.findByText(/Create your VoyageAI profile/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('profile');
  });

  it('redirects unknown paths to /explore', async () => {
    renderAt(['/does-not-exist']);

    expect(await screen.findByTestId('location')).toHaveTextContent('/explore');
    expect(useUiStore.getState().activeView).toBe('explore');
    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();
  });

  it('renders the My Trips screen at /trips for signed-out users', async () => {
    renderAt(['/trips']);

    expect(await screen.findByText(/Sign in to view your trips/i)).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('explore');
  });

  it('changes the active view with browser back/forward navigation', async () => {
    const user = userEvent.setup();
    renderAt(['/explore', '/bookmarks'], 1);

    expect(await screen.findByTestId('location')).toHaveTextContent('/bookmarks');
    expect(await screen.findByText(/Sign in to see your saved places/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'go-back' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/explore');
    expect(useUiStore.getState().activeView).toBe('explore');

    await user.click(screen.getByRole('button', { name: 'go-forward' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/bookmarks');
    expect(useUiStore.getState().activeView).toBe('bookmarks');
  });

  it('navigates via the Navbar tabs and updates URL, store, and content', async () => {
    const user = userEvent.setup();
    renderAt(['/explore']);

    expect(await screen.findByText(/Discover Top Destinations/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /saved places/i }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/bookmarks');
    expect(useUiStore.getState().activeView).toBe('bookmarks');
    expect(await screen.findByText(/Sign in to see your saved places/i)).toBeInTheDocument();
    expect(pathToView('/bookmarks')).toBe('bookmarks');
  });
});
