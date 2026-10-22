/**
 * STEP 74 - authorized execution to provider-request handoff.
 *
 * This module is the domain seam that turns a recovered authorization back into
 * the provider request it implies, completing the chain:
 *
 *   ExecutionRequest (STEP 56)     \
 *                                    \
 *   Authorization (STEP 57)  <----  QualifiedAuthorization (STEP 73)
 *         |                          /
 *         v                         /
 *   Dispatch (STEP 58)  -------> ProviderRequest (STEP 59, this step)
 *                                    \
 *                                     v
 *                              ProviderExecution (NOT built)
 *
 * ## What this step is, and what it is emphatically not
 *
 * "Accepted" here means exactly one thing: a valid STEP 59
 * `TripExecutionProviderRequest` now exists, and it is the *same* provider
 * request the authorized dispatch was built from. It does not mean a provider has
 * been chosen, contacted, or accepted anything. STEP 59's own status vocabulary
 * (`accepted` | `rejected` | `unsupported` | `failed`) belongs to the provider
 * adapter's *result*, not to this handoff, and this module deliberately does not
 * emit or anticipate any of those tokens.
 *
 * The provider request is provider-neutral and carries a single identity - the
 * STEP 58 dispatch id. Provider identities, the required capability, and the
 * plan id are *not* copied into it, because STEP 59's contract does not carry
 * them. They are validated here, preserved here, and reported on the result, so
 * a caller can see the qualification it is acting on without the provider
 * contract being widened to carry it.
 *
 * ## Why the provider request is rebuilt rather than recomputed
 *
 * STEP 73 proved that an authorization is the one the qualified dispatch refers
 * to. This module walks the same chain forward, one real step at a time: the
 * STEP 57 authorization produces a STEP 58 instruction through the real STEP 58
 * factory, and that instruction produces a STEP 59 provider request through the
 * real STEP 59 factory. Every link is a value an existing contract produced, and
 * every new value is checked by that same contract's real validator.
 *
 * Nothing is minted by hand. There is no second provider-request formula in this
 * file, and no literal provider-request or dispatch id anywhere in it.
 *
 * ## The equality proof
 *
 * After the provider request exists, the chain is compared against the
 * identities the STEP 73 result supplied:
 *
 *   instruction.id                        === result.dispatchId
 *   getTripExecutionProviderRequestId(instruction.id)
 *                                          === result.requestId
 *   getTripExecutionPlanId(result.requestId) === result.planId
 *   instruction.authorizationId            === authorization.id
 *
 * The first two are the substantive proof: the dispatch id that reached this
 * step must be the one STEP 58 derives from the authorization, and the
 * provider-request id that reached this step must be the one STEP 59 derives
 * from that dispatch. A caller holding an authorization for one piece of work
 * cannot attach a request id for another, and no provider request is produced.
 *
 * The STEP 59 validator independently checks that the request's own `id` is the
 * deterministic STEP 59 id of its own `dispatchId`, so the created value is
 * proven twice: once by STEP 59 against itself, and once here against the chain
 * that authorized it.
 *
 * ## Fail-closed shape
 *
 * Every unsuccessful result has `accepted === false`, `providerRequest === null`,
 * and `providerIds === []`. A partially admitted provider set is never exposed:
 * a caller holding three of four providers has no way to know the fourth is
 * missing, and would plausibly proceed anyway.
 *
 * The checks run in a fixed order - shape, verdict, identities, authorization,
 * plan, capability, providers, chain, creation - so a given input always yields
 * the same reason.
 *
 * ## No execution
 *
 * The module never calls a provider, never calls `execute`, never invokes the
 * orchestrator or the execution pipeline, never reaches the network, books
 * nothing, pays nothing, persists nothing, and touches React, Firebase, Router,
 * or Zustand. There is no `Promise`, no `async`, no timer, no environment
 * access, and no mutable global state. Returned arrays are fresh copies;
 * neither the input nor any object or array within it is mutated.
 *
 * As in STEPS 71 through 73, the totality guarantee is over ordinary data values.
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
  isTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  type TripPlanningExecutionAuthorization,
} from '../../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripExecutionDispatchInstruction,
  isTripExecutionDispatchInstruction,
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  type TripExecutionDispatchInstruction,
} from './tripExecutionDispatch';
import {
  createTripExecutionProviderRequest,
  getTripExecutionProviderRequestId,
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
} from './tripExecutionProvider';
import { getTripExecutionPlanId, TRIP_EXECUTION_PLAN_ID_PREFIX } from './tripExecutionPlan';
import { TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS } from './tripExecutionQualifiedAuthorization';

/**
 * The closed, provider-neutral reason vocabulary for a provider-request handoff.
 *
 * Bounded tokens only - never a provider message, credential detail, or prose.
 * `accepted` is the single affirmative value and is reachable only when every
 * condition in the module docs holds. None of these tokens is a STEP 59
 * provider *result* status: those describe what a provider did, and no provider
 * has run at this boundary.
 *
 * The mapping from condition to reason is fixed:
 *
 * | condition                                                  | reason                        |
 * |------------------------------------------------------------|-------------------------------|
 * | not an object, wrong field types, or a positive verdict whose reason token is not `authorized` | `authorization-result-invalid` |
 * | `authorized !== true`                                       | `not-authorized`               |
 * | the authorization value absent or not an object            | `authorization-missing`        |
 * | authorization id missing or not well formed                | `authorization-id-invalid`     |
 * | authorization rejected by the real STEP 57 validator       | `authorization-invalid`        |
 * | dispatch id missing or not well formed                     | `dispatch-id-invalid`          |
 * | embedded instruction could not be produced by STEP 58      | `dispatch-invalid`             |
 * | request id missing or not well formed                      | `request-id-invalid`           |
 * | plan id missing or not well formed                         | `plan-id-invalid`              |
 * | plan id does not derive from the request id                | `identity-inconsistent`        |
 * | capability absent or outside the closed vocabulary         | `capability-invalid`           |
 * | provider identity invalid, padded, or too long             | `provider-identity-invalid`    |
 * | provider identity repeated                                 | `provider-identity-duplicate`  |
 * | provider set empty                                         | `provider-set-empty`           |
 * | a forward chain equality against the result fails          | `identity-inconsistent`        |
 * | STEP 59 declined the instruction, or its validator refused  | `provider-request-invalid`     |
 */
