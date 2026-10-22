import { describe, expect, it, vi } from 'vitest';
import {
  createAmadeusExecutionProvider,
  getAmadeusExecutionCapabilityDeclarations,
  getAmadeusExecutionCapabilityProfile,
  getAmadeusExecutionReadiness,
} from '../services/realExecution/amadeusExecutionAdapter';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  DEFAULT_AMADEUS_EXECUTION_CONFIG,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import {
  createAmadeusExecutionConnection,
  createDefectiveAmadeusExecutionConnection,
  type AmadeusExecutionConnection,
  type AmadeusExecutionRequestRef,
} from '../services/realExecution/amadeusExecutionConnection';
import { getAdapterOperationalCapabilityIds, isAdapterCapabilityAvailable } from '../domain/providers/providerAdapter';
import { PROVIDER_CAPABILITY_IDS, providerCapabilityIsOperational } from '../domain/providers/providerCapabilities';
import { MAX_PROVIDER_ID_LENGTH } from '../domain/providers/providerResults';
import { TRIP_EXECUTION_DISPATCH_ID_PREFIX } from '../services/tripExecution/tripExecutionDispatch';
import {
  getTripExecutionProviderRequestId,
  isTripExecutionProviderResult,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';

const DISPATCH_ID = `${TRIP_EXECUTION_DISPATCH_ID_PREFIX}amadeus-adapter-test`;
const REQUEST_ID = getTripExecutionProviderRequestId(DISPATCH_ID);
const SECRET = 'super-secret-value';

const VALID_REQUEST: TripExecutionProviderRequest = {
  id: REQUEST_ID,
  kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  dispatchId: DISPATCH_ID,
};

const DISABLED_CONFIG = DEFAULT_AMADEUS_EXECUTION_CONFIG;
const NO_CREDENTIALS_CONFIG: AmadeusExecutionConfig = { attemptEnabled: true, credentials: null };
const READY_CONFIG: AmadeusExecutionConfig = {
  attemptEnabled: true,
  credentials: { clientId: 'execution-id', clientSecret: SECRET, environment: 'production' },
};

function throwingConnection(): AmadeusExecutionConnection {
  return {
    implementedOperations: [],
    attempt(request: AmadeusExecutionRequestRef): 'not-implemented' | 'internal-failure' {
      void request;
      throw new Error('connection defect');
    },
  };
}

/** Every gate state a build can be in, for exhaustive assertions. */
function configsUnderTest(): AmadeusExecutionConfig[] {
  return [DISABLED_CONFIG, NO_CREDENTIALS_CONFIG, READY_CONFIG];
}

describe('STEP 66 Amadeus execution adapter identity', () => {
  it('exposes the stable execution provider id within the shared bound', async () => {
    const provider = createAmadeusExecutionProvider(DISABLED_CONFIG);
    expect(provider.providerId).toBe(AMADEUS_EXECUTION_PROVIDER_ID);
    expect(provider.providerId).toBe('amadeus-execution');
    expect(provider.providerId.length).toBeLessThanOrEqual(MAX_PROVIDER_ID_LENGTH);
    expect(provider.providerId).toBe(provider.providerId.trim());
  });
});

describe('STEP 66 Amadeus execution adapter result statuses', () => {
  it('reports unsupported when the execution switch is off, the browser default', async () => {
    const provider = createAmadeusExecutionProvider(DISABLED_CONFIG);
    expect(await provider.execute(VALID_REQUEST)).toEqual({
      providerId: 'amadeus-execution',
      requestId: REQUEST_ID,
      status: 'unsupported',
    });
  });

  it('reports unsupported when enabled without usable credentials', async () => {
    const provider = createAmadeusExecutionProvider(NO_CREDENTIALS_CONFIG);
    expect((await provider.execute(VALID_REQUEST)).status).toBe('unsupported');
  });

  it('reports unsupported for a fully configured build, because nothing is implemented', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    expect((await provider.execute(VALID_REQUEST)).status).toBe('unsupported');
  });

  it('never reports accepted for any configuration, request, or connection', async () => {
    const configs = [DISABLED_CONFIG, NO_CREDENTIALS_CONFIG, READY_CONFIG];
    const connections = [createAmadeusExecutionConnection(), createDefectiveAmadeusExecutionConnection(), throwingConnection()];
    const requests = [VALID_REQUEST, {}, null, { ...VALID_REQUEST, kind: 'other' }];

    for (const config of configs) {
      for (const connection of connections) {
        const provider = createAmadeusExecutionProvider(config, connection);
        for (const request of requests) {
          const result = await provider.execute(request as TripExecutionProviderRequest);
          expect(result.status).not.toBe('accepted');
          expect(['rejected', 'unsupported', 'failed']).toContain(result.status);
        }
      }
    }
  });

  it('reports rejected with a safe placeholder for a malformed request', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    expect(await provider.execute({} as TripExecutionProviderRequest)).toEqual({
      providerId: 'amadeus-execution',
      requestId: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`,
      status: 'rejected',
    });
    expect((await provider.execute(null as unknown as TripExecutionProviderRequest)).status).toBe('rejected');
  });

  it('reports failed when the connection reports an internal defect', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG, createDefectiveAmadeusExecutionConnection());
    expect((await provider.execute(VALID_REQUEST)).status).toBe('failed');
  });

  it('contains an unexpected connection throw as failed rather than propagating it', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG, throwingConnection());
    await expect(provider.execute(VALID_REQUEST)).resolves.toEqual({
      providerId: 'amadeus-execution',
      requestId: REQUEST_ID,
      status: 'failed',
    });
  });

  it('produces a result the provider-neutral result contract accepts', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    const result = await provider.execute(VALID_REQUEST);
    expect(isTripExecutionProviderResult(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('never echoes a credential in a result, in any gate state', async () => {
    for (const config of configsUnderTest()) {
      const provider = createAmadeusExecutionProvider(config);
      const serialized = JSON.stringify(await provider.execute(VALID_REQUEST));
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain('execution-id');
    }
  });

  it('is deterministic: the same request yields an identical result', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    expect(await provider.execute(VALID_REQUEST)).toEqual(await provider.execute(VALID_REQUEST));
  });

  it('does not mutate the request it executes', async () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    const snapshot = { ...VALID_REQUEST };
    await provider.execute(VALID_REQUEST);
    expect(VALID_REQUEST).toEqual(snapshot);
  });
});

describe('STEP 66 Amadeus execution adapter readiness reasons', () => {
  it('explains a malformed request without consulting the connection', () => {
    const connection = { implementedOperations: [], attempt: vi.fn() };
    expect(getAmadeusExecutionReadiness(READY_CONFIG, {}, connection)).toEqual({
      status: 'rejected',
      reason: 'malformed-request',
    });
    expect(connection.attempt).not.toHaveBeenCalled();
  });

  it('distinguishes the disabled gate from the credentials-missing gate', () => {
    expect(getAmadeusExecutionReadiness(DISABLED_CONFIG, VALID_REQUEST)).toEqual({
      status: 'unsupported',
      reason: 'execution-disabled',
    });
    expect(getAmadeusExecutionReadiness(NO_CREDENTIALS_CONFIG, VALID_REQUEST)).toEqual({
      status: 'unsupported',
      reason: 'credentials-missing',
    });
  });

  it('fails closed with insufficient-information when the connection declines', () => {
    expect(getAmadeusExecutionReadiness(READY_CONFIG, VALID_REQUEST)).toEqual({
      status: 'unsupported',
      reason: 'insufficient-execution-information',
    });
  });

  it('reports a connection defect as failed', () => {
    expect(
      getAmadeusExecutionReadiness(READY_CONFIG, VALID_REQUEST, createDefectiveAmadeusExecutionConnection())
    ).toEqual({ status: 'failed', reason: 'connection-internal-failure' });
    expect(getAmadeusExecutionReadiness(READY_CONFIG, VALID_REQUEST, throwingConnection())).toEqual({
      status: 'failed',
      reason: 'connection-internal-failure',
    });
  });

  it('passes only identity to the connection, never a payload or credential', () => {
    const attempt = vi.fn(() => 'not-implemented' as const);
    getAmadeusExecutionReadiness(READY_CONFIG, VALID_REQUEST, { implementedOperations: [], attempt });
    expect(attempt).toHaveBeenCalledWith({ requestId: REQUEST_ID, dispatchId: DISPATCH_ID });
    expect(JSON.stringify(attempt.mock.calls)).not.toContain(SECRET);
  });
});

describe('STEP 66 Amadeus execution adapter capability eligibility', () => {
  it('is eligible for a valid request so the pipeline can surface an honest result', () => {
    const provider = createAmadeusExecutionProvider(DISABLED_CONFIG);
    expect(provider.supports(VALID_REQUEST)).toBe(true);
  });

  it('is not eligible for a malformed request', () => {
    const provider = createAmadeusExecutionProvider(READY_CONFIG);
    expect(provider.supports({} as TripExecutionProviderRequest)).toBe(false);
    expect(provider.supports(null as unknown as TripExecutionProviderRequest)).toBe(false);
  });
});

describe('STEP 66 Amadeus execution adapter capability declarations', () => {
  it('declares every known capability explicitly, and none as available', () => {
    for (const config of configsUnderTest()) {
      const declarations = getAmadeusExecutionCapabilityDeclarations(config);
      expect(declarations).toHaveLength(PROVIDER_CAPABILITY_IDS.length);
      expect(declarations.map((declaration) => declaration.capability).sort()).toEqual(
        [...PROVIDER_CAPABILITY_IDS].sort()
      );
      for (const declaration of declarations) {
        expect(providerCapabilityIsOperational(declaration.status)).toBe(false);
      }
    }
  });

  it('advertises no operational capability in a fully configured build', () => {
    const profile = getAmadeusExecutionCapabilityProfile(READY_CONFIG);
    expect(profile.id).toBe('amadeus-execution');
    expect(profile.name).toBe('Amadeus Execution');
    expect(getAdapterOperationalCapabilityIds(profile)).toEqual([]);
    for (const capability of PROVIDER_CAPABILITY_IDS) {
      expect(isAdapterCapabilityAvailable(profile, capability)).toBe(false);
    }
  });

  it('reports missing credentials as the reason a capability is unavailable', () => {
    for (const declaration of getAmadeusExecutionCapabilityDeclarations(DISABLED_CONFIG)) {
      expect(declaration.status).toBe('unavailable-missing-credentials');
    }
  });

  it('leaks no credential through the capability profile', () => {
    expect(JSON.stringify(getAmadeusExecutionCapabilityProfile(READY_CONFIG))).not.toContain(SECRET);
  });
});
