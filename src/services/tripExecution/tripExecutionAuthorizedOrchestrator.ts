/**
 * STEP 76 - authorized multi-provider execution orchestration.
 *
 * This module composes the STEP 75 single-provider execution boundary across the
 * exact provider set the chain already qualified, completing the chain:
 *
 *   AuthorizedRequest (STEP 74, provider request built)
 *        |
 *        v
 *   AuthorizedOrchestration (this module)
 *        |
 *        +--> executeTripExecutionAuthorizedRequest (STEP 75) --> provider A
 *        +--> executeTripExecutionAuthorizedRequest (STEP 75) --> provider B
 *        +--> executeTripExecutionAuthorizedRequest (STEP 75) --> provider C
 *        |
 *        v
 *   ordered list of STEP 75 results, one per authorized provider
 *
 * ## The one execution path
 *
 * There is exactly one way a provider is reached from here: the STEP 75 function.
 * This module contains no `provider.execute(` call of its own, and the dependency
 * test proves the call site count is zero in this file and one in STEP 75. The
 * topology is therefore fixed:
 *
 *   STEP 74 -> STEP 76 -> STEP 75 -> STEP 59 provider.execute()
 *
 * This matters beyond tidiness. STEP 75 is the authorization boundary: it
 * re-proves the request, the provider contract, and the qualified-set membership
 * before it will call anything. Bypassing it would mean dispatching into a
 * provider on the strength of a check this module performed itself, and a check
 * performed once is not a check performed per execution.
 *
 * ## This is orchestration, not selection
 *
 * The provider set is not chosen here. It arrives on the STEP 74 result as
 * `providerIds`, carried unchanged from the STEP 72 qualified dispatch, and that
 * set and its order are authoritative. This module can only *refuse* a supplied
 * collection that is not exactly that set in exactly that order. It never
 * discovers providers, never ranks them, never picks a winner, never substitutes
 * one, and never falls back to a provider the chain did not qualify. A provider
 * that fails is recorded as a failure; the next authorized provider still runs.
 *
 * ## Preflight is all-or-nothing
 *
 * Every check happens before the first provider is touched. A malformed request,
 * a non-affirmative verdict, or a supplied collection that is missing, extra,
 * duplicated, misidentified, or out of order produces zero invocations - not a
 * partial run. This is deliberately *not* best-effort behaviour: a partially
 * executed provider set has already caused effects that cannot be undone, and
 * reporting it as an orchestration success would be dishonest.
 *
 * Once preflight passes, each provider is attempted exactly once, in order. A
 * failure anywhere in the sequence is contained and does not skip the rest.
 *
 * ## Order is authoritative and therefore never negotiated
 *
 * The supplied collection must already be in the STEP 74 order. Because preflight
 * proves element-wise equality of the two id lists, "resolve the supplied objects
 * against the authorized ids" is completed by that comparison: the supplied array
 * is already the authorized execution sequence, so it is used in place. There is
 * no reordering step, no sort, and no lookup table that could reorder by accident.
 *
 * ## `executed` has one honest meaning
 *
 * `executed === false` if and only if no provider was invoked, which is if and
 * only if `results` is empty. So the three facts move together and can be checked
 * against each other:
 *
 *     executed === false  <=>  results.length === 0  <=>  zero providers invoked
 *
 * A preflight failure is the only way to get it. A provider that throws is
 * therefore *not* an orchestration failure: the orchestration ran, `results` holds
 * the honest STEP 75 failure for that provider, and the rest still ran.
 *
 * ## Statuses are not reinterpreted
 *
 * The per-provider results are the STEP 75 results, unmodified and by reference.
 * `accepted` still means only that a provider accepted the request; nothing here
 * claims a booking, payment, reservation, or ticket. The aggregate `status` reuses
 * the existing STEP 59 vocabulary through the existing STEP 61 pure helper
 * `getTripExecutionAggregateStatus`; no new aggregate enum is declared, and
 * `status: null` means "no provider answered, so no aggregate exists" rather than
 * naming a fifth status.
 *
 * ## No execution of its own
 *
 * This module reaches no network, holds no credential, reads no configuration,
 * starts no timer, and persists nothing. It does not call STEP 61's
 * `orchestrateTripExecution` - that path would execute providers directly and
 * bypass STEP 75 - and it does not call the STEP 65 pipeline. The only thing it
 * reuses from STEP 61 is a pure status calculation over results it already has.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from './tripExecutionProvider';
import { TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS } from './tripExecutionAuthorizedRequest';
import {
  executeTripExecutionAuthorizedRequest,
  type TripExecutionAuthorizedExecutionResult,
} from './tripExecutionAuthorizedExecution';
import { getTripExecutionAggregateStatus } from './tripExecutionOrchestrator';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The existing execution provider-identity rule: non-empty, already-trimmed,
 * bounded. Read from the same bound STEP 59's own identity rule uses, so this
 * module has no second notion of a legal provider id. No case folding, no
 * character filtering, no normalization: a provider id is an exact key.
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
 * own type, so each gate can report one specific reason rather than a blanket
 * "invalid". The plan, dispatch, authorization, and capability fields are
 * deliberately absent: they are STEP 74's to have validated and nothing here
 * has a use for them.
 */
