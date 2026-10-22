import { describe, expect, it } from 'vitest';
import {
  AMADEUS_EXECUTION_ATTEMPT_ENABLED_DEFAULT,
  AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS,
  AMADEUS_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
  AMADEUS_EXECUTION_DISABLED_MESSAGE,
  AMADEUS_EXECUTION_PROVIDER_ID,
  AMADEUS_EXECUTION_PROVIDER_NAME,
  AMADEUS_EXECUTION_SERVER_ENV_KEYS,
  DEFAULT_AMADEUS_EXECUTION_CONFIG,
  getAmadeusExecutionAttemptGate,
  getAmadeusExecutionCapabilityStatus,
  isAmadeusExecutionBrowserExposedEnvKey,
  isAmadeusExecutionEnvironment,
  isAmadeusExecutionReady,
  loadAmadeusExecutionConfigFromEnv,
  MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH,
  normalizeAmadeusExecutionConfig,
  normalizeAmadeusExecutionCredentials,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';

const COMPLETE_CREDENTIALS = {
  clientId: 'execution-client-id',
  clientSecret: 'execution-client-secret',
  environment: 'production',
} as const;

describe('STEP 66 Amadeus execution identity and defaults', () => {
  it('exposes the stable application-facing execution provider identity', () => {
    expect(AMADEUS_EXECUTION_PROVIDER_ID).toBe('amadeus-execution');
    expect(AMADEUS_EXECUTION_PROVIDER_NAME).toBe('Amadeus Execution');
  });

  it('is attempt-disabled and credential-free by default', () => {
    expect(DEFAULT_AMADEUS_EXECUTION_CONFIG).toEqual({
      attemptEnabled: false,
      credentials: null,
    });
    expect(DEFAULT_AMADEUS_EXECUTION_CONFIG.credentials).toBeNull();
    expect(AMADEUS_EXECUTION_ATTEMPT_ENABLED_DEFAULT).toBe(false);
  });

  it('exposes a frozen default so the always-off config cannot be mutated in place', () => {
    expect(Object.isFrozen(DEFAULT_AMADEUS_EXECUTION_CONFIG)).toBe(true);
  });

  it('ships credential-free, bounded messages for the closed gates', () => {
    expect(AMADEUS_EXECUTION_DISABLED_MESSAGE).not.toMatch(/secret|token|password/i);
    expect(AMADEUS_EXECUTION_CREDENTIALS_MISSING_MESSAGE).not.toMatch(/secret|token|password/i);
    expect(AMADEUS_EXECUTION_DISABLED_MESSAGE.length).toBeLessThanOrEqual(200);
    expect(AMADEUS_EXECUTION_CREDENTIALS_MISSING_MESSAGE.length).toBeLessThanOrEqual(200);
  });
});

describe('STEP 66 Amadeus execution environment recognition', () => {
  it('recognizes exactly the two documented environments', () => {
    expect(isAmadeusExecutionEnvironment('test')).toBe(true);
    expect(isAmadeusExecutionEnvironment('production')).toBe(true);
    expect(isAmadeusExecutionEnvironment('staging')).toBe(false);
    expect(isAmadeusExecutionEnvironment('TEST')).toBe(false);
    expect(isAmadeusExecutionEnvironment(1)).toBe(false);
    expect(isAmadeusExecutionEnvironment(null)).toBe(false);
    expect(isAmadeusExecutionEnvironment(undefined)).toBe(false);
  });
});

describe('STEP 66 Amadeus execution server-only environment keys', () => {
  it('honors exactly the four documented server-side keys', () => {
    expect(AMADEUS_EXECUTION_SERVER_ENV_KEYS).toEqual([
      'AMADEUS_EXECUTION_ENABLED',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET',
      'AMADEUS_ENVIRONMENT',
    ]);
  });

  it('never honors a browser-exposed Amadeus key', () => {
    for (const key of AMADEUS_EXECUTION_SERVER_ENV_KEYS) {
      expect(key.startsWith('VITE_')).toBe(false);
      expect(isAmadeusExecutionBrowserExposedEnvKey(key)).toBe(false);
    }
    for (const key of AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS) {
      expect(key.startsWith('VITE_')).toBe(true);
      expect(isAmadeusExecutionBrowserExposedEnvKey(key)).toBe(true);
      expect(AMADEUS_EXECUTION_SERVER_ENV_KEYS).not.toContain(key);
    }
    expect(isAmadeusExecutionBrowserExposedEnvKey(42)).toBe(false);
    expect(isAmadeusExecutionBrowserExposedEnvKey(undefined)).toBe(false);
  });
});

describe('STEP 66 normalizing Amadeus execution credentials', () => {
  it('accepts a complete credential pair and defaults to the test environment', () => {
    expect(normalizeAmadeusExecutionCredentials({ clientId: 'abc', clientSecret: 'xyz' })).toEqual({
      clientId: 'abc',
      clientSecret: 'xyz',
      environment: 'test',
    });
    expect(normalizeAmadeusExecutionCredentials(COMPLETE_CREDENTIALS)).toEqual({
      clientId: 'execution-client-id',
      clientSecret: 'execution-client-secret',
      environment: 'production',
    });
  });

  it('trims whitespace from the secret fields without echoing them', () => {
    expect(normalizeAmadeusExecutionCredentials({ clientId: '  abc  ', clientSecret: '  xyz  ' })).toEqual({
      clientId: 'abc',
      clientSecret: 'xyz',
      environment: 'test',
    });
  });

  it('rejects a half-configured, blank, non-string, or over-length credential pair', () => {
    expect(normalizeAmadeusExecutionCredentials({ clientId: 'abc' })).toBeNull();
    expect(normalizeAmadeusExecutionCredentials({ clientSecret: 'xyz' })).toBeNull();
    expect(normalizeAmadeusExecutionCredentials({ clientId: '   ', clientSecret: 'xyz' })).toBeNull();
    expect(normalizeAmadeusExecutionCredentials({ clientId: 'abc', clientSecret: '' })).toBeNull();
    expect(normalizeAmadeusExecutionCredentials({ clientId: 7, clientSecret: 'xyz' })).toBeNull();
    expect(
      normalizeAmadeusExecutionCredentials({
        clientId: 'a'.repeat(MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH + 1),
        clientSecret: 'xyz',
      })
    ).toBeNull();
  });

  it('rejects an unknown environment and every non-record payload', () => {
    expect(
      normalizeAmadeusExecutionCredentials({ clientId: 'abc', clientSecret: 'xyz', environment: 'staging' })
    ).toBeNull();
    expect(normalizeAmadeusExecutionCredentials(null)).toBeNull();
    expect(normalizeAmadeusExecutionCredentials(undefined)).toBeNull();
    expect(normalizeAmadeusExecutionCredentials('abc')).toBeNull();
    expect(normalizeAmadeusExecutionCredentials(['abc', 'xyz'])).toBeNull();
  });
});

describe('STEP 66 normalizing the Amadeus execution config', () => {
  it('accepts a boolean switch with absent or present credentials', () => {
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: true })).toEqual({
      attemptEnabled: true,
      credentials: null,
    });
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: false, credentials: COMPLETE_CREDENTIALS })).toEqual(
      { attemptEnabled: false, credentials: COMPLETE_CREDENTIALS }
    );
  });

  it('refuses to enable execution from a truthy non-boolean', () => {
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: 'true' })).toBeNull();
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: 1 })).toBeNull();
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: 'yes' })).toBeNull();
    expect(normalizeAmadeusExecutionConfig({})).toBeNull();
  });

  it('rejects a malformed credential payload rather than silently dropping it', () => {
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: true, credentials: { clientId: 'abc' } })).toBeNull();
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: true, credentials: 'abc' })).toBeNull();
    expect(normalizeAmadeusExecutionConfig({ attemptEnabled: true, credentials: null })).toEqual({
      attemptEnabled: true,
      credentials: null,
    });
    expect(normalizeAmadeusExecutionConfig(null)).toBeNull();
  });
});

