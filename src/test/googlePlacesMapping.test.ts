import { describe, expect, it } from 'vitest';
import {
  GOOGLE_PLACES_APP_CATEGORIES,
  GOOGLE_PLACES_DEFAULT_RESULT_LIMIT,
  GOOGLE_PLACES_MAX_RESULT_LIMIT,
  bookingCategoryForRequestedCategory,
  getGooglePlacesIncludedTypes,
  getGooglePlacesNearbyQueryProblem,
  isGooglePlacesAppCategory,
  isGooglePlacesNearbyQuery,
  mapGooglePlacesNearbyResponse,
  normalizeGooglePlacesNearbyQuery,
} from '../services/googleDiscovery/googlePlacesMapping';

const NOW = '2026-09-13T08:00:00.000Z';

const VALID_QUERY = {
  latitude: 52.3676,
  longitude: 4.9041,
  radiusMeters: 5000,
  category: 'museums' as const,
  resultLimit: 5,
};

function validPlace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'place-1',
    displayName: { text: 'Rijksmuseum' },
    formattedAddress: 'Museumstraat 1, Amsterdam',
    location: { latitude: 52.36, longitude: 4.8852 },
    primaryType: 'museum',
    rating: 4.7,
    userRatingCount: 5678,
    googleMapsUri: 'https://maps.google.com/?cid=1',
    ...overrides,
  };
}

describe('STEP 44 Google Places approved application categories', () => {
  it('defines exactly the twelve approved categories and recognizes them', () => {
    expect(GOOGLE_PLACES_APP_CATEGORIES).toEqual([
      'attractions',
      'landmarks',
      'museums',
      'parks',
      'beaches',
      'entertainment',
      'activities',
      'shopping',
      'restaurants',
      'cafes',
      'hotels',
      'resorts',
    ]);
    for (const category of GOOGLE_PLACES_APP_CATEGORIES) {
      expect(isGooglePlacesAppCategory(category)).toBe(true);
    }
    expect(isGooglePlacesAppCategory('casino')).toBe(false);
    expect(isGooglePlacesAppCategory('tours')).toBe(false);
    expect(isGooglePlacesAppCategory(42)).toBe(false);
    expect(isGooglePlacesAppCategory(undefined)).toBe(false);
  });

  it('emits a fixed, non-empty includedTypes table for every approved category', () => {
    for (const category of GOOGLE_PLACES_APP_CATEGORIES) {
      const types = getGooglePlacesIncludedTypes(category);
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    }
  });

  it('maps hotels and resorts to accommodation, food/shopping to other, rest to activity', () => {
    expect(bookingCategoryForRequestedCategory('hotels')).toBe('accommodation');
    expect(bookingCategoryForRequestedCategory('resorts')).toBe('accommodation');
    expect(bookingCategoryForRequestedCategory('restaurants')).toBe('other');
    expect(bookingCategoryForRequestedCategory('cafes')).toBe('other');
    expect(bookingCategoryForRequestedCategory('shopping')).toBe('other');
    expect(bookingCategoryForRequestedCategory('museums')).toBe('activity');
    expect(bookingCategoryForRequestedCategory('parks')).toBe('activity');
    expect(bookingCategoryForRequestedCategory('beaches')).toBe('activity');
  });
});

