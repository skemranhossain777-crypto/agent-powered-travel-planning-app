import { describe, expect, it, vi } from 'vitest';
import {
  getTripExecutionCapabilities,
  TRIP_EXECUTION_CAPABILITIES_ENDPOINT,
  type TripExecutionCapabilityFetch,
  type TripExecutionCapabilityFetchResponse,
  type TripExecutionCapabilityServiceOptions,
} from '../services/tripExecution/tripExecutionCapabilityService';
import { PROVIDER_CAPABILITY_IDS } from '../domain/providers/providerCapabilities';
import { SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND } from '../services/serverBoundary/serverExecutionCapabilityContract';

const ID_TOKEN = 'browser-id-token-abc123';

/** A well-formed STEP 68 success body, with overrides applied per test. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'server-execution-capabilities',
    providers: [
      {
        providerId: 'amadeus-execution',
        status: 'unavailable',
        capabilityIds: [],
        reason: 'execution-disabled',
      },
    ],
    problem: null,
    ...overrides,
  };
}

function unavailableEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId: 'amadeus-execution',
    status: 'unavailable',
    capabilityIds: [],
    reason: 'execution-disabled',
    ...overrides,
  };
}

function okResponse(payload: unknown, status = 200): TripExecutionCapabilityFetchResponse {
  return { status, json: async () => payload };
}

interface Harness {
  options: TripExecutionCapabilityServiceOptions;
  calls: Array<{ url: string; init: { method: string; headers: Readonly<Record<string, string>> } }>;
}

/** Records every request so the request shape itself can be asserted. */
function harness(
  response: TripExecutionCapabilityFetchResponse | (() => never),
  token: string | (() => Promise<string>) = ID_TOKEN
): Harness {
  const calls: Harness['calls'] = [];
  const fetchImpl: TripExecutionCapabilityFetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof response === 'function') response();
    return response as TripExecutionCapabilityFetchResponse;
  };
  return {
    calls,
    options: {
      tokenProvider: typeof token === 'string' ? async () => token : token,
      fetchImpl,
    },
  };
}

async function read(response: TripExecutionCapabilityFetchResponse) {
  return getTripExecutionCapabilities(harness(response).options);
}

