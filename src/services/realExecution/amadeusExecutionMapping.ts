/**
 * Amadeus EXECUTION request mapping (STEP 66).
 *
 * Translates the provider-neutral STEP 59 `TripExecutionProviderRequest` into the
 * narrow, Amadeus-side request shape this boundary is allowed to speak. It
 * follows the strict-validation philosophy already established by the STEP 41
 * Amadeus *discovery* mapping
 * (`services/realDiscovery/amadeusMapping.ts`), applied to the execution domain.
 *
 * The STEP 59 contract is deliberately identifiers-only:
 *
 *   { id, kind: 'trip-execution-provider-request', dispatchId }
 *
 * There is no operation, no traveler, no price, and no payment field in it. That
 * single fact drives this whole module:
 *
 * 1. **Validate, never repair.** The request is checked with the domain's own
 *    `isTripExecutionProviderRequest`, which also proves the id still derives
 *    exactly from the dispatch id. Anything else is `null`, so the adapter
 *    reports `rejected` for a malformed request instead of guessing.
 * 2. **Identity and dispatch are preserved exactly.** The Amadeus-side id is
 *    derived deterministically from the same provider-request id, and `requestId`
 *    / `dispatchId` are copied verbatim, so a result can always be traced back
 *    to the dispatch that produced it. No clock, no entropy, no generated text.
 * 3. **No operation is ever invented.** The contract does not carry one, so
 *    `operation` is always `null` here. Deriving an operation from a string, a
 *    URL, or a guess would be exactly the kind of silent fabrication this step
 *    forbids, and it would be the first step toward an irreversible action.
 * 4. **Fail closed on insufficient execution information.**
 *    `auditAmadeusExecutionInput` reports the *names* of the inputs a real
 *    operation would require - and never their values - so a caller can see why
 *    the boundary is closed instead of receiving a fabricated payload. Because
 *    the STEP 59 request is identity-only, the audit is deterministically
 *    insufficient for every request in this step.
 * 5. **No traveler, payment, booking, or reservation data is created, defaulted,
 *    or echoed**, and no credential, token, or raw provider response ever appears
 *    in the mapped value. The mapped object holds identifiers and one honest
 *    `null`.
 *
 * Pure and side-effect free: no network, clock, SDK, `any`, generic
 * `Record<string, any>`, React, Firebase, Router, Zustand, or persistence. The
 * only imports are the STEP 59 contract and the shared provider identity bound.
 */

import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
} from '../tripExecution/tripExecutionProvider';

/**
 * The deterministic, Amadeus-side prefix for mapped execution-request ids. Kept
 * distinct from the STEP 59 provider-request id space so a mapped id can never
 * be mistaken for the provider-neutral request that produced it.
 */
export const AMADEUS_EXECUTION_REQUEST_ID_PREFIX = 'amadeus-execution-request:' as const;

/** The single explicit kind carried by every mapped Amadeus execution request. */
export const AMADEUS_EXECUTION_REQUEST_KIND = 'amadeus-execution-request' as const;

/**
 * Upper bound on an operation name. Present so a future, real operation name is
 * forced through a bound; unused in this step because no operation is ever
 * derived from the identity-only STEP 59 request.
 */
export const MAX_AMADEUS_EXECUTION_OPERATION_LENGTH = 100;

/**
 * The inputs a real Amadeus execution operation would need before it could be
 * attempted. These are the *names* of required inputs only - this module never
 * creates a value for any of them, and the audit reports names, not values.
 * They are read from the caller-supplied input bag, never invented.
 */
export const AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS: ReadonlyArray<string> = Object.freeze([
  'operation',
  'travelerIdentity',
  'paymentAuthorization',
]);

/**
 * The Amadeus-side, provider-specific request shape. Identifiers plus one
 * honest `operation: null`: because the STEP 59 request carries no operation and
 * this step fabricates nothing, no operation name is ever present. The
 * `readonly` fields make it impossible for a caller to mutate an identity after
 * it has been mapped.
 */
