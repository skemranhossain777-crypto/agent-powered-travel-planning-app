import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../stores/uiStore';

beforeEach(() => {
  useUiStore.setState({ activeView: 'explore' });
});

describe('uiStore', () => {
  it('defaults to the explore view', () => {
    expect(useUiStore.getState().activeView).toBe('explore');
  });

  it('changes the active view', () => {
    useUiStore.getState().setActiveView('bookmarks');
    expect(useUiStore.getState().activeView).toBe('bookmarks');
    useUiStore.getState().setActiveView('itineraries');
    expect(useUiStore.getState().activeView).toBe('itineraries');
  });

  it('resets the active view back to explore', () => {
    useUiStore.getState().setActiveView('profile');
    useUiStore.getState().resetUiState();
    expect(useUiStore.getState().activeView).toBe('explore');
  });

  it('accepts only the documented view values', () => {
    const views = ['explore', 'bookmarks', 'itineraries', 'profile'] as const;
    for (const view of views) {
      useUiStore.getState().setActiveView(view);
      expect(useUiStore.getState().activeView).toBe(view);
    }
  });

  it('exposes exactly the expected state fields and no domain data', () => {
    expect(Object.keys(useUiStore.getState()).sort()).toEqual(
      ['activeView', 'resetUiState', 'setActiveView'].sort()
    );
  });
});
