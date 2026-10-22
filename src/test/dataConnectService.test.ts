import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../types/travel';

vi.mock('../services/firestoreService', () => ({
  firestoreService: {
    getReviewsForPlace: vi.fn(async () => []),
    updateUserProfile: vi.fn(async () => {}),
    recordActivity: vi.fn(async () => {}),
    createReview: vi.fn(async () => {}),
    setBookmark: vi.fn(async () => {}),
    removeBookmark: vi.fn(async () => {}),
    saveItinerary: vi.fn(async () => {}),
    deleteItinerary: vi.fn(async () => {}),
  },
}));

async function freshDataConnect() {
  vi.resetModules();
  const mod = await import('../services/dataConnectService');
  return mod.dataConnect;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('dataConnectService - read-only seed data', () => {
  it('exposes the six seed categories', async () => {
    const dc = await freshDataConnect();
    const cats = await dc.getCategories();
    expect(cats).toHaveLength(6);
    expect(cats[0].id).toBe('cat-rest');
  });

  it('filters places by category', async () => {
    const dc = await freshDataConnect();
    const places = await dc.getPlaces('cat-rest');
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((p) => p.categoryId === 'cat-rest')).toBe(true);
  });

  it('searches places by free text', async () => {
    const dc = await freshDataConnect();
    const byName = await dc.getPlaces('all', 'la pergola');
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toContain('La Pergola');

    const byCity = await dc.getPlaces('all', 'kyoto');
    expect(byCity.map((p) => p.name)).toContain('Arashiyama Bamboo Grove');
  });

  it('returns a place by id', async () => {
    const dc = await freshDataConnect();
    const place = await dc.getPlaceById('place-3');
    expect(place?.city).toBe('Kyoto');
    expect(await dc.getPlaceById('missing')).toBeUndefined();
  });
});

describe('dataConnectService - signed-out guards', () => {
  it('throws when a signed-out user tries to bookmark', async () => {
    const dc = await freshDataConnect();
    await expect(dc.toggleBookmark('place-1')).rejects.toThrow(
      'You must be signed in to save places.'
    );
  });

  it('throws when a signed-out user tries to leave a review', async () => {
    const dc = await freshDataConnect();
    await expect(dc.createReview('place-1', 5, 'nice')).rejects.toThrow(
      'You must be signed in to leave a review.'
    );
  });

  it('throws when a signed-out user tries to save a trip', async () => {
    const dc = await freshDataConnect();
    const itinerary = { destination: 'X' } as unknown as Itinerary;
    await expect(dc.saveItinerary(itinerary)).rejects.toThrow(
      'You must be signed in to save trips.'
    );
  });
});

describe('dataConnectService - signed-in behavior', () => {
  it('toggles bookmarks for a signed-in user', async () => {
    const dc = await freshDataConnect();
    dc.setActiveUser('usr-test-1');

    expect(await dc.isBookmarked('place-1')).toBe(false);
    expect(await dc.toggleBookmark('place-1')).toBe(true);
    expect(await dc.isBookmarked('place-1')).toBe(true);

    const my = await dc.getMyBookmarks();
    expect(my.map((p) => p.id)).toContain('place-1');

    expect(await dc.toggleBookmark('place-1')).toBe(false);
    expect(await dc.isBookmarked('place-1')).toBe(false);
  });

  it('recalculates a place rating after a review', async () => {
    const dc = await freshDataConnect();
    dc.setActiveUser('usr-test-2');
    await dc.createReview('place-1', 3, 'ok');

    const place = await dc.getPlaceById('place-1');
    expect(place?.reviewCount).toBe(2);
    expect(place?.averageRating).toBe(4);
  });

  it('bounds activity to the latest 120 events', async () => {
    const dc = await freshDataConnect();
    dc.setActiveUser('usr-test-3');
    for (let i = 0; i < 130; i++) {
      dc.recordActivityFromService(
        'discover',
        { placeName: 'X', city: 'Y', country: 'Z' },
        'usr-test-3'
      );
    }
    const activity = dc.getActivity('usr-test-3');
    expect(activity).toHaveLength(120);
  });

  it('creates a new place with seeded defaults', async () => {
    const dc = await freshDataConnect();
    const created = await dc.createPlace({
      name: 'Test Spot',
      categoryId: 'cat-shop',
      location: [1, 2],
      city: 'Lisbon',
      country: 'Portugal',
      description: 'A shop',
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(created.averageRating).toBe(5);
    expect(created.reviewCount).toBe(1);
    expect(created.category?.id).toBe('cat-shop');

    const fetched = await dc.getPlaceById(created.id);
    expect(fetched?.name).toBe('Test Spot');
  });

  it('returns the default profile for unknown users', async () => {
    const dc = await freshDataConnect();
    const profile = dc.getUserProfile('nobody');
    expect(profile.interests).toContain('Culture & Heritage');
  });
});
