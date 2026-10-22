/**
 * STEP 60 - deterministic mock execution provider.
 *
 * The first concrete implementation of the STEP 59 execution-provider
 * contract. It exists only to validate the execution architecture safely:
 * given a structurally valid `TripExecutionProviderRequest` it deterministically
 * accepts it; given any other value it deterministically rejects it. The
 * provider never calls an external service, never creates a booking, never
 * processes a payment, never persists execution state, and never mutates a
 * trip or itinerary.
 *
 * Determinism: the same input always yields the same output. The provider uses
 * no clock, no randomness, no generated identifiers, no running tallies, no
 * mutable or global state, no environment values, and no network or file I/O.
 * Two calls with the same valid request are structurally identical.
 *
 * `accepted` means only "the mock provider accepted the provider request." It
 * does NOT mean a booking exists. The result carries only the provider-neutral
 * contract fields: no confirmation, inventory, cost, or external reference
 * data is fabricated, and no provider-specific fields are added.
 *
 * Invalid input is not repaired and never yields `accepted`; it yields a safe
 * `rejected` result. The `requestId` is echoed only when the input actually
 * exposes a well-formed provider-request id; otherwise a fixed deterministic
 * placeholder identifies the rejected attempt.
 *
 * Imports only the STEP 59 provider contract and the STEP 62 execution
 * capability contract. No React, Firebase, provider, network, AI, booking,
 * payment, or clock dependency.
 */

import type { TripExecutionCapabilityProvider } from './tripExecutionCapability';
import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
} from './tripExecutionProvider';

/** The deterministic, provider-neutral identity of the mock execution provider. */
export const MOCK_TRIP_EXECUTION_PROVIDER_ID = 'mock-execution' as const;

/** Fixed, deterministic request id used when rejected input exposes none. */
const UNSAFE_INPUT_REQUEST_ID = `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

function buildMockResult(request: unknown): TripExecutionProviderResult {
  if (isTripExecutionProviderRequest(request)) {
    return {
      providerId: MOCK_TRIP_EXECUTION_PROVIDER_ID,
      requestId: request.id,
      status: 'accepted',
    };
  }

  const safeRequestId =
    isRecord(request) && isProviderRequestId(request.id)
      ? (request.id as string)
      : UNSAFE_INPUT_REQUEST_ID;

  return {
    providerId: MOCK_TRIP_EXECUTION_PROVIDER_ID,
    requestId: safeRequestId,
    status: 'rejected',
  };
}

/**
 * The deterministic mock execution provider. Satisfies both the STEP 59
 * `TripExecutionProvider` contract and the STEP 62 `TripExecutionCapabilityProvider`
 * contract; the status values are members of the STEP 59 vocabulary enforced by
 * the result type. Capability eligibility is honest: a structurally valid
 * provider request is `supported`; anything else is not. Execution semantics
 * are unchanged from STEP 60: valid requests are `accepted`, invalid input is
 * safely `rejected`. No external service is involved and no execution state is
 * kept.
 */
export const mockTripExecutionProvider: TripExecutionCapabilityProvider = {
  providerId: MOCK_TRIP_EXECUTION_PROVIDER_ID,

  supports(request: TripExecutionProviderRequest): boolean {
    return isTripExecutionProviderRequest(request);
  },

  async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
    return buildMockResult(request);
  },
};