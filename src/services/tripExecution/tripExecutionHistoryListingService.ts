/**
 * STEP 86 - trip execution history listing service.
 *
 * Provider-neutral read composition layer that retrieves a trip's Step 78
 * TripExecutionRecords via the injected Step 79 TripExecutionRecordRepository
 * and projects them into the Step 85 TripExecutionHistory read model.
 *
 * It delegates validation of the returned records to the existing Step 78
 * validator (through the Step 85 factory), preserves repository order exactly,
 * and fails closed on malformed or mixed-trip results. It adds no caching,
 * retries, pagination, filtering, sorting, grouping, deduplication, or
 * persistence. No Firebase, Firestore, providers, orchestration, network,
 * environment, or browser storage access.
 */
import { isValidStorageId } from '../../services/tripSerialization';
import { createTripExecutionHistory, type TripExecutionHistory } from './tripExecutionHistory';
import type { TripExecutionRecordRepository } from './tripExecutionRecordRepository';

export interface ListExecutionHistoryInput {
  tripId: string;
}

export interface TripExecutionHistoryListingService {
  listExecutionHistory(input: unknown): Promise<TripExecutionHistory>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Trip identity follows the existing storage-ID validation convention used by
 * Steps 78 and 83: a non-empty, unpadded storage id safe for a document path.
 */
function isValidTripId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  return isValidStorageId(value);
}

function isValidRepository(implementation: unknown): implementation is TripExecutionRecordRepository {
  if (!isObject(implementation)) return false;
  const repo = implementation as Record<string, unknown>;
  if (typeof repo.listByTripId !== 'function') return false;
  return true;
}

export function createTripExecutionHistoryListingService(
  repository: TripExecutionRecordRepository
): TripExecutionHistoryListingService {
  if (!isValidRepository(repository)) {
    throw new TypeError('Invalid TripExecutionRecordRepository implementation');
  }

  const repo = repository;

  return {
    async listExecutionHistory(input: unknown): Promise<TripExecutionHistory> {
      if (!isObject(input)) {
        throw new TypeError('Invalid ListExecutionHistoryInput');
      }

      const { tripId } = input as unknown as ListExecutionHistoryInput;

      if (!isValidTripId(tripId)) {
        throw new TypeError('Invalid ListExecutionHistoryInput');
      }

      const records = await repo.listByTripId(tripId);
      const history = createTripExecutionHistory(records);

      // A conforming repository returns records for the requested trip. Verify
      // the projected history agrees, mirroring the Step 83 identity check, so
      // cross-trip records can never be surfaced as this trip's history.
      if (history.tripId !== null && history.tripId !== tripId) {
        throw new TypeError('Invalid trip execution history: trip mismatch');
      }

      return history;
    },
  };
}
