/**
 * STEP 85 - Trip Execution History Read Model
 *
 * Pure, provider-neutral execution history projection from TripExecutionRecord[].
 * This module must not import Firebase, Firestore, React, Router, Zustand,
 * provider adapters, network clients, or execution orchestration.
 * Preserves ordering and execution semantics. Fails closed on invalid input.
 */
import { isTripExecutionRecord, type TripExecutionRecord } from './tripExecutionRecord';
import { isTripExecutionProviderResultStatus } from './tripExecutionProvider';

const EXECUTION_HISTORY_ITEM_KIND = 'trip-execution-history-item' as const;
const EXECUTION_HISTORY_HISTORY_KIND = 'trip-execution-history' as const;

export interface TripExecutionHistoryItem {
  kind: typeof EXECUTION_HISTORY_ITEM_KIND;
  id: string;
  tripId: string;
  receiptId: string;
  requestId: string;
  providerIds: string[];
  results: TripExecutionRecord['results'];
  executed: boolean;
  status: TripExecutionRecord['status'];
}

export interface TripExecutionHistory {
  kind: typeof EXECUTION_HISTORY_HISTORY_KIND;
  tripId: string | null;
  items: TripExecutionHistoryItem[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyProviderIds(providerIds: TripExecutionRecord['providerIds']): string[] {
  return providerIds.map((id) => id);
}

function copyResults(results: TripExecutionRecord['results']): TripExecutionRecord['results'] {
  return results.map((entry) => ({
    executed: entry.executed,
    result: entry.result === null ? null : { ...entry.result },
    requestId: entry.requestId,
    providerId: entry.providerId,
    reason: entry.reason,
  }));
}

function toHistoryItem(record: TripExecutionRecord): TripExecutionHistoryItem {
  return {
    kind: EXECUTION_HISTORY_ITEM_KIND,
    id: record.id,
    tripId: record.tripId,
    receiptId: record.receiptId,
    requestId: record.requestId,
    providerIds: copyProviderIds(record.providerIds),
    results: copyResults(record.results),
    executed: record.executed,
    status: record.status,
  };
}

function isValidProviderIds(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((id) => typeof id === 'string');
}

/**
 * True for the STEP 59 provider result shape: a well-formed provider id, the
 * provider-request id it answers, and a status drawn from the shared STEP 59
 * vocabulary. The contract has no `kind` field.
 */
function isValidProviderResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.providerId !== 'string') return false;
  if (typeof value.requestId !== 'string') return false;
  return isTripExecutionProviderResultStatus(value.status);
}

function isValidResults(value: unknown): value is TripExecutionRecord['results'] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
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

export function createTripExecutionHistory(records: unknown): TripExecutionHistory {
  if (!Array.isArray(records)) {
    throw new TypeError('Invalid trip execution history records: expected array');
  }
  if (records.length === 0) {
    return {
      kind: EXECUTION_HISTORY_HISTORY_KIND,
      tripId: null,
      items: [],
    };
  }
  const items: TripExecutionHistoryItem[] = [];
  let tripId: string | null = null;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!isTripExecutionRecord(record)) {
      throw new TypeError('Invalid trip execution history record');
    }
    if (tripId === null) {
      tripId = record.tripId;
    } else if (tripId !== record.tripId) {
      throw new TypeError('Invalid trip execution history: mixed trip records');
    }
    items.push(toHistoryItem(record));
  }
  return {
    kind: EXECUTION_HISTORY_HISTORY_KIND,
    tripId,
    items,
  };
}

export function isTripExecutionHistory(value: unknown): value is TripExecutionHistory {
  if (!isObject(value)) return false;
  if (value.kind !== EXECUTION_HISTORY_HISTORY_KIND) return false;
  if (value.tripId !== null && typeof value.tripId !== 'string') return false;
  if (!Array.isArray(value.items)) return false;
  for (let i = 0; i < value.items.length; i++) {
    const item = value.items[i];
    if (!isObject(item)) return false;
    if (item.kind !== EXECUTION_HISTORY_ITEM_KIND) return false;
    if (typeof item.id !== 'string') return false;
    if (typeof item.tripId !== 'string') return false;
    if (typeof item.receiptId !== 'string') return false;
    if (typeof item.requestId !== 'string') return false;
    const providerIds = item.providerIds;
    if (!isValidProviderIds(providerIds)) return false;
    const results = item.results;
    if (!isValidResults(results)) return false;
    if (providerIds.length !== results.length) return false;
    for (let j = 0; j < providerIds.length; j++) {
      if (providerIds[j] !== results[j].providerId) return false;
    }
    const executed = item.executed;
    if (typeof executed !== 'boolean') return false;
    if (executed !== (results.length > 0)) return false;
    const status = item.status;
    if (status !== null && !isTripExecutionProviderResultStatus(status)) return false;
  }
  return true;
}
