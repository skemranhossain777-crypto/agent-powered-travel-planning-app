import { describe, expect, it } from 'vitest';
import {
  MAX_SERVER_EXECUTION_IDENTITY_LENGTH,
  SERVER_EXECUTION_REQUEST_KEYS,
  validateServerExecutionRequest,
} from '../services/serverBoundary/serverExecutionValidation';
import {
  getTripExecutionProviderRequestId,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
} from '../services/tripExecution/tripExecutionProvider';

const DISPATCH_ID = `trip-execution-dispatch:trip-planning-execution-authorization:trip-1`;
const REQUEST_ID = getTripExecutionProviderRequestId(DISPATCH_ID);

/** A well-formed request body: exactly the three contract keys. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REQUEST_ID,
    kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
    dispatchId: DISPATCH_ID,
    ...overrides,
  };
}

function validate(raw: unknown, method: unknown = 'POST', contentType?: unknown) {
  return validateServerExecutionRequest({ method, contentType, raw });
}
describe('STEP 67 server execution request validation accepts the exact contract shape', () => {
  it('accepts a well-formed provider-neutral request', () => {
    const result = validate(validBody());
    expect(result).toEqual({
      ok: true,
      request: { id: REQUEST_ID, kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND, dispatchId: DISPATCH_ID },
    });
  });

  it('accepts the method case-insensitively and tolerates a JSON charset parameter', () => {
    expect(validate(validBody(), 'post').ok).toBe(true);
    expect(validate(validBody(), 'Post').ok).toBe(true);
    expect(validate(validBody(), 'POST', 'application/json; charset=utf-8').ok).toBe(true);
    expect(validate(validBody(), 'POST', 'APPLICATION/JSON').ok).toBe(true);
  });

  it('returns a fresh object rather than the caller body', () => {
    const body = validBody();
    const result = validate(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).not.toBe(body);
    expect(Object.keys(result.request).sort()).toEqual(['dispatchId', 'id', 'kind']);
  });
});

describe('STEP 67 server execution request validation rejects every other method', () => {
  it('rejects every method except POST', () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', '']) {
      expect(validate(validBody(), method)).toEqual({
        ok: false,
        problem: 'unsupported-method',
      });
    }
  });

  it('rejects a non-string method', () => {
    for (const method of [undefined, null, 42, {}, [], Symbol('POST')]) {
      // Called directly so a helper default cannot stand in for the real value.
      expect(validateServerExecutionRequest({ method, raw: validBody() })).toEqual({
        ok: false,
        problem: 'unsupported-method',
      });
    }
  });
});

describe('STEP 67 server execution request validation rejects a non-JSON body', () => {
  it('rejects a body that is not a plain object', () => {
    for (const raw of [null, undefined, 'text', 42, true, [], [{ id: REQUEST_ID }]]) {
      expect(validate(raw)).toEqual({ ok: false, problem: 'malformed-body' });
    }
  });

  it('rejects a stringified request body', () => {
    expect(validate(JSON.stringify(validBody()))).toEqual({ ok: false, problem: 'malformed-body' });
  });

  it('rejects a non-JSON content type', () => {
    for (const contentType of [
      'text/plain',
      'text/html',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/xml',
      '',
      42,
      null,
    ]) {
      expect(validate(validBody(), 'POST', contentType)).toEqual({
        ok: false,
        problem: 'unsupported-content-type',
      });
    }
  });
});

describe('STEP 67 server execution request validation refuses to become a proxy', () => {
  it('rejects any unknown key, whatever it is named', () => {
    const injected = [
      { providerId: 'amadeus-execution' },
      { url: 'https://evil.example.com/steal' },
      { endpoint: 'https://api.amadeus.com/v1/booking' },
      { method: 'DELETE' },
      { headers: { authorization: 'Bearer x' } },
      { clientId: 'injected' },
      { clientSecret: 'injected' },
      { accessToken: 'injected' },
      { apiKey: 'injected' },
      { operation: 'submit-booking' },
      { travelers: [{ name: 'Ada' }] },
      { paymentMethod: 'card' },
      { booking: { id: 'b-1' } },
      { dispatch: { id: 'other' } },
      { config: { attemptEnabled: true } },
      { connection: null },
      { prototype: { polluted: true } },
    ];

    for (const extra of injected) {
      const result = validate(validBody(extra));
      expect(result).toEqual({ ok: false, problem: 'unexpected-field' });
    }
  });

  it('rejects a request missing a permitted key', () => {
    for (const key of SERVER_EXECUTION_REQUEST_KEYS) {
      const body = validBody();
      delete body[key];
      expect(validate(body).ok).toBe(false);
    }
  });

  it('permits exactly the three contract keys', () => {
    expect([...SERVER_EXECUTION_REQUEST_KEYS].sort()).toEqual(['dispatchId', 'id', 'kind']);
    expect(SERVER_EXECUTION_REQUEST_KEYS).toHaveLength(3);
    expect(Object.isFrozen(SERVER_EXECUTION_REQUEST_KEYS)).toBe(true);
  });
});

describe('STEP 67 server execution request validation checks kind and identity', () => {
  it('rejects a wrong kind', () => {
    for (const kind of ['trip-execution-dispatch-instruction', 'search', '', null, 42]) {
      expect(validate(validBody({ kind }))).toEqual({ ok: false, problem: 'invalid-kind' });
    }
  });

  it('rejects a missing, non-string, or empty id', () => {
    for (const id of [undefined, null, '', 42, {}]) {
      const body = validBody();
      if (id === undefined) delete body.id;
      else body.id = id;
      expect(validate(body)).toEqual({ ok: false, problem: 'invalid-id' });
    }
  });

  it('rejects a missing, non-string, or empty dispatch id', () => {
    for (const dispatchId of [undefined, null, '', 42, {}]) {
      const body = validBody();
      if (dispatchId === undefined) delete body.dispatchId;
      else body.dispatchId = dispatchId;
      expect(validate(body)).toEqual({ ok: false, problem: 'invalid-dispatch-id' });
    }
  });

  it('rejects a request id that no longer derives from its dispatch id', () => {
    const other = getTripExecutionProviderRequestId(`${DISPATCH_ID}-other`);
    const result = validate(validBody({ id: other }));
    expect(result).toEqual({ ok: false, problem: 'request-dispatch-mismatch' });
  });

  it('rejects a structurally malformed dispatch id even when the id derives from it', () => {
    const malformed = 'not-a-dispatch-id';
    const result = validate(
      validBody({ dispatchId: malformed, id: getTripExecutionProviderRequestId(malformed) })
    );
    expect(result).toEqual({ ok: false, problem: 'invalid-dispatch-id' });
  });

  it('rejects an identity longer than the defensive bound, blaming the root identity', () => {
    const long = `trip-execution-dispatch:${'a'.repeat(MAX_SERVER_EXECUTION_IDENTITY_LENGTH)}`;
    const body = validBody({
      dispatchId: long,
      id: getTripExecutionProviderRequestId(long),
    });
    // The dispatch id is the root, so it is the field named in the problem even
    // though the derived `id` is over the bound too.
    expect(validate(body)).toEqual({ ok: false, problem: 'invalid-dispatch-id' });
    expect(MAX_SERVER_EXECUTION_IDENTITY_LENGTH).toBe(200);
  });

  it('accepts an identity exactly at the defensive bound', () => {
    const prefix = 'trip-execution-dispatch:';
    const dispatchId = `${prefix}${'a'.repeat(MAX_SERVER_EXECUTION_IDENTITY_LENGTH - prefix.length)}`;
    expect(dispatchId).toHaveLength(MAX_SERVER_EXECUTION_IDENTITY_LENGTH);
    const result = validate(
      validBody({ dispatchId, id: getTripExecutionProviderRequestId(dispatchId) })
    );
    expect(result.ok).toBe(true);
  });
});

describe('STEP 67 server execution validation problems are value-free tokens', () => {
  it('never echoes a submitted value into a rejection', () => {
    const secret = 'sk_live_do_not_leak';
    const result = validate(validBody({ apiKey: secret }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it('reports the method problem before inspecting the body', () => {
    const result = validate({ totally: 'wrong' }, 'GET');
    expect(result).toEqual({ ok: false, problem: 'unsupported-method' });
  });

  it('reports the content-type problem before inspecting the body', () => {
    const result = validate({ totally: 'wrong' }, 'POST', 'text/plain');
    expect(result).toEqual({ ok: false, problem: 'unsupported-content-type' });
  });

  it('reports the unknown-key problem before the kind problem', () => {
    const result = validate(validBody({ kind: 'wrong', extra: 1 }));
    expect(result).toEqual({ ok: false, problem: 'unexpected-field' });
  });
});
