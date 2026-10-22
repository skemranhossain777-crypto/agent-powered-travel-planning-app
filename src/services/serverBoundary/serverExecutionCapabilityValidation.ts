/**
 * Strict server-side capability request validation (STEP 68).
 *
 * The capability endpoint is the one execution surface with **no input at all**.
 * That is a deliberate design choice rather than a missing feature, and it is the
 * strongest possible answer to the requirement that a client must not be able to
 * influence the server's capability result.
 *
 * The rules, in order:
 *
 * 1. The method must be `GET`. Anything else - `POST`, `PUT`, `DELETE`, `PATCH`,
 *    `HEAD`, or a nonsense verb - is rejected as `unsupported-method`, which the
 *    runner maps to HTTP 405. A capability query has nothing to mutate, so there
 *    is no legitimate reason to accept a verb that implies one.
 * 2. **A body is never accepted.** The execution endpoint must read a body
 *    because it carries a provider request; capability discovery must not, and
 *    this is where that is enforced. A non-empty body is rejected as
 *    `unexpected-body` (HTTP 400) whether or not it parses, so a client cannot
 *    smuggle a `providerId`, a `capabilityId`, a `host`, a `method`, a
 *    `credentials` object, or an access token into the query and have any part of
 *    it read. This is a *rejection*, not a strip: silently discarding a field the
 *    caller believed was in effect would be worse than refusing it.
 * 3. Nothing else is read. Query parameters are never inspected, so a
 *    `?providerId=...` or `?capabilityId=...` cannot alter the result - the value
 *    is not merely ignored, the parameter has no code path that reads it.
 *
 * Because the only accepted request is "GET with no body", the validated result
 * carries no data at all. It exists so the runner can be written as a linear
 * authenticate-validate-evaluate pipeline with the same shape as STEP 67, and so
 * a future input-bearing variant of this endpoint has an obvious place to grow.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

/**
 * The bounded, value-free reasons a capability request can be rejected. Fixed
 * tokens only: nothing the caller submitted is ever echoed, so a rejected
 * request cannot reflect content into a response or a log line.
 */
export type ServerExecutionCapabilityValidationProblem =
  | 'unsupported-method'
  | 'unexpected-body';

/**
 * The result of capability-request validation. The success arm carries no data
 * precisely because the accepted request contains none.
 */
export type ServerExecutionCapabilityValidationResult =
  | { ok: true }
  | { ok: false; problem: ServerExecutionCapabilityValidationProblem };

/** The transport facts the validator needs. Kept minimal and injected. */
export interface ServerExecutionCapabilityRequestEnvelope {
  /** The HTTP method, as received. */
  method: unknown;
  /** The raw request body as received. Must be absent or empty for a valid call. */
  raw?: unknown;
}

function isEmptyBody(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  // A plain object, and also a `Buffer`: an empty Buffer has no enumerable own
  // keys, and a non-empty one has at least one index, so both cases are decided
  // correctly by the key count and no Node-specific special case is needed.
  if (typeof value === 'object') return Object.keys(value).length === 0;
  // A number, boolean, or function is never a valid empty body. `false` and `0` are
  // real values, not "absent", so they are rejected rather than treated as no body.
  return false;
}

/**
 * Validates an untrusted capability request envelope. Accepts only a `GET` with
 * no body; returns the first bounded problem otherwise. Never throws, never
 * echoes a submitted value, and never touches a provider or a transport.
 */
export function validateServerExecutionCapabilityRequest(
  envelope: ServerExecutionCapabilityRequestEnvelope
): ServerExecutionCapabilityValidationResult {
  if (typeof envelope.method !== 'string' || envelope.method.trim().toUpperCase() !== 'GET') {
    return { ok: false, problem: 'unsupported-method' };
  }

  if (!isEmptyBody(envelope.raw)) {
    return { ok: false, problem: 'unexpected-body' };
  }

  return { ok: true };
}
