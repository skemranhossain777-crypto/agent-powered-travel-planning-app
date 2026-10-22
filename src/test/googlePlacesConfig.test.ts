import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOOGLE_PLACES_CONFIG,
  GOOGLE_PLACES_ENABLED_DEFAULT,
  GOOGLE_PLACES_PROVIDER_ID,
  GOOGLE_PLACES_PROVIDER_NAME,
  MAX_GOOGLE_PLACES_API_KEY_LENGTH,
  getGooglePlacesAttemptGate,
  googlePlacesCredentialsMissingError,
  isGooglePlacesReady,
  loadGooglePlacesConfigFromEnv,
  normalizeGooglePlacesCredentials,
  normalizeGooglePlacesConfig,
} from '../services/googleDiscovery/googlePlacesConfig';

describe('STEP 44 Google Places config identity and defaults', () => {
  it('exposes the stable application-facing provider identity', () => {
    expect(GOOGLE_PLACES_PROVIDER_ID).toBe('google-places');
    expect(GOOGLE_PLACES_PROVIDER_NAME).toBe('Google Places');
  });

  it('the browser default is always attempt-disabled and credential-free', () => {
    expect(DEFAULT_GOOGLE_PLACES_CONFIG).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
    expect(DEFAULT_GOOGLE_PLACES_CONFIG.attemptEnabled).toBe(false);
    expect(GOOGLE_PLACES_ENABLED_DEFAULT).toBe(false);
  });

  it('a disabled default never resolves to a ready gate', () => {
    expect(getGooglePlacesAttemptGate(DEFAULT_GOOGLE_PLACES_CONFIG)).toBe('disabled');
    expect(isGooglePlacesReady(DEFAULT_GOOGLE_PLACES_CONFIG)).toBe(false);
  });
});

describe('STEP 44 normalizing Google Places credentials', () => {
  it('accepts a complete credential pair with the server-side API key', () => {
    expect(normalizeGooglePlacesCredentials({ apiKey: 'secret-key' })).toEqual({
      apiKey: 'secret-key',
    });
  });

  it('trims surrounding whitespace from the API key', () => {
    expect(normalizeGooglePlacesCredentials({ apiKey: '  key-1  ' })).toEqual({
      apiKey: 'key-1',
    });
  });

  it('rejects missing, empty, non-object, non-string, or over-long keys', () => {
    expect(normalizeGooglePlacesCredentials(null)).toBeNull();
    expect(normalizeGooglePlacesCredentials('nope')).toBeNull();
    expect(normalizeGooglePlacesCredentials({})).toBeNull();
    expect(normalizeGooglePlacesCredentials({ apiKey: '' })).toBeNull();
    expect(normalizeGooglePlacesCredentials({ apiKey: '   ' })).toBeNull();
    expect(normalizeGooglePlacesCredentials({ apiKey: 42 })).toBeNull();
    expect(normalizeGooglePlacesCredentials({ apiKey: 'a'.repeat(501) })).toBeNull();
    expect(
      normalizeGooglePlacesCredentials({ apiKey: 'a'.repeat(MAX_GOOGLE_PLACES_API_KEY_LENGTH) })
    ).toEqual({ apiKey: 'a'.repeat(500) });
  });
});

describe('STEP 44 normalizing Google Places config', () => {
  it('accepts an enabled, keyed config', () => {
    expect(
      normalizeGooglePlacesConfig({
        attemptEnabled: true,
        credentials: { apiKey: 'key-1' },
      })
    ).toEqual({ attemptEnabled: true, credentials: { apiKey: 'key-1' } });
  });

  it('accepts an enabled config without credentials as null credentials', () => {
    expect(normalizeGooglePlacesConfig({ attemptEnabled: true })).toEqual({
      attemptEnabled: true,
      credentials: null,
    });
  });

  it('rejects non-boolean switches, malformed credentials, and non-objects', () => {
    expect(normalizeGooglePlacesConfig(null)).toBeNull();
    expect(normalizeGooglePlacesConfig('nope')).toBeNull();
    expect(normalizeGooglePlacesConfig({ attemptEnabled: 'yes' })).toBeNull();
    expect(normalizeGooglePlacesConfig({ attemptEnabled: 1 })).toBeNull();
    expect(normalizeGooglePlacesConfig({ attemptEnabled: true, credentials: 'bad' })).toBeNull();
    expect(
      normalizeGooglePlacesConfig({ attemptEnabled: true, credentials: { apiKey: 42 } })
    ).toBeNull();
  });
});

