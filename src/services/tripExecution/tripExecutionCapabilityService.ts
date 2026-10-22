/**
 * Browser-side, provider-neutral execution capability service (STEP 69).
 *
 * The client's typed entry point for the STEP 68 read-only capability API. It is
 * the only place the browser learns what real execution can currently do, and it
 * is deliberately the *only* way to learn it: there is no provider SDK, no
 * server secret, no execution adapter, and no direct provider call anywhere in
 * this module or reachable from it.
 *
 * The shape deliberately mirrors the established STEP 42 browser client
 * (`services/serverDiscoveryClient.ts`) rather than inventing a second transport
 * convention: both the ID token and the HTTP transport are **injected**, there
 * is no literal `fetch` call and no Firebase import, and the same
 * `ProviderSafeError` category vocabulary is reused. Nothing here reads a clock,
 * a global, a store, or an environment variable.
 *
 * The security properties, and why each one is structural rather than a check:
 *
 * 1. **The endpoint is a constant.** `TRIP_EXECUTION_CAPABILITIES_ENDPOINT` is
 *    a fixed string. There is no parameter, option, or configuration input that
 *    can alter the URL, so a caller cannot point this at another host, a
 *    provider, or a path traversal. This is the single most important property of
 *    the module, and it is why the function takes no arguments at all.
 * 2. **No request body, and no query string.** The call is a bare `GET`. There is
 *    no field in which a `providerId`, `capabilityId`, `host`, `method`, or
 *    credential could be smuggled, which is what makes the STEP 68 server-side
 *    rejection of such a body an unreachable path rather than a load-bearing one.
 * 3. **The response is validated, not cast.** Every field is checked against a
 *    closed vocabulary and the entry is *rejected* when it does not conform. A
 *    malformed response never becomes a partial snapshot and never becomes an
 *    empty one: silently repairing a body would tell the caller "this deployment
 *    can execute nothing", which is a materially different - and wrong - claim
 *    from "the server answered something this client cannot trust".
 * 4. **No token, credential, or raw body is ever returned.** The ID token is
 *    consumed inside the call and discarded. Error results carry a bounded
 *    category and a fixed message; a server error body is parsed only to
 *    distinguish an authentication failure, and its contents are never forwarded.
 * 5. **No caching, no polling, no retry.** One call is one request. A caller
 *    decides if and when to ask.
 *
 * Determinism: no clock, timestamp, randomness, storage, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError, ProviderSafeErrorCategory } from '../../domain/providers/executionOperations';

/**
 * The fixed, application-level path of the STEP 68 capability endpoint, behind
 * the Firebase Hosting rewrite. A constant by design: nothing composes it.
 */
export const TRIP_EXECUTION_CAPABILITIES_ENDPOINT = '/api/real-execution/capabilities';

/**
 * The coarse availability of one provider's real execution surface, mirroring
 * the STEP 68 wire contract exactly. `available` is defined but unreachable
 * against the current STEP 66 provider, and is retained so the client contract
 * stays correct if an operation is ever implemented.
 */
export type TripExecutionCapabilityStatus = 'available' | 'unavailable' | 'unsupported';

/**
 * The bounded, value-free reason a provider is not executable. This is the STEP 68
 * client-facing vocabulary, preserved exactly - none of these is an internal gate
 * state, a secret name, a config field, or a provider message.
 */
export type TripExecutionCapabilityReason =
  | 'execution-disabled'
  | 'credentials-missing'
  | 'no-executable-capability'
  | 'malformed-provider-capability'
  | 'unexpected-failure';

/**
 * The bounded reason a request can be refused before any evaluation runs. The
 * server reports one of these with an empty provider list; a client can display
 * it, but it is a token, never a sentence from the server.
 */
export type TripExecutionCapabilityProblem = 'unsupported-method' | 'unexpected-body' | 'unexpected-failure';

