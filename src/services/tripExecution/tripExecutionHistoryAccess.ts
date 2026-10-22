/**
 * STEP 89 - execution history consumer access contract.
 *
 * A small, provider-neutral access boundary a future application layer can
 * depend on. It injects the STEP 88 TripExecutionHistoryQueryService and
 * delegates each request to it exactly once, returning the query service's
 * presentation unchanged.
 *
 * This module is an access boundary, not a second query implementation: it does
 * not query repositories or listing services directly, does not re-validate or
 * reconstruct the presentation, and adds no caching, retries, logging, sorting,
 * filtering, persistence, side effects, or booking/payment/reservation/provider
 * execution capabilities. No Firebase, Firestore, network, provider execution,
 * React, Zustand, Router, browser storage, environment, or clock dependency.
 */
import type { TripExecutionHistoryPresentation } from './tripExecutionHistoryPresentation';
import type {
  GetExecutionHistoryInput,
  TripExecutionHistoryQueryService,
} from './tripExecutionHistoryQueryService';

export type { GetExecutionHistoryInput };

/**
 * The consumer-facing access contract. It exposes a single read-only operation
 * and deliberately mirrors the query service's signature so the presentation
 * result passes through without reinterpretation.
 */
export interface TripExecutionHistoryAccess {
  getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidQueryService(
  implementation: unknown
): implementation is TripExecutionHistoryQueryService {
  if (!isObject(implementation)) return false;
  const queryService = implementation as Record<string, unknown>;
  if (typeof queryService.getExecutionHistory !== 'function') return false;
  return true;
}

/**
 * Creates the access boundary over an injected STEP 88 query service. The
 * dependency is validated at construction and is not invoked during validation.
 */
export function createTripExecutionHistoryAccess(
  queryService: TripExecutionHistoryQueryService
): TripExecutionHistoryAccess {
  if (!isValidQueryService(queryService)) {
    throw new TypeError('Invalid TripExecutionHistoryQueryService implementation');
  }

  const query = queryService;

  return {
    async getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation> {
      return query.getExecutionHistory(input);
    },
  };
}