describe('STEP 66 Amadeus execution attempt gate', () => {
  const disabled = { attemptEnabled: false, credentials: null } as AmadeusExecutionConfig;
  const enabledWithoutCredentials = { attemptEnabled: true, credentials: null } as AmadeusExecutionConfig;
  const ready = { attemptEnabled: true, credentials: COMPLETE_CREDENTIALS } as AmadeusExecutionConfig;

  it('resolves exactly the three bounded gate states', () => {
    expect(getAmadeusExecutionAttemptGate(disabled)).toBe('disabled');
    expect(getAmadeusExecutionAttemptGate(enabledWithoutCredentials)).toBe('credentials-missing');
    expect(getAmadeusExecutionAttemptGate(ready)).toBe('ready');
  });

  it('never reports ready while the switch is off, even with credentials present', () => {
    const offWithCredentials = {
      attemptEnabled: false,
      credentials: COMPLETE_CREDENTIALS,
    } as AmadeusExecutionConfig;
    expect(getAmadeusExecutionAttemptGate(offWithCredentials)).toBe('disabled');
    expect(isAmadeusExecutionReady(offWithCredentials)).toBe(false);
  });

  it('reports ready only when the switch is on and credentials are complete', () => {
    expect(isAmadeusExecutionReady(ready)).toBe(true);
    expect(isAmadeusExecutionReady(disabled)).toBe(false);
    expect(isAmadeusExecutionReady(enabledWithoutCredentials)).toBe(false);
    expect(isAmadeusExecutionReady(DEFAULT_AMADEUS_EXECUTION_CONFIG)).toBe(false);
  });
});

