import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOOGLE_ROUTES_CONFIG,
  GOOGLE_ROUTES_ENABLED_DEFAULT,
  GOOGLE_ROUTES_PROVIDER_ID,
  GOOGLE_ROUTES_PROVIDER_NAME,
  getGoogleRoutesAttemptGate,
  isGoogleRoutesReady,
  loadGoogleRoutesConfigFromEnv,
  normalizeGoogleRoutesConfig,
  normalizeGoogleRoutesCredentials,
} from '../services/googleRoutes/googleRoutesConfig';

describe('STEP 47 Google Routes config gate', () => {
  it('defaults to disabled with no credentials (Routes is off independently of Places)', () => {
    expect(DEFAULT_GOOGLE_ROUTES_CONFIG).toEqual({ attemptEnabled: false, credentials: null });
    expect(getGoogleRoutesAttemptGate(DEFAULT_GOOGLE_ROUTES_CONFIG)).toBe('disabled');
    expect(GOOGLE_ROUTES_ENABLED_DEFAULT).toBe(false);
    expect(GOOGLE_ROUTES_PROVIDER_ID).toBe('google-routes');
    expect(GOOGLE_ROUTES_PROVIDER_NAME).toBe('Google Routes');
  });

  it('resolves the gate to ready only when enabled with a key', () => {
    expect(
      getGoogleRoutesAttemptGate({ attemptEnabled: true, credentials: null })
    ).toBe('credentials-missing');
    expect(
      getGoogleRoutesAttemptGate({ attemptEnabled: false, credentials: { apiKey: 'k' } })
    ).toBe('disabled');
    const ready = { attemptEnabled: true, credentials: { apiKey: 'k' } };
    expect(getGoogleRoutesAttemptGate(ready)).toBe('ready');
    expect(isGoogleRoutesReady(ready)).toBe(true);
  });

  it('normalizes credentials and rejects missing/blank/oversized keys', () => {
    expect(normalizeGoogleRoutesCredentials({ apiKey: 'abc' })).toEqual({ apiKey: 'abc' });
    expect(normalizeGoogleRoutesCredentials({ apiKey: '  abc  ' })).toEqual({ apiKey: 'abc' });
    expect(normalizeGoogleRoutesCredentials(null)).toBeNull();
    expect(normalizeGoogleRoutesCredentials({ apiKey: '' })).toBeNull();
    expect(normalizeGoogleRoutesCredentials({ apiKey: '   ' })).toBeNull();
    expect(normalizeGoogleRoutesCredentials({ apiKey: 'x'.repeat(501) })).toBeNull();
  });

  it('normalizes config strictly (attemptEnabled must be a real boolean)', () => {
    expect(
      normalizeGoogleRoutesConfig({ attemptEnabled: true, credentials: { apiKey: 'k' } })
    ).toEqual({ attemptEnabled: true, credentials: { apiKey: 'k' } });
    expect(normalizeGoogleRoutesConfig({ attemptEnabled: true })).toEqual({
      attemptEnabled: true,
      credentials: null,
    });
    expect(normalizeGoogleRoutesConfig({ attemptEnabled: 'yes' })).toBeNull();
    expect(normalizeGoogleRoutesConfig({ attemptEnabled: true, credentials: { apiKey: '' } })).toBeNull();
    expect(normalizeGoogleRoutesConfig(null)).toBeNull();
  });

  it('loadGoogleRoutesConfigFromEnv reads its OWN keys and never the Places flag', () => {
    expect(loadGoogleRoutesConfigFromEnv({})).toEqual({ attemptEnabled: false, credentials: null });
    expect(
      loadGoogleRoutesConfigFromEnv({ GOOGLE_PLACES_ENABLED: 'true' })
    ).toEqual({ attemptEnabled: false, credentials: null });

    const enabled = loadGoogleRoutesConfigFromEnv({
      GOOGLE_ROUTES_ENABLED: 'true',
      GOOGLE_ROUTES_API_KEY: 'routes-key',
    });
    expect(enabled).toEqual({
      attemptEnabled: true,
      credentials: { apiKey: 'routes-key' },
    });

    // Enabled without a key is a first-class credentials-missing gate, never a throw.
    expect(
      getGoogleRoutesAttemptGate(
        loadGoogleRoutesConfigFromEnv({ GOOGLE_ROUTES_ENABLED: 'true' })
      )
    ).toBe('credentials-missing');
  });
});