import { describe, expect, it } from 'vitest';
import {
  MAX_RESULT_METADATA_ITEMS,
  MAX_RESULT_METADATA_KEY_LENGTH,
  MAX_RESULT_METADATA_VALUE_LENGTH,
  getTripProviderResultRecencyWarning,
  isTripProviderResult,
  isTripProviderResultAvailability,
  isTripProviderResultExpired,
  normalizeTripProviderResult,
  TRIP_PROVIDER_RESULT_AVAILABILITIES,
} from '../domain/providers/providerResults';

const VALID_RESULT = {
  providerId: 'provider-a',
  providerName: 'Provider A',
  resultId: 'res-1',
  category: 'transport',
  title: 'Morning train to Lyon',
  retrievedAt: '2026-09-01T09:00:00Z',
};

const NOW = '2026-09-02T09:00:00Z';

describe('STEP 20 normalized provider result contract', () => {
  it('recognizes the four availability labels and rejects junk', () => {
    expect(TRIP_PROVIDER_RESULT_AVAILABILITIES).toEqual([
      'available',
      'limited',
      'unavailable',
      'unknown',
    ]);
    for (const a of TRIP_PROVIDER_RESULT_AVAILABILITIES) {
      expect(isTripProviderResultAvailability(a)).toBe(true);
    }
    for (const junk of ['in-stock', 'sold-out', 1, null, {}]) {
      expect(isTripProviderResultAvailability(junk)).toBe(false);
    }
  });

  it('normalizes a minimal result, defaults availability to unknown, and strips runtime keys', () => {
    expect(normalizeTripProviderResult({ ...VALID_RESULT, runtimeKey: 'drop-me' })).toEqual({
      providerId: 'provider-a',
      providerName: 'Provider A',
      resultId: 'res-1',
      category: 'transport',
      title: 'Morning train to Lyon',
      retrievedAt: '2026-09-01T09:00:00Z',
      availability: 'unknown',
    });
    expect(isTripProviderResult(VALID_RESULT)).toBe(true);
  });

  it('normalizes optional transport/detail fields, trimming and bounding strings', () => {
    const result = normalizeTripProviderResult({
      ...VALID_RESULT,
      category: 'accommodation',
      title: '  Hôtel Belle Époque  ',
      summary: '  Riverside stay  ',
      origin: 'Paris',
      destination: 'Lyon',
      departureAt: '2026-09-01T08:30:00Z',
      arrivalAt: '2026-09-01T10:00:00Z',
      durationMinutes: 90,
      price: { amount: 129.5, currency: 'EUR' },
      cancellationPolicy: 'Free cancellation until 24h before',
      sourceUrl: 'https://example.com/morning-train',
      expiresAt: '2026-09-01T11:00:00Z',
      availability: 'limited',
      limitations: ['  No refunds after check-in  '],
      warnings: ['  Platforms may change  '],
    });
    expect(result).toEqual({
      providerId: 'provider-a',
      providerName: 'Provider A',
      resultId: 'res-1',
      category: 'accommodation',
      title: 'Hôtel Belle Époque',
      summary: 'Riverside stay',
      origin: 'Paris',
      destination: 'Lyon',
      departureAt: '2026-09-01T08:30:00Z',
      arrivalAt: '2026-09-01T10:00:00Z',
      durationMinutes: 90,
      price: { amount: 129.5, currency: 'EUR' },
      cancellationPolicy: 'Free cancellation until 24h before',
      sourceUrl: 'https://example.com/morning-train',
      retrievedAt: '2026-09-01T09:00:00Z',
      expiresAt: '2026-09-01T11:00:00Z',
      availability: 'limited',
      limitations: ['No refunds after check-in'],
      warnings: ['Platforms may change'],
    });
  });

  it('rejects missing required fields and unknown categories', () => {
    expect(
      normalizeTripProviderResult({
        providerName: 'X',
        resultId: 'r',
        category: 'transport',
        title: 'T',
        retrievedAt: '2026-09-01',
      })
    ).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, providerId: '   ' })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, category: 'boat' })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, retrievedAt: 'yesterday' })).toBeNull();
    expect(normalizeTripProviderResult(null)).toBeNull();
  });

  it('enforces bounds: over-long strings, negative/zero duration, and bad prices reject', () => {
    expect(normalizeTripProviderResult({ ...VALID_RESULT, title: 'x'.repeat(201) })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, durationMinutes: 0 })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, durationMinutes: 1.5 })).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, price: { amount: -1, currency: 'USD' } })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, price: { amount: 1, currency: 'USD$' } })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({
        ...VALID_RESULT,
        price: { amount: Number.NaN, currency: 'USD' },
      })
    ).toBeNull();
  });

  it('rejects malformed optional timestamps and expiry before retrieval', () => {
    expect(normalizeTripProviderResult({ ...VALID_RESULT, departureAt: 'tommorow' })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, arrivalAt: 5 })).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, expiresAt: '2026-08-30T09:00:00Z' })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, expiresAt: '2026-09-01T09:00:00Z' })
    ).not.toBeNull();
  });

  it('rejects an unsafe sourceUrl even when everything else is valid', () => {
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, sourceUrl: 'javascript:alert(1)' })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, sourceUrl: 'https://example.com/ok' })
    ).not.toBeNull();
  });

  it('rejects malformed limitation/warning items (whole record rejected, never guessed)', () => {
    expect(normalizeTripProviderResult({ ...VALID_RESULT, limitations: [42] })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, warnings: ['ok', 42] })).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, limitations: ['x'.repeat(201)] })
    ).toBeNull();
  });
});