/** One provider's capability, as the browser may safely hold it. */
export interface TripExecutionCapabilityProviderState {
  /** The application-facing provider identity, server-derived. */
  providerId: string;
  /** The coarse availability of this provider's execution surface. */
  status: TripExecutionCapabilityStatus;
  /**
   * Only the capability ids the server reports as actually executable, in the
   * server's deterministic order. Empty whenever `status` is not `available`.
   */
  capabilityIds: string[];
  /** Bounded reason; `null` only when `status` is `available`. */
  reason: TripExecutionCapabilityReason | null;
}

/**
 * One successful, validated capability read. Holds only provider identities,
 * coarse statuses, bounded reasons, and safe capability ids.
 */
export interface TripExecutionCapabilitySnapshot {
  /** The provider states, in the server's order. */
  providers: TripExecutionCapabilityProviderState[];
  /** The bounded refusal reason, or `null` when the read succeeded. */
  problem: TripExecutionCapabilityProblem | null;
}

/**
 * A failed capability read. `ok: false` makes the result a properly discriminated
 * union, so `if (result.ok)` narrows both ways in TypeScript rather than relying
 * on a missing key being falsy.
 *
 * `snapshot` is `null` on every failure, so a caller cannot mistake an error for
 * "this deployment can execute nothing" - which is the distinction that keeps a
 * transient network fault from being read as a capability statement.
 */
export interface TripExecutionCapabilityFailure {
  ok: false;
  snapshot: null;
  error: ProviderSafeError;
}

/** The complete result of one capability query: a validated read, or a safe failure. */
export type TripExecutionCapabilityResult =
  | { ok: true; snapshot: TripExecutionCapabilitySnapshot }
  | TripExecutionCapabilityFailure;

/** A minimal fetch-shaped response the injected transport must produce. */
export interface TripExecutionCapabilityFetchResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** The injected HTTP transport seam (production wires `window.fetch`). */
export type TripExecutionCapabilityFetch = (
  url: string,
  init: {
    method: string;
    headers: Readonly<Record<string, string>>;
  }
) => Promise<TripExecutionCapabilityFetchResponse>;

/**
 * Everything the service needs, all injected. `tokenProvider` is the project's
 * existing authenticated-request seam: it returns the signed-in user's Firebase
 * ID token and is the only thing this module knows about authentication.
 */
export interface TripExecutionCapabilityServiceOptions {
  /** Supplies the signed-in user's Firebase ID token for the Authorization header. */
  tokenProvider: () => Promise<string>;
  /** Injected HTTP transport (deterministic and offline in tests). */
  fetchImpl: TripExecutionCapabilityFetch;
}

const VALID_STATUSES: ReadonlyArray<TripExecutionCapabilityStatus> = Object.freeze([
  'available',
  'unavailable',
  'unsupported',
]);

const VALID_REASONS: ReadonlyArray<TripExecutionCapabilityReason> = Object.freeze([
  'execution-disabled',
  'credentials-missing',
  'no-executable-capability',
  'malformed-provider-capability',
  'unexpected-failure',
]);

const VALID_PROBLEMS: ReadonlyArray<TripExecutionCapabilityProblem> = Object.freeze([
  'unsupported-method',
  'unexpected-body',
  'unexpected-failure',
]);

/** The exact root keys the STEP 68 success body may carry. */
const ROOT_KEYS: ReadonlyArray<string> = Object.freeze(['kind', 'providers', 'problem']);

/** The exact per-provider keys the STEP 68 success body may carry. */
const PROVIDER_KEYS: ReadonlyArray<string> = Object.freeze([
  'providerId',
  'status',
  'capabilityIds',
  'reason',
]);

const RESPONSE_KIND = 'server-execution-capabilities';
const AUTH_ERROR_KIND = 'server-execution-auth-error';

/**
 * Upper bound for a provider identity, matching the domain's own `MAX_PROVIDER_ID_LENGTH`
 * contract. A bounded, trimmed, non-empty string is required; anything else is
 * treated as an untrusted body rather than displayed.
 */
const MAX_PROVIDER_ID_LENGTH = 100;