describe('STEP 44 resolving the attempt gate', () => {
  it('disabled when the switch is not explicitly on, even with a key present', () => {
    expect(
      getGooglePlacesAttemptGate({ attemptEnabled: false, credentials: { apiKey: 'key-1' } })
    ).toBe('disabled');
    expect(
      isGooglePlacesReady({ attemptEnabled: false, credentials: { apiKey: 'key-1' } })
    ).toBe(false);
  });

  it('credentials-missing when enabled but no key exists', () => {
    expect(getGooglePlacesAttemptGate({ attemptEnabled: true, credentials: null })).toBe(
      'credentials-missing'
    );
    expect(isGooglePlacesReady({ attemptEnabled: true, credentials: null })).toBe(false);
  });

  it('ready only when both the switch and a valid key are present', () => {
    expect(
      getGooglePlacesAttemptGate({ attemptEnabled: true, credentials: { apiKey: 'key-1' } })
    ).toBe('ready');
    expect(isGooglePlacesReady({ attemptEnabled: true, credentials: { apiKey: 'key-1' } })).toBe(
      true
    );
  });
});

describe('STEP 44 loading Google Places config from an env map', () => {
  it('the browser default (no env map) stays fully disabled with no keys', () => {
    expect(loadGooglePlacesConfigFromEnv({})).toEqual({ attemptEnabled: false, credentials: null });
  });

  it('reads only the documented non-VITE_ server-side keys', () => {
    expect(
      loadGooglePlacesConfigFromEnv({
        GOOGLE_PLACES_ENABLED: 'true',
        GOOGLE_PLACES_API_KEY: 'key-1',
      })
    ).toEqual({ attemptEnabled: true, credentials: { apiKey: 'key-1' } });
    expect(loadGooglePlacesConfigFromEnv({ GOOGLE_PLACES_ENABLED: '1' })).toEqual({
      attemptEnabled: true,
      credentials: null,
    });
  });

  it('treats any other switch spelling as disabled and lopsied secrets as missing', () => {
    expect(
      loadGooglePlacesConfigFromEnv({
        GOOGLE_PLACES_ENABLED: 'TRUE',
        GOOGLE_PLACES_API_KEY: 'key-1',
      })
    ).toEqual({ attemptEnabled: false, credentials: { apiKey: 'key-1' } });
    expect(loadGooglePlacesConfigFromEnv({ GOOGLE_PLACES_API_KEY: '   ' })).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
    expect(
      loadGooglePlacesConfigFromEnv({ GOOGLE_PLACES_API_KEY: 'a'.repeat(501) })
    ).toEqual({ attemptEnabled: false, credentials: null });
  });

  it('never reads a VITE_ prefixed key (client bundle must never carry the secret)', () => {
    expect(
      loadGooglePlacesConfigFromEnv({
        VITE_GOOGLE_PLACES_API_KEY: 'key-1',
      } as Record<string, string | undefined>)
    ).toEqual({ attemptEnabled: false, credentials: null });
  });
});

describe('STEP 44 credentials-missing safe error', () => {
  it('reports a bounded, user-facing error with the documented category', () => {
    expect(googlePlacesCredentialsMissingError()).toEqual({
      category: 'credentials-missing',
      message: 'Google Places credentials are not configured for this build.',
    });
  });
});