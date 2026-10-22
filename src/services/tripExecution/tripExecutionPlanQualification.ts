/**
 * STEP 71 - capability-aware execution-plan qualification.
 *
 * This module answers one question about two already-created domain values:
 *
 *   "Is this STEP 63 execution plan compatible with the STEP 70 eligibility
 *    result, and may it be treated as capability-qualified for dispatch?"
 *
 * It is the missing link in the chain:
 *
 *   TripExecutionPlan (STEP 63)        \
 *                                        >-> TripExecutionPlanQualification
 *   TripExecutionEligibility (STEP 70) /
 *
 * It introduces no new execution surface, no new capability, no booking or
 * payment concept, and no new id. It only checks that a plan and an eligibility
 * result describe the *same* work with the *same* providers, and reports a
 * bounded verdict. A qualified plan is still a plan: nothing has executed, no
 * provider has been called, and no inventory, booking, reservation, or payment
 * has been confirmed. "Qualified" means the plan's provider set survives a
 * capability-aware check, not that execution will work.
 *
 * ## The identity problem, and why this module derives instead of comparing
 *
 * The two inputs carry request identities from *different id spaces*. A STEP 63
 * plan references `plan.requestId`, which is a STEP 59 provider-request id
 * (`trip-execution-provider-request:<dispatchId>`). A STEP 70 eligibility result
 * carries `requestId`, which is a STEP 56 planning execution request id
 * (`trip-planning-execution-request:<intentId>`).
 *
 * Those two strings are never equal, by construction. A naive equality check
 * would therefore reject every real pair and make this module useless, while
 * "fixing" it by loosening the check would be guessing.
 *
 * The honest solution is to derive the correspondence from the same
 * deterministic id functions the domain already defines. The chain nests:
 *
 *   intent -> STEP 55 intent id
 *          -> STEP 56 request id
 *          -> STEP 57 authorization id
 *          -> STEP 58 dispatch id
 *          -> STEP 59 provider-request id   <- plan.requestId
 *
 * So the plan's provider-request id *contains* the STEP 56 request id as a
 * deterministic suffix chain. This module re-derives the expected provider
 * request id by re-applying the real prefix constants to the eligibility
 * result's request id, then compares that derivation to `plan.requestId` for
 * full string equality.
 *
 * That is a re-derivation, not an inference: it uses the same exported
 * constants, performs whole-string equality, and involves no substring search,
 * no fuzzy match, no case folding, and no pattern guessing. If the shapes do not
 * line up, the result is `request-mismatch`. A caller cannot make two unrelated
 * requests compatible by supplying a similar-looking id.
 *
 * ## Exact provider-set correspondence
 *
 * The plan's `providerIds` are authoritative. The eligibility result's
 * `providerIds` must equal them element-for-element, in the same order, with
 * the same bytes. Order matters and is preserved: the plan's order is the
 * caller's explicit provider choice, and reordering it here would silently
 * change which provider runs first.
 *
 * Rejected, always, without repair or normalization: reordered sets, missing or
 * extra providers, duplicates, case variation, whitespace variation, and
 * aliases. This is a qualification boundary, not a normalization layer. A
 * "helpful" near-match would turn a caller mistake into an execution against a
 * provider they did not choose.
 *
 * ## Fail-closed shape
 *
 * Every unsuccessful result has `qualified === false` and `providerIds === []`.
 * A partially qualified provider set is never exposed, because a caller that
 * received three of four expected providers has no way to know the fourth is
 * missing, and would plausibly dispatch anyway.
 *
 * The checks run in a fixed order - plan, eligibility, eligibility verdict,
 * request identity, capability, provider identities, duplicates, then set
 * equality - so a given pair of inputs always yields the same reason.
 *
 * ## No execution
 *
 * The module never calls `execute`, never accepts a provider object, never
 * invokes the orchestrator or the execution pipeline, never constructs a
 * provider, never asks a provider about its capabilities, and performs no
 * network, persistence, or UI work. It has no `Promise`, no `async`, no timer,
 * no environment access, and no mutable global state, so it is safe in a
 * browser, a test, or a function. Returned arrays are fresh copies, and neither
 * input object is mutated.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import { isProviderCapabilityId, type ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import { TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX } from '../../domain/trips/tripPlanningExecutionRequest';
import { TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX } from '../../domain/trips/tripPlanningExecutionAuthorization';
import { TRIP_EXECUTION_DISPATCH_ID_PREFIX } from './tripExecutionDispatch';
import { TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX } from './tripExecutionProvider';
import { isTripExecutionPlan } from './tripExecutionPlan';
import {
  TRIP_EXECUTION_ELIGIBILITY_REASONS,
  type TripExecutionEligibility,
} from './tripExecutionEligibility';

/**
 * The closed, provider-neutral reason vocabulary for a plan qualification.
 *
 * Bounded tokens only - never a provider message, credential detail, or prose.
 * `qualified` is the single affirmative value and is reachable only when every
 * condition in the module docs holds.
 */
