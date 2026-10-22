import { describe, expect, it } from 'vitest';
import {
  buildGooglePlacesNotPreparedOutcome,
  googlePlacesNotConfiguredOutcome,
  googlePlacesSafeErrorToOutcome,
  hasGooglePlacesDiscoveryResults,
  isGooglePlacesDiscoveryAvailable,
  runGooglePlacesDiscoveryOnline,
  type GooglePlacesDiscoveryOutcome,
} from '../services/googleDiscovery/googlePlacesService';
import { GOOGLE_PLACES_PROVIDER_ID, GOOGLE_PLACES_PROVIDER_NAME } from '../services/googleDiscovery/googlePlacesConfig';
import type { GooglePlacesPayloadProvider } from '../services/googleDiscovery/googlePlacesAdapter';

const NOW = '2026-09-13T08:00:00.000Z';

const VALID_QUERY = {
  latitude: 52.3676,
  longitude: 4.9041,
  radiusMeters: 5000,
  category: 'hotels' as const,
  resultLimit: 5,
};

const READY_CONFIG = {
  attemptEnabled: true,
  credentials: { apiKey: 'secret-key' },
};

function payloadProvider(places: unknown[]): GooglePlacesPayloadProvider {
  return () => ({ places });
}

function expectBound(
  outcome: GooglePlacesDiscoveryOutcome,
  status: GooglePlacesDiscoveryOutcome['status'],
  query: GooglePlacesDiscoveryOutcome['query'] = VALID_QUERY
) {
  expect(outcome.status).toBe(status);
  expect(outcome.providerId).toBe(GOOGLE_PLACES_PROVIDER_ID);
  expect(outcome.providerName).toBe(GOOGLE_PLACES_PROVIDER_NAME);
  expect(outcome.query).toEqual(query);
  expect(outcome.createdAt).toBe(NOW);
  expect(outcome.limitations.length).toBeGreaterThan(0);
  expect(JSON.stringify(outcome)).not.toContain('secret-key');
}

describe('STEP 44 Google Places discovery service outcomes', () => {
  it('not-configured on the default disabled config with no key anywhere', () => {
    const outcome = runGooglePlacesDiscoveryOnline(
      { attemptEnabled: false, credentials: null },
      VALID_QUERY,
      NOW,
      () => ({ places: [] })
    );
    expectBound(outcome, 'not-configured');
    expect(outcome.error?.category).toBe('provider-unavailable');
    expect(outcome.results).toEqual([]);
  });

  it('not-configured with a credentials-missing safe error when enabled but keyless', () => {
    const outcome = runGooglePlacesDiscoveryOnline(
      { attemptEnabled: true, credentials: null },
      VALID_QUERY,
      NOW,
      () => ({ places: [] })
    );
    expectBound(outcome, 'not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
  });

  it('invalid-input never reaches the provider for a rejected query shape', () => {
    const invalidQuery = { ...VALID_QUERY, latitude: 95 };
    const outcome = runGooglePlacesDiscoveryOnline(
      READY_CONFIG,
      invalidQuery,
      NOW,
      () => ({ places: [] })
    );
    expectBound(outcome, 'invalid-input', invalidQuery);
    expect(outcome.error?.message).toContain('latitude');
  });

  it('provider-failure stays bounded and secret-free when the payload source fails', () => {
    const outcome = runGooglePlacesDiscoveryOnline(READY_CONFIG, VALID_QUERY, NOW, () => {
      throw new Error('boom secret');
    });
    expectBound(outcome, 'provider-failure');
    expect(outcome.error?.category).toBe('provider-unavailable');
  });

  it('success carries only normalized application results', () => {
    const outcome = runGooglePlacesDiscoveryOnline(
      READY_CONFIG,
      VALID_QUERY,
      NOW,
      payloadProvider([{ id: 'h1', displayName: { text: 'Hotel One' }, primaryType: 'hotel' }])
    );
    expectBound(outcome, 'success');
    expect(outcome.error).toBeNull();
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].title).toBe('Hotel One');
    expect(hasGooglePlacesDiscoveryResults(outcome)).toBe(true);
    expect(isGooglePlacesDiscoveryAvailable(outcome)).toBe(true);
  });

  it('empty reports honestly when the provider returns nothing usable, success only when it does', () => {
    const empty = runGooglePlacesDiscoveryOnline(READY_CONFIG, VALID_QUERY, NOW, () => ({
      places: [],
    }));
    expectBound(empty, 'empty');
    expect(empty.error).toBeNull();
    expect(hasGooglePlacesDiscoveryResults(empty)).toBe(false);
    expect(isGooglePlacesDiscoveryAvailable(empty)).toBe(true);

    const invalid = runGooglePlacesDiscoveryOnline(
      READY_CONFIG,
      VALID_QUERY,
      NOW,
      () => ({ places: [{ id: 'no-name' }] })
    );
    expectBound(invalid, 'empty');
    expect(hasGooglePlacesDiscoveryResults(invalid)).toBe(false);
  });

  it('maps a safe error into a bounded provider-failure outcome', () => {
    const outcome = googlePlacesSafeErrorToOutcome(
      { category: 'network-error', message: 'Google Places could not be reached.' },
      VALID_QUERY,
      NOW
    );
    expectBound(outcome, 'provider-failure');
    expect(outcome.error).toEqual({
      category: 'network-error',
      message: 'Google Places could not be reached.',
    });
  });

  it('the not-prepared path stays credentials-missing and bounded', () => {
    const outcome = buildGooglePlacesNotPreparedOutcome(VALID_QUERY, NOW);
    expectBound(outcome, 'not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
  });

  it('the dedicated not-configured helper is stable and secret-free', () => {
    const outcome = googlePlacesNotConfiguredOutcome(VALID_QUERY, NOW);
    expectBound(outcome, 'not-configured');
  });
});