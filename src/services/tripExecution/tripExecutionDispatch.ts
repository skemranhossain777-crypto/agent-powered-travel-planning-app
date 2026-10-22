/**
 * STEP 58 - authorized execution dispatch boundary (application/service seam).
 *
 * This module is the first application/service-layer boundary in the pipeline:
 *
 *   ... -> TripPlanningExecutionAuthorization (STEP 57, domain)
 *   -> TripExecutionDispatchInstruction (this module, service boundary)
 *   -> [provider execution contract] (future milestone, NOT built)
 *
 * The dispatch instruction is the provider-neutral, deterministic statement
 * that a structurally valid authorized execution request has crossed the
 * dispatch boundary. It represents the seam where a future execution service
 * can hand work to a provider adapter. It does NOT mean a provider has been
 * called, and it does NOT mean execution has started: this module performs no
 * provider call, no network request, no booking, no payment, no persistence,
 * and no trip or itinerary mutation.
 *
 * This module introduces no provider adapter and no concrete provider binding,
 * no network destination, and no transport details. The instruction is
 * intentionally provider-neutral and carries only the validated authorization
 * identity:
 *
 *   { id, kind: 'trip-execution-dispatch-instruction', authorizationId }
 *
 * Identity is deterministic: `trip-execution-dispatch:<authorizationId>`.
 * Same authorization -> same instruction id; different authorization ->
 * different instruction id. No clock, no entropy, no generated prose.
 *
 * No React, Firebase, Router, Zustand, provider, network, clock, `any`, or
 * generic `Record<string, any>` escape hatches. The only dependency is the
 * STEP 57 domain authorization contract, following the established service ->
 * domain import convention.
 */

import {
  isTripPlanningExecutionAuthorization,
  TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX,
  type TripPlanningExecutionAuthorization,
} from '../../domain/trips/tripPlanningExecutionAuthorization';

/**
 * The deterministic, provider-neutral prefix for dispatch-instruction ids. Kept
 * distinct from the authorization id space so a dispatch id never collides with
 * the authorization identity it references, or with any earlier domain
 * identity.
 */
export const TRIP_EXECUTION_DISPATCH_ID_PREFIX = 'trip-execution-dispatch:' as const;

/** The single explicit kind carried by every dispatch instruction. */
export const TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND = 'trip-execution-dispatch-instruction' as const;

/**
 * The provider-neutral dispatch instruction produced at the authorized
 * execution dispatch boundary. Carries only identities: the deterministic
 * instruction id, the single instruction kind, and the authorization id. The
 * authorization (and everything it relates to) is never duplicated here, and
 * no provider, network, transport, booking, payment, execution, or
 * persistence detail is carried.
 */
export interface TripExecutionDispatchInstruction {
  id: string;
  kind: typeof TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND;
  /** The validated execution-authorization identity (STEP 57) this dispatch covers. */
  authorizationId: string;
}

/**
 * The deterministic dispatch-instruction id for an authorization id:
 * `trip-execution-dispatch:<authorizationId>`. Same authorization -> same
 * instruction id; different authorization -> different instruction id. No
 * timestamps, no randomness, no UUIDs, no browser state, no GPS, no generated
 * text.
 */
export function getTripExecutionDispatchId(authorizationId: string): string {
  return `${TRIP_EXECUTION_DISPATCH_ID_PREFIX}${authorizationId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthorizationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX) &&
    value.length > TRIP_PLANNING_EXECUTION_AUTHORIZATION_ID_PREFIX.length
  );
}

/**
 * True when `value` is a structurally valid, internally consistent dispatch
 * instruction: exact instruction kind, a well-formed authorization id, and a
 * deterministic id that still derives exactly from that authorization id.
 * Pure structural validation — it never checks provider availability, provider
 * credentials, booking availability, payment state, database state, execution
 * state, or user state, never infers whether the referenced authorization
 * exists outside the supplied value, never mutates `value`, and never changes
 * any status.
 */
export function isTripExecutionDispatchInstruction(
  value: unknown
): value is TripExecutionDispatchInstruction {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND) return false;

  const authorizationId = value.authorizationId;
  if (!isAuthorizationId(authorizationId)) return false;

  return getTripExecutionDispatchId(authorizationId) === value.id;
}

/**
 * The pure service function for the dispatch seam: given one structurally
 * valid planning execution authorization, derives the dispatch instruction
 * deterministically from `authorization.id`
 * (`instruction.authorizationId === authorization.id`), or returns `null` when
 * the supplied value is not a valid authorization (malformed, wrong kind,
 * inconsistent id, or prefix-only authorization id). Reuses the STEP 57
 * authorization validator.
 *
 * The function never performs database lookups, never calls a provider, never
 * performs network requests, never creates bookings or payments, never mutates
 * trips or itineraries, never repairs malformed input, never mutates the
 * authorization, and never selects a provider — it always returns a fresh,
 * identifiers-only value carrying the dispatch instruction and nothing else.
 */
export function createTripExecutionDispatchInstruction(
  authorization: TripPlanningExecutionAuthorization
): TripExecutionDispatchInstruction | null {
  if (!isTripPlanningExecutionAuthorization(authorization)) return null;

  return {
    id: getTripExecutionDispatchId(authorization.id),
    kind: TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
    authorizationId: authorization.id,
  };
}