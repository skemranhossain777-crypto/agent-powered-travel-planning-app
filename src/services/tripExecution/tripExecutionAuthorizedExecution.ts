/**
 * STEP 75 - authorized provider-request execution boundary.
 *
 * This module is the narrow seam where a qualified execution chain actually
 * reaches a provider, completing the chain:
 *
 *   AuthorizedRequest (STEP 74, provider request built)
 *        |
 *        v
 *   AuthorizedExecution (this module)  ->  [provider adapter] (supplied, never created here)
 *        |
 *        v
 *   TripExecutionProviderResult (STEP 59 result, returned verbatim)
 *
 * ## What this step is, and what it is emphatically not
 *
 * This is the first step permitted to call `provider.execute()`. It does exactly
 * one thing: it proves the request is a real authorized provider request,
 * proves the supplied provider is a real STEP 59 provider that the chain
 * actually qualified, calls `execute()` **once**, validates what came back, and
 * reports it.
 *
 * It is deliberately *not* an orchestrator. It accepts exactly one provider -
 * never an array, never a list, never a fallback - selects nothing, ranks
 * nothing, evaluates no capability, aggregates nothing, deduplicates nothing,
 * and computes no aggregate status. The provider it runs was already chosen by
 * the execution-domain stages upstream; this boundary only refuses to run one
 * that the chain did not qualify.
 *
 * ## What `accepted` means here
 *
 * STEP 59's `accepted` status means one thing only: "this provider accepted the
 * execution request." It does not mean a booking exists, that a reservation was
 * confirmed, that a ticket was issued, that a payment was processed, or that any
 * money moved. The provider result is returned byte-for-byte as the provider
 * produced it; no status is upgraded, downgraded, translated, or given extra
 * business meaning here. Interpreting a provider's answer is a later concern.
 *
 * ## The provider/request identity relationship, and an honest gap
 *
 * The STEP 59 provider request is deliberately provider-neutral: it carries only
 * `{ id, kind, dispatchId }` and names no provider. So there is no provider
 * identity *inside the request* to compare against, and this module does not
 * invent one.
 *
 * The relationship the chain does represent is on the STEP 74 result: its
 * `providerIds` is the qualified provider set, carried unchanged from the STEP 72
 * qualified dispatch through STEP 73. The gate below is therefore a membership
 * test - the supplied provider's identity must be a member of the set the chain
 * qualified - plus an exact byte comparison with no normalization. That is the
 * whole of the selection contract: it can only refuse, never choose.
 *
 * ## Why the call is wrapped, and why that is not a totality claim
 *
 * STEPS 71 through 74 read *data* and promised totality over ordinary values
 * without `try/catch`, because wrapping property access in `try/catch` would
 * only paper over a hostile `Proxy` while hiding real defects. That reasoning
 * does not apply here. This module calls into foreign code supplied by the
 * caller - a provider adapter that may throw, may reject, or may itself reach a
 * network. Letting an exception escape would hand the caller a provider's
 * internal error object, which is exactly the credential/URL/stack-trace leak
 * the boundary must prevent. So the call is wrapped, the throw is converted to
 * a bounded reason, and nothing about the exception is inspected, logged, or
 * re-thrown.
 *
 * There is no retry, no second provider, no fallback, and no orchestrator call
 * on failure. The provider is invoked at most once, ever.
 *
 * ## Fail-closed shape
 *
 * Every unsuccessful result has `executed === false` and `result === null`. A
 * provider result is never returned alongside a failed boundary verdict, and no
 * pre-execution gate ever calls `execute()` at all.
 *
 * ## No execution beyond the provider call
 *
 * The module never discovers or instantiates a provider, never reads
 * configuration or credentials, never reaches the network itself, books
 * nothing, pays nothing, persists nothing, and touches React, Firebase, Router,
 * or Zustand. There are no timers, no environment access, and no mutable global
 * state. The single `await` in the file awaits the provider's own `execute()`;
 * no other asynchronous work is introduced.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderRequest,
  isTripExecutionProviderResult,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
} from './tripExecutionProvider';
import { TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS } from './tripExecutionAuthorizedRequest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The existing execution provider-identity rule: non-empty, already-trimmed,
 * bounded. No case folding, no character filtering, and no normalization: a
 * provider id is an exact key, and STEP 59's own contract states the same
 * bound.
 */
function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

/** True when `value` is a well-formed, non-empty provider-request id. */
function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

/**
 * The narrowed form of an untrusted value that has the *shape* of a STEP 74
 * result. Every field is either absent/null or already a value of the domain's
 * own type, which is what lets the gates below report one specific reason per
 * fault instead of a blanket "invalid".
 */
interface AuthorizedRequestShape {
  accepted: boolean;
  reason: (typeof TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS)[number];
  providerRequest: Record<string, unknown> | null;
  requestId: string | null;
  providerIds: readonly string[];
}

