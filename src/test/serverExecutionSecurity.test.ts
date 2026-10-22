/**
 * STEP 67 security regression suite for the authenticated execution boundary.
 *
 * These tests treat the boundary as an attacker would: they try to turn it into
 * a credentialed proxy, to have it accept a body-supplied identity, to make it
 * perform provider work in a disabled build, to make it echo a secret, and to
 * make it claim a booking or payment succeeded. Each attempt is expressed as a
 * real call through the public runner, not as a source-text assertion, so the
 * suite keeps its value even if the implementation is refactored.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  runServerBoundaryExecution,
  type RunServerExecutionInput,
} from '../services/serverBoundary/serverExecutionRunner';
import { verifyServerExecutionIdToken } from '../services/serverBoundary/serverExecutionAuth';
import {
  isServerExecutionAuthErrorBody,
  SERVER_EXECUTION_HTTP_BAD_REQUEST,
  SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED,
  type ServerExecutionHttpResult,
  type ServerExecutionResponse,
} from '../services/serverBoundary/serverExecutionContract';
import {
  AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS,
  AMADEUS_EXECUTION_PROVIDER_ID,
  AMADEUS_EXECUTION_SERVER_ENV_KEYS,
  AMADEUS_EXECUTION_ATTEMPT_ENABLED_DEFAULT,
  DEFAULT_AMADEUS_EXECUTION_CONFIG,
  isAmadeusExecutionBrowserExposedEnvKey,
  loadAmadeusExecutionConfigFromEnv,
  normalizeAmadeusExecutionConfig,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import type { AmadeusExecutionConnection } from '../services/realExecution/amadeusExecutionConnection';
import {
  getTripExecutionProviderRequestId,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
} from '../services/tripExecution/tripExecutionProvider';

const SECRET = 'execution-client-secret-value';
const CLIENT_ID = 'execution-client-id-value';
const DISPATCH_ID = 'trip-execution-dispatch:trip-planning-execution-authorization:trip-1';
const REQUEST_ID = getTripExecutionProviderRequestId(DISPATCH_ID);

const VALID_BODY = {
  id: REQUEST_ID,
  kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  dispatchId: DISPATCH_ID,
};

const READY_CONFIG: AmadeusExecutionConfig = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
  credentials: { clientId: CLIENT_ID, clientSecret: SECRET, environment: 'production' },
}) as AmadeusExecutionConfig;

const DISABLED_CONFIG: AmadeusExecutionConfig = DEFAULT_AMADEUS_EXECUTION_CONFIG;

const PRINCIPAL = { uid: 'user-1' };

function recordingConnection(outcome: 'not-implemented' | 'internal-failure' = 'not-implemented') {
  const attempt = vi.fn((ref: { requestId: string; dispatchId: string }) => {
    void ref;
    return outcome;
  });
  const connection: AmadeusExecutionConnection = { implementedOperations: [], attempt };
  return { connection, attempt };
}

function run(overrides: Partial<RunServerExecutionInput> = {}): Promise<ServerExecutionHttpResult> {
  return runServerBoundaryExecution({
    method: 'POST',
    contentType: 'application/json',
    raw: VALID_BODY,
    config: READY_CONFIG,
    principal: PRINCIPAL,
    ...overrides,
  });
}

function asBody(result: ServerExecutionHttpResult): ServerExecutionResponse {
  if (isServerExecutionAuthErrorBody(result.body)) {
    throw new Error('expected a normalized execution body');
  }
  return result.body;
}

describe('STEP 67 execution boundary never accepts a body-supplied identity', () => {
  it('rejects a spoofed uid even with a valid principal present', async () => {
    const result = await run({ raw: { ...VALID_BODY, uid: 'admin', role: 'owner' } });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
    expect(asBody(result).problem).toBe('unexpected-field');
  });

  it('derives its only identity from the server-verified token', async () => {
    const verifier = vi.fn(async (token: string) => ({ uid: `uid-for-${token}` }));
    const ok = await verifyServerExecutionIdToken('token-abc', verifier);
    expect(ok).toEqual({ ok: true, principal: { uid: 'uid-for-token-abc' } });

    const missing = await verifyServerExecutionIdToken('', verifier);
    expect(missing).toEqual({ ok: false, problem: 'unauthenticated' });
    const blank = await verifyServerExecutionIdToken('   ', verifier);
    expect(blank).toEqual({ ok: false, problem: 'unauthenticated' });
    const none = await verifyServerExecutionIdToken(undefined, verifier);
    expect(none).toEqual({ ok: false, problem: 'unauthenticated' });

    const throwing = await verifyServerExecutionIdToken('bad', async () => {
      throw new Error('verify failed');
    });
    expect(throwing).toEqual({ ok: false, problem: 'invalid-token' });
  });

  it('rejects a token that verifies to a blank identity', async () => {
    const result = await verifyServerExecutionIdToken('token', async () => ({ uid: '  ' }));
    expect(result).toEqual({ ok: false, problem: 'invalid-token' });
  });
});

describe('STEP 67 execution boundary cannot be turned into a generic HTTP proxy', () => {
  it('rejects every attempt to steer the provider or the destination', async () => {
    const attacks: Array<Record<string, unknown>> = [
      { providerId: 'some-other-provider' },
      { provider: 'amadeus-execution' },
      { url: 'https://evil.example.com/collect' },
      { baseUrl: 'https://evil.example.com' },
      { endpoint: 'https://api.amadeus.com/v1/security/oauth2/token' },
      { path: '/v1/booking/pnc' },
      { host: 'evil.example.com' },
      { method: 'DELETE' },
      { headers: { authorization: 'Bearer leaked' } },
      { operation: 'submit-booking' },
      { travelers: [{ firstName: 'Ada', lastName: 'Lovelace' }] },
      { paymentMethod: { token: 'tok_live' } },
      { clientId: 'injected' },
      { clientSecret: 'injected' },
      { accessToken: 'injected' },
      { config: { attemptEnabled: true } },
      { connection: { attempt: () => 'internal-failure' } },
    ];

    for (const attack of attacks) {
      const { connection, attempt } = recordingConnection();
      const result = await run({ raw: { ...VALID_BODY, ...attack }, connection });
      expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
      expect(asBody(result).problem).toBe('unexpected-field');
      // Critically: no provider work happened for a steered request.
      expect(attempt).not.toHaveBeenCalled();
    }
  });

  it('rejects a rejected HTTP verb even when the body is perfect', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const { connection, attempt } = recordingConnection();
      const result = await run({ method, connection });
      expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
      expect(asBody(result).problem).toBe('unsupported-method');
      expect(attempt).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-JSON body so a text handler cannot smuggle a string', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const { connection, attempt } = recordingConnection();
      const result = await run({ contentType, connection });
      expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
      expect(asBody(result).problem).toBe('unsupported-content-type');
      expect(attempt).not.toHaveBeenCalled();
    }
  });
});

describe('STEP 67 execution boundary performs no provider work when disabled', () => {
  it('is off in the default config and the default env', () => {
    expect(DISABLED_CONFIG.attemptEnabled).toBe(false);
    expect(AMADEUS_EXECUTION_ATTEMPT_ENABLED_DEFAULT).toBe(false);
    expect(DISABLED_CONFIG.credentials).toBeNull();
    expect(loadAmadeusExecutionConfigFromEnv({}).attemptEnabled).toBe(false);
    expect(loadAmadeusExecutionConfigFromEnv({}).credentials).toBeNull();
  });

  it('returns 501 and consults no connection for a disabled build', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({ config: DISABLED_CONFIG, connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED);
    expect(attempt).not.toHaveBeenCalled();
    expect(asBody(result).providerResults).toEqual([]);
  });

  it('stays disabled even when a browser tries to switch it on in the body', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({
      config: DISABLED_CONFIG,
      raw: { ...VALID_BODY, attemptEnabled: true, enable: true },
      connection,
    });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('keeps every Amadeus execution key server-only and the VITE_ shadows inert', () => {
    // The server keys are the only ones the loader honors, and none is a VITE_
    // key, so none can be inlined into the client bundle.
    for (const key of AMADEUS_EXECUTION_SERVER_ENV_KEYS) {
      expect(key.startsWith('VITE_')).toBe(false);
      expect(isAmadeusExecutionBrowserExposedEnvKey(key)).toBe(false);
    }

    // The forbidden list is exactly the VITE_ shadow of each server key, and
    // every one of them is rejected as browser-exposed.
    expect([...AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS].sort()).toEqual(
      AMADEUS_EXECUTION_SERVER_ENV_KEYS.map((key) => `VITE_${key}`).sort()
    );
    for (const key of AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS) {
      expect(isAmadeusExecutionBrowserExposedEnvKey(key)).toBe(true);
    }

    // A VITE_ key is never honored by the loader, even when set.
    const fromBrowserEnv = loadAmadeusExecutionConfigFromEnv({
      VITE_AMADEUS_EXECUTION_ENABLED: 'true',
      VITE_AMADEUS_CLIENT_ID: 'browser-id',
      VITE_AMADEUS_CLIENT_SECRET: 'browser-secret',
    });
    expect(fromBrowserEnv.attemptEnabled).toBe(false);
    expect(fromBrowserEnv.credentials).toBeNull();
  });
});

describe('STEP 67 execution boundary never leaks a secret, token, or internal detail', () => {
  it('keeps the client id and secret out of every response path', async () => {
    const { connection } = recordingConnection();
    const bodies = await Promise.all([
      run({ connection }),
      run({ config: DISABLED_CONFIG, connection }),
      run({ raw: { ...VALID_BODY, extra: SECRET }, connection }),
      run({ principal: null, raw: { ...VALID_BODY, extra: SECRET } }),
    ]);

    for (const result of bodies) {
      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain(CLIENT_ID);
      expect(serialized).not.toContain('credentials');
      expect(serialized).not.toContain('clientSecret');
    }
  });

  it('serializes only the three contract fields of a request and a result', async () => {
    const { connection } = recordingConnection();
    const body = asBody(await run({ connection }));
    expect(Object.keys(body).sort()).toEqual([
      'error',
      'problem',
      'providerResults',
      'request',
      'status',
    ]);
    for (const result of body.providerResults) {
      expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
    }
    expect(Object.keys(body.request ?? {}).sort()).toEqual(['dispatchId', 'id', 'kind']);
  });

  it('contains an internal exception message rather than forwarding it', async () => {
    const connection: AmadeusExecutionConnection = {
      implementedOperations: [],
      attempt: () => {
        throw new Error(`socket failed for ${SECRET}`);
      },
    };
    const result = await run({ connection });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('socket failed');
    expect(asBody(result).error?.message).not.toContain(SECRET);
  });

  it('never forwards the provider internal readiness reason token', async () => {
    const { connection } = recordingConnection('not-implemented');
    const serialized = JSON.stringify((await run({ connection })).body);
    for (const reason of [
      'malformed-request',
      'execution-disabled',
      'credentials-missing',
      'unmappable-request',
      'insufficient-execution-information',
      'connection-internal-failure',
      'operation-not-implemented',
    ]) {
      expect(serialized).not.toContain(reason);
    }
  });
});

describe('STEP 67 execution boundary never claims a booking or payment outcome', () => {
  it('reports only provider-neutral statuses and never a lifecycle word', async () => {
    const { connection } = recordingConnection();
    const body = asBody(await run({ connection }));
    const statuses = body.providerResults.map((r) => r.status);
    expect(statuses).toEqual(['unsupported']);
    for (const status of statuses) {
      expect(['accepted', 'rejected', 'unsupported', 'failed']).toContain(status);
    }
  });

  it('keeps lifecycle vocabulary out of the whole response body', async () => {
    const { connection } = recordingConnection();
    const serialized = JSON.stringify((await run({ connection })).body).toLowerCase();
    for (const word of ['booked', 'reserved', 'confirmed', 'refunded', 'cancelled', 'payment']) {
      expect(serialized).not.toContain(word);
    }
  });
});

describe('STEP 67 execution boundary is not reachable from the browser bundle', () => {
  const SRC = join(process.cwd(), 'src');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('is imported by no component, no hook, and no client-reachable service', () => {
    // The boundary's own modules and its tests are the only permitted importers.
    // Everything a browser bundle can reach - components, hooks, contexts, and
    // client services - must be unable to pull it in.
    const clientReachable = sourceFiles(SRC).filter((file) => {
      const relative = file.slice(SRC.length + 1).split('\\').join('/');
      if (relative.startsWith('services/serverBoundary/')) return false;
      if (relative.startsWith('test/')) return false;
      if (relative.startsWith('services/')) return false;
      return true;
    });

    const importers = clientReachable.filter((file) =>
      /from\s+['"][^'"]*serverExecution(Auth|Contract|Runner|Validation)['"]/.test(
        readFileSync(file, 'utf8')
      )
    );

    expect(importers.map((f) => f.slice(SRC.length + 1).split('\\').join('/'))).toEqual([]);
  });

  it('is not imported by any other service either', () => {
    const otherServices = sourceFiles(join(SRC, 'services')).filter(
      (file) => !file.includes(join('services', 'serverBoundary'))
    );

    const importers = otherServices.filter((file) =>
      /from\s+['"][^'"]*serverExecution(Auth|Contract|Runner|Validation)['"]/.test(
        readFileSync(file, 'utf8')
      )
    );

    expect(importers.map((f) => f.slice(SRC.length + 1).split('\\').join('/'))).toEqual([]);
  });

  it('is deployed only through the Functions host, never bundled into the app', () => {
    const host = readFileSync(join(process.cwd(), 'functions', 'src', 'index.ts'), 'utf8');
    expect(host).toContain('export const realExecution = onRequest(');
    // The client entry points must not reference it.
    for (const entry of ['src/main.tsx', 'src/App.tsx']) {
      const source = readFileSync(join(process.cwd(), entry), 'utf8');
      expect(source).not.toMatch(/serverExecution|real-execution|realExecution/);
    }
  });

  it('keeps the Amadeus execution provider identity server-derived only', async () => {
    const { connection } = recordingConnection();
    const body = asBody(await run({ connection }));
    for (const result of body.providerResults) {
      // The provider id in a response is the server's own constant, never a
      // caller-supplied value, because the request contract has no id field.
      expect(result.providerId).toBe(AMADEUS_EXECUTION_PROVIDER_ID);
    }
  });
});
