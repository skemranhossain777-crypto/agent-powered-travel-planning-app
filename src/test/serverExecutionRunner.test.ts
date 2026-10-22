import { describe, expect, it, vi } from 'vitest';
import {
  httpStatusForExecutionStatus,
  runServerBoundaryExecution,
  SERVER_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
  SERVER_EXECUTION_DISABLED_MESSAGE,
  toServerExecutionProviderResult,
  type RunServerExecutionInput,
} from '../services/serverBoundary/serverExecutionRunner';
import {
  isServerExecutionAuthErrorBody,
  SERVER_EXECUTION_HTTP_BAD_GATEWAY,
  SERVER_EXECUTION_HTTP_BAD_REQUEST,
  SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR,
  SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED,
  SERVER_EXECUTION_HTTP_OK,
  SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE,
  SERVER_EXECUTION_HTTP_UNAUTHORIZED,
  SERVER_EXECUTION_INVALID_TOKEN_MESSAGE,
  SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE,
  type ServerExecutionAuthErrorResponse,
  type ServerExecutionHttpResult,
  type ServerExecutionResponse,
} from '../services/serverBoundary/serverExecutionContract';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  normalizeAmadeusExecutionConfig,
  type AmadeusExecutionConfig,
} from '../services/realExecution/amadeusExecutionConfig';
import {
  createDefectiveAmadeusExecutionConnection,
  type AmadeusExecutionConnection,
} from '../services/realExecution/amadeusExecutionConnection';
import {
  getTripExecutionProviderRequestId,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
} from '../services/tripExecution/tripExecutionProvider';

const SECRET = 'execution-client-secret';

const DISPATCH_ID = 'trip-execution-dispatch:trip-planning-execution-authorization:trip-1';
const REQUEST_ID = getTripExecutionProviderRequestId(DISPATCH_ID);

const VALID_BODY = {
  id: REQUEST_ID,
  kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  dispatchId: DISPATCH_ID,
};

const DISABLED_CONFIG: AmadeusExecutionConfig = normalizeAmadeusExecutionConfig({
  attemptEnabled: false,
}) as AmadeusExecutionConfig;

const CREDENTIALS_MISSING_CONFIG: AmadeusExecutionConfig = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
}) as AmadeusExecutionConfig;

const READY_CONFIG: AmadeusExecutionConfig = normalizeAmadeusExecutionConfig({
  attemptEnabled: true,
  credentials: { clientId: 'execution-client-id', clientSecret: SECRET, environment: 'production' },
}) as AmadeusExecutionConfig;

const PRINCIPAL = { uid: 'user-1' };

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

/** Narrows an auth-error body for assertion. */
function asAuthError(result: ServerExecutionHttpResult): ServerExecutionAuthErrorResponse {
  if (!isServerExecutionAuthErrorBody(result.body)) {
    throw new Error('expected an auth-error body');
  }
  return result.body;
}

/** Narrows a normalized execution body for assertion. */
function asResponse(result: ServerExecutionHttpResult): ServerExecutionResponse {
  if (isServerExecutionAuthErrorBody(result.body)) {
    throw new Error('expected a normalized execution body');
  }
  return result.body;
}

/** A connection that records every attempt, so a no-network claim is checkable. */
function recordingConnection(outcome: 'not-implemented' | 'internal-failure' = 'not-implemented') {
  const attempt = vi.fn((ref: { requestId: string; dispatchId: string }) => {
    void ref;
    return outcome;
  });
  const connection: AmadeusExecutionConnection = { implementedOperations: [], attempt };
  return { connection, attempt };
}

