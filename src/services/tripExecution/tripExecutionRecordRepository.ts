/**
 * STEP 79 - trip execution record persistence contract.
 *
 * This module defines a provider-neutral persistence contract for Step 78's
 * `TripExecutionRecord`. It does not implement Firestore persistence, does not
 * import Firebase, does not execute providers, and does not mutate records.
 */

import type { TripExecutionRecord } from './tripExecutionRecord';

export interface TripExecutionRecordRepository {
  save(record: TripExecutionRecord): Promise<void>;
  getById(tripId: string, recordId: string): Promise<TripExecutionRecord | null>;
  listByTripId(tripId: string): Promise<TripExecutionRecord[]>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRepositoryImplementation(
  implementation: unknown
): implementation is TripExecutionRecordRepository {
  if (!isObject(implementation)) return false;
  const repo = implementation as Record<string, unknown>;
  if (typeof repo.save !== 'function') return false;
  if (typeof repo.getById !== 'function') return false;
  if (typeof repo.listByTripId !== 'function') return false;
  return true;
}

/**
 * Validates and exposes a repository implementation through the contract.
 * Does not create defaults, does not instantiate external services,
 * and does not invoke repository methods during validation.
 */
export function createTripExecutionRecordRepository(
  implementation: TripExecutionRecordRepository
): TripExecutionRecordRepository {
  if (!isValidRepositoryImplementation(implementation)) {
    throw new TypeError('Invalid TripExecutionRecordRepository implementation');
  }
  return implementation;
}
