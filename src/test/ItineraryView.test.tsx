import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ItineraryView } from '../components/ItineraryView';
import type { Itinerary } from '../types/travel';

function makeItinerary(): Itinerary {
  return {
    id: 'itin-1',
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
    createdAt: '2026-01-10T09:00:00.000Z',
  };
}

describe('ItineraryView trip workspace promotion', () => {
  it('renders the Create Trip Workspace button only when the handler is provided', () => {
    const { unmount } = render(<ItineraryView itinerary={makeItinerary()} />);
    expect(
      screen.queryByRole('button', { name: /create trip workspace/i })
    ).not.toBeInTheDocument();
    unmount();

    render(<ItineraryView itinerary={makeItinerary()} onCreateTripWorkspace={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create trip workspace/i })).toBeInTheDocument();
  });

  it('invokes the handler with the itinerary when clicked', async () => {
    const user = userEvent.setup();
    const onCreateTripWorkspace = vi.fn();
    const itinerary = makeItinerary();

    render(<ItineraryView itinerary={itinerary} onCreateTripWorkspace={onCreateTripWorkspace} />);

    await user.click(screen.getByRole('button', { name: /create trip workspace/i }));
    expect(onCreateTripWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateTripWorkspace).toHaveBeenCalledWith(itinerary);
  });
});