/**
 * Upper bound for one capability id, and the vocabulary those ids must come from.
 *
 * The vocabulary is the STEP 20 `PROVIDER_CAPABILITY_IDS` list, restated here as
 * a client-side constant so the browser module imports no server-boundary code.
 * `tripExecutionCapabilityService.test.ts` pins this list against the real domain
 * export, so the two cannot silently drift apart.
 */
const CAPABILITY_IDS: ReadonlyArray<string> = Object.freeze([
  'search-transport',
  'retrieve-transport-details',
  'search-accommodation',
  'retrieve-accommodation-details',
  'verify-reference',
  'retrieve-booking-status',
  'retrieve-cancellation-information',
]);

const MAX_CAPABILITY_ID_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` has exactly the approved keys - no more, no fewer. */
function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) return false;
  return keys.every((key) => allowed.includes(key));
}

function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0 || value.length > MAX_PROVIDER_ID_LENGTH) return false;
  // A provider identity is a key, not an address, a URL, or a payload.
  return !/[:/?#\s]/.test(value);
}

function isCapabilityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CAPABILITY_ID_LENGTH &&
    CAPABILITY_IDS.includes(value)
  );
}

/**
 * Validates one provider entry. Returns `null` for anything that does not match
 * the contract exactly; the caller rejects the whole body rather than dropping the
 * entry, because a partially-trusted provider list is not a truthful answer.
 */
function toProviderState(value: unknown): TripExecutionCapabilityProviderState | null {
  if (!isRecord(value)) return null;
  if (!hasExactKeys(value, PROVIDER_KEYS)) return null;
  if (!isSafeProviderId(value['providerId'])) return null;

  const status = value['status'];
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as TripExecutionCapabilityStatus)) {
    return null;
  }

  const rawIds = value['capabilityIds'];
  if (!Array.isArray(rawIds)) return null;
  if (!rawIds.every((id) => isCapabilityId(id))) return null;

  const reason = value['reason'];
  if (reason !== null) {
    if (typeof reason !== 'string') return null;
    if (!VALID_REASONS.includes(reason as TripExecutionCapabilityReason)) return null;
  }

  // A capability is only ever claimed with a reason-free `available` status, and
  // a non-available status always carries one. Enforcing both directions stops a
  // body from presenting an empty capability list as unavailable for no stated
  // reason, which is exactly the inference this endpoint must not invite.
  if (status === 'available') {
    if (reason !== null) return null;
  } else if (reason === null) {
    return null;
  }

  return {
    providerId: value['providerId'],
    status: status as TripExecutionCapabilityStatus,
    capabilityIds: [...(rawIds as string[])],
    reason: reason as TripExecutionCapabilityReason | null,
  };
}

/**
 * Validates a parsed STEP 68 success body. Returns `null` when the body does not
 * conform, so the caller reports a malformed response rather than a snapshot.
 */
function toSnapshot(value: unknown): TripExecutionCapabilitySnapshot | null {
  if (!isRecord(value)) return null;
  if (value['kind'] !== RESPONSE_KIND) return null;
  if (!hasExactKeys(value, ROOT_KEYS)) return null;

  const rawProviders = value['providers'];
  if (!Array.isArray(rawProviders)) return null;

  const providers: TripExecutionCapabilityProviderState[] = [];
  for (const entry of rawProviders) {
    const state = toProviderState(entry);
    // One malformed entry invalidates the whole snapshot.
    if (state === null) return null;
    providers.push(state);
  }

  const problem = value['problem'];
  if (problem !== null) {
    if (typeof problem !== 'string') return null;
    if (!VALID_PROBLEMS.includes(problem as TripExecutionCapabilityProblem)) return null;
  }

  return { providers, problem: problem as TripExecutionCapabilityProblem | null };
}

/**
 * Builds a safe failure. `message` is a fixed client-owned string; a server
 * message is never forwarded, so no server-controlled text can reach a caller.
 */
function failure(
  category: ProviderSafeErrorCategory,
  message: string
): TripExecutionCapabilityFailure {
  return { ok: false, snapshot: null, error: { category, message } };
}

const AUTH_FAILURE_MESSAGE = 'You must be signed in to view execution capabilities.';
const NETWORK_FAILURE_MESSAGE = 'The execution capability service could not be reached.';
const MALFORMED_RESPONSE_MESSAGE =
  'The execution capability service returned an unexpected response.';
const SERVER_FAILURE_MESSAGE = 'The execution capability service could not be completed.';
const UNEXPECTED_FAILURE_MESSAGE = 'The execution capability request could not be completed.';

/**
 * The category reported for each non-2xx status the server may return. The set is
 * the STEP 68 vocabulary: 401 (auth), 400/405 (request shape), 502/503 (server
 * state), and a defensive 500.
 */
function categoryForStatus(status: number): ProviderSafeErrorCategory {
  switch (status) {
    case 401:
      return 'authentication-required';
    case 400:
    case 405:
      return 'invalid-input';
    case 502:
    case 503:
      return 'provider-unavailable';
    default:
      return 'unknown';
  }
}

function messageForCategory(category: ProviderSafeErrorCategory): string {
  switch (category) {
    case 'authentication-required':
      return AUTH_FAILURE_MESSAGE;
    case 'invalid-input':
      return 'The execution capability request was rejected by the server.';
    case 'provider-unavailable':
      return SERVER_FAILURE_MESSAGE;
    case 'network-error':
      return NETWORK_FAILURE_MESSAGE;
    case 'malformed-response':
      return MALFORMED_RESPONSE_MESSAGE;
    default:
      return UNEXPECTED_FAILURE_MESSAGE;
  }
}

/** True for a non-2xx status. A 2xx body is still validated before it is trusted. */
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * True when a body is the STEP 68 authentication error. Only the shape is
 * inspected: nothing from it is ever forwarded to the caller.
 */
function isAuthErrorBody(value: unknown): boolean {
  return isRecord(value) && value['kind'] === AUTH_ERROR_KIND;
}

/**
 * Queries the authenticated STEP 68 capability endpoint exactly once and returns
 * a validated snapshot or a safe failure.
 *
 * Performs no caching, no polling, no retry, and no storage access, and never
 * throws: a transport fault, an unreadable body, and a non-conforming body all
 * resolve to a bounded error result. The returned value never contains a token, a
 * credential, a transport detail, or a server-supplied message.
 */
export async function getTripExecutionCapabilities(
  options: TripExecutionCapabilityServiceOptions
): Promise<TripExecutionCapabilityResult> {
  let idToken: string;
  try {
    idToken = await options.tokenProvider();
  } catch {
    // A signed-out session is an authentication failure, not a crash. The token
    // is never logged, returned, or attached to the result.
    return failure('authentication-required', AUTH_FAILURE_MESSAGE);
  }

  let response: TripExecutionCapabilityFetchResponse;
  try {
    // A bare GET: no body, no query string, and no client-controlled field of any
    // kind. The endpoint is the constant, so the URL is not derivable from input.
    response = await options.fetchImpl(TRIP_EXECUTION_CAPABILITIES_ENDPOINT, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${idToken}`,
      },
    });
  } catch {
    // The raw exception is intentionally discarded: a transport error can embed
    // a URL or an internal detail, and none of it is the caller's business.
    return failure('network-error', messageForCategory('network-error'));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure('malformed-response', messageForCategory('malformed-response'));
  }

  if (!isSuccessStatus(response.status)) {
    // The server body is inspected only to recognize an authentication failure;
    // its contents are never copied into the result.
    const category = isAuthErrorBody(body) ? 'authentication-required' : categoryForStatus(response.status);
    return failure(category, messageForCategory(category));
  }

  const snapshot = toSnapshot(body);
  if (snapshot === null) {
    return failure('malformed-response', messageForCategory('malformed-response'));
  }

  return { ok: true, snapshot };
}
