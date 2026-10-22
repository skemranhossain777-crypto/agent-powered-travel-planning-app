/**
 * Amadeus EXECUTION transport seam (STEP 66).
 *
 * The single, injectable place where a real-provider execution attempt could
 * reach the network. It mirrors the strict transport boundary already
 * established by the STEP 41 Amadeus *discovery* connection
 * (`services/realDiscovery/amadeusConnection.ts`), and adds the guarantee the
 * execution domain needs above all: **nothing here performs a request.**
 *
 * 1. **No operation is implemented.** `AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS`
 *    is a frozen empty list, and `attempt` returns `not-implemented` for every
 *    input. There is no booking, no reservation, no ticket issue, no
 *    cancellation, and no payment call in this module or anywhere in the STEP 66
 *    scope, so no credential can be exercised by an accidental request.
 * 2. **The transport is injectable, not constructed.** A `fetch`-based transport
 *    factory exists so a server can be tested later, but the default connection
 *    neither constructs nor retains one. A caller cannot make the default
 *    connection reach the network, and the module's only outbound effect - none -
 *    is therefore impossible to trigger from app code.
 * 3. **No arbitrary URL, host, path, or method.** The host is chosen only by the
 *    resolved environment from a fixed two-entry table, and the HTTP method
 *    vocabulary is narrowed to `GET`/`POST` so a destructive verb can never be
 *    expressed. The `fetch` transport additionally re-checks both at runtime and
 *    refuses anything else, so it cannot act as a caller-directed proxy. No
 *    caller-supplied URL, host, path, or credential reaches the transport, and no
 *    environment variable can redirect the base URL.
 * 4. **Bounded, value-free outcomes.** The seam speaks only `not-implemented` and
 *    `internal-failure`: a closed feature, or a defect. It never reports
 *    success, never returns a provider body, and never echoes a credential,
 *    token, or raw provider response.
 * 5. **Defects stay injectable and stay bounded.** `createDefectiveAmadeusExecutionConnection`
 *    exists only so a future `failed` path is reachable in tests; it reports
 *    `internal-failure` without touching a transport.
 *
 * Side-effect free in the default configuration: no network, clock, SDK, `any`,
 * generic `Record<string, any>`, React, Firebase, Router, Zustand, or
 * persistence. The only import is the injected execution config type.
 */

import type { AmadeusExecutionConfig, AmadeusExecutionEnvironment } from './amadeusExecutionConfig';

/**
 * The narrowed HTTP method vocabulary an Amadeus execution request may ever
 * express. Deliberately excludes every destructive verb: this step must be
 * incapable of describing a modifying request, not merely refrain from one.
 */
export type AmadeusExecutionTransportMethod = 'GET' | 'POST';

/** One outbound request, fully determined by this module - never by a caller. */
export interface AmadeusExecutionTransportRequest {
  /** An absolute URL built from the fixed environment-derived base and a module-owned path. */
  readonly url: string;
  readonly method: AmadeusExecutionTransportMethod;
  readonly headers: Readonly<Record<string, string>>;
  /** A pre-serialized body. No execution body is ever constructed in this step. */
  readonly body?: string;
}

/** A bounded transport response. No raw provider payload is retained by this step. */
export interface AmadeusExecutionTransportResponse {
  readonly status: number;
  readonly json: unknown;
}

/** The injectable network seam. Never constructed by the default connection. */
export type AmadeusExecutionTransport = (
  request: AmadeusExecutionTransportRequest
) => Promise<AmadeusExecutionTransportResponse>;

/** The only two outcomes of an execution attempt: a closed feature, or a defect. */
export type AmadeusExecutionAttemptOutcome = 'not-implemented' | 'internal-failure';

/** The Amadeus test (sandbox) host. */
export const AMADEUS_EXECUTION_TEST_BASE_URL = 'https://test.api.amadeus.com';

/** The Amadeus production host. */
export const AMADEUS_EXECUTION_PRODUCTION_BASE_URL = 'https://api.amadeus.com';

/**
 * The complete, fixed host table. The base URL is selected by the resolved
 * environment alone - there is no override, no arbitrary host, and no
 * environment-variable redirection.
 */
export const AMADEUS_EXECUTION_BASE_URLS: Readonly<Record<AmadeusExecutionEnvironment, string>> =
  Object.freeze({
    test: AMADEUS_EXECUTION_TEST_BASE_URL,
    production: AMADEUS_EXECUTION_PRODUCTION_BASE_URL,
  });

/**
 * The operations this build can actually perform: none. Frozen and empty by
 * construction, so a future operation must be added here explicitly and
 * deliberately, with its own tests, before it can ever be attempted.
 */
export const AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS: ReadonlyArray<string> = Object.freeze([]);

/**
 * The complete list of destinations this seam is ever allowed to reach. Frozen
 * and derived from the two fixed hosts alone, so a host can be added only by
 * editing this module. The `fetch` transport below refuses any URL that is not
 * one of these, which is what makes it a bounded Amadeus seam rather than a
 * generic caller-directed proxy.
 */
export const AMADEUS_EXECUTION_ALLOWED_BASE_URLS: ReadonlyArray<string> = Object.freeze([
  AMADEUS_EXECUTION_TEST_BASE_URL,
  AMADEUS_EXECUTION_PRODUCTION_BASE_URL,
]);

/** Bounded, credential-free message for the `not-implemented` outcome. */
export const AMADEUS_EXECUTION_NOT_IMPLEMENTED_MESSAGE =
  'No Amadeus execution operation is implemented in this build.';

/**
 * Bounded, credential-free message for a refused transport request. It names
 * neither the offending URL nor any request value, so a URL carrying a query
 * string can never be echoed back into a log or an error.
 */
