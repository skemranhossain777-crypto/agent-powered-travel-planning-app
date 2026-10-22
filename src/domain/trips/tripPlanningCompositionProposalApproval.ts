/**
 * STEP 51 - pure domain approval transition for composition proposals.
 *
 * The architectural transition this module owns is:
 *
 *   TripPlanningComposition
 *     -> TripPlanningCompositionProposal       (STEP 50, 'proposed')
 *     -> Approved TripPlanningCompositionProposal   (this module, 'approved')
 *     -> [future application/execution layer]  (NOT built in STEP 51)
 *
 * Approval is the one explicit, forward transition `proposed -> approved`. It
 * is:
 *
 * 1. **Explicit** - it is called deliberately; there is no implicit approval.
 * 2. **Deterministic** - the same valid proposal always approves to the same
 *    value; no clock, randomness, generated ids, browser state, environment,
 *    provider response, or generated text participates.
 * 3. **Validated** - a malformed, tampered, or internally inconsistent proposal
 *    is rejected (`null`), never silently repaired.
 * 4. **Side-effect free** - nothing is persisted, saved, created, mutated,
 *    executed, booked, activated, or emitted.
 * 5. **Idempotent** - approving an already-`approved` proposal returns an
 *    equivalent approved proposal: the id, references, composition id, and kind
 *    never change, and no error is thrown just because it is approved.
 *
 * Approval does NOT mean persistence, itinerary mutation, trip creation,
 * provider execution, booking, activation, or primary assignment. The approved
 * proposal remains a proposal - the future application/execution layer is
 * intentionally out of scope.
 *
 * The only status transition introduced is `proposed -> approved`. Following the
 * Step 50 status vocabulary, `rejected` is a recognized state but is NOT a valid
 * approval source, and any unrecognized status is rejected as malformed.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  isTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from './tripPlanningCompositionProposal';

/**
 * Validates then approves a composition proposal: `proposed -> approved`.
 *
 * Returns `null` when the input is not a structurally valid, internally
 * consistent `TripPlanningCompositionProposal` (null/undefined, malformed,
 * invalid kind/status, missing identities, internal inconsistency, or an id
 * that no longer derives deterministically from its compositionId), and when the
 * proposal has already left the `proposed` state via `rejected`.
 *
 * Approving an already-`approved` proposal is **idempotent**: it returns an
 * equivalent approved proposal with the same id, kind, compositionId, and
 * reference ids. The input object is never mutated — every return value is a
 * fresh, separate value.
 */
export function approveTripPlanningCompositionProposal(
  proposal: TripPlanningCompositionProposal
): TripPlanningCompositionProposal | null {
  if (!isTripPlanningCompositionProposal(proposal)) return null;
  if (proposal.status === 'rejected') return null;

  if (proposal.status === 'approved') {
    return { ...proposal };
  }

  return { ...proposal, status: 'approved' };
}