export const TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS = [
  'qualified',
  'plan-invalid',
  'eligibility-invalid',
  'eligibility-ineligible',
  'request-mismatch',
  'capability-unspecified',
  'provider-set-mismatch',
  'provider-identity-invalid',
  'provider-identity-duplicate',
] as const;

/** The provider-neutral qualification reason vocabulary. */
export type TripExecutionPlanQualificationReason =
  (typeof TRIP_EXECUTION_PLAN_QUALIFICATION_REASONS)[number];

/**
 * The pure result of one plan qualification.
 *
 * Carries only safe identities and a bounded token: no provider object, no
 * capability payload, no credential, no booking, no payment, and no claim that
 * execution is possible or was attempted.
 */
export interface TripExecutionPlanQualification {
  /** True only when every qualification condition held. */
  qualified: boolean;
  /** The plan id evaluated, or `null` when the plan was too malformed to expose one. */
  planId: string | null;
  /** The plan's request id, or `null` when the plan was invalid. */
  requestId: string | null;
  /**
   * The plan's provider identities in exact plan order when qualified, and
   * always empty otherwise. Never sorted, ranked, deduplicated, or substituted.
   */
  providerIds: readonly string[];
  /** The eligibility result's required capability, preserved exactly. */
  requiredCapabilityId: ProviderCapabilityId | null;
  /** The bounded reason for this verdict. */
  reason: TripExecutionPlanQualificationReason;
}

/**
 * The inputs to one qualification, both untrusted. The evaluator consumes the
 * STEP 63 plan and the STEP 70 eligibility result only - no provider object,
 * credential, URL, token, transport, or execution function is accepted.
 */
