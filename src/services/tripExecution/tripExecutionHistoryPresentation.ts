/**
 * STEP 87 - trip execution history presentation contract.
 *
 * Pure, provider-neutral presentation model that projects the STEP 85
 * TripExecutionHistory read model into display-ready summaries. This module
 * defines the presentation contract only: it does not render UI, does not read
 * the clock, does not sort, group, filter, or infer booking state, and does not
 * import Firebase, Firestore, repositories, listing services, network clients,
 * provider execution, React, Zustand, Router, browser storage, or environment
 * variables.
 *
 * Every label is derived deterministically from validated STEP 59/77-85
 * contract fields. No label claims that a booking, reservation, ticket, payment,
 * or any external action succeeded: the STEP 59 vocabulary describes a
 * provider's response to a request, not a completed business outcome, and a
 * `null` aggregate status means no provider answered rather than a failure.
 */
import {
  isTripExecutionHistory,
  type TripExecutionHistory,
  type TripExecutionHistoryItem,
} from './tripExecutionHistory';
import {
  isTripExecutionProviderResultStatus,
  type TripExecutionProviderResultStatus,
} from './tripExecutionProvider';

const PRESENTATION_KIND = 'trip-execution-history-presentation' as const;
const PRESENTATION_ITEM_KIND = 'trip-execution-history-presentation-item' as const;

/**
 * A display-ready, provider-neutral summary of one execution history item.
 *
 * `id` is the STEP 78 execution record identity, `receiptId` the STEP 77
 * receipt identity, and `requestId` the STEP 59 provider-request identity. The
 * provider attribution (`providerIds`) and per-provider `results` are preserved
 * verbatim and copied, never reinterpreted. `status` preserves the nullable
 * STEP 85 aggregate, and the two labels are derived from it and `executed`.
 */
export interface TripExecutionHistoryPresentationItem {
  kind: typeof PRESENTATION_ITEM_KIND;
  /** The STEP 78 execution record identity. */
  id: string;
  /** The STEP 77 receipt identity. */
  receiptId: string;
  /** The STEP 59 provider-request identity. */
  requestId: string;
  /** The authorized provider ids, in original execution order. */
  providerIds: string[];
  /** The copied provider results, in the same order as `providerIds`. */
  results: TripExecutionHistoryItem['results'];
  /** Whether execution was attempted (STEP 76 semantics); never a success claim. */
  executed: boolean;
  /** The aggregate status, or `null` when no provider answered. */
  status: TripExecutionProviderResultStatus | null;
  /** Deterministic, provider-neutral human-readable label for `status`. */
  statusLabel: string;
  /** Deterministic, provider-neutral human-readable label for `executed`. */
  executionLabel: string;
}

/**
 * The top-level presentation. Preserves the trip identity and the original
 * history item ordering; `tripId` is `null` exactly when there are no items.
 */