describe('STEP 44 bounding the Google Places nearby query', () => {
  it('accepts a complete, valid query and fills the default result limit', () => {
    expect(normalizeGooglePlacesNearbyQuery(VALID_QUERY)).toEqual(VALID_QUERY);
    expect(normalizeGooglePlacesNearbyQuery({ ...VALID_QUERY, resultLimit: 3 })).toEqual({
      ...VALID_QUERY,
      resultLimit: 3,
    });
    expect(
      normalizeGooglePlacesNearbyQuery({
        latitude: 52.3676,
        longitude: 4.9041,
        radiusMeters: 5000,
        category: 'museums',
      })
    ).toEqual({ ...VALID_QUERY, resultLimit: GOOGLE_PLACES_DEFAULT_RESULT_LIMIT });
    expect(isGooglePlacesNearbyQuery(VALID_QUERY)).toBe(true);
  });

  it('rejects non-objects and unknown keys (no provider-parameter smuggling)', () => {
    expect(normalizeGooglePlacesNearbyQuery(null)).toBeNull();
    expect(normalizeGooglePlacesNearbyQuery('nope')).toBeNull();
    expect(getGooglePlacesNearbyQueryProblem('nope')?.code).toBe('not-an-object');
    const problem = getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, openNow: true });
    expect(problem).toEqual({
      code: 'unknown-key',
      key: 'openNow',
      message: 'Google Places nearby queries do not accept the field "openNow".',
    });
  });

  it('enforces finite, geographic coordinates', () => {
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, latitude: 'x' })?.code).toBe(
      'invalid-latitude'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, latitude: NaN })?.code).toBe(
      'invalid-latitude'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, latitude: 91 })?.code).toBe(
      'latitude-out-of-range'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, latitude: -91 })?.code).toBe(
      'latitude-out-of-range'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, longitude: 'x' })?.code).toBe(
      'invalid-longitude'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, longitude: 181 })?.code).toBe(
      'longitude-out-of-range'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, longitude: -181 })?.code).toBe(
      'longitude-out-of-range'
    );
  });

  it('enforces a positive, bounded radius', () => {
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, radiusMeters: 'x' })?.code).toBe(
      'invalid-radius'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, radiusMeters: -5 })?.code).toBe(
      'radius-out-of-range'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, radiusMeters: 0 })?.code).toBe(
      'radius-out-of-range'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, radiusMeters: 50001 })?.code).toBe(
      'radius-out-of-range'
    );
  });

  it('rejects unapproved categories and out-of-range result limits', () => {
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, category: 'boats' })?.code).toBe(
      'invalid-category'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, resultLimit: 2.5 })?.code).toBe(
      'invalid-result-limit'
    );
    expect(getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, resultLimit: 0 })?.code).toBe(
      'result-limit-out-of-range'
    );
    expect(
      getGooglePlacesNearbyQueryProblem({ ...VALID_QUERY, resultLimit: GOOGLE_PLACES_MAX_RESULT_LIMIT + 1 })
        ?.code
    ).toBe('result-limit-out-of-range');
    expect(
      normalizeGooglePlacesNearbyQuery({ ...VALID_QUERY, resultLimit: GOOGLE_PLACES_MAX_RESULT_LIMIT })
    ).toEqual({ ...VALID_QUERY, resultLimit: GOOGLE_PLACES_MAX_RESULT_LIMIT });
  });
});

