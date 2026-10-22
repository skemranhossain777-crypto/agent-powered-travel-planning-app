import { describe, expect, it } from 'vitest';
import {
  createGooglePlacesDiscoveryAdapter,
  GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
} from '../services/googleDiscovery/googlePlacesAdapter';
import { GOOGLE_PLACES_PROVIDER_ID, GOOGLE_PLACES_PROVIDER_NAME } from '../services/googleDiscovery/googlePlacesConfig';
import {
  buildProviderExecutionSuccess,
} from '../domain/providers/executionOperations';

const NOW = '2026-09-13T08:00:00.000Z';

const QUERY = {
  latitude: 52.3676,
  longitude: 4.9041,
  radiusMeters: 5000,
  category: 'hotels' as const,
  resultLimit: 20,
};

const READY_CONFIG = {
  attemptEnabled: true,
  credentials: { apiKey: 'secret-key' },
};

const DISABLED_CONFIG = { attemptEnabled: false, credentials: null };

function placePayload(places: unknown): unknown {
  return { places };
}

describe('STEP 44 Google Places adapter factory', () => {
  it('is not operational on the default disabled config', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(DISABLED_CONFIG);
    expect(adapter.isOperational()).toBe(false);
    expect(adapter.id()).toBe(GOOGLE_PLACES_PROVIDER_ID);
    expect(adapter.name()).toBe(GOOGLE_PLACES_PROVIDER_NAME);
    expect(adapter.profile.id).toBe('google-places');
    expect(adapter.profile.capabilities).toEqual([]);
  });

  it('is operational only in the ready gate state', () => {
    expect(
      createGooglePlacesDiscoveryAdapter({ attemptEnabled: true, credentials: null }).isOperational()
    ).toBe(false);
    expect(createGooglePlacesDiscoveryAdapter(READY_CONFIG).isOperational()).toBe(true);
  });

  it('returns a bounded credentials-missing failure while not configured', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(DISABLED_CONFIG);
    const result = adapter.search(QUERY, NOW, () => placePayload([]));
    expect(result).not.toBeNull();
    expect(result?.status).toBe('failure');
    expect(result?.error?.category).toBe('credentials-missing');
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('maps a valid payload into the shared success envelope contract', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const result = adapter.search(
      QUERY,
      NOW,
      () => placePayload([{ id: 'h1', displayName: { text: 'Hotel One' }, primaryType: 'hotel' }])
    );
    expect(result).not.toBeNull();
    expect(result?.status).toBe('success');
    const data = result?.data ?? [];
    expect(result?.operation).toBe('search');
    expect(result?.providerId).toBe('google-places');
    expect(result?.providerName).toBe('Google Places');
    expect(result?.performedAt).toBe(NOW);
    expect(data).toHaveLength(1);
    expect(data[0].resultId).toBe('h1');
    expect(data[0].category).toBe('accommodation');
    expect(data[0].title).toBe('Hotel One');
  });

  it('a payload with no usable results succeeds with an empty array (never a fake)', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const result = adapter.search(QUERY, NOW, () => ({ places: [] }));
    expect(result?.status).toBe('success');
    expect(result?.data).toEqual([]);
  });

  it('a missing or failing payload provider stays bounded and throws nothing', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const noProvider = adapter.search(QUERY, NOW, () => null);
    expect(noProvider?.status).toBe('failure');
    expect(noProvider?.error?.category).toBe('provider-unavailable');
    expect(noProvider?.error?.message).toBe(GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE);

    const throwingAdapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const throwing = throwingAdapter.search(QUERY, NOW, () => {
      throw new Error('boom secret');
    });
    expect(throwing?.status).toBe('failure');
    expect(throwing?.error?.message).toBe(GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE);
    expect(JSON.stringify(throwing)).not.toContain('boom');
    expect(JSON.stringify(throwing)).not.toContain('secret');
  });

  it('bounds the returned results to the requested limit', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const manyPlaces = Array.from({ length: 25 }, (_, index) => ({
      id: `p-${index}`,
      displayName: { text: `Place ${index}` },
    }));
    const result = adapter.search(
      { ...QUERY, category: 'museums', resultLimit: 5 },
      NOW,
      () => placePayload(manyPlaces)
    );
    expect(result?.status).toBe('success');
    if (result?.status === 'success') {
      expect(result.data).toHaveLength(5);
    }
  });

  it('preserves the shared success-envelope idiom with a trusted success helper', () => {
    const trusted = buildProviderExecutionSuccess(
      'search',
      { id: 'google-places', name: 'Google Places' },
      [{ providerId: 'google-places' } as never],
      NOW
    );
    expect(trusted).not.toBeNull();
    expect(trusted?.status).toBe('success');
  });
});