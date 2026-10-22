/**
 * The secure server-side discovery execution host (STEP 42).
 *
 * This is the execution host for the STEP 41 Amadeus integration — it is NOT a
 * replacement for the provider abstraction. It composes, in order:
 *
 *   1. **Authentication** — the server receives the verified identity as a
 *      `principal`; `null` means the request was unauthenticated/invalid and
 *      gets HTTP 401 before anything else runs. The Functions host computes the
 *      principal from a server-verified Firebase ID token (see
 *      `serverDiscoveryAuth.ts`); the UID can never come from the request body.
 *   2. **Strict validation** — the raw body must be a well-formed discovery
 *      query (see `serverDiscoveryValidation.ts`); otherwise HTTP 400 with a
 *      bounded safe problem.
 *   3. **Fail-closed configuration gate** — the attempt switch must be on and
 *      credentials present, exactly like STEP 41. Disabled is HTTP 501
 *      (feature not enabled) and missing credentials HTTP 503 (service not
 *      configured); never a provider call, never a silent empty.
 *   4. **Provider execution through the unchanged STEP 41 service** — the
 *      validated query, the server-side config, and the injected transport are
 *      handed to `discoverRealOptions`, which runs the Amadeus token exchange +
 *      read-only hotel search and composes the unchanged STEP 40 orchestrator
 *      through the Amadeus adapter.
 *   5. **Provider-neutral, secret-free response** — the normalized outcome is
 *      projected field-by-field into the wire response; a real provider failure
 *      is HTTP 502, never a misleading HTTP 200. Credentials, access tokens,
 *      and provider configuration never appear in any response body.
 *
 * Determinism: given `(raw, config, now, principal, transport)` the outcome is
 * deterministic. No clock, Firebase SDK, React, Router, Zustand, `any`, or
 * generic `Record<string, any>` escape hatches; no persistence, booking,
 * payment, verification, or primary assignment.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { AmadeusDiscoveryConfig } from '../realDiscovery/amadeusConfig';
import { getRealDiscoveryAttemptGate } from '../realDiscovery/amadeusConfig';
import type { AmadeusTransport } from '../realDiscovery/amadeusConnection';
import {
  discoverRealOptions,
  type RealDiscoveryOutcome,
  type RealDiscoveryStatus,
} from '../realDiscovery/realDiscoveryService';
import {
  SERVER_DISCOVERY_AUTH_ERROR_RESPONSE_KIND,
  SERVER_DISCOVERY_HTTP_BAD_GATEWAY,
  SERVER_DISCOVERY_HTTP_BAD_REQUEST,
  SERVER_DISCOVERY_HTTP_INTERNAL_SERVER_ERROR,
  SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED,
  SERVER_DISCOVERY_HTTP_OK,
  SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE,
  SERVER_DISCOVERY_HTTP_UNAUTHORIZED,
  SERVER_DISCOVERY_INVALID_TOKEN_MESSAGE,
  SERVER_DISCOVERY_UNAUTHENTICATED_MESSAGE,
  type ServerDiscoveryAuthErrorResponse,
  type ServerDiscoveryAuthProblem,
  type ServerDiscoveryHttpResult,
  type ServerDiscoveryPrincipal,
  type ServerDiscoveryResponse,
} from './serverDiscoveryContract';
import { validateServerDiscoveryRequest } from './serverDiscoveryValidation';

/** Everything one server-boundary discovery run needs (all injected). */
export interface RunServerDiscoveryInput {
  /** The raw request body as received over HTTP (never trusted). */
  raw: unknown;
  /** The server-side config that owns credentials (never echoed). */
  config: AmadeusDiscoveryConfig;
  /** The deterministic "now" timestamp for freshness/expiry decisions. */
  now: string;
  /**
   * The server-verified identity. `null` rejects with HTTP 401 before any
   * input or provider code runs.
   */
  principal: ServerDiscoveryPrincipal | null;
  /**
   * The bounded reason the principal is missing (defaults to `unauthenticated`).
   * The Functions host passes `invalid-token` when ID-token verification fails
   * so the browser can distinguish an expired session from a missing one.
   */
  authProblem?: ServerDiscoveryAuthProblem;
  /** Injected network seam; the host wires this to the Amadeus fetch transport. */
  transport?: AmadeusTransport;
}

/** Stable messages for the fail-closed configuration states (mirror STEP 41). */
export const SERVER_DISCOVERY_DISABLED_MESSAGE =
  'Real-provider discovery is not enabled in this build.';
export const SERVER_DISCOVERY_CREDENTIALS_MISSING_MESSAGE =
  'Real-provider credentials are not configured for this build.';
export const SERVER_DISCOVERY_NO_TRANSPORT_MESSAGE =
  'The real-provider transport is not configured for this host.';

/**
 * Runs a single authenticated, validated, read-only discovery search through
 * the secure server boundary. Never throws; never persists; never books, pays,
 * or verifies; no auto primary assignment. The result carries appropriate HTTP
 * status semantics plus a provider-neutral, secret-free body.
 */
