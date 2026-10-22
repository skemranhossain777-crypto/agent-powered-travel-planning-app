/**
 * Secure server-side execution CAPABILITY boundary contract (STEP 68).
 *
 * The wire contract for a read-only capability/readiness query. It is the
 * discovery counterpart to the STEP 67 execution wire contract and follows the
 * same rules, with one crucial difference: **nothing here can cause an action.**
 *
 * 1. **Read-only by construction.** The response carries only a provider
 *    identity, a coarse availability status, a bounded reason, and the list of
 *    capability ids the provider reports as *executable*. There is no request
 *    vocabulary at all, so there is no field in which a client could name a
 *    provider, an operation, an endpoint, a host, an HTTP method, a credential,
 *    or an access token. The server owns provider selection completely.
 * 2. **Configuration state is never exposed raw.** The STEP 66 gate vocabulary
 *    is an *internal* fact and is not part of this contract. It is mapped to the
 *    coarse `available` / `unavailable` / `unsupported` status plus a bounded
 *    reason, so the client learns *why* execution is unavailable without ever
 *    seeing a config object, an env dump, a secret name, or the `ready` gate -
 *    the last of which would imply that credentials are present, which is exactly
 *    the inference this endpoint exists to prevent.
 * 3. **Configured is not executable.** This is the invariant the whole endpoint
 *    exists to protect. A fully configured provider with no implemented operation
 *    reports `unsupported` with an empty `capabilityIds`, which is deliberately
 *    *different* from the `unavailable` a disabled provider reports. A client can
 *    therefore never read "credentials are present" as "booking works".
 * 4. **Only recognized capability ids can appear.** `capabilityIds` is typed as
 *    the STEP 20 `ProviderCapabilityId` union, and the runner re-validates every
 *    id before it is placed on the wire, so an unknown or malformed internal value
 *    fails closed instead of being echoed to the browser.
 * 5. **No lifecycle fiction.** No field implies that something was reserved,
 *    bought, cancelled, or changed. Capability discovery describes what the system
 *    *can* do, and today that is nothing operational.
 *
 * Determinism: the contract has no clock, network, SDK, Firebase, React, Router,
 * Zustand, `any`, or generic `Record<string, any>` escape hatches.
 */

import type { ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import type { ServerExecutionAuthProblem } from './serverExecutionContract';
import type { ServerExecutionCapabilityValidationProblem } from './serverExecutionCapabilityValidation';

/**
 * Discriminant for the successful capability body. Paired with the STEP 67
 * auth-error `kind`, a client can tell the two apart with one string comparison
 * instead of guessing from a field that means different things in each.
 */
export const SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND = 'server-execution-capabilities';

/**
 * The coarse, honest availability of one provider's real execution surface.
 *
 * - `available`   the provider reports at least one executable capability. Not
 *                 reachable in this build, and never asserted by default.
 * - `unavailable` execution is switched off or the server is not configured. The
 *                 provider exists but cannot currently be attempted at all.
 * - `unsupported` the provider is present and fully configured, yet implements
 *                 no executable operation. Configuration is not capability.
 */
export type ServerExecutionCapabilityAvailability = 'available' | 'unavailable' | 'unsupported';

/**
 * The bounded, value-free reason behind an availability status. These are closed
 * tokens derived from the STEP 66 gate and capability profile; none of them is a
 * provider message, an env key, a config field, or an exception detail.
 *
 * `null` is reserved for the `available` case, so a reason is always present
 * exactly when something is unavailable.
 */
export type ServerExecutionCapabilityReason =
  | 'execution-disabled'
  | 'credentials-missing'
  | 'no-executable-capability'
  | 'malformed-provider-capability'
  | 'unexpected-failure';

/**
 * One provider's capability entry, projected field-by-field from the STEP 66
 * profile. Carries an identity, a status, a reason, and the executable ids -
 * nothing else.
 */
export interface ServerExecutionCapabilityEntry {
  /** The application-facing provider identity (e.g. `amadeus-execution`). */
  providerId: string;
  /** The coarse availability of this provider's execution surface. */
  status: ServerExecutionCapabilityAvailability;
  /**
   * Only the capability ids the provider reports as actually executable, in the
   * deterministic STEP 20 order. Empty whenever `status` is not `available`, and
   * empty for a configured provider that implements nothing.
   */
  capabilityIds: ProviderCapabilityId[];
  /** Bounded reason; `null` only when `status` is `available`. */
  reason: ServerExecutionCapabilityReason | null;
}

/**
 * The successful capability body. A successful *evaluation* is HTTP 200 whatever
 * the provider's state: "this provider can do nothing" is a correct, useful
 * answer, not a server error. Returning a non-200 here would make a client treat
 * a healthy readiness check as a failure and lose the reason field.
 *
 * Exactly three fields, always present. Nothing else may be added without a
 * deliberate contract change, and in particular no config, gate, credential name,
 * or free-text message is ever added - a rejection reports a bounded `problem`
 * token instead of a sentence, so there is no string in this body that could carry
 * an internal detail.
 */
export interface ServerExecutionCapabilityResponse {
  kind: typeof SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND;
  /** One entry per provider the server composed, in its deterministic order. */
  providers: ServerExecutionCapabilityEntry[];
  /**
   * The bounded reason the request was rejected before any evaluation ran, or
   * `null` when the evaluation actually happened. A rejection always reports an
   * empty `providers` list, so a client can never mistake a refused query for a
   * real empty capability set.
   */
  problem: ServerExecutionCapabilityResponseProblem | null;
}

/**
 * The complete body: the normalized capability list, or the STEP 67 bounded
 * authentication error. The auth error is reused verbatim so a client can share
 * one 401 handler across both execution endpoints.
 */
export type ServerExecutionCapabilityResponseBody =
  | ServerExecutionCapabilityResponse
  | ServerExecutionAuthErrorBody;

/**
 * The STEP 67 auth-error shape, re-typed locally as a nominal alias so the
 * capability boundary cannot be widened into a different 401 contract.
 */
export interface ServerExecutionAuthErrorBody {
  kind: 'server-execution-auth-error';
  status: ServerExecutionAuthProblem;
  message: string;
}

/** The final result of one capability-discovery run. */
export interface ServerExecutionCapabilityHttpResult {
  httpStatus: number;
  body: ServerExecutionCapabilityResponseBody;
}

/**
 * True when a body is the successful capability list rather than a bounded auth
 * error. The two are disjoint on `kind`, so the check is a sound discriminant
 * and a client never has to inspect a status it does not understand.
 */
export function isServerExecutionCapabilityResponse(
  body: ServerExecutionCapabilityResponseBody
): body is ServerExecutionCapabilityResponse {
  return body.kind === SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND;
}

/** HTTP status codes the capability boundary uses. */
export const SERVER_EXECUTION_CAPABILITY_HTTP_OK = 200;
export const SERVER_EXECUTION_CAPABILITY_HTTP_BAD_REQUEST = 400;
export const SERVER_EXECUTION_CAPABILITY_HTTP_UNAUTHORIZED = 401;
export const SERVER_EXECUTION_CAPABILITY_HTTP_METHOD_NOT_ALLOWED = 405;
export const SERVER_EXECUTION_CAPABILITY_HTTP_INTERNAL_SERVER_ERROR = 500;

/**
 * Every bounded reason a capability body can report for a request that was
 * refused before any evaluation ran: the two validation problems plus the
 * defensive internal-fault token. A closed set of fixed strings, so the body can
 * never contain a message that could carry an internal detail.
 */
export type ServerExecutionCapabilityResponseProblem =
  | ServerExecutionCapabilityValidationProblem
  | 'unexpected-failure';
