/**
 * STEP 64 - provider-neutral execution-plan binding.
 *
 * This module is the pure, intent-only bridge between the STEP 63 execution
 * plan and the STEP 61 orchestration seam. It translates an already-created,
 * validated plan into an explicit, ordered provider set identity:
 *
 *   Execution Plan (STEP 63)
 *   -> TripExecutionPlanBinding (this module)
 *   -> explicit TripExecutionProvider[] via resolveTripExecutionPlanProviders
 *
 * A binding carries only deterministic provider-neutral identities:
 *
 *   { id, kind: 'trip-execution-plan-binding', planId, requestId, providerIds }
 *
 * with `id` always derived from `planId` as
 * `trip-execution-plan-binding:<planId>`. `providerIds` copies the source plan
 * identities exactly, in the plan's own order. It never carries provider
 * objects, secrets, credentials, URLs/addresses, booking, payment, inventory,
 * or provider-specific payloads.
 *
 * Both operations fail closed and never repair input:
 *
 * - `createTripExecutionPlanBinding` validates the plan with the STEP 63
 *   validator, requires an exact provider set (each plan identity matched by
 *   exactly one supplied provider; no missing, extra, duplicated, aliased, or
 *   substituted identities; case and whitespace must already match), and
 *   returns `null` on any mismatch.
 * - `resolveTripExecutionPlanProviders` validates the binding identically and
 *   returns the ordered `TripExecutionProvider[]` the binding names, or `null`.
 *   The caller may later pass that explicit list to the STEP 61 orchestration
 *   seam; nothing here invokes it.
 *
 * The plan is authoritative for ordering. Nothing here sorts, ranks,
 * prioritizes, discovers, registers, creates, removes, or substitutes
 * providers. Nothing here invokes a provider method and nothing here calls the
 * orchestration seam. No clock, randomness, generated identifiers, counters,
 * environment values, network, or mutable/global state is involved; no
 * provider array, provider object, plan, or request is ever changed.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  getTripExecutionPlanId,
  isTripExecutionPlan,
  TRIP_EXECUTION_PLAN_ID_PREFIX,
} from './tripExecutionPlan';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
} from './tripExecutionProvider';

/**
 * The deterministic, provider-neutral prefix for binding ids. Kept distinct
 * from the plan, request, dispatch, and provider identity spaces so no binding
 * id collides with any earlier identity.
 */
export const TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX = 'trip-execution-plan-binding:' as const;

/** The single explicit kind carried by every execution-plan binding. */
export const TRIP_EXECUTION_PLAN_BINDING_KIND = 'trip-execution-plan-binding' as const;

/**
 * The explicit provider-set binding for an execution plan. Carries identities
 * only: the deterministic binding id, the binding kind, the source plan id,
 * the request id preserved from the source plan, and the ordered provider ids.
 * Never carries provider objects, payloads, secrets, credentials, addresses,
 * booking, payment, or inventory data.
 */
export interface TripExecutionPlanBinding {
  /** Deterministic: `trip-execution-plan-binding:<planId>`. */
  id: string;
  kind: typeof TRIP_EXECUTION_PLAN_BINDING_KIND;
  /** The source execution-plan id this binding names. */
  planId: string;
  /** The request id preserved from the source plan. */
  requestId: string;
  /** The exact source-plan provider identities, in source-plan order. */
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

function isBindingId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX.length
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

/**
 * The deterministic binding id for an execution-plan id:
 * `trip-execution-plan-binding:<planId>`. Same plan -> same binding id; no
 * clock, no entropy, no generated text.
 */
export function getTripExecutionPlanBindingId(planId: string): string {
  return `${TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX}${planId}`;
}

/**
 * Exact, fail-closed identity matching between an ordered id list and an
 * explicit provider list. Returns an id -> provider map only when:
 *
 * - every supplied provider is a structurally valid execution provider with a
 *   unique safe provider id (duplicate supplied identity -> `null`)
 * - every id is unique (duplicate expected identity -> `null`)
 * - the expected id set and the supplied id set are identical in composition
 *   (any missing or extra identity -> `null`)
 *
 * Nothing here invokes a provider and nothing here changes any provider.
 */
function matchExactProviderSet(
  ids: readonly string[],
  providers: ReadonlyArray<TripExecutionProvider>
): Map<string, TripExecutionProvider> | null {
  const providerById = new Map<string, TripExecutionProvider>();
  for (const provider of providers) {
    if (!isExecutionProvider(provider)) return null;
    if (providerById.has(provider.providerId)) return null;
    providerById.set(provider.providerId, provider);
  }

  if (providerById.size !== ids.length) return null;

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return null;
    seen.add(id);
    if (!providerById.has(id)) return null;
  }

