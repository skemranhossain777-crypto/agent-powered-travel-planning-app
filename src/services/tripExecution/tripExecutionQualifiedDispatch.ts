/**
 * STEP 72 - capability-qualified execution dispatch.
 *
 * This module is the boundary that lets a *qualified* plan cross into the
 * existing STEP 58 dispatch model, and it is the first point in the chain where
 * a dispatch instruction can be produced without the caller supplying an
 * authorization object of its own:
 *
 *   TripExecutionRequest (STEP 56)      \
 *                                        \
 *   ExecutionPlan (STEP 63)              >-> Qualification (STEP 71)
 *                                        |            \
 *   Eligibility (STEP 70)               /              v
 *                                             QualifiedDispatch (this module)
 *                                                      |
 *                                                      v
 *                                          DispatchInstruction (STEP 58)
 *
 * It introduces no new dispatch contract. The instruction this module produces
 * is the *existing* `TripExecutionDispatchInstruction`, built by the *existing*
 * `createTripExecutionDispatchInstruction` factory, with the *existing* STEP 58
 * id formula untouched. Nothing here widens what a dispatch instruction means:
 * a dispatch instruction still means only that work has reached the dispatch
 * seam, never that a provider was called, that inventory was held, that a
 * booking exists, or that any payment was made.
 *
 * ## The qualification gate
 *
 * Exactly one input value is trusted-but-rechecked: the STEP 71 qualification
 * result. It is re-validated here rather than accepted on its word, because a
 * caller may have assembled, serialized, or persisted it elsewhere, and a
 * dispatch instruction is a much stronger statement than a qualification. Every
 * condition in STEP 71 is therefore re-established from the value's own fields:
 * the affirmative verdict, the affirmative reason token, a well-formed plan id,
 * a well-formed provider-request id, an explicit recognized capability, a
 * non-empty provider list, and no repeated provider identity.
 *
 * The checks run in a fixed order, so a given input always yields the same
 * reason. A failure never produces a dispatch instruction and never exposes a
 * partial provider list - a caller holding three of four providers has no way to
 * know the fourth is missing, and would plausibly dispatch anyway.
 *
 * ## Authorization: recovered, never invented
 *
 * STEP 58 instructions are keyed by an authorization id, and a caller of this
 * module supplies only a qualification. That is not a gap in the domain, it is a
 * consequence of the domain's own id design: every identity in this chain is a
 * deterministic prefix concatenation of the one before it, so the authorization
 * identity is already *present* inside a qualified plan's request id:
 *
 *   step56 request id
 *     -> authorization id   (trip-planning-execution-authorization:<requestId>)
 *     -> dispatch id        (trip-execution-dispatch:<authorizationId>)
 *     -> provider-request id(trip-execution-provider-request:<dispatchId>)
 *                            ^ this is qualification.requestId
 *
 * This module recovers the STEP 56 request id by stripping those already-exported
 * prefixes, re-derives the authorization id with the real STEP 57 function
 * `getTripPlanningExecutionAuthorizationId`, re-builds the authorization value,
 * and then submits it to the real STEP 57 validator and the real STEP 58 factory.
 * No authorization formula is written here, no authorization value is minted, and
 * no authorization rule is applied: the recovered id is the only one that can
 * have produced this plan.
 *
 * That claim is enforced, not assumed. After the factory returns, the module
 * re-derives the provider-request id from the resulting instruction and requires
 * whole-string equality with the qualification's own request id. If the recovered
 * authorization were anything other than the one the plan was built from, that
 * check fails and no dispatch is produced. A caller cannot smuggle a different
 * authorization through a look-alike chain.
 *
 * ## What this module does NOT do
 *
 * Recovering an authorization identity is not an authorization decision. This
 * module performs no policy evaluation, no session, account, or role check, no
 * validity window, and no existence check against any store - exactly as STEP 57
 * itself scopes those to "a later application or service layer". Creating a
 * dispatch instruction is not execution. Nothing here calls a provider, calls
 * `execute`, invokes the orchestrator or the execution pipeline, reaches the
 * network, persists anything, or touches React, Firebase, Router, or Zustand.
 * There is no `Promise`, no `async`, no timer, no environment access, and no
 * mutable global state, so the module is safe in a browser, a test, or a
 * function. Returned arrays are fresh copies and neither input object nor any
 * array within it is mutated.
 *
 * As in STEP 71, the totality guarantee is over ordinary data values. The module
 * reads properties directly and deliberately uses no `try/catch` to appear
 * robust; a value instrumented with throwing getters or Proxies is outside the
 * contract rather than silently mishandled.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isProviderCapabilityId,
  type ProviderCapabilityId,
} from '../../domain/providers/providerCapabilities';
import { TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX } from '../../domain/trips/tripPlanningExecutionRequest';
import {
  getTripPlanningExecutionAuthorizationId,
  isTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
  type TripPlanningExecutionAuthorization,
} from '../../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripExecutionDispatchInstruction,
  isTripExecutionDispatchInstruction,
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  type TripExecutionDispatchInstruction,
} from './tripExecutionDispatch';
// Only the identity prefix and id function: the provider contract's runtime
// shape, and any adapter, stay out of this module entirely.
import { TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX } from './tripExecutionProvider';
import { getTripExecutionPlanId, TRIP_EXECUTION_PLAN_ID_PREFIX } from './tripExecutionPlan';
import {
  TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS,
  type TripExecutionPlanQualification,
} from './tripExecutionPlanQualification';

/**
 * The closed, provider-neutral reason vocabulary for a qualified dispatch.
 *
 * Bounded tokens only - never a provider message, credential detail, or prose.
 * `dispatched` is the single affirmative value and is reachable only when every
 * condition in the module docs holds.
 *
 * The mapping from input condition to reason is fixed:
 *
 * | condition                                    | reason                      |
 * |----------------------------------------------|-----------------------------|
 * | not an object, or wrong field types          | `qualification-invalid`     |
 * | reason token outside the STEP 71 vocabulary   | `qualification-invalid`     |
 * | `qualified !== true`                          | `not-qualified`             |
 * | `qualified: true` with a reason other than `qualified` | `qualification-invalid` |
 * | plan id missing or malformed                  | `plan-identity-invalid`     |
 * | request id missing or malformed              | `request-identity-invalid`  |
 * | plan id does not derive from the request id   | `identity-inconsistent`     |
 * | capability absent, or not in the closed vocabulary | `capability-unspecified` |
 * | qualified provider list empty                 | `provider-set-empty`        |
 * | provider identity invalid or too long        | `provider-identity-invalid` |
 * | provider identity repeated                    | `provider-identity-duplicate` |
 * | authorization chain does not re-derive        | `authorization-unresolved`  |
 *
 * Note what this vocabulary deliberately does *not* claim. A provider identity
 * that is well formed but names a provider this module has never heard of - a
 * case variant, an alias, a plausible-looking substitute - is still a *valid*
 * provider identity, and a structurally valid qualification is authoritative
 * about its own provider list. STEP 71 is where a provider set is compared
 * against a plan; this module has no plan among its inputs and therefore has
 * nothing to compare against, so it neither invents a provider registry to
 * check against nor pretends to re-run STEP 71. What it does guarantee is that
 * the identities it carries are passed through byte-for-byte: never case-folded,
 * trimmed, aliased, deduplicated, reordered, or substituted.
 */
