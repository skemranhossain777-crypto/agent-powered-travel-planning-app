/**
 * STEP 52 - approved proposal -> explicit planning application.
 *
 * STEP 53 adds one additive export below: `isTripPlanningApplication`, the
 * structural application validator reused by the application-target
 * compatibility layer. It adds no imports and changes no STEP 52 behavior.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningComposition
 *     -> TripPlanningCompositionProposal    (STEP 50, 'proposed')
 *     -> Approved TripPlanningCompositionProposal   (STEP 51, 'approved')
 *     -> TripPlanningApplication            (this module, 'pending-application')
 *     -> [future application/persistence/execution boundary]   (NOT built)
 *
 * The planning application is an explicit, provider-neutral domain instruction
 * describing what an approved planning proposal is intended to apply. It is an
 * **intent**, not an execution: creating one persists nothing, mutates no trip,
 * calls no provider, and activates nothing. The approved proposal remains
 * untouched and is never re-approved or silently modified here.
 *
 * The factory enforces the **approved-only boundary**: a `proposed` proposal, a
 * malformed/inconsistent proposal, or a non-approvable status can never produce
 * an application. The same approved proposal always produces the same
 * deterministic application.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  isTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from './tripPlanningCompositionProposal';

/**
 * The deterministic, provider-neutral prefix for planning-application ids. Kept
 * distinct from `trip-planning-proposal:` so the application id space never
 * collides with the proposal id space it references.
 */
export const TRIP_PLANNING_APPLICATION_ID_PREFIX = 'trip-planning-application:' as const;

/** The single explicit kind carried by every planning application. */
export const TRIP_PLANNING_APPLICATION_KIND = 'trip-planning-application' as const;

/**
 * The application status vocabulary. The application is a freshly created
 * domain instruction awaiting the future application/persistence/execution
 * boundary, so STEP 52 introduces exactly one explicit state: `pending-application`.
 * It intentionally does NOT mean the application has been executed. No
 * `applied`/`executed`/`persisted`/`completed`/`booked` states exist here.
 */
export type TripPlanningApplicationStatus = 'pending-application';

/**
 * An explicit, provider-neutral planning application derived from one approved
 * composition proposal. Carries only stable identities — determinism holds
 * because identical approved proposals always produce identical applications
 * and any change in proposal members changes the proposal id and therefore the
 * application id.
 */
export interface TripPlanningApplication {
  id: string;
  kind: typeof TRIP_PLANNING_APPLICATION_KIND;
  status: TripPlanningApplicationStatus;
  /** The source approved proposal identity (STEP 50/51). */
  proposalId: string;
  /** The source composition identity (STEP 49). */
  compositionId: string;
  /** The origin place reference identity. */
  originReferenceId: string;
  /** The destination place reference identity. */
  destinationReferenceId: string;
  /** The optional transport reference identity. */
  transportReferenceId?: string;
}

/**
 * The deterministic application id for a proposal id:
 * `trip-planning-application:<proposalId>`. Same approved proposal -> same
 * application id; different proposal -> different application id; no
 * timestamps, no randomness, no UUIDs, no browser state, no GPS, no generated
 * prose. Mutable display labels are never part of the identity, and the id is
 * stable across repeated factory calls.
 */
export function getTripPlanningApplicationId(proposalId: string): string {
  return `${TRIP_PLANNING_APPLICATION_ID_PREFIX}${proposalId}`;
}

/**
 * Creates an explicit, non-executed planning application from an **approved**
 * composition proposal, or returns `null` when the input is not a valid,
 * internally consistent, approved proposal (null/undefined, malformed,
 * invalid kind/status, missing identities, internal inconsistency, or an id
 * that no longer derives deterministically from its compositionId). Reuses the
 * STEP 50 validator and the STEP 51 approval semantics.
 *
 * The approved-only boundary is enforced here: a `proposed` proposal (or a
 * `rejected`/unsupported status) can never produce an application — it is never
 * silently approved or repaired. The input proposal is never mutated, nothing
 * is persisted, no provider is invoked, and the application always starts in
 * the explicit `pending-application` state.
 */
export function createTripPlanningApplication(
  proposal: TripPlanningCompositionProposal
): TripPlanningApplication | null {
  if (!isTripPlanningCompositionProposal(proposal)) return null;
  if (proposal.status !== 'approved') return null;

  const application: TripPlanningApplication = {
    id: getTripPlanningApplicationId(proposal.id),
    kind: TRIP_PLANNING_APPLICATION_KIND,
    status: 'pending-application',
    proposalId: proposal.id,
    compositionId: proposal.compositionId,
    originReferenceId: proposal.originReferenceId,
    destinationReferenceId: proposal.destinationReferenceId,
  };

  if (proposal.transportReferenceId !== undefined) {
    application.transportReferenceId = proposal.transportReferenceId;
  }

  return application;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `value` is a structurally valid, internally consistent planning
 * application: the explicit application kind, the single `pending-application`
 * status, a deterministic id that still derives from its `proposalId`, non-empty
 * identity fields, and an optional transport identity that is either absent or
 * non-empty. Pure structural validation: it never checks a database, never
 * mutates `value`, and never changes application status. (`proposalId` is
 * validated as a non-empty identity string here, matching the deterministic
 * scope of STEP 52 — deeper proposal-shape checks live at the approved-only
 * factory boundary.) Additive STEP 53 export.
 */
export function isTripPlanningApplication(value: unknown): value is TripPlanningApplication {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_APPLICATION_KIND) return false;
  if (value.status !== 'pending-application') return false;

  const proposalId = value.proposalId;
  const compositionId = value.compositionId;
  const originReferenceId = value.originReferenceId;
  const destinationReferenceId = value.destinationReferenceId;

  if (typeof proposalId !== 'string' || proposalId.length === 0) return false;
  if (typeof compositionId !== 'string' || compositionId.length === 0) return false;
  if (typeof originReferenceId !== 'string' || originReferenceId.length === 0) return false;
  if (typeof destinationReferenceId !== 'string' || destinationReferenceId.length === 0) {
    return false;
  }
  if (
    value.transportReferenceId !== undefined &&
    (typeof value.transportReferenceId !== 'string' || value.transportReferenceId.length === 0)
  ) {
    return false;
  }

  return getTripPlanningApplicationId(proposalId) === value.id;
}