/**
 * STEP 77 - authorized execution outcome receipt.
 *
 * This module is a *receipt*: a deterministic, validated record of an
 * already-authorized execution orchestration that has already happened. It is not
 * an execution mechanism and cannot become one. It contains no `provider.execute(`,
 * does not import or call the STEP 75 execution function, and does not import or
 * call the STEP 76 orchestrator. Its single input is a STEP 76 result that some
 * earlier layer already produced.
 *
 * ## Position in the chain
 *
 *   AuthorizedRequest (STEP 74) -> Orchestration (STEP 76) -> STEP 75 results
 *                                        |
 *                                        v
 *                              OutcomeReceipt (this module)
 *
 * Step 76 reports what happened. This module turns that report into a value that
 * can be identified and audited afterwards without re-running anything: which
 * request was executed, which providers were asked, what each one answered, and
 * what the attempt came to as a whole.
 *
 * ## Determinism, and what it rests on
 *
 * A receipt id must be reproducible from its content, or the artifact is not
 * auditable - the same execution could not be recognised as the same execution
 * after the fact. It is therefore derived from the STEP 59 provider-request id:
 *
 *     trip-execution-outcome-receipt:<requestId>
 *
 * There is no timestamp, no UUID, no counter, no randomness, and no environment
 * read anywhere in this module. Two calls with the same request id produce the
 * same receipt id, which is the property an audit needs. The trade is deliberate:
 * the existing domain has no attempt identity, so a receipt is keyed by *request*,
 * not by *attempt*, and a re-execution of the same request yields the same receipt
 * identity. Nothing here invents an attempt counter to hide that, because neither
 * a counter nor a timestamp can be derived deterministically.
 *
 * ## Fail closed, never repair
 *
 * The factory takes `unknown` and returns `null` for anything it cannot record
 * truthfully. It never trims, case-folds, sorts, deduplicates, pads, or otherwise
 * edits its input to make it fit. A receipt that had been quietly corrected would
 * misrepresent what was executed, which is worse than no receipt at all.
 *
 * ## The STEP 76 result is preserved, not interpreted
 *
 * Every per-provider entry in `results` is copied as it stands. This module does
 * not rewrite a provider status, merge providers, merge results, fabricate an
 * answer, drop a failure, or translate a reason. It records; it does not
 * reinterpret. A provider that failed at the STEP 75 boundary is recorded as
 * having failed.
 *
 * ## Statuses are the existing vocabulary
 *
 * No new status is declared here. The aggregate `status` is either one of the four
 * existing STEP 59 values or `null`. `null` is preserved and never converted to
 * `unsupported`, because `unsupported` is a *provider's* claim about a request
 * while `null` is this module's statement that no provider answered and therefore
 * no aggregate exists. The status is checked against the recorded answers rather
 * than trusted.
 *
 * ## Two identities are refused, not repaired
 *
 * A STEP 76 result whose `requestId` is `null` - which happens when preflight
 * failed before any request identity was established - cannot be given a
 * deterministic receipt id, so it is refused. Likewise a result that contradicts
 * its own `executed` field, or whose `status` disagrees with the answers it
 * records, is refused: such a value is not a truthful execution outcome, and a
 * receipt would carry that untruth forward as if it were established fact.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderResult,
  isTripExecutionProviderResultStatus,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from './tripExecutionProvider';
import {
  TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS,
  type TripExecutionAuthorizedOrchestrationResult,
} from './tripExecutionAuthorizedOrchestrator';
import {
  TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS,
  type TripExecutionAuthorizedExecutionResult,
} from './tripExecutionAuthorizedExecution';
import { getTripExecutionAggregateStatus } from './tripExecutionOrchestrator';

/**
 * The deterministic, provider-neutral prefix for authorized execution outcome
 * receipt ids. Kept distinct from the provider-request id space it references, so
 * a receipt id can never collide with the request identity it records, and
 * distinct from every earlier execution identity.
 */
export const TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX =
  'trip-execution-outcome-receipt:' as const;

/** The single explicit kind carried by every authorized execution outcome receipt. */
export const TRIP_EXECUTION_OUTCOME_RECEIPT_KIND = 'trip-execution-outcome-receipt' as const;

