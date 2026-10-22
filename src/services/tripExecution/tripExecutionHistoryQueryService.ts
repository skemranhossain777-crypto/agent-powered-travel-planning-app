/**
 * STEP 88 - read-only execution history query service.
 *
 * Provider-neutral service-layer composition that turns a trip id into a
 * display-ready execution history. It delegates retrieval to the injected
 * STEP 86 TripExecutionHistoryListingService and projects the result through the
 * STEP 87 `createTripExecutionHistoryPresentation` factory.
 *
 * It never queries the repository directly, never reaches Firebase or Firestore,
 * and adds no caching, retries, sorting, filtering, grouping, pagination, or
 * side effects. It preserves item order, provider attribution, provider results,
 * the nullable aggregate status, and `executed` exactly as the delegated layers
 * produced them. Existing validation and retrieval errors are propagated, never
 * converted into an empty history.
 */
import {
  createTripExecutionHistoryPresentation,
  type TripExecutionHistoryPresentation,
} from './tripExecutionHistoryPresentation';
import type { TripExecutionHistoryListingService } from './tripExecutionHistoryListingService';

export interface GetExecutionHistoryInput {
  tripId: string;
}

export interface TripExecutionHistoryQueryService {
  getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidListingService(
  implementation: unknown
): implementation is TripExecutionHistoryListingService {
  if (!isObject(implementation)) return false;
  const listing = implementation as Record<string, unknown>;
  if (typeof listing.listExecutionHistory !== 'function') return false;
  return true;
}

/**
 * Creates the read-only query service over an injected STEP 86 listing service.
 * The dependency is validated at construction and is not invoked during
 * validation.
 */
export function createTripExecutionHistoryQueryService(
  listingService: TripExecutionHistoryListingService
): TripExecutionHistoryQueryService {
  if (!isValidListingService(listingService)) {
    throw new TypeError('Invalid TripExecutionHistoryListingService implementation');
  }

  const listing = listingService;

  return {
    async getExecutionHistory(input: unknown): Promise<TripExecutionHistoryPresentation> {
      if (!isObject(input)) {
        throw new TypeError('Invalid GetExecutionHistoryInput');
      }

      const { tripId } = input as unknown as GetExecutionHistoryInput;

      // Delegate retrieval and trip-id validation to the STEP 86 listing service,
      // then project through the STEP 87 factory (which re-validates the history).
      const history = await listing.listExecutionHistory({ tripId });
      return createTripExecutionHistoryPresentation(history);
    },
  };
}
