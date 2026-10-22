import { describe, expect, it, vi } from 'vitest';
import {
  AMADEUS_EXECUTION_ALLOWED_BASE_URLS,
  AMADEUS_EXECUTION_BASE_URLS,
  AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS,
  AMADEUS_EXECUTION_INTERNAL_FAILURE_MESSAGE,
  AMADEUS_EXECUTION_NOT_IMPLEMENTED_MESSAGE,
  AMADEUS_EXECUTION_PRODUCTION_BASE_URL,
  AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE,
  AMADEUS_EXECUTION_TEST_BASE_URL,
  createAmadeusExecutionConnection,
  createAmadeusExecutionFetchTransport,
  createDefectiveAmadeusExecutionConnection,
  getAmadeusExecutionBaseUrl,
  isAmadeusExecutionOperationImplemented,
  isAmadeusExecutionRequestWithinFixedHosts,
  isAmadeusExecutionTransportMethod,
  type AmadeusExecutionTransport,
  type AmadeusExecutionTransportRequest,
} from '../services/realExecution/amadeusExecutionConnection';
import type { AmadeusExecutionConfig } from '../services/realExecution/amadeusExecutionConfig';

const TEST_CONFIG: AmadeusExecutionConfig = {
  attemptEnabled: true,
  credentials: { clientId: 'id', clientSecret: 'secret', environment: 'test' },
};

const PRODUCTION_CONFIG: AmadeusExecutionConfig = {
  attemptEnabled: true,
  credentials: { clientId: 'id', clientSecret: 'secret', environment: 'production' },
};

const REQUEST_REF = { requestId: 'trip-execution-provider-request:x', dispatchId: 'trip-execution-dispatch:x' };

describe('STEP 66 Amadeus execution fixed destination', () => {
  it('exposes exactly the two fixed Amadeus hosts', () => {
    expect(AMADEUS_EXECUTION_BASE_URLS).toEqual({
      test: 'https://test.api.amadeus.com',
      production: 'https://api.amadeus.com',
    });
    expect(Object.isFrozen(AMADEUS_EXECUTION_BASE_URLS)).toBe(true);
  });

  it('selects the base URL only from the config environment', () => {
    expect(getAmadeusExecutionBaseUrl(TEST_CONFIG)).toBe(AMADEUS_EXECUTION_TEST_BASE_URL);
    expect(getAmadeusExecutionBaseUrl(PRODUCTION_CONFIG)).toBe(AMADEUS_EXECUTION_PRODUCTION_BASE_URL);
  });

  it('falls back to the test host when no credential is configured', () => {
    expect(getAmadeusExecutionBaseUrl({ attemptEnabled: false, credentials: null })).toBe(
      AMADEUS_EXECUTION_TEST_BASE_URL
    );
  });

  it('exposes no host override, URL, or path input', () => {
    expect(Object.keys(AMADEUS_EXECUTION_BASE_URLS).sort()).toEqual(['production', 'test']);
  });
});

describe('STEP 66 Amadeus execution implemented operation set', () => {
  it('implements no operation in this build', () => {
    expect(AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS).toEqual([]);
    expect(Object.isFrozen(AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS)).toBe(true);
  });

  it('reports no operation as implemented, whatever it is asked about', () => {
    for (const operation of ['search', 'verify', 'anything', '', 'retrieve', 'act']) {
      expect(isAmadeusExecutionOperationImplemented(operation)).toBe(false);
    }
    expect(isAmadeusExecutionOperationImplemented(undefined)).toBe(false);
    expect(isAmadeusExecutionOperationImplemented(null)).toBe(false);
    expect(isAmadeusExecutionOperationImplemented(42)).toBe(false);
    expect(isAmadeusExecutionOperationImplemented({})).toBe(false);
  });
});

describe('STEP 66 default Amadeus execution connection', () => {
  it('reports not-implemented for a well-formed request identity', () => {
    const connection = createAmadeusExecutionConnection();
    expect(connection.implementedOperations).toEqual([]);
    expect(connection.attempt(REQUEST_REF)).toBe('not-implemented');
  });

  it('reports not-implemented for a malformed request identity instead of throwing', () => {
    const connection = createAmadeusExecutionConnection();
    expect(
      connection.attempt({ requestId: 42, dispatchId: null } as unknown as typeof REQUEST_REF)
    ).toBe('not-implemented');
  });

  it('never invokes the injected transport, so no credential can be exercised', () => {
    const transport = vi.fn<AmadeusExecutionTransport>();
    const connection = createAmadeusExecutionConnection(transport);
    connection.attempt(REQUEST_REF);
    connection.attempt(REQUEST_REF);
    expect(transport).not.toHaveBeenCalled();
  });

  it('is frozen so its operation set cannot be widened after construction', () => {
    expect(Object.isFrozen(createAmadeusExecutionConnection())).toBe(true);
  });
});

describe('STEP 66 defective Amadeus execution connection', () => {
  it('reports internal-failure without any transport, for bounded failure testing', () => {
    const connection = createDefectiveAmadeusExecutionConnection();
    expect(connection.attempt(REQUEST_REF)).toBe('internal-failure');
    expect(connection.implementedOperations).toEqual([]);
  });
});

