/**
 * STEP 90 - execution history consumer integration seam.
 *
 * A dependency-injection seam that lets a future application layer receive the
 * STEP 89 TripExecutionHistoryAccess contract without coupling to its concrete
 * implementation. The consumer depends only on the access interface and the
 * shared presentation type; it never imports or constructs the access factory,
 * and never reaches repositories, listing services, or query services directly.
 *
 * It delegates each request to `access.getExecutionHistory(input)` exactly once,
 * returns the presentation unchanged, and propagates errors as-is. It adds no
 * caching, retries, logging, sorting, filtering, persistence, side effects, or
 * booking/payment/reservation/provider-execution capabilities.
 */
import type { TripExecutionHistoryAccess } from './tripExecutionHistoryAccess';
import type { TripExecutionHistoryPresentation } from './tripExecutionHistoryPresentation';

/**
 * The consumer-facing integration contract. It mirrors the access contract's
 * single read-only operation so the presentation passes through unchanged.
 */
export interface TripExecutionHistoryConsumer {
  getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidAccess(implementation: unknown): implementation is TripExecutionHistoryAccess {
  if (!isObject(implementation)) return false;
  const access = implementation as Record<string, unknown>;
  if (typeof access.getExecutionHistory !== 'function') return false;
  return true;
}

/**
 * Creates the consumer seam over an injected STEP 89 access contract. The
 * dependency is validated at construction and is not invoked during validation.
 */
export function createTripExecutionHistoryConsumer(
  access: TripExecutionHistoryAccess
): TripExecutionHistoryConsumer {
  if (!isValidAccess(access)) {
    throw new TypeError('Invalid TripExecutionHistoryAccess implementation');
  }

  const injectedAccess = access;

  return {
    async getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation> {
      return injectedAccess.getExecutionHistory(input);
    },
  };
}
