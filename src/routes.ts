import type { ActiveView } from './stores/uiStore';

/**
 * Type-safe mapping between application views and their URLs.
 * The URL is the single source of truth for the active view; the Zustand
 * store is only a UI compatibility layer fed from these paths.
 */
export const VIEW_PATH: Record<ActiveView, string> = {
  explore: '/explore',
  bookmarks: '/bookmarks',
  itineraries: '/itineraries',
  profile: '/profile',
};

const VIEWS: ReadonlyArray<ActiveView> = ['explore', 'bookmarks', 'itineraries', 'profile'];

/**
 * Route prefix for Trip Workspaces (standalone screens rendered outside the
 * main App shell). Parameterized by a Firestore document id.
 */
export const TRIPS_PATH = '/trips';

export function tripPath(tripId: string): string {
  return `${TRIPS_PATH}/${encodeURIComponent(tripId)}`;
}

export function pathToView(pathname: string): ActiveView {
  for (const view of VIEWS) {
    if (VIEW_PATH[view] === pathname) {
      return view;
    }
  }
  return 'explore';
}

export function viewToPath(view: ActiveView): string {
  return VIEW_PATH[view];
}