export interface AmadeusExecutionRequest {
  readonly id: string;
  readonly kind: typeof AMADEUS_EXECUTION_REQUEST_KIND;
  /** The provider-neutral STEP 59 request id this mapping answers, verbatim. */
  readonly requestId: string;
  /** The STEP 58 dispatch id this request answers, verbatim. */
  readonly dispatchId: string;
  /** Always `null` in this step: no operation is derived or fabricated. */
  readonly operation: string | null;
}

/**
 * The bounded, value-free report of which required execution inputs are absent.
 * `missingInput` holds only key names - never values, never credentials, never
 * traveler or payment data - so it is safe to log or surface verbatim.
 */
export interface AmadeusExecutionInputAudit {
  /** Whether every required input name was present and usable. */
  readonly sufficient: boolean;
  /** The names of the absent required inputs, in declaration order. */
  readonly missingInput: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresentAndUsable(value: unknown): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_AMADEUS_EXECUTION_OPERATION_LENGTH;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return isRecord(value);
}

/**
 * The deterministic Amadeus-side id for a provider-neutral provider-request id:
 * `amadeus-execution-request:<providerRequestId>`. Same request -> same id;
 * different request -> different id. No timestamps, no randomness, no generated
 * text. A non-string or empty id yields `null` rather than a malformed identity.
 */
export function getAmadeusExecutionRequestId(requestId: unknown): string | null {
  if (typeof requestId !== 'string') return null;
  if (!requestId.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX)) return null;
  if (requestId.length <= TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length) return null;
  return `${AMADEUS_EXECUTION_REQUEST_ID_PREFIX}${requestId}`;
}

/**
 * The pure mapping from the provider-neutral STEP 59 request to the Amadeus-side
 * execution request, or `null` for a malformed request. Validates with the
 * domain contract, derives the Amadeus-side id deterministically, copies
 * `requestId` / `dispatchId` verbatim, and leaves `operation` `null` rather than
 * deriving one. It never calls a provider, performs no network request, performs
 * no persistence, and creates no traveler, payment, booking, or reservation
 * value.
 */
export function mapAmadeusExecutionRequest(
  request: TripExecutionProviderRequest | unknown
): AmadeusExecutionRequest | null {
  if (!isTripExecutionProviderRequest(request)) return null;

  const id = getAmadeusExecutionRequestId(request.id);
  if (id === null) return null;

  return {
    id,
    kind: AMADEUS_EXECUTION_REQUEST_KIND,
    requestId: request.id,
    dispatchId: request.dispatchId,
    operation: null,
  };
}

/** True when `value` is a structurally valid mapped Amadeus execution request. */
export function isAmadeusExecutionRequest(value: unknown): value is AmadeusExecutionRequest {
  if (!isRecord(value)) return false;
  if (value.kind !== AMADEUS_EXECUTION_REQUEST_KIND) return false;
  if (value.operation !== null) return false;
  if (typeof value.requestId !== 'string') return false;
  if (typeof value.dispatchId !== 'string') return false;
  return getAmadeusExecutionRequestId(value.requestId) === value.id;
}

/**
 * Reports whether a caller-supplied input bag carries every required execution
 * input name, and which are absent - by name only, never by value. This is how
 * the boundary fails closed: with the identity-only STEP 59 request, the audit
 * is always insufficient, so no execution operation can be attempted and no
 * missing value is ever defaulted or fabricated. Never throws.
 */
export function auditAmadeusExecutionInput(
  inputs: unknown
): AmadeusExecutionInputAudit {
  const bag = isRecord(inputs) ? inputs : {};
  const missingInput = AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS.filter(
    (key) => !isPresentAndUsable(bag[key])
  );
  return Object.freeze({
    sufficient: missingInput.length === 0,
    missingInput: Object.freeze([...missingInput]),
  });
}

/**
 * Bounded, credential-free, value-free message explaining why the execution
 * boundary is closed for a given audit. Contains only the missing *names*, so it
 * can be surfaced or logged without leaking traveler, payment, or secret data.
 */
export function getAmadeusExecutionInsufficientInformationMessage(
  audit: AmadeusExecutionInputAudit
): string {
  if (audit.sufficient) {
    return 'Amadeus execution input audit passed; no operation is implemented in this build.';
  }
  return `Amadeus execution requires: ${audit.missingInput.join(', ')}.`;
}