export const TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS = [
  'dispatched',
  'qualification-invalid',
  'not-qualified',
  'plan-identity-invalid',
  'request-identity-invalid',
  'identity-inconsistent',
  'capability-unspecified',
  'provider-set-empty',
  'provider-identity-invalid',
  'provider-identity-duplicate',
  'authorization-unresolved',
] as const;

/** The provider-neutral qualified-dispatch reason vocabulary. */
export type TripExecutionQualifiedDispatchReason =
  (typeof TRIP_EXECUTION_QUALIFIED_DISPATCH_REASONS)[number];

/**
 * The pure result of one qualified-dispatch decision.
 *
 * Carries only safe identities, the existing dispatch instruction, and a bounded
 * token: no provider object, no credential, no transport, no booking, no
 * payment, and no claim that execution is possible, was authorized beyond
 * identity recovery, or was attempted.
 */
export interface TripExecutionQualifiedDispatch {
  /** True only when every gate held and a dispatch instruction was produced. */
  dispatched: boolean;
  /**
   * The existing STEP 58 dispatch instruction, or `null` when any gate failed. A
   * failed decision never produces an instruction, not even a partial one.
   */
  dispatch: TripExecutionDispatchInstruction | null;
  /** The qualified plan id, or `null` when it was missing or malformed. */
  planId: string | null;
  /** The qualified plan's request id, or `null` when it was missing or malformed. */
  requestId: string | null;
  /**
   * The authorization identity recovered from the plan's own request-id chain,
   * or `null` when no dispatch instruction was produced.
   */
  authorizationId: string | null;
  /**
   * The qualified provider identities in exact order when dispatched, and always
   * empty otherwise. Never sorted, ranked, deduplicated, or substituted.
   */
  providerIds: readonly string[];
  /** The qualification's required capability, preserved exactly. */
  requiredCapabilityId: ProviderCapabilityId | null;
  /** The bounded reason for this decision. */
  reason: TripExecutionQualifiedDispatchReason;
}

