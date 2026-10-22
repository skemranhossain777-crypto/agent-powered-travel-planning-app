/**
 * STEP 91 - trip execution history composition factory.
 *
 * Composes the existing execution-history components (Steps 86, 88, 89, 90)
 * into a single consumer-facing API. It accepts an injected execution-record
 * repository via the existing TripExecutionRecordRepository contract, wires the
 * factories in order, and returns the final TripExecutionHistoryConsumer
 * contract.
 *
 * This is a pure composition boundary: it performs no repository reads,
 * instantiates no Firebase/Firestore clients, makes no network calls, accesses
 * no credentials, and has no side effects at construction time. Repository
 * reads occur only when the consumer's getExecutionHistory method is invoked.
 * The returned API exposes only the consumer's history-query operation; it
 * does not expose internal pipeline stages.
 */
import type { TripExecutionRecordRepository } from './tripExecutionRecordRepository';
import { createTripExecutionHistoryListingService } from './tripExecutionHistoryListingService';
import { createTripExecutionHistoryQueryService } from './tripExecutionHistoryQueryService';
import { createTripExecutionHistoryAccess } from './tripExecutionHistoryAccess';
import { createTripExecutionHistoryConsumer, type TripExecutionHistoryConsumer } from './tripExecutionHistoryConsumer';

export type { TripExecutionHistoryConsumer };

/**
 * Creates a consumer-facing execution history API composed from the existing
 * execution-history pipeline. The dependency is validated at construction via
 * the injected repository's existing contract (Step 79). Construction is
 * deterministic and side-effect-free.
 */
export function createTripExecutionHistoryComposition(
  repository: TripExecutionRecordRepository
): TripExecutionHistoryConsumer {
  // Wire in order: Listing (86) -> Query (88) -> Access (89) -> Consumer (90)
  const listingService = createTripExecutionHistoryListingService(repository);
  const queryService = createTripExecutionHistoryQueryService(listingService);
  const access = createTripExecutionHistoryAccess(queryService);
  const consumer = createTripExecutionHistoryConsumer(access);

  return consumer;
}