/**
 * The closed, provider-neutral reason vocabulary for this boundary.
 *
 * `recorded` is the single affirmative value, and it is the only token that can
 * appear on a returned receipt, because the factory refuses rather than recording
 * an outcome it cannot vouch for. The remaining tokens name the gate that refused
 * and are the strongly typed result of the internal checks, so the vocabulary of
 * possible outcomes stays closed and explicit rather than implied by `null`.
 *
 * | condition                                                              | reason                               |
 * |------------------------------------------------------------------------|--------------------------------------|
 * | input is not an object, or a field has the wrong type                  | `receipt-invalid`                    |
 * | `requestId` is absent or is not a valid provider-request identity       | `receipt-request-identity-invalid`   |
 * | `providerIds` is not an array, or an element is not a legal provider id | `receipt-provider-set-invalid`       |
 * | the same provider id appears more than once                             | `receipt-provider-duplicate`         |
 * | a result is malformed, or one of its identities is absent or foreign    | `receipt-result-invalid`             |
 * | `status` is neither an existing status nor `null`                      | `receipt-status-invalid`             |
 * | `executed` contradicts the STEP 76 "no invocation" rule                 | `receipt-execution-state-invalid`    |
 * | `status` contradicts the provider answers that exist                    | `receipt-status-mismatch`            |
 * | `providerIds` and `results` are not the same set, or not the same order  | `receipt-order-mismatch`             |
 */
export const TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS = [
  'recorded',
  'receipt-invalid',
  'receipt-request-identity-invalid',
  'receipt-provider-set-invalid',
  'receipt-provider-duplicate',
  'receipt-result-invalid',
  'receipt-status-invalid',
  'receipt-execution-state-invalid',
  'receipt-status-mismatch',
  'receipt-order-mismatch',
] as const;

/** The provider-neutral receipt reason vocabulary. */
export type TripExecutionOutcomeReceiptReason =
  (typeof TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS)[number];

/**
 * The pure, provider-neutral record of one authorized execution outcome.
 *
 * Every field is a bounded identity, an existing status, or a copy of a STEP 75
 * result. Nothing here is provider-specific, and nothing here implies that
 * execution success is business success: `executed: true` records that the
 * authorized providers were *attempted*, not that any of them agreed.
 */
