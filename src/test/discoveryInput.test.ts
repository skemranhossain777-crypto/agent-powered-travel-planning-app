import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_CATEGORIES,
  MAX_DISCOVERY_DESTINATION_LENGTH,
  MAX_DISCOVERY_RESULT_LIMIT,
  MAX_DISCOVERY_TRAVELER_COUNT,
  getTripDiscoveryQueryProblem,
  isDiscoveryCategory,
  isTripDiscoveryQuery,
  normalizeTripDiscoveryQuery,
} from '../domain/providers/discoveryInput';

describe('DiscoveryCategory vocabulary', () => {
  it('isDiscoveryCategory recognizes transport and accommodation', () => {
    expect(isDiscoveryCategory('transport')).toBe(true);
    expect(isDiscoveryCategory('accommodation')).toBe(true);
    expect(isDiscoveryCategory('activity')).toBe(false);
    expect(isDiscoveryCategory('')).toBe(false);
    expect(isDiscoveryCategory(null)).toBe(false);
  });

  it('DISCOVERY_CATEGORIES exposes exactly two values', () => {
    expect(DISCOVERY_CATEGORIES).toEqual(['transport', 'accommodation']);
  });
});

describe('normalizeTripDiscoveryQuery', () => {
  it('accepts a minimal valid query (transport, destination only)', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Paris',
    });
    expect(result).toEqual({
      category: 'transport',
      destination: 'Paris',
    });
  });

  it('accepts a full query with all optional fields', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'accommodation',
      destination: ' Bali',
      origin: 'London',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      travelerCount: 2,
      currency: 'eur',
    });
    expect(result).toEqual({
      category: 'accommodation',
      destination: 'Bali',
      origin: 'London',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      travelerCount: 2,
      currency: 'EUR',
    });
  });

  it('trims destination and drops empty strings', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: '  Paris  ',
    });
    expect(result?.destination).toBe('Paris');
  });

  it('normalizes currency to uppercase', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Berlin',
      currency: 'usd',
    });
    expect(result?.currency).toBe('USD');
  });

  it('drops empty or whitespace-only optional strings', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Rome',
      origin: '  ',
    });
    expect(result).toEqual({
      category: 'transport',
      destination: 'Rome',
    });
  });

  it('rejects a non-object', () => {
    expect(normalizeTripDiscoveryQuery(null)).toBeNull();
    expect(normalizeTripDiscoveryQuery('invalid')).toBeNull();
    expect(normalizeTripDiscoveryQuery(123)).toBeNull();
  });

  it('rejects an empty object', () => {
    expect(normalizeTripDiscoveryQuery({})).toBeNull();
  });

  it('rejects unknown keys', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        providerId: 'abc',
      })
    ).toBeNull();
  });

  it('rejects missing category', () => {
    expect(
      normalizeTripDiscoveryQuery({
        destination: 'Paris',
      })
    ).toBeNull();
  });

  it('rejects invalid category', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'activity',
        destination: 'Paris',
      })
    ).toBeNull();
  });

  it('rejects missing destination', () => {
    expect(normalizeTripDiscoveryQuery({ category: 'transport' })).toBeNull();
  });

  it('rejects empty destination', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: '  ',
      })
    ).toBeNull();
  });

  it('rejects destination too long', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'x'.repeat(MAX_DISCOVERY_DESTINATION_LENGTH + 1),
      })
    ).toBeNull();
  });

  it('rejects non-string destination', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 42,
      })
    ).toBeNull();
  });

  it('rejects invalid start date format', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        startDate: '09-11-2026',
      })
    ).toBeNull();
  });

  it('rejects non-real start date (month 13)', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        startDate: '2026-13-01',
      })
    ).toBeNull();
  });

  it('rejects invalid end date format', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        startDate: '2026-09-10',
        endDate: '09-17-2026',
      })
    ).toBeNull();
  });

  it('rejects end date before start date', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        startDate: '2026-09-20',
        endDate: '2026-09-10',
      })
    ).toBeNull();
  });

  it('accepts end date equal to start date', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Paris',
      startDate: '2026-09-10',
      endDate: '2026-09-10',
    });
    expect(result?.startDate).toBe('2026-09-10');
    expect(result?.endDate).toBe('2026-09-10');
  });

  it('rejects non-integer traveler count', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        travelerCount: 1.5,
      })
    ).toBeNull();
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        travelerCount: '2',
      })
    ).toBeNull();
  });

  it('rejects traveler count <= 0', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        travelerCount: 0,
      })
    ).toBeNull();
  });

  it('rejects traveler count above the documented bound', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        travelerCount: MAX_DISCOVERY_TRAVELER_COUNT + 1,
      })
    ).toBeNull();
  });

  it('rejects currency with non-letters', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        currency: 'US1',
      })
    ).toBeNull();
  });

  it('rejects currency longer than the documented bound', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        currency: 'abcdefghi',
      })
    ).toBeNull();
  });

  it('accepts a valid result limit and preserves it', () => {
    const result = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Paris',
      limit: 1,
    });
    expect(result?.limit).toBe(1);
    const maxed = normalizeTripDiscoveryQuery({
      category: 'transport',
      destination: 'Paris',
      limit: MAX_DISCOVERY_RESULT_LIMIT,
    });
    expect(maxed?.limit).toBe(MAX_DISCOVERY_RESULT_LIMIT);
  });

  it('rejects a non-integer result limit', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        limit: 1.5,
      })
    ).toBeNull();
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        limit: '2',
      })
    ).toBeNull();
  });

  it('rejects a result limit of zero or negative', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        limit: 0,
      })
    ).toBeNull();
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        limit: -2,
      })
    ).toBeNull();
  });

  it('rejects a result limit above the documented bound', () => {
    expect(
      normalizeTripDiscoveryQuery({
        category: 'transport',
        destination: 'Paris',
        limit: MAX_DISCOVERY_RESULT_LIMIT + 1,
      })
    ).toBeNull();
  });

  it('isTripDiscoveryQuery matches normalizeTripDiscoveryQuery', () => {
    expect(isTripDiscoveryQuery({ category: 'transport', destination: 'Paris' })).toBe(true);
    expect(isTripDiscoveryQuery({ category: 'transport' })).toBe(false);
  });
});