describe('STEP 67 server boundary rejects unauthenticated requests first', () => {
  it('returns HTTP 401 for a missing principal without reading the body', async () => {
    const result = await run({ principal: null, raw: { nonsense: true }, method: 'GET' });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_UNAUTHORIZED);
    const body = asAuthError(result);
    expect(body.status).toBe('unauthenticated');
    expect(body.message).toBe(SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE);
  });

  it('returns HTTP 401 for a failed token verification and distinguishes it', async () => {
    const result = await run({ principal: null, authProblem: 'invalid-token' });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_UNAUTHORIZED);
    const body = asAuthError(result);
    expect(body.status).toBe('invalid-token');
    expect(body.message).toBe(SERVER_EXECUTION_INVALID_TOKEN_MESSAGE);
  });

  it('never leaks a submitted body uid into the auth error', async () => {
    const result = await run({
      principal: null,
      raw: { ...VALID_BODY, uid: 'attacker', userId: 'admin' },
    });
    expect(JSON.stringify(result.body)).not.toContain('attacker');
    expect(JSON.stringify(result.body)).not.toContain('admin');
  });

  it('rejects even when the request is otherwise perfectly valid', async () => {
    const result = await run({ principal: null });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_UNAUTHORIZED);
  });
});

describe('STEP 67 server boundary validates before touching a provider', () => {
  it('returns HTTP 400 for an invalid request and never consults the connection', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({ raw: { ...VALID_BODY, providerId: 'injected' }, connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
    expect(attempt).not.toHaveBeenCalled();
    const body = asResponse(result);
    expect(body.status).toBe('invalid-input');
    expect(body.problem).toBe('unexpected-field');
    expect(body.request).toBeNull();
    expect(body.providerResults).toEqual([]);
  });

  it('returns HTTP 400 for a non-POST method and never consults the connection', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({ method: 'GET', connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
    expect(asResponse(result).problem).toBe('unsupported-method');
    expect(attempt).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 for a malformed body', async () => {
    for (const raw of [null, 'text', 42, []]) {
      const result = await run({ raw });
      expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
      expect(asResponse(result).problem).toBe('malformed-body');
    }
  });

  it('reports a validation failure with a bounded error, never an echo of the input', async () => {
    const result = await run({ raw: { ...VALID_BODY, apiKey: 'sk_live_leak' } });
    const body = asResponse(result);
    expect(body.error).toEqual({
      category: 'invalid-input',
      message: expect.stringContaining('rejected'),
    });
    expect(JSON.stringify(result.body)).not.toContain('sk_live_leak');
  });
});

describe('STEP 67 server boundary fails closed on its own server config', () => {
  it('returns HTTP 501 when the execution switch is off and runs no provider work', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({ config: DISABLED_CONFIG, connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED);
    expect(attempt).not.toHaveBeenCalled();
    const body = asResponse(result);
    expect(body.status).toBe('not-implemented');
    expect(body.error).toEqual({
      category: 'not-implemented',
      message: SERVER_EXECUTION_DISABLED_MESSAGE,
    });
    expect(body.providerResults).toEqual([]);
  });

  it('returns HTTP 503 when the switch is on but server credentials are missing', async () => {
    const { connection, attempt } = recordingConnection();
    const result = await run({ config: CREDENTIALS_MISSING_CONFIG, connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE);
    expect(attempt).not.toHaveBeenCalled();
    const body = asResponse(result);
    expect(body.status).toBe('not-configured');
    expect(body.error).toEqual({
      category: 'credentials-missing',
      message: SERVER_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
    });
  });

  it('is fail-closed for the default config with no arguments beyond the request', async () => {
    const result = await runServerBoundaryExecution({
      method: 'POST',
      raw: VALID_BODY,
      config: DISABLED_CONFIG,
      principal: PRINCIPAL,
    });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED);
  });
});

describe('STEP 67 server boundary runs the request through the unchanged STEP 66 service', () => {
  it('reaches the Amadeus execution provider and reports its honest refusal', async () => {
    const { connection, attempt } = recordingConnection('not-implemented');
    const result = await run({ connection });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith({ requestId: REQUEST_ID, dispatchId: DISPATCH_ID });

    const body = asResponse(result);
    expect(body.status).toBe('not-implemented');
    expect(body.request).toEqual(VALID_BODY);
    expect(body.providerResults).toEqual([
      { providerId: AMADEUS_EXECUTION_PROVIDER_ID, requestId: REQUEST_ID, status: 'unsupported' },
    ]);
    // 501, never a misleading 200 for a provider that could not act.
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED);
  });

  it('never returns HTTP 200 while no operation is implemented', async () => {
    const result = await run();
    expect(result.httpStatus).not.toBe(SERVER_EXECUTION_HTTP_OK);
    expect(asResponse(result).status).not.toBe('success');
    expect(asResponse(result).providerResults.every((r) => r.status !== 'accepted')).toBe(true);
  });

  it('passes the validated request to the provider without adding a field', async () => {
    const { connection, attempt } = recordingConnection();
    await run({ connection });
    const forwarded = attempt.mock.calls[0][0];
    expect(Object.keys(forwarded).sort()).toEqual(['dispatchId', 'requestId']);
  });

  it('does not mutate the caller body', async () => {
    const body = { ...VALID_BODY };
    await run({ raw: body });
    expect(body).toEqual(VALID_BODY);
  });
});

describe('STEP 67 server boundary reports a real provider failure as HTTP 502', () => {
  it('maps a failed provider result to a bad gateway, never to success', async () => {
    const result = await run({ connection: createDefectiveAmadeusExecutionConnection() });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_GATEWAY);
    const body = asResponse(result);
    expect(body.status).toBe('provider-failure');
    expect(body.providerResults).toEqual([
      { providerId: AMADEUS_EXECUTION_PROVIDER_ID, requestId: REQUEST_ID, status: 'failed' },
    ]);
    expect(body.error?.category).toBe('provider-unavailable');
  });

  it('reports HTTP 502 when the connection itself throws', async () => {
    const connection: AmadeusExecutionConnection = {
      implementedOperations: [],
      attempt: () => {
        throw new Error('socket exploded: sk_live_leak');
      },
    };
    const result = await run({ connection });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_BAD_GATEWAY);
    expect(asResponse(result).providerResults[0].status).toBe('failed');
  });
});