  return providerById;
}

/**
 * Creates the explicit provider-set binding for a validated execution plan
 * against an explicit, caller-supplied provider list. The plan is authoritative
 * for identity and ordering: the binding copies the plan's provider ids in the
 * plan's own order, and the supplied set must match those ids exactly (no
 * missing, extra, duplicate, aliased, substituted, case-varied, or
 * whitespace-varied identities). Any mismatch yields `null` and is never
 * repaired, the provider array is never modified, and no provider is ever
 * invoked. Nothing here calls the orchestration seam.
 */
export function createTripExecutionPlanBinding(
  plan: unknown,
  providers: ReadonlyArray<TripExecutionProvider>
): TripExecutionPlanBinding | null {
  if (!isTripExecutionPlan(plan)) return null;
  if (!Array.isArray(providers)) return null;

  const providerById = matchExactProviderSet(plan.providerIds, providers);
  if (providerById === null) return null;

  return {
    id: getTripExecutionPlanBindingId(plan.id),
    kind: TRIP_EXECUTION_PLAN_BINDING_KIND,
    planId: plan.id,
    requestId: plan.requestId,
    providerIds: [...plan.providerIds],
  };
}

/**
 * Pure structural validator for execution-plan bindings. It verifies the
 * object shape, the exact kind, structurally well-formed and consistent
 * identities (requestId falls under the shared request id bound, planId under
 * the plan id bound and derives deterministically from requestId, binding id
 * under the binding id bound and derives deterministically from planId), and
 * an array of valid provider ids. It performs no database existence checks,
 * does not verify that providers currently exist, and never invokes a provider
 * or the orchestration seam.
 */
export function isTripExecutionPlanBinding(
  value: unknown
): value is TripExecutionPlanBinding {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_PLAN_BINDING_KIND) return false;

  const planId = value.planId;
  if (!isPlanId(planId)) return false;

  const requestId = value.requestId;
  if (!isProviderRequestId(requestId)) return false;
  if (getTripExecutionPlanId(requestId) !== planId) return false;

  const id = value.id;
  if (!isBindingId(id)) return false;
  if (id !== getTripExecutionPlanBindingId(planId)) return false;

  if (!Array.isArray(value.providerIds)) return false;
  return value.providerIds.every((providerId) => isSafeProviderId(providerId));
}

/**
 * Resolves a validated binding against an explicit provider list, returning
 * the exact ordered `TripExecutionProvider[]` the binding represents, or
 * `null` when the binding is invalid or the supplied set does not match the
 * binding's identities exactly. The returned providers appear in the binding's
 * own order (the plan's order). The caller may later pass the returned list to
 * the STEP 61 orchestration seam; this helper never invokes it, never invokes
 * any provider, and never mutates the binding, the provider array, or any
 * provider object.
 */
export function resolveTripExecutionPlanProviders(
  binding: unknown,
  providers: ReadonlyArray<TripExecutionProvider>
): TripExecutionProvider[] | null {
  if (!isTripExecutionPlanBinding(binding)) return null;
  if (!Array.isArray(providers)) return null;

  const providerById = matchExactProviderSet(binding.providerIds, providers);
  if (providerById === null) return null;

  return binding.providerIds.map(
    (providerId) => providerById.get(providerId) as TripExecutionProvider
  );
}