describe('getTripDiscoveryQueryProblem', () => {
  it('returns null for a well-formed query', () => {
    expect(
      getTripDiscoveryQueryProblem({ category: 'transport', destination: 'Paris' })
    ).toBeNull();
  });

  it('reports not-an-object for primitives', () => {
    expect(getTripDiscoveryQueryProblem(null)).toEqual(
      expect.objectContaining({ code: 'not-an-object' })
    );
  });

  it('reports unknown-key with the offending key', () => {
    const problem = getTripDiscoveryQueryProblem({
      category: 'transport',
      destination: 'Paris',
      providerId: 'abc',
    });
    expect(problem).toEqual(expect.objectContaining({ code: 'unknown-key', key: 'providerId' }));
  });

  it('reports missing-category when category is omitted', () => {
    expect(getTripDiscoveryQueryProblem({ destination: 'Paris' })).toEqual(
      expect.objectContaining({ code: 'missing-category' })
    );
  });

  it('reports invalid-category for a wrong category', () => {
    expect(getTripDiscoveryQueryProblem({ category: 'activity', destination: 'Paris' })).toEqual(
      expect.objectContaining({ code: 'invalid-category' })
    );
  });

  it('reports missing-destination when destination is absent', () => {
    expect(getTripDiscoveryQueryProblem({ category: 'transport' })).toEqual(
      expect.objectContaining({ code: 'missing-destination' })
    );
  });

  it('reports destination-too-long for a string over the bound', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'x'.repeat(MAX_DISCOVERY_DESTINATION_LENGTH + 1),
      })
    ).toEqual(expect.objectContaining({ code: 'destination-too-long' }));
  });

  it('reports invalid-start-date for a bad date format', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        startDate: '09-11-2026',
      })
    ).toEqual(expect.objectContaining({ code: 'invalid-start-date' }));
  });

  it('reports end-before-start when end precedes start', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        startDate: '2026-09-20',
        endDate: '2026-09-10',
      })
    ).toEqual(expect.objectContaining({ code: 'end-before-start' }));
  });

  it('reports end-without-start when end is set but start is not', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        endDate: '2026-09-10',
      })
    ).toEqual(expect.objectContaining({ code: 'end-without-start' }));
  });

  it('reports invalid-traveler-count for a non-number', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        travelerCount: '2',
      })
    ).toEqual(expect.objectContaining({ code: 'invalid-traveler-count' }));
  });

  it('reports traveler-count-out-of-range for zero or negative', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        travelerCount: 0,
      })
    ).toEqual(expect.objectContaining({ code: 'traveler-count-out-of-range' }));
  });

  it('reports invalid-currency for a code with spaces', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        currency: 'US D',
      })
    ).toEqual(expect.objectContaining({ code: 'invalid-currency' }));
  });

  it('reports the first problem in canonical order (unknown-key first)', () => {
    const problem = getTripDiscoveryQueryProblem({ foo: 'bar' });
    expect(problem?.code).toBe('unknown-key');
  });

  it('reports origin-invalid when origin is non-string', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        origin: 123,
      })
    ).toEqual(expect.objectContaining({ code: 'origin-invalid' }));
  });

  it('reports origin-too-long for a string over the bound', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        origin: 'x'.repeat(121),
      })
    ).toEqual(expect.objectContaining({ code: 'origin-too-long' }));
  });

  it('reports invalid-limit for a non-number limit', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        limit: '2',
      })
    ).toEqual(expect.objectContaining({ code: 'invalid-limit' }));
  });

  it('reports limit-out-of-range for zero or an over-bound limit', () => {
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        limit: 0,
      })
    ).toEqual(expect.objectContaining({ code: 'limit-out-of-range' }));
    expect(
      getTripDiscoveryQueryProblem({
        category: 'transport',
        destination: 'Paris',
        limit: MAX_DISCOVERY_RESULT_LIMIT + 1,
      })
    ).toEqual(expect.objectContaining({ code: 'limit-out-of-range' }));
  });
});
