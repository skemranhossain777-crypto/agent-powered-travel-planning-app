import { describe, expect, it } from 'vitest';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
  DEFAULT_REAL_DISCOVERY_CONFIG,
  MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH,
  REAL_DISCOVERY_ATTEMPT_ENABLED_DEFAULT,
  getRealDiscoveryAttemptGate,
  getRealProviderCapabilityStatus,
  isAmadeusEnvironment,
  loadAmadeusConfigFromEnv,
  normalizeAmadeusCredentials,
  normalizeRealDiscoveryConfig,
} from '../services/realDiscovery/amadeusConfig';

describe('STEP 41 Amadeus config identity and defaults', () => {
  it('exposes the stable application-facing provider identity', () => {
    expect(AMADEUS_PROVIDER_ID).toBe('amadeus-self-service');
    expect(AMADEUS_PROVIDER_NAME).toBe('Amadeus Self-Service');
  });

  it('the browser default is always attempt-disabled and credential-free', () => {
    expect(DEFAULT_REAL_DISCOVERY_CONFIG).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
    expect(DEFAULT_REAL_DISCOVERY_CONFIG.attemptEnabled).toBe(false);
    expect(REAL_DISCOVERY_ATTEMPT_ENABLED_DEFAULT).toBe(false);
  });

  it('recognizes exactly the two documented environments', () => {
    expect(isAmadeusEnvironment('test')).toBe(true);
    expect(isAmadeusEnvironment('production')).toBe(true);
    expect(isAmadeusEnvironment('staging')).toBe(false);
    expect(isAmadeusEnvironment(1)).toBe(false);
    expect(isAmadeusEnvironment(undefined)).toBe(false);
  });
});

describe('STEP 41 normalizing Amadeus credentials', () => {
  it('accepts a complete credential pair and defaults to the test environment', () => {
    expect(normalizeAmadeusCredentials({ clientId: 'abc', clientSecret: 'xyz' })).toEqual({
      clientId: 'abc',
      clientSecret: 'xyz',
      environment: 'test',
    });
    expect(
      normalizeAmadeusCredentials({
        clientId: 'abc',
        clientSecret: 'xyz',
        environment: 'production',
      })
    ).toEqual({ clientId: 'abc', clientSecret: 'xyz', environment: 'production' });
  });

  it('trims whitespace from the secret fields', () => {
    expect(normalizeAmadeusCredentials({ clientId: '  abc  ', clientSecret: '  xyz  ' })).toEqual({
      clientId: 'abc',
      clientSecret: 'xyz',
      environment: 'test',
    });
  });

  it('rejects missing, empty, non-string, or over-long credential fields', () => {
    expect(normalizeAmadeusCredentials(null)).toBeNull();
    expect(normalizeAmadeusCredentials('nope')).toBeNull();
    expect(normalizeAmadeusCredentials({})).toBeNull();
    expect(normalizeAmadeusCredentials({ clientId: 'abc' })).toBeNull();
    expect(normalizeAmadeusCredentials({ clientSecret: 'xyz' })).toBeNull();
    expect(normalizeAmadeusCredentials({ clientId: '   ', clientSecret: 'xyz' })).toBeNull();
    expect(normalizeAmadeusCredentials({ clientId: 'abc', clientSecret: 42 })).toBeNull();
    expect(
      normalizeAmadeusCredentials({
        clientId: 'a'.repeat(MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH + 1),
        clientSecret: 'xyz',
      })
    ).toBeNull();
  });

  it('rejects unknown environments instead of guessing', () => {
    expect(
      normalizeAmadeusCredentials({ clientId: 'abc', clientSecret: 'xyz', environment: 'live' })
    ).toBeNull();
  });
});

describe('STEP 41 normalizing the real-provider config', () => {
  it('accepts a disabled config with no credentials', () => {
    expect(normalizeRealDiscoveryConfig({ attemptEnabled: false })).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
  });

  it('accepts an enabled config with valid credentials', () => {
    expect(
      normalizeRealDiscoveryConfig({
        attemptEnabled: true,
        credentials: { clientId: 'abc', clientSecret: 'xyz' },
      })
    ).toEqual({
      attemptEnabled: true,
      credentials: { clientId: 'abc', clientSecret: 'xyz', environment: 'test' },
    });
  });

  it('rejects a config whose attempt switch is not a boolean (never truthy-coerces)', () => {
    expect(normalizeRealDiscoveryConfig({ attemptEnabled: 'true' })).toBeNull();
    expect(normalizeRealDiscoveryConfig({ attemptEnabled: 1 })).toBeNull();
    expect(normalizeRealDiscoveryConfig({ attemptEnabled: undefined })).toBeNull();
    expect(normalizeRealDiscoveryConfig({})).toBeNull();
  });

  it('rejects a config with malformed credentials', () => {
    expect(
      normalizeRealDiscoveryConfig({ attemptEnabled: true, credentials: { clientId: 'abc' } })
    ).toBeNull();
    expect(
      normalizeRealDiscoveryConfig({
        attemptEnabled: true,
        credentials: 'abc',
      })
    ).toBeNull();
  });
});

