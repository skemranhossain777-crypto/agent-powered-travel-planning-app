/**
 * STEP 55 - planning application execution intent.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningComposition
 *     -> TripPlanningCompositionProposal     (STEP 50, 'proposed')
 *     -> Approval                            (STEP 51, 'approved')
 *     -> TripPlanningApplication             (STEP 52, 'pending-application')
 *     -> TripPlanningApplicationTarget       (STEP 53)
 *     -> Compatibility                       (STEP 53)
 *     -> TripPlanningApplicationBinding      (STEP 54)
 *     -> TripPlanningExecutionIntent         (this module)
 *     -> [future execution lifecycle boundary]   (NOT built)
 *
 * The execution intent is the explicit, provider-neutral domain statement that
 * a validated planning application binding has reached the execution-intent
 * boundary: "the application binding is intended to be executed." It is
 * **intent only** — it does NOT mean the application has executed. Creating one
 * executes nothing, calls no provider, creates no booking, performs no monetary
 * operation, mutates no trip or itinerary, and persists nothing.
 *
 * The intent references the validated binding by `bindingId` only. It never
 * duplicates the application, target, composition, place, route, provider,
 * booking, or payment, and it carries no timestamps, randomness, execution
 * status, booking status, payment status, provider ids, external request ids,
 * retry counters, or persistence metadata. No execution-lifecycle status is
 * introduced here; those belong to a later step.
 *
 * Identity is deterministic: `trip-planning-execution-intent:<bindingId>`.
 * Same binding -> same intent id; different binding -> different intent id;
 * no clock, no entropy, no generated prose.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. This module imports only the adjacent
 * pure domain module from STEP 54.
 */

import {
  isTripPlanningApplicationBinding,
  TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX,
  type TripPlanningApplicationBinding,
} from './tripPlanningApplicationBinding';

/**
 * The deterministic, provider-neutral prefix for execution-intent ids. Kept
 * distinct from the binding id space so an intent id never collides with the
 * binding identity it references.
 */
export const TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX = 'trip-planning-execution-intent:' as const;

/** The single explicit kind carried by every planning execution intent. */
export const TRIP_PLANNING_EXECUTION_INTENT_KIND = 'trip-planning-execution-intent' as const;

/**
 * The explicit intent to execute one validated planning
 * application binding. Carries only identities: the deterministic intent id,
 * the single intent kind, and the binding id. The binding (and everything it
 * relates to) is never duplicated here, and no execution or booking/payment
 * state is carried.
 */
export interface TripPlanningExecutionIntent {
  id: string;
  kind: typeof TRIP_PLANNING_EXECUTION_INTENT_KIND;
  /** The validated binding identity (STEP 54) this intent refers to. */
  bindingId: string;
}

/**
 * The deterministic intent id for a binding id:
 * `trip-planning-execution-intent:<bindingId>`. Same binding -> same intent id;
 * different binding -> different intent id. No timestamps, no randomness, no
 * UUIDs, no browser state, no GPS, no generated text.
 */
export function getTripPlanningExecutionIntentId(bindingId: string): string {
  return `${TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX}${bindingId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBindingId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX) &&
    value.length > TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX.length
  );
}

/**
 * True when `value` is a structurally valid, internally consistent planning
 * execution intent: exact intent kind, a well-formed binding id, and a
 * deterministic id that still derives exactly from that binding id. Pure
 * structural validation — it never checks a database, provider, booking, or
 * execution state, never infers whether the referenced binding exists outside
 * the supplied value, never mutates `value`, and never changes any status.
 */
export function isTripPlanningExecutionIntent(
  value: unknown
): value is TripPlanningExecutionIntent {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_EXECUTION_INTENT_KIND) return false;

  const bindingId = value.bindingId;
  if (!isBindingId(bindingId)) return false;

  return getTripPlanningExecutionIntentId(bindingId) === value.id;
}

/**
 * The pure factory for the explicit execution intent: given one structurally
 * valid planning application binding, or returns `null` when the supplied value
 * is not a valid binding (malformed, wrong kind, inconsistent id, or
 * prefix-only binding id). Reuses the STEP 54 binding validator and derives the
 * intent id deterministically from `binding.id`
 * (`intent.bindingId === binding.id`).
 *
 * The factory never queries a database to determine whether the binding exists,
 * never inspects external providers, never repairs malformed input, never
 * mutates the binding, and never automatically executes anything — it always
 * returns a fresh, identifiers-only value carrying the intent and nothing else.
 */
export function createTripPlanningExecutionIntent(
  binding: TripPlanningApplicationBinding
): TripPlanningExecutionIntent | null {
  if (!isTripPlanningApplicationBinding(binding)) return null;

  return {
    id: getTripPlanningExecutionIntentId(binding.id),
    kind: TRIP_PLANNING_EXECUTION_INTENT_KIND,
    bindingId: binding.id,
  };
}