export interface TripExecutionPlanQualificationInput {
  /** The STEP 63 plan to qualify. Validated, never repaired. */
  plan: unknown;
  /** The STEP 70 eligibility result to qualify against. Validated, never repaired. */
  eligibility: unknown;
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

/** True when `value` is a member of the closed STEP 70 eligibility vocabulary. */
function isEligibilityReason(value: unknown): boolean {
  return (TRIP_EXECUTION_ELIGIBILITY_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/**
 * True when `value` is a structurally valid STEP 70 eligibility result, re-checked
 * here rather than trusted.
 *
 * The STEP 70 result is treated as untrusted because a caller may have assembled
 * or persisted it elsewhere, and a qualification claim must rest only on a value
 * that still satisfies the contract. Re-validation also enforces STEP 70's own
 * internal invariants: an eligible result carries a request id, an explicit
 * recognized capability, and at least one provider; an ineligible one carries an
 * empty provider list. A value claiming `eligible: true` with nothing to support
 * it is malformed, not qualified.
 */
function isTripExecutionEligibilityValue(value: unknown): value is TripExecutionEligibility {
  if (!isRecord(value)) return false;
  if (typeof value.eligible !== 'boolean') return false;
  if (!isEligibilityReason(value.reason)) return false;

  const requestId = value.requestId;
  if (requestId !== null && typeof requestId !== 'string') return false;

  const requiredCapabilityId = value.requiredCapabilityId;
  if (requiredCapabilityId !== null && !isProviderCapabilityId(requiredCapabilityId)) return false;

  const providerIds = value.providerIds;
  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((id) => isSafeProviderId(id))) return false;

  const capabilityIds = value.capabilityIds;
  if (!Array.isArray(capabilityIds)) return false;
  if (!capabilityIds.every((id) => isProviderCapabilityId(id))) return false;

  if (value.eligible) {
    // A positive verdict must be fully supported by the fields beside it.
    if (value.reason !== 'eligible') return false;
    if (typeof requestId !== 'string' || requestId.length === 0) return false;
    if (requiredCapabilityId === null) return false;
    if (providerIds.length === 0) return false;
    if (!capabilityIds.includes(requiredCapabilityId)) return false;
  } else {
    // STEP 70 never exposes a partial provider set.
    if (providerIds.length !== 0) return false;
    if (capabilityIds.length !== 0) return false;
  }

  return true;
}

/**
 * The provider-request id the plan's request id must be, re-derived from a STEP
 * 56 request id through the real prefix constants. Returns `null` when the
 * supplied id is not a well-formed STEP 56 request id, so a caller cannot smuggle
 * a similar-looking string into a match.
 */
function deriveProviderRequestId(step56RequestId: unknown): string | null {
  if (typeof step56RequestId !== 'string') return null;
  if (step56RequestId.length <= TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX.length) return null;
  if (!step56RequestId.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX)) return null;

  return (
    TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX +
    TRIP_EXECUTION_DISPATCH_ID_PREFIX +
    TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX +
    step56RequestId
  );
}

/** Reads the plan id for a safe echo, or `null` when the plan is invalid. */
function readPlanId(plan: unknown): string | null {
  if (!isRecord(plan)) return null;
  return typeof plan.id === 'string' ? plan.id : null;
}

function rejected(
  reason: TripExecutionPlanQualificationReason,
  planId: string | null,
  requestId: string | null,
  requiredCapabilityId: ProviderCapabilityId | null
): TripExecutionPlanQualification {
  return {
    qualified: false,
    planId,
    requestId,
    // A failed qualification never exposes a provider set, not even the subset
    // that happened to match.
    providerIds: [],
    requiredCapabilityId,
    reason,
  };
}

/**
 * The pure, synchronous plan qualification.
 *
 * Check order, which fixes the reported reason for any given pair:
 *
 * 1. the plan must be a valid STEP 63 plan
 * 2. the eligibility value must be a valid STEP 70 result
 * 3. that result must be `eligible`
 * 4. the plan's request id must equal the id derived from the eligibility
 *    request id through the deterministic prefix chain
 * 5. the eligibility must carry an explicit recognized capability
 * 6. every provider identity on both sides must be valid
 * 7. neither side may repeat a provider identity
 * 8. the two provider lists must match element-for-element, in order
 *
 * Only after all eight hold is `qualified: true` returned. Any other outcome
 * returns `qualified: false` with an empty provider list.
 *
 * The function never throws for untrusted input, never mutates either argument
 * or any array within it, never calls a provider, and never performs I/O.
 */
export function evaluateTripExecutionPlanQualification(
  input: TripExecutionPlanQualificationInput
): TripExecutionPlanQualification {
  if (!isRecord(input)) {
    return rejected('plan-invalid', null, null, null);
  }

  const { plan, eligibility } = input;

  // 1. The plan is validated with the STEP 63 validator and never repaired.
  if (!isTripExecutionPlan(plan)) {
    return rejected('plan-invalid', readPlanId(plan), null, null);
  }
  const planId = plan.id;
  const planRequestId = plan.requestId;
  const planProviderIds = plan.providerIds as readonly string[];

  // 2. The eligibility result is re-validated, never trusted as-is.
  if (!isTripExecutionEligibilityValue(eligibility)) {
    // A malformed eligibility value exposes no trustworthy capability, so none
    // is echoed.
    return rejected('eligibility-invalid', planId, planRequestId, null);
  }

  const eligibilityProviderIds = eligibility.providerIds as readonly string[];
  const requiredCapabilityId = eligibility.requiredCapabilityId;

  // 3. A structurally valid but negative eligibility is reported as such, and is
  //    never re-interpreted as a provider-set failure.
  if (!eligibility.eligible) {
    return rejected('eligibility-ineligible', planId, planRequestId, requiredCapabilityId);
  }

  // 4. Request correspondence, re-derived through the deterministic prefix
  //    chain. See the module docs for why this is a derivation and not a
  //    literal comparison.
  const derivedRequestId = deriveProviderRequestId(eligibility.requestId);
  if (derivedRequestId === null || derivedRequestId !== planRequestId) {
    return rejected('request-mismatch', planId, planRequestId, requiredCapabilityId);
  }

  // 5. The capability must be explicit and recognized. STEP 70 already fails
  //    closed when it is absent, so reaching here with none is still rejected
  //    rather than treated as "any capability will do".
  if (requiredCapabilityId === null) {
    return rejected('capability-unspecified', planId, planRequestId, null);
  }

  // 6. Every identity on both sides must be valid. STEP 63's validator checks the
  //    plan's, but the eligibility side is re-checked here so this module holds
  //    its own fail-closed guarantee.
  for (const id of eligibilityProviderIds) {
    if (!isSafeProviderId(id)) {
      return rejected('provider-identity-invalid', planId, planRequestId, requiredCapabilityId);
    }
  }

  // 7. A repeated provider identity is a contradiction. Deduplicating would
  //    pick a winner and hide the defect, so the whole qualification fails.
  for (const ids of [planProviderIds, eligibilityProviderIds]) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        return rejected('provider-identity-duplicate', planId, planRequestId, requiredCapabilityId);
      }
      seen.add(id);
    }
  }

  // 8. Element-for-element equality in the plan's order. No sort, no dedupe, no
  //    substitution, no case or whitespace tolerance.
  if (planProviderIds.length !== eligibilityProviderIds.length) {
    return rejected('provider-set-mismatch', planId, planRequestId, requiredCapabilityId);
  }
  for (let index = 0; index < planProviderIds.length; index += 1) {
    if (planProviderIds[index] !== eligibilityProviderIds[index]) {
      return rejected('provider-set-mismatch', planId, planRequestId, requiredCapabilityId);
    }
  }

  return {
    qualified: true,
    planId,
    requestId: planRequestId,
    // A fresh array: the caller cannot reach back into the plan through it.
    providerIds: [...planProviderIds],
    requiredCapabilityId,
    reason: 'qualified',
  };
}
