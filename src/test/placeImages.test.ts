import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../types/travel';
import { enrichPlacesWithImages, resolvePlaceImageUrl } from '../services/placeImages';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as unknown as Response;
}

function mockFetchRoutes(routes: Array<{ match: string; data: unknown }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = routes.find((r) => url.includes(r.match));
      if (hit) {
        return jsonResponse(hit.data);
      }
      throw new Error(`No fetch mock for ${url}`);
    })
  );
}

const THUMB =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Colosseum.jpg/720px-Colosseum.jpg';
const CANDIDATE =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Colosseum.jpg/200px-Colosseum.jpg';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolvePlaceImageUrl', () => {
  it('verifies and resolves a Wikimedia candidate URL', async () => {
    mockFetchRoutes([
      {
        match: 'titles=File%3AColosseum.jpg',
        data: {
          query: { pages: { '-1': { imageinfo: [{ thumburl: THUMB, mime: 'image/jpeg' }] } } },
        },
      },
    ]);

    const url = await resolvePlaceImageUrl('Colosseum', 'Rome', 'Italy', CANDIDATE);
    expect(url).toBe(THUMB);
  });

  it('caches resolved URLs so repeat lookups skip the network', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        query: {
          pages: {
            '-1': {
              imageinfo: [
                { thumburl: 'https://upload.wikimedia.org/gate-thumb.jpg', mime: 'image/jpeg' },
              ],
            },
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const candidate =
      'https://upload.wikimedia.org/wikipedia/commons/a/b4/Brandenburg_Gate.jpg/720px-Brandenburg_Gate.jpg';

    const first = await resolvePlaceImageUrl('Brandenburg Gate', 'Berlin', 'Germany', candidate);
    const second = await resolvePlaceImageUrl('Brandenburg Gate', 'Berlin', 'Germany', candidate);
    expect(first).toBe('https://upload.wikimedia.org/gate-thumb.jpg');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Wikipedia lead image when no candidate is provided', async () => {
    mockFetchRoutes([
      {
        match: 'gsrlimit=5',
        data: {
          query: {
            pages: {
              '14000': {
                title: 'Colosseum',
                index: 1,
                thumbnail: { source: 'https://upload.wikimedia.org/colosseum-lead.jpg' },
                extract: 'The Colosseum is an amphitheatre in the centre of Rome, Italy.',
              },
            },
          },
        },
      },
    ]);

    const url = await resolvePlaceImageUrl('Colosseum & Ancient Forum', 'Rome', 'Italy');
    expect(url).toBe('https://upload.wikimedia.org/colosseum-lead.jpg');
  });

  it('falls back to Wikimedia Commons when Wikipedia has no match', async () => {
    mockFetchRoutes([
      { match: 'gsrlimit=5', data: { query: { pages: {} } } },
      {
        match: 'gsrlimit=8',
        data: {
          query: {
            pages: {
              '-1': {
                title: 'File:Tower_Bridge_London.jpg',
                index: 1,
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/tower-bridge-thumb.jpg',
                    mime: 'image/jpeg',
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    const url = await resolvePlaceImageUrl('Tower Bridge', 'London', 'United Kingdom');
    expect(url).toBe('https://upload.wikimedia.org/tower-bridge-thumb.jpg');
  });

  it('returns an empty string when no authentic picture can be found', async () => {
    mockFetchRoutes([
      { match: 'gsrlimit=5', data: { query: { pages: {} } } },
      { match: 'gsrlimit=8', data: { query: { pages: {} } } },
    ]);

    const url = await resolvePlaceImageUrl('Nonexistent Spot', 'Atlantis', 'Atlantis');
    expect(url).toBe('');
  });

  it('rejects a non-Wikimedia candidate URL', async () => {
    mockFetchRoutes([
      { match: 'gsrlimit=5', data: { query: { pages: {} } } },
      { match: 'gsrlimit=8', data: { query: { pages: {} } } },
    ]);

    const url = await resolvePlaceImageUrl(
      'Some Place',
      'Paris',
      'France',
      'https://example.com/foo.jpg'
    );
    expect(url).toBe('');
  });

  it('rejects a Wikimedia candidate that is not an image', async () => {
    mockFetchRoutes([
      { match: 'gsrlimit=5', data: { query: { pages: {} } } },
      { match: 'gsrlimit=8', data: { query: { pages: {} } } },
    ]);

    const url = await resolvePlaceImageUrl(
      'Map Place',
      'Berlin',
      'Germany',
      'https://upload.wikimedia.org/map.pdf'
    );
    expect(url).toBe('');
  });
});

describe('enrichPlacesWithImages', () => {
  it('blanks generic stock photos and keeps original URLs in place', async () => {
    mockFetchRoutes([
      { match: 'gsrlimit=5', data: { query: { pages: {} } } },
      { match: 'gsrlimit=8', data: { query: { pages: {} } } },
    ]);

    const places: Place[] = [
      {
        id: 'a',
        name: 'Nothing Found',
        categoryId: 'cat-hist',
        location: [0, 0],
        city: 'Rome',
        country: 'Italy',
        description: 'x',
        imageUrl: 'https://images.unsplash.com/photo-1',
        averageRating: 4,
        reviewCount: 1,
      },
      {
        id: 'b',
        name: '',
        categoryId: 'cat-hist',
        location: [0, 0],
        city: 'Rome',
        country: 'Italy',
        description: 'x',
        imageUrl: 'https://hello.example/img.jpg',
        averageRating: 4,
        reviewCount: 1,
      },
      {
        id: 'c',
        name: 'Wiki Kept',
        categoryId: 'cat-hist',
        location: [0, 0],
        city: 'Rome',
        country: 'Italy',
        description: 'x',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/x/Kept.jpg',
        averageRating: 4,
        reviewCount: 1,
      },
    ];

    const out = await enrichPlacesWithImages(places);
    expect(out).toBe(places);
    expect(out[0].imageUrl).toBe('');
    expect(out[1].imageUrl).toBe('https://hello.example/img.jpg');
    expect(out[2].imageUrl).toBe('https://upload.wikimedia.org/wikipedia/commons/x/Kept.jpg');
  });

  it('fills a real image URL for a place that resolves', async () => {
    mockFetchRoutes([
      {
        match: 'gsrlimit=5',
        data: {
          query: {
            pages: {
              '1': {
                title: 'Montmartre',
                index: 1,
                thumbnail: { source: 'https://upload.wikimedia.org/montmartre.jpg' },
                extract: 'Montmartre is a hill in Paris, France.',
              },
            },
          },
        },
      },
    ]);

    const places: Place[] = [
      {
        id: 'p1',
        name: 'Montmartre',
        categoryId: 'cat-hist',
        location: [48.8867, 2.3431],
        city: 'Paris',
        country: 'France',
        description: 'Hilltop artists quarter',
        imageUrl: 'https://images.unsplash.com/photo-stock',
        averageRating: 4.5,
        reviewCount: 10,
      },
    ];

    const out = await enrichPlacesWithImages(places);
    expect(out[0].imageUrl).toBe('https://upload.wikimedia.org/montmartre.jpg');
  });
});
