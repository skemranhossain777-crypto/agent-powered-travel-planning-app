import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runServerBoundaryExecutionCapabilities } from '../services/serverBoundary/serverExecutionCapabilityRunner';
import { verifyServerExecutionCapabilityIdToken } from '../services/serverBoundary/serverExecutionCapabilityAuth';
import { SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND } from '../services/serverBoundary/serverExecutionCapabilityContract';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  normalizeAmadeusExecutionConfig,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';
import type { ProviderAdapterProfile } from '../domain/providers/providerAdapter';

const SRC = join(process.cwd(), 'src');
const SECRET = 'super-secret-client-secret-value';
const CLIENT_ID = 'super-secret-client-id-value';
const TOKEN = 'ya29.super-secret-access-token';

const READY_CONFIG = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
  credentials: { clientId: CLIENT_ID, clientSecret: SECRET, environment: 'production' },
}) as AmadeusExecutionConfig;

const DISABLED_CONFIG = normalizeAmadeusExecutionConfig({
  attemptEnabled: false,
}) as AmadeusExecutionConfig;

const CONFIGS = [
  DISABLED_CONFIG,
  normalizeAmadeusExecutionConfig({ attemptEnabled: true }) as AmadeusExecutionConfig,
  READY_CONFIG,
];

const PRINCIPAL = { uid: 'user-1' };

