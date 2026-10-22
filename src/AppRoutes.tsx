import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { useUiStore } from './stores/uiStore';
import type { ActiveView } from './stores/uiStore';
import { TripWorkspacePage } from './components/trips/TripWorkspacePage';
import { MyTripsPage } from './components/trips/MyTripsPage';
import { TRIPS_PATH, VIEW_PATH } from './routes';

/**
 * Keeps the Zustand UI store in sync with the URL (one direction only:
 * URL -> store). The store never writes back to the URL, so there is no
 * navigation loop and the URL stays the single source of truth.
 */
function SyncActiveView({ view }: { view: ActiveView }) {
  useEffect(() => {
    const store = useUiStore.getState();
    if (store.activeView !== view) {
      store.setActiveView(view);
    }
  }, [view]);
  return null;
}

function ViewRoute({ view }: { view: ActiveView }) {
  return (
    <>
      <SyncActiveView view={view} />
      <App />
    </>
  );
}

/**
 * Root composition layer for all application views. The root path and any
 * unknown path redirect to /explore, matching the historical default view.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={VIEW_PATH.explore} replace />} />
      <Route path={VIEW_PATH.explore} element={<ViewRoute view="explore" />} />
      <Route path={VIEW_PATH.bookmarks} element={<ViewRoute view="bookmarks" />} />
      <Route path={VIEW_PATH.itineraries} element={<ViewRoute view="itineraries" />} />
      <Route path={VIEW_PATH.profile} element={<ViewRoute view="profile" />} />
      <Route path={TRIPS_PATH} element={<MyTripsPage />} />
      <Route path={`${TRIPS_PATH}/:tripId`} element={<TripWorkspacePage />} />
      <Route path="*" element={<Navigate to={VIEW_PATH.explore} replace />} />
    </Routes>
  );
}
