import { describe, expect, it } from 'vitest';
import {
  MAX_DISCOVERY_RESULT_LIMIT,
  validateServerDiscoveryRequest,
} from '../services/serverBoundary/serverDiscoveryValidation';

const VALID_QUERY = {
  category: 'accommodation',
  destination: 'AMS',
  startDate: '2026-09-20',
  endDate: '2026-09-25',
  travelerCount: 2,
  currency: 'eur',
  limit: 5,
};

describe('STEP 42 validateServerDiscoveryRequest', () => {
  it('accepts a well-formed discovery query and returns the normalized query', () => {
    const result = validateServerDiscoveryRequest(VALID_QUERY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.category).toBe('accommodation');
    expect(result.query.destination).toBe('AMS');
    expect(result.query.startDate).toBe('2026-09-20');
    expect(result.query.endDate).toBe('2026-09-25');
    expect(result.query.travelerCount).toBe(2);
    expect(result.query.currency).toBe('EUR');
    expect(result.query.limit).toBe(5);
  });

  it('accepts the minimal valid query shape', () => {
    const result = validateServerDiscoveryRequest({
      category: 'accommodation',
      destination: 'Par',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.destination).toBe('Par');
    expect(result.query.origin).toBeUndefined();
    expect(result.query.travelerCount).toBeUndefined();
    expect(result.query.limit).toBeUndefined();
  });

  it('rejects a non-object body as not-an-object', () => {
    const result = validateServerDiscoveryRequest('not an object');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('not-an-object');
  });

  it('rejects body through plain JSON.stringify', () => {
    const result = validateServerDiscoveryRequest(JSON.stringify('nested'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('not-an-object');
  });

  it('rejects a raw array body', () => {
    const result = validateServerDiscoveryRequest([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('not-an-object');
  });

  it('rejects unknown keys so the browser can never select a provider/endpoint', () => {
    const result = validateServerDiscoveryRequest({
      ...VALID_QUERY,
      endpoint: 'https://evil.example.invalid',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('unknown-key');
  });

  it('rejects arbitrary request headers and raw provider fields', () => {
    const withProviderField = validateServerDiscoveryRequest({
      ...VALID_QUERY,
      provider: 'some-other-provider',
    });
    expect(withProviderField.ok).toBe(false);
    if (withProviderField.ok) return;
    expect(withProviderField.problem.code).toBe('unknown-key');
  });

  it('rejects tainted provider endpoints nested in the body', () => {
    const result = validateServerDiscoveryRequest({
      ...VALID_QUERY,
      url: 'https://browser.supplied.example.invalid',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('unknown-key');
  });

  it('requires a discovery category', () => {
    const result = validateServerDiscoveryRequest({ destination: 'AMS' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('missing-category');
  });

  it('rejects an unsupported discovery category (book/pay/verify impossible)', () => {
    const result = validateServerDiscoveryRequest({
      category: 'booking',
      destination: 'AMS',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('invalid-category');
  });

  it('requires a destination', () => {
    const result = validateServerDiscoveryRequest({ category: 'accommodation' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('missing-destination');
  });

  it('rejects an over-long destination', () => {
    const result = validateServerDiscoveryRequest({
      category: 'accommodation',
      destination: 'X'.repeat(121),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('destination-too-long');
  });

  it('rejects an invalid ISO start date', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, startDate: '20-09-2026' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('invalid-start-date');
  });

  it('rejects end-before-start date ranges', () => {
    const result = validateServerDiscoveryRequest({
      ...VALID_QUERY,
      startDate: '2026-09-25',
      endDate: '2026-09-20',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('end-before-start');
  });

  it('rejects an end date without a start date', () => {
    const result = validateServerDiscoveryRequest({
      category: 'accommodation',
      destination: 'AMS',
      endDate: '2026-09-20',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('end-without-start');
  });

  it('rejects an out-of-range traveler count', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, travelerCount: 51 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('traveler-count-out-of-range');
  });

  it('rejects a non-string traveler count', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, travelerCount: 'two' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('invalid-traveler-count');
  });

  it('rejects an invalid currency', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, currency: 'EURO123' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('invalid-currency');
  });

  it('rejects a limit above the bounded maximum', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, limit: 26 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('limit-out-of-range');
  });

  it('rejects an invalid origin', () => {
    const result = validateServerDiscoveryRequest({ ...VALID_QUERY, origin: 123 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe('origin-invalid');
  });

  it('never throws on any input shape', () => {
    const shapes: unknown[] = [
      null,
      undefined,
      42,
      true,
      Symbol('x'),
      { category: 7 },
      { category: 'accommodation', destination: { nested: true } },
      Object.create(null),
    ];
    for (const shape of shapes) {
      expect(() => validateServerDiscoveryRequest(shape)).not.toThrow();
    }
  });

  it('re-exports the bounded discovery result limit', () => {
    expect(MAX_DISCOVERY_RESULT_LIMIT).toBe(25);
  });
});