describe('STEP 39 provider result metadata', () => {
  it('normalizes and preserves a valid metadata list as isolated pairs', () => {
    const result = normalizeTripProviderResult({
      ...VALID_RESULT,
      metadata: [
        { key: ' vehicle-class ', value: '  sample high-speed rail ' },
        { key: 'operator', value: 'sample carrier' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual([
      { key: 'vehicle-class', value: 'sample high-speed rail' },
      { key: 'operator', value: 'sample carrier' },
    ]);
  });

  it('keeps metadata through rebuild while stripping runtime keys', () => {
    const result = normalizeTripProviderResult({
      ...VALID_RESULT,
      runtimeKey: 'drop-me',
      metadata: [{ key: 'cabin', value: 'sample class' }],
    });
    expect(result).toEqual({
      providerId: 'provider-a',
      providerName: 'Provider A',
      resultId: 'res-1',
      category: 'transport',
      title: 'Morning train to Lyon',
      retrievedAt: '2026-09-01T09:00:00Z',
      availability: 'unknown',
      metadata: [{ key: 'cabin', value: 'sample class' }],
    });
  });

  it('a result without metadata carries no metadata key', () => {
    const result = normalizeTripProviderResult(VALID_RESULT)!;
    expect(result).not.toHaveProperty('metadata');
  });

  it('rejects an empty metadata pair key or value (whole record rejected)', () => {
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, metadata: [{ key: '  ', value: 'v' }] })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, metadata: [{ key: 'k', value: '  ' }] })
    ).toBeNull();
  });

  it('rejects malformed metadata items: non-objects, missing keys, non-string values', () => {
    expect(normalizeTripProviderResult({ ...VALID_RESULT, metadata: ['nope'] })).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, metadata: [{ value: 'v' }] })).toBeNull();
    expect(
      normalizeTripProviderResult({ ...VALID_RESULT, metadata: [{ key: 'k', value: 42 }] })
    ).toBeNull();
    expect(normalizeTripProviderResult({ ...VALID_RESULT, metadata: [null] })).toBeNull();
  });

  it('rejects metadata keys or values beyond the documented bounds', () => {
    expect(
      normalizeTripProviderResult({
        ...VALID_RESULT,
        metadata: [{ key: 'x'.repeat(MAX_RESULT_METADATA_KEY_LENGTH + 1), value: 'v' }],
      })
    ).toBeNull();
    expect(
      normalizeTripProviderResult({
        ...VALID_RESULT,
        metadata: [{ key: 'k', value: 'x'.repeat(MAX_RESULT_METADATA_VALUE_LENGTH + 1) }],
      })
    ).toBeNull();
  });

  it('rejects metadata lists beyond the documented item bound', () => {
    const tooMany = Array.from({ length: MAX_RESULT_METADATA_ITEMS + 1 }, (_, i) => ({
      key: `k${i}`,
      value: 'v',
    }));
    expect(normalizeTripProviderResult({ ...VALID_RESULT, metadata: tooMany })).toBeNull();
  });
});

describe('STEP 20 provider result staleness', () => {
  it('isTripProviderResultExpired only when a freshness bound has passed', () => {
    const fresh = normalizeTripProviderResult({
      ...VALID_RESULT,
      expiresAt: '2026-09-10T09:00:00Z',
    })!;
    const stale = normalizeTripProviderResult({
      ...VALID_RESULT,
      expiresAt: '2026-09-01T09:00:00Z',
    })!;
    expect(isTripProviderResultExpired(fresh, NOW)).toBe(false);
    expect(isTripProviderResultExpired(stale, NOW)).toBe(true);
  });

  it('a result with no expiresAt is never expired and reports lack of freshness bound', () => {
    const noBound = normalizeTripProviderResult(VALID_RESULT)!;
    expect(isTripProviderResultExpired(noBound, NOW)).toBe(false);
    expect(getTripProviderResultRecencyWarning(noBound, NOW)).toContain('no freshness bound');
  });

  it('never reports stale or unbounded results as fresh', () => {
    const stale = normalizeTripProviderResult({
      ...VALID_RESULT,
      expiresAt: '2026-09-01T09:00:00Z',
    })!;
    expect(getTripProviderResultRecencyWarning(stale, NOW)).toContain('expired');
    const fresh = normalizeTripProviderResult({
      ...VALID_RESULT,
      expiresAt: '2026-09-10T09:00:00Z',
    })!;
    expect(getTripProviderResultRecencyWarning(fresh, NOW)).toBeUndefined();
  });
});