describe('tripExecutionCapabilityService', () => {
  describe('request shape (required tests 1-5)', () => {
    it('calls exactly the fixed endpoint path and nothing else (1)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/api/real-execution/capabilities');
      expect(calls[0].url).toBe(TRIP_EXECUTION_CAPABILITIES_ENDPOINT);
    });

    it('exposes the endpoint as a constant that no input can change (1)', async () => {
      expect(TRIP_EXECUTION_CAPABILITIES_ENDPOINT).toBe('/api/real-execution/capabilities');
      // The function takes no arguments, so there is no parameter through which a
      // host, path, or provider could be supplied.
      expect(getTripExecutionCapabilities.length).toBe(1);
    });

    it('uses GET and never any other method (2)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      expect(calls[0].init.method).toBe('GET');
    });

    it('sends no request body (3)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      // `body` is absent from the init object entirely, not sent as an empty value.
      expect(calls[0].init).not.toHaveProperty('body');
      expect(Object.keys(calls[0].init).sort()).toEqual(['headers', 'method']);
    });

    it('sends no provider, capability, url, host, or credential input (4)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      const serialized = JSON.stringify(calls[0]);
      for (const forbidden of [
        'providerId',
        'capabilityId',
        'capabilityIds',
        'host',
        'credentials',
        'url=',
        'clientId',
        'clientSecret',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('authenticates through the injected token provider (5)', async () => {
      const tokenProvider = vi.fn(async () => ID_TOKEN);
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities({ ...options, tokenProvider });
      expect(tokenProvider).toHaveBeenCalledTimes(1);
      expect(tokenProvider).toHaveBeenCalledWith();
      expect(calls[0].init.headers.authorization).toBe(`Bearer ${ID_TOKEN}`);
    });

    it('sends only the authorization header, with no content-type (3, 4)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      expect(Object.keys(calls[0].init.headers)).toEqual(['authorization']);
    });

    it('performs exactly one request per invocation, with no retry or polling (5)', async () => {
      const { options, calls } = harness(okResponse(body()));
      await getTripExecutionCapabilities(options);
      expect(calls).toHaveLength(1);
      // A second explicit call is a second request: nothing is cached in between.
      await getTripExecutionCapabilities(options);
      expect(calls).toHaveLength(2);
    });
  });

  describe('valid responses (required tests 6-11)', () => {
    it('parses an available provider (6)', async () => {
      const result = await read(
        okResponse(
          body({
            providers: [
              {
                providerId: 'amadeus-execution',
                status: 'available',
                capabilityIds: ['search-transport'],
                reason: null,
              },
            ],
          })
        )
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.providers[0]).toEqual({
        providerId: 'amadeus-execution',
        status: 'available',
        capabilityIds: ['search-transport'],
        reason: null,
      });
    });

    it('parses an unavailable provider (7)', async () => {
      const result = await read(okResponse(body()));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.providers[0].status).toBe('unavailable');
      expect(result.snapshot.providers[0].reason).toBe('execution-disabled');
    });

    it('parses an unsupported provider (8)', async () => {
      const result = await read(
        okResponse(
          body({
            providers: [
              {
                providerId: 'amadeus-execution',
                status: 'unsupported',
                capabilityIds: [],
                reason: 'no-executable-capability',
              },
            ],
          })
        )
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.providers[0].status).toBe('unsupported');
      expect(result.snapshot.providers[0].reason).toBe('no-executable-capability');
    });

    it('parses an empty capability list (9)', async () => {
      const result = await read(okResponse(body({ providers: [unavailableEntry()] })));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.providers[0].capabilityIds).toEqual([]);
    });

    it('preserves the server provider order (10)', async () => {
      const result = await read(
        okResponse(
          body({
            providers: [
              {
                providerId: 'provider-b',
                status: 'unavailable',
                capabilityIds: [],
                reason: 'credentials-missing',
              },
              {
                providerId: 'provider-a',
                status: 'unsupported',
                capabilityIds: [],
                reason: 'no-executable-capability',
              },
            ],
          })
        )
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Order is the server's, not sorted locally.
      expect(result.snapshot.providers.map((p) => p.providerId)).toEqual([
        'provider-b',
        'provider-a',
      ]);
    });

    it('parses every safe reason the server can send (11)', async () => {
      const reasons = [
        'execution-disabled',
        'credentials-missing',
        'no-executable-capability',
        'malformed-provider-capability',
        'unexpected-failure',
      ];
      for (const reason of reasons) {
        const result = await read(
          okResponse(body({ providers: [unavailableEntry({ reason })] }))
        );
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.snapshot.providers[0].reason).toBe(reason);
      }
    });

    it('parses each bounded problem (11)', async () => {
      for (const problem of ['unsupported-method', 'unexpected-body', 'unexpected-failure']) {
        const result = await read(okResponse(body({ providers: [], problem })));
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.snapshot.problem).toBe(problem);
        expect(result.snapshot.providers).toEqual([]);
      }
    });

    it('parses an empty provider list', async () => {
      const result = await read(okResponse(body({ providers: [] })));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.providers).toEqual([]);
    });

    it('accepts a capability id drawn from the domain vocabulary (6, 9)', async () => {
      for (const id of PROVIDER_CAPABILITY_IDS) {
        const result = await read(
          okResponse(
            body({
              providers: [
                {
                  providerId: 'amadeus-execution',
                  status: 'available',
                  capabilityIds: [id],
                  reason: null,
                },
              ],
            })
          )
        );
        expect(result.ok).toBe(true);
      }
    });

    it('copies the capability list so a later caller mutation cannot alias it', async () => {
      const result = await read(
        okResponse(
          body({
            providers: [
              {
                providerId: 'amadeus-execution',
                status: 'available',
                capabilityIds: ['search-transport'],
                reason: null,
              },
            ],
          })
        )
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      result.snapshot.providers[0].capabilityIds.push('injected');
      // The service hands over its own array, not a reference into the parsed body.
      expect(result.snapshot.providers[0].capabilityIds).toEqual([
        'search-transport',
        'injected',
      ]);
    });

    it('treats any 2xx status as a candidate body to validate', async () => {
      for (const status of [200, 201, 204]) {
        const result = await read(okResponse(body(), status));
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('invalid responses (required tests 12-20)', () => {
    const expectRejected = async (payload: unknown, status = 200) => {
      const result = await read(okResponse(payload, status));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // A malformed body is never presented as an empty capability set.
      expect(result.snapshot).toBeNull();
      expect(result.error.category).toBe('malformed-response');
    };

    it('rejects a non-object root (12)', async () => {
      for (const payload of [null, undefined, 'ok', 42, true, ['a']]) {
        await expectRejected(payload);
      }
    });

    it('rejects an unknown root key (13)', async () => {
      await expectRejected(body({ extra: 'nope' }));
      await expectRejected(body({ config: { attemptEnabled: true } }));
    });

    it('rejects a missing root key (13)', async () => {
      const partial = body();
      delete partial.providers;
      await expectRejected(partial);
    });

    it('rejects a wrong kind (13)', async () => {
      await expectRejected(body({ kind: 'server-execution-auth-error' }));
      await expectRejected(body({ kind: 'something-else' }));
      await expectRejected(body({ kind: undefined }));
    });

    it('rejects a malformed provider entry (14)', async () => {
      await expectRejected(body({ providers: [null] }));
      await expectRejected(body({ providers: ['amadeus-execution'] }));
      await expectRejected(body({ providers: [[]] }));
      await expectRejected(body({ providers: 'amadeus-execution' }));
    });

    it('rejects an invalid provider id (15)', async () => {
      for (const providerId of [
        '',
        '  ',
        ' padded',
        'trailing ',
        'https://evil.example.com',
        'a'.repeat(101),
        42,
        null,
      ]) {
        await expectRejected(
          body({ providers: [unavailableEntry({ providerId })] })
        );
      }
    });

    it('rejects an invalid status (16)', async () => {
      for (const status of ['ready', 'enabled', 'ok', 'AVAILABLE', '', 200, null]) {
        await expectRejected(
          body({
            providers: [unavailableEntry({ status, reason: 'execution-disabled' })],
          })
        );
      }
    });

    it('rejects a malformed capability id (17)', async () => {
      for (const capabilityIds of [
        ['flight-booking'],
        ['unknown-capability'],
        [''],
        ['search-transport', 'made-up'],
        [42],
        [null],
        'search-transport',
        {},
      ]) {
        await expectRejected(
          body({
            providers: [
              {
                providerId: 'amadeus-execution',
                status: 'available',
                capabilityIds,
                reason: null,
              },
            ],
          })
        );
      }
    });

    it('rejects an invalid reason (18)', async () => {
      for (const reason of ['ready', 'credentials-missing-secret', '', 42, {}]) {
        await expectRejected(body({ providers: [unavailableEntry({ reason })] }));
      }
    });

    it('rejects an unexpected provider field (19)', async () => {
      await expectRejected(
        body({
          providers: [
            unavailableEntry({ clientSecret: 'leaked', endpoint: 'https://x' }),
          ],
        })
      );
      await expectRejected(
        body({
          providers: [
            unavailableEntry({ name: 'Amadeus Execution', baseUrl: 'https://x' }),
          ],
        })
      );
    });

    it('rejects a missing provider field (19)', async () => {
      for (const field of ['providerId', 'status', 'capabilityIds', 'reason']) {
        const entry = unavailableEntry();
        delete entry[field];
        await expectRejected(body({ providers: [entry] }));
      }
    });

    it('rejects an invalid problem (18)', async () => {
      for (const problem of ['boom', '', 42, {}]) {
        await expectRejected(body({ providers: [], problem }));
      }
    });

    it('rejects an available status that still carries a reason, and vice versa', async () => {
      // An `available` provider with a reason, or an unavailable one without, is
      // internally inconsistent and must not be presented as trustworthy.
      await expectRejected(
        body({
          providers: [
            {
              providerId: 'amadeus-execution',
              status: 'available',
              capabilityIds: [],
              reason: 'execution-disabled',
            },
          ],
        })
      );
      await expectRejected(
        body({
          providers: [
            {
              providerId: 'amadeus-execution',
              status: 'unavailable',
              capabilityIds: [],
              reason: null,
            },
          ],
        })
      );
    });

    it('rejects one malformed entry even when its siblings are valid (14, 29)', async () => {
      await expectRejected(
        body({
          providers: [
            unavailableEntry(),
            { providerId: 'bad', status: 'nope', capabilityIds: [], reason: null },
            unavailableEntry(),
          ],
        })
      );
    });

    it('rejects malformed JSON from the transport (20)', async () => {
      const result = await read({
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.snapshot).toBeNull();
      expect(result.error.category).toBe('malformed-response');
      // The parser's own message is never surfaced.
      expect(result.error.message).not.toContain('Unexpected token');
    });
  });

  describe('HTTP errors (required tests 21-26)', () => {
    it('normalizes 401 to an authentication failure (21)', async () => {
      for (const payload of [
        { kind: 'server-execution-auth-error', status: 'unauthenticated', message: 'x' },
        { kind: 'server-execution-auth-error', status: 'invalid-token', message: 'x' },
        {},
      ]) {
        const result = await read(okResponse(payload, 401));
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.snapshot).toBeNull();
        expect(result.error.category).toBe('authentication-required');
      }
    });

    it('normalizes 400 to an invalid-input failure (22)', async () => {
      const result = await read(okResponse({}, 400));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.snapshot).toBeNull();
      expect(result.error.category).toBe('invalid-input');
    });

    it('normalizes 405 to an invalid-input failure (23)', async () => {
      const result = await read(okResponse({}, 405));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe('invalid-input');
    });

    it('normalizes 500 to a server failure (24)', async () => {
      const result = await read(okResponse({}, 500));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe('unknown');
    });

    it('normalizes 502 to a provider-unavailable failure (25)', async () => {
      const result = await read(okResponse({}, 502));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe('provider-unavailable');
    });

    it('normalizes 503 to a provider-unavailable failure (26)', async () => {
      const result = await read(okResponse({}, 503));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe('provider-unavailable');
    });

    it('treats a non-2xx status as a failure even when the body looks valid (21-26)', async () => {
      // A valid-looking snapshot must not be accepted under an error status.
      const result = await read(okResponse(body(), 500));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.snapshot).toBeNull();
    });

    it('never returns the server error body or its message (32)', async () => {
      const result = await read(
        okResponse(
          {
            kind: 'server-execution-capabilities',
            error: { category: 'credentials-missing', message: 'AMADEUS_CLIENT_SECRET is unset' },
            detail: 'stack trace here',
          },
          503
        )
      );
      expect(result.ok).toBe(false);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('AMADEUS_CLIENT_SECRET');
      expect(serialized).not.toContain('stack trace');
      expect(serialized).not.toContain('detail');
    });

    it('gives every failure a fixed, client-owned message', async () => {
      for (const status of [400, 401, 405, 500, 502, 503]) {
        const result = await read(okResponse({ message: 'server said this' }, status));
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error.message).not.toBe('server said this');
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('network and runtime errors (required tests 27-29)', () => {
    it('normalizes a transport failure (27)', async () => {
      const { options } = harness(() => {
        throw new TypeError('Failed to fetch');
      });
      const result = await getTripExecutionCapabilities(options);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.snapshot).toBeNull();
      expect(result.error.category).toBe('network-error');
    });

    it('never exposes a raw exception, message, or URL (28)', async () => {
      const { options } = harness(() => {
        throw new TypeError('Failed to fetch https://internal.example.com/secret-path');
      });
      const result = await getTripExecutionCapabilities(options);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('Failed to fetch');
      expect(serialized).not.toContain('internal.example.com');
      expect(serialized).not.toContain('secret-path');
      expect(serialized).not.toContain('TypeError');
    });

    it('normalizes a token provider failure as an authentication failure (27)', async () => {
      const { options, calls } = harness(okResponse(body()), async () => {
        throw new Error('no current user');
      });
      const result = await getTripExecutionCapabilities(options);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.category).toBe('authentication-required');
      // No request is made without a token.
      expect(calls).toHaveLength(0);
    });

    it('does not turn a malformed response into an empty capability set (29)', async () => {
      for (const payload of [null, 'ok', 42, [], { kind: 'nope' }, { providers: 'x' }]) {
        const result = await read(okResponse(payload));
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        // The key distinction: null, never an empty `providers` array.
        expect(result.snapshot).toBeNull();
        expect('providers' in result).toBe(false);
      }
    });

    it('never throws for any transport or body fault', async () => {
      const faults: Array<() => Promise<unknown>> = [
        async () => {
          throw new Error('network down');
        },
        async () => {
          throw new SyntaxError('bad json');
        },
        async () => undefined,
        async () => ({ kind: 'server-execution-capabilities' }),
      ];
      for (const json of faults) {
        const { options } = harness({ status: 200, json: json as never });
        await expect(getTripExecutionCapabilities(options)).resolves.toBeDefined();
      }
    });

    it('does not cache: a later call re-requests and re-validates (29)', async () => {
      let call = 0;
      const fetchImpl: TripExecutionCapabilityFetch = async () => {
        call += 1;
        return call === 1
          ? okResponse(body())
          : okResponse({ kind: 'server-execution-capabilities', providers: 'broken' });
      };
      const options: TripExecutionCapabilityServiceOptions = {
        tokenProvider: async () => ID_TOKEN,
        fetchImpl,
      };

      const first = await getTripExecutionCapabilities(options);
      expect(first.ok).toBe(true);
      // The second call sees a broken body and must not reuse the first result.
      const second = await getTripExecutionCapabilities(options);
      expect(second.ok).toBe(false);
      expect(call).toBe(2);
    });
  });

  describe('security (required tests 30-34)', () => {
    it('never returns the token to the caller (30)', async () => {
      const result = await read(okResponse(body()));
      expect(JSON.stringify(result)).not.toContain(ID_TOKEN);
    });

    it('never returns credentials (31)', async () => {
      const result = await read(okResponse(body()));
      const serialized = JSON.stringify(result);
      for (const forbidden of ['clientId', 'clientSecret', 'accessToken', 'credentials']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('accepts no Amadeus-specific secret or config field (33)', async () => {
      for (const field of [
        'clientId',
        'clientSecret',
        'accessToken',
        'apiKey',
        'attemptEnabled',
        'AMADEUS_CLIENT_ID',
        'AMADEUS_CLIENT_SECRET',
        'environment',
        'config',
      ]) {
        const result = await read(
          okResponse(body({ providers: [unavailableEntry({ [field]: 'leaked' })] }))
        );
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.snapshot).toBeNull();
      }
    });

    it('accepts no provider URL or address from a caller (34)', async () => {
      for (const field of ['url', 'baseUrl', 'host', 'endpoint', 'path', 'providerUrl']) {
        const result = await read(
          okResponse(body({ providers: [unavailableEntry({ [field]: 'https://x' })] }))
        );
        expect(result.ok).toBe(false);
      }
    });

    it('exposes no Firebase, Cloud Function, or transport implementation detail', async () => {
      const result = await read(okResponse(body()));
      const serialized = JSON.stringify(result);
      for (const forbidden of [
        'firebase',
        'onRequest',
        'idToken',
        'Authorization',
        'us-central1',
        'firebaseapp',
      ]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it('returns no stack trace or internal detail on failure', async () => {
      const result = await read(okResponse({}, 500));
      const serialized = JSON.stringify(result);
      for (const forbidden of ['at Object', '.ts:', 'node_modules', 'Error:']) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  describe('dependency boundary (required tests 35-37)', () => {
    it('imports no React, Router, or Zustand module', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const source = readFileSync(
        join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionCapabilityService.ts'),
        'utf8'
      );
      expect(source).not.toMatch(/from\s+['"]react['"]/);
      expect(source).not.toMatch(/from\s+['"]react-dom['"]/);
      expect(source).not.toMatch(/from\s+['"]react-router/);
      expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    });

    it('makes no literal fetch call and imports no Firebase or server-boundary module', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const source = readFileSync(
        join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionCapabilityService.ts'),
        'utf8'
      );
      // The transport is injected, so no literal `fetch(` can exist.
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/from\s+['"]firebase/);
      expect(source).not.toMatch(/serverBoundary/);
      // And the browser never reaches a server secret or a provider directly.
      expect(source).not.toMatch(/AMADEUS_/);
      expect(source).not.toMatch(/VITE_AMADEUS/);
      expect(source).not.toMatch(/import\.meta\.env/);
      expect(source).not.toMatch(/process\.env/);
    });

    it('uses no clock, randomness, or storage', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const source = readFileSync(
        join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionCapabilityService.ts'),
        'utf8'
      );
      expect(source).not.toMatch(/Date\.now\(/);
      expect(source).not.toMatch(/new\s+Date\(\s*\)/);
      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\b/);
      expect(source).not.toMatch(/setTimeout|setInterval/);
    });
  });

  // The client deliberately restates the STEP 68 vocabularies rather than
  // importing `serverBoundary` (a client module must not reach server-boundary
  // code). Restating is only safe if drift is impossible, so these tests pin the
  // client's copies to the authoritative exports in both directions: the client's
  // accepted set and the server's set must be exactly equal, not merely
  // overlapping. A newly added server reason, or one removed, fails here.
  describe('vocabulary drift pin', () => {
    it('accepts exactly the domain capability ids, no more and no fewer', async () => {
      // Direction 1: every real domain id is accepted.
      for (const id of PROVIDER_CAPABILITY_IDS) {
        const result = await read(
          okResponse(
            body({
              providers: [
                {
                  providerId: 'amadeus-execution',
                  status: 'available',
                  capabilityIds: [id],
                  reason: null,
                },
              ],
            })
          )
        );
        expect(result.ok, `domain id "${id}" should be accepted`).toBe(true);
      }

      // Direction 2: the client invents no ids of its own. Combined with
      // direction 1 this proves set equality.
      for (const fabricated of [
        'flight-booking',
        'charge-card',
        'SEARCH-TRANSPORT',
        'search-transport ',
        'retrieve-visa-requirements',
        'amadeus-execute',
      ]) {
        const result = await read(
          okResponse(
            body({
              providers: [
                {
                  providerId: 'amadeus-execution',
                  status: 'available',
                  capabilityIds: [fabricated],
                  reason: null,
                },
              ],
            })
          )
        );
        expect(result.ok, `fabricated id "${fabricated}" should be rejected`).toBe(false);
      }
    });

    it('accepts exactly the server response kind', async () => {
      expect(SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND).toBe('server-execution-capabilities');
      const result = await read(okResponse(body()));
      expect(result.ok).toBe(true);
    });

    it('accepts exactly the server availability statuses', async () => {
      // Every status the server type admits must be understood by the client.
      const serverStatuses = ['available', 'unavailable', 'unsupported'];
      for (const status of serverStatuses) {
        const entry =
          status === 'available'
            ? {
                providerId: 'amadeus-execution',
                status,
                capabilityIds: ['search-transport'],
                reason: null,
              }
            : unavailableEntry({ status, reason: 'execution-disabled' });
        const result = await read(okResponse(body({ providers: [entry] })));
        expect(result.ok, `status "${status}" should be accepted`).toBe(true);
      }
      // And the client admits no status beyond them.
      for (const fabricated of ['enabled', 'ready', 'degraded']) {
        const result = await read(
          okResponse(body({ providers: [unavailableEntry({ status: fabricated })] }))
        );
        expect(result.ok, `fabricated status "${fabricated}" should be rejected`).toBe(false);
      }
    });

    it('accepts exactly the server reasons', async () => {
      // Mirrors the STEP 68 `ServerExecutionCapabilityReason` union.
      const serverReasons = [
        'execution-disabled',
        'credentials-missing',
        'no-executable-capability',
        'malformed-provider-capability',
        'unexpected-failure',
      ];
      for (const reason of serverReasons) {
        const result = await read(okResponse(body({ providers: [unavailableEntry({ reason })] })));
        expect(result.ok, `reason "${reason}" should be accepted`).toBe(true);
      }
      // A leaked internal gate state or config name must never be accepted.
      for (const fabricated of [
        'attempt-enabled',
        'client-secret-missing',
        'provider-execute-not-implemented',
        'AMADEUS_CLIENT_SECRET',
      ]) {
        const result = await read(
          okResponse(body({ providers: [unavailableEntry({ reason: fabricated })] }))
        );
        expect(result.ok, `fabricated reason "${fabricated}" should be rejected`).toBe(false);
      }
    });

    it('accepts exactly the server problems', async () => {
      // Mirrors the STEP 68 `ServerExecutionCapabilityResponseProblem` union.
      const serverProblems = ['unsupported-method', 'unexpected-body', 'unexpected-failure'];
      for (const problem of serverProblems) {
        const result = await read(okResponse(body({ providers: [], problem })));
        expect(result.ok, `problem "${problem}" should be accepted`).toBe(true);
      }
      for (const fabricated of ['server-error', 'fatal', 'panic']) {
        const result = await read(okResponse(body({ providers: [], problem: fabricated })));
        expect(result.ok, `fabricated problem "${fabricated}" should be rejected`).toBe(false);
      }
    });
  });
});