/**
 * True when `value` has the *shape* of a STEP 74 authorized-request result.
 *
 * Only shape is checked. Whether the verdict is affirmative, whether the
 * embedded provider request is a real STEP 59 value, and whether the supplied
 * provider is a real STEP 59 provider are decided afterwards, so a negative but
 * well-formed result is reported as `request-not-accepted` rather than as
 * malformed.
 *
 * A field that is absent (`undefined`) is treated like the domain's explicit
 * `null`: both mean "not supplied", and the gate that owns that field reports
 * it. The plan, dispatch, authorization, and capability fields are deliberately
 * not part of this shape: they are STEP 74's to have validated, and this
 * boundary has no use for them.
 */
function hasAuthorizedRequestShape(value: unknown): value is AuthorizedRequestShape {
  if (!isRecord(value)) return false;
  if (typeof value.accepted !== 'boolean') return false;
  if (!isTripExecutionAuthorizedRequestReason(value.reason)) return false;

  const providerRequest = value.providerRequest;
  if (providerRequest !== null && providerRequest !== undefined && !isRecord(providerRequest)) {
    return false;
  }

  const requestId = value.requestId;
  if (requestId != null && typeof requestId !== 'string') return false;

  const providerIds = value.providerIds;
  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((id) => isSafeProviderId(id))) return false;

  return true;
}