describe('STEP 66 Amadeus execution capability status', () => {
  it('is never available: configured still means unimplemented', () => {
    expect(
      getAmadeusExecutionCapabilityStatus({
        attemptEnabled: true,
        credentials: COMPLETE_CREDENTIALS,
      } as AmadeusExecutionConfig)
    ).toBe('unsupported');
  });

  it('reports missing credentials whenever the build is not ready', () => {
    expect(getAmadeusExecutionCapabilityStatus(DEFAULT_AMADEUS_EXECUTION_CONFIG)).toBe(
      'unavailable-missing-credentials'
    );
    expect(
      getAmadeusExecutionCapabilityStatus({ attemptEnabled: true, credentials: null } as AmadeusExecutionConfig)
    ).toBe('unavailable-missing-credentials');
  });
});

describe('STEP 66 loading the Amadeus execution config from an injected env map', () => {
  it('is disabled and credential-free when the four keys are empty', () => {
    expect(
      loadAmadeusExecutionConfigFromEnv({
        AMADEUS_EXECUTION_ENABLED: '',
        AMADEUS_CLIENT_ID: '',
        AMADEUS_CLIENT_SECRET: '',
        AMADEUS_ENVIRONMENT: '',
      })
    ).toEqual({ attemptEnabled: false, credentials: null });
  });

  it('is disabled and credential-free for an entirely absent env', () => {
    expect(loadAmadeusExecutionConfigFromEnv({})).toEqual({ attemptEnabled: false, credentials: null });
  });

  it('enables only for an explicit true or 1 switch value', () => {
    expect(
      loadAmadeusExecutionConfigFromEnv({
        AMADEUS_EXECUTION_ENABLED: 'true',
        AMADEUS_CLIENT_ID: 'id',
        AMADEUS_CLIENT_SECRET: 'secret',
      })
    ).toEqual({
      attemptEnabled: true,
      credentials: { clientId: 'id', clientSecret: 'secret', environment: 'test' },
    });
    expect(
      getAmadeusExecutionAttemptGate(
        loadAmadeusExecutionConfigFromEnv({
          AMADEUS_EXECUTION_ENABLED: '1',
          AMADEUS_CLIENT_ID: 'id',
          AMADEUS_CLIENT_SECRET: 'secret',
        })
      )
    ).toBe('ready');
  });

  it('refuses to enable execution from a non-true switch value', () => {
    for (const value of ['false', '0', 'yes', 'TRUE', 'True', 'enabled']) {
      expect(
        getAmadeusExecutionAttemptGate(
          loadAmadeusExecutionConfigFromEnv({
            AMADEUS_EXECUTION_ENABLED: value,
            AMADEUS_CLIENT_ID: 'id',
            AMADEUS_CLIENT_SECRET: 'secret',
          })
        )
      ).toBe('disabled');
    }
  });

  it('never reads a browser-exposed Amadeus key', () => {
    const fromBrowser = loadAmadeusExecutionConfigFromEnv({
      VITE_AMADEUS_EXECUTION_ENABLED: 'true',
      VITE_AMADEUS_CLIENT_ID: 'browser-id',
      VITE_AMADEUS_CLIENT_SECRET: 'browser-secret',
      VITE_AMADEUS_ENVIRONMENT: 'production',
    });
    expect(fromBrowser).toEqual({ attemptEnabled: false, credentials: null });
    expect(getAmadeusExecutionAttemptGate(fromBrowser)).toBe('disabled');
  });

  it('honors the production environment when the server keys are complete', () => {
    expect(
      loadAmadeusExecutionConfigFromEnv({
        AMADEUS_EXECUTION_ENABLED: 'true',
        AMADEUS_CLIENT_ID: 'id',
        AMADEUS_CLIENT_SECRET: 'secret',
        AMADEUS_ENVIRONMENT: 'production',
      })
    ).toEqual({
      attemptEnabled: true,
      credentials: { clientId: 'id', clientSecret: 'secret', environment: 'production' },
    });
  });

  it('falls back to the test environment for an unknown environment value', () => {
    expect(
      loadAmadeusExecutionConfigFromEnv({
        AMADEUS_EXECUTION_ENABLED: 'true',
        AMADEUS_CLIENT_ID: 'id',
        AMADEUS_CLIENT_SECRET: 'secret',
        AMADEUS_ENVIRONMENT: 'staging',
      })
    ).toEqual({
      attemptEnabled: true,
      credentials: { clientId: 'id', clientSecret: 'secret', environment: 'test' },
    });
  });

  it('leaves credentials missing when only one secret is present', () => {
    const onlyId = loadAmadeusExecutionConfigFromEnv({
      AMADEUS_EXECUTION_ENABLED: 'true',
      AMADEUS_CLIENT_ID: 'id',
    });
    expect(onlyId.credentials).toBeNull();
    expect(getAmadeusExecutionAttemptGate(onlyId)).toBe('credentials-missing');

    const onlySecret = loadAmadeusExecutionConfigFromEnv({
      AMADEUS_EXECUTION_ENABLED: 'true',
      AMADEUS_CLIENT_SECRET: 'secret',
    });
    expect(onlySecret.credentials).toBeNull();
    expect(getAmadeusExecutionAttemptGate(onlySecret)).toBe('credentials-missing');
  });
});