export const AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE =
  'The Amadeus execution transport refuses any request outside the fixed Amadeus hosts and method vocabulary.';

/** Bounded, credential-free message for the `internal-failure` outcome. */
export const AMADEUS_EXECUTION_INTERNAL_FAILURE_MESSAGE =
  'The Amadeus execution connection failed before any request was sent.';

/**
 * The execution connection: the one object an adapter asks whether it may
 * proceed. It reports a bounded outcome and never a result, a success, or a
 * provider payload.
 */
export interface AmadeusExecutionConnection {
  /** The operations this connection can perform. Always empty in this step. */
  readonly implementedOperations: ReadonlyArray<string>;
  /**
   * Asks the connection to attempt a mapped execution request. Always resolves
   * `not-implemented` in the default connection, without invoking a transport.
   */
  attempt(request: AmadeusExecutionRequestRef): AmadeusExecutionAttemptOutcome;
}

/**
 * The minimal, provider-request identity a connection is given: the
 * provider-neutral request id it answers. No payload, no credentials.
 */
export interface AmadeusExecutionRequestRef {
  readonly requestId: string;
  readonly dispatchId: string;
}

/**
 * True only for an operation this build actually implements. Always `false` in
 * this step, so an unimplemented operation can never be attempted - and so an
 * adapter can never report `accepted` for one.
 */
export function isAmadeusExecutionOperationImplemented(operation: unknown): boolean {
  if (typeof operation !== 'string') return false;
  return AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS.includes(operation);
}

/**
 * Resolves the fixed base URL for a config. Determined solely by the config's
 * own environment: there is no caller-supplied host, URL, or path, so the
 * request destination cannot be redirected from outside this module.
 */
export function getAmadeusExecutionBaseUrl(config: AmadeusExecutionConfig): string {
  const environment = config.credentials?.environment ?? 'test';
  return AMADEUS_EXECUTION_BASE_URLS[environment];
}

/**
 * True only for a request destination inside the fixed Amadeus host table: the
 * bare base or a path beneath it. A caller-selected host, a look-alike host
 * suffix, and a non-string are all refused, so no environment value and no
 * caller value can redirect a request off the two fixed hosts.
 */
export function isAmadeusExecutionRequestWithinFixedHosts(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return AMADEUS_EXECUTION_ALLOWED_BASE_URLS.some(
    (base) => url === base || url.startsWith(`${base}/`)
  );
}

/**
 * True only for a method in the narrowed `GET`/`POST` vocabulary. The transport
 * checks this at runtime as well as in its type, so a destructive verb cannot be
 * expressed by a JavaScript caller that bypasses the type checker.
 */
export function isAmadeusExecutionTransportMethod(
  value: unknown
): value is AmadeusExecutionTransportMethod {
  return value === 'GET' || value === 'POST';
}

/**
 * Builds a `fetch`-backed transport for server-side use and future tests.
 *
 * The `fetch` implementation is injected, so this module never reaches a global
 * network client and never becomes active merely by being imported. The default
 * connection deliberately does not call this factory: with no implemented
 * operation there is nothing to send.
 *
 * The transport is deliberately NOT a generic forwarder. Before any network call
 * it re-validates the destination against the fixed host table and the method
 * against the narrowed vocabulary, and refuses anything else with a bounded,
 * value-free error that echoes neither the URL nor any header. A caller therefore
 * cannot use this seam as a proxy, cannot select a host, and cannot express a
 * modifying request.
 */
export function createAmadeusExecutionFetchTransport(
  fetchImpl: typeof fetch
): AmadeusExecutionTransport {
  return async (
    request: AmadeusExecutionTransportRequest
  ): Promise<AmadeusExecutionTransportResponse> => {
    if (
      !isAmadeusExecutionTransportMethod(request.method) ||
      !isAmadeusExecutionRequestWithinFixedHosts(request.url)
    ) {
      throw new Error(AMADEUS_EXECUTION_REQUEST_REFUSED_MESSAGE);
    }

    const init: RequestInit = { method: request.method, headers: { ...request.headers } };
    if (request.body !== undefined) init.body = request.body;
    const response = await fetchImpl(request.url, init);
    return { status: response.status, json: await response.json() };
  };
}

/**
 * The default, always-safe execution connection.
 *
 * The `transport` parameter is the injectable seam: it exists so a server can
 * later supply a real transport, and it is deliberately *not retained*. With no
 * implemented operation there is nothing to send, and discarding the reference
 * means this connection is structurally incapable of invoking it later - so a
 * supplied credential can never be exercised by accident. `attempt` therefore
 * reports `not-implemented` for every request id, including a malformed one.
 */
export function createAmadeusExecutionConnection(
  transport?: AmadeusExecutionTransport
): AmadeusExecutionConnection {
  void transport;
  return Object.freeze({
    implementedOperations: AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS,
    attempt(request: AmadeusExecutionRequestRef): AmadeusExecutionAttemptOutcome {
      void request;
      return 'not-implemented';
    },
  });
}

/**
 * A deliberately defective connection, for tests only. It reports
 * `internal-failure` without any transport, so a future `failed` path is
 * reachable in a test without inventing a provider fault, a network error, or a
 * transport that could send anything. Never used in application code.
 */
export function createDefectiveAmadeusExecutionConnection(): AmadeusExecutionConnection {
  return Object.freeze({
    implementedOperations: AMADEUS_EXECUTION_IMPLEMENTED_OPERATIONS,
    attempt(request: AmadeusExecutionRequestRef): AmadeusExecutionAttemptOutcome {
      void request;
      return 'internal-failure';
    },
  });
}
