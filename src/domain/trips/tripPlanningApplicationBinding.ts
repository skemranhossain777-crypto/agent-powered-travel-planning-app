/**
 * STEP 54 - planning application binding.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningComposition
 *     -> TripPlanningCompositionProposal     (STEP 50, 'proposed')
 *     -> Approval                            (STEP 51, 'approved')
 *     -> TripPlanningApplication             (STEP 52, 'pending-application')
 *     -> TripPlanningApplicationTarget       (STEP 53)
 *     -> Compatibility                       (STEP 53)
 *     -> TripPlanningApplicationBinding      (this module)
 *     -> [future persistence/application executor boundary]   (NOT built)
 *
 * The binding is the validated domain intent "this planning application is
 * being applied to this specific planning target." It is a **relationship
 * value**, not an execution record: creating one persists nothing, mutates no
 * trip or itinerary, calls no provider or AI, marks nothing as executed, and
 * never changes the application or target.
 *
 * The binding carries only the two identity strings required to express the
 * relationship — `applicationId` and `targetId` — plus a deterministic id and
 * the single explicit kind. It never duplicates the application or target
 * objects, carries no timestamps, randomness, provider fields, execution
 * status, or persistence metadata, and never introduces a status transition.
 *
 * Identity is deterministic: `trip-planning-binding:<applicationId>:<targetId>`.
 * Same pair -> same binding id; changed application or target -> different
 * binding id; no clock, no entropy, no generated prose.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches. This module imports only the two
 * adjacent pure domain modules from STEP 52/53.
 */

import {
  isTripPlanningApplication,
  TRIP_PLANNING_APPLICATION_ID_PREFIX,
  type TripPlanningApplication,
} from './tripPlanningApplication';
import {
  canApplyTripPlanningApplicationToTarget,
  isTripPlanningApplicationTarget,
  TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX,
  type TripPlanningApplicationTarget,
} from './tripPlanningApplicationTarget';

/**
 * The deterministic, provider-neutral prefix for binding ids. Kept distinct
 * from the application and target id spaces so a binding id never collides
 * with either of the two identities it relates.
 */
export const TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX = 'trip-planning-binding:' as const;

/** The single explicit kind carried by every planning application binding. */
export const TRIP_PLANNING_APPLICATION_BINDING_KIND = 'trip-planning-application-binding' as const;

/**
 * The validated relationship between one pending planning application and one
 * compatible application target. Carries only identities: the deterministic
 * binding id, the SINGLE binding kind, the application id, and the target id.
 * The application and target objects are never duplicated here, and no
 * execution status, booking status, persistence metadata, or provider data is
 * carried.
 */
export interface TripPlanningApplicationBinding {
  id: string;
  kind: typeof TRIP_PLANNING_APPLICATION_BINDING_KIND;
  /** The bound planning application identity (STEP 52). */
  applicationId: string;
  /** The bound application-target identity (STEP 53). */
  targetId: string;
}

/**
 * The deterministic binding id for an application id and target id:
 * `trip-planning-binding:<applicationId>:<targetId>`. Same pair -> same id;
 * different application or target -> different id. No timestamps, no
 * randomness, no UUIDs, no browser state, no GPS, no generated text.
 */
export function getTripPlanningApplicationBindingId(
  applicationId: string,
  targetId: string
): string {
  return `${TRIP_PLANNING_APPLICATION_BINDING_ID_PREFIX}${applicationId}:${targetId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApplicationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_APPLICATION_ID_PREFIX) &&
    value.length > TRIP_PLANNING_APPLICATION_ID_PREFIX.length
  );
}

function isTargetId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX) &&
    value.length > TRIP_PLANNING_APPLICATION_TARGET_ID_PREFIX.length
  );
}

/**
 * True when `value` is a structurally valid, internally consistent planning
 * application binding: exact binding kind, a well-formed application id, a
 * well-formed target id, and a deterministic id that still derives exactly from
 * those two identities. Pure structural integrity — it never checks a database,
 * never infers whether the referenced application or target exists outside the
 * supplied value, never mutates `value`, and never changes any status.
 */
export function isTripPlanningApplicationBinding(
  value: unknown
): value is TripPlanningApplicationBinding {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_APPLICATION_BINDING_KIND) return false;

  const applicationId = value.applicationId;
  const targetId = value.targetId;
  if (!isApplicationId(applicationId)) return false;
  if (!isTargetId(targetId)) return false;

  return getTripPlanningApplicationBindingId(applicationId, targetId) === value.id;
}

/**
 * Creates the validated binding for one pending planning application and one
 * compatible application target, or returns `null` when the application is not
 * structurally valid (including any status other than `pending-application`),
 * the target is not structurally valid, or the pair is not compatible. Reuses
 * the STEP 52/53 application validator, the STEP 53 target validator, and the
 * STEP 53 compatibility operation. The binding id is derived deterministically
 * from the two supplied ids (`binding.applicationId === application.id`,
 * `binding.targetId === target.id`).
 *
 * The factory never auto-selects a target (the caller must supply one), never
 * repairs malformed input, never marks the application as executed/applied, and
 * never mutates either input — it always returns a fresh, identifiers-only
 * value.
 */
export function createTripPlanningApplicationBinding(
  application: TripPlanningApplication,
  target: TripPlanningApplicationTarget
): TripPlanningApplicationBinding | null {
  if (!isTripPlanningApplication(application)) return null;
  if (!isTripPlanningApplicationTarget(target)) return null;
  if (!canApplyTripPlanningApplicationToTarget(application, target)) return null;

  return {
    id: getTripPlanningApplicationBindingId(application.id, target.id),
    kind: TRIP_PLANNING_APPLICATION_BINDING_KIND,
    applicationId: application.id,
    targetId: target.id,
  };
}