export async function runServerBoundaryDiscovery(
  input: RunServerDiscoveryInput
): Promise<ServerDiscoveryHttpResult> {
  if (input.principal === null || input.principal === undefined) {
    return authRejection(input.authProblem ?? 'unauthenticated');
  }

  const validation = validateServerDiscoveryRequest(input.raw);
  if (!validation.ok) {
    return invalidInputRejection(validation.problem);
  }

  const gate = getRealDiscoveryAttemptGate(input.config);

  if (gate === 'disabled') {
    return notConfiguredRejection(
      'not-implemented',
      SERVER_DISCOVERY_DISABLED_MESSAGE,
      SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED
    );
  }
  if (gate === 'credentials-missing') {
    return notConfiguredRejection(
      'credentials-missing',
      SERVER_DISCOVERY_CREDENTIALS_MISSING_MESSAGE,
      SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE
    );
  }

  if (input.transport === undefined) {
    return {
      httpStatus: SERVER_DISCOVERY_HTTP_BAD_GATEWAY,
      body: {
        status: 'provider-failure',
        adaptersConsulted: [],
        results: [],
        query: validation.query,
        problem: null,
        error: { category: 'not-implemented', message: SERVER_DISCOVERY_NO_TRANSPORT_MESSAGE },
        providerOutcomes: [],
      },
    };
  }

  const outcome = await discoverRealOptions(input.raw, input.config, input.now, {
    transport: input.transport,
  });

  return toHttpResult(outcomeToServerDiscoveryResponse(outcome));
}

/**
 * Projects a normalized STEP 41 outcome into the wire-safe discovery response.
 * Every field is picked explicitly so no config value, access token, or raw
 * provider detail can ever serialize into a response body.
 */
export function outcomeToServerDiscoveryResponse(
  outcome: RealDiscoveryOutcome | UnmappedOutcome
): ServerDiscoveryResponse {
  return {
    status: outcome.status,
    adaptersConsulted: outcome.adaptersConsulted,
    results: outcome.results,
    query: outcome.query,
    problem: outcome.problem,
    error: outcome.error,
    providerOutcomes: outcome.providerOutcomes,
  };
}

/**
 * The HTTP status for a real-provider outcome under the server boundary:
 * 200 for successful/empty/unsupported discovery, 400 for invalid input,
 * 502 for any real provider failure (never a misleading 200), 501/503 for the
 * not-configured states and 500 for the defensive unexpected state.
 */
export function httpStatusForDiscoveryStatus(
  status: RealDiscoveryStatus,
  error: ProviderSafeError | null
): number {
  switch (status) {
    case 'success':
    case 'partial':
    case 'empty':
    case 'unsupported':
      return SERVER_DISCOVERY_HTTP_OK;
    case 'invalid-input':
      return SERVER_DISCOVERY_HTTP_BAD_REQUEST;
    case 'not-configured':
      return error?.category === 'credentials-missing'
        ? SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE
        : SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED;
    case 'provider-failure':
      return SERVER_DISCOVERY_HTTP_BAD_GATEWAY;
    case 'unexpected-failure':
      return SERVER_DISCOVERY_HTTP_INTERNAL_SERVER_ERROR;
  }
}

/** The outcome-valued subset shared by `RealDiscoveryOutcome` and callers. */
interface UnmappedOutcome {
  status: RealDiscoveryStatus;
  adaptersConsulted: ServerDiscoveryResponse['adaptersConsulted'];
  results: ServerDiscoveryResponse['results'];
  query: ServerDiscoveryResponse['query'];
  problem: ServerDiscoveryResponse['problem'];
  error: ServerDiscoveryResponse['error'];
  providerOutcomes: ServerDiscoveryResponse['providerOutcomes'];
}

function toHttpResult(body: ServerDiscoveryResponse): ServerDiscoveryHttpResult {
  return { httpStatus: httpStatusForDiscoveryStatus(body.status, body.error), body };
}

function authRejection(problem: 'unauthenticated' | 'invalid-token'): ServerDiscoveryHttpResult {
  return {
    httpStatus: SERVER_DISCOVERY_HTTP_UNAUTHORIZED,
    body: {
      kind: SERVER_DISCOVERY_AUTH_ERROR_RESPONSE_KIND,
      status: problem,
      message:
        problem === 'unauthenticated'
          ? SERVER_DISCOVERY_UNAUTHENTICATED_MESSAGE
          : SERVER_DISCOVERY_INVALID_TOKEN_MESSAGE,
    },
  };
}

function invalidInputRejection(
  problem: NonNullable<ServerDiscoveryResponse['problem']>
): ServerDiscoveryHttpResult {
  return {
    httpStatus: SERVER_DISCOVERY_HTTP_BAD_REQUEST,
    body: {
      status: 'invalid-input',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem,
      error: null,
      providerOutcomes: [],
    },
  };
}

function notConfiguredRejection(
  category: 'not-implemented' | 'credentials-missing',
  message: string,
  httpStatus: number
): ServerDiscoveryHttpResult {
  return {
    httpStatus,
    body: {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: { category, message },
      providerOutcomes: [],
    },
  };
}

export type { ServerDiscoveryAuthErrorResponse };
