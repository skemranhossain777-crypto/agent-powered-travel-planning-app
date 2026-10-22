/**
 * STEP 62 - provider-neutral execution capability boundary.
 *
 * This module answers, before execution, a single provider-neutral question
 * about a caller-supplied execution provider and an execution-provider request:
 *
 *   "Can this provider handle this request?"
 *
 * It deliberately adds no behavior to STEP 61 orchestration and performs no
 * dispatch: the answer is informational, and the caller still controls which
 * providers are passed to the STEP 61 orchestrator. Nothing is filtered,
 * reordered, or selected automatically, and no actual execution happens here.
 *
 * The capability result carries only:
 *
 *   { providerId, requestId, supported }
 *
 * No booking, payment, inventory, provider-address, secret, credential, or
 * provider-specific detail is ever exposed, and no capability outcome is
 * persisted.
 *
 * Contract:
 *
 * - A provider that satisfies both `TripExecutionProvider` and
 *   `TripExecutionProviderCapability` is capability-aware; its synchronous,
 *   deterministic `supports(request)` decides eligibility.
 * - A provider that satisfies only `TripExecutionProvider` is execution-only
 *   and is treated as eligible (capability-unknown is presumed eligible) so an
 *   explicit caller choice about a provider list is never contradicted.
 * - A malformed provider or malformed provider id is unsupported and is never
 *   replaced silently.
 * - A malformed request is unsupported, is never repaired, and is never sent
 *   toward a provider; the provider's capability method is not consulted for a
 *   malformed request.
 *
 * Capability evaluation is pure and synchronous: it never calls the provider's
 * execute method, performs no network request, uses no clock, no randomness,
 * no generated identifiers, no running tallies, no environment values, and
 * keeps no mutable state. The same provider and the same request always
 * produce the same capability output.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
} from './tripExecutionProvider';

/**
 * The provider-neutral capability check an execution provider may implement.
 * `supports(request)` is synchronous, deterministic, and side-effect free; it
 * signals only whether the provider can handle the given provider request.
 */
export interface TripExecutionProviderCapability {
  supports(request: TripExecutionProviderRequest): boolean;
}

/**
 * A provider that both executes provider requests (STEP 59) and can report its
 * own capability eligibility (this step). Composes the existing execution
 * contract additively; a provider may be execution-only and never satisfy this
 * shape, which is fine.
 */
export type TripExecutionCapabilityProvider = TripExecutionProvider &
  TripExecutionProviderCapability;

/**
 * The minimal, provider-neutral result of one capability evaluation. It never
 * contains secrets, credentials, addresses, inventory, booking, or payment
 * data - only identities and the boolean eligibility verdict.
 */
export interface TripExecutionCapabilityResult {
  /** The provider identity the verdict applies to (safe fallback when unknown). */
  providerId: string;
  /** The request id evaluated (safe echo when usable, deterministic placeholder otherwise). */
  requestId: string;
  /** True only when the request and provider are valid and the provider reports eligible. */
  supported: boolean;
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

type ExecutionProviderShape = {
  readonly providerId: string;
  readonly execute: unknown;
  readonly supports?: unknown;
};

function isExecutionProviderShape(value: unknown): value is ExecutionProviderShape {
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

/** True when `value` satisfies both the execution and the capability contracts. */
export function isTripExecutionCapabilityProvider(
  value: unknown
): value is TripExecutionCapabilityProvider {
  if (!isExecutionProviderShape(value)) return false;
  return typeof value.supports === 'function';
}

/**
 * The pure, synchronous capability evaluation. Rules:
 *
 * - malformed request -> unsupported (provider capability is not consulted)
 * - invalid provider / invalid provider id -> unsupported
 * - capability-aware provider -> its own epoch-free `supports` verdict
 * - valid execution-only provider -> eligible (supported: true)
 *
 * Never calls the provider's execute method, never mutates the request or the
 * provider, never persists, and never throws for malformed input.
 */
export function evaluateTripExecutionCapability(
  request: unknown,
  provider: unknown
): TripExecutionCapabilityResult {
  if (!isTripExecutionProviderRequest(request)) {
    return {
      providerId: getSafeProviderId(provider),
      requestId: getSafeRequestId(request),
      supported: false,
    };
  }

  if (!isExecutionProviderShape(provider)) {
    return {
      providerId: getSafeProviderId(provider),
      requestId: request.id,
      supported: false,
    };
  }

  if (typeof provider.supports === 'function') {
    const verdict = (provider.supports as (value: TripExecutionProviderRequest) => unknown)(request);
    return {
      providerId: provider.providerId,
      requestId: request.id,
      supported: verdict === true,
    };
  }

  return {
    providerId: provider.providerId,
    requestId: request.id,
    supported: true,
  };
}