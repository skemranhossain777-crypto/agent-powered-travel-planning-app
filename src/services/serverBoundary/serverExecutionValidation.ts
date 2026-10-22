/**
 * Strict server-side execution request validation (STEP 67).
 *
 * The server never trusts browser-supplied values just because the browser
 * normally generates them. Before any provider code runs, the raw request must
 * be exactly the STEP 59 provider-neutral request:
 *
 *   { id, kind: 'trip-execution-provider-request', dispatchId }
 *
 * and nothing else.
 *
 * The checks, in order:
 *
 * 1. The method must be `POST`. A `GET` is rejected before the body is read so
 *    the endpoint cannot be probed or driven by a link, a prefetch, or a crawler.
 * 2. When a `Content-Type` is supplied it must be `application/json`. A body
 *    sent as `text/plain`, form-encoded, or any other type is rejected, so a
 *    handler that parsed it as text can never smuggle a string through. A missing
 *    header is tolerated only because the body-shape check below is sufficient to
 *    reject anything that is not a JSON object.
 * 3. The body must be a plain JSON object: not `null`, not an array, not a
 *    primitive, and not a boxed/stringified value.
 * 4. **Exactly** the three known keys are accepted. Any other key rejects the
 *    whole request. This is the single most important rule here: it is what stops
 *    a caller from adding a provider id, base URL, endpoint path, HTTP method,
 *    header, client id, client secret, access token, operation, traveler identity,
 *    payment authorization, booking payload, or any other field and turning the
 *    endpoint into a generic HTTP proxy. Rejecting is safer than stripping,
 *    because stripping would silently accept a request the caller believed it had
 *    shaped correctly.
 * 5. The `kind` must be the single STEP 59 request kind.
 * 6. Identity is delegated to the STEP 59 `isTripExecutionProviderRequest`, so
 *    the server applies exactly the domain's own definition - a well-formed
 *    dispatch id and a request id that still derives from it. A well-formed
 *    request is then returned as a **fresh** object, so the provider never holds
 *    a reference to the caller's parsed body.
 *
 * On rejection the returned problem is a fixed, value-free token. The caller's
 * submitted values are never echoed back into an error, so a rejected body
 * cannot be used to reflect arbitrary content into a response or a log line.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

import {
  getTripExecutionProviderRequestId,
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  type TripExecutionProviderRequest,
} from '../tripExecution/tripExecutionProvider';

/**
 * The defensive upper bound for the dispatch id, the root identity of the
 * request. The STEP 59 contract only requires a prefix and a non-empty suffix, so
 * without a bound here an arbitrarily large string would pass the structural
 * check. Identifiers are derived deterministically and are short; 200 characters
 * is far above anything the dispatch boundary can produce.
 *
 * The bound is applied to the dispatch id alone, because the request id is
 * derived from it by a fixed template. Bounding the root therefore bounds the
 * derived value too, and a request id can never be rejected for length alone
 * while its own root was accepted.
 */
export const MAX_SERVER_EXECUTION_IDENTITY_LENGTH = 200;

/** The only keys an execution request may carry. */
export const SERVER_EXECUTION_REQUEST_KEYS = Object.freeze(['id', 'kind', 'dispatchId']);

/**
 * The bounded, value-free reasons a request can be rejected. These are fixed
 * tokens: they never contain a submitted value, so nothing the caller sent can
 * be reflected into a response.
 */
export type ServerExecutionValidationProblem =
  | 'malformed-body'
  | 'unsupported-method'
  | 'unsupported-content-type'
  | 'invalid-id'
  | 'invalid-kind'
  | 'invalid-dispatch-id'
  | 'request-dispatch-mismatch'
  | 'unexpected-field';

/** The result of strict request validation. */
export type ServerExecutionValidationResult =
  | { ok: true; request: TripExecutionProviderRequest }
  | { ok: false; problem: ServerExecutionValidationProblem };

/** The transport facts the validator needs. Kept minimal and injected. */
export interface ServerExecutionRequestEnvelope {
  /** The HTTP method, as received. */
  method: unknown;
  /** The `Content-Type` header, if the caller sent one. */
  contentType?: unknown;
  /** The parsed body, exactly as the host received it (never trusted). */
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonContentType(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

function isIdentityString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBoundedDispatchId(value: unknown): value is string {
  return isIdentityString(value) && value.length <= MAX_SERVER_EXECUTION_IDENTITY_LENGTH;
}

/**
 * The single unknown-key check. Compares the body's own enumerable keys against
 * the three permitted ones, so a key added by a future contract change is
 * rejected here until the boundary is deliberately widened.
 */
function hasOnlyKnownKeys(value: Record<string, unknown>): boolean {
  for (const key of Object.keys(value)) {
    if (!SERVER_EXECUTION_REQUEST_KEYS.includes(key)) return false;
  }
  return true;
}

/**
 * Chooses the most specific bounded problem for a body that passed the key,
 * kind, and shape checks but is not a valid STEP 59 request. The order is
 * deterministic and root-first: the dispatch id is the identity the request id
 * is *derived from*, so a fault there is reported before a fault in the derived
 * value. Without that order an over-long dispatch id would surface as
 * `invalid-id`, blaming the derived field for the root cause.
 */
function identityProblem(value: Record<string, unknown>): ServerExecutionValidationProblem {
  if (!isBoundedDispatchId(value.dispatchId)) return 'invalid-dispatch-id';
  if (!isIdentityString(value.id)) return 'invalid-id';

  // Both fields are well-formed strings, so the only remaining failure is a
  // request id that no longer derives from its dispatch id. The template is
  // pure, so comparing against it settles the case.
  return getTripExecutionProviderRequestId(value.dispatchId) === value.id
    ? 'invalid-dispatch-id'
    : 'request-dispatch-mismatch';
}

/**
 * Validates an untrusted execution request envelope server-side. Returns a fresh
 * validated request or the first bounded validation problem. Never throws, never
 * echoes a submitted value, and never invokes a provider.
 */
export function validateServerExecutionRequest(
  envelope: ServerExecutionRequestEnvelope
): ServerExecutionValidationResult {
  if (typeof envelope.method !== 'string' || envelope.method.trim().toUpperCase() !== 'POST') {
    return { ok: false, problem: 'unsupported-method' };
  }

  if (envelope.contentType !== undefined && !isJsonContentType(envelope.contentType)) {
    return { ok: false, problem: 'unsupported-content-type' };
  }

  if (!isRecord(envelope.raw)) return { ok: false, problem: 'malformed-body' };

  if (!hasOnlyKnownKeys(envelope.raw)) return { ok: false, problem: 'unexpected-field' };

  if (envelope.raw.kind !== TRIP_EXECUTION_PROVIDER_REQUEST_KIND) {
    return { ok: false, problem: 'invalid-kind' };
  }

  // The defensive bound is applied *in addition to* the domain contract, not
  // instead of it: `isTripExecutionProviderRequest` only requires a prefix and a
  // non-empty suffix, so an over-long dispatch id would otherwise pass.
  if (!isBoundedDispatchId(envelope.raw.dispatchId) || !isTripExecutionProviderRequest(envelope.raw)) {
    return { ok: false, problem: identityProblem(envelope.raw) };
  }

  // A fresh, three-field object: the provider receives a value the caller cannot
  // still hold a reference to and mutate after validation has passed.
  return {
    ok: true,
    request: {
      id: envelope.raw.id,
      kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
      dispatchId: envelope.raw.dispatchId,
    },
  };
}
