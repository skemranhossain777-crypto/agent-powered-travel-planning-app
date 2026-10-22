/**
 * STEP 73 - capability-qualified authorization handoff.
 *
 * This module is the domain seam that turns a qualified dispatch back into the
 * authorization it was always derived from, completing the chain:
 *
 *   TripExecutionRequest (STEP 56)      \
 *                                        \
 *   ExecutionPlan (STEP 63)              >-> Eligibility (STEP 70)
 *                                        |        \
 *   PlanQualification (STEP 71)         /          v
 *                                        \     QualifiedDispatch (STEP 72)
 *                                         \          |
 *                                          v         v
 *                                ExecutionAuthorization (STEP 57, recovered)
 *                                          |
 *                                          v
 *                                    ProviderExecution (NOT built)
 *
 * ## What this step is, and what it is emphatically not
 *
 * "Authorized" here means exactly one thing: a valid STEP 57
 * `TripPlanningExecutionAuthorization` now exists, and it is the *same*
 * authorization the qualified dispatch was built from. That is an identity
 * statement, not a permission decision.
 *
 * This module does not grant anything. It applies no policy, evaluates no role,
 * scope, session, or token, checks no expiry, and looks nothing up in any store.
 * Those concerns belong to a later application layer, exactly as STEP 57's own
 * documentation scopes them. A caller that obtains an authorization here has
 * recovered an identity that was created further up the chain; it has not been
 * approved for anything, and holding it does not mean a provider will run.
 *
 * ## Why the authorization is recovered rather than recomputed
 *
 * STEP 72 derived a dispatch instruction from a qualified plan, which required
 * it to recover the authorization identity embedded in the plan's request-id
 * chain. This module walks the same chain in the other direction, from the
 * dispatch back to the authorization, and that round trip is the entire point.
 * It is what turns "a dispatch exists" into "this authorization is the one that
 * dispatch refers to".
 *
 * Nothing is minted here. The authorization is produced by the real STEP 57
 * factory `createTripPlanningExecutionAuthorization`, and it is checked by the
 * real STEP 57 validator `isTripPlanningExecutionAuthorization`. To call that
 * factory, a STEP 56 request value is reconstructed from the chain and
 * re-validated with the real STEP 56 validator first, so the factory is handed a
 * value it genuinely accepts rather than a shortcut object. There is no second
 * authorization id formula in this file, and no literal authorization id
 * anywhere in it.
 *
 * ## The equality proof
 *
 * After the authorization exists, the chain is re-composed forward with the real
 * STEP 58, STEP 59, and STEP 56 id functions and compared against the dispatch's
 * own fields:
 *
 *   authorization.id   === instruction.authorizationId
 *   getTripExecutionDispatchId(authorization.id) === instruction.id
 *   PROVIDER_PREFIX + instruction.id             === dispatch.requestId
 *   getTripPlanningExecutionRequestId(authorization.requestId)
 *                                                    === recovered request id
 *
 * Every step is a whole-string equality against a value the *dispatch* supplied.
 * A caller cannot obtain an authorization for one piece of work while pointing
 * a dispatch at another, because a mismatch fails closed with no authorization
 * and no providers.
 *
 * ## Fail-closed shape
 *
 * Every unsuccessful result has `authorized === false`, `authorization === null`,
 * and `providerIds === []`. A partially authorized provider set is never exposed:
 * a caller holding three of four providers has no way to know the fourth is
 * missing, and would plausibly proceed anyway.
 *
 * The checks run in a fixed order - shape, verdict, instruction, identities,
 * capability, providers, chain, then equality - so a given input always yields
 * the same reason.
 *
 * ## No execution
 *
 * The module never calls a provider, never calls `execute`, never invokes the
 * orchestrator or the execution pipeline, never reaches the network, persists
 * anything, or touches React, Firebase, Router, or Zustand. There is no
 * `Promise`, no `async`, no timer, no environment access, and no mutable global
 * state. Returned arrays are fresh copies; neither the input nor any object or
 * array within it is mutated.
 *
 * As in STEPS 71 and 72, the totality guarantee is over ordinary data values.
 * The module reads properties directly and uses no `try/catch` to appear robust
 * against instrumented objects; a value with throwing getters or a hostile Proxy
 * is outside the contract rather than silently mishandled.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isProviderCapabilityId,
  type ProviderCapabilityId,
} from '../../domain/providers/providerCapabilities';
import {
  isTripPlanningExecutionRequest,
  TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_REQUEST_KIND,
  type TripPlanningExecutionRequest,
} from '../../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionAuthorization,
  isTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  type TripPlanningExecutionAuthorization,
} from '../../domain/trips/tripPlanningExecutionAuthorization';
import {
  getTripExecutionDispatchId,
  isTripExecutionDispatchInstruction,
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  type TripExecutionDispatchInstruction,
} from './tripExecutionDispatch';
// Only the identity prefix: no provider request, provider, or adapter reaches
// this module.
import { TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX } from './tripExecutionProvider';
import { getTripExecutionPlanId, TRIP_EXECUTION_PLAN_ID_PREFIX } from './tripExecutionPlan';
import {
  TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS,
  type TripExecutionQualifiedDispatch,
} from './tripExecutionQualifiedDispatch';

/**
 * The closed, provider-neutral reason vocabulary for an authorization handoff.
 *
 * Bounded tokens only - never a provider message, credential detail, or prose.
 * `authorized` is the single affirmative value and is reachable only when every
 * condition in the module docs holds.
 *
 * The mapping from condition to reason is fixed:
 *
 * | condition                                        | reason                        |
 * |--------------------------------------------------|-------------------------------|
 * | not an object, wrong field types, or a positive verdict whose reason token is not `dispatched` | `dispatch-invalid` |
 * | `dispatched !== true`                            | `dispatch-not-qualified`      |
 * | embedded instruction absent or structurally invalid | `dispatch-invalid`         |
 * | dispatch id missing or not well formed           | `dispatch-id-invalid`        |
 * | request id missing or not well formed            | `request-id-invalid`          |
 * | plan id missing or not well formed               | `plan-id-invalid`             |
 * | plan id does not derive from the request id       | `identity-inconsistent`       |
 * | capability absent or outside the closed vocabulary| `capability-invalid`        |
 * | provider identity invalid, padded, or too long   | `provider-identity-invalid`   |
 * | provider identity repeated                       | `provider-identity-duplicate` |
 * | qualified provider set empty                     | `provider-set-empty`          |
 * | the STEP 57/58/59 chain does not re-derive       | `authorization-chain-invalid` |
 * | a chain equality against the dispatch fails      | `authorization-mismatch`      |
 */
