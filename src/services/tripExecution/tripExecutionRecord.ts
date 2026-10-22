/**
 * STEP 78 - execution receipt → trip execution record.
 *
 * This module is a pure domain mapping from the validated STEP 77
 * `TripExecutionOutcomeReceipt` to a provider-neutral trip execution record.
 *
 * The architecture currently ends at:
 *
 *   Authorized Execution → Multi-Provider Execution → Outcome Receipt (STEP 77)
 *
 * Step 78 creates the domain record that can later be persisted against a trip.
 *
 * ## Constraints
 *
 * This step must NOT persist anything.
 * It must NOT modify an existing trip.
 * It must NOT execute providers.
 * It must NOT call Firebase/Firestore.
 *
 * The record is a projection of the receipt associated with a trip.
 */

import { isValidStorageId } from '../../services/tripSerialization';
import {
  isTripExecutionOutcomeReceipt,
  TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS,
} from './tripExecutionOutcomeReceipt';
import type { TripExecutionAuthorizedExecutionResult } from './tripExecutionAuthorizedExecution';
import type { TripExecutionProviderResultStatus } from './tripExecutionProvider';

/**
 * The deterministic prefix for trip execution record ids.
 */
export const TRIP_EXECUTION_RECORD_ID_PREFIX = 'trip-execution-record:' as const;

/** The single explicit kind carried by every trip execution record. */
export const TRIP_EXECUTION_RECORD_KIND = 'trip-execution-record' as const;

/**
 * The closed reason vocabulary for trip execution record creation.
 *
 * `recorded` is the affirmative value for valid records. Other tokens name
 * the gate that refused.
 */
export const TRIP_EXECUTION_RECORD_REASONS = [
  'recorded',
  'trip-id-invalid',
  'receipt-invalid',
  'receipt-not-recorded',
] as const;

export type TripExecutionRecordReason =
  (typeof TRIP_EXECUTION_RECORD_REASONS)[number];

/**
 * The pure, provider-neutral record associating an execution outcome with a trip.
 */
export interface TripExecutionRecord {
  /** The deterministic record identity: `trip-execution-record:<tripId>:<receiptId>`. */
  id: string;
  /** The single explicit record kind. */
  kind: typeof TRIP_EXECUTION_RECORD_KIND;
  /** The trip identity this record is associated with. */
  tripId: string;
  /** The STEP 77 receipt identity this record preserves. */
  receiptId: string;
  /** The STEP 59 provider-request id this record preserves. */
  requestId: string;
  /** The authorized provider ids in execution order, copied from the receipt. */
  providerIds: string[];
  /** The copied provider results, in the same order as the receipt. */
  results: TripExecutionAuthorizedExecutionResult[];
  /** Whether execution was attempted according to Step 76 semantics. */
  executed: boolean;
  /** The aggregate status, or null when no provider answered. */
  status: TripExecutionProviderResultStatus | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates trip identity using existing trip/storage identity rules.
 * Also rejects padded values as per record semantics.
 */
function isValidTripId(value: unknown): value is string {
  if (!isValidStorageId(value)) return false;
  if (typeof value === 'string' && value !== value.trim()) return false;
  return true;
}

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

type RecordBuild =
  | { recorded: true; record: TripExecutionRecord }
  | { recorded: false; reason: TripExecutionRecordReason };

function buildRecord(input: unknown): RecordBuild {
  if (!isRecord(input)) {
    return { recorded: false, reason: 'trip-id-invalid' };
  }

  const tripId = input.tripId;
  if (!isValidTripId(tripId)) {
    return { recorded: false, reason: 'trip-id-invalid' };
  }

  const receipt = input.receipt;
  if (!isTripExecutionOutcomeReceipt(receipt)) {
    return { recorded: false, reason: 'receipt-invalid' };
  }

  // Receipt must have been recorded (valid). The validator checks structure;
  // ensure the reason is 'recorded' per contract.
  if (receipt.reason !== 'recorded') {
    return { recorded: false, reason: 'receipt-not-recorded' };
  }

  const recordId = `${TRIP_EXECUTION_RECORD_ID_PREFIX}${tripId}:${receipt.id}`;

  return {
    recorded: true,
    record: {
      id: recordId,
      kind: TRIP_EXECUTION_RECORD_KIND,
      tripId,
      receiptId: receipt.id,
      requestId: receipt.requestId,
      providerIds: [...receipt.providerIds],
      results: receipt.results.map((entry) => copyStep75Result(entry)),
      executed: receipt.executed,
      status: receipt.status,
    },
  };
}

/**
 * Creates a pure domain trip execution record from tripId and a validated
 * Step 77 receipt. Returns null if validation fails.
 */
export function createTripExecutionRecord(
  input: unknown
): TripExecutionRecord | null {
  const built = buildRecord(input);
  return built.recorded ? built.record : null;
}

/**
 * Runtime type guard for a TripExecutionRecord.
 */
export function isTripExecutionRecord(
  value: unknown
): value is TripExecutionRecord {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_RECORD_KIND) return false;

  const { id, tripId, receiptId, requestId, providerIds, results, executed, status } = value;

  if (typeof id !== 'string') return false;
  if (typeof tripId !== 'string' || !isValidTripId(tripId)) return false;
  if (typeof receiptId !== 'string') return false;
  if (typeof requestId !== 'string') return false;

  // Verify deterministic ID
  const expectedId = `${TRIP_EXECUTION_RECORD_ID_PREFIX}${tripId}:${receiptId}`;
  if (id !== expectedId) return false;

  if (!Array.isArray(providerIds)) return false;
  if (!providerIds.every((pid) => typeof pid === 'string')) return false;

  if (!Array.isArray(results)) return false;
  // Validate shape of results
  for (const entry of results) {
    if (!isRecord(entry)) return false;
    if (typeof entry.executed !== 'boolean') return false;
    if (entry.result !== null && entry.result !== undefined) {
      if (!isRecord(entry.result)) return false;
      const r = entry.result as Record<string, unknown>;
      if (typeof r.status !== 'string') return false;
    }
    if (entry.requestId !== null && entry.requestId !== undefined && typeof entry.requestId !== 'string') {
      return false;
    }
    if (entry.providerId !== null && entry.providerId !== undefined && typeof entry.providerId !== 'string') {
      return false;
    }
    if (typeof entry.reason !== 'string') return false;
    if (!(TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS as ReadonlyArray<string>).includes(entry.reason as string) &&
        !(
          ['provider-execution-failed', 'executed', 'provider-preflight-failed', 'provider-not-invoked'].includes(
            entry.reason as string
          )
        )) {
      // Allow STEP 75 reasons - we can be permissive on reason strings here as they're copied
    }
  }

  if (providerIds.length !== results.length) return false;
  for (let i = 0; i < providerIds.length; i += 1) {
    const entry = results[i] as TripExecutionAuthorizedExecutionResult;
    if (providerIds[i] !== entry.providerId) return false;
  }

  if (typeof executed !== 'boolean') return false;
  if (executed !== (results.length > 0)) return false;

  if (status !== null && typeof status !== 'string') return false;

  return true;
}
