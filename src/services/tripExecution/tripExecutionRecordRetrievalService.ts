/**
 * STEP 83 - trip execution record retrieval service.
 *
 * Provider-neutral read composition layer that retrieves a Step 78
 * TripExecutionRecord via the injected Step 79 TripExecutionRecordRepository.
 * No Firebase, Firestore, providers, orchestration, network, environment,
 * or browser storage access.
 */
import { isTripExecutionRecord } from './tripExecutionRecord';
import type { TripExecutionRecord } from './tripExecutionRecord';
import type { TripExecutionRecordRepository } from './tripExecutionRecordRepository';
import { isValidStorageId } from '../../services/tripSerialization';

export interface GetExecutionRecordInput {
  tripId: string;
  recordId: string;
}

export interface TripExecutionRecordRetrievalService {
  getExecutionRecord(input: unknown): Promise<TripExecutionRecord | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRecordId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (!isValidStorageId(value)) return false;
  return true;
}

function isValidTripId(value: unknown): value is string {
  return isValidRecordId(value);
}

function isValidRepository(implementation: unknown): implementation is TripExecutionRecordRepository {
  if (!isObject(implementation)) return false;
  const repo = implementation as Record<string, unknown>;
  if (typeof repo.save !== 'function') return false;
  if (typeof repo.getById !== 'function') return false;
  return true;
}

export function createTripExecutionRecordRetrievalService(
  repository: TripExecutionRecordRepository
): TripExecutionRecordRetrievalService {
  if (!isValidRepository(repository)) {
    throw new TypeError('Invalid TripExecutionRecordRepository implementation');
  }

  const repo = repository;

  return {
    async getExecutionRecord(input: unknown): Promise<TripExecutionRecord | null> {
      if (!isObject(input)) {
        throw new TypeError('Invalid GetExecutionRecordInput');
      }

      const { tripId, recordId } = input as unknown as GetExecutionRecordInput;

      if (!isValidTripId(tripId)) {
        throw new TypeError('Invalid GetExecutionRecordInput');
      }
      if (!isValidRecordId(recordId)) {
        throw new TypeError('Invalid GetExecutionRecordInput');
      }

      const result = await repo.getById(tripId, recordId);

      if (result === null) {
        return null;
      }

      if (!isTripExecutionRecord(result)) {
        throw new TypeError('Invalid TripExecutionRecord');
      }

      if (result.tripId !== tripId) {
        throw new TypeError('Invalid TripExecutionRecord');
      }

      if (result.id !== recordId) {
        throw new TypeError('Invalid TripExecutionRecord');
      }

      return result;
    },
  };
}
