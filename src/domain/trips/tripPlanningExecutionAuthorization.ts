/**
 * STEP 57 - planning application execution authorization.
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
 *     -> TripPlanningExecutionRequest        (STEP 56)
 *     -> TripPlanningExecutionAuthorization  (this module)
 *     -> [future execution lifecycle boundary]   (NOT built)
 *
 * The authorization is the explicit, provider-neutral domain statement that a
 * validated execution request has crossed the authorization boundary: "the
 * execution request has been authorized to proceed toward an execution
 * boundary." It does NOT mean execution has started, and it does NOT mean a
 * provider has accepted the execution. Creating one calls no provider, creates
 * no booking, processes no payment, mutates no trip or itinerary, and persists
 * nothing.
 *
 * This module establishes only the domain representation of an explicit
 * authorization boundary. It is not an authorization system: no session,
 * account, or role machinery, no validity windows, no cancellation mechanism,
 * no approvals, no policy logic. The actual authorization mechanism belongs to
 * a later application or service layer.
 *
 * The authorization references the validated execution request by `requestId`
 * only. It never duplicates the request, execution intent, binding,
 * application, target, composition, places, routes, providers, bookings, or
 * payments, and it carries no timestamps, no requester fields, no status
 * fields, no provider fields, no counters, no external ids, and no persistence
 * metadata. No execution-lifecycle status or recovery mechanism is introduced
 * here; those belong to later steps.
 *
 * Identity is deterministic: `trip-planning-execution-authorization:<requestId>`.
 * Same request -> same authorization id; different request -> different
 * authorization id; no clock, no entropy, no generated prose.
 *
 * No React, Firebase, Router, Zustand, sign-in system, network, clock, `any`,
 * or generic `Record<string, any>` escape hatches. This module imports only
 * the adjacent pure domain module from STEP 56.
 */

import {
  isTripPlanningExecutionRequest,
  TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX,
  type TripPlanningExecutionRequest,
} from './tripPlanningExecutionRequest';

/**
 * The deterministic, provider-neutral prefix for authorization ids. Kept
 * distinct from the request id space so an authorization id never collides with
 * the request identity it references, or with any earlier domain identity.
 */
export const TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX =
  'trip-planning-execution-authorization:' as const;

/** The single explicit kind carried by every planning execution authorization. */
export const TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND =
  'trip-planning-execution-authorization' as const;

/**
 * The explicit, authorization-only contract that a validated planning
 * execution request may proceed toward an execution boundary. Carries only
 * identities: the deterministic authorization id, the single authorization
 * kind, and the request id. The request (and everything it relates to) is
 * never duplicated here, and no execution, booking, payment, or identity state
 * is carried.
 */
export interface TripPlanningExecutionAuthorization {
  id: string;
  kind: typeof TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND;
  /** The validated execution-request identity (STEP 56) this authorization covers. */
  requestId: string;
}

/**
 * The deterministic authorization id for a request id:
 * `trip-planning-execution-authorization:<requestId>`. Same request -> same
 * authorization id; different request -> different authorization id. No
 * timestamps, no randomness, no UUIDs, no browser state, no GPS, no generated
 * text.
 */
export function getTripPlanningExecutionAuthorizationId(requestId: string): string {
  return `${TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX}${requestId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX) &&
    value.length > TRIP_PLANNING_EXECUTION_REQUEST_ID_PREFIX.length
  );
}

/**
 * True when `value` is a structurally valid, internally consistent execution
 * authorization: exact authorization kind, a well-formed request id, and a
 * deterministic id that still derives exactly from that request id. Pure
 * structural domain validation — it never performs database existence checks,
 * provider checks, booking checks, payment checks, execution checks, or
 * user/account checks, never infers whether the referenced request exists
 * outside the supplied value, never mutates `value`, and never changes any
 * status.
 */
export function isTripPlanningExecutionAuthorization(
  value: unknown
): value is TripPlanningExecutionAuthorization {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND) return false;

  const requestId = value.requestId;
  if (!isRequestId(requestId)) return false;

  return getTripPlanningExecutionAuthorizationId(requestId) === value.id;
}

/**
 * The pure factory for the explicit execution authorization: given one
 * structurally valid planning execution request, derives the authorization
 * deterministically from `request.id` (`authorization.requestId ===
 * request.id`), or returns `null` when the supplied value is not a valid
 * request (malformed, wrong kind, inconsistent id, or prefix-only request id).
 * Reuses the STEP 56 request validator.
 *
 * The factory never queries a database, never inspects provider state, never
 * repairs malformed input, never mutates the request, and never executes
 * anything — it always returns a fresh, identifiers-only value carrying the
 * authorization and nothing else.
 */
export function createTripPlanningExecutionAuthorization(
  request: TripPlanningExecutionRequest
): TripPlanningExecutionAuthorization | null {
  if (!isTripPlanningExecutionRequest(request)) return null;

  return {
    id: getTripPlanningExecutionAuthorizationId(request.id),
    kind: TRIP_PLANNING_EXECUTION_AUTHORIZATION_KIND,
    requestId: request.id,
  };
}