export const TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS = [
  'accepted',
  'authorization-result-invalid',
  'not-authorized',
  'authorization-missing',
  'authorization-id-invalid',
  'authorization-invalid',
  'dispatch-id-invalid',
  'dispatch-invalid',
  'request-id-invalid',
  'plan-id-invalid',
  'identity-inconsistent',
  'capability-invalid',
  'provider-identity-invalid',
  'provider-identity-duplicate',
  'provider-set-empty',
  'provider-request-invalid',
] as const;

/** The provider-neutral provider-request handoff reason vocabulary. */
export type TripExecutionAuthorizedRequestReason =
  (typeof TRIP_EXECUTION_AUTHORIZED_REQUEST_REASONS)[number];

/**
 * The pure result of one provider-request handoff.
 *
 * Carries only safe identities, the real STEP 59 provider request, and a bounded
 * token: no provider object, no credential, no transport, no booking, no
 * payment, and no claim that a provider has been contacted or has accepted
 * anything.
 */
export interface TripExecutionAuthorizedRequest {
  /** True only when every gate held and a provider request was produced. */
  accepted: boolean;
  /** The authoritative STEP 59 provider request, or `null` on any failure. */
  providerRequest: TripExecutionProviderRequest | null;
  /** The STEP 57 authorization id the request was proven against, or `null`. */
  authorizationId: string | null;
  /** The STEP 58 dispatch id the request was proven against, or `null`. */
  dispatchId: string | null;
  /** The STEP 59 provider-request id, or `null` when it was missing or malformed. */
  requestId: string | null;
  /** The qualified plan id, or `null` when it was missing or malformed. */
  planId: string | null;
  /**
   * The authorized provider identities in exact order when accepted, and always
   * empty otherwise. Never sorted, ranked, deduplicated, or substituted. These
   * are reported for the caller, not copied into the provider request, which
   * STEP 59 deliberately keeps provider-neutral.
   */
  providerIds: readonly string[];
  /** The qualification's required capability, preserved exactly. */
  requiredCapabilityId: ProviderCapabilityId | null;
  /** The bounded reason for this handoff. */
  reason: TripExecutionAuthorizedRequestReason;
}

/**
 * The input to one provider-request handoff. The STEP 73 result is untrusted and
 * re-validated; no provider object, credential, URL, token, transport,
 * callback, or execution function is accepted.
 */
export interface TripExecutionAuthorizedRequestInput {
  /** The STEP 73 qualified-authorization result. Validated, never repaired. */
  authorization: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The existing execution provider-identity rule: non-empty, already-trimmed,
 * bounded. No case folding and no character filtering, because a provider id is
 * an exact key here.
 */
function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

/** True when `value` is a well-formed, non-empty authorization id. */
function isAuthorizationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX) &&
    value.length > TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX.length
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

