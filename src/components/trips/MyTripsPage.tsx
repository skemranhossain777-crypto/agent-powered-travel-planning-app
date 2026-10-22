import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { tripService, TripPermissionError } from '../../services/tripService';
import { MyTripsView, type MyTripsViewState } from './MyTripsView';
import { VIEW_PATH, tripPath } from '../../routes';
import { ArrowLeft, Briefcase } from 'lucide-react';
import type { User } from '../../types/travel';
import type { TripWorkspace } from '../../types/trip';

/**
 * Standalone "My Trips" screen, rendered by the `/trips` route — outside the
 * App shell (no Navbar/global state), matching the Trip Workspace screen.
 *
 * The loading boundary is the authenticated user: until auth is known the view
 * derives to the signed-out prompt, and the owner-scoped list is only fetched
 * once `user.id` is available. `ownerId` is derived from the authenticated
 * user here — never from a client-supplied field — so the service call is the
 * authorized one by construction. On auth transitions the effect re-runs and
 * the previous result cannot leak in because every fetch is cancelled on
 * cleanup.
 */
type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; ownerId: string; trips: TripWorkspace[] };

export function MyTripsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => authService.user);
  const [list, setList] = useState<ListState>({ status: 'loading' });

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | undefined;
    queueMicrotask(() => {
      if (disposed) return;
      unsub = authService.subscribe((next) => setUser(next));
    });
    return () => {
      disposed = true;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const trips = await tripService.listTripsForOwner(user.id);
        if (cancelled) return;
        setList({ status: 'ready', ownerId: user.id, trips });
      } catch (err) {
        if (cancelled) return;
        setList({ status: 'error', message: safeListMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const viewState: MyTripsViewState = (() => {
    if (!user) return { status: 'signed-out' };
    if (list.status === 'loading') return { status: 'loading' };
    if (list.status === 'error') return { status: 'error', message: list.message };
    if (list.ownerId !== user.id) return { status: 'loading' };
    if (list.trips.length === 0) return { status: 'empty' };
    return { status: 'ready', trips: list.trips };
  })();

  return (
    <div className="section-container animate-fade-in">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <Link
          to={VIEW_PATH.explore}
          className="btn-secondary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.82rem' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Explore
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          marginBottom: '1.5rem',
        }}
      >
        <span className="state-panel-icon" style={{ width: 44, height: 44 }}>
          <Briefcase className="w-6 h-6" />
        </span>
        <div>
          <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: '#fff', margin: 0 }}>
            My Trips
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
            Your Trip Workspaces, newest activity first.
          </p>
        </div>
      </div>

      <MyTripsView
        state={viewState}
        onOpenTrip={(tripId) => navigate(tripPath(tripId))}
        onBrowse={() => navigate(VIEW_PATH.explore)}
      />
    </div>
  );
}

/**
 * Collapses any list failure into a safe, user-facing message. Raw Firebase
 * error text never reaches the view: known permission problems get a clear
 * sentence and everything else becomes a neutral retry hint.
 */
function safeListMessage(err: unknown): string {
  if (err instanceof TripPermissionError) {
    return 'You do not have access to this list.';
  }
  return 'Please try again in a moment.';
}