export interface TripExecutionHistoryPresentation {
  kind: typeof PRESENTATION_KIND;
  tripId: string | null;
  items: TripExecutionHistoryPresentationItem[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deterministic, provider-neutral label for the aggregate status. The
 * "(provider response)" qualifier keeps the label honest: a STEP 59 status is a
 * provider's answer about a request, never proof of a completed booking. A
 * `null` status means no provider answered, so it is labelled neutrally rather
 * than as a failure.
 */
function getTripExecutionStatusLabel(status: TripExecutionProviderResultStatus | null): string {
  switch (status) {
    case 'accepted':
      return 'Accepted (provider response)';
    case 'rejected':
      return 'Rejected (provider response)';
    case 'unsupported':
      return 'Unsupported (provider response)';
    case 'failed':
      return 'Failed (provider response)';
    case null:
      return 'No provider response';
  }
}

/**
 * Deterministic, provider-neutral label for the execution state. `executed`
 * records only that the authorized providers were attempted; it is never a
 * booking or success claim.
 */
function getTripExecutionExecutionLabel(executed: boolean): string {
  return executed ? 'Execution attempted' : 'Not executed';
}

function copyProviderIds(providerIds: string[]): string[] {
  return providerIds.map((id) => id);
}

function copyResults(
  results: TripExecutionHistoryItem['results']
): TripExecutionHistoryItem['results'] {
  return results.map((entry) => ({
    executed: entry.executed,
    result: entry.result === null ? null : { ...entry.result },
    requestId: entry.requestId,
    providerId: entry.providerId,
    reason: entry.reason,
  }));
}

function toPresentationItem(
  item: TripExecutionHistoryItem
): TripExecutionHistoryPresentationItem {
  return {
    kind: PRESENTATION_ITEM_KIND,
    id: item.id,
    receiptId: item.receiptId,
    requestId: item.requestId,
    providerIds: copyProviderIds(item.providerIds),
    results: copyResults(item.results),
    executed: item.executed,
    status: item.status,
    statusLabel: getTripExecutionStatusLabel(item.status),
    executionLabel: getTripExecutionExecutionLabel(item.executed),
  };
}

/**
 * Creates the pure, provider-neutral presentation from a STEP 85 execution
 * history.
 *
 * The input is re-validated through the existing STEP 85 `isTripExecutionHistory`
 * validator rather than trusted, so a malformed history is rejected instead of
 * being projected. Ordering and provider attribution are preserved exactly; the
 * function is pure and deterministic (no clock, randomness, or environment read),
 * so two calls with the same input produce equivalent presentations.
 */
export function createTripExecutionHistoryPresentation(
  input: unknown
): TripExecutionHistoryPresentation {
  if (!isTripExecutionHistory(input)) {
    throw new TypeError('Invalid trip execution history');
  }

  const history: TripExecutionHistory = input;
  return {
    kind: PRESENTATION_KIND,
    tripId: history.tripId,
    items: history.items.map(toPresentationItem),
  };
}

function isValidProviderIds(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((id) => typeof id === 'string');
}

/**
 * Structural check for one copied STEP 75 result entry, matching the STEP 85
 * read model's accepted shape. The status is checked against the shared STEP 59
 * vocabulary; the identities are copied verbatim and so are only required to be
 * strings.
 */
function isValidProviderResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.providerId !== 'string') return false;
  if (typeof value.requestId !== 'string') return false;
  return isTripExecutionProviderResultStatus(value.status);
}

function isValidResults(value: unknown): value is TripExecutionHistoryItem['results'] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!isObject(entry)) return false;
    if (typeof entry.executed !== 'boolean') return false;
    const result = entry.result;
    if (result !== null && result !== undefined) {
      if (!isValidProviderResult(result)) return false;
    }
    if (
      entry.requestId !== null &&
      entry.requestId !== undefined &&
      typeof entry.requestId !== 'string'
    ) {
      return false;
    }
    if (
      entry.providerId !== null &&
      entry.providerId !== undefined &&
      typeof entry.providerId !== 'string'
    ) {
      return false;
    }
    if (typeof entry.reason !== 'string') return false;
  }
  return true;
}

function isPresentationItem(value: unknown): value is TripExecutionHistoryPresentationItem {
  if (!isObject(value)) return false;
  if (value.kind !== PRESENTATION_ITEM_KIND) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.receiptId !== 'string') return false;
  if (typeof value.requestId !== 'string') return false;

  const providerIds = value.providerIds;
  if (!isValidProviderIds(providerIds)) return false;
  const results = value.results;
  if (!isValidResults(results)) return false;
  if (providerIds.length !== results.length) return false;
  for (let index = 0; index < providerIds.length; index++) {
    if (providerIds[index] !== results[index].providerId) return false;
  }

  if (typeof value.executed !== 'boolean') return false;
  if (value.executed !== (results.length > 0)) return false;

  const status = value.status;
  if (status !== null && !isTripExecutionProviderResultStatus(status)) return false;

  if (typeof value.statusLabel !== 'string') return false;
  if (typeof value.executionLabel !== 'string') return false;
  if (value.statusLabel !== getTripExecutionStatusLabel(status)) return false;
  if (value.executionLabel !== getTripExecutionExecutionLabel(value.executed)) return false;

  return true;
}

/**
 * True when `value` is a complete, self-consistent STEP 87 presentation: the
 * closed kinds, the nullable trip identity, and every item's ids, provider
 * attribution, results, execution state, nullable status, and derived labels.
 */
export function isTripExecutionHistoryPresentation(
  value: unknown
): value is TripExecutionHistoryPresentation {
  if (!isObject(value)) return false;
  if (value.kind !== PRESENTATION_KIND) return false;
  if (value.tripId !== null && typeof value.tripId !== 'string') return false;
  if (!Array.isArray(value.items)) return false;
  for (const item of value.items) {
    if (!isPresentationItem(item)) return false;
  }
  return true;
}