describe('STEP 67 server boundary contains an unexpected fault as HTTP 500', () => {
  it('never rejects when the injected config itself faults', async () => {
    const hostile = {} as AmadeusExecutionConfig;
    Object.defineProperty(hostile, 'attemptEnabled', {
      get() {
        throw new Error('config fault: sk_live_leak');
      },
    });

    const result = await run({ config: hostile });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR);
    const body = asResponse(result);
    expect(body.status).toBe('unexpected-failure');
    expect(body.providerResults).toEqual([]);
    // The internal message is never exposed.
    expect(JSON.stringify(result.body)).not.toContain('sk_live_leak');
    expect(JSON.stringify(result.body)).not.toContain('config fault');
  });

  it('never rejects when the auth problem is a hostile value', async () => {
    const result = await run({ principal: null, authProblem: 'weird' as never });
    expect(result.httpStatus).toBe(SERVER_EXECUTION_HTTP_UNAUTHORIZED);
  });
});

describe('STEP 67 execution status maps to honest HTTP semantics', () => {
  it('maps every status to the documented code', () => {
    expect(httpStatusForExecutionStatus('success')).toBe(SERVER_EXECUTION_HTTP_OK);
    expect(httpStatusForExecutionStatus('invalid-input')).toBe(SERVER_EXECUTION_HTTP_BAD_REQUEST);
    expect(httpStatusForExecutionStatus('not-implemented')).toBe(
      SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED
    );
    expect(httpStatusForExecutionStatus('not-configured')).toBe(
      SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE
    );
    expect(httpStatusForExecutionStatus('provider-failure')).toBe(SERVER_EXECUTION_HTTP_BAD_GATEWAY);
    expect(httpStatusForExecutionStatus('unexpected-failure')).toBe(
      SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR
    );
  });

  it('projects a provider result field by field and drops anything extra', () => {
    const projected = toServerExecutionProviderResult({
      providerId: 'amadeus-execution',
      requestId: REQUEST_ID,
      status: 'unsupported',
      // A provider that returned more than the contract must not serialize it.
      accessToken: 'sk_live_leak',
      rawResponse: { secret: 'value' },
    } as never);

    expect(projected).toEqual({
      providerId: 'amadeus-execution',
      requestId: REQUEST_ID,
      status: 'unsupported',
    });
    expect(JSON.stringify(projected)).not.toContain('sk_live_leak');
  });
});