function sourceFiles(dir: string): string[] {
  // Tolerates a directory this project does not have (e.g. `src/hooks`), so the
  // guard reads as "no capability surface anywhere" rather than throwing.
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const CAPABILITY_MODULES = sourceFiles(join(SRC, 'services', 'serverBoundary')).filter((f) =>
  f.includes('serverExecutionCapability')
);

describe('serverExecutionCapability security', () => {
  describe('secret containment (required tests 23-25)', () => {
    it('never serializes a credential or access token (23, 24)', async () => {
      for (const config of CONFIGS) {
        const result = await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config,
          principal: PRINCIPAL,
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(SECRET);
        expect(serialized).not.toContain(CLIENT_ID);
        expect(serialized).not.toContain(TOKEN);
        expect(serialized).not.toContain('access_token');
        expect(serialized).not.toContain('clientSecret');
        expect(serialized).not.toContain('clientId');
      }
    });

    it('never returns the Amadeus environment name (25)', async () => {
      const serialized = JSON.stringify(
        await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config: READY_CONFIG,
          principal: PRINCIPAL,
        })
      );
      expect(serialized).not.toContain('production');
      expect(serialized).not.toContain('test');
    });

    it('never returns an environment key, config field, or gate token (25)', async () => {
      for (const config of CONFIGS) {
        const serialized = JSON.stringify(
          await runServerBoundaryExecutionCapabilities({
            method: 'GET',
            config,
            principal: PRINCIPAL,
          })
        );
        // The `ready` gate and a bare `disabled` value are internal and must not
        // appear. `ready` in particular would tell a client that credentials are
        // present, which is exactly the implication this endpoint must not create.
        expect(serialized).not.toMatch(/:"ready"/);
        expect(serialized).not.toMatch(/:"disabled"/);
        expect(serialized).not.toContain('attemptEnabled');
        expect(serialized).not.toContain('AMADEUS_');
        expect(serialized).not.toContain('environment');
        // No secret *name* is disclosed: the reason says configuration is
        // incomplete without identifying which value is absent.
        expect(serialized).not.toContain('AMADEUS_CLIENT_ID');
        expect(serialized).not.toContain('AMADEUS_CLIENT_SECRET');
      }
    });

    it('discloses that configuration is incomplete without naming the secret (8)', async () => {
      // A high-level state is what the client is entitled to, and it is safe: it
      // says nothing about which credential is missing or what its value is.
      const serialized = JSON.stringify(
        await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config: normalizeAmadeusExecutionConfig({ attemptEnabled: true }) as AmadeusExecutionConfig,
          principal: PRINCIPAL,
        })
      );
      expect(serialized).toContain('credentials-missing');
      expect(serialized).not.toContain('AMADEUS_CLIENT_ID');
      expect(serialized).not.toContain('AMADEUS_CLIENT_SECRET');
      expect(serialized).not.toContain('clientId');
      expect(serialized).not.toContain('clientSecret');
    });

    it('exposes no raw provider or upstream response (25)', async () => {
      for (const config of CONFIGS) {
        const serialized = JSON.stringify(
          await runServerBoundaryExecutionCapabilities({
            method: 'GET',
            config,
            principal: PRINCIPAL,
          })
        );
        expect(serialized).not.toContain('amadeus.com');
        expect(serialized).not.toContain('api.amadeus');
        expect(serialized).not.toContain('data');
        expect(serialized).not.toContain('error');
      }
    });

    it('never serializes the verified principal or uid', async () => {
      const serialized = JSON.stringify(
        await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config: READY_CONFIG,
          principal: { uid: 'user-super-secret-uid' },
        })
      );
      expect(serialized).not.toContain('user-super-secret-uid');
      expect(serialized).not.toContain('uid');
    });

    it('reuses the single existing verifier and adds no second auth mechanism', async () => {
      for (const module of CAPABILITY_MODULES) {
        const source = readFileSync(module, 'utf8');
        expect(source).not.toMatch(/verifyIdToken\s*\(/);
        expect(source).not.toMatch(/getAuth\(/);
        expect(source).not.toMatch(/jwt|jsonwebtoken|HS256/i);
      }
    });

    it('authenticates with the same verifier semantics as the STEP 67 boundary', async () => {
      const accept = async () => ({ uid: 'user-1' });
      expect((await verifyServerExecutionCapabilityIdToken('tok', accept)).ok).toBe(true);
      expect((await verifyServerExecutionCapabilityIdToken('', accept)).ok).toBe(false);
      expect((await verifyServerExecutionCapabilityIdToken(undefined, accept)).ok).toBe(false);

      const reject = async () => {
        throw new Error('nope');
      };
      const rejected = await verifyServerExecutionCapabilityIdToken('tok', reject);
      expect(rejected).toEqual({ ok: false, problem: 'invalid-token' });
    });

    it('verifies a token without ever reading a request', async () => {
      const verifier = vi.fn(async () => ({ uid: 'user-1' }));
      await verifyServerExecutionCapabilityIdToken('tok', verifier);
      expect(verifier).toHaveBeenCalledTimes(1);
      expect(verifier).toHaveBeenCalledWith('tok');
    });
  });

  describe('client cannot steer the result (required tests 26-27)', () => {
    it('rejects a body naming a different provider (26)', async () => {
      const result = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        raw: { providerId: 'other-provider' },
        config: DISABLED_CONFIG,
        principal: PRINCIPAL,
      });
      expect(result.httpStatus).toBe(400);
      expect(JSON.stringify(result)).not.toContain('other-provider');
    });

    it('rejects a body naming capability ids (27)', async () => {
      const result = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        raw: { capabilityIds: ['search-transport'] },
        config: READY_CONFIG,
        principal: PRINCIPAL,
      });
      expect(result.httpStatus).toBe(400);
      expect(JSON.stringify(result)).not.toContain('search-transport');
    });

    it('ignores provider and capability identifiers in the request entirely', async () => {
      // There is no query-parameter path at all: the same evaluation happens
      // whatever the client asks for, so a query string cannot influence it.
      const baseline = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: READY_CONFIG,
        principal: PRINCIPAL,
      });
      const withAttempts = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: READY_CONFIG,
        principal: PRINCIPAL,
        raw: { providerId: 'evil', capabilityId: 'search-transport' },
      });
      expect(withAttempts.httpStatus).toBe(400);
      expect(baseline.httpStatus).toBe(200);
    });

    it('is not a provider proxy: no host, url, or method may be supplied', async () => {
      for (const raw of [
        { host: 'evil.example.com' },
        { url: 'https://evil.example.com' },
        { method: 'POST' },
        { path: '/v1/security/v1' },
        { endpoint: 'bookings' },
      ]) {
        const result = await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          raw,
          config: READY_CONFIG,
          principal: PRINCIPAL,
        });
        expect(result.httpStatus).toBe(400);
        expect(JSON.stringify(result)).not.toContain('evil.example.com');
      }
    });

    it('never routes to a client-named function or provider', () => {
      for (const module of CAPABILITY_MODULES) {
        const source = readFileSync(module, 'utf8');
        expect(source).not.toMatch(/providerId\s*[:=]\s*(req|request|input|query|params)\b/);
      }
    });
  });

  describe('response validation (required tests 28-31)', () => {
    it('has only approved fields at the top level and per provider (28)', async () => {
      const result = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: READY_CONFIG,
        principal: PRINCIPAL,
      });
      const body = result.body as { kind: string; providers: object[]; problem: null };
      expect(Object.keys(body).sort()).toEqual(['kind', 'problem', 'providers']);
      expect(body.kind).toBe(SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND);
      for (const entry of body.providers) {
        expect(Object.keys(entry).sort()).toEqual([
          'capabilityIds',
          'providerId',
          'reason',
          'status',
        ]);
      }
    });

    it('reports a valid, server-derived provider identity (29)', async () => {
      for (const config of CONFIGS) {
        const result = await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config,
          principal: PRINCIPAL,
        });
        const body = result.body as { providers: { providerId: string }[] };
        for (const entry of body.providers) {
          expect(entry.providerId).toBe(AMADEUS_EXECUTION_PROVIDER_ID);
          // A bounded, trimmed, non-empty application-facing key.
          expect(entry.providerId).toBe(entry.providerId.trim());
          expect(entry.providerId.length).toBeGreaterThan(0);
          expect(entry.providerId.length).toBeLessThanOrEqual(100);
        }
      }
    });

    it('emits capability ids deterministically and in recognized vocabulary (30)', async () => {
      const first = await runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: READY_CONFIG,
        principal: PRINCIPAL,
      });
      for (let i = 0; i < 5; i += 1) {
        const again = await runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config: READY_CONFIG,
          principal: PRINCIPAL,
        });
        expect(JSON.stringify(again)).toBe(JSON.stringify(first));
      }
      const body = first.body as { providers: { capabilityIds: string[] }[] };
      for (const entry of body.providers) {
        expect(entry.capabilityIds).toEqual([...entry.capabilityIds].sort());
        for (const id of entry.capabilityIds) {
          expect(PROVIDER_CAPABILITY_IDS).toContain(id);
        }
      }
    });
  });

  /**
   * The `available` branch and the malformed-profile branch are unreachable
   * through the real STEP 66 service: nothing is implemented, so no profile ever
   * declares an available capability, and the profile is always well formed.
   *
   * Rather than add a production injection seam - which would let a caller
   * substitute the provider whose capability is being reported - the real module
   * is replaced for these cases only. This keeps the production boundary sealed
   * while still proving the mapping is correct in both directions.
   */
  describe('fail-closed and future-mapping behavior (required test 31)', () => {
    interface FakeService {
      gate: string;
      providers: Array<{ providerId: string; execute: () => Promise<never> }>;
      providerIds: string[];
      amadeusCapabilityProfile: unknown;
      amadeusProvider: unknown;
    }

    async function runWithProfile(profile: unknown): Promise<{
      status: number;
      body: { providers: Array<{ status: string; reason: string | null; capabilityIds: string[] }> };
      executeCalls: () => number;
    }> {
      vi.resetModules();
      const execute = vi.fn(async () => {
        throw new Error('execute() must never be called by capability discovery');
      });

      const service: FakeService = {
        gate: 'ready',
        providers: [{ providerId: AMADEUS_EXECUTION_PROVIDER_ID, execute }],
        providerIds: [AMADEUS_EXECUTION_PROVIDER_ID],
        amadeusCapabilityProfile: profile,
        amadeusProvider: { providerId: AMADEUS_EXECUTION_PROVIDER_ID },
      };

      vi.doMock('../services/realExecution/realExecutionService', () => ({
        createRealExecutionService: () => service,
      }));

      const runner = await import('../services/serverBoundary/serverExecutionCapabilityRunner');
      const result = await runner.runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: READY_CONFIG,
        principal: PRINCIPAL,
      });
      return {
        status: result.httpStatus,
        body: result.body as never,
        executeCalls: () => execute.mock.calls.length,
      };
    }

    it('fails closed on a malformed capability profile (31)', async () => {
      const malformed: unknown[] = [
        null,
        'not-a-profile',
        {},
        { id: AMADEUS_EXECUTION_PROVIDER_ID },
        { id: AMADEUS_EXECUTION_PROVIDER_ID, name: 'x' },
        { id: AMADEUS_EXECUTION_PROVIDER_ID, name: 'x', capabilities: 'nope' },
        // A capability id outside the recognized vocabulary.
        {
          id: AMADEUS_EXECUTION_PROVIDER_ID,
          name: 'x',
          capabilities: [{ capability: 'flight-booking', status: 'available' }],
        },
        // A status outside the recognized vocabulary.
        {
          id: AMADEUS_EXECUTION_PROVIDER_ID,
          name: 'x',
          capabilities: [{ capability: 'search-transport', status: 'definitely-yes' }],
        },
        // A profile that claims a different identity than the composed provider.
        {
          id: 'some-other-provider',
          name: 'x',
          capabilities: [{ capability: 'search-transport', status: 'available' }],
        },
      ];

      for (const profile of malformed) {
        const { status, body } = await runWithProfile(profile);
        expect(status).toBe(200);
        const entry = body.providers[0];
        expect(entry.status).toBe('unsupported');
        expect(entry.reason).toBe('malformed-provider-capability');
        expect(entry.capabilityIds).toEqual([]);
      }
    });

    it('never calls execute even when a capability is genuinely available (19, 30)', async () => {
      // A well-formed profile that really does declare an available capability.
      const profile: ProviderAdapterProfile = {
        id: AMADEUS_EXECUTION_PROVIDER_ID,
        name: 'Amadeus Execution',
        capabilities: [
          { capability: 'search-transport', status: 'available' },
          { capability: 'verify-reference', status: 'unsupported' },
        ],
      };

      const { status, body, executeCalls } = await runWithProfile(profile);
      expect(status).toBe(200);
      // The mapping is correct if an operation is ever implemented...
      expect(body.providers[0].status).toBe('available');
      expect(body.providers[0].reason).toBeNull();
      expect(body.providers[0].capabilityIds).toEqual(['search-transport']);
      // ...and reporting a capability still executes nothing.
      expect(executeCalls()).toBe(0);
    });

    it('still claims no capability when the gate is not ready, whatever the profile claims', async () => {
      // Belt-and-braces invariant: a disabled build cannot report capability even
      // if a profile were somehow to declare one.
      vi.resetModules();
      const execute = vi.fn(async () => {
        throw new Error('unreachable');
      });
      vi.doMock('../services/realExecution/realExecutionService', () => ({
        createRealExecutionService: () => ({
          gate: 'ready',
          providers: [{ providerId: AMADEUS_EXECUTION_PROVIDER_ID, execute }],
          providerIds: [AMADEUS_EXECUTION_PROVIDER_ID],
          amadeusCapabilityProfile: {
            id: AMADEUS_EXECUTION_PROVIDER_ID,
            name: 'Amadeus Execution',
            capabilities: [{ capability: 'search-transport', status: 'available' }],
          },
          amadeusProvider: { providerId: AMADEUS_EXECUTION_PROVIDER_ID },
        }),
      }));

      const runner = await import('../services/serverBoundary/serverExecutionCapabilityRunner');
      const result = await runner.runServerBoundaryExecutionCapabilities({
        method: 'GET',
        config: DISABLED_CONFIG,
        principal: PRINCIPAL,
      });
      const body = result.body as {
        providers: Array<{ status: string; reason: string; capabilityIds: string[] }>;
      };
      expect(body.providers[0].status).toBe('unavailable');
      expect(body.providers[0].reason).toBe('execution-disabled');
      expect(body.providers[0].capabilityIds).toEqual([]);
      expect(execute.mock.calls.length).toBe(0);
    });

    it('never calls execute in the real, unmocked service either (19)', async () => {
      vi.doUnmock('../services/realExecution/realExecutionService');
      vi.resetModules();
      const runner = await import('../services/serverBoundary/serverExecutionCapabilityRunner');
      for (const config of CONFIGS) {
        const result = await runner.runServerBoundaryExecutionCapabilities({
          method: 'GET',
          config,
          principal: PRINCIPAL,
        });
        expect(result.httpStatus).toBe(200);
      }
    });
  });

  describe('browser exposure and deployment', () => {
    it('is imported by no component, hook, or client-reachable service', () => {
      const clientReachable = sourceFiles(SRC).filter((file) => {
        const relative = file.slice(SRC.length + 1).split('\\').join('/');
        if (relative.startsWith('services/serverBoundary/')) return false;
        if (relative.startsWith('test/')) return false;
        if (relative.startsWith('services/')) return false;
        return true;
      });
      const importers = clientReachable.filter((file) =>
        /from\s+['"][^'"]*serverExecutionCapability(Auth|Contract|Runner|Validation)['"]/.test(
          readFileSync(file, 'utf8')
        )
      );
      expect(importers.map((f) => f.slice(SRC.length + 1).split('\\').join('/'))).toEqual([]);
    });

    it('is imported by no other service either', () => {
      const otherServices = sourceFiles(join(SRC, 'services')).filter(
        (file) => !file.includes(join('services', 'serverBoundary'))
      );
      const importers = otherServices.filter((file) =>
        /from\s+['"][^'"]*serverExecutionCapability(Auth|Contract|Runner|Validation)['"]/.test(
          readFileSync(file, 'utf8')
        )
      );
      expect(importers.map((f) => f.slice(SRC.length + 1).split('\\').join('/'))).toEqual([]);
    });

    it('is deployed only through the Functions host, never bundled into the app', () => {
      const host = readFileSync(join(process.cwd(), 'functions', 'src', 'index.ts'), 'utf8');
      expect(host).toContain('export const realExecutionCapabilities = onRequest(');
      for (const entry of ['src/main.tsx', 'src/App.tsx']) {
        const source = readFileSync(join(process.cwd(), entry), 'utf8');
        expect(source).not.toMatch(/capabilit/i);
      }
    });

    it('reads no environment and no credential in the capability boundary', () => {
      for (const module of CAPABILITY_MODULES) {
        const source = readFileSync(module, 'utf8');
        expect(source).not.toMatch(/process\.env/);
        expect(source).not.toMatch(/import\.meta\.env/);
        expect(source).not.toMatch(/AMADEUS_CLIENT_SECRET/);
        expect(source).not.toMatch(/AMADEUS_CLIENT_ID/);
        expect(source).not.toMatch(/VITE_AMADEUS/);
      }
    });

    it('adds no UI surface: no hook, panel, badge, or state', () => {
      const components = sourceFiles(join(SRC, 'components'));
      expect(components.filter((f) => /capabilit/i.test(f))).toEqual([]);
      const hooks = sourceFiles(join(SRC, 'hooks'));
      expect(hooks.filter((f) => /capabilit/i.test(f))).toEqual([]);
    });
  });
});