describe('STEP 66 Amadeus execution credential serialization containment', () => {
  const SECRET = 'never-serialize-this-secret';
  const configured = loadAmadeusExecutionConfigFromEnv({
    AMADEUS_EXECUTION_ENABLED: 'true',
    AMADEUS_CLIENT_ID: 'serialization-id',
    AMADEUS_CLIENT_SECRET: SECRET,
  });

  it('holds a secret only in the explicit credentials field and nowhere else on the config', () => {
    expect(Object.keys(configured).sort()).toEqual(['attemptEnabled', 'credentials']);
    expect(JSON.stringify({ attemptEnabled: configured.attemptEnabled })).not.toContain(SECRET);
    expect(JSON.stringify({ credentials: configured.credentials?.environment })).not.toContain(SECRET);
  });

  it('never serializes a secret into any value this config hands outward', () => {
    const outward = [
      getAmadeusExecutionAttemptGate(configured),
      getAmadeusExecutionCapabilityStatus(configured),
      isAmadeusExecutionReady(configured),
      isAmadeusExecutionEnvironment('production'),
      AMADEUS_EXECUTION_DISABLED_MESSAGE,
      AMADEUS_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
      AMADEUS_EXECUTION_SERVER_ENV_KEYS,
      AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS,
      DEFAULT_AMADEUS_EXECUTION_CONFIG,
      AMADEUS_EXECUTION_PROVIDER_ID,
      AMADEUS_EXECUTION_PROVIDER_NAME,
    ];
    for (const value of outward) {
      expect(JSON.stringify(value)).not.toContain(SECRET);
      expect(JSON.stringify(value)).not.toContain('serialization-id');
    }
  });

  it('keeps the default config free of any secret field to serialize', () => {
    expect(JSON.stringify(DEFAULT_AMADEUS_EXECUTION_CONFIG)).toBe('{"attemptEnabled":false,"credentials":null}');
  });
});
