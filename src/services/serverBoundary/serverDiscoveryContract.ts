/**
 * Secure server-side discovery boundary contract (STEP 42).
 *
 * The wire contract between the browser and the Firebase Functions v2 host for
 * the FIRST real external-provider discovery execution boundary. It is
 * deliberately provider-neutral, minimal, and explicit: the browser sends only
 * the same normalized discovery query it already builds for the STEP 21/40 mock
 * path, and the server returns only the normalized discovery outcome the
 * browser already understands.
 *
 * Safety rules:
 *
 * 1. **No provider-specific request vocabulary.** The request is exactly a
 *    `TripDiscoveryQuery`. There is no field for a client id, client secret,
 *    API URL, provider name, HTTP method, header, endpoint, path, token, or
 *    raw payload — the discovery-input normalizer rejects unknown keys, so the
 *    browser can never turn the endpoint into a generic HTTP proxy.
 * 2. **Provider credentials never serialize.** Secrets live only in the
 *    server-side config injected into the runner. The response projection
 *    picks the normalized outcome fields field-by-field; no config value,
 *    access token, or transport detail is ever part of a response body.
 * 3. **The response mirrors the existing normalized contract.** The success
 *    body is structurally identical to the STEP 41 `RealDiscoveryOutcome`, so
 *    the browser consumes the exact contract it already has; failures use the
 *    bounded STEP 20 safe-error vocabulary with appropriate HTTP semantics.
 * 4. **Authenticated transports only.** Unauthenticated and invalid-token
 *    requests get a small bounded error body with HTTP 401.
 *
 * Determinism: the contract has no clock, network, SDK, Firebase, React,
 * Router, Zustand, `any`, or generic `Record<string, any>` escape hatches.
 */

import type { ProviderAdapterProfile } from '../../domain/providers/providerAdapter';
import type {
  TripDiscoveryQuery,
  TripDiscoveryQueryProblem,
} from '../../domain/providers/discoveryInput';
import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type {
  RealDiscoveryProviderOutcome,
  RealDiscoveryStatus,
} from '../realDiscovery/realDiscoveryService';

/** An identity the server boundary has already verified via Firebase ID-token checks. */
export interface ServerDiscoveryPrincipal {
  /** The verified Firebase Auth UID. Never taken from the request body. */
  uid: string;
}

/** The two bounded authentication failure states the boundary can report. */
export type ServerDiscoveryAuthProblem = 'unauthenticated' | 'invalid-token';

/**
 * Marker on an auth-error body so a client can distinguish an authentication
 * failure from a normalized discovery outcome before parsing the `status` field.
 */
export const SERVER_DISCOVERY_AUTH_ERROR_RESPONSE_KIND = 'server-discovery-auth-error';

/** The bounded body returned for an unauthenticated / invalid-token request. */
export interface ServerDiscoveryAuthErrorResponse {
  kind: typeof SERVER_DISCOVERY_AUTH_ERROR_RESPONSE_KIND;
  status: 'unauthenticated' | 'invalid-token';
  message: string;
}

/**
 * The provider-neutral discovery response the server sends. Its shape matches
 * the STEP 41 normalized outcome so the browser keeps one discovery contract:
 * results are live read-only quotes, `error` is a bounded safe error, and
 * nothing here carries credentials, tokens, raw payloads, or internal details.
 */
export interface ServerDiscoveryResponse {
  status: RealDiscoveryStatus;
  /** The adapters consulted (stable provider id/name + capability status). */
  adaptersConsulted: ProviderAdapterProfile[];
  /** Normalized real-provider results when `success` or `partial`; empty otherwise. */
  results: TripProviderResult[];
  /** The normalized query that ran, or `null` when the input was rejected. */
  query: TripDiscoveryQuery | null;
  /** Present only for `invalid-input`. */
  problem: TripDiscoveryQueryProblem | null;
  /** Bounded safe error for `not-configured` / `provider-failure`; `null` otherwise. */
  error: ProviderSafeError | null;
  /** Per-provider attribution for every consulted adapter (STEP 40 semantics). */
  providerOutcomes: RealDiscoveryProviderOutcome[];
}

/** The complete server response: either the normalized body or a bounded auth error. */
export type ServerDiscoveryResponseBody =
  ServerDiscoveryResponse | ServerDiscoveryAuthErrorResponse;

/** The final result of one server-boundary discovery run. */
export interface ServerDiscoveryHttpResult {
  /** HTTP status semantics for the outcome (never 200 on a real failure). */
  httpStatus: number;
  /** The provider-neutral, secret-free response body. */
  body: ServerDiscoveryResponseBody;
}

/** HTTP status codes the boundary uses (kept as plain numbers for wire clarity). */
export const SERVER_DISCOVERY_HTTP_OK = 200;
export const SERVER_DISCOVERY_HTTP_BAD_REQUEST = 400;
export const SERVER_DISCOVERY_HTTP_UNAUTHORIZED = 401;
export const SERVER_DISCOVERY_HTTP_NOT_IMPLEMENTED = 501;
export const SERVER_DISCOVERY_HTTP_BAD_GATEWAY = 502;
export const SERVER_DISCOVERY_HTTP_SERVICE_UNAVAILABLE = 503;
export const SERVER_DISCOVERY_HTTP_INTERNAL_SERVER_ERROR = 500;

/** Stable public messages for the two auth failures (never reveal internals). */
export const SERVER_DISCOVERY_UNAUTHENTICATED_MESSAGE =
  'You must be signed in to run real-provider discovery.';

export const SERVER_DISCOVERY_INVALID_TOKEN_MESSAGE =
  'The session token could not be verified. Please sign in again.';
