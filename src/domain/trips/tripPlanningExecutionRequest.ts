/**
 * STEP 56 - planning application execution request.
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
 *     -> TripPlanningExecutionIntent         (STEP 55)
 *     -> TripPlanningExecutionRequest        (this module)
 *     -> [future execution lifecycle boundary]   (NOT built)
 *
 * The execution request is the explicit, provider-neutral domain statement that
 * a validated execution intent has crossed into an execution-request boundary:
 * "the execution intent is being requested for execution." This is still **not
 * execution** — it does NOT mean execution has started. Creating one calls no
 * provider, creates no booking, processes no payment, mutates no trip or
 * itinerary, and persists nothing.
 *
 * The request references the validated execution intent by `intentId` only. It
 * never duplicates the intent object, binding, application, target, composition,
 * places, routes, providers, bookings, or payments, and it carries no
 * timestamps, requester identity, execution status, booking status, payment
 * status, provider fields, counters, external ids, or persistence metadata. No
 * execution-lifecycle status or recovery mechanism is introduced here; those
 * belong to later steps.
 *
 * Identity is deterministic: `trip-planning-execution-request:<intentId>`.
 * Same intent -> same request id; different intent -> different request id;
 * no clock, no entropy, no generated prose.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. This module imports only the adjacent
 * pure domain module from STEP 55.
 */

import {
  isTripPlanningExecutionIntent,
  TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX,
  type TripPlanningExecutionIntent,
} from './tripPlanningExecutionIntent';

/**
 * The deterministic, provider-neutral prefix for execution-request ids. Kept
 * distinct from the intent id space so a request id never collides with the
 * intent identity it references.
 */
export const TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX = 'trip-planning-execution-request:' as const;

/** The single explicit kind carried by every planning execution request. */
export const TRIP_PLANNING_EXECUTION_REQUEST_KIND = 'trip-planning-execution-request' as const;

/**
 * The explicit request to proceed from one validated planning execution
 * intent. Carries only identities: the deterministic request id, the single
 * request kind, and the intent id. The intent (and everything it relates to)
 * is never duplicated here, and no execution or booking/payment state is
 * carried.
 */
export interface TripPlanningExecutionRequest {
  id: string;
  kind: typeof TRIP_PLANNING_EXECUTION_REQUEST_KIND;
  /** The validated execution-intent identity (STEP 55) this request proceeds from. */
  intentId: string;
}

/**
 * The deterministic request id for an intent id:
 * `trip-planning-execution-request:<intentId>`. Same intent -> same request id;
 * different intent -> different request id. No timestamps, no randomness, no
 * UUIDs, no browser state, no GPS, no generated text.
 */
export function getTripPlanningExecutionRequestId(intentId: string): string {
  return `${TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX}${intentId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX) &&
    value.length > TRIP_PLANNING_EXECUTION_INTENT_ID_PREFIX.length
  );
}

/**
 * True when `value` is a structurally valid, internally consistent planning
 * execution request: exact request kind, a well-formed intent id, and a
 * deterministic id that still derives exactly from that intent id. Pure
 * structural validation — it never checks database state, provider
 * availability, booking availability, payment state, or execution state, never
 * infers whether the referenced intent exists outside the supplied value,
 * never mutates `value`, and never changes any status.
 */
export function isTripPlanningExecutionRequest(
  value: unknown
): value is TripPlanningExecutionRequest {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_EXECUTION_REQUEST_KIND) return false;

  const intentId = value.intentId;
  if (!isIntentId(intentId)) return false;

  return getTripPlanningExecutionRequestId(intentId) === value.id;
}

/**
 * The pure factory for the explicit execution request: given one structurally
 * valid planning execution intent, derives the request deterministically from
 * `intent.id` (`request.intentId === intent.id`), or returns `null` when the
 * supplied value is not a valid intent (malformed, wrong kind, inconsistent id,
 * or prefix-only intent id). Reuses the STEP 55 intent validator.
 *
 * The factory never queries a database, never inspects providers, never repairs
 * malformed input, never mutates the input, and never executes anything — it
 * always returns a fresh, identifiers-only value carrying the request and
 * nothing else.
 */
export function createTripPlanningExecutionRequest(
  intent: TripPlanningExecutionIntent
): TripPlanningExecutionRequest | null {
  if (!isTripPlanningExecutionIntent(intent)) return null;

  return {
    id: getTripPlanningExecutionRequestId(intent.id),
    kind: TRIP_PLANNING_EXECUTION_REQUEST_KIND,
    intentId: intent.id,
  };
}