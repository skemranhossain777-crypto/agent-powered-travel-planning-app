/**
 * STEP 82 - trip execution record persistence service.
 *
 * Provider-neutral composition layer that creates a Step 78 TripExecutionRecord
 * from a Step 77 execution outcome/receipt and persists it via the injected
 * Step 79 TripExecutionRecordRepository. No Firebase, Firestore, providers,
 * orchestration, network, environment, or browser storage access.
 */
import { createTripExecutionRecord, type TripExecutionRecord } from './tripExecutionRecord';
import type { TripExecutionRecordRepository } from './tripExecutionRecordRepository';
import type { TripExecutionOutcomeReceipt } from './tripExecutionOutcomeReceipt';

export interface SaveExecutionOutcomeInput {
  tripId: string;
  receipt: TripExecutionOutcomeReceipt;
}

export interface TripExecutionRecordService {
  saveExecutionOutcome(input: unknown): Promise<TripExecutionRecord>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTripExecutionOutcomeReceiptLike(
  value: unknown
): value is TripExecutionOutcomeReceipt {
  return isObject(value);
}

function isValidRepository(implementation: unknown): implementation is TripExecutionRecordRepository {
  if (!isObject(implementation)) return false;
  const repo = implementation as Record<string, unknown>;
  if (typeof repo.save !== 'function') return false;
  if (typeof repo.getById !== 'function') return false;
  return true;
}

export function createTripExecutionRecordService(
  repository: TripExecutionRecordRepository
): TripExecutionRecordService {
  if (!isValidRepository(repository)) {
    throw new TypeError('Invalid TripExecutionRecordRepository implementation');
  }

  const repo = repository;

  return {
    async saveExecutionOutcome(input: unknown): Promise<TripExecutionRecord> {
      if (!isObject(input)) {
        throw new TypeError('Invalid SaveExecutionOutcomeInput');
      }

      const { tripId, receipt } = input as unknown as SaveExecutionOutcomeInput;

      if (typeof tripId !== 'string') {
        throw new TypeError('Invalid SaveExecutionOutcomeInput');
      }
      if (!isTripExecutionOutcomeReceiptLike(receipt)) {
        throw new TypeError('Invalid SaveExecutionOutcomeInput');
      }

      const record = createTripExecutionRecord({ tripId, receipt });
      if (record === null) {
        throw new TypeError('Invalid execution outcome');
      }

      await repo.save(record);
      return record;
    },
  };
}
