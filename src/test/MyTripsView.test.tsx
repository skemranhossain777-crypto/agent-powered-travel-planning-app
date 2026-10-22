import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MyTripsView } from '../components/trips/MyTripsView';
import { createDraftTrip } from '../domain/trips/tripModel';
import type { TripItinerarySnapshot, TripWorkspace } from '../types/trip';

function makeTrip(overrides: Partial<TripWorkspace> = {}): TripWorkspace {
  return {
    ...createDraftTrip({
      ownerId: 'user-1',
      title: 'Island Escape',
      id: 'trip-abc',
      destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-15' },
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
    interests: [],
    summary: 'A balanced island escape.',
    estimatedTotalCost: '$1,200',
    bestTimeToVisit: 'April–October',
    dayPlans: [],
    ...overrides,
  };
}

function noop() {
  return undefined;
}

describe('MyTripsView', () => {
  it('renders the loading state', () => {
    render(<MyTripsView state={{ status: 'loading' }} onOpenTrip={noop} onBrowse={noop} />);

    expect(screen.getByText(/Loading your trips…/)).toBeInTheDocument();
  });

  it('renders the signed-out prompt and fires onBrowse', async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    render(<MyTripsView state={{ status: 'signed-out' }} onOpenTrip={noop} onBrowse={onBrowse} />);

    expect(screen.getByText(/Sign in to view your trips/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /browse places/i }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('renders the safe error message', () => {
    render(
      <MyTripsView
        state={{ status: 'error', message: 'Please try again in a moment.' }}
        onOpenTrip={noop}
        onBrowse={noop}
      />
    );

    expect(screen.getByText(/Could not load your trips/)).toBeInTheDocument();
    expect(screen.getByText('Please try again in a moment.')).toBeInTheDocument();
  });

  it('renders the empty state and fires onBrowse', async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    render(<MyTripsView state={{ status: 'empty' }} onOpenTrip={noop} onBrowse={onBrowse} />);

    expect(screen.getByText(/No trips yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /browse places/i }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('lists trips with status, destination summary, dates, and duration, then opens one', async () => {
    const user = userEvent.setup();
    const onOpenTrip = vi.fn();
    render(
      <MyTripsView
        state={{ status: 'ready', trips: [makeTrip({ status: 'planning' })] }}
        onOpenTrip={onOpenTrip}
        onBrowse={noop}
      />
    );

    expect(screen.getByText('Island Escape')).toBeInTheDocument();
    expect(screen.getByText('planning')).toBeInTheDocument();
    expect(screen.getByText('Ubud')).toBeInTheDocument();
    expect(screen.getByText('2026-09-11 → 2026-09-15')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /island escape/i }));
    expect(onOpenTrip).toHaveBeenCalledWith('trip-abc');
  });

  it('shows the itinerary badge when the workspace carries a snapshot', () => {
    render(
      <MyTripsView
        state={{ status: 'ready', trips: [makeTrip({ itinerary: makeSnapshot() })] }}
        onOpenTrip={noop}
        onBrowse={noop}
      />
    );

    expect(screen.getByText('Itinerary attached')).toBeInTheDocument();
  });

  it('hides duration when no date range is present', () => {
    render(
      <MyTripsView
        state={{ status: 'ready', trips: [makeTrip({ dateRange: undefined })] }}
        onOpenTrip={noop}
        onBrowse={noop}
      />
    );

    expect(screen.queryByText(/days/)).not.toBeInTheDocument();
    expect(screen.getByText('Island Escape')).toBeInTheDocument();
  });
});