describe('STEP 66 Amadeus execution transport factory', () => {
  it('forwards only what this module determines, and normalizes the response', async () => {
    const calls: AmadeusExecutionTransportRequest[] = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), method: (init?.method ?? 'GET') as 'GET', headers: {} });
      return {
        status: 200,
        async json(): Promise<unknown> {
          return { ok: true };
        },
      } as unknown as Response;
    });

    const transport = createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch);
    const response = await transport({
      url: `${AMADEUS_EXECUTION_TEST_BASE_URL}/v1/security/oauth2/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });

    expect(response).toEqual({ status: 200, json: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe('https://test.api.amadeus.com/v1/security/oauth2/token');
  });

  it('is never used by the default connection, so importing it activates nothing', () => {
    const fetchImpl = vi.fn();
    createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch);
    const connection = createAmadeusExecutionConnection(
      createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch)
    );
    connection.attempt(REQUEST_REF);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses any destination outside the fixed Amadeus hosts, so it is not a proxy', async () => {
    const fetchImpl = vi.fn();
    const transport = createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch);

    for (const url of [
      'https://evil.example/steal',
      'http://test.api.amadeus.com/v1/security/oauth2/token',
      'https://test.api.amadeus.com.evil.example/v1',
      'https://api.amadeus.com.evil.example',
      'not-a-url',
      '',
    ]) {
      await expect(transport({ url, method: 'GET', headers: {} })).rejects.toThrow(
        AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a method outside the narrowed vocabulary, so no verb can be forwarded', async () => {
    const fetchImpl = vi.fn();
    const transport = createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch);

    for (const method of ['DELETE', 'PUT', 'PATCH', 'get', '', null, undefined]) {
      await expect(
        transport({
          url: `${AMADEUS_EXECUTION_TEST_BASE_URL}/v1/whatever`,
          method,
          headers: {},
        } as unknown as AmadeusExecutionTransportRequest)
      ).rejects.toThrow(AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('echoes neither the refused URL nor any request value in the refusal', async () => {
    const fetchImpl = vi.fn();
    const transport = createAmadeusExecutionFetchTransport(fetchImpl as unknown as typeof fetch);
    const hostileUrl = 'https://evil.example/?client_secret=leaked-secret-value';

    let refusalMessage = '';
    try {
      await transport({ url: hostileUrl, method: 'GET', headers: {} });
      expect.unreachable('the transport must refuse an off-host destination');
    } catch (error) {
      refusalMessage = error instanceof Error ? error.message : String(error);
    }

    expect(refusalMessage).toBe(AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE);
    expect(refusalMessage).not.toContain('leaked-secret-value');
    expect(refusalMessage).not.toContain('evil.example');
  });

  it('recognizes only the fixed hosts and the narrowed methods', () => {
    expect(isAmadeusExecutionRequestWithinFixedHosts(AMADEUS_EXECUTION_TEST_BASE_URL)).toBe(true);
    expect(isAmadeusExecutionRequestWithinFixedHosts(`${AMADEUS_EXECUTION_PRODUCTION_BASE_URL}/v1/x`)).toBe(true);
    expect(isAmadeusExecutionRequestWithinFixedHosts(`${AMADEUS_EXECUTION_TEST_BASE_URL}/v1/x`)).toBe(true);
    expect(isAmadeusExecutionRequestWithinFixedHosts(`${AMADEUS_EXECUTION_TEST_BASE_URL}x`)).toBe(false);
    expect(isAmadeusExecutionRequestWithinFixedHosts(null)).toBe(false);
    expect(isAmadeusExecutionRequestWithinFixedHosts(42)).toBe(false);

    expect(isAmadeusExecutionTransportMethod('GET')).toBe(true);
    expect(isAmadeusExecutionTransportMethod('POST')).toBe(true);
    expect(isAmadeusExecutionTransportMethod('DELETE')).toBe(false);
    expect(isAmadeusExecutionTransportMethod('get')).toBe(false);
    expect(isAmadeusExecutionTransportMethod(undefined)).toBe(false);
  });

  it('lists exactly the two fixed hosts as the allowed destinations', () => {
    expect(AMADEUS_EXECUTION_ALLOWED_BASE_URLS).toEqual([
      AMADEUS_EXECUTION_TEST_BASE_URL,
      AMADEUS_EXECUTION_PRODUCTION_BASE_URL,
    ]);
    expect(Object.isFrozen(AMADEUS_EXECUTION_ALLOWED_BASE_URLS)).toBe(true);
  });
});

describe('STEP 66 Amadeus execution bounded outcome messages', () => {
  it('never leak a credential, a token, or a provider payload', () => {
    for (const message of [
      AMADEUS_EXECUTION_NOT_IMPLEMENTED_MESSAGE,
      AMADEUS_EXECUTION_INTERNAL_FAILURE_MESSAGE,
    ]) {
      expect(message).not.toMatch(/secret|token=|password|bearer/i);
      expect(message.length).toBeLessThanOrEqual(200);
    }
  });
});