describe('STEP 44 mapping a Google Places nearby response', () => {
  it('maps a full place into the normalized shared result contract', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      { places: [validPlace()] },
      VALID_QUERY,
      NOW
    );
    expect(mapped).toHaveLength(1);
    const result = mapped[0];
    expect(result.providerId).toBe('google-places');
    expect(result.providerName).toBe('Google Places');
    expect(result.resultId).toBe('place-1');
    expect(result.category).toBe('activity');
    expect(result.title).toBe('Rijksmuseum');
    expect(result.summary).toBe('Museumstraat 1, Amsterdam');
    expect(result.sourceUrl).toBe('https://maps.google.com/?cid=1');
    expect(result.retrievedAt).toBe(NOW);
    expect(result.expiresAt).toBe('2026-09-13T09:00:00.000Z');
    const metadata = Object.fromEntries((result.metadata ?? []).map((m) => [m.key, m.value]));
    expect(metadata['google-place-id']).toBe('place-1');
    expect(metadata['requested-category']).toBe('museums');
    expect(metadata['google-primary-type']).toBe('museum');
    expect(metadata['google-latitude']).toBe('52.36');
    expect(metadata['google-longitude']).toBe('4.8852');
    expect(metadata['google-formatted-address']).toBe('Museumstraat 1, Amsterdam');
    expect(metadata['google-rating']).toBe('4.7');
    expect(metadata['google-user-rating-count']).toBe('5678');
  });

  it('accepts responses with absent or empty places arrays as honest empties', () => {
    expect(mapGooglePlacesNearbyResponse({}, VALID_QUERY, NOW)).toEqual([]);
    expect(mapGooglePlacesNearbyResponse({ places: [] }, VALID_QUERY, NOW)).toEqual([]);
    expect(mapGooglePlacesNearbyResponse(null, VALID_QUERY, NOW)).toEqual([]);
    expect(mapGooglePlacesNearbyResponse('nope', VALID_QUERY, NOW)).toEqual([]);
  });

  it('drops a malformed place while keeping valid siblings', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      {
        places: [
          validPlace({ id: undefined }),
          validPlace({ displayName: undefined }),
          validPlace(),
        ],
      },
      VALID_QUERY,
      NOW
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0].resultId).toBe('place-1');
  });

  it('drops invalid ratings and rating counts rather than fabricating them', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      {
        places: [
          validPlace({ id: 'neg', rating: -1 }),
          validPlace({ id: 'high', rating: 7 }),
          validPlace({ id: 'fract', userRatingCount: 2.5 }),
          validPlace({ id: 'nar', rating: '4.5' }),
        ],
      },
      VALID_QUERY,
      NOW
    );
    const metadataOf = (id: string) =>
      Object.fromEntries(
        (mapped.find((r) => r.resultId === id)?.metadata ?? []).map((m) => [m.key, m.value])
      );
    for (const id of ['neg', 'high', 'nar']) {
      expect(metadataOf(id)['google-rating']).toBeUndefined();
    }
    expect(metadataOf('fract')['google-rating']).toBe('4.7');
    expect(metadataOf('neg')['google-user-rating-count']).toBe('5678');
    expect(metadataOf('high')['google-user-rating-count']).toBe('5678');
    expect(metadataOf('fract')['google-user-rating-count']).toBeUndefined();
    expect(metadataOf('nar')['google-user-rating-count']).toBe('5678');
  });

  it('drops unsafe and malformed source URLs without applying host policy of its own', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      {
        places: [
          validPlace({ id: 'js', googleMapsUri: 'javascript:alert(1)' }),
          validPlace({ id: 'space', googleMapsUri: 'https://maps.google.com/a b' }),
          validPlace({ id: 'blank', formattedAddress: '   ' }),
          validPlace({ id: 'long', formattedAddress: 'a'.repeat(600) }),
        ],
      },
      VALID_QUERY,
      NOW
    );
    const byId = Object.fromEntries(mapped.map((r) => [r.resultId, r]));
    expect(byId['js'].sourceUrl).toBeUndefined();
    expect(byId['space'].sourceUrl).toBeUndefined();
    expect(byId['blank'].summary).toBeUndefined();
    expect(byId['long'].summary).toBeUndefined();
  });

  it('promotes a resort only when the provider classifies it as a resort', () => {
    const resorts = mapGooglePlacesNearbyResponse(
      {
        places: [
          validPlace({ id: 'resort', primaryType: 'resort_hotel', displayName: { text: 'R1' } }),
          validPlace({ id: 'plain', primaryType: 'hotel', displayName: { text: 'R2' } }),
        ],
      },
      { ...VALID_QUERY, category: 'resorts' },
      NOW
    );
    for (const result of resorts) {
      const metadata = Object.fromEntries((result.metadata ?? []).map((m) => [m.key, m.value]));
      expect(metadata['requested-category']).toBe('resorts');
      expect(result.category).toBe('accommodation');
    }
    expect(
      Object.fromEntries((resorts[0].metadata ?? []).map((m) => [m.key, m.value]))[
        'google-primary-type'
      ]
    ).toBe('resort_hotel');
    expect(
      Object.fromEntries((resorts[1].metadata ?? []).map((m) => [m.key, m.value]))[
        'google-primary-type'
      ]
    ).toBe('hotel');
  });

  it('omits unsafe and malformed source URLs and long/blank addresses', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      {
        places: [
          validPlace({ id: 'http', googleMapsUri: 'http://insecure.example.com' }),
          validPlace({ id: 'blank', formattedAddress: '   ' }),
          validPlace({ id: 'long', formattedAddress: 'a'.repeat(600) }),
        ],
      },
      VALID_QUERY,
      NOW
    );
    const byId = Object.fromEntries(mapped.map((r) => [r.resultId, r]));
    expect(byId['blank'].summary).toBeUndefined();
    expect(byId['long'].summary).toBeUndefined();
  });

  it('echoes the provider result on a fixed freshness window of 60 minutes', () => {
    const mapped = mapGooglePlacesNearbyResponse(
      { places: [validPlace()] },
      VALID_QUERY,
      '2026-01-01T00:00:00.000Z'
    );
    expect(mapped[0].expiresAt).toBe('2026-01-01T01:00:00.000Z');
  });
});