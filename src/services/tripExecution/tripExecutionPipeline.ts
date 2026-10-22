/**
 * STEP 65 - provider-neutral end-to-end execution pipeline (simulation seam).
 *
 * This module is the first pure, provider-neutral composition of the STEP 59
 * through STEP 64 execution boundaries. It connects a single validated
 * execution-provider request to an explicit caller-supplied provider list
 * through the established deterministic sequence:
 *
 *   TripExecutionProviderRequest (STEP 59)
 *   -> TripExecutionPlan (STEP 63, via STEP 62 capability evaluation)
 *   -> TripExecutionPlanBinding (STEP 64, exact fail-closed match)
 *   -> ordered TripExecutionProvider[] (STEP 64 resolve)
 *   -> orchestrateTripExecution (STEP 61) -> aggregate
 *
 * The pipeline is deliberately thin. It performs no new selection, matching,
 * ordering, or aggregation logic of its own; it delegates each stage to the
 * existing STEP 61-64 boundaries and only connects their outputs:
 *
 *   - request validation is delegated to the STEP 63 plan creator, which
 *     validates with the STEP 59 provider-request contract; the pipeline never
 *     re-validates or repairs a request
 *   - eligibility is decided by the STEP 62 capability evaluator via the STEP
 *     63 plan; the pipeline materializes only the plan-eligible provider
 *     objects, in the plan's own order, so ineligible providers never execute
 *   - the STEP 64 binding fails closed on any exact-set mismatch, and the STEP
 *     64 resolver returns the ordered providers in the plan's order
 *   - the STEP 61 orchestrator runs the ordered providers sequentially and
 *     produces the deterministic aggregate status; the pipeline copies that
 *     aggregate status verbatim and reimplements none of it
 *
 * A pipeline result carries only the composed artifacts and provider-neutral
 * identities:
 *
 *   { plan, binding, providerResults, aggregateStatus }
 *
 * It never fabricates bookings, reservations, tickets, payments, inventory,
 * credentials, tokens, external references, or provider-specific payloads. The
 * pipeline is a simulation/integration seam: no concrete execution provider
 * beyond STEP 60, no network, no clock, no randomness, no environment values,
 * no global or mutable state, and no persistence.
 *
 * The pipeline fails closed and never repairs input:
 *
 *   - a malformed request or a non-array provider list yields `null` and no
 *     provider is ever invoked
 *   - a malformed provider array element carries no identity, is excluded by
 *     the STEP 63 plan, and is skipped by the identity lookup, so a
 *     caller-supplied list can never make the pipeline throw
 *   - a plan whose provider set cannot be exactly bound (for example duplicate
 *     eligible identities) yields `null` and no provider is ever invoked
 *   - an empty eligible set is a valid plan and yields an `unsupported`
 *     aggregate (empty provider results), never a failure
 *
 * Provider execution happens only inside the STEP 61 orchestrator invocation,
 * after the plan and binding exist. Nothing here calls a provider's execute
 * method directly, nothing here mutates a request, plan, binding, or provider
 * object, and the same request with the same provider list always produces the
 * same pipeline result.
 */

import {
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from './tripExecutionProvider';
import { createTripExecutionPlan, type TripExecutionPlan } from './tripExecutionPlan';
import {
  createTripExecutionPlanBinding,
  resolveTripExecutionPlanProviders,
  type TripExecutionPlanBinding,
} from './tripExecutionPlanBinding';
import { orchestrateTripExecution } from './tripExecutionOrchestrator';

/**
 * The composed, provider-neutral outcome of one execution pipeline run. It
 * carries the STEP 63 plan, the STEP 64 binding, every provider result in plan
 * order, and the deterministic STEP 61 aggregate status. Never carries
 * booking, payment, inventory, credential, or provider-specific payloads.
 */
export interface TripExecutionPipelineResult {
  /** The STEP 63 plan (malformed inputs never produce a fabricated plan). */
  plan: TripExecutionPlan;
  /** The STEP 64 binding over the plan-eligible provider set. */
  binding: TripExecutionPlanBinding;
  /** Every provider result, in plan order, never discarded. */
  providerResults: readonly TripExecutionProviderResult[];
  /** The deterministic STEP 61 aggregate status (STEP 59 vocabulary). */
  aggregateStatus: TripExecutionProviderResultStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Materializes the plan-eligible provider objects in the plan's own order.
 * The STEP 63 plan is the single authority for who may run: only provider ids
 * it names are retained, every retained id maps back to its caller-supplied
 * provider object by explicit identity, and a caller id supplied more than
 * once contributes the first object only. This is a pure identity lookup; it
 * performs no capability evaluation, no matching, no filtering decision, and
 * no validation of its own.
 *
 * A malformed array element (not an object, or no string `providerId`) carries
 * no identity to look up and is skipped without inspection. The STEP 63 plan
 * has already excluded it, so skipping it is not a repair, a replacement, or a
 * second filtering decision - it keeps this lookup total, so a caller-supplied
 * list can never make the pipeline throw.
 */
function selectEligibleProviders(
  plan: TripExecutionPlan,
  providers: ReadonlyArray<TripExecutionProvider>
): TripExecutionProvider[] {
  const providerById = new Map<string, TripExecutionProvider>();
  for (const provider of providers) {
    if (!isRecord(provider) || typeof provider.providerId !== 'string') continue;
    if (!providerById.has(provider.providerId)) {
      providerById.set(provider.providerId, provider as unknown as TripExecutionProvider);
    }
  }

  return plan.providerIds.map(
    (providerId) => providerById.get(providerId) as TripExecutionProvider
  );
}

/**
 * Executes the deterministic STEP 59-64 composition for one execution-provider
 * request against an explicit, caller-supplied provider list, and returns the
 * composed pipeline result, or `null` when the input cannot be planned or
 * bound. Provider execution occurs only inside the STEP 61 orchestration
 * seam, strictly after the plan and binding exist. Never throws, never mutates
 * any input, never persists, and never talks to a network or external service.
 */
export async function executeTripExecutionPipeline(
  request: unknown,
  providers: ReadonlyArray<TripExecutionProvider>
): Promise<TripExecutionPipelineResult | null> {
  const plan = createTripExecutionPlan(request, providers);
  if (plan === null) return null;

  const eligibleProviders = selectEligibleProviders(plan, providers);
  const binding = createTripExecutionPlanBinding(plan, eligibleProviders);
  if (binding === null) return null;

  const orderedProviders = resolveTripExecutionPlanProviders(
    binding,
    eligibleProviders
  ) as TripExecutionProvider[];

  const aggregate = await orchestrateTripExecution(
    request as TripExecutionProviderRequest,
    orderedProviders
  );

  return {
    plan,
    binding,
    providerResults: aggregate.providerResults,
    aggregateStatus: aggregate.status,
  };
}