/**
 * The input to one qualified-dispatch decision. The qualification is untrusted
 * and re-validated; no provider object, credential, URL, token, transport, or
 * execution function is accepted.
 */
export interface TripExecutionQualifiedDispatchInput {
  /** The STEP 71 qualification result. Validated, never repaired. */
  qualification: unknown;
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

/** True when `value` is a member of the closed STEP 71 reason vocabulary. */
function isQualificationReason(value: unknown): boolean {
  return (TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS as ReadonlyArray<string>).includes(
    value as string
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

/** True when `value` is a well-formed, non-empty provider-request id. */
function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

/**
 * True when `value` has the *shape* of a STEP 71 qualification result: the
 * fields exist with the right types, and the reason is a real STEP 71 token.
 *
 * This deliberately checks only shape. Whether the verdict is affirmative, and
 * whether the affirmative verdict is fully supported by its own fields, is
 * decided afterwards, so a negative but well-formed qualification is reported as
 * `not-qualified` rather than as malformed.
 */
function hasQualificationShape(value: unknown): value is TripExecutionPlanQualification {
  if (!isRecord(value)) return false;
  if (typeof value.qualified !== 'boolean') return false;
  if (!isQualificationReason(value.reason)) return false;

  // An absent identity is a *missing* identity, not a malformed value, so
  // `undefined` is treated like the domain's explicit `null` and reported by the
  // gate that checks identities rather than by the shape check.
  const planId = value.planId;
  if (planId != null && typeof planId !== 'string') return false;

  const requestId = value.requestId;
  if (requestId != null && typeof requestId !== 'string') return false;

  const requiredCapabilityId = value.requiredCapabilityId;
  if (requiredCapabilityId != null && !isProviderCapabilityId(requiredCapabilityId)) return false;

  const providerIds = value.providerIds;
  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((id) => isSafeProviderId(id))) return false;

  // STEP 71 never exposes a provider set on a negative verdict. A value claiming
  // otherwise is not a STEP 71 result, so it is malformed rather than negative -
  // and reporting it as `not-qualified` would quietly bless a provider set that
  // the domain contract says cannot exist.
  if (!value.qualified && providerIds.length !== 0) return false;

  return true;
}

/**
 * The deterministic prefix that a qualified plan's request id always begins
 * with: the STEP 59, STEP 58, and STEP 57 prefixes composed by the real id
 * functions. Recovering the STEP 56 request id means removing exactly this, and
 * nothing else.
 */
const AUTHORIZATION_CHAIN_PREFIX =
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX +
  TRIP_EXECUTION_DISPATCH_ID_PREFIX +
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX;

/**
 * The STEP 56 request id embedded in a provider-request id, or `null` when the
 * provider-request id does not carry the full chain. No substring search, no
 * fuzzy match, no guessing: the chain is stripped from the front and whatever
 * remains must still be a well-formed STEP 56 request id.
 */
function recoverStep56RequestId(providerRequestId: string): string | null {
  if (!providerRequestId.startsWith(AUTHORIZATION_CHAIN_PREFIX)) return null;

  const step56RequestId = providerRequestId.slice(AUTHORIZATION_CHAIN_PREFIX.length);
  if (!step56RequestId.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX)) return null;
  if (step56RequestId.length <= TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX.length) return null;

  return step56RequestId;
}

/**
 * The dispatch instruction for a qualified plan's own request-id chain, or
 * `null` when the chain does not re-derive.
 *
 * The authorization value is re-built and then submitted to the real STEP 57
 * validator, and the resulting instruction to the real STEP 58 validator. The
 * final round trip is the load-bearing check: the instruction's dispatch id is
 * composed back into a provider-request id with the real STEP 59 prefix and must
 * equal the qualification's request id byte-for-byte. Without that, a
 * look-alike chain would produce a plausible instruction naming an authorization
 * this plan was never built from.
 */
function buildDispatchForChain(providerRequestId: string): TripExecutionDispatchInstruction | null {
  const step56RequestId = recoverStep56RequestId(providerRequestId);
  if (step56RequestId === null) return null;

  const authorization: TripPlanningExecutionAuthorization = {
    id: getTripPlanningExecutionAuthorizationId(step56RequestId),
    kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
    requestId: step56RequestId,
  };
  if (!isTripPlanningExecutionAuthorization(authorization)) return null;

  const dispatch = createTripExecutionDispatchInstruction(authorization);
  if (dispatch === null) return null;
  if (!isTripExecutionDispatchInstruction(dispatch)) return null;

  // Round trip through the STEP 59 prefix: this instruction must be the one the
  // qualified plan already references.
  if (TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX + dispatch.id !== providerRequestId) return null;

  return dispatch;
}

/**
 * Builds a rejection. `providerIds` is always empty, so a caller can never act on
 * a provider set the gate did not fully accept.
 */
function rejected(
  reason: TripExecutionQualifiedDispatchReason,
  planId: string | null,
  requestId: string | null
): TripExecutionQualifiedDispatch {
  return {
    dispatched: false,
    dispatch: null,
    planId,
    requestId,
    authorizationId: null,
    providerIds: [],
    requiredCapabilityId: null,
    reason,
  };
}

/**
 * The pure, synchronous qualified-dispatch decision.
 *
 * Check order, which fixes the reported reason for any given input:
 *
 * 1. the qualification has the shape of a STEP 71 result
 * 2. the qualification is affirmative, with the affirmative reason token
 * 3. the plan id is well-formed
 * 4. the request id is well-formed
 * 5. the plan id still derives from the request id
 * 6. the capability is explicit and recognized
 * 7. the provider list is non-empty
 * 8. no provider identity repeats
 * 9. the authorization chain re-derives a valid STEP 58 instruction
 *
 * Only after all nine hold is a dispatch instruction returned. Any other outcome
 * returns `dispatched: false` with `dispatch: null` and no providers.
 *
 * The function never throws for ordinary untrusted input, never mutates its
 * argument or any array within it, never calls a provider, never performs I/O,
 * and never applies an authorization rule - it only recovers the authorization
 * identity that the domain's own deterministic chain already encoded.
 */
export function createTripExecutionQualifiedDispatch(
  input: TripExecutionQualifiedDispatchInput
): TripExecutionQualifiedDispatch {
  if (!isRecord(input)) {
    return rejected('qualification-invalid', null, null);
  }

  const { qualification } = input;

  // 1. The STEP 71 result is re-checked, never taken on trust.
  if (!hasQualificationShape(qualification)) {
    return rejected('qualification-invalid', null, null);
  }

  // 2. A well-formed negative qualification is reported as such and is never
  //    re-interpreted as a structural fault.
  if (!qualification.qualified) {
    return rejected('not-qualified', null, null);
  }
  if (qualification.reason !== 'qualified') {
    return rejected('qualification-invalid', null, null);
  }

  const planId = qualification.planId as string | null;
  const requestId = qualification.requestId as string | null;

  // 3. and 4. Identities must be well-formed before anything is derived from them.
  if (!isPlanId(planId)) {
    return rejected('plan-identity-invalid', null, requestId);
  }
  if (!isProviderRequestId(requestId)) {
    return rejected('request-identity-invalid', planId, null);
  }

  // 5. The plan id and request id must still describe the same work, using the
  //    real STEP 63 formula rather than a restatement of it.
  if (getTripExecutionPlanId(requestId) !== planId) {
    return rejected('identity-inconsistent', planId, requestId);
  }

  // 6. The capability is never inferred from a provider or a plan. STEP 71 fails
  //    closed when it is absent, so reaching here without one is still rejected
  //    rather than treated as "any capability will do".
  const requiredCapabilityId = qualification.requiredCapabilityId;
  if (requiredCapabilityId == null) {
    return rejected('capability-unspecified', planId, requestId);
  }

  // 7. An empty qualified provider set is a contradiction, not a dispatch for
  //    nobody.
  const providerIds = qualification.providerIds as readonly string[];
  if (providerIds.length === 0) {
    return rejected('provider-set-empty', planId, requestId);
  }

  // 8. A repeated provider identity is a contradiction. Deduplicating would pick
  //    a winner and hide the defect, so the whole decision fails.
  const seen = new Set<string>();
  for (const providerId of providerIds) {
    if (seen.has(providerId)) {
      return rejected('provider-identity-duplicate', planId, requestId);
    }
    seen.add(providerId);
  }

  // 9. Recover the authorization the plan was already built from, and let the
  //    real STEP 57 and STEP 58 contracts decide whether the result is a valid
  //    dispatch instruction.
  const dispatch = buildDispatchForChain(requestId);
  if (dispatch === null) {
    return rejected('authorization-unresolved', planId, requestId);
  }

  return {
    dispatched: true,
    dispatch,
    planId,
    requestId,
    authorizationId: dispatch.authorizationId,
    // A fresh array: the caller cannot reach back into the qualification
    // through it, and cannot alter the qualification by editing the result.
    providerIds: [...providerIds],
    requiredCapabilityId,
    reason: 'dispatched',
  };
}