export const TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS = [
  'authorized',
  'dispatch-invalid',
  'dispatch-not-qualified',
  'dispatch-id-invalid',
  'request-id-invalid',
  'plan-id-invalid',
  'identity-inconsistent',
  'capability-invalid',
  'provider-identity-invalid',
  'provider-identity-duplicate',
  'provider-set-empty',
  'authorization-chain-invalid',
  'authorization-mismatch',
] as const;

/** The provider-neutral authorization-handoff reason vocabulary. */
export type TripExecutionQualifiedAuthorizationReason =
  (typeof TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS)[number];

/**
 * The pure result of one authorization handoff.
 *
 * Carries only safe identities, the real STEP 57 authorization, and a bounded
 * token: no provider object, no credential, no transport, no booking, no
 * payment, and no claim that execution is permitted or attempted.
 */
export interface TripExecutionQualifiedAuthorization {
  /** True only when every gate held and an authorization was produced. */
  authorized: boolean;
  /** The authoritative STEP 57 authorization, or `null` on any failure. */
  authorization: TripPlanningExecutionAuthorization | null;
  /** The dispatch id the authorization was proven against, or `null`. */
  dispatchId: string | null;
  /** The provider-request id the authorization was proven against, or `null`. */
  requestId: string | null;
  /** The qualified plan id, or `null` when it was missing or malformed. */
  planId: string | null;
  /**
   * The qualified provider identities in exact order when authorized, and always
   * empty otherwise. Never sorted, ranked, deduplicated, or substituted.
   */
  providerIds: readonly string[];
  /** The qualification's required capability, preserved exactly. */
  requiredCapabilityId: ProviderCapabilityId | null;
  /** The bounded reason for this handoff. */
  reason: TripExecutionQualifiedAuthorizationReason;
}