/** True when `value` is a member of the closed STEP 73 reason vocabulary. */
function isQualifiedAuthorizationReason(value: unknown): boolean {
  return (TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/**
 * The narrowed form of an untrusted value that has the *shape* of a STEP 73
 * result. Every field is either absent/null or already a value of the domain's
 * own type, which is what lets the gates below report one specific reason per
 * fault instead of a blanket "invalid".
 */
interface QualifiedAuthorizationShape {
  authorized: boolean;
  reason: (typeof TRIP_EXECUTION_QUALIFIED_AUTHORIZATION_REASONS)[number];
  authorization: Record<string, unknown> | null;
  authorizationId: string | null;
  dispatchId: string | null;
  requestId: string | null;
  planId: string | null;
  requiredCapabilityId: ProviderCapabilityId | null;
  providerIds: readonly string[];
}

/**
 * True when `value` has the *shape* of a STEP 73 qualified-authorization result.
 * Only shape is checked. Whether the verdict is affirmative, whether the
 * embedded authorization is a real STEP 57 value, and whether the chain
 * re-derives are decided afterwards, so a negative but well-formed result is
 * reported as `not-authorized` rather than as malformed.
 *
 * A field that is absent (`undefined`) is treated like the domain's explicit
 * `null`: both mean "not supplied", and the gate that owns that field reports
 * it.
 */
function hasQualifiedAuthorizationShape(value: unknown): value is QualifiedAuthorizationShape {
  if (!isRecord(value)) return false;
  if (typeof value.authorized !== 'boolean') return false;
  if (!isQualifiedAuthorizationReason(value.reason)) return false;

  const authorization = value.authorization;
  if (authorization !== null && authorization !== undefined && !isRecord(authorization)) return false;

  const authorizationId = value.authorizationId;
  if (authorizationId != null && typeof authorizationId !== 'string') return false;

  const dispatchId = value.dispatchId;
  if (dispatchId != null && typeof dispatchId !== 'string') return false;

  const requestId = value.requestId;
  if (requestId != null && typeof requestId !== 'string') return false;

  const planId = value.planId;
  if (planId != null && typeof planId !== 'string') return false;

  const requiredCapabilityId = value.requiredCapabilityId;
  if (requiredCapabilityId != null && !isProviderCapabilityId(requiredCapabilityId)) return false;

  const providerIds = value.providerIds;
  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((id) => isSafeProviderId(id))) return false;

  return true;
}

/** Builds a rejection. `providerIds` is always empty. */
function rejected(
  reason: TripExecutionAuthorizedRequestReason,
  authorizationId: string | null,
  dispatchId: string | null,
  requestId: string | null,
  planId: string | null
): TripExecutionAuthorizedRequest {
  return {
    accepted: false,
    providerRequest: null,
    authorizationId,
    dispatchId,
    requestId,
    planId,
    providerIds: [],
    requiredCapabilityId: null,
    reason,
  };
}

/**
 * The pure, synchronous provider-request handoff.
 *
 * Check order, which fixes the reported reason for any given input:
 *
 * 1. the input has the shape of a STEP 73 qualified-authorization result
 * 2. that result is affirmative, with the affirmative reason token
 * 3. the dispatch id, request id, and plan id are well formed
 * 4. the plan id still derives from the request id
 * 5. the authorization id is well formed and accepted by the real STEP 57 validator
 * 6. the capability is explicit and recognized
 * 7. the provider list is non-empty and free of repeats
 * 8. the STEP 58 instruction re-derives from the authorization
 * 9. the dispatch and request ids are the ones that chain implies
 * 10. the STEP 59 factory and validator accept the instruction
 *
 * Only after all ten hold is a provider request returned. Any other outcome
 * returns `accepted: false` with `providerRequest: null` and no providers.
 *
 * The function never throws for ordinary untrusted input, never mutates its
 * argument or any object or array within it, never calls a provider, never
 * performs I/O, and never evaluates a provider or authorization rule.
 */
export function createTripExecutionAuthorizedRequest(
  input: TripExecutionAuthorizedRequestInput
): TripExecutionAuthorizedRequest {
  if (!isRecord(input)) {
    return rejected('authorization-result-invalid', null, null, null, null);
  }

  const { authorization: result } = input;

  // 1. The STEP 73 result is re-checked, never taken on trust.
  if (!hasQualifiedAuthorizationShape(result)) {
    return rejected('authorization-result-invalid', null, null, null, null);
  }

  // 2. A well-formed negative result is reported as such, never re-interpreted as
  //    a structural fault.
  if (!result.authorized) {
    return rejected('not-authorized', null, null, null, null);
  }
  if (result.reason !== 'authorized') {
    return rejected('authorization-result-invalid', null, null, null, null);
  }

  // 3. and 4. Identities must be well formed, and must describe the same work,
  //    before anything is derived from them.
  const dispatchId = result.dispatchId;
  const requestId = result.requestId;
  const planId = result.planId;
  if (!isDispatchId(dispatchId)) {
    return rejected('dispatch-id-invalid', null, null, null, null);
  }
  if (!isProviderRequestId(requestId)) {
    return rejected('request-id-invalid', null, dispatchId, null, planId);
  }
  if (!isPlanId(planId)) {
    return rejected('plan-id-invalid', null, dispatchId, requestId, null);
  }
  if (getTripExecutionPlanId(requestId) !== planId) {
    return rejected('identity-inconsistent', null, dispatchId, requestId, planId);
  }

  // 5. The authorization identity is reported on its own terms first, so a caller
  //    with a malformed identity is told that rather than being told the whole
  //    authorization is the wrong shape.
  if (!isRecord(result.authorization)) {
    return rejected('authorization-missing', null, dispatchId, requestId, planId);
  }
  if (!isAuthorizationId(result.authorization.id)) {
    return rejected('authorization-id-invalid', null, dispatchId, requestId, planId);
  }
  if (!isTripPlanningExecutionAuthorization(result.authorization)) {
    return rejected('authorization-invalid', null, dispatchId, requestId, planId);
  }
  const authorization: TripPlanningExecutionAuthorization = result.authorization;

  // 6. The capability is explicit and never inferred. STEP 70, STEP 72, and STEP
  //    73 all fail closed when it is absent, so reaching here without one is
  //    still rejected rather than treated as "any capability will do".
  const requiredCapabilityId = result.requiredCapabilityId;
  if (requiredCapabilityId == null) {
    return rejected('capability-invalid', authorization.id, dispatchId, requestId, planId);
  }

  // 7. An empty authorized provider set is a contradiction, not a request for
  //    nobody, and a repeated identity would be silently repaired by deduping.
  const providerIds = result.providerIds as readonly string[];
  if (providerIds.length === 0) {
    return rejected('provider-set-empty', authorization.id, dispatchId, requestId, planId);
  }
  const seen = new Set<string>();
  for (const providerId of providerIds) {
    if (seen.has(providerId)) {
      return rejected(
        'provider-identity-duplicate',
        authorization.id,
        dispatchId,
        requestId,
        planId
      );
    }
    seen.add(providerId);
  }

  // 8. The dispatch instruction is produced by the real STEP 58 factory from the
  //    authorization, then accepted by the real STEP 58 validator. It is not read
  //    off the result, so a caller cannot smuggle in an instruction that belongs
  //    to a different authorization.
  const instruction: TripExecutionDispatchInstruction | null =
    createTripExecutionDispatchInstruction(authorization);
  if (instruction === null || !isTripExecutionDispatchInstruction(instruction)) {
    return rejected('dispatch-invalid', authorization.id, dispatchId, requestId, planId);
  }

  // 9. The forward chain equality. The dispatch id and the provider-request id
  //    that reached this step must be exactly the ones this authorization implies,
  //    or the result describes a different piece of work than it authorizes.
  if (instruction.id !== dispatchId) {
    return rejected('identity-inconsistent', authorization.id, dispatchId, requestId, planId);
  }
  if (getTripExecutionProviderRequestId(instruction.id) !== requestId) {
    return rejected('identity-inconsistent', authorization.id, dispatchId, requestId, planId);
  }
  // The restated authorization id needs no separate comparison: the STEP 58
  // validator has tied `instruction.id` to `instruction.authorizationId`, and the
  // equality above tied `instruction.id` to this authorization. Re-testing either
  // would restate a contract already enforced.
  //
  // A top-level `authorizationId`, though, is not covered by those guarantees: it
  // is a second, independent statement of the same identity, so a result that
  // contradicts itself must fail rather than be silently corrected.
  if (result.authorizationId != null && result.authorizationId !== authorization.id) {
    return rejected('identity-inconsistent', authorization.id, dispatchId, requestId, planId);
  }

  // 10. The provider request is produced by the real STEP 59 factory and accepted
  //     by the real STEP 59 validator. STEP 59 independently proves the request's
  //     own id is the deterministic STEP 59 id of its own dispatch id, so the
  //     created value is proven twice: once against itself, once against the
  //     chain above.
  const providerRequest: TripExecutionProviderRequest | null =
    createTripExecutionProviderRequest(instruction);
  if (providerRequest === null || !isTripExecutionProviderRequest(providerRequest)) {
    return rejected('provider-request-invalid', authorization.id, dispatchId, requestId, planId);
  }

  return {
    accepted: true,
    providerRequest,
    authorizationId: authorization.id,
    dispatchId: instruction.id,
    requestId: providerRequest.id,
    planId,
    // A fresh array: the caller cannot reach back into the result object it
    // passed in through it, and cannot alter that result by editing this one.
    providerIds: [...providerIds],
    requiredCapabilityId,
    reason: 'accepted',
  };
}
