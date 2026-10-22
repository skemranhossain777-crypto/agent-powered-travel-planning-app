/**
 * STEP 53 - planning application target contract.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningComposition
 *     -> TripPlanningCompositionProposal     (STEP 50, 'proposed')
 *     -> Approval                            (STEP 51, 'approved')
 *     -> TripPlanningApplication             (STEP 52, 'pending-application')
 *     -> TripPlanningApplicationTarget       (this module)
 *     -> [future persistence/application executor boundary]   (NOT built)
 *
 * The target is a **domain value**, not a database record. It answers one
 * question: "which existing trip-planning context is a planning application
 * intended to apply to?" The target never applies the application: creating it
 * persists nothing, mutates no trip or itinerary, calls no provider, executes
 * nothing, and never changes application status.
 *
 * Scope is deliberately **trip-level only**. The repository has no stable
 * lower-level planning identity for a trip (day plans carry `dayNumber` labels,
 * not stable ids), so `trip` is the single supported target scope and no
 * day/segment scope is invented. Choosing a trip-level target never silently
 * implies an itinerary-day mutation.
 *
 * Trip identity follows the repository's existing trip-id rule (non-empty
 * string, at most 1500 chars, no slashes, not "." or ".."), the same
 * structural rule `isValidTripId`/`isValidStorageId` enforce at the
 * persistence boundary. The pure domain module mirrors that rule instead of
 * importing the Firestore-adjacent services layer, so no infrastructure
 * dependency leaks into the domain graph. This is never a database existence
 * check: a structurally valid trip id is accepted whether or not the trip
 * exists yet.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. There is no dependency on the proposal,
 * approval, or application factories beyond the STEP 52 validator import below.
 */

import { isTripPlanningApplication } from './tripPlanningApplication';

/**
 * The deterministic prefix for application-target ids. Kept distinct from the
 * application/proposal id spaces so target identity never collides with the
 * intent it describes.
 */
export const TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX = 'trip-planning-target:' as const;

/** The single explicit kind carried by every application target. */
export const TRIP_PLANNING_APPLICATION_TARGET_KIND = 'trip-planning-application-target' as const;

/**
 * The complete, explicit application-target scope vocabulary. STEP 53 supports
 * exactly one scope — `trip` — because no stable day/segment planning identity
 * exists in the repository. Lower-level scopes are rejected, never invented.
 */
export const TRIP_PLANNING_APPLICATION_TARGET_SCOPES = ['trip'] as const;

/** The single supported target scope. */
export const TRIP_PLANNING_APPLICATION_TARGET_SCOPE_TRIP = 'trip' as const;

/**
 * The maximum trip-id length allowed by the existing trip-domain rule (mirrors
 * the 1500-char bound enforced by `isValidStorageId`/`isValidTripId`).
 */
export const TRIP_PLANNING_APPLICATION_TARGET_MAX_TRIP_ID_LENGTH = 1500 as const;

export type TripPlanningApplicationTargetScope =
  (typeof TRIP_PLANNING_APPLICATION_TARGET_SCOPES)[number];

/** The minimal, narrow input a caller must provide to create a target. */
export interface TripPlanningApplicationTargetInput {
  scope: TripPlanningApplicationTargetScope;
  tripId: string;
}

/**
 * The provider-neutral target of a planning application: which existing
 * trip-planning context the application is intended to apply to. Carries only
 * stable identities — a deterministic id, the target kind, the explicit scope,
 * and the trip id. No Google/provider ids, no provider payloads, no
 * credentials, no booking ids, no payment data, and no mutable trip names or
 * descriptions.
 */
export interface TripPlanningApplicationTarget {
  id: string;
  kind: typeof TRIP_PLANNING_APPLICATION_TARGET_KIND;
  scope: TripPlanningApplicationTargetScope;
  tripId: string;
}

/**
 * The deterministic target id for a scope and trip id:
 * `trip-planning-target:<scope>:<tripId>`. Same scope + trip id -> same id;
 * different trip id -> different id; different scope -> different id. No
 * timestamps, no randomness, no UUIDs, no browser state, no GPS, no generated
 * text. Mutable trip names/descriptions never participate in the identity.
 */
export function getTripPlanningApplicationTargetId(scope: string, tripId: string): string {
  return `${TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX}${scope}:${tripId}`;
}

/**
 * True when `value` is a structurally valid trip id per the existing trip-domain
 * rule (mirrors `isValidStorageId`/`isValidTripId`, which the services layer
 * applies at the persistence boundary). Pure, deterministic, and deliberately
 * NOT a database lookup — a trip id is accepted without assuming the trip
 * exists anywhere.
 */
export function isValidTripApplicationTargetTripId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > TRIP_PLANNING_APPLICATION_TARGET_MAX_TRIP_ID_LENGTH
  ) {
    return false;
  }
  return value !== '.' && value !== '..' && !value.includes('/');
}

/** True only for a supported application-target scope (`trip`). */
export function isTripPlanningApplicationTargetScope(
  value: unknown
): value is TripPlanningApplicationTargetScope {
  return TRIP_PLANNING_APPLICATION_TARGET_SCOPES.some((scope) => scope === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `value` is a structurally valid, internally consistent application
 * target: the target kind, a supported scope, a valid trip id, and an id that
 * still derives deterministically from its scope + trip id. Pure structural
 * validation — no database existence check, no mutation, no status changes.
 */
export function isTripPlanningApplicationTarget(
  value: unknown
): value is TripPlanningApplicationTarget {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_APPLICATION_TARGET_KIND) return false;

  const { scope, tripId } = value;
  if (!isTripPlanningApplicationTargetScope(scope)) return false;
  if (!isValidTripApplicationTargetTripId(tripId)) return false;

  return getTripPlanningApplicationTargetId(scope, tripId) === value.id;
}

/**
 * Creates an explicit application target for a supported scope and valid trip
 * id, or returns `null` when the input is missing, malformed, carries an
 * unsupported scope, or carries an invalid trip id. The factory only ever
 * constructs the target the caller explicitly names — it never picks, infers,
 * or auto-selects a target, and it never applies, persists, or executes the
 * application. Inputs are never mutated. A valid trip id is accepted without
 * any database existence check.
 */
export function createTripPlanningApplicationTarget(
  input: TripPlanningApplicationTargetInput
): TripPlanningApplicationTarget | null {
  if (!isRecord(input)) return null;
  if (!isTripPlanningApplicationTargetScope(input.scope)) return null;
  if (!isValidTripApplicationTargetTripId(input.tripId)) return null;

  return {
    id: getTripPlanningApplicationTargetId(input.scope, input.tripId),
    kind: TRIP_PLANNING_APPLICATION_TARGET_KIND,
    scope: input.scope,
    tripId: input.tripId,
  };
}

/**
 * True when a structurally valid, pending planning application can be matched
 * to a structurally valid application target: the application passes the STEP 52
 * validator (correct kind, deterministic id, explicit `pending-application`
 * status), the target passes the target validator, and the target scope is
 * supported. The two are never mutated, nothing is persisted, no provider or AI
 * is invoked, no database is consulted, and the application status is never
 * changed. For STEP 53 a valid trip-level target is compatible with any valid
 * pending application — the compatibility layer only ever matches the caller's
 * explicit target; it never selects one itself.
 */
export function canApplyTripPlanningApplicationToTarget(
  application: unknown,
  target: unknown
): boolean {
  if (!isTripPlanningApplication(application)) return false;
  if (!isTripPlanningApplicationTarget(target)) return false;
  if (application.status !== 'pending-application') return false;
  return true;
}