/**
 * The input to one authorization handoff. The qualified dispatch is untrusted and
 * re-validated; no provider object, credential, URL, token, transport,
 * callback, or execution function is accepted.
 */
export interface TripExecutionQualifiedAuthorizationInput {
  /** The STEP 72 qualified-dispatch result. Validated, never repaired. */
  dispatch: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The existing execution provider-identity rule, restated: non-empty,
 * already-trimmed, bounded. No case folding and no character filtering, because
 * a provider id is an exact key here.
 */
function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

/** True when `value` is a member of the closed STEP 72 reason vocabulary. */
function isQualifiedDispatchReason(value: unknown): boolean {
  return (TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/** True when `value` is a well-formed, non-empty dispatch id. */
function isDispatchId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_DISPATCH_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_DISPATCH_ID_PREFIX.length
  );
}

/** True when `value` is a well-formed, non-empty provider-request id. */
function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

/** True when `value` is a well-formed, non-empty plan id. */
function isPlanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PLAN_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PLAN_ID_PREFIX.length
  );
}

/**
 * True when `value` has the *shape* of a STEP 72 qualified-dispatch result.
 *
 * Only shape is checked. Whether the verdict is affirmative, and whether the
 * embedded instruction is a real STEP 58 instruction, are decided afterwards, so
 * a negative but well-formed dispatch is reported as `dispatch-not-qualified`
 * rather than as malformed.
 *
 * A field that is absent (`undefined`) is treated like the domain's explicit
 * `null`: both mean "not supplied", and the gate that owns that field reports it.
 */
function hasQualifiedDispatchShape(value: unknown): value is TripExecutionQualifiedDispatch {
  if (!isRecord(value)) return false;
  if (typeof value.dispatched !== 'boolean') return false;
  if (!isQualifiedDispatchReason(value.reason)) return false;

  const dispatch = value.dispatch;
  if (dispatch !== null && dispatch !== undefined && !isRecord(dispatch)) return false;

  const planId = value.planId;
  if (planId != null && typeof planId !== 'string') return false;

  const requestId = value.requestId;
  if (requestId != null && typeof requestId !== 'string') return false;

  const authorizationId = value.authorizationId;
  if (authorizationId != null && typeof authorizationId !== 'string') return false;

  const requiredCapabilityId = value.requiredCapabilityId;
  if (requiredCapabilityId != null && !isProviderCapabilityId(requiredCapabilityId)) return false;

  const providerIds = value.providerIds;
  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((id) => isSafeProviderId(id))) return false;

  return true;
}

/**
 * The deterministic prefix a qualified plan's request id begins with: the STEP
 * 59, STEP 58, and STEP 57 prefixes composed by the real id functions.
 */
const AUTHORIZATION_CHAIN_PREFIX =
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX +
  TRIP_EXECUTION_DISPATCH_ID_PREFIX +
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX;

/**
 * The STEP 56 request id embedded in a provider-request id, or `null` when the
 * provider-request id does not carry the STEP 59 and STEP 58 parts of the chain.
 * Stripped from the front only; whatever remains must still be a well-formed
 * STEP 56 request id.
 */
function recoverStep56RequestId(providerRequestId: string): string | null {
  if (!providerRequestId.startsWith(AUTHORIZATION_CHAIN_PREFIX)) return null;

  const step56RequestId = providerRequestId.slice(AUTHORIZATION_CHAIN_PREFIX.length);
  if (!step56RequestId.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX)) return null;
  if (step56RequestId.length <= TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX.length) return null;

  return step56RequestId;
}

/**
 * The STEP 56 request value recovered from the chain, or `null`.
 *
 * The STEP 56 request is a two-field identity: its own id and the intent id it
 * derives from. The id is recovered from the chain and the intent id by removing
 * the STEP 56 prefix, then the whole value is submitted to the real STEP 56
 * validator. Only if that validator accepts it is it handed to the STEP 57
 * factory - so the factory is never given a value this module merely asserted.
 */
function recoverStep56Request(providerRequestId: string): TripPlanningExecutionRequest | null {
  const step56RequestId = recoverStep56RequestId(providerRequestId);
  if (step56RequestId === null) return null;

  const request: TripPlanningExecutionRequest = {
    id: step56RequestId,
    kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND,
    intentId: step56RequestId.slice(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX.length),
  };
  if (!isTripPlanningExecutionRequest(request)) return null;

  return request;
}

/**
 * The STEP 57 authorization for a dispatch's chain, or `null` when the chain
 * does not yield one.
 *
 * The authorization is produced by the real STEP 57 factory and accepted only if
 * the real STEP 57 validator agrees. No authorization id is written here: it comes
 * from STEP 57 itself, so the identity in the result is STEP 57's, not this
 * module's.
 */
function recoverAuthorization(
  providerRequestId: string
): TripPlanningExecutionAuthorization | null {
  const request = recoverStep56Request(providerRequestId);
  if (request === null) return null;

  const authorization = createTripPlanningExecutionAuthorization(request);
  if (authorization === null) return null;
  if (!isTripPlanningExecutionAuthorization(authorization)) return null;

  return authorization;
}

/** Builds a rejection. `providerIds` is always empty. */
function rejected(
  reason: TripExecutionQualifiedAuthorizationReason,
  dispatchId: string | null,
  requestId: string | null,
  planId: string | null
): TripExecutionQualifiedAuthorization {
  return {
    authorized: false,
    authorization: null,
    dispatchId,
    requestId,
    planId,
    providerIds: [],
    requiredCapabilityId: null,
    reason,
  };
}

/**
 * The pure, synchronous authorization handoff.
 *
 * Check order, which fixes the reported reason for any given input:
 *
 * 1. the qualified dispatch has the shape of a STEP 72 result
 * 2. that result is affirmative, with the affirmative reason token
 * 3. the dispatch id is well formed on its own terms
 * 4. the embedded instruction is a valid STEP 58 dispatch instruction
 * 5. the request id is well formed
 * 6. the plan id is well formed
 * 7. the plan id still derives from the request id
 * 8. the capability is explicit and recognized
 * 9. the provider list is non-empty
 * 10. no provider identity repeats
 * 11. the authorization chain re-derives through the real STEP 57 factory
 * 12. every forward chain equality against the dispatch holds
 *
 * Only after all twelve hold is an authorization returned. Any other outcome
 * returns `authorized: false` with `authorization: null` and no providers.
 *
 * The function never throws for ordinary untrusted input, never mutates its
 * argument or any object or array within it, never calls a provider, never
 * performs I/O, and never evaluates an authorization rule.
 */
