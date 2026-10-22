/**
 * Secure server-side execution boundary contract (STEP 67).
 *
 * The wire contract between the browser and the Firebase Functions v2 host for
 * the FIRST real external-provider EXECUTION boundary. It mirrors the shape
 * already established by the STEP 42 discovery boundary, and keeps the same
 * safety rules:
 *
 * 1. **No provider-specific request vocabulary.** The request is exactly a
 *    `TripExecutionProviderRequest` from the STEP 59 contract: an identity-only
 *    `{ id, kind, dispatchId }` triple. There is no field for a provider id, a
 *    client id, a client secret, an API URL, an endpoint, an HTTP method, a
 *    header, a token, or any operational payload. The validator rejects unknown
 *    keys, so the browser can never turn the endpoint into a generic HTTP proxy
 *    and can never smuggle an operation, traveler identity, payment
 *    authorization, or booking detail past the provider boundary.
 * 2. **Provider credentials never serialize.** Secrets live only in the
 *    server-side config injected into the runner. The response projection picks
 *    provider-result fields one by one; no config value, access token, or
 *    transport detail is ever part of a response body.
 * 3. **The response mirrors the existing provider-neutral contract.** The body
 *    is built from the STEP 59 `TripExecutionProviderResult` the provider
 *    already returned, so the browser consumes the exact contract the
 *    execution domain defines. Failures use the bounded STEP 20 safe-error
 *    vocabulary with appropriate HTTP semantics.
 * 4. **Authenticated transports only.** Unauthenticated and invalid-token
 *    requests get a small bounded error body with HTTP 401.
 * 5. **No lifecycle fiction.** The status vocabulary is derived from the STEP 59
 *    result vocabulary and never implies that a reservation was made, a payment
 *    settled, or a booking changed. The real provider cannot currently act, so
 *    `accepted` is unreachable in practice; the mapping is still defined for it
 *    so the boundary stays correct if an operation is ever implemented.
 *
 * Determinism: the contract has no clock, network, SDK, Firebase, React,
 * Router, Zustand, `any`, or generic `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type {
  TripExecutionProviderRequest,
  TripExecutionProviderResult,
} from '../tripExecution/tripExecutionProvider';
import type { ServerExecutionValidationProblem } from './serverExecutionValidation';

/** An identity the server boundary has already verified via Firebase ID-token checks. */
export interface ServerExecutionPrincipal {
  /** The verified Firebase Auth UID. Never taken from the request body. */
  uid: string;
}

/** The two bounded authentication failure states the boundary can report. */
export type ServerExecutionAuthProblem = 'unauthenticated' | 'invalid-token';

/**
 * Marker on an auth-error body so a client can distinguish an authentication
 * failure from a normalized execution outcome before parsing the `status` field.
 */
export const SERVER_EXECUTION_AUTH_ERROR_RESPONSE_KIND = 'server-execution-auth-error';

/** The bounded body returned for an unauthenticated / invalid-token request. */
export interface ServerExecutionAuthErrorResponse {
  kind: typeof SERVER_EXECUTION_AUTH_ERROR_RESPONSE_KIND;
  status: 'unauthenticated' | 'invalid-token';
  message: string;
}

/**
 * The provider-neutral execution response the server sends.
 *
 * The status vocabulary is derived from the STEP 59 result vocabulary and
 * deliberately says nothing about a booking lifecycle:
 *
 * - `success`          every provider reported `accepted` (currently unreachable)
 * - `invalid-input`    a provider rejected a well-formed request, or input failed validation
 * - `not-implemented`  execution is switched off, or the provider declined as unimplemented
 * - `not-configured`   the switch is on but server credentials are missing
 * - `provider-failure` a provider or its transport reported a real failure
 * - `unexpected-failure` a defensive server fault outside the provider path
 */
export type ServerExecutionStatus =
  | 'success'
  | 'invalid-input'
  | 'not-implemented'
  | 'not-configured'
  | 'provider-failure'
  | 'unexpected-failure';

/**
 * The provider-neutral execution response. It carries only the validated
 * request identity and the provider results projected field-by-field: never
 * credentials, tokens, raw provider payloads, exception messages, stack traces,
 * internal paths, or traveler, payment, reservation, and booking data.
 */
export interface ServerExecutionResponse {
  status: ServerExecutionStatus;
  /** The validated provider-neutral request, or `null` when the input was rejected. */
  request: TripExecutionProviderRequest | null;
  /** Provider results in the composed provider order; empty when no provider ran. */
  providerResults: TripExecutionProviderResult[];
  /** Present only for `invalid-input` caused by request validation. */
  problem: ServerExecutionValidationProblem | null;
  /** Bounded safe error for every non-success status; `null` on `success`. */
  error: ProviderSafeError | null;
}

/** The complete server response: either the normalized body or a bounded auth error. */
export type ServerExecutionResponseBody = ServerExecutionResponse | ServerExecutionAuthErrorResponse;

/**
 * The two statuses only an auth-error body can carry. They are disjoint from
 * `ServerExecutionStatus`, so `status` is a sound discriminant for the union.
 */
const AUTH_ERROR_STATUSES: ReadonlyArray<ServerExecutionAuthErrorResponse['status']> = Object.freeze([
  'unauthenticated',
  'invalid-token',
]);

/**
 * True when a body is a bounded authentication error rather than a normalized
 * execution outcome. Exported so any client - and the boundary's own tests - can
 * discriminate the union on `status` instead of guessing.
 */
export function isServerExecutionAuthErrorBody(
  body: ServerExecutionResponseBody
): body is ServerExecutionAuthErrorResponse {
  return AUTH_ERROR_STATUSES.includes(
    body.status as ServerExecutionAuthErrorResponse['status']
  );
}

/** The final result of one server-boundary execution run. */
export interface ServerExecutionHttpResult {
  /** HTTP status semantics for the outcome (never 200 on a real failure). */
  httpStatus: number;
  /** The provider-neutral, secret-free response body. */
  body: ServerExecutionResponseBody;
}

/** HTTP status codes the boundary uses (kept as plain numbers for wire clarity). */
export const SERVER_EXECUTION_HTTP_OK = 200;
export const SERVER_EXECUTION_HTTP_BAD_REQUEST = 400;
export const SERVER_EXECUTION_HTTP_UNAUTHORIZED = 401;
export const SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED = 501;
export const SERVER_EXECUTION_HTTP_BAD_GATEWAY = 502;
export const SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE = 503;
export const SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR = 500;

/** Stable public messages for the two auth failures (never reveal internals). */
export const SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE =
  'You must be signed in to run real-provider execution.';

export const SERVER_EXECUTION_INVALID_TOKEN_MESSAGE =
  'The session token could not be verified. Please sign in again.';
