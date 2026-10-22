/**
 * STEP 61 - provider-neutral execution orchestration boundary.
 *
 * This module is the first orchestration layer for execution providers. It
 * sits between the STEP 59 provider-request contract and one or more
 * STEP 59-compliant execution providers:
 *
 *   ... -> TripExecutionProviderRequest (STEP 59)
 *   -> orchestrateTripExecution (this module)
 *   -> TripExecutionProvider instances (STEP 59 contract)
 *   -> aggregated TripExecutionProviderResult list (input order)
 *
 * The orchestrator is deliberately inert:
 *
 * - It accepts exactly one validated provider request and an explicit,
 *   caller-supplied ordered list of providers. It never discovers providers,
 *   registers providers, or injects them implicitly.
 * - It invokes each provider in the exact order supplied and preserves every
 *   provider result in that order. It never reorders, randomizes, upgrades,
 *   merges, or chooses a single winning result.
 * - A single provider can never stop later providers: an implementation that
 *   throws or rejects its promise, or returns a malformed result, contributes
 *   a provider-neutral `failed` result and processing continues.
 * - The aggregate status is deterministic and uses only the STEP 59 status
 *   vocabulary: an empty provider list is `unsupported`; any `accepted` makes
 *   the aggregate `accepted`; otherwise any `rejected` makes it `rejected`;
 *   otherwise any `failed` makes it `failed`; otherwise `unsupported`.
 *
 * The orchestrator has no side effects: it persists nothing, reads and writes
 * no store, never creates bookings or reservations, never processes any
 * payment, never calls an external service, never generates identifiers,
 * never uses a clock, never seeds randomness, and keeps no mutable module
 * state. It is a pure orchestration boundary around provider calls.
 *
 * Raw exception details never escape: an unexpected provider failure becomes a
 * `failed` result with the provider's known identity and the request id, and
 * no error message or stack appears in any result.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderRequest,
  isTripExecutionProviderResult,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from './tripExecutionProvider';

/**
 * The provider-neutral aggregate of one execution request across an explicit,
 * ordered provider list. The per-provider results are preserved verbatim in
 * provider input order; the status is the deterministic STEP 61 aggregate.
 */
export interface TripExecutionProviderAggregate {
  /** The request id this orchestration answers (safe echo for malformed input). */
  requestId: string;
  /** Deterministic aggregate status from the STEP 59 vocabulary. */
  status: TripExecutionProviderResultStatus;
  /** Every provider result, in provider input order, never discarded. */
  providerResults: readonly TripExecutionProviderResult[];
}

/** Deterministic identity used when no safe provider identity is available. */
const UNKNOWN_PROVIDER_ID = 'unknown-execution-provider';

/** Deterministic request id used when malformed input exposes no usable id. */
const UNSPECIFIED_REQUEST_ID = `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`;

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

function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

function isExecutionProvider(value: unknown): value is TripExecutionProvider {
  if (!isRecord(value)) return false;
  if (!isSafeProviderId(value.providerId)) return false;
  return typeof value.execute === 'function';
}

function getSafeProviderId(provider: unknown): string {
  if (isRecord(provider) && isSafeProviderId(provider.providerId)) {
    return provider.providerId as string;
  }
  return UNKNOWN_PROVIDER_ID;
}

function getSafeRequestId(request: unknown): string {
  if (isRecord(request) && isProviderRequestId(request.id)) {
    return request.id as string;
  }
  return UNSPECIFIED_REQUEST_ID;
}

/**
 * The deterministic aggregate status from the collected provider results. This
 * uses only the STEP 59 status vocabulary and is entropy-free; `unsupported`
 * is a valid outcome, never treated as a failure.
 */
export function getTripExecutionAggregateStatus(
  providerResults: ReadonlyArray<TripExecutionProviderResult>
): TripExecutionProviderResultStatus {
  if (providerResults.length === 0) return 'unsupported';
  if (providerResults.some((result) => result.status === 'accepted')) return 'accepted';
  if (providerResults.some((result) => result.status === 'rejected')) return 'rejected';
  if (providerResults.some((result) => result.status === 'failed')) return 'failed';
  return 'unsupported';
}

/**
 * Runs one provider and always yields a provider-neutral result. An invalid
 * provider object, an implementation that throws or rejects, or a malformed
 * returned result all become a `failed` result carrying a safe identity; the
 * raw exception or malformed payload never escapes. Never throws itself.
 */
async function executeProviderSafely(
  request: TripExecutionProviderRequest,
  provider: TripExecutionProvider
): Promise<TripExecutionProviderResult> {
  if (!isExecutionProvider(provider)) {
    return {
      providerId: getSafeProviderId(provider),
      requestId: request.id,
      status: 'failed',
    };
  }

  let outcome: unknown;
  try {
    outcome = await provider.execute(request);
  } catch {
    return {
      providerId: provider.providerId,
      requestId: request.id,
      status: 'failed',
    };
  }

  if (isTripExecutionProviderResult(outcome)) {
    return outcome;
  }

  return {
    providerId: provider.providerId,
    requestId: request.id,
    status: 'failed',
  };
}

/**
 * Orchestrates one valid provider request across an explicit, ordered provider
 * list. Providers run sequentially in the exact order supplied; every provider
 * result is preserved in that order, and an unexpected provider failure never
 * prevents later providers from running. A malformed request is `rejected`
 * before any provider is invoked. Pure orchestration: no persistence, no
 * network, no booking or payment behavior, no clock, no randomness, and no
 * module state. Never throws.
 */
export async function orchestrateTripExecution(
  request: TripExecutionProviderRequest,
  providers: ReadonlyArray<TripExecutionProvider>
): Promise<TripExecutionProviderAggregate> {
  if (!isTripExecutionProviderRequest(request)) {
    return {
      requestId: getSafeRequestId(request),
      status: 'rejected',
      providerResults: [],
    };
  }

  const providerResults: TripExecutionProviderResult[] = [];
  for (const provider of providers) {
    providerResults.push(await executeProviderSafely(request, provider));
  }

  return {
    requestId: request.id,
    status: getTripExecutionAggregateStatus(providerResults),
    providerResults,
  };
}