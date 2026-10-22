/**
 * STEP 63 - provider-neutral execution-plan artifact.
 *
 * This module produces an intent/planning-only execution plan that describes
 * which of the caller-supplied execution providers are eligible for a specific
 * execution-provider request, based on the STEP 62 capability evaluation. It
 * performs no execution, no discovery, and no persistence:
 *
 *   TripExecutionProviderRequest (STEP 59)
 *   -> capability evaluation (STEP 62)
 *   -> TripExecutionPlan (this module)
 *   -> caller builds an explicit provider set -> orchestrator (STEP 61)
 *
 * A plan carries only deterministic provider-neutral identities:
 *
 *   { id, kind: 'trip-execution-plan', requestId, providerIds }
 *
 * with `id` always derived from `requestId` as
 * `trip-execution-plan:<requestId>`. `providerIds` preserves the exact
 * caller-supplied provider order, contains only providers whose capability
 * verdict is `supported`, and carries no booking, payment, inventory,
 * credential, address, or provider-specific payload. Provider IDs follow the
 * shared provider-domain bound (non-empty, already-trimmed, bounded); no
 * provider ID is fabricated or normalized, and a malformed or unsupported
 * provider is excluded rather than repaired.
 *
 * The plan creator validates the request with the STEP 59 validator and
 * returns `null` for a malformed request (never a fabricated plan). An empty
 * eligible set is a valid plan with `providerIds: []`, not a failure. Provider
 * IDs are not deduplicated: every eligible provider contributes its identity,
 * in order, so repeated providers remain visible to the caller.
 *
 * Plan creation is pure: it never calls any provider's execute method, never
 * mutates the request or any provider, uses no clock, no randomness, no
 * generated identifiers, no running tallies, no environment values, and keeps
 * no mutable state. The validator is likewise pure and performs no database or
 * capability checks.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
} from './tripExecutionProvider';
import { evaluateTripExecutionCapability } from './tripExecutionCapability';

/**
 * The deterministic, provider-neutral prefix for execution-plan ids. Kept
 * distinct from request, dispatch, and provider identity spaces so no plan id
 * collides with any earlier identity.
 */
export const TRIP_EXECUTION_PLAN_ID_PREFIX = 'trip-execution-plan:' as const;

/** The single explicit kind carried by every execution plan. */
export const TRIP_EXECUTION_PLAN_KIND = 'trip-execution-plan' as const;

/**
 * The intent-only execution plan. Carries identities only: the deterministic
 * plan id, the plan kind, the request id it describes, and the ordered list of
 * eligible provider ids. Never carries provider-specific payloads, secrets,
 * credentials, addresses, booking, payment, or inventory data.
 */
export interface TripExecutionPlan {
  /** Deterministic: `trip-execution-plan:<requestId>`. */
  id: string;
  kind: typeof TRIP_EXECUTION_PLAN_KIND;
  /** The provider-request id the plan describes. */
  requestId: string;
  /** Eligible provider ids in exact caller-supplied order (never deduplicated). */
  providerIds: readonly string[];
}

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

function isPlanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PLAN_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PLAN_ID_PREFIX.length
  );
}

function isSafeProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  return value.length <= MAX_PROVIDER_ID_LENGTH;
}

/**
 * The deterministic execution-plan id for a provider-request id:
 * `trip-execution-plan:<requestId>`. Same request -> same plan id; no clock,
 * no entropy, no generated text.
 */
export function getTripExecutionPlanId(requestId: string): string {
  return `${TRIP_EXECUTION_PLAN_ID_PREFIX}${requestId}`;
}

/**
 * Creates the intent-only execution plan for a request against an explicit,
 * caller-supplied provider list. Rules:
 *
 * - the request is validated with the STEP 59 validator; a malformed request
 *   (or a non-array provider list) yields `null` and is never repaired
 * - each provider is assessed with the STEP 62 capability evaluator; only
 *   `supported` providers appear, preserving caller-supplied order
 * - no provider is ever invoked and nothing is persisted
 * - an empty eligible set is a valid plan (`providerIds: []`), not a failure
 */
export function createTripExecutionPlan(
  request: unknown,
  providers: ReadonlyArray<TripExecutionProvider>
): TripExecutionPlan | null {
  if (!isTripExecutionProviderRequest(request)) return null;
  if (!Array.isArray(providers)) return null;

  const providerIds: string[] = [];
  for (const provider of providers) {
    const evaluation = evaluateTripExecutionCapability(request, provider);
    if (evaluation.supported) {
      providerIds.push(evaluation.providerId);
    }
  }

  return {
    id: getTripExecutionPlanId(request.id),
    kind: TRIP_EXECUTION_PLAN_KIND,
    requestId: request.id,
    providerIds,
  };
}

/**
 * Pure structural validator for execution plans. It verifies the object
 * shape, the exact kind, the deterministic plan id derived from a well-formed
 * request id, and an array of valid provider ids. It performs no database
 * existence checks, does not verify that providers currently exist, and never
 * calls a capability or execution provider.
 */
export function isTripExecutionPlan(value: unknown): value is TripExecutionPlan {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_PLAN_KIND) return false;

  const requestId = value.requestId;
  if (!isProviderRequestId(requestId)) return false;

  const id = value.id;
  if (!isPlanId(id)) return false;
  if (id !== getTripExecutionPlanId(requestId as string)) return false;

  if (!Array.isArray(value.providerIds)) return false;
  return value.providerIds.every((providerId) => isSafeProviderId(providerId));
}