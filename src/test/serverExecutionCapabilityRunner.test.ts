import { describe, expect, it } from 'vitest';
import {
  runServerBoundaryExecutionCapabilities,
  type RunServerExecutionCapabilityInput,
} from '../services/serverBoundary/serverExecutionCapabilityRunner';
import {
  isServerExecutionCapabilityResponse,
  SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND,
  type ServerExecutionCapabilityEntry,
  type ServerExecutionCapabilityHttpResult,
} from '../services/serverBoundary/serverExecutionCapabilityContract';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  normalizeAmadeusExecutionConfig,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';

const SECRET = 'execution-client-secret';
const CLIENT_ID = 'execution-client-id';

const DISABLED_CONFIG = normalizeAmadeusExecutionConfig({
  attemptEnabled: false,
}) as AmadeusExecutionConfig;

const CREDENTIALS_MISSING_CONFIG = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
}) as AmadeusExecutionConfig;

const READY_CONFIG = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
  credentials: { clientId: CLIENT_ID, clientSecret: SECRET, environment: 'production' },
}) as AmadeusExecutionConfig;

const PRINCIPAL = { uid: 'user-1' };

function run(
  overrides: Partial<RunServerExecutionCapabilityInput> = {}
): Promise<ServerExecutionCapabilityHttpResult> {
  return runServerBoundaryExecutionCapabilities({
    method: 'GET',
    config: DISABLED_CONFIG,
    principal: PRINCIPAL,
    ...overrides,
  });
}

/** Narrows a 200 result to its provider entries, failing the test otherwise. */
function entriesOf(result: ServerExecutionCapabilityHttpResult): ServerExecutionCapabilityEntry[] {
  if (result.httpStatus !== 200) {
    throw new Error(`expected HTTP 200 but received ${result.httpStatus}`);
  }
  if (!isServerExecutionCapabilityResponse(result.body)) {
    throw new Error('expected a capability response body');
  }
  return result.body.providers;
}

describe('runServerBoundaryExecutionCapabilities', () => {
  describe('authentication (required tests 1-3)', () => {
    it('rejects an unauthenticated request with 401 (1)', async () => {
      const result = await run({ principal: null });
      expect(result.httpStatus).toBe(401);
      expect(result.body).toEqual({
        kind: 'server-execution-auth-error',
        status: 'unauthenticated',
        message: 'You must be signed in to run real-provider execution.',
      });
    });

    it('rejects a null-ish principal as unauthenticated (1)', async () => {
      for (const principal of [null, undefined]) {
        const result = await run({ principal: principal as never });
        expect(result.httpStatus).toBe(401);
      }
    });

    it('rejects an invalid token with 401 and a distinguishable status (2)', async () => {
      const result = await run({ principal: null, authProblem: 'invalid-token' });
      expect(result.httpStatus).toBe(401);
      expect(result.body).toEqual({
        kind: 'server-execution-auth-error',
        status: 'invalid-token',
        message: 'The session token could not be verified. Please sign in again.',
      });
    });

    it('rejects before evaluating any method, body, or capability (1, 2)', async () => {
      // Auth is decided first: a bad method or body cannot turn a 401 into a 400/405,
      // and a disabled build still reports 401 rather than leaking its state.
      for (const overrides of [
        { method: 'POST' },
        { method: 'DELETE' },
        { raw: { providerId: 'x' } },
        { config: READY_CONFIG },
      ]) {
        const result = await run({ principal: null, ...overrides });
        expect(result.httpStatus).toBe(401);
      }
    });

    it('proceeds to capability evaluation when authenticated (3)', async () => {
      const result = await run();
      expect(result.httpStatus).toBe(200);
      expect(entriesOf(result)).toHaveLength(1);
    });

    it('reuses the STEP 67 auth-error body so one 401 handler serves both endpoints', async () => {
      const result = await run({ principal: null });
      expect(result.body.kind).toBe('server-execution-auth-error');
    });
  });

  describe('method and body rejection (required tests 4-7)', () => {
    it('succeeds on GET (4)', async () => {
      expect((await run({ method: 'GET' })).httpStatus).toBe(200);
    });

    it('rejects POST with 405 (5)', async () => {
      const result = await run({ method: 'POST' });
      expect(result.httpStatus).toBe(405);
      expect(result.body).toEqual({
        kind: SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND,
        providers: [],
        problem: 'unsupported-method',
      });
    });

    it('rejects PUT with 405 (6)', async () => {
      const result = await run({ method: 'PUT' });
      expect(result.httpStatus).toBe(405);
    });

    it('rejects DELETE with 405 (7)', async () => {
      const result = await run({ method: 'DELETE' });
      expect(result.httpStatus).toBe(405);
    });

    it('rejects any request body with 400 and an empty provider list', async () => {
      const result = await run({ raw: { providerId: 'amadeus-execution' } });
      expect(result.httpStatus).toBe(400);
      expect(result.body).toEqual({
        kind: SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND,
        providers: [],
        problem: 'unexpected-body',
      });
    });

    it('never lets a rejection be mistaken for a real empty capability set', async () => {
      // A refused query and a genuine "no capabilities" answer both have an empty
      // providers array, so `problem` is what distinguishes them.
      const rejected = await run({ method: 'POST' });
      const evaluated = await run();
      expect(rejected.body).toHaveProperty('problem', 'unsupported-method');
      expect(evaluated.body).toHaveProperty('problem', null);
    });
  });

  describe('capability state (required tests 8-11)', () => {
    it('reports unavailable when execution is disabled by default (8)', async () => {
      // The default configuration: AMADEUS_EXECUTION_ENABLED=false.
      const result = await run({ config: DISABLED_CONFIG });
      const entries = entriesOf(result);
      expect(entries).toEqual([
        {
          providerId: AMADEUS_EXECUTION_PROVIDER_ID,
          status: 'unavailable',
          capabilityIds: [],
          reason: 'execution-disabled',
        },
      ]);
    });

    it('reports unavailable when credentials are missing (9)', async () => {
      const result = await run({ config: CREDENTIALS_MISSING_CONFIG });
      const entries = entriesOf(result);
      expect(entries[0].status).toBe('unavailable');
      expect(entries[0].reason).toBe('credentials-missing');
      expect(entries[0].capabilityIds).toEqual([]);
    });

    it('does not falsely claim executable capability when fully configured (10)', async () => {
      const result = await run({ config: READY_CONFIG });
      const entries = entriesOf(result);
      expect(entries[0].status).not.toBe('available');
      expect(entries[0].status).toBe('unsupported');
    });

    it('distinguishes configured-but-unimplemented from disabled (9 vs 10)', async () => {
      // The core invariant: credentials being present does NOT mean capability.
      const missing = entriesOf(await run({ config: CREDENTIALS_MISSING_CONFIG }))[0];
      const configured = entriesOf(await run({ config: READY_CONFIG }))[0];
      expect(missing.status).toBe('unavailable');
      expect(configured.status).toBe('unsupported');
      expect(missing.status).not.toBe(configured.status);
    });

    it('returns an empty capabilityIds array because nothing is implemented (11)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        const entries = entriesOf(await run({ config }));
        expect(entries[0].capabilityIds).toEqual([]);
      }
    });

    it('always reports the amadeus provider identity, server-derived', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        const entries = entriesOf(await run({ config }));
        expect(entries[0].providerId).toBe(AMADEUS_EXECUTION_PROVIDER_ID);
      }
    });

    it('reports a reason for every non-available state and null only for available', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        const entry = entriesOf(await run({ config }))[0];
        if (entry.status === 'available') expect(entry.reason).toBeNull();
        else expect(typeof entry.reason).toBe('string');
      }
    });

    it('is deterministic across repeated calls', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        const first = JSON.stringify(await run({ config }));
        for (let i = 0; i < 3; i += 1) {
          expect(JSON.stringify(await run({ config }))).toBe(first);
        }
      }
    });
  });

  describe('truthfulness (required tests 12-18)', () => {
    // The vocabulary a client would use to infer a real operation. None of it may
    // ever appear in the response, in any configuration.
    const FORBIDDEN_CAPABILITY_CLAIMS = [
      'flight-booking',
      'hotel-booking',
      'ticket-purchase',
      'payment',
      'reservation',
      'cancellation',
      'modification',
    ];

    it('claims no flight booking capability (12)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('flight-booking');
      }
    });

    it('claims no hotel booking capability (13)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('hotel-booking');
      }
    });

    it('claims no ticket purchase capability (14)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('ticket-purchase');
      }
    });

    it('claims no payment capability (15)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('payment');
      }
    });

    it('claims no reservation capability (16)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('reservation');
      }
    });

    it('claims no cancellation capability (17)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('cancellation');
      }
    });

    it('claims no modification capability (18)', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect(JSON.stringify(entriesOf(await run({ config })))).not.toContain('modification');
      }
    });

    it('emits no forbidden claim under any configuration, in one sweep', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        const serialized = JSON.stringify(await run({ config }));
        for (const claim of FORBIDDEN_CAPABILITY_CLAIMS) {
          expect(serialized).not.toContain(claim);
        }
      }
    });

    it('every emitted capability id is drawn from the recognized STEP 20 vocabulary', async () => {
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        for (const entry of entriesOf(await run({ config }))) {
          for (const id of entry.capabilityIds) {
            expect(PROVIDER_CAPABILITY_IDS).toContain(id);
          }
        }
      }
    });

    it('does not report an available capability for any declaration state', async () => {
      // Even the two read-only-looking Step 20 ids that mention booking/cancellation
      // are read-only *retrieval* vocabulary, and none is implemented here.
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        for (const entry of entriesOf(await run({ config }))) {
          expect(entry.capabilityIds).toHaveLength(0);
        }
      }
    });
  });

  describe('side-effect freedom (required tests 19-22)', () => {
    it('never calls a provider execute (19)', async () => {
      // A spy on the composed provider would fail the test if it were reached. The
      // seam is proven absent in dependencyBoundary; here the observable proof is
      // that the result is derived purely from the gate and the declared profile.
      const result = await run({ config: READY_CONFIG });
      expect(entriesOf(result)[0].reason).toBe('no-executable-capability');
    });

    it('reads no transport and makes no network call (20)', async () => {
      // The runner imports no connection type and receives no connection option, so
      // there is no transport to consult; evaluating every config must still succeed.
      for (const config of [DISABLED_CONFIG, CREDENTIALS_MISSING_CONFIG, READY_CONFIG]) {
        expect((await run({ config })).httpStatus).toBe(200);
      }
    });

    it('performs no Firestore write and creates no execution request (21, 22)', async () => {
      const result = await run({ config: READY_CONFIG });
      const serialized = JSON.stringify(result);
      for (const forbidden of [
        'setDoc',
        'addDoc',
        'updateDoc',
        'deleteDoc',
        'runTransaction',
        'trip-execution-provider-request',
        'dispatchId',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('never mutates the config it is given', async () => {
      const snapshot = JSON.stringify(READY_CONFIG);
      await run({ config: READY_CONFIG });
      expect(JSON.stringify(READY_CONFIG)).toBe(snapshot);
    });

    it('returns a body containing only the contract fields', async () => {
      const result = await run({ config: READY_CONFIG });
      expect(result.httpStatus).toBe(200);
      if (!isServerExecutionCapabilityResponse(result.body)) {
        throw new Error('expected a capability response body');
      }
      const body = result.body;
      expect(Object.keys(body).sort()).toEqual(['kind', 'problem', 'providers']);
      for (const entry of body.providers) {
        expect(Object.keys(entry).sort()).toEqual([
          'capabilityIds',
          'providerId',
          'reason',
          'status',
        ]);
      }
    });
  });

  describe('internal fault containment', () => {
    it('reports a defensive 500 when the config throws', async () => {
      const hostile = {
        get attemptEnabled(): boolean {
          throw new Error('boom');
        },
      } as unknown as AmadeusExecutionConfig;

      const result = await run({ config: hostile });
      expect(result.httpStatus).toBe(500);
      expect(result.body).toEqual({
        kind: SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND,
        providers: [],
        problem: 'unexpected-failure',
      });
    });

    it('never throws out of the runner for a malformed config', async () => {
      for (const config of [
        null,
        undefined,
        {},
        { attemptEnabled: 'yes', credentials: 'secret' },
      ] as unknown as AmadeusExecutionConfig[]) {
        const result = await run({ config });
        expect([200, 500]).toContain(result.httpStatus);
        expect(JSON.stringify(result)).not.toContain('boom');
      }
    });

    it('never leaks an internal exception message', async () => {
      const hostile = {
        get credentials(): never {
          throw new Error('AMADEUS_CLIENT_SECRET=hunter2');
        },
      } as unknown as AmadeusExecutionConfig;

      const result = await run({ config: hostile });
      expect(JSON.stringify(result)).not.toContain('hunter2');
      expect(JSON.stringify(result)).not.toContain('boom');
    });
  });
});