interface AuthorizedRequestShape {
  accepted: boolean;
  reason: (typeof TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS)[number];
  providerRequest: Record<string, unknown> | null;
  requestId: string | null;
  providerIds: readonly string[];
}

/** True when `value` is a member of the closed STEP 74 reason vocabulary. */
function isStep74Reason(value: unknown): boolean {
  return (TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/**
 * True when `value` has the *shape* of a STEP 74 authorized-request result. Only
 * shape: whether the verdict is affirmative, whether the embedded provider request
 * is real, and whether the qualified set is consistent are decided afterwards, so
 * a well-formed negative result is reported as such rather than as malformed. A
 * field that is absent (`undefined`) is treated like the domain's explicit `null`:
 * both mean "not supplied", and the gate owning that field reports it.
 */
function hasAuthorizedRequestShape(value: unknown): value is AuthorizedRequestShape {
  if (!isRecord(value)) return false;
  if (typeof value.accepted !== 'boolean') return false;
  if (!isStep74Reason(value.reason)) return false;

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

/**
 * The closed, provider-neutral reason vocabulary for one orchestration.
 *
 * Bounded tokens only - never a provider message, credential detail, URL, or
 * exception text. `orchestrated` is the single affirmative value and is reachable
 * only when preflight passed and every authorized provider was attempted.
 *
 * | condition                                                        | reason                          |
 * |------------------------------------------------------------------|---------------------------------|
 * | input/result not an object, or a wrong field type                 | `request-invalid`               |
 * | `accepted !== true`                                               | `request-not-accepted`          |
 * | affirmative verdict with a non-affirmative reason token           | `request-invalid`               |
 * | embedded value refused by the STEP 59 request validator           | `request-invalid`               |
 * | the result's own `requestId` disagrees with the embedded request  | `request-identity-invalid`      |
 * | an affirmative result carrying no qualified providers             | `provider-set-empty`            |
 * | `providers` not an array, or an element is not a provider         | `provider-collection-invalid`   |
 * | a supplied provider's identity is not a legal identity            | `provider-identity-invalid`     |
 * | the same identity supplied more than once                         | `provider-duplicate`            |
 * | a supplied identity is not in the qualified set                   | `provider-identity-mismatch`    |
 * | an authorized identity has no supplied provider                   | `provider-missing`              |
 * | the supplied order is not the authoritative order                 | `provider-order-mismatch`       |
 *
 * An extra provider, an alias, a substitution, and a case or whitespace variant
 * are all one fault - a supplied identity the chain did not qualify - and are all
 * reported as `provider-identity-mismatch`. A *padded* identity is not a
 * well-formed identity at all, so it is reported one step earlier as
 * `provider-identity-invalid`. The two are distinct operational mistakes, so they
 * get distinct reasons.
 */
export const TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS = [
  'orchestrated',
  'request-invalid',
  'request-not-accepted',
  'request-identity-invalid',
  'provider-set-empty',
  'provider-collection-invalid',
  'provider-identity-invalid',
  'provider-duplicate',
  'provider-identity-mismatch',
  'provider-missing',
  'provider-order-mismatch',
] as const;

/** The provider-neutral orchestration reason vocabulary. */
export type TripExecutionAuthorizedOrchestrationReason =
  (typeof TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS)[number];

/**
 * The ordered outcome of one authorized orchestration.
 *
 * `results` holds the STEP 75 results unmodified and in provider order, one per
 * authorized provider, and is empty exactly when no provider was invoked.
 */
export interface TripExecutionAuthorizedOrchestrationResult {
  /** True only when preflight passed and every authorized provider was attempted. */
  executed: boolean;
  /** The provider-request id, or `null` when preflight never established one. */
  requestId: string | null;
  /**
   * The authorized provider ids in authoritative order. Empty on any preflight
   * failure, so a caller that sees no ids also knows nothing ran.
   */
  providerIds: string[];
  /** One STEP 75 result per authorized provider, in the same order. */
  results: TripExecutionAuthorizedExecutionResult[];
  /**
   * The STEP 61 aggregate of the provider statuses that actually exist, or
   * `null` when no provider answered. Never a fifth status: `null` means there is
   * no aggregate to report because the list is empty.
   */
  status: TripExecutionProviderResultStatus | null;
  /** The bounded reason for this orchestration. */
  reason: TripExecutionAuthorizedOrchestrationReason;
}

/**
 * The input to one orchestration. Both members are untrusted and re-validated; no
 * URL, credential, HTTP client, Firebase object, React object, or router/store
 * object is accepted. The providers are supplied - never discovered, built, or
 * resolved from a registry here.
 */
export interface TripExecutionAuthorizedOrchestrationInput {
  /** The STEP 74 authorized-request result. Validated, never repaired. */
  request: unknown;
  /** The authorized provider objects, in the STEP 74 order. */
  providers: unknown;
}

/**
 * Builds a preflight failure. Every one of these has `executed === false`, an
 * empty `results` list, and no aggregate - the three facts that together mean
 * zero providers were invoked.
 */
function preflightFailed(
  reason: TripExecutionAuthorizedOrchestrationReason,
  requestId: string | null
): TripExecutionAuthorizedOrchestrationResult {
  return {
    executed: false,
    requestId,
    providerIds: [],
    results: [],
    status: null,
    reason,
  };
}

/**
 * Collects the provider statuses that genuinely exist, so the aggregate is
 * computed from real provider results only. A STEP 75 boundary failure carries
 * `result: null` because no provider answered, and inventing a status for it would
 * fabricate a provider result - and would also hide the boundary failure, which
 * stays visible in `results` regardless.
 */
function collectProviderResults(
  results: ReadonlyArray<TripExecutionAuthorizedExecutionResult>
): TripExecutionProviderResult[] {
  const collected: TripExecutionProviderResult[] = [];
  for (const entry of results) {
    if (entry.result !== null) {
      collected.push(entry.result);
    }
  }
  return collected;
}

/**
 * Composes the STEP 75 boundary across the authorized provider set, in the
 * authorized order, after a complete preflight.
 *
 * Check order, which fixes the reported reason for any given input:
 *
 * 1. the input is an object and the request has the shape of a STEP 74 result
 * 2. that result is affirmative, with the affirmative reason token
 * 3. the embedded value is a real STEP 59 provider request
 * 4. the result's own `requestId` agrees with that provider request
 * 5. the qualified set is non-empty
 * 6. `providers` is an array of STEP 59 providers with legal identities
 * 7. no identity appears twice
 * 8. every supplied identity is qualified, and every qualified identity supplied
 * 9. the supplied order is the authoritative order
 *
 * Steps 1 to 9 invoke nothing. Only then is the set run, once each, in order,
 * through the STEP 75 boundary. Because step 9 proved the two id lists equal
 * element-wise, the supplied array is already the authorized execution sequence.
 */
export async function orchestrateTripExecutionAuthorizedRequest(
  input: TripExecutionAuthorizedOrchestrationInput
): Promise<TripExecutionAuthorizedOrchestrationResult> {
  if (!isRecord(input)) {
    return preflightFailed('request-invalid', null);
  }

  const { request, providers } = input;

  // 1. The STEP 74 result is re-checked, never taken on trust.
  if (!hasAuthorizedRequestShape(request)) {
    return preflightFailed('request-invalid', null);
  }

  // 2. A well-formed negative result is reported as such, never re-interpreted
  //    as a structural fault.
  if (!request.accepted) {
    return preflightFailed('request-not-accepted', null);
  }
  if (request.reason !== 'accepted') {
    return preflightFailed('request-invalid', null);
  }

  // 3. The embedded value must be a real STEP 59 provider request, so what is
  //    dispatched is a value the provider contract genuinely accepts.
  if (!isTripExecutionProviderRequest(request.providerRequest)) {
    return preflightFailed('request-invalid', null);
  }
  const providerRequest: TripExecutionProviderRequest = request.providerRequest;

  // 4. The result states the request id a second time, independently of the
  //    embedded request. A hand-built result need not honour that, so the
  //    agreement is checked rather than assumed.
  const requestId = request.requestId;
  if (!isProviderRequestId(requestId) || requestId !== providerRequest.id) {
    return preflightFailed('request-identity-invalid', null);
  }

  // 5. The authorized set. STEP 74 itself refuses an empty qualified set - it has
  //    a `provider-set-empty` reason for exactly that - so an affirmative result
  //    carrying no providers is a contradiction, and a contradiction is never
  //    turned into a successful empty execution. Zero providers are invoked.
  const authorizedIds = request.providerIds;
  if (authorizedIds.length === 0) {
    return preflightFailed('provider-set-empty', requestId);
  }

  // 6. The collection. A provider id in place of a provider object, a bare
  //    callback, and an object with no `execute` are all refused here, before any
  //    identity comparison and long before any execution.
  if (!Array.isArray(providers)) {
    return preflightFailed('provider-collection-invalid', requestId);
  }
  if (providers.length === 0) {
    return preflightFailed('provider-collection-invalid', requestId);
  }
  const supplied: TripExecutionProvider[] = [];
  for (const candidate of providers) {
    if (!isRecord(candidate)) {
      return preflightFailed('provider-collection-invalid', requestId);
    }
    if (!isSafeProviderId(candidate.providerId)) {
      return preflightFailed('provider-identity-invalid', requestId);
    }
    if (typeof candidate.execute !== 'function') {
      return preflightFailed('provider-collection-invalid', requestId);
    }
    // The supplied object itself is kept, by reference. No clone, no wrapper, no
    // substitute: STEP 75 receives the very value that was handed in.
    supplied.push(candidate as unknown as TripExecutionProvider);
  }

  // 7. A repeated identity would make "exactly one object per authorized id"
  //    ambiguous, so it fails rather than being deduplicated away.
  const suppliedIds: string[] = [];
  for (const provider of supplied) {
    const providerId = provider.providerId;
    if (suppliedIds.includes(providerId)) {
      return preflightFailed('provider-duplicate', requestId);
    }
    suppliedIds.push(providerId);
  }

  // 8. Set equality, checked from both sides so each mistake is named precisely.
  //    An unauthorized identity - an extra provider, an alias, a substitution, a
  //    case variant - is reported before a missing one, because it is the more
  //    specific claim about what was supplied.
  for (const providerId of suppliedIds) {
    if (!authorizedIds.includes(providerId)) {
      return preflightFailed('provider-identity-mismatch', requestId);
    }
  }
  for (const providerId of authorizedIds) {
    if (!suppliedIds.includes(providerId)) {
      return preflightFailed('provider-missing', requestId);
    }
  }

  // 9. The authoritative order. Refused rather than repaired: quietly reordering a
  //    caller's collection would hide that the set did not arrive as authorized,
  //    and the execution trace is only deterministic if the order is fixed.
  for (let index = 0; index < authorizedIds.length; index += 1) {
    if (suppliedIds[index] !== authorizedIds[index]) {
      return preflightFailed('provider-order-mismatch', requestId);
    }
  }

  // Preflight is complete. Every authorized provider is now attempted exactly
  // once, sequentially and in the authorized order. There is no concurrency, so
  // the trace is deterministic; no retry, so a failure is not repeated; and no
  // substitution, so a provider that fails is not replaced by one that was never
  // authorized. A failed provider does not stop the rest: its STEP 75 failure is
  // recorded and the sequence continues.
  const results: TripExecutionAuthorizedExecutionResult[] = [];
  for (const provider of supplied) {
    const executionResult = await executeTripExecutionAuthorizedRequest({
      request,
      provider,
    });
    results.push(executionResult);
  }
  const providerResults = collectProviderResults(results);

  return {
    executed: true,
    requestId,
    // The authorized order, copied so the caller's value cannot be observed to
    // change afterwards.
    providerIds: [...authorizedIds],
    results,
    // The existing STEP 61 pure calculation, over the statuses that genuinely
    // exist. No new enum, and no call into STEP 61's execution path. When no
    // provider answered there is no aggregate to report, and `null` says that
    // plainly - calling the helper on an empty list would yield `unsupported`,
    // which would falsely imply a provider had declared the work unsupported.
    status:
      providerResults.length === 0
        ? null
        : getTripExecutionAggregateStatus(providerResults),
    reason: 'orchestrated',
  };
}