export interface TripExecutionOutcomeReceipt {
  /** The deterministic receipt identity: `trip-execution-outcome-receipt:<requestId>`. */
  id: string;
  /** The single explicit receipt kind. */
  kind: typeof TRIP_EXECUTION_OUTCOME_RECEIPT_KIND;
  /** The STEP 59 provider-request id this receipt records the outcome of. */
  requestId: string;
  /**
   * The authorized provider ids in authoritative execution order. Empty exactly
   * when no provider was invoked, so an empty list is itself the record that
   * nothing ran.
   */
  providerIds: string[];
  /**
   * One copied STEP 75 result per attempted provider, in the same order. Empty
   * exactly when no provider was invoked.
   */
  results: TripExecutionAuthorizedExecutionResult[];
  /**
   * True only when preflight passed and every authorized provider was attempted.
   * Carried from the STEP 76 result; never derived from provider statuses.
   */
  executed: boolean;
  /**
   * The aggregate of the provider answers that actually exist, or `null` when no
   * provider answered. `null` is preserved and is never turned into
   * `unsupported`.
   */
  status: TripExecutionProviderResultStatus | null;
  /** The bounded reason for this receipt. `recorded` on every valid receipt. */
  reason: TripExecutionOutcomeReceiptReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The same provider-identity rule the execution layers use: non-empty,
 * already-trimmed, bounded, exact bytes. A padded or case-variant id is not a
 * different provider; it is not a provider identity at all, and both are refused
 * rather than normalised into one.
 */
function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

/**
 * True when `value` is a well-formed STEP 59 provider-request id. This reads the
 * existing STEP 59 prefix constant rather than restating the string, so there is
 * one provider-request id space in the domain and no second formula here.
 */
function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

/** True when `value` is a member of the closed STEP 76 reason vocabulary. */
function isStep76Reason(value: unknown): boolean {
  return (TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/** True when `value` is a member of the closed STEP 75 reason vocabulary. */
function isStep75Reason(value: unknown): boolean {
  return (TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/** True when `value` is a member of the closed receipt reason vocabulary. */
function isStep77Reason(value: unknown): boolean {
  return (TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS as ReadonlyArray<string>).includes(
    value as string
  );
}

/**
 * True when `value` has the *shape* of a STEP 75 execution result.
 *
 * STEP 75 exports a type but no runtime validator, so this is the minimum
 * structural check needed before a result can be read safely. It proves only that
 * the five fields are present and of the right kind. It deliberately does not
 * decide whether a combination is truthful; that is left to the gates below, so a
 * well-formed but self-contradictory result is reported against its own
 * contradiction rather than as structurally malformed.
 */
function hasStep75ResultShape(value: unknown): value is TripExecutionAuthorizedExecutionResult {
  if (!isRecord(value)) return false;
  if (typeof value.executed !== 'boolean') return false;
  if (value.result !== null && value.result !== undefined && !isTripExecutionProviderResult(value.result)) {
    return false;
  }
  if (value.requestId !== null && value.requestId !== undefined && typeof value.requestId !== 'string') {
    return false;
  }
  if (value.providerId !== null && value.providerId !== undefined && typeof value.providerId !== 'string') {
    return false;
  }
  if (!isStep75Reason(value.reason)) return false;
  return true;
}

/**
 * The narrow form of an untrusted value shaped like a STEP 76 orchestration
 * result. `executed`, `requestId`, `providerIds`, `results`, and `status` are the
 * five fields a receipt records; `reason` is checked for membership so an invented
 * token cannot travel through the artifact.
 */
interface OrchestrationShape {
  executed: boolean;
  requestId: string | null;
  providerIds: readonly unknown[];
  results: readonly unknown[];
  status: TripExecutionProviderResultStatus | null;
  reason: (typeof TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS)[number];
}

/**
 * True when `value` has the *shape* of a STEP 76 orchestration result. Only
 * shape: whether the value is internally consistent is decided afterwards, so a
 * well-formed but contradictory result is reported against its own contradiction
 * rather than as structurally malformed. An absent field (`undefined`) is treated
 * like the domain's explicit `null`, so the gate that owns it reports it.
 */
function hasOrchestrationShape(value: unknown): value is OrchestrationShape {
  if (!isRecord(value)) return false;
  if (typeof value.executed !== 'boolean') return false;
  if (
    value.requestId !== null &&
    value.requestId !== undefined &&
    typeof value.requestId !== 'string'
  ) {
    return false;
  }
  if (!Array.isArray(value.providerIds)) return false;
  if (!Array.isArray(value.results)) return false;
  if (value.status !== null && value.status !== undefined && typeof value.status !== 'string') {
    return false;
  }
  if (!isStep76Reason(value.reason)) return false;
  return true;
}

/**
 * Copies one STEP 75 result. A fresh object with a fresh `result` object is
 * returned, so the receipt shares no mutable structure with its input. The three
 * STEP 59 result fields are themselves primitives, so nothing deeper needs
 * cloning and no general-purpose deep clone is warranted.
 */
function copyStep75Result(
  result: TripExecutionAuthorizedExecutionResult
): TripExecutionAuthorizedExecutionResult {
  return {
    executed: result.executed,
    result: result.result === null ? null : { ...result.result },
    requestId: result.requestId,
    providerId: result.providerId,
    reason: result.reason,
  };
}

/**
 * Collects the provider results that genuinely exist. A STEP 75 boundary failure
 * carries `result: null` because no provider answered, and the aggregate status
 * is computed only over real answers.
 */
function collectAnsweredResults(
  results: ReadonlyArray<TripExecutionAuthorizedExecutionResult>
): TripExecutionProviderResult[] {
  const answered: TripExecutionProviderResult[] = [];
  for (const entry of results) {
    if (entry.result !== null) {
      answered.push(entry.result);
    }
  }
  return answered;
}

/** Either a receipt to return, or the bounded reason a gate refused. */
type ReceiptBuild =
  | { recorded: true; receipt: TripExecutionOutcomeReceipt }
  | { recorded: false; reason: TripExecutionOutcomeReceiptReason };

/**
 * Creates the pure, provider-neutral receipt of one authorized execution
 * outcome.
 *
 * The input is the STEP 76 orchestration result, taken as `unknown` and
 * re-validated rather than trusted. A receipt is returned only when every gate
 * below passes; otherwise `null` is returned.
 *
 * Gate order, which fixes what is checked first for any given input:
 *
 * 1. the input is an object with the shape of a STEP 76 result
 * 2. `requestId` is a real STEP 59 provider-request identity
 * 3. `providerIds` is an array of legal provider identities, with no duplicate
 * 4. every entry of `results` has the shape of a STEP 75 result
 * 5. every result's provider and request identities are legal and consistent
 * 6. `status` is an existing status or `null`
 * 7. `executed` and `results.length` agree with the STEP 76 executed rule
 * 8. `status` agrees with the provider answers that actually exist
 * 9. `providerIds` and `results` are the same set *and* the same order
 *
 * The function is pure and deterministic: no clock, no randomness, no
 * environment read, no counters, and no global mutable state. Two calls with the
 * same input produce equal receipts.
 */
export function createTripExecutionOutcomeReceipt(
  input: unknown
): TripExecutionOutcomeReceipt | null {
  const built = buildReceipt(input);
  return built.recorded ? built.receipt : null;
}

/** Builds the receipt, or the bounded reason a gate refused. */
function buildReceipt(input: unknown): ReceiptBuild {
  // 1. The STEP 76 result is re-checked, never taken on trust.
  if (!hasOrchestrationShape(input)) {
    return { recorded: false, reason: 'receipt-invalid' };
  }

  // 2. The request identity. The receipt id is derived from it, so an absent or
  //    malformed one cannot produce a record at all. A STEP 76 preflight failure
  //    that never established a request identity is refused here.
  const requestId = input.requestId;
  if (typeof requestId !== 'string' || !isProviderRequestId(requestId)) {
    return { recorded: false, reason: 'receipt-request-identity-invalid' };
  }

  // 3. The provider set. An id is compared as exact bytes: no trimming, no case
  //    folding, no deduplication. A repeated identity would make the execution
  //    trace ambiguous, so it is refused rather than collapsed.
  const providerIds: string[] = [];
  for (const candidate of input.providerIds) {
    if (!isSafeProviderId(candidate)) {
      return { recorded: false, reason: 'receipt-provider-set-invalid' };
    }
    if (providerIds.includes(candidate)) {
      return { recorded: false, reason: 'receipt-provider-duplicate' };
    }
    providerIds.push(candidate);
  }

  // 4. Every per-provider entry must be a STEP 75 result before anything is read
  //    out of it. `undefined` in place of an explicit `null` is treated as the
  //    domain's "no provider answer".
  const results: TripExecutionAuthorizedExecutionResult[] = [];
  for (const candidate of input.results) {
    if (!hasStep75ResultShape(candidate)) {
      return { recorded: false, reason: 'receipt-result-invalid' };
    }
    results.push(copyStep75Result(candidate));
  }

  // Gates 2 to 4 have now proved that every `providerIds` element is a string and
  // every `results` element is a STEP 75 result, which is exactly what the STEP 76
  // contract claims its own arrays hold. The remaining fields are read through the
  // real STEP 76 result type rather than through a local substitute for it, so a
  // change to that contract surfaces here instead of being papered over.
  const step76 = input as unknown as TripExecutionAuthorizedOrchestrationResult;

  // 5. Each result's own identities must be legal and must be the ones it was
  //    given. A result whose `providerId` is absent, padded, or unknown would make
  //    the receipt unattributable, and a result carrying someone else's request
  //    id or provider id would make it untrue.
  for (const entry of results) {
    if (entry.providerId === null || !isSafeProviderId(entry.providerId)) {
      return { recorded: false, reason: 'receipt-result-invalid' };
    }
    if (entry.requestId !== null && entry.requestId !== requestId) {
      return { recorded: false, reason: 'receipt-result-invalid' };
    }
    if (entry.result !== null && entry.result.providerId !== entry.providerId) {
      return { recorded: false, reason: 'receipt-result-invalid' };
    }
    if (entry.result !== null && entry.result.requestId !== requestId) {
      return { recorded: false, reason: 'receipt-result-invalid' };
    }
  }

  // 6. The status must be an existing status or `null`. No fifth value, and no
  //    invented token.
  const status: TripExecutionProviderResultStatus | null =
    step76.status === undefined ? null : step76.status;
  if (status !== null && !isTripExecutionProviderResultStatus(status)) {
    return { recorded: false, reason: 'receipt-status-invalid' };
  }

  // 7. The executed rule, exactly as STEP 76 states it:
  //
  //        executed === false  <=>  results.length === 0
  //
  //    An empty trace with `executed: true` would claim providers were attempted
  //    when none were, and a non-empty trace with `executed: false` would claim
  //    nothing ran when something did. Both are refused. The provider set is
  //    checked against the trace separately, one gate later.
  if (step76.executed !== (results.length > 0)) {
    return { recorded: false, reason: 'receipt-execution-state-invalid' };
  }

  // 8. The aggregate must match the answers that actually exist. `null` is the
  //    honest value when no provider answered, so `unsupported` over an empty
  //    answer set is refused rather than accepted as a convenient default, and a
  //    status claiming `accepted` over an answer set with no `accepted` result is
  //    refused too.
  const answered = collectAnsweredResults(results);
  const expectedStatus =
    answered.length === 0 ? null : getTripExecutionAggregateStatus(answered);
  if (status !== expectedStatus) {
    return { recorded: false, reason: 'receipt-status-mismatch' };
  }

  // 9. `providerIds` is authoritative. The comparison is element-wise, so a
  //    missing provider, an extra provider, and a reordering are each refused.
  //    Neither collection is sorted to make them agree, and set equality alone is
  //    not enough: the order is part of what is being recorded.
  if (providerIds.length !== results.length) {
    return { recorded: false, reason: 'receipt-order-mismatch' };
  }
  for (let index = 0; index < providerIds.length; index += 1) {
    if (providerIds[index] !== results[index].providerId) {
      return { recorded: false, reason: 'receipt-order-mismatch' };
    }
  }

  return {
    recorded: true,
    receipt: {
      // Deterministic from the validated request identity: no timestamp, no
      // counter, no randomness, no environment read.
      id: `${TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX}${requestId}`,
      kind: TRIP_EXECUTION_OUTCOME_RECEIPT_KIND,
      requestId,
      // Fresh arrays of fresh result objects, so the receipt shares nothing
      // mutable with its input in either direction.
      providerIds: [...providerIds],
      results: results.map((entry) => copyStep75Result(entry)),
      executed: step76.executed,
      status,
      reason: 'recorded',
    },
  };
}

/**
 * True when `value` is a well-formed authorized execution outcome receipt.
 *
 * This is a structural and self-consistency check on the artifact itself, for
 * callers that later receive a receipt from storage or a message rather than
 * from the factory. It proves the closed vocabularies, the closed kind, the
 * deterministic id relationship, the provider-set/result correspondence in order,
 * and the executed rule. It deliberately does not re-derive the aggregate status
 * from the recorded results: `createTripExecutionOutcomeReceipt` is the gate that
 * decides whether a receipt may exist, and repeating that decision here would
 * duplicate the consistency rules in a second place.
 */
export function isTripExecutionOutcomeReceipt(
  value: unknown
): value is TripExecutionOutcomeReceipt {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_OUTCOME_RECEIPT_KIND) return false;
  if (typeof value.requestId !== 'string' || !isProviderRequestId(value.requestId)) return false;
  if (
    typeof value.id !== 'string' ||
    value.id !== `${TRIP_EXECUTION_OUTCOME_RECEIPT_ID_PREFIX}${value.requestId}`
  ) {
    return false;
  }
  if (!isStep77Reason(value.reason)) return false;
  if (typeof value.executed !== 'boolean') return false;
  if (!Array.isArray(value.providerIds)) return false;
  if (!value.providerIds.every((id) => isSafeProviderId(id))) return false;
  if (new Set(value.providerIds).size !== value.providerIds.length) return false;
  if (!Array.isArray(value.results)) return false;
  if (!value.results.every((entry) => hasStep75ResultShape(entry))) return false;
  if (value.providerIds.length !== value.results.length) return false;
  for (let index = 0; index < value.providerIds.length; index += 1) {
    const entry = value.results[index] as TripExecutionAuthorizedExecutionResult;
    if (value.providerIds[index] !== entry.providerId) return false;
  }
  if (value.status !== null && !isTripExecutionProviderResultStatus(value.status)) return false;
  if (value.executed !== (value.results.length > 0)) return false;
  return true;
}
