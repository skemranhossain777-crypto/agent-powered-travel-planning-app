/**
 * STEP 50 - explicit composition -> planning-proposal handoff.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningReference + TripTransportReference
 *     -> TripPlanningComposition   (STEP 49, validated planning context)
 *     -> TripPlanningCompositionProposal   (this module, explicit candidate)
 *     -> existing human review / approval mechanisms
 *
 * A proposal is a deliberate, provider-neutral candidate planning action derived
 * from ONE already-validated `TripPlanningComposition`. It is **not** an
 * itinerary item and it is **not** automatically applied. Creating a proposal
 * never creates or modifies a trip, itinerary day, transport plan,
 * accommodation, sightseeing, or budget; never assigns primaries; never
 * activates or saves references; never calls providers or AI; and never
 * triggers persistence. There is no implicit approval.
 *
 * This is intentionally NOT the STEP 15 AI proposal envelope
 * (`tripPlanningProposal.ts`). That module owns AI-authored editable-section
 * proposals (an `explanation` + a `TripPlanningUpdate` of the STEP 14 five
 * sections) and carries no identity and no status. This module owns a distinct,
 * composition-derived proposal KIND: it has a deterministic identity, a status,
 * and stable reference identities, and its only dependency is the validated
 * composition. The two are different kinds, not competing architectures.
 *
 * Status. STEP 50 ships the smallest explicit status vocabulary. There was no
 * existing proposal-status vocabulary in the repository (AI proposals carry no
 * status; the execution-approval statuses describe executable-operation states,
 * not planning proposals). The factory always produces the neutral pre-approval
 * state `proposed` and never an `approved` proposal. `approved`/`rejected` are
 * declared as forward vocabulary for a future human-approval flow, but STEP 50
 * does NOT implement approval execution: no existing pure approval operation
 * exists at this domain boundary (the existing AI-proposal apply helper merges
 * an AI proposal's `update` into a planning draft and has no composition
 * correlation), so per STEP 50 this layer stops at proposal creation.
 *
 * Immutability / snapshot semantics. The proposal holds only stable identities:
 * its own deterministic id, the source composition id, and the origin /
 * destination / optional transport reference ids. It does NOT copy live
 * provider data (pricing, traffic, timestamps, generated prose) into a second
 * competing representation; provenance stays on the underlying references.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import { isTripPlanningComposition } from './tripPlanningComposition';

/**
 * The deterministic, provider-neutral prefix for composition-proposal ids. Kept
 * distinct from `trip-composition:` so the proposal id space never collides
 * with the composition id space it references.
 */
export const TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX = 'trip-planning-proposal:' as const;

/** The single explicit kind carried by every composition-derived proposal. */
export const TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND = 'trip-planning-composition-proposal' as const;

/**
 * The smallest explicit proposal status vocabulary (STEP 50). `proposed` is the
 * repository-neutral pre-approval state and the only value the factory creates;
 * `approved`/`rejected` reuse the repository's existing approval wording for the
 * future human-approval flow and are never produced by this module.
 */
export type TripPlanningCompositionProposalStatus = 'proposed' | 'approved' | 'rejected';

/**
 * An explicit, provider-neutral planning candidate derived from one validated
 * `TripPlanningComposition`. Carries only stable identities — determinism holds
 * because identical compositions always produce identical proposals and any
 * change in composition members changes the composition id and therefore the
 * proposal id.
 */
export interface TripPlanningCompositionProposal {
  id: string;
  kind: typeof TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND;
  status: TripPlanningCompositionProposalStatus;
  /** The source composition identity (STEP 49). */
  compositionId: string;
  /** The origin place reference identity from the composition. */
  originReferenceId: string;
  /** The destination place reference identity from the composition. */
  destinationReferenceId: string;
  /** The optional transport reference identity from the composition. */
  transportReferenceId?: string;
}

/**
 * The deterministic proposal id for a composition id:
 * `trip-planning-proposal:<compositionId>`. Same composition -> same proposal
 * id; different composition -> different proposal id; no timestamps, no
 * randomness, no UUIDs, no browser state, no generated text in the identity.
 */
export function getTripPlanningCompositionProposalId(compositionId: string): string {
  return `${TRIP_PLANNING_COMPOSITION_PROPOSAL_ID_PREFIX}${compositionId}`;
}

/**
 * Creates an explicit, non-auto-applied planning proposal from a validated
 * composition, or returns `null` when the input is not a structurally valid,
 * internally consistent `TripPlanningComposition` (missing, malformed,
 * tampered, or inconsistent composition; invalid origin/destination/transport
 * member identities; invalid or non-derivable composition identity). Reuses the
 * STEP 49 validator. Deterministic and side-effect free: the input composition
 * is never mutated, no providers are called, nothing is persisted, and the
 * proposal always starts in the neutral pre-approval state `proposed`.
 */
export function createTripPlanningCompositionProposal(
  composition: unknown
): TripPlanningCompositionProposal | null {
  if (!isTripPlanningComposition(composition)) return null;

  const proposal: TripPlanningCompositionProposal = {
    id: getTripPlanningCompositionProposalId(composition.id),
    kind: TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND,
    status: 'proposed',
    compositionId: composition.id,
    originReferenceId: composition.origin.referenceId,
    destinationReferenceId: composition.destination.referenceId,
  };

  if (composition.transport !== undefined) {
    proposal.transportReferenceId = composition.transport.referenceId;
  }

  return proposal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an already-built `TripPlanningCompositionProposal` structurally and
 * for internal consistency (STEP 51). Checks the discriminated `kind`, a known
 * status value, non-empty identity fields, the no-self-leg and no-transport-
 * collision rules on the reference ids, and — crucially — that the carried
 * `id` re-derives deterministically from the carried `compositionId` via the
 * Step 50 id builder. A tampered, forged, or inconsistent proposal fails. This
 * is the single validator downstream layers (e.g. the approval transition)
 * reuse instead of re-encoding the rules.
 */
export function isTripPlanningCompositionProposal(
  value: unknown
): value is TripPlanningCompositionProposal {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_PLANNING_COMPOSITION_PROPOSAL_KIND) return false;
  if (
    value.status !== 'proposed' &&
    value.status !== 'approved' &&
    value.status !== 'rejected'
  ) {
    return false;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.compositionId !== 'string' || value.compositionId.length === 0) {
    return false;
  }
  if (typeof value.originReferenceId !== 'string' || value.originReferenceId.length === 0) {
    return false;
  }
  if (typeof value.destinationReferenceId !== 'string' || value.destinationReferenceId.length === 0) {
    return false;
  }
  if (
    value.transportReferenceId !== undefined &&
    (typeof value.transportReferenceId !== 'string' || value.transportReferenceId.length === 0)
  ) {
    return false;
  }
  if (value.originReferenceId === value.destinationReferenceId) return false;
  if (
    value.transportReferenceId === value.originReferenceId ||
    value.transportReferenceId === value.destinationReferenceId
  ) {
    return false;
  }
  return value.id === getTripPlanningCompositionProposalId(value.compositionId);
}