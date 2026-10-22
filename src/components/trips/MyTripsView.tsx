import React from 'react';
import { Briefcase, CalendarDays, Clock, Compass, MapPin } from 'lucide-react';
import type { TripStatus, TripWorkspace } from '../../types/trip';
import { getTripDurationDays } from '../../domain/trips/tripModel';

/**
 * Discriminated UI state for the "My Trips" list. The container derives this
 * union; this view only renders it. Note `status: 'ready'` is a non-empty list
 * — an empty result is presented as `status: 'empty'`.
 */
export type MyTripsViewState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; trips: TripWorkspace[] };

interface MyTripsViewProps {
  state: MyTripsViewState;
  onOpenTrip: (tripId: string) => void;
  /** Fired by the signed-out prompt so the user can reach the sign-in entry points. */
  onBrowse: () => void;
}

const STATUS_STYLE: Record<TripStatus, { color: string; background: string; border: string }> = {
  draft: {
    color: '#94a3b8',
    background: 'rgba(148,163,184,0.12)',
    border: '1px solid rgba(148,163,184,0.35)',
  },
  planning: {
    color: '#00f2fe',
    background: 'rgba(0,242,254,0.12)',
    border: '1px solid rgba(0,242,254,0.35)',
  },
  ready: {
    color: '#4ade80',
    background: 'rgba(74,222,128,0.12)',
    border: '1px solid rgba(74,222,128,0.35)',
  },
  in_progress: {
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.12)',
    border: '1px solid rgba(251,191,36,0.35)',
  },
  completed: {
    color: '#d8b4fe',
    background: 'rgba(216,180,254,0.12)',
    border: '1px solid rgba(216,180,254,0.35)',
  },
  cancelled: {
    color: '#fca5a5',
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
  },
};

export const MyTripsView: React.FC<MyTripsViewProps> = ({ state, onOpenTrip, onBrowse }) => {
  if (state.status === 'loading') {
    return (
      <div className="state-panel">
        <div className="state-panel-icon">
          <Compass className="w-7 h-7" />
        </div>
        <h3>Loading your trips…</h3>
      </div>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <div className="state-panel">
        <div className="state-panel-icon">
          <Briefcase className="w-7 h-7" />
        </div>
        <h3>Sign in to view your trips</h3>
        <p>Trip workspaces are private to their owner until shared.</p>
        <button type="button" onClick={onBrowse} className="btn-primary">
          Browse Places
        </button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="state-panel">
        <div className="state-panel-icon">
          <Compass className="w-7 h-7" />
        </div>
        <h3>Could not load your trips</h3>
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="state-panel">
        <div className="state-panel-icon">
          <Briefcase className="w-7 h-7" />
        </div>
        <h3>No trips yet</h3>
        <p>Generate an itinerary, then create a Trip Workspace to start planning it.</p>
        <button type="button" onClick={onBrowse} className="btn-primary">
          Browse Places
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {state.trips.map((trip) => (
        <TripListCard key={trip.id} trip={trip} onOpenTrip={onOpenTrip} />
      ))}
    </div>
  );
};

function TripListCard({
  trip,
  onOpenTrip,
}: {
  trip: TripWorkspace;
  onOpenTrip: (tripId: string) => void;
}) {
  const statusStyle = STATUS_STYLE[trip.status];
  const destinationSummary = trip.destinations
    .map((destination) => destination.name)
    .filter(Boolean);
  const durationDays = trip.dateRange ? getTripDurationDays(trip.dateRange) : 0;

  return (
    <button
      type="button"
      onClick={() => onOpenTrip(trip.id)}
      className="trip-card"
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        padding: '1.25rem 1.5rem',
        borderRadius: '20px',
        background: 'rgba(15,23,42,0.75)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'inherit',
        fontFamily: 'inherit',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span
          style={{
            padding: '0.25rem 0.75rem',
            borderRadius: '9999px',
            ...statusStyle,
            fontSize: '0.72rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          <Briefcase className="w-3.5 h-3.5" />
          {trip.status}
        </span>
        {trip.dateRange && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#e2e8f0',
            }}
          >
            <CalendarDays className="w-4 h-4" style={{ color: '#00f2fe' }} />
            {trip.dateRange.startDate} → {trip.dateRange.endDate}
          </span>
        )}
      </div>

      <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', margin: 0 }}>
        {trip.title}
      </h3>

      {destinationSummary.length > 0 ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#cbd5e1',
          }}
        >
          <MapPin className="w-4 h-4" style={{ color: '#d8b4fe', flexShrink: 0 }} />
          {destinationSummary.join(', ')}
        </span>
      ) : (
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>No destinations yet.</span>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
          marginTop: '0.25rem',
        }}
      >
        {durationDays > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: '#94a3b8',
            }}
          >
            <Clock className="w-3.5 h-3.5" />
            {durationDays} {durationDays === 1 ? 'day' : 'days'}
          </span>
        )}
        {trip.itinerary && (
          <span
            style={{
              padding: '0.2rem 0.6rem',
              borderRadius: '9999px',
              background: 'rgba(112,0,255,0.15)',
              border: '1px solid rgba(168,85,247,0.4)',
              color: '#d8b4fe',
              fontSize: '0.72rem',
              fontWeight: 800,
            }}
          >
            Itinerary attached
          </span>
        )}
      </div>
    </button>
  );
}