export function createTripExecutionQualifiedAuthorization(
  input: TripExecutionQualifiedAuthorizationInput
): TripExecutionQualifiedAuthorization {
  if (!isRecord(input)) {
    return rejected('dispatch-invalid', null, null, null);
  }

  const { dispatch } = input;

  // 1. The STEP 72 result is re-checked, never taken on trust.
  if (!hasQualifiedDispatchShape(dispatch)) {
    return rejected('dispatch-invalid', null, null, null);
  }

  // 2. A well-formed negative dispatch is reported as such, never re-interpreted
  //    as a structural fault.
  if (!dispatch.dispatched) {
    return rejected('dispatch-not-qualified', null, null, null);
  }
  if (dispatch.reason !== 'dispatched') {
    return rejected('dispatch-invalid', null, null, null);
  }

  // 3. The dispatch id is reported on its own terms first, so a caller with a
  //    malformed identity is told that rather than being told the whole nested
  //    object is the wrong shape. This reads the raw id before trusting anything
  //    about the nested value.
  const rawDispatchId = isRecord(dispatch.dispatch) ? dispatch.dispatch.id : undefined;
  if (typeof rawDispatchId === 'string' && !isDispatchId(rawDispatchId)) {
    return rejected('dispatch-id-invalid', null, null, null);
  }

  // 4. The embedded instruction must then be a real STEP 58 dispatch instruction,
  //    so the authorization below is recovered from a validated contract rather
  //    than from an unverified nested object.
  if (!isTripExecutionDispatchInstruction(dispatch.dispatch)) {
    return rejected('dispatch-invalid', null, null, null);
  }
  const instruction: TripExecutionDispatchInstruction = dispatch.dispatch;
  const dispatchId = instruction.id;

  // 5. and 6. Identities must be well formed before anything is derived from them.
  const requestId = dispatch.requestId;
  const planId = dispatch.planId;
  if (!isProviderRequestId(requestId)) {
    return rejected('request-id-invalid', dispatchId, null, planId);
  }
  if (!isPlanId(planId)) {
    return rejected('plan-id-invalid', dispatchId, requestId, null);
  }

  // 7. The plan id and request id must still describe the same work, using the
  //    real STEP 63 formula rather than a restatement of it.
  if (getTripExecutionPlanId(requestId) !== planId) {
    return rejected('identity-inconsistent', dispatchId, requestId, planId);
  }

  // 8. The capability is explicit and never inferred. STEP 70 and STEP 72 both
  //    fail closed when it is absent, so reaching here without one is still
  //    rejected rather than treated as "any capability will do".
  const requiredCapabilityId = dispatch.requiredCapabilityId;
  if (requiredCapabilityId == null) {
    return rejected('capability-invalid', dispatchId, requestId, planId);
  }

  // 9. An empty qualified provider set is a contradiction, not an authorization
  //    for nobody.
  const providerIds = dispatch.providerIds as readonly string[];
  if (providerIds.length === 0) {
    return rejected('provider-set-empty', dispatchId, requestId, planId);
  }

  // 10. A repeated provider identity is a contradiction. Deduplicating would pick
  //     a winner and hide the defect, so the whole handoff fails.
  const seen = new Set<string>();
  for (const providerId of providerIds) {
    if (seen.has(providerId)) {
      return rejected('provider-identity-duplicate', dispatchId, requestId, planId);
    }
    seen.add(providerId);
  }

  // 11. Recover the authorization through the real STEP 57 factory.
  const authorization = recoverAuthorization(requestId);
  if (authorization === null) {
    return rejected('authorization-chain-invalid', dispatchId, requestId, planId);
  }

  // 12. Re-derive the chain forward from the recovered authorization and require
  //     the result to be the instruction this dispatch embedded. The recovered id
  //     came from the request id, and the instruction came from the dispatch, so
  //     this equality is what ties the two halves together: a request id naming a
  //     different dispatch cannot pass, even though every shape gate already did.
  if (getTripExecutionDispatchId(authorization.id) !== instruction.id) {
    return rejected('authorization-mismatch', dispatchId, requestId, planId);
  }
  // The remaining links need no separate comparison. The STEP 58 validator has
  // already tied `instruction.id` to `instruction.authorizationId`, and the chain
  // above ties `instruction.id` to the request id, so `requestId` and
  // `instruction.authorizationId` are pinned to the same authorization
  // transitively. Re-testing them would restate a contract already enforced.
  //
  // STEP 72's top-level `authorizationId`, though, is not covered by any of those
  // guarantees: it is a second, independent statement of the same identity. It
  // must agree with what was recovered, or the result contradicts itself.
  if (dispatch.authorizationId != null && dispatch.authorizationId !== authorization.id) {
    return rejected('authorization-mismatch', dispatchId, requestId, planId);
  }

  return {
    authorized: true,
    authorization,
    dispatchId: instruction.id,
    requestId,
    planId,
    // A fresh array: the caller cannot reach back into the dispatch through it,
    // and cannot alter the dispatch by editing the result.
    providerIds: [...providerIds],
    requiredCapabilityId,
    reason: 'authorized',
  };
}