describe('STEP 41 the discovery attempt gate', () => {
  it('disabled when the switch is not explicitly on (the default)', () => {
    expect(getRealDiscoveryAttemptGate({ attemptEnabled: false, credentials: null })).toBe(
      'disabled'
    );
    expect(
      getRealDiscoveryAttemptGate({
        attemptEnabled: false,
        credentials: { clientId: 'a', clientSecret: 'b', environment: 'test' },
      })
    ).toBe('disabled');
  });

  it('credentials-missing when on but not fully keyed', () => {
    expect(getRealDiscoveryAttemptGate({ attemptEnabled: true, credentials: null })).toBe(
      'credentials-missing'
    );
  });

  it('ready only when both the switch and a full credential pair are present', () => {
    expect(
      getRealDiscoveryAttemptGate({
        attemptEnabled: true,
        credentials: { clientId: 'a', clientSecret: 'b', environment: 'test' },
      })
    ).toBe('ready');
  });
});

describe('STEP 41 capability status is derived from the gate', () => {
  it('supplies unavailable-missing-credentials whenever not ready', () => {
    expect(getRealProviderCapabilityStatus({ attemptEnabled: false, credentials: null })).toBe(
      'unavailable-missing-credentials'
    );
    expect(getRealProviderCapabilityStatus({ attemptEnabled: true, credentials: null })).toBe(
      'unavailable-missing-credentials'
    );
  });

  it('supplies available only in the ready gate state', () => {
    expect(
      getRealProviderCapabilityStatus({
        attemptEnabled: true,
        credentials: { clientId: 'a', clientSecret: 'b', environment: 'test' },
      })
    ).toBe('available');
  });
});

describe('STEP 41 loading config from an injected env map', () => {
  it('stays disabled when the attempt flag is absent or not truthy-marked', () => {
    expect(loadAmadeusConfigFromEnv({})).toEqual({ attemptEnabled: false, credentials: null });
    expect(loadAmadeusConfigFromEnv({ REAL_DISCOVERY_ATTEMPT_ENABLED: 'false' })).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
  });

  it('enables only for the documented true/1 markers', () => {
    expect(
      loadAmadeusConfigFromEnv({ REAL_DISCOVERY_ATTEMPT_ENABLED: 'true' }).attemptEnabled
    ).toBe(true);
    expect(loadAmadeusConfigFromEnv({ REAL_DISCOVERY_ATTEMPT_ENABLED: '1' }).attemptEnabled).toBe(
      true
    );
    expect(loadAmadeusConfigFromEnv({ REAL_DISCOVERY_ATTEMPT_ENABLED: 'yes' }).attemptEnabled).toBe(
      false
    );
  });

  it('builds credentials only when both secret keys are present', () => {
    const config = loadAmadeusConfigFromEnv({
      REAL_DISCOVERY_ATTEMPT_ENABLED: 'true',
      AMADEUS_CLIENT_ID: 'abc',
      AMADEUS_CLIENT_SECRET: 'xyz',
    });
    expect(config).toEqual({
      attemptEnabled: true,
      credentials: { clientId: 'abc', clientSecret: 'xyz', environment: 'test' },
    });
  });

  it('leaves credentials null when either secret is missing or blank', () => {
    expect(
      loadAmadeusConfigFromEnv({
        REAL_DISCOVERY_ATTEMPT_ENABLED: 'true',
        AMADEUS_CLIENT_ID: 'abc',
      }).credentials
    ).toBeNull();
    expect(
      loadAmadeusConfigFromEnv({
        REAL_DISCOVERY_ATTEMPT_ENABLED: 'true',
        AMADEUS_CLIENT_ID: '   ',
        AMADEUS_CLIENT_SECRET: 'xyz',
      }).credentials
    ).toBeNull();
  });

  it('selects the environment from the documented key, defaulting to test', () => {
    const prod = loadAmadeusConfigFromEnv({
      REAL_DISCOVERY_ATTEMPT_ENABLED: 'true',
      AMADEUS_CLIENT_ID: 'abc',
      AMADEUS_CLIENT_SECRET: 'xyz',
      AMADEUS_ENVIRONMENT: 'production',
    });
    expect(prod.credentials?.environment).toBe('production');

    const unknown = loadAmadeusConfigFromEnv({
      REAL_DISCOVERY_ATTEMPT_ENABLED: 'true',
      AMADEUS_CLIENT_ID: 'abc',
      AMADEUS_CLIENT_SECRET: 'xyz',
      AMADEUS_ENVIRONMENT: 'staging',
    });
    expect(unknown.credentials?.environment).toBe('test');
  });
});