/** True when `value` is a member of the closed STEP 74 reason vocabulary. */
function isTripExecutionAuthorizedRequestReason(value: unknown): boolean {
  return (TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/**
 * True when `value` satisfies the STEP 59 provider contract.
 *
 * STEP 59 exports no provider guard, so this checks the two things the interface
 * declares: a well-formed provider identity and an `execute` function. It is a
 * structural check on a *value*, not a selection mechanism - it says nothing
 * about which provider is right, which is decided by the membership gate below.
 */
function isProviderContract(value: unknown): value is TripExecutionProvider {
  if (!isRecord(value)) return false;
  if (!isSafeProviderId(value.providerId)) return false;
  return typeof value.execute === 'function';
}

/**
 * The closed, provider-neutral reason vocabulary for one execution.
 *
 * Bounded tokens only - never a provider message, credential detail, URL, or
 * exception text. `executed` is the single affirmative value and is reachable
 * only when every pre-execution gate held and the provider returned a valid
 * STEP 59 result.
 *
 * | condition                                                | reason                             |
 * |----------------------------------------------------------|------------------------------------|
 * | input or result not an object, or a wrong field type      | `request-invalid`                  |
 * | `accepted !== true`                                       | `request-not-accepted`             |
 * | embedded request absent or refused by the STEP 59 validator | `request-invalid`               |
 * | the result's own `requestId` disagrees with the request  | `request-identity-invalid`         |
 * | provider absent, not an object, or missing `execute`      | `provider-invalid`                 |
 * | provider identity not a member of the qualified set       | `provider-identity-mismatch`       |
 * | `execute()` threw or rejected                             | `provider-execution-failed`        |
 * | result refused by the STEP 59 result validator            | `provider-result-invalid`          |
 * | result's `providerId` is not the provider's own identity  | `provider-result-provider-mismatch`|
 * | result's `requestId` is not the request it was given      | `provider-result-request-mismatch` |
 */
export const TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS = [
  'executed',
  'request-invalid',
  'request-not-accepted',
  'request-identity-invalid',
  'provider-invalid',
  'provider-identity-mismatch',
  'provider-execution-failed',
  'provider-result-invalid',
  'provider-result-provider-mismatch',
  'provider-result-request-mismatch',
] as const;

/** The provider-neutral execution-boundary reason vocabulary. */
export type TripExecutionAuthorizedExecutionReason =
  (typeof TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS)[number];

/**
 * The pure result of one provider execution.
 *
 * Carries the real STEP 59 provider result, the identity that was executed
 * against, and a bounded token. It never carries a booking, a payment, a
 * reservation, a confirmation, an exception, or any provider payload beyond
 * STEP 59's three fields.
 */
export interface TripExecutionAuthorizedExecutionResult {
  /** True only when a provider ran once and returned a valid STEP 59 result. */
  executed: boolean;
  /** The authoritative STEP 59 provider result, or `null` on any failure. */
  result: TripExecutionProviderResult | null;
  /** The provider-request id that was executed, or `null` on an early failure. */
  requestId: string | null;
  /** The provider identity that was executed, or `null` on an early failure. */
  providerId: string | null;
  /** The bounded reason for this execution. */
  reason: TripExecutionAuthorizedExecutionReason;
}

/**
 * The input to one execution. Both members are untrusted and re-validated; no
 * URL, credential, HTTP client, Firebase object, React object, or router/store
 * object is accepted. The provider is supplied, never discovered or built here.
 */
export interface TripExecutionAuthorizedExecutionInput {
  /** The STEP 74 authorized-request result. Validated, never repaired. */
  request: unknown;
  /** The already-selected STEP 59 provider. Validated, never substituted. */
  provider: unknown;
}

/** Builds a rejection. `result` is always `null`. */
function rejected(
  reason: TripExecutionAuthorizedExecutionReason,
  requestId: string | null,
  providerId: string | null
): TripExecutionAuthorizedExecutionResult {
  return {
    executed: false,
    result: null,
    requestId,
    providerId,
    reason,
  };
}

/**
 * The narrow execution boundary: validates everything first, then executes the
 * supplied provider exactly once.
 *
 * Check order, which fixes the reported reason for any given input:
 *
 * 1. the input is an object and the request has the shape of a STEP 74 result
 * 2. that result is affirmative, with the affirmative reason token
 * 3. the embedded value is a real STEP 59 provider request
 * 4. the result's own `requestId` agrees with that provider request
 * 5. the supplied value is a real STEP 59 provider
 * 6. that provider's identity is a member of the qualified provider set
 * 7. `execute()` is called once with the exact validated request
 * 8. the returned value is a real STEP 59 result answering that request
 *
 * Gates 1 to 6 never call `execute()`. Gate 7 calls it exactly once, and no
 * retry, second provider, or fallback follows a failure.
 */
export async function executeTripExecutionAuthorizedRequest(
  input: TripExecutionAuthorizedExecutionInput
): Promise<TripExecutionAuthorizedExecutionResult> {
  if (!isRecord(input)) {
    return rejected('request-invalid', null, null);
  }

  const { request, provider } = input;

  // 1. The STEP 74 result is re-checked, never taken on trust.
  if (!hasAuthorizedRequestShape(request)) {
    return rejected('request-invalid', null, null);
  }

  // 2. A well-formed negative result is reported as such, never re-interpreted
  //    as a structural fault.
  if (!request.accepted) {
    return rejected('request-not-accepted', null, null);
  }
  if (request.reason !== 'accepted') {
    return rejected('request-invalid', null, null);
  }

  // 3. The embedded value must be a real STEP 59 provider request, so the value
  //    passed to the provider is one that contract genuinely accepts.
  if (!isTripExecutionProviderRequest(request.providerRequest)) {
    return rejected('request-invalid', null, null);
  }
  const providerRequest: TripExecutionProviderRequest = request.providerRequest;

  // 4. The result states the request id a second time, independently of the
  //    embedded request. STEP 74's own contract ties the two, but a hand-built
  //    result need not, so the agreement is checked rather than assumed. It is
  //    the only identity on the result that execution actually depends on.
  const requestId = request.requestId;
  if (!isProviderRequestId(requestId) || requestId !== providerRequest.id) {
    return rejected('request-identity-invalid', null, null);
  }

  // 5. The supplied value must satisfy the STEP 59 provider contract. A bare
  //    provider id, a plain function, or a callback is not a provider: the
  //    request is never dispatched into something that is not the contract.
  if (!isProviderContract(provider)) {
    return rejected('provider-invalid', null, null);
  }

  // 6. The provider must be one the chain actually qualified. The STEP 59
  //    request names no provider by design, so the qualified provider set
  //    carried on the STEP 74 result is the relationship that exists. Membership
  //    is an exact byte comparison: no case folding, no trimming, no alias, no
  //    substitution, and no selection among several candidates.
  if (!request.providerIds.includes(provider.providerId)) {
    return rejected('provider-identity-mismatch', null, provider.providerId);
  }

  // 7. The single provider call. The exact validated request is passed, unmutated
  //    and un-repaired. A throw or a rejection from foreign code is converted to
  //    a bounded reason; nothing about the exception is read, kept, or re-raised,
  //    and nothing is retried.
  let raw: unknown;
  try {
    raw = await provider.execute(providerRequest);
  } catch {
    return rejected('provider-execution-failed', providerRequest.id, provider.providerId);
  }

  // 8. The provider's answer is validated, never repaired. A result that is not a
  //    real STEP 59 result is discarded whole rather than partially salvaged.
  if (!isTripExecutionProviderResult(raw)) {
    return rejected('provider-result-invalid', providerRequest.id, provider.providerId);
  }
  const result: TripExecutionProviderResult = raw;

  // A STEP 59 result answers one request from one provider. Either identity
  // disagreeing means the adapter answered a different exchange, and the answer
  // is not about this execution.
  if (result.providerId !== provider.providerId) {
    return rejected('provider-result-provider-mismatch', providerRequest.id, provider.providerId);
  }
  if (result.requestId !== providerRequest.id) {
    return rejected('provider-result-request-mismatch', providerRequest.id, provider.providerId);
  }

  return {
    executed: true,
    // The provider's own value, exactly as returned. No field is rewritten, no
    // status is translated, and no business meaning is added to it.
    result,
    requestId: providerRequest.id,
    providerId: provider.providerId,
    reason: 'executed',
  };
}
