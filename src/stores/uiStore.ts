import { create } from 'zustand';

/**
 * The primary application views, matching the existing tab/navigation values.
 * `profile` is the signed-in user area; the other three are the main content views.
 */
export type ActiveView = 'explore' | 'bookmarks' | 'itineraries' | 'profile';

export const DEFAULT_ACTIVE_VIEW: ActiveView = 'explore';

interface UiState {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  resetUiState: () => void;
}

/**
 * Global UI state. Contains only low-risk, view-level UI state — no domain
 * data (places, bookmarks, itineraries, users) and no service instances.
 * Deliberately not persisted: a page refresh restores the default view,
 * matching the pre-Zustand behavior.
 */
export const useUiStore = create<UiState>((set) => ({
  activeView: DEFAULT_ACTIVE_VIEW,
  setActiveView: (view) => set({ activeView: view }),
  resetUiState: () => set({ activeView: DEFAULT_ACTIVE_VIEW }),
}));
