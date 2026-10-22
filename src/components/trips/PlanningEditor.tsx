/**
 * Presentational structured-planning editor (STEP 14, expanded in STEP 16).
 *
 * Renders the bounded editable planning sections of a Trip Workspace — trip
 * dates, destinations, daily itinerary, planning notes, and external
 * references — plus the STEP 16 explicitly entered sections: transport plans,
 * accommodation plans, and the numeric budget plan (all user-entered planning
 * data, never a booking). The AI-itinerary transportation/hotels/budget summary
 * rows stay read-only and are not rendered here.
 *
 * STEP 17 additions: each transport/accommodation plan card shows a read-only
 * execution-readiness chip (`Planned` by default, via the pure label helper).
 * It is presentational only — there is no readiness editor, and the label never
 * claims a booking ("booked", "confirmed reservation", or "ticket purchased"
 * are never rendered). A user-entered reference stays planning data, never
 * proof of a booking.
 *
 * STEP 18 additions: an execution-preparation checklist section (tasks) in the
 * same explicit-edit pattern as the STEP 16 sections. Tasks are entirely
 * user-authored and provider-independent — no AI proposal and no external
 * system ever creates, edits, or completes a task here or elsewhere. Status
 * wording stays neutral (Pending / In progress / Completed / Skipped) and
 * never claims a booking, payment, or external verification. Related plan/section
 * references are free-form and are never existence-checked, so a deleted plan
 * never breaks the trip.
 *
 * STEP 23 additions: each transport/accommodation plan card shows a read-only
 * provenance chip ("Manual reference", "AI-generated reference", "Simulated
 * discovery", or "External provider reference — not verified") when the plan
 * carries provenance metadata, plus a bounded "Source note" input and, for
 * simulated-discovery plans only, an explicit "Mark as manually entered"
 * action that re-labels the plan as a manual reference. Provenance is never
 * inferred and never auto-created: merely viewing or focusing the controls
 * leaves a legacy plan (no provenance) unchanged, and ordinary plan-field edits
 * never change a provenance kind. Newly added plans default to the honest
 * `manual` label for data the owner types here.
 *
 * STEP 24 additions: each transport/accommodation plan card shows a read-only
 * lifecycle chip ("Active", "Needs review", "Replaced", or "Archived"). A
 * legacy plan with no lifecycle metadata shows "Active" as its effective
 * read-time default without ever persisting it. When the section is being
 * edited, a compact lifecycle action group lets the owner mark the plan as
 * needing review, active, replaced, or archived (and restore an archived one) —
 * each action only updates the current plan's `lifecycleState` in the draft;
 * explicit Save persists it, and no action ever touches readiness, provenance,
 * checklist tasks, or booking/verification state. Archived plans stay visible
 * (rendered in a visually subdued card) and restorable — archive is never a
 * deletion. Nothing here transitions a lifecycle state automatically.
 *
 * STEP 26 additions: each transport/accommodation section carries a "Primary"
 * selection control that shows whether the owner has explicitly chosen a
 * primary reference ("Primary selected" / "No primary selected" /
 * "Primary assignment needs attention"). Only effective-lifecycle `active`
 * plans are offered as options — replaced, archived, and needs-review plans are
 * never selectable — and there is never an automatic first-plan selection. The
 * control stages `primaryTransportPlanId` / `primaryAccommodationPlanId` in the
 * local draft only (a cleared selection is staged as `null`); explicit Save
 * persists it. Nothing here infers, repairs, or converts a selection, and the
 * handoff/AI never assign one.
 *
 * STEP 28 additions: after an explicit user action that resolves a primary
 * conflict — selecting another active plan, clearing the primary, or restoring
 * the selected inactive plan to active — a concise, honest feedback line is
 * shown until Save. No resolution record is persisted: the resulting primary ID
 * and lifecycle state are the only persisted truth. Unresolved conflicts remain
 * visibly labeled as unresolved.
 *
 * STEP 30 additions: an explicit save of the planning draft pauses once when
 * the draft changes the planning-reference state — a new, changed, cleared, or
 * restored primary selection; a lifecycle transition (Active ↔ Needs review,
 * Active → Replaced, Archived → Active); a provenance-kind change; or a change
 * to a reference's source URL — and asks the owner to review the exact change
 * before persisting. The compact review panel sits beside the Save action
 * (never a modal), is derived from the current draft on every render, and
 * offers "Save planning changes" (one confined call through the existing
 * onSave flow) or "Keep editing" (closes the panel and preserves the draft
 * untouched). An unresolved primary assignment is surfaced honestly ("will
 * remain unresolved if saved") and is never auto-selected, auto-cleared, or
 * repaired. Ordinary notes, destinations, dates, budget, checklist text, plan
 * text, and adding or removing a reference never open a review.
 *
 * STEP 31 additions: save-state integrity between the review, the draft, and the
 * page-owned save operation. The review body is always re-derived from the
 * latest baseline + draft on every render (never a snapshot in state), so it
 * stays as fresh as the draft while the panel is open. Confirming no longer
 * closes the panel optimistically: it stays visible (and exact) while the save
 * is in flight, then closes on success when the page clears the draft, and
 * remains available after a failed save alongside the existing error message so
 * the owner can retry or go back to editing. A synchronous in-flight guard
 * prevents a double activation of Save or "Save planning changes" in the same
 * tick from submitting twice; afterwards the page's `saveState === 'saving'`
 * keeps every submit control disabled until the save resolves.
 *
 * STEP 32 additions: keyboard and screen-reader hardening for the review.
 * The review group is labelled by its own heading via `aria-labelledby` (never
 * a live region and never an alert), the panel itself carries no
 * `role="status"`/`role="alert"` semantics, and the accessible names of the
 * page Save, review confirm, and Keep-editing actions stay unique. Focus is
 * managed minimally: opening moves focus to the (programmatically focusable)
 * heading once — never again on later re-renders, even as the draft changes
 * behind the open panel; "Keep editing" returns focus to the Save control the
 * review was opened from; confirming keeps focus where it is (the confirmation
 * is disabled while the page reports `'saving'`); a failed save leaves focus
 * on the now re-enabled confirmation inside the intact panel; and a successful
 * save that removes the panel relocates focus to the first planning-section
 * action instead of leaving it on a removed element.
 *
 * STEP 16 sections are read-only by default: each offers an explicit Edit
 * affordance and a section-level Cancel that reverts the section to its
 * persisted value. Budget edits include an explicit "Clear budget plan" action
 * (`budgetPlan: null`). All amounts are canonical numbers — never formatted
 * currency strings.
 *
 * The component is presentational: the page owns the draft (`PlanningDraft`, a
 * partial `TripPlanningUpdate` keyed to a trip id) and the save flow. Here a
 * present/absent key decides effective vs. persisted values, validation
 * feedback comes from the pure `tripPlanningEdit` boundary, and local ids for
 * newly added destinations/references/plans are generated in the UI layer only
 * (the domain stays deterministic). No autosave, no unload prompts, no
 * optimistic persistence — saving is always explicit through `onSave`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import type { Activity, DayPlan } from '../../types/travel';
import type {
  TripAccommodationPlan,
  TripBudgetAllocations,
  TripBudgetPlan,
  TripChecklistItem,
  TripDateRange,
  TripDestination,
  TripPlanLifecycleState,
  TripPlanningData,
  TripPlanningProposal,
  TripPlanningReference,
  TripPlanningUpdate,
  TripTaskCategory,
  TripTaskRelatedSection,
  TripTaskStatus,
  TripTransportPlan,
  TripWorkspace,
} from '../../types/trip';
import {
  getPlanningUpdateProblem,
  isPlanningUpdateDirty,
  MAX_TRIP_DESTINATIONS,
} from '../../domain/trips/tripPlanningEdit';
import { getTripExecutionReadinessLabel } from '../../domain/trips/executionReadiness';
import {
  getTripPlanProvenanceDescription,
  getTripPlanProvenanceLabel,
  isSimulatedProvenance,
} from '../../domain/trips/planningProvenance';
import {
  getEffectiveTripPlanLifecycleState,
  getTripPlanLifecycleDescription,
  getTripPlanLifecycleLabel,
  isArchivedReference,
} from '../../domain/trips/planningLifecycle';
import {
  getPrimarySelectionStatusLabel,
  isPlanEligibleAsPrimary,
  isPrimarySelectionAttentionState,
  partitionPlanningReferencesWithPrimary,
} from '../../domain/trips/planningReferenceSelection';
import {
  doesLifecycleTransitionCreatePrimaryConflict,
  doesLifecycleTransitionResolvePrimaryConflict,
  getPrimaryAssignmentConflictDetail,
  resolvePrimaryAssignmentStatus,
} from '../../domain/trips/planningReferenceConflict';
import {
  classifyPrimaryResolutionDecision,
  getPrimaryResolutionDecisionLabel,
  isPrimaryConflictUnresolved,
  isPrimaryResolutionDecisionCompatible,
  type PrimaryAssignmentStateSnapshot,
  type PrimaryResolutionAction,
  type PrimaryResolutionDecision,
} from '../../domain/trips/planningReferenceResolution';
import {
  comparePlanningReferenceSectionChange,
  getAccommodationPlanReferenceLabel,
  getTransportPlanReferenceLabel,
} from '../../domain/trips/planningReferenceChangeContext';
import {
  classifyPlanningReferenceSaveReview,
  describePlanningReferenceSaveReviewItem,
  getPlanningReferenceSaveReviewItemGuidance,
  getPlanningReferenceSaveReviewSectionLabel,
} from '../../domain/trips/planningReferenceSaveReview';
import {
  getTripTaskCategoryLabel,
  getTripTaskRelatedSectionLabel,
  getTripTaskStatusLabel,
  TRIP_TASK_CATEGORIES,
  TRIP_TASK_RELATED_SECTIONS,
  TRIP_TASK_STATUSES,
} from '../../domain/trips/executionChecklist';
import { stripTripId } from '../../domain/trips/tripPlanningEdit';
import type { PlanningDraft } from '../../domain/trips/tripPlanningEdit';
import {
  summarizeProposalChanges,
  type TripPlanningDiffRow,
} from '../../domain/trips/tripPlanningProposal';

export type { PlanningDraft } from '../../domain/trips/tripPlanningEdit';

/** The save lifecycle owned by the page for the planning editor. */
export type PlanningSaveState = { status: 'idle' } | { status: 'saving' } | { status: 'error' };

export type ReferenceKind = TripPlanningReference['kind'];

/**
 * AI suggestion lifecycle owned by the page (STEP 15). `ready` carries the
 * validated `TripPlanningProposal` plus the trip id it belongs to and the draft
 * snapshot it was merged from, so the preview never shows another trip's
 * proposal. `applied` turns true once the user approves the proposal (the
 * change is staged in the local draft only — persistence still requires Save).
 */
export type AiAssistState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      tripId: string;
      proposal: TripPlanningProposal;
      previousDraft: PlanningDraft | null;
      applied: boolean;
    };

interface PlanningEditorProps {
  trip: TripWorkspace;
  draft: PlanningDraft | null;
  onChange: (next: PlanningDraft) => void;
  onSave: (draft: PlanningDraft) => void;
  saveState: PlanningSaveState;
  /** True while an unrelated in-flight action must disable planning inputs. */
  disabled: boolean;
  /** Current AI suggestion lifecycle state, owned by the page. */
  aiState: AiAssistState;
  /** Ask the page to request a validated proposal for a trimmed instruction. */
  onGenerateSuggestion: (instruction: string) => void;
  /** Approve a proposal: stage its changes in the local draft (no persistence). */
  onApplySuggestion: (proposal: TripPlanningProposal) => void;
  /** Discard the current suggestion / error and return to idle. */
  onDiscardSuggestion: () => void;
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  color: '#fff',
  fontSize: '0.85rem',
  padding: '0.5rem 0.7rem',
  outline: 'none',
  fontFamily: 'inherit',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#94a3b8',
  margin: 0,
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#4ade80',
  margin: '0 0 0.5rem 0',
};

/**
 * STEP 32: stable id that labels the save-review group with its own heading via
 * `aria-labelledby`, so the group's accessible name is "Review changes before
 * saving" and the heading is architecturally associated with the group. There
 * is exactly one PlanningEditor per trip, so a fixed id is collision-safe.
 */
const SAVE_REVIEW_HEADING_ID = 'planning-reference-review-heading';

/** Read-only execution-readiness chip (STEP 17): a label, never a booking. */
const READINESS_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#94a3b8',
  border: '1px solid rgba(51, 65, 85, 0.4)',
  borderRadius: '999px',
  padding: '0.1rem 0.45rem',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

/** Read-only provenance chip (STEP 23): a source-of-record label, never a booking. */
const PROVENANCE_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#7dd3fc',
  border: '1px solid rgba(56, 189, 248, 0.35)',
  borderRadius: '999px',
  padding: '0.1rem 0.45rem',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

/** Distinguishing chip style for simulated (mock-discovery) provenance. */
const SIMULATED_PROVENANCE_LABEL_STYLE: React.CSSProperties = {
  ...PROVENANCE_LABEL_STYLE,
  color: '#fbbf24',
  border: '1px solid rgba(251, 191, 36, 0.4)',
};

/** Lifecycle chip (STEP 24): a user-managed planning state, never a booking claim. */
const LIFECYCLE_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#86efac',
  border: '1px solid rgba(74, 222, 128, 0.35)',
  borderRadius: '999px',
  padding: '0.1rem 0.45rem',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

/** Subdued lifecycle chip for archived references (STEP 24). */
const ARCHIVED_LIFECYCLE_LABEL_STYLE: React.CSSProperties = {
  ...LIFECYCLE_LABEL_STYLE,
  color: '#94a3b8',
  border: '1px solid rgba(100, 116, 139, 0.35)',
};

/** Compact lifecycle action button style shared by both plan editors (STEP 24). */
const LIFECYCLE_ACTION_STYLE: React.CSSProperties = {
  padding: '0.2rem 0.55rem',
  fontSize: '0.68rem',
  fontWeight: 800,
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

export const PlanningEditor: React.FC<PlanningEditorProps> = ({
  trip,
  draft,
  onChange,
  onSave,
  saveState,
  disabled,
  aiState,
  onGenerateSuggestion,
  onApplySuggestion,
  onDiscardSuggestion,
}) => {
  const [instruction, setInstruction] = useState('');
  const [editing, setEditing] = useState<EditingSections>({
    transport: false,
    accommodation: false,
    budget: false,
    tasks: false,
  });
  /**
   * STEP 28: transient user-facing record of the last explicit resolution
   * action per section. Never persisted — the staged primary id and lifecycle
   * state are the only persisted truth. Reset when the draft clears.
   */
  const [explicitResolution, setExplicitResolution] = useState<{
    transport: PrimaryResolutionDecision | null;
    accommodation: PrimaryResolutionDecision | null;
  }>({ transport: null, accommodation: null });
  /**
   * STEP 30: whether the save-review panel is open. The panel body is always
   * derived from the current draft on render (never a snapshot in state), so
   * cancelling it preserves the draft untouched. Reset when the draft clears.
   */
  const [saveReviewOpen, setSaveReviewOpen] = useState(false);
  const saveReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  /**
   * STEP 31: synchronous in-flight guard so a double activation of Save or
   * "Save planning changes" in the same tick cannot submit the draft twice.
   * This is only a same-tick guard; the page's `saveState` drives the visible
   * saving state and disables every submit control once it transitions to
   * 'saving'. The guard clears once `saveState` leaves 'saving' or when the
   * draft clears.
   */
  const saveSubmitInFlightRef = useRef(false);
  /**
   * STEP 32: DOM anchors for focus management. `saveButtonRef` is the target
   * for Keep editing (focus returns to the invoking Save control);
   * `planningSectionsRef` scopes the section-action button used as the
   * post-save-success focus target; `reviewFocusAnchorRef` records that the
   * review held keyboard focus, so a successful save that removes the panel can
   * relocate focus instead of leaving it on a removed element.
   */
  const saveReviewPanelRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const planningSectionsRef = useRef<HTMLDivElement>(null);
  const reviewFocusAnchorRef = useRef<HTMLElement | null>(null);
  /**
   * STEP 32: one-shot intent for Keep editing. The Save control is still
   * disabled (review open) while the handler runs, so the focus call must wait
   * until React commits saveReviewOpen=false and the control is focusable
   * again. A plain effect keyed on saveReviewOpen performs that commit-later
   * focus, guarded by this ref so success/auto closes never steal it.
   */
  const keepEditingFocusRef = useRef(false);
  const existing = draft && draft.tripId === trip.id ? draft : null;
  const update = existing ? stripTripId(existing) : ({} as TripPlanningUpdate);

  // STEP 16/18 sections start read-only and are only editable after their Edit
  // affordance is used; clearing the draft (post-save) resets that state.
  const draftCleared = existing === null;
  useEffect(() => {
    if (draftCleared) {
      setEditing({ transport: false, accommodation: false, budget: false, tasks: false });
      setExplicitResolution({ transport: null, accommodation: null });
      setSaveReviewOpen(false);
      // STEP 32: a successful save removes the review panel. When keyboard
      // focus last lived inside it, relocate focus to the first planning-section
      // action (the transport frame's Edit/Cancel, which React keeps as one
      // node as the reading toggles) instead of losing it on a removed element.
      if (reviewFocusAnchorRef.current !== null) {
        reviewFocusAnchorRef.current = null;
        // `button:not([disabled])` guarantees an HTMLButtonElement, so the
        // locally-scoped narrowing is sound.
        const sectionAction = planningSectionsRef.current?.querySelector(
          'button:not([disabled])'
        ) as HTMLButtonElement | null;
        sectionAction?.focus();
      }
    }
  }, [draftCleared]);

  /**
   * STEP 31: release the same-tick in-flight guard as soon as the page is no
   * longer reporting an active save. This lets a retry after a failure (or a
   * fresh save after success) submit again, while keeping the guard armed for
   * the whole duration of the page's `saving` state.
   */
  useEffect(() => {
    if (saveState.status !== 'saving') {
      saveSubmitInFlightRef.current = false;
    }
  }, [saveState.status]);

  /**
   * STEP 32: commit-later focus for Keep editing (see `keepEditingFocusRef`).
   * Runs on every saveReviewOpen flip but only acts when Keep editing asked
   * for the Save control, so other closing paths are untouched.
   */
  useEffect(() => {
    if (keepEditingFocusRef.current && !saveReviewOpen) {
      keepEditingFocusRef.current = false;
      saveButtonRef.current?.focus();
    }
  }, [saveReviewOpen, saveButtonRef]);

  const dirty = existing !== null && isPlanningUpdateDirty(trip, update);
  const problem = getPlanningUpdateProblem(update, {
    existingDestinations: trip.destinations,
  });
  const inputsDisabled = saveState.status === 'saving' || disabled;
  const canSave =
    existing !== null && dirty && problem === null && saveState.status !== 'saving' && !disabled;

  const effectiveDates: TripDateRange | null =
    existing?.dateRange !== undefined ? existing.dateRange : (trip.dateRange ?? null);
  const effectiveDestinations = existing?.destinations ?? trip.destinations;
  const atDestinationLimit = effectiveDestinations.length >= MAX_TRIP_DESTINATIONS;
  const effectiveDays = existing?.days ?? trip.itinerary?.dayPlans ?? [];
  const effectiveNotes = existing?.notes ?? trip.itinerary?.notes ?? [];
  const effectiveReferences = existing?.references ?? trip.itinerary?.references ?? [];
  const effectiveTransportPlans = existing?.transportPlans ?? trip.itinerary?.transportPlans ?? [];
  const effectiveAccommodationPlans =
    existing?.accommodationPlans ?? trip.itinerary?.accommodationPlans ?? [];
  const effectiveBudgetPlan: TripBudgetPlan | null =
    existing?.budgetPlan !== undefined ? existing.budgetPlan : (trip.itinerary?.budgetPlan ?? null);
  const effectiveTasks = existing?.tasks ?? trip.itinerary?.tasks ?? [];
  const effectivePrimaryTransportPlanId =
    existing?.primaryTransportPlanId !== undefined
      ? existing.primaryTransportPlanId
      : trip.itinerary?.primaryTransportPlanId;
  const effectivePrimaryAccommodationPlanId =
    existing?.primaryAccommodationPlanId !== undefined
      ? existing.primaryAccommodationPlanId
      : trip.itinerary?.primaryAccommodationPlanId;

  /**
   * STEP 28: the primary-assignment status of each section as currently staged
   * in the draft. These are the "prior" states the resolution classifier uses
   * when the user performs an explicit selection/clear/restore action.
   */
  const transportPriorStatus = resolvePrimaryAssignmentStatus(
    effectivePrimaryTransportPlanId ?? undefined,
    effectiveTransportPlans
  );
  const accommodationPriorStatus = resolvePrimaryAssignmentStatus(
    effectivePrimaryAccommodationPlanId ?? undefined,
    effectiveAccommodationPlans
  );

  /**
   * STEP 28: transient feedback text for each section. An explicit resolution
   * decision is shown until save only while it remains compatible with the
   * staged assignment (a later action that re-creates the conflict hides it);
   * otherwise the honest "remains unresolved" note is shown while the staged
   * assignment is still in a conflict state. No feedback for a healthy or
   * absent assignment.
   */
  const transportFeedbackState: PrimaryAssignmentStateSnapshot = {
    status: transportPriorStatus,
    selectedId: effectivePrimaryTransportPlanId ?? null,
    activePlanIds: effectiveTransportPlans.filter(isPlanEligibleAsPrimary).map((plan) => plan.id),
  };
  const transportExplicitDecision =
    explicitResolution.transport !== null &&
    isPrimaryResolutionDecisionCompatible(explicitResolution.transport, transportFeedbackState)
      ? explicitResolution.transport
      : null;
  const transportResolutionFeedback =
    transportExplicitDecision !== null
      ? getPrimaryResolutionDecisionLabel(transportExplicitDecision)
      : isPrimaryConflictUnresolved(transportPriorStatus)
        ? 'Primary assignment remains unresolved.'
        : null;
  const accommodationFeedbackState: PrimaryAssignmentStateSnapshot = {
    status: accommodationPriorStatus,
    selectedId: effectivePrimaryAccommodationPlanId ?? null,
    activePlanIds: effectiveAccommodationPlans
      .filter(isPlanEligibleAsPrimary)
      .map((plan) => plan.id),
  };
  const accommodationExplicitDecision =
    explicitResolution.accommodation !== null &&
    isPrimaryResolutionDecisionCompatible(
      explicitResolution.accommodation,
      accommodationFeedbackState
    )
      ? explicitResolution.accommodation
      : null;
  const accommodationResolutionFeedback =
    accommodationExplicitDecision !== null
      ? getPrimaryResolutionDecisionLabel(accommodationExplicitDecision)
      : isPrimaryConflictUnresolved(accommodationPriorStatus)
        ? 'Primary assignment remains unresolved.'
        : null;

  /**
   * STEP 29: transient user-visible change context per section, comparing the
   * persisted snapshot (baseline) against the effective draft values. Rendered
   * as a violet one-line summary; disappears after save clears the draft. No
   * change line when the message duplicates the STEP 28 resolution feedback.
   */
  const transportChangeContext = comparePlanningReferenceSectionChange('transport', {
    savedPlans: trip.itinerary?.transportPlans ?? [],
    savedPrimaryPlanId: trip.itinerary?.primaryTransportPlanId,
    draftPlans: effectiveTransportPlans,
    draftPrimaryPlanId: effectivePrimaryTransportPlanId,
  });
  const accommodationChangeContext = comparePlanningReferenceSectionChange('accommodation', {
    savedPlans: trip.itinerary?.accommodationPlans ?? [],
    savedPrimaryPlanId: trip.itinerary?.primaryAccommodationPlanId,
    draftPlans: effectiveAccommodationPlans,
    draftPrimaryPlanId: effectivePrimaryAccommodationPlanId,
  });
  const transportChangeMessage =
    transportChangeContext.message !== null &&
    transportChangeContext.message !== transportResolutionFeedback
      ? transportChangeContext.message
      : null;
  const accommodationChangeMessage =
    accommodationChangeContext.message !== null &&
    accommodationChangeContext.message !== accommodationResolutionFeedback
      ? accommodationChangeContext.message
      : null;

  /**
   * STEP 30/31: the review projection for the current draft — derived on every
   * render from the STEP 29 change contexts plus the effective plans, never a
   * saved snapshot. It decides whether an explicit save pauses for review and
   * lists exactly the review-worthy changes the owner would persist. Because it
   * is re-derived from the current baseline + draft on every render, it stays
   * exact even when the draft changes while the panel is open, and it cannot
   * outlive a baseline change (a successful save clears the draft, so old items
   * vanish with it).
   */
  const saveReview = classifyPlanningReferenceSaveReview(
    { transport: transportChangeContext, accommodation: accommodationChangeContext },
    { transportPlans: effectiveTransportPlans, accommodationPlans: effectiveAccommodationPlans }
  );

  /**
   * STEP 30/31: the panel closes itself the moment the draft stops demanding a
   * review (e.g. the edit was reverted), so it never shows a stale snapshot. A
   * successful save clears the draft through the same path — the review cannot
   * remain open once there is nothing left to review.
   */
  useEffect(() => {
    if (saveReviewOpen && !saveReview.shouldReview) {
      // STEP 32: the review no longer claims keyboard focus once it closes
      // itself, so a later plain save cannot treat it as the focus anchor.
      reviewFocusAnchorRef.current = null;
      setSaveReviewOpen(false);
    }
  }, [saveReviewOpen, saveReview.shouldReview]);

  /**
   * STEP 30: opening the panel moves keyboard focus to its heading so assistive
   * users land directly on the review, next in tab order to the Save controls.
   * STEP 32: this effect only fires when the panel's open state actually flips,
   * never on every render — so draft changes behind the open panel never steal
   * focus back to the heading. The heading is remembered as the focus anchor so
   * a successful save can relocate focus off the removed panel.
   */
  useEffect(() => {
    if (saveReviewOpen) {
      const heading = saveReviewHeadingRef.current;
      reviewFocusAnchorRef.current = heading;
      heading?.focus();
    }
  }, [saveReviewOpen]);

  // STEP 30: the main Save action pauses for review when the draft changes
  // reference state; confirming calls the same onSave the plain path would.
  // STEP 31: a synchronous in-flight guard rejects a second activation before
  // the page's `saveState` has had a chance to flip to 'saving', and confirming
  // no longer closes the panel optimistically — it stays open while the save is
  // in flight and only closes when the page clears the draft on success (or the
  // review stops being required), keeping a failed save's review fully intact.
  const handleSaveClick = () => {
    if (existing === null) return;
    if (saveSubmitInFlightRef.current) return;
    if (saveReview.shouldReview) {
      setSaveReviewOpen(true);
      return;
    }
    saveSubmitInFlightRef.current = true;
    onSave(existing);
  };
  const handleConfirmSaveReview = () => {
    if (existing === null) return;
    if (saveSubmitInFlightRef.current) return;
    saveSubmitInFlightRef.current = true;
    onSave(existing);
  };
  const handleKeepEditing = () => {
    // STEP 32: focus returns to the Save control the review was opened from.
    // The draft is never touched and no save fires. The actual focus() runs
    // after the commit (the Save control re-enables once the review closes).
    reviewFocusAnchorRef.current = null;
    keepEditingFocusRef.current = true;
    setSaveReviewOpen(false);
  };

  const sectionsEditable = !inputsDisabled;
  const transportEditing = editing.transport;
  const accommodationEditing = editing.accommodation;
  const budgetEditing = editing.budget;
  const tasksEditing = editing.tasks;
  const transportInputsDisabled = inputsDisabled || !transportEditing;
  const accommodationInputsDisabled = inputsDisabled || !accommodationEditing;
  const budgetInputsDisabled = inputsDisabled || !budgetEditing;
  const tasksInputsDisabled = inputsDisabled || !tasksEditing;

  const aiAvailable = trip.itinerary !== undefined;
  const aiBusy = aiState.status === 'generating';
  const canGenerate =
    aiState.status === 'idle' && instruction.trim().length > 0 && !inputsDisabled && !aiBusy;

  /** Current editable projection used to render the current → proposed diff. */
  const aiCurrent: TripPlanningData = {
    ...(effectiveDates ? { dates: effectiveDates } : {}),
    destinations: effectiveDestinations,
    days: effectiveDays,
    transportation: trip.itinerary?.transport ?? [],
    accommodation: trip.itinerary?.hotels ?? [],
    transportPlans: trip.itinerary?.transportPlans ?? [],
    accommodationPlans: trip.itinerary?.accommodationPlans ?? [],
    ...(trip.itinerary?.budgetPlan !== undefined ? { budgetPlan: trip.itinerary?.budgetPlan } : {}),
    ...(trip.itinerary
      ? {
          budget: {
            level: trip.itinerary.budgetLevel,
            estimatedTotalCost: trip.itinerary.estimatedTotalCost,
            ...(trip.itinerary.sightseeingCost !== undefined
              ? { sightseeingCost: trip.itinerary.sightseeingCost }
              : {}),
          },
        }
      : {}),
    notes: effectiveNotes,
    references: effectiveReferences,
  };

  const next = (patch: TripPlanningUpdate): PlanningDraft => ({
    tripId: trip.id,
    ...(existing ?? {}),
    ...patch,
  });

  const handleDateRangeChange = (patch: Partial<TripDateRange>): void => {
    const current = effectiveDates ?? { startDate: '', endDate: '' };
    onChange(next({ dateRange: { ...current, ...patch } }));
  };

  const handleClearDates = (): void => {
    onChange(next({ dateRange: null }));
  };

  const handleDestinationField = (id: string, field: 'name' | 'country', value: string): void => {
    const patch: Partial<TripDestination> = field === 'name' ? { name: value } : { country: value };
    onChange(
      next({
        destinations: effectiveDestinations.map((destination) =>
          destination.id === id ? { ...destination, ...patch } : destination
        ),
      })
    );
  };

  const handleAddDestination = (): void => {
    if (effectiveDestinations.length >= MAX_TRIP_DESTINATIONS) return;
    onChange(
      next({
        destinations: [...effectiveDestinations, { id: makeLocalId('dst'), name: '', country: '' }],
      })
    );
  };

  const handleRemoveDestination = (id: string): void => {
    onChange(
      next({
        destinations: effectiveDestinations.filter((destination) => destination.id !== id),
      })
    );
  };

  const handleDayField = (
    index: number,
    field: 'dayNumber' | 'title' | 'theme',
    value: string
  ): void => {
    let patch: Partial<DayPlan>;
    if (field === 'dayNumber') patch = { dayNumber: Number(value) };
    else if (field === 'title') patch = { title: value };
    else patch = { theme: value };
    onChange(
      next({
        days: effectiveDays.map((day, i) => (i === index ? { ...day, ...patch } : day)),
      })
    );
  };

  const handleAddDay = (): void => {
    const nextNumber =
      effectiveDays.length === 0 ? 1 : Math.max(...effectiveDays.map((day) => day.dayNumber)) + 1;
    onChange(
      next({
        days: [...effectiveDays, { dayNumber: nextNumber, title: '', theme: '', activities: [] }],
      })
    );
  };

  const handleRemoveDay = (index: number): void => {
    onChange(next({ days: effectiveDays.filter((_, i) => i !== index) }));
  };

  const handleActivityField = (
    dayIndex: number,
    activityIndex: number,
    field: ActivityField,
    value: string
  ): void => {
    onChange(
      next({
        days: effectiveDays.map((day, di) =>
          di === dayIndex
            ? {
                ...day,
                activities: day.activities.map((activity, ai) =>
                  ai === activityIndex ? setActivityValue(activity, field, value) : activity
                ),
              }
            : day
        ),
      })
    );
  };

  const handleAddActivity = (dayIndex: number): void => {
    onChange(
      next({
        days: effectiveDays.map((day, di) =>
          di === dayIndex ? { ...day, activities: [...day.activities, blankActivity()] } : day
        ),
      })
    );
  };

  const handleRemoveActivity = (dayIndex: number, activityIndex: number): void => {
    onChange(
      next({
        days: effectiveDays.map((day, di) =>
          di === dayIndex
            ? { ...day, activities: day.activities.filter((_, ai) => ai !== activityIndex) }
            : day
        ),
      })
    );
  };

  const handleNotesChange = (value: string): void => {
    onChange(
      next({
        notes: value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      })
    );
  };

  const handleReferenceField = (index: number, field: ReferenceField, value: string): void => {
    onChange(
      next({
        references: effectiveReferences.map((reference, ri) => {
          if (ri !== index) return reference;
          if (field === 'kind') return referenceWithKind(reference, value as ReferenceKind);
          if (field === 'url') return referenceWithUrl(reference, value);
          if (field === 'dayNumber') return referenceWithDayNumber(reference, value);
          if (field === 'title') return { ...reference, title: value };
          if (field === 'provider') return { ...reference, provider: value };
          return { ...reference, estimatedCost: value };
        }),
      })
    );
  };

  const handleAddReference = (): void => {
    onChange(
      next({
        references: [
          ...effectiveReferences,
          { id: makeLocalId('ref'), kind: 'activity', title: '' },
        ],
      })
    );
  };

  const handleRemoveReference = (index: number): void => {
    onChange(
      next({
        references: effectiveReferences.filter((_, ri) => ri !== index),
      })
    );
  };

  /**
   * Reverts one STEP 16 section to its persisted value by dropping the section
   * key from the draft (the effective fallback is the persisted snapshot).
   */
  const handleCancelSection = (section: EditingSectionName): void => {
    if (existing !== null) {
      const key = SECTION_KEYS[section];
      const { [key]: _dropped, ...rest } = existing;
      void _dropped;
      onChange({ ...rest });
    }
    setEditing((prev) => ({ ...prev, [section]: false }));
  };

  const handleTransportPlanField = (
    index: number,
    field: TransportPlanField,
    value: string
  ): void => {
    onChange(
      next({
        transportPlans: effectiveTransportPlans.map((plan, i) =>
          i === index ? setTransportPlanValue(plan, field, value) : plan
        ),
      })
    );
  };

  /**
   * STEP 23: explicit user-triggered reclassification of a simulated-discovery
   * plan to a manual reference. Ordinary field edits never change a provenance
   * kind — only this action does, and it also drops the imported source note.
   */
  const handleMarkTransportPlanManual = (index: number): void => {
    onChange(
      next({
        transportPlans: effectiveTransportPlans.map((plan, i) =>
          i === index ? { ...plan, provenance: { kind: 'manual' } } : plan
        ),
      })
    );
  };

  const handleAddTransportPlan = (): void => {
    onChange(
      next({
        transportPlans: [
          ...effectiveTransportPlans,
          { id: makeLocalId('trp'), provenance: { kind: 'manual' } },
        ],
      })
    );
  };

  const handleRemoveTransportPlan = (index: number): void => {
    onChange(
      next({
        transportPlans: effectiveTransportPlans.filter((_, i) => i !== index),
      })
    );
  };

  /**
   * STEP 24: explicit user-triggered lifecycle change for one transport plan.
   * Only the plan's `lifecycleState` is written in the draft — never readiness,
   * provenance, checklist tasks, or booking/verification state, and never any
   * other plan. Marking a plan replaced or archived never deletes it.
   *
   * STEP 28: when the changed plan is the currently stored primary and the
   * action restores it to active, the resolution feedback is recorded as
   * `restored-selected`; when the action moves the currently valid primary
   * away from Active, any staged resolution feedback is cleared (the conflict
   * is visible again). No primary id is ever written or changed here.
   */
  const handleSetTransportPlanLifecycle = (index: number, state: TripPlanLifecycleState): void => {
    const targetPlan = effectiveTransportPlans[index];
    const isRestoreOfSelected =
      state === 'active' &&
      targetPlan.id === effectivePrimaryTransportPlanId &&
      transportPriorStatus === 'inactive';
    const isConflictCreating =
      state !== 'active' &&
      targetPlan.id === effectivePrimaryTransportPlanId &&
      transportPriorStatus === 'valid';
    if (isRestoreOfSelected) {
      setExplicitResolution((prev) => ({ ...prev, transport: 'restored-selected' }));
    } else if (isConflictCreating) {
      setExplicitResolution((prev) => ({ ...prev, transport: null }));
    }
    onChange(
      next({
        transportPlans: effectiveTransportPlans.map((plan, i) =>
          i === index ? { ...plan, lifecycleState: state } : plan
        ),
      })
    );
  };

  const handleAccommodationPlanField = (
    index: number,
    field: AccommodationPlanField,
    value: string
  ): void => {
    onChange(
      next({
        accommodationPlans: effectiveAccommodationPlans.map((plan, i) =>
          i === index ? setAccommodationPlanValue(plan, field, value) : plan
        ),
      })
    );
  };

  /**
   * STEP 23: explicit user-triggered reclassification of a simulated-discovery
   * plan to a manual reference. Ordinary field edits never change a provenance
   * kind — only this action does, and it also drops the imported source note.
   */
  const handleMarkAccommodationPlanManual = (index: number): void => {
    onChange(
      next({
        accommodationPlans: effectiveAccommodationPlans.map((plan, i) =>
          i === index ? { ...plan, provenance: { kind: 'manual' } } : plan
        ),
      })
    );
  };

  const handleAddAccommodationPlan = (): void => {
    onChange(
      next({
        accommodationPlans: [
          ...effectiveAccommodationPlans,
          { id: makeLocalId('acp'), provenance: { kind: 'manual' } },
        ],
      })
    );
  };

  const handleRemoveAccommodationPlan = (index: number): void => {
    onChange(
      next({
        accommodationPlans: effectiveAccommodationPlans.filter((_, i) => i !== index),
      })
    );
  };

  /**
   * STEP 24: explicit user-triggered lifecycle change for one accommodation
   * plan. Only the plan's `lifecycleState` is written in the draft — never
   * readiness, provenance, checklist tasks, or booking/verification state, and
   * never any other plan. Marking a plan replaced or archived never deletes it.
   *
   * STEP 28: the resolution-feedback pairing is identical to the transport
   * handler: restoring the stored selected plan to active records the explicit
   * `restored-selected` decision; moving the valid primary away from Active
   * clears any staged resolution feedback. No primary id is ever written here.
   */
  const handleSetAccommodationPlanLifecycle = (
    index: number,
    state: TripPlanLifecycleState
  ): void => {
    const targetPlan = effectiveAccommodationPlans[index];
    const isRestoreOfSelected =
      state === 'active' &&
      targetPlan.id === effectivePrimaryAccommodationPlanId &&
      accommodationPriorStatus === 'inactive';
    const isConflictCreating =
      state !== 'active' &&
      targetPlan.id === effectivePrimaryAccommodationPlanId &&
      accommodationPriorStatus === 'valid';
    if (isRestoreOfSelected) {
      setExplicitResolution((prev) => ({ ...prev, accommodation: 'restored-selected' }));
    } else if (isConflictCreating) {
      setExplicitResolution((prev) => ({ ...prev, accommodation: null }));
    }
    onChange(
      next({
        accommodationPlans: effectiveAccommodationPlans.map((plan, i) =>
          i === index ? { ...plan, lifecycleState: state } : plan
        ),
      })
    );
  };

  /**
   * STEP 26: explicit user choice of which active transport plan is primary.
   * `null` clears the selection (`primaryTransportPlanId: null` in the draft).
   * Only eligible active plans are ever offered by the control, so the staged
   * id always names an effective-active plan; this handler never auto-selects.
   *
   * STEP 28: the staged change is classified via the resolution vocabulary and
   * the explicit decision (`selected-another` / `cleared`) drives the transient
   * feedback. A no-op or invalid action never claims a resolution.
   */
  const handleSetPrimaryTransportPlan = (id: string | null): void => {
    const action: PrimaryResolutionAction =
      id === null ? { type: 'clear' } : { type: 'select', selectedId: id };
    const outcome = classifyPrimaryResolutionDecision({
      priorStatus: transportPriorStatus,
      priorSelectedId: effectivePrimaryTransportPlanId ?? null,
      action,
      plans: effectiveTransportPlans,
    });
    setExplicitResolution((prev) => ({
      ...prev,
      transport:
        outcome.resolved &&
        (outcome.decision === 'selected-another' || outcome.decision === 'cleared')
          ? outcome.decision
          : null,
    }));
    onChange(next({ primaryTransportPlanId: id }));
  };

  /**
   * STEP 26: explicit user choice of which active accommodation plan is
   * primary. `null` clears the selection; only eligible active plans are ever
   * offered; never auto-selects.
   *
   * STEP 28: the staged change is classified exactly as for transport.
   */
  const handleSetPrimaryAccommodationPlan = (id: string | null): void => {
    const action: PrimaryResolutionAction =
      id === null ? { type: 'clear' } : { type: 'select', selectedId: id };
    const outcome = classifyPrimaryResolutionDecision({
      priorStatus: accommodationPriorStatus,
      priorSelectedId: effectivePrimaryAccommodationPlanId ?? null,
      action,
      plans: effectiveAccommodationPlans,
    });
    setExplicitResolution((prev) => ({
      ...prev,
      accommodation:
        outcome.resolved &&
        (outcome.decision === 'selected-another' || outcome.decision === 'cleared')
          ? outcome.decision
          : null,
    }));
    onChange(next({ primaryAccommodationPlanId: id }));
  };

  const handleBudgetField = (field: BudgetField, value: string): void => {
    onChange(next({ budgetPlan: setBudgetPlanValue(effectiveBudgetPlan, field, value) }));
  };

  const handleClearBudgetPlan = (): void => {
    onChange(next({ budgetPlan: null }));
  };

  const handleTaskField = (index: number, field: TaskField, value: string): void => {
    onChange(
      next({
        tasks: effectiveTasks.map((task, ti) =>
          ti === index ? setTaskValue(task, field, value) : task
        ),
      })
    );
  };

  const handleAddTask = (): void => {
    onChange(
      next({
        tasks: [
          ...effectiveTasks,
          { id: makeLocalId('tsk'), category: 'general', title: '', status: 'pending' },
        ],
      })
    );
  };

  const handleRemoveTask = (index: number): void => {
    onChange(next({ tasks: effectiveTasks.filter((_, ti) => ti !== index) }));
  };

  return (
    <div
      style={{
        padding: '1.25rem 1.5rem',
        borderRadius: '20px',
        background: 'rgba(15,23,42,0.75)',
        border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <p
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#00f2fe',
            margin: 0,
          }}
        >
          Structured planning
        </p>
        {dirty && (
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#fbbf24',
              background: 'rgba(251,191,36,0.12)',
              padding: '0.25rem 0.7rem',
              borderRadius: '9999px',
            }}
          >
            Unsaved changes
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <p style={SECTION_TITLE_STYLE}>Trip dates</p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="plan-start" style={LABEL_STYLE}>
              Start
            </label>
            <input
              id="plan-start"
              type="date"
              value={effectiveDates?.startDate ?? ''}
              onChange={(event) => handleDateRangeChange({ startDate: event.target.value })}
              disabled={inputsDisabled}
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="plan-end" style={LABEL_STYLE}>
              End
            </label>
            <input
              id="plan-end"
              type="date"
              value={effectiveDates?.endDate ?? ''}
              onChange={(event) => handleDateRangeChange({ endDate: event.target.value })}
              disabled={inputsDisabled}
              style={INPUT_STYLE}
            />
          </div>
          {effectiveDates !== null && trip.dateRange !== undefined && (
            <button
              type="button"
              onClick={handleClearDates}
              disabled={inputsDisabled}
              className="btn-secondary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 800 }}
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      <DestinationsEditor
        destinations={effectiveDestinations}
        inputsDisabled={inputsDisabled}
        atLimit={atDestinationLimit}
        onFieldChange={handleDestinationField}
        onAdd={handleAddDestination}
        onRemove={handleRemoveDestination}
      />

      {trip.itinerary ? (
        <>
          <DayPlansEditor
            days={effectiveDays}
            inputsDisabled={inputsDisabled}
            onDayFieldChange={handleDayField}
            onAddDay={handleAddDay}
            onRemoveDay={handleRemoveDay}
            onActivityFieldChange={handleActivityField}
            onAddActivity={handleAddActivity}
            onRemoveActivity={handleRemoveActivity}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="plan-notes" style={SECTION_TITLE_STYLE}>
              Planning notes
            </label>
            <textarea
              id="plan-notes"
              rows={4}
              value={effectiveNotes.join('\n')}
              onChange={(event) => handleNotesChange(event.target.value)}
              disabled={inputsDisabled}
              style={{
                ...INPUT_STYLE,
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </div>

          <ReferencesEditor
            references={effectiveReferences}
            inputsDisabled={inputsDisabled}
            onFieldChange={handleReferenceField}
            onAdd={handleAddReference}
            onRemove={handleRemoveReference}
          />

          {/* STEP 32: focus-recovery scope — the first enabled section-action
              button inside this wrapper is where focus lands after a successful
              save removes the review panel. */}
          <div ref={planningSectionsRef}>
            <ExplicitSectionFrame
              title="Transport plans"
              caption="Your own planned legs — planning data, never a booking."
              editing={transportEditing}
              canToggle={sectionsEditable}
              onEdit={() => setEditing((prev) => ({ ...prev, transport: true }))}
              onCancel={() => handleCancelSection('transport')}
            >
              <TransportPlansEditor
                transportPlans={effectiveTransportPlans}
                primaryPlanId={effectivePrimaryTransportPlanId}
                inputsDisabled={transportInputsDisabled}
                onFieldChange={handleTransportPlanField}
                onMarkManual={handleMarkTransportPlanManual}
                onLifecycleChange={handleSetTransportPlanLifecycle}
                onPrimaryChange={handleSetPrimaryTransportPlan}
                onAdd={handleAddTransportPlan}
                onRemove={handleRemoveTransportPlan}
              />
              {transportChangeMessage !== null && (
                <p aria-label="Transport planning changes" style={CHANGE_CONTEXT_STYLE}>
                  {transportChangeMessage}
                </p>
              )}
              {transportResolutionFeedback !== null && (
                <p
                  role="status"
                  aria-label="Transport primary resolution feedback"
                  style={{
                    ...RESOLUTION_FEEDBACK_STYLE,
                    color: transportExplicitDecision !== null ? '#86efac' : '#fbbf24',
                  }}
                >
                  {transportResolutionFeedback}
                </p>
              )}
            </ExplicitSectionFrame>

            <ExplicitSectionFrame
              title="Accommodation plans"
              caption="Your own planned stays — planning data, never a booking."
              editing={accommodationEditing}
              canToggle={sectionsEditable}
              onEdit={() => setEditing((prev) => ({ ...prev, accommodation: true }))}
              onCancel={() => handleCancelSection('accommodation')}
            >
              <AccommodationPlansEditor
                accommodationPlans={effectiveAccommodationPlans}
                primaryPlanId={effectivePrimaryAccommodationPlanId}
                inputsDisabled={accommodationInputsDisabled}
                onFieldChange={handleAccommodationPlanField}
                onMarkManual={handleMarkAccommodationPlanManual}
                onLifecycleChange={handleSetAccommodationPlanLifecycle}
                onPrimaryChange={handleSetPrimaryAccommodationPlan}
                onAdd={handleAddAccommodationPlan}
                onRemove={handleRemoveAccommodationPlan}
              />
              {accommodationChangeMessage !== null && (
                <p aria-label="Accommodation planning changes" style={CHANGE_CONTEXT_STYLE}>
                  {accommodationChangeMessage}
                </p>
              )}
              {accommodationResolutionFeedback !== null && (
                <p
                  role="status"
                  aria-label="Accommodation primary resolution feedback"
                  style={{
                    ...RESOLUTION_FEEDBACK_STYLE,
                    color: accommodationExplicitDecision !== null ? '#86efac' : '#fbbf24',
                  }}
                >
                  {accommodationResolutionFeedback}
                </p>
              )}
            </ExplicitSectionFrame>

            <ExplicitSectionFrame
              title="Budget plan"
              caption="Explicit numbers you track — never a formatted currency string."
              editing={budgetEditing}
              canToggle={sectionsEditable}
              onEdit={() => setEditing((prev) => ({ ...prev, budget: true }))}
              onCancel={() => handleCancelSection('budget')}
            >
              <BudgetPlanEditor
                budgetPlan={effectiveBudgetPlan}
                inputsDisabled={budgetInputsDisabled}
                onFieldChange={handleBudgetField}
                onClear={handleClearBudgetPlan}
              />
            </ExplicitSectionFrame>

            <ExplicitSectionFrame
              title="Checklist"
              caption="Your own preparation tasks — full control, never autopilot."
              editing={tasksEditing}
              canToggle={sectionsEditable}
              onEdit={() => setEditing((prev) => ({ ...prev, tasks: true }))}
              onCancel={() => handleCancelSection('tasks')}
            >
              <ChecklistEditor
                tasks={effectiveTasks}
                inputsDisabled={tasksInputsDisabled}
                onFieldChange={handleTaskField}
                onAdd={handleAddTask}
                onRemove={handleRemoveTask}
              />
            </ExplicitSectionFrame>
          </div>
        </>
      ) : (
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
          Add an itinerary to edit the daily plan, planning notes, external references, transport
          plans, accommodation plans, budget plan, and the preparation checklist. Trip dates and
          destinations are always editable.
        </p>
      )}

      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingTop: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <p
            style={{
              fontSize: '0.78rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#22d3ee',
              margin: 0,
            }}
          >
            AI planning suggestion
          </p>
          {aiState.status === 'ready' && !aiState.applied && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                color: '#22d3ee',
                background: 'rgba(34,211,238,0.12)',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
              }}
            >
              Review before saving
            </span>
          )}
          {aiState.status === 'ready' && aiState.applied && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                color: '#4ade80',
                background: 'rgba(74,222,128,0.12)',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
              }}
            >
              Applied — review before saving
            </span>
          )}
        </div>

        {aiAvailable ? (
          <>
            {aiState.status === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <textarea
                  aria-label="AI planning instruction"
                  rows={2}
                  maxLength={1000}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  disabled={inputsDisabled}
                  placeholder="e.g. Move the beach day to day 2 and add a sunset cruise on day 4."
                  style={{
                    ...INPUT_STYLE,
                    lineHeight: 1.5,
                    resize: 'vertical',
                  }}
                />
                <button
                  type="button"
                  onClick={() => onGenerateSuggestion(instruction.trim())}
                  disabled={!canGenerate}
                  className="btn-secondary"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '0.5rem 1rem',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <Sparkles className="w-4 h-4" />
                  Generate suggestion
                </button>
              </div>
            )}

            {aiState.status === 'generating' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span
                  className="spinner-border"
                  style={{
                    width: '1rem',
                    height: '1rem',
                    border: '2px solid rgba(34,211,238,0.25)',
                    borderTopColor: '#22d3ee',
                    borderRadius: '50%',
                    animation: 'spin 700ms linear infinite',
                  }}
                />
                <span style={{ fontSize: '0.85rem', color: '#7dd3fc' }}>
                  Generating a suggestion…
                </span>
              </div>
            )}

            {aiState.status === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <span role="alert" style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                  {aiState.message}
                </span>
                <button
                  type="button"
                  onClick={onDiscardSuggestion}
                  className="btn-secondary"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '0.4rem 0.9rem',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {aiState.status === 'ready' && (
              <AiProposalPreview
                proposal={aiState.proposal}
                current={aiCurrent}
                applied={aiState.applied}
                applyDisabled={inputsDisabled}
                onApply={() => onApplySuggestion(aiState.proposal)}
                onDiscard={onDiscardSuggestion}
              />
            )}
          </>
        ) : (
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
            Attach an itinerary to use AI planning suggestions.
          </p>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingTop: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          ref={saveButtonRef}
          type="button"
          onClick={handleSaveClick}
          disabled={!canSave || saveReviewOpen}
          className="btn-primary"
          style={{
            padding: '0.55rem 1.2rem',
            fontSize: '0.85rem',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <Save className="w-4 h-4" />
          {saveState.status === 'saving' ? 'Saving…' : 'Save planning'}
        </button>
        {problem && (
          <span role="alert" style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
            {problem}
          </span>
        )}
        {saveState.status === 'error' && (
          <span role="alert" style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
            Could not save your planning changes. Please try again. Your edits are still here.
          </span>
        )}
        {saveReviewOpen && saveReview.items.length > 0 && (
          <div
            ref={saveReviewPanelRef}
            role="group"
            aria-labelledby={SAVE_REVIEW_HEADING_ID}
            style={{
              flexBasis: '100%',
              border: '1px solid rgba(167, 139, 250, 0.4)',
              borderRadius: '14px',
              padding: '0.85rem 1rem',
              background: 'rgba(139, 92, 246, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
            }}
          >
            <h3
              ref={saveReviewHeadingRef}
              id={SAVE_REVIEW_HEADING_ID}
              tabIndex={-1}
              style={{
                margin: 0,
                fontSize: '0.78rem',
                fontWeight: 800,
                color: '#d8b4fe',
                outline: 'none',
              }}
            >
              Review changes before saving
            </h3>
            <p style={{ margin: 0, fontSize: '0.76rem', color: '#cbd5e1', lineHeight: 1.4 }}>
              You are in control. Nothing is saved until you confirm, and you can keep editing if
              anything looks wrong.
            </p>
            {[
              { key: 'transport', section: saveReview.transport },
              { key: 'accommodation', section: saveReview.accommodation },
            ]
              .filter((group) => group.section.items.length > 0)
              .map((group) => (
                <div
                  key={group.key}
                  role="group"
                  aria-label={`${getPlanningReferenceSaveReviewSectionLabel(
                    group.section.section
                  )} changes`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.3rem',
                    minWidth: 0,
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#c4b5fd',
                    }}
                  >
                    {getPlanningReferenceSaveReviewSectionLabel(group.section.section)}
                  </h4>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '1.15rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem',
                      minWidth: 0,
                    }}
                  >
                    {group.section.items.map((item, index) => (
                      <li
                        key={`${item.section}-${item.kind}-${index}`}
                        style={{
                          fontSize: '0.8rem',
                          color: '#e2e8f0',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {item.attention && (
                          <span
                            style={{
                              display: 'inline-block',
                              marginRight: '0.35rem',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '999px',
                              border: '1px solid rgba(251, 191, 36, 0.4)',
                              background: 'rgba(251, 191, 36, 0.12)',
                              color: '#fbbf24',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            Needs attention
                          </span>
                        )}
                        {describePlanningReferenceSaveReviewItem(item)}
                        {getPlanningReferenceSaveReviewItemGuidance(item) !== null && (
                          <span
                            style={{
                              display: 'block',
                              marginTop: '0.15rem',
                              fontSize: '0.75rem',
                              color: '#cbd5e1',
                            }}
                          >
                            {getPlanningReferenceSaveReviewItemGuidance(item)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleConfirmSaveReview}
                disabled={!canSave || inputsDisabled}
                className="btn-primary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 800 }}
              >
                Save planning changes
              </button>
              <button
                type="button"
                onClick={handleKeepEditing}
                disabled={inputsDisabled}
                className="btn-secondary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 800 }}
              >
                Keep editing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface DestinationsEditorProps {
  destinations: TripDestination[];
  inputsDisabled: boolean;
  atLimit: boolean;
  onFieldChange: (id: string, field: 'name' | 'country', value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

const DestinationsEditor: React.FC<DestinationsEditorProps> = ({
  destinations,
  inputsDisabled,
  atLimit,
  onFieldChange,
  onAdd,
  onRemove,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    <p style={SECTION_TITLE_STYLE}>Destinations</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      {destinations.map((destination) => (
        <div
          key={destination.id}
          style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            aria-label={`Destination name ${destination.id}`}
            placeholder="City or region"
            value={destination.name}
            onChange={(event) => onFieldChange(destination.id, 'name', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '1 1 10rem', minWidth: '8rem' }}
          />
          <input
            aria-label={`Destination country ${destination.id}`}
            placeholder="Country"
            value={destination.country ?? ''}
            onChange={(event) => onFieldChange(destination.id, 'country', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '1 1 8rem', minWidth: '6rem' }}
          />
          <button
            type="button"
            onClick={() => onRemove(destination.id)}
            disabled={inputsDisabled}
            aria-label={`Remove destination ${destination.id}`}
            style={ICON_BUTTON_STYLE}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
    <button
      type="button"
      onClick={onAdd}
      disabled={inputsDisabled || atLimit}
      className="btn-secondary"
      style={{
        alignSelf: 'flex-start',
        padding: '0.5rem 1rem',
        fontSize: '0.8rem',
        fontWeight: 800,
      }}
    >
      <Plus className="w-4 h-4" />
      Add destination
    </button>
    {destinations.length > MAX_TRIP_DESTINATIONS ? (
      <p role="note" style={{ fontSize: '0.75rem', color: '#fca5a5' }}>
        This trip was created before the {MAX_TRIP_DESTINATIONS}-destination limit. Reduce it to{' '}
        {MAX_TRIP_DESTINATIONS} or fewer, then save.
      </p>
    ) : (
      atLimit && (
        <p role="note" style={{ fontSize: '0.75rem', color: 'rgba(226, 232, 240, 0.7)' }}>
          A trip can have at most {MAX_TRIP_DESTINATIONS} destinations.
        </p>
      )
    )}
  </div>
);

interface DayPlansEditorProps {
  days: DayPlan[];
  inputsDisabled: boolean;
  onDayFieldChange: (index: number, field: 'dayNumber' | 'title' | 'theme', value: string) => void;
  onAddDay: () => void;
  onRemoveDay: (index: number) => void;
  onActivityFieldChange: (
    dayIndex: number,
    activityIndex: number,
    field: ActivityField,
    value: string
  ) => void;
  onAddActivity: (dayIndex: number) => void;
  onRemoveActivity: (dayIndex: number, activityIndex: number) => void;
}

const DayPlansEditor: React.FC<DayPlansEditorProps> = ({
  days,
  inputsDisabled,
  onDayFieldChange,
  onAddDay,
  onRemoveDay,
  onActivityFieldChange,
  onAddActivity,
  onRemoveActivity,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
    <p style={SECTION_TITLE_STYLE}>Daily itinerary</p>
    {days.length === 0 && (
      <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>No days added yet.</p>
    )}
    {days.map((day, index) => (
      <div
        key={index}
        style={{
          padding: '0.7rem 0.9rem',
          borderRadius: '14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', width: '6rem' }}>
            <label style={LABEL_STYLE}>Day</label>
            <input
              aria-label={`Day ${index + 1} number`}
              type="number"
              min={1}
              value={day.dayNumber}
              onChange={(event) => onDayFieldChange(index, 'dayNumber', event.target.value)}
              disabled={inputsDisabled}
              style={INPUT_STYLE}
            />
          </div>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: '1 1 12rem' }}
          >
            <label style={LABEL_STYLE}>Title</label>
            <input
              aria-label={`Day ${index + 1} title`}
              value={day.title}
              onChange={(event) => onDayFieldChange(index, 'title', event.target.value)}
              disabled={inputsDisabled}
              style={INPUT_STYLE}
            />
          </div>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: '1 1 8rem' }}
          >
            <label style={LABEL_STYLE}>Theme</label>
            <input
              aria-label={`Day ${index + 1} theme`}
              value={day.theme}
              onChange={(event) => onDayFieldChange(index, 'theme', event.target.value)}
              disabled={inputsDisabled}
              style={INPUT_STYLE}
            />
          </div>
          <button
            type="button"
            onClick={() => onRemoveDay(index)}
            disabled={inputsDisabled}
            aria-label={`Remove day ${index + 1}`}
            style={ICON_BUTTON_STYLE}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {day.activities.map((activity, activityIndex) => (
            <div
              key={activityIndex}
              style={{
                display: 'flex',
                gap: '0.4rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '0.4rem 0.55rem',
                borderRadius: '10px',
                background: 'rgba(15,23,42,0.5)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <input
                aria-label={`Activity time ${index + 1}-${activityIndex + 1}`}
                placeholder="Time"
                value={activity.time}
                onChange={(event) =>
                  onActivityFieldChange(index, activityIndex, 'time', event.target.value)
                }
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 5rem' }}
              />
              <input
                aria-label={`Activity title ${index + 1}-${activityIndex + 1}`}
                placeholder="Activity"
                value={activity.title}
                onChange={(event) =>
                  onActivityFieldChange(index, activityIndex, 'title', event.target.value)
                }
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '2 1 10rem' }}
              />
              <input
                aria-label={`Activity location ${index + 1}-${activityIndex + 1}`}
                placeholder="Location"
                value={activity.locationName}
                onChange={(event) =>
                  onActivityFieldChange(index, activityIndex, 'locationName', event.target.value)
                }
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '1 1 8rem' }}
              />
              <input
                aria-label={`Activity category ${index + 1}-${activityIndex + 1}`}
                placeholder="Category"
                value={activity.category}
                onChange={(event) =>
                  onActivityFieldChange(index, activityIndex, 'category', event.target.value)
                }
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '1 1 7rem' }}
              />
              <input
                aria-label={`Activity cost ${index + 1}-${activityIndex + 1}`}
                placeholder="Cost"
                value={activity.estimatedCost}
                onChange={(event) =>
                  onActivityFieldChange(index, activityIndex, 'estimatedCost', event.target.value)
                }
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 6rem' }}
              />
              <button
                type="button"
                onClick={() => onRemoveActivity(index, activityIndex)}
                disabled={inputsDisabled}
                aria-label={`Remove activity ${index + 1}-${activityIndex + 1}`}
                style={ICON_BUTTON_STYLE}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onAddActivity(index)}
            disabled={inputsDisabled}
            className="btn-secondary"
            style={{
              alignSelf: 'flex-start',
              padding: '0.4rem 0.9rem',
              fontSize: '0.78rem',
              fontWeight: 800,
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add activity
          </button>
        </div>
      </div>
    ))}
    <button
      type="button"
      onClick={onAddDay}
      disabled={inputsDisabled}
      className="btn-secondary"
      style={{
        alignSelf: 'flex-start',
        padding: '0.5rem 1rem',
        fontSize: '0.8rem',
        fontWeight: 800,
      }}
    >
      <Plus className="w-4 h-4" />
      Add day
    </button>
  </div>
);

interface ReferencesEditorProps {
  references: TripPlanningReference[];
  inputsDisabled: boolean;
  onFieldChange: (index: number, field: ReferenceField, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

const REFERENCE_KINDS: ReadonlyArray<ReferenceKind> = ['activity', 'transport', 'accommodation'];

const ReferencesEditor: React.FC<ReferencesEditorProps> = ({
  references,
  inputsDisabled,
  onFieldChange,
  onAdd,
  onRemove,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    <p style={SECTION_TITLE_STYLE}>External references</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      {references.map((reference, index) => (
        <div
          key={`${reference.id}-${index}`}
          style={{
            display: 'flex',
            gap: '0.45rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '0.5rem 0.6rem',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <select
            aria-label={`Reference kind ${index + 1}`}
            value={reference.kind}
            onChange={(event) => onFieldChange(index, 'kind', event.target.value)}
            disabled={inputsDisabled}
            style={INPUT_STYLE}
          >
            {REFERENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            aria-label={`Reference title ${index + 1}`}
            placeholder="Title"
            value={reference.title}
            onChange={(event) => onFieldChange(index, 'title', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '1 1 9rem', minWidth: '7rem' }}
          />
          <input
            aria-label={`Reference url ${index + 1}`}
            placeholder="https://…"
            value={reference.url ?? ''}
            onChange={(event) => onFieldChange(index, 'url', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '1 1 12rem', minWidth: '9rem' }}
          />
          <input
            aria-label={`Reference day ${index + 1}`}
            placeholder="Day"
            type="number"
            min={1}
            value={reference.dayNumber ?? ''}
            onChange={(event) => onFieldChange(index, 'dayNumber', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '0 1 4rem' }}
          />
          <input
            aria-label={`Reference provider ${index + 1}`}
            placeholder="Provider"
            value={reference.provider ?? ''}
            onChange={(event) => onFieldChange(index, 'provider', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '1 1 7rem' }}
          />
          <input
            aria-label={`Reference cost ${index + 1}`}
            placeholder="Cost"
            value={reference.estimatedCost ?? ''}
            onChange={(event) => onFieldChange(index, 'estimatedCost', event.target.value)}
            disabled={inputsDisabled}
            style={{ ...INPUT_STYLE, flex: '0 1 6rem' }}
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={inputsDisabled}
            aria-label={`Remove reference ${index + 1}`}
            style={ICON_BUTTON_STYLE}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
    {references.length === 0 && (
      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>No external references yet.</p>
    )}
    <button
      type="button"
      onClick={onAdd}
      disabled={inputsDisabled}
      className="btn-secondary"
      style={{
        alignSelf: 'flex-start',
        padding: '0.5rem 1rem',
        fontSize: '0.8rem',
        fontWeight: 800,
      }}
    >
      <Plus className="w-4 h-4" />
      Add reference
    </button>
  </div>
);

const ICON_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.4rem',
  borderRadius: '10px',
  border: '1px solid rgba(239,68,68,0.35)',
  background: 'rgba(239,68,68,0.08)',
  color: '#fca5a5',
  cursor: 'pointer',
};

type EditingSectionName = 'transport' | 'accommodation' | 'budget' | 'tasks';
type EditingSections = Record<EditingSectionName, boolean>;

const SECTION_KEYS: Record<
  EditingSectionName,
  'transportPlans' | 'accommodationPlans' | 'budgetPlan' | 'tasks'
> = {
  transport: 'transportPlans',
  accommodation: 'accommodationPlans',
  budget: 'budgetPlan',
  tasks: 'tasks',
};

interface ExplicitSectionFrameProps {
  title: string;
  caption: string;
  editing: boolean;
  canToggle: boolean;
  onEdit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/**
 * Read-only-by-default frame for the STEP 16 sections. Each section exposes an
 * explicit Edit affordance (inputs start disabled) and, while editing, a Cancel
 * that reverts the section to its persisted value. Section content is passed
 * through; the frame never manages draft state itself.
 */
const ExplicitSectionFrame: React.FC<ExplicitSectionFrameProps> = ({
  title,
  caption,
  editing,
  canToggle,
  onEdit,
  onCancel,
  children,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <p style={SECTION_TITLE_STYLE}>{title}</p>
        <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: 0 }}>{caption}</p>
      </div>
      {editing ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={!canToggle}
          className="btn-secondary"
          style={{
            padding: '0.35rem 0.9rem',
            fontSize: '0.75rem',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          disabled={!canToggle}
          className="btn-secondary"
          style={{
            padding: '0.35rem 0.9rem',
            fontSize: '0.75rem',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      )}
    </div>
    {children}
  </div>
);

type TransportPlanField =
  | 'mode'
  | 'provider'
  | 'departureLocation'
  | 'arrivalLocation'
  | 'departureTime'
  | 'arrivalTime'
  | 'referenceNumber'
  | 'sourceUrl'
  | 'provenanceNote'
  | 'notes';

interface TransportPlansEditorProps {
  transportPlans: TripTransportPlan[];
  primaryPlanId?: string | null;
  inputsDisabled: boolean;
  onFieldChange: (index: number, field: TransportPlanField, value: string) => void;
  onMarkManual: (index: number) => void;
  onLifecycleChange: (index: number, state: TripPlanLifecycleState) => void;
  onPrimaryChange: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * STEP 16 transport section. Fields are trimmed on input and dropped when
 * empty (matching the domain boundary); times keep their raw ISO value and are
 * validated on save.
 *
 * STEP 23: each card shows a read-only provenance chip when provenance is
 * present, a bounded source-note input, and — for simulated-discovery plans
 * only — an explicit "Mark as manual" action. Legacy plans without provenance
 * show none of these controls, so viewing them never creates provenance.
 *
 * STEP 24: each card shows a read-only lifecycle chip (an absent lifecycle
 * renders as "Active" without being persisted) and, while the section is being
 * edited, the explicit lifecycle actions. Archived plans stay visible in a
 * subdued card.
 *
 * STEP 26: a "Primary" selection control above the cards lets the owner mark
 * one effective-active plan as the primary reference, or clear the selection.
 * Inactive plans are never offered and nothing is ever auto-selected.
 */
const TransportPlansEditor: React.FC<TransportPlansEditorProps> = ({
  transportPlans,
  primaryPlanId,
  inputsDisabled,
  onFieldChange,
  onMarkManual,
  onLifecycleChange,
  onPrimaryChange,
  onAdd,
  onRemove,
}) => {
  const { resolution } = partitionPlanningReferencesWithPrimary(
    transportPlans,
    primaryPlanId ?? undefined
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {transportPlans.length > 0 && (
        <PrimarySelectionControl
          plans={transportPlans}
          primaryId={primaryPlanId}
          planType="Transport"
          inputsDisabled={inputsDisabled}
          onSelect={onPrimaryChange}
          getLabel={getTransportPlanSelectionLabel}
        />
      )}
      {transportPlans.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
          No transport plans added yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {transportPlans.map((plan, index) => {
            const isSelectedPrimary =
              plan.id === resolution.selectedId && resolution.state === 'valid-explicit-selection';
            const isSelectedInactivePrimary =
              plan.id === resolution.selectedId && resolution.state === 'selected-plan-inactive';
            const transitionHint = isSelectedPrimary
              ? doesLifecycleTransitionCreatePrimaryConflict(resolution, plan.id, 'archived')
                ? {
                    tone: 'warning' as const,
                    message:
                      'Moving the primary reference away from Active leaves the primary assignment unresolved.',
                  }
                : null
              : isSelectedInactivePrimary &&
                  doesLifecycleTransitionResolvePrimaryConflict(resolution, plan.id, 'active')
                ? {
                    tone: 'restore' as const,
                    message: 'Restoring this plan to Active resolves the primary assignment.',
                  }
                : null;
            return (
              <div
                key={plan.id}
                style={
                  isArchivedReference(getEffectiveTripPlanLifecycleState(plan.lifecycleState))
                    ? ARCHIVED_PLAN_CARD_STYLE
                    : PLAN_CARD_STYLE
                }
              >
                <div
                  style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={`Transport mode ${index + 1}`}
                    placeholder="Mode"
                    value={plan.mode ?? ''}
                    onChange={(event) => onFieldChange(index, 'mode', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '0 1 6rem' }}
                  />
                  <input
                    aria-label={`Transport provider ${index + 1}`}
                    placeholder="Provider"
                    value={plan.provider ?? ''}
                    onChange={(event) => onFieldChange(index, 'provider', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 8rem' }}
                  />
                  <input
                    aria-label={`Transport from ${index + 1}`}
                    placeholder="From"
                    value={plan.departureLocation ?? ''}
                    onChange={(event) =>
                      onFieldChange(index, 'departureLocation', event.target.value)
                    }
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 8rem' }}
                  />
                  <input
                    aria-label={`Transport departure time ${index + 1}`}
                    type="datetime-local"
                    value={plan.departureTime ?? ''}
                    onChange={(event) => onFieldChange(index, 'departureTime', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '0 1 10rem' }}
                  />
                  <input
                    aria-label={`Transport arrival location ${index + 1}`}
                    placeholder="To"
                    value={plan.arrivalLocation ?? ''}
                    onChange={(event) =>
                      onFieldChange(index, 'arrivalLocation', event.target.value)
                    }
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 8rem' }}
                  />
                  <input
                    aria-label={`Transport arrival time ${index + 1}`}
                    type="datetime-local"
                    value={plan.arrivalTime ?? ''}
                    onChange={(event) => onFieldChange(index, 'arrivalTime', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '0 1 10rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    disabled={inputsDisabled}
                    aria-label={`Remove transport plan ${index + 1}`}
                    style={ICON_BUTTON_STYLE}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <span
                    aria-label={`Transport readiness ${index + 1}`}
                    title="Planning-data status: a reference label is never proof of a booking."
                    style={READINESS_LABEL_STYLE}
                  >
                    {getTripExecutionReadinessLabel(plan.readiness?.state ?? 'planned')}
                  </span>
                  {plan.provenance !== undefined && (
                    <span
                      aria-label={`Transport provenance ${index + 1}`}
                      title={
                        getTripPlanProvenanceDescription(plan.provenance.kind) ??
                        'Where this planning reference came from — a label, never a booking.'
                      }
                      style={
                        isSimulatedProvenance(plan.provenance.kind)
                          ? SIMULATED_PROVENANCE_LABEL_STYLE
                          : PROVENANCE_LABEL_STYLE
                      }
                    >
                      {getTripPlanProvenanceLabel(plan.provenance.kind)}
                    </span>
                  )}
                  {plan.provenance?.kind === 'mock-discovery' && (
                    <button
                      type="button"
                      onClick={() => onMarkManual(index)}
                      disabled={inputsDisabled}
                      aria-label={`Mark transport plan ${index + 1} as manually entered`}
                      className="btn-secondary"
                      style={{
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        flex: '0 0 auto',
                      }}
                    >
                      Mark as manual
                    </button>
                  )}
                  <span
                    aria-label={`Transport lifecycle ${index + 1}`}
                    title={getTripPlanLifecycleDescription(
                      getEffectiveTripPlanLifecycleState(plan.lifecycleState)
                    )}
                    style={
                      isArchivedReference(getEffectiveTripPlanLifecycleState(plan.lifecycleState))
                        ? ARCHIVED_LIFECYCLE_LABEL_STYLE
                        : LIFECYCLE_LABEL_STYLE
                    }
                  >
                    {getTripPlanLifecycleLabel(
                      getEffectiveTripPlanLifecycleState(plan.lifecycleState)
                    )}
                  </span>
                  {isSelectedPrimary && (
                    <span
                      aria-label={`Transport primary reference ${index + 1}`}
                      title="This plan is the primary planning reference."
                      style={PRIMARY_SELECTED_CHIP_STYLE}
                    >
                      Primary reference
                    </span>
                  )}
                  {isSelectedInactivePrimary && (
                    <span
                      aria-label={`Transport primary attention ${index + 1}`}
                      title={getPrimaryAssignmentConflictDetail(resolution) ?? undefined}
                      style={PRIMARY_ATTENTION_CHIP_STYLE}
                    >
                      Primary assignment needs attention
                    </span>
                  )}
                </div>
                {!inputsDisabled && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <PlanLifecycleControls
                      index={index}
                      planType="Transport"
                      lifecycleState={getEffectiveTripPlanLifecycleState(plan.lifecycleState)}
                      inputsDisabled={inputsDisabled}
                      onLifecycleChange={onLifecycleChange}
                      transitionHint={transitionHint}
                    />
                  </div>
                )}
                <div
                  style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={`Transport reference ${index + 1}`}
                    placeholder="Reservation / ticket ref"
                    value={plan.referenceNumber ?? ''}
                    onChange={(event) =>
                      onFieldChange(index, 'referenceNumber', event.target.value)
                    }
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 12rem' }}
                  />
                  <input
                    aria-label={`Transport source URL ${index + 1}`}
                    placeholder="Source URL"
                    value={plan.sourceUrl ?? ''}
                    onChange={(event) => onFieldChange(index, 'sourceUrl', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                  />
                  {plan.provenance !== undefined && (
                    <input
                      aria-label={`Transport source note ${index + 1}`}
                      placeholder="Source note"
                      value={plan.provenance.note ?? ''}
                      onChange={(event) =>
                        onFieldChange(index, 'provenanceNote', event.target.value)
                      }
                      disabled={inputsDisabled}
                      style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                    />
                  )}
                  <input
                    aria-label={`Transport notes ${index + 1}`}
                    placeholder="Notes"
                    value={plan.notes ?? ''}
                    onChange={(event) => onFieldChange(index, 'notes', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '2 1 14rem' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        disabled={inputsDisabled}
        className="btn-secondary"
        style={{
          alignSelf: 'flex-start',
          padding: '0.5rem 1rem',
          fontSize: '0.8rem',
          fontWeight: 800,
        }}
      >
        <Plus className="w-4 h-4" />
        Add transport plan
      </button>
    </div>
  );
};

type AccommodationPlanField =
  | 'name'
  | 'location'
  | 'checkInDate'
  | 'checkOutDate'
  | 'roomDetails'
  | 'referenceNumber'
  | 'sourceUrl'
  | 'provenanceNote'
  | 'notes';

interface AccommodationPlansEditorProps {
  accommodationPlans: TripAccommodationPlan[];
  primaryPlanId?: string | null;
  inputsDisabled: boolean;
  onFieldChange: (index: number, field: AccommodationPlanField, value: string) => void;
  onMarkManual: (index: number) => void;
  onLifecycleChange: (index: number, state: TripPlanLifecycleState) => void;
  onPrimaryChange: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * STEP 16 accommodation section. Fields are trimmed on input and dropped when
 * empty; dates keep their raw ISO value and date ordering is validated on save.
 *
 * STEP 23: each card shows a read-only provenance chip when provenance is
 * present, a bounded source-note input, and — for simulated-discovery plans
 * only — an explicit "Mark as manual" action. Legacy plans without provenance
 * show none of these controls, so viewing them never creates provenance.
 *
 * STEP 24: each card shows a read-only lifecycle chip (an absent lifecycle
 * renders as "Active" without being persisted) and, while the section is being
 * edited, the explicit lifecycle actions. Archived plans stay visible in a
 * subdued card.
 *
 * STEP 26: a "Primary" selection control above the cards lets the owner mark
 * one effective-active plan as the primary reference, or clear the selection.
 * Inactive plans are never offered and nothing is ever auto-selected.
 */
const AccommodationPlansEditor: React.FC<AccommodationPlansEditorProps> = ({
  accommodationPlans,
  primaryPlanId,
  inputsDisabled,
  onFieldChange,
  onMarkManual,
  onLifecycleChange,
  onPrimaryChange,
  onAdd,
  onRemove,
}) => {
  const { resolution } = partitionPlanningReferencesWithPrimary(
    accommodationPlans,
    primaryPlanId ?? undefined
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {accommodationPlans.length > 0 && (
        <PrimarySelectionControl
          plans={accommodationPlans}
          primaryId={primaryPlanId}
          planType="Accommodation"
          inputsDisabled={inputsDisabled}
          onSelect={onPrimaryChange}
          getLabel={getAccommodationPlanSelectionLabel}
        />
      )}
      {accommodationPlans.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
          No accommodation plans added yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {accommodationPlans.map((plan, index) => {
            const isSelectedPrimary =
              plan.id === resolution.selectedId && resolution.state === 'valid-explicit-selection';
            const isSelectedInactivePrimary =
              plan.id === resolution.selectedId && resolution.state === 'selected-plan-inactive';
            const transitionHint = isSelectedPrimary
              ? doesLifecycleTransitionCreatePrimaryConflict(resolution, plan.id, 'archived')
                ? {
                    tone: 'warning' as const,
                    message:
                      'Moving the primary reference away from Active leaves the primary assignment unresolved.',
                  }
                : null
              : isSelectedInactivePrimary &&
                  doesLifecycleTransitionResolvePrimaryConflict(resolution, plan.id, 'active')
                ? {
                    tone: 'restore' as const,
                    message: 'Restoring this plan to Active resolves the primary assignment.',
                  }
                : null;
            return (
              <div
                key={plan.id}
                style={
                  isArchivedReference(getEffectiveTripPlanLifecycleState(plan.lifecycleState))
                    ? ARCHIVED_PLAN_CARD_STYLE
                    : PLAN_CARD_STYLE
                }
              >
                <div
                  style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={`Accommodation name ${index + 1}`}
                    placeholder="Property"
                    value={plan.name ?? ''}
                    onChange={(event) => onFieldChange(index, 'name', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                  />
                  <input
                    aria-label={`Accommodation location ${index + 1}`}
                    placeholder="Location"
                    value={plan.location ?? ''}
                    onChange={(event) => onFieldChange(index, 'location', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 9rem' }}
                  />
                  <input
                    aria-label={`Accommodation check-in ${index + 1}`}
                    type="date"
                    value={plan.checkInDate ?? ''}
                    onChange={(event) => onFieldChange(index, 'checkInDate', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '0 1 9rem' }}
                  />
                  <input
                    aria-label={`Accommodation check-out ${index + 1}`}
                    type="date"
                    value={plan.checkOutDate ?? ''}
                    onChange={(event) => onFieldChange(index, 'checkOutDate', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '0 1 9rem' }}
                  />
                  <input
                    aria-label={`Accommodation room details ${index + 1}`}
                    placeholder="Room details"
                    value={plan.roomDetails ?? ''}
                    onChange={(event) => onFieldChange(index, 'roomDetails', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    disabled={inputsDisabled}
                    aria-label={`Remove accommodation plan ${index + 1}`}
                    style={ICON_BUTTON_STYLE}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <span
                    aria-label={`Accommodation readiness ${index + 1}`}
                    title="Planning-data status: a reference label is never proof of a booking."
                    style={READINESS_LABEL_STYLE}
                  >
                    {getTripExecutionReadinessLabel(plan.readiness?.state ?? 'planned')}
                  </span>
                  {plan.provenance !== undefined && (
                    <span
                      aria-label={`Accommodation provenance ${index + 1}`}
                      title={
                        getTripPlanProvenanceDescription(plan.provenance.kind) ??
                        'Where this planning reference came from — a label, never a booking.'
                      }
                      style={
                        isSimulatedProvenance(plan.provenance.kind)
                          ? SIMULATED_PROVENANCE_LABEL_STYLE
                          : PROVENANCE_LABEL_STYLE
                      }
                    >
                      {getTripPlanProvenanceLabel(plan.provenance.kind)}
                    </span>
                  )}
                  {plan.provenance?.kind === 'mock-discovery' && (
                    <button
                      type="button"
                      onClick={() => onMarkManual(index)}
                      disabled={inputsDisabled}
                      aria-label={`Mark accommodation plan ${index + 1} as manually entered`}
                      className="btn-secondary"
                      style={{
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        flex: '0 0 auto',
                      }}
                    >
                      Mark as manual
                    </button>
                  )}
                  <span
                    aria-label={`Accommodation lifecycle ${index + 1}`}
                    title={getTripPlanLifecycleDescription(
                      getEffectiveTripPlanLifecycleState(plan.lifecycleState)
                    )}
                    style={
                      isArchivedReference(getEffectiveTripPlanLifecycleState(plan.lifecycleState))
                        ? ARCHIVED_LIFECYCLE_LABEL_STYLE
                        : LIFECYCLE_LABEL_STYLE
                    }
                  >
                    {getTripPlanLifecycleLabel(
                      getEffectiveTripPlanLifecycleState(plan.lifecycleState)
                    )}
                  </span>
                  {isSelectedPrimary && (
                    <span
                      aria-label={`Accommodation primary reference ${index + 1}`}
                      title="This plan is the primary planning reference."
                      style={PRIMARY_SELECTED_CHIP_STYLE}
                    >
                      Primary reference
                    </span>
                  )}
                  {isSelectedInactivePrimary && (
                    <span
                      aria-label={`Accommodation primary attention ${index + 1}`}
                      title={getPrimaryAssignmentConflictDetail(resolution) ?? undefined}
                      style={PRIMARY_ATTENTION_CHIP_STYLE}
                    >
                      Primary assignment needs attention
                    </span>
                  )}
                </div>
                {!inputsDisabled && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <PlanLifecycleControls
                      index={index}
                      planType="Accommodation"
                      lifecycleState={getEffectiveTripPlanLifecycleState(plan.lifecycleState)}
                      inputsDisabled={inputsDisabled}
                      onLifecycleChange={onLifecycleChange}
                      transitionHint={transitionHint}
                    />
                  </div>
                )}
                <div
                  style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={`Accommodation reference ${index + 1}`}
                    placeholder="Reservation / booking ref"
                    value={plan.referenceNumber ?? ''}
                    onChange={(event) =>
                      onFieldChange(index, 'referenceNumber', event.target.value)
                    }
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 12rem' }}
                  />
                  <input
                    aria-label={`Accommodation source URL ${index + 1}`}
                    placeholder="Source URL"
                    value={plan.sourceUrl ?? ''}
                    onChange={(event) => onFieldChange(index, 'sourceUrl', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                  />
                  {plan.provenance !== undefined && (
                    <input
                      aria-label={`Accommodation source note ${index + 1}`}
                      placeholder="Source note"
                      value={plan.provenance.note ?? ''}
                      onChange={(event) =>
                        onFieldChange(index, 'provenanceNote', event.target.value)
                      }
                      disabled={inputsDisabled}
                      style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
                    />
                  )}
                  <input
                    aria-label={`Accommodation notes ${index + 1}`}
                    placeholder="Notes"
                    value={plan.notes ?? ''}
                    onChange={(event) => onFieldChange(index, 'notes', event.target.value)}
                    disabled={inputsDisabled}
                    style={{ ...INPUT_STYLE, flex: '2 1 14rem' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        disabled={inputsDisabled}
        className="btn-secondary"
        style={{
          alignSelf: 'flex-start',
          padding: '0.5rem 1rem',
          fontSize: '0.8rem',
          fontWeight: 800,
        }}
      >
        <Plus className="w-4 h-4" />
        Add accommodation plan
      </button>
    </div>
  );
};

type AllocationsKey = keyof TripBudgetAllocations;
type BudgetStringField = 'currency' | 'notes';
type BudgetNumberField = 'totalPlanned' | AllocationsKey;
type BudgetField = BudgetStringField | BudgetNumberField;

const ALLOCATION_LABELS: ReadonlyArray<{ key: AllocationsKey; label: string }> = [
  { key: 'transport', label: 'Transport' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'food', label: 'Food' },
  { key: 'activities', label: 'Activities' },
  { key: 'other', label: 'Other' },
];

interface BudgetPlanEditorProps {
  budgetPlan: TripBudgetPlan | null;
  inputsDisabled: boolean;
  onFieldChange: (field: BudgetField, value: string) => void;
  onClear: () => void;
}

/**
 * STEP 16 budget section. All amounts are canonical numbers — never formatted
 * currency strings. Each value is parsed on input (empty, non-numeric entries
 * are dropped); invalid currency/negative amounts surface as a validation
 * message at save time. "Clear budget plan" stages `budgetPlan: null`.
 */
const BudgetPlanEditor: React.FC<BudgetPlanEditorProps> = ({
  budgetPlan,
  inputsDisabled,
  onFieldChange,
  onClear,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    {budgetPlan === null && (
      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
        No budget plan yet. Fill in any field to start one.
      </p>
    )}
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        aria-label="Budget currency"
        placeholder="Currency (e.g. USD)"
        maxLength={8}
        value={budgetPlan?.currency ?? ''}
        onChange={(event) => onFieldChange('currency', event.target.value)}
        disabled={inputsDisabled}
        style={{ ...INPUT_STYLE, flex: '0 1 10rem' }}
      />
      <input
        aria-label="Budget total planned"
        type="number"
        min={0}
        placeholder="Total planned"
        value={budgetPlan?.totalPlanned ?? ''}
        onChange={(event) => onFieldChange('totalPlanned', event.target.value)}
        disabled={inputsDisabled}
        style={{ ...INPUT_STYLE, flex: '0 1 8rem' }}
      />
      {budgetPlan !== null && (
        <button
          type="button"
          onClick={onClear}
          disabled={inputsDisabled}
          className="btn-secondary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 800 }}
        >
          Clear budget plan
        </button>
      )}
    </div>
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {ALLOCATION_LABELS.map(({ key, label }) => (
        <input
          key={key}
          aria-label={`Budget allocation ${label.toLowerCase()}`}
          type="number"
          min={0}
          placeholder={label}
          value={budgetPlan?.allocations?.[key] ?? ''}
          onChange={(event) => onFieldChange(key, event.target.value)}
          disabled={inputsDisabled}
          style={{ ...INPUT_STYLE, flex: '0 1 7rem' }}
        />
      ))}
    </div>
    <input
      aria-label="Budget notes"
      placeholder="Budget notes"
      value={budgetPlan?.notes ?? ''}
      onChange={(event) => onFieldChange('notes', event.target.value)}
      disabled={inputsDisabled}
      style={{ ...INPUT_STYLE, flex: '1 1 100%' }}
    />
  </div>
);

type TaskField =
  | 'category'
  | 'title'
  | 'description'
  | 'status'
  | 'dueDate'
  | 'note'
  | 'relatedSection'
  | 'relatedPlanId';

interface ChecklistEditorProps {
  tasks: TripChecklistItem[];
  inputsDisabled: boolean;
  onFieldChange: (index: number, field: TaskField, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * STEP 18 checklist section. Tasks are entirely user-authored planning/tracking
 * data — no AI proposal and no external system ever touches them here. Status
 * wording is neutral (Pending / In progress / Completed / Skipped) and never
 * claims a booking, payment, or external verification. Related section/plan
 * references are free-form and never existence-checked.
 */
const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
  tasks,
  inputsDisabled,
  onFieldChange,
  onAdd,
  onRemove,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    {tasks.length === 0 ? (
      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
        No tasks yet. Add one to track an execution-preparation step.
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {tasks.map((task, index) => (
          <div key={task.id} style={PLAN_CARD_STYLE}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                aria-label={`Task status ${index + 1}`}
                value={task.status}
                onChange={(event) => onFieldChange(index, 'status', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 8rem' }}
              >
                {TRIP_TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {getTripTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Task category ${index + 1}`}
                value={task.category}
                onChange={(event) => onFieldChange(index, 'category', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 13rem' }}
              >
                {TRIP_TASK_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {getTripTaskCategoryLabel(category)}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Task title ${index + 1}`}
                placeholder="Task title"
                maxLength={120}
                value={task.title}
                onChange={(event) => onFieldChange(index, 'title', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '2 1 12rem' }}
              />
              <input
                aria-label={`Task due date ${index + 1}`}
                type="date"
                value={task.dueDate ?? ''}
                onChange={(event) => onFieldChange(index, 'dueDate', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 9rem' }}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={inputsDisabled}
                aria-label={`Remove task ${index + 1}`}
                style={ICON_BUTTON_STYLE}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                aria-label={`Task description ${index + 1}`}
                placeholder="Description"
                maxLength={500}
                value={task.description ?? ''}
                onChange={(event) => onFieldChange(index, 'description', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '2 1 16rem' }}
              />
              <input
                aria-label={`Task note ${index + 1}`}
                placeholder="Note"
                maxLength={500}
                value={task.note ?? ''}
                onChange={(event) => onFieldChange(index, 'note', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '1 1 10rem' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                aria-label={`Task related section ${index + 1}`}
                value={task.relatedSection ?? ''}
                onChange={(event) => onFieldChange(index, 'relatedSection', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '0 1 12rem' }}
              >
                <option value="">Related section — none</option>
                {TRIP_TASK_RELATED_SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {getTripTaskRelatedSectionLabel(section)}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Task related plan ${index + 1}`}
                placeholder="Related plan id (optional)"
                maxLength={200}
                value={task.relatedPlanId ?? ''}
                onChange={(event) => onFieldChange(index, 'relatedPlanId', event.target.value)}
                disabled={inputsDisabled}
                style={{ ...INPUT_STYLE, flex: '1 1 14rem' }}
              />
            </div>
          </div>
        ))}
      </div>
    )}
    <button
      type="button"
      onClick={onAdd}
      disabled={inputsDisabled}
      className="btn-secondary"
      style={{
        alignSelf: 'flex-start',
        padding: '0.5rem 1rem',
        fontSize: '0.8rem',
        fontWeight: 800,
      }}
    >
      <Plus className="w-4 h-4" />
      Add task
    </button>
  </div>
);

const PLAN_CARD_STYLE: React.CSSProperties = {
  padding: '0.7rem 0.9rem',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

/** Card override that keeps an archived plan visible but visually subdued (STEP 24). */
const ARCHIVED_PLAN_CARD_STYLE: React.CSSProperties = {
  ...PLAN_CARD_STYLE,
  opacity: 0.72,
  border: '1px solid rgba(100, 116, 139, 0.35)',
};

/** Base chip style for the STEP 26 primary-selection status. */
const PRIMARY_STATUS_CHIP_STYLE: React.CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  border: '1px solid rgba(100, 116, 139, 0.35)',
  borderRadius: '999px',
  padding: '0.1rem 0.45rem',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

/** Chip override for a valid explicit primary selection (STEP 26). */
const PRIMARY_SELECTED_CHIP_STYLE: React.CSSProperties = {
  ...PRIMARY_STATUS_CHIP_STYLE,
  color: '#86efac',
  border: '1px solid rgba(74, 222, 128, 0.4)',
};

/** Chip override informing that the primary selection needs attention (STEP 26). */
const PRIMARY_ATTENTION_CHIP_STYLE: React.CSSProperties = {
  ...PRIMARY_STATUS_CHIP_STYLE,
  color: '#fbbf24',
  border: '1px solid rgba(251, 191, 36, 0.4)',
};

/** Chip override for the neutral "no primary selected" state (STEP 26). */
const PRIMARY_NONE_CHIP_STYLE: React.CSSProperties = {
  ...PRIMARY_STATUS_CHIP_STYLE,
  color: '#94a3b8',
};

/** Guidance text under the STEP 26 primary control when the assignment is in conflict (STEP 27). */
const PRIMARY_CONFLICT_GUIDANCE_STYLE: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: '0.72rem',
  color: '#fbbf24',
  margin: 0,
  lineHeight: 1.4,
};

/** Disclaimer legend for the STEP 26 primary control (STEP 27). */
const PRIMARY_ASSIGNMENT_DISCLAIMER_LEGEND =
  'Primary is a planning designation, not a booking: it never verifies availability, confirms payment, or reserves a seat or room.';

const PRIMARY_DISCLAIMER_LEGEND_STYLE: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: '0.68rem',
  color: '#64748b',
  margin: 0,
  lineHeight: 1.4,
};

/** Lifecycle transition hint derived from the primary assignment (STEP 27). */
const LIFECYCLE_HINT_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  margin: 0,
  lineHeight: 1.4,
};

/**
 * STEP 28: concise feedback line describing an explicit primary-resolution
 * decision (or the honest "remains unresolved" state). Planning language only —
 * it never claims a booking, verification, availability, or payment.
 */
const RESOLUTION_FEEDBACK_STYLE: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: '0.72rem',
  margin: 0,
  lineHeight: 1.4,
};

/**
 * STEP 29: transient user-visible change context line comparing the persisted
 * snapshot against the current draft. Violet style to distinguish it from the
 * STEP 28 resolution feedback and the amber conflict guidance. One line per
 * section; disappears when the draft clears (post-save).
 */
const CHANGE_CONTEXT_STYLE: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: '0.72rem',
  margin: 0,
  lineHeight: 1.4,
  color: '#a78bfa',
};

/**
 * Renders the STEP 26 primary-selection control for one plan section: a
 * present/absent status chip plus a `<select>` listing only the effective-
 * active plans (legacy plans included) plus an explicit "No primary selected"
 * option. An invalid or missing selection shows the honest "needs attention"
 * status and an empty select value — the owner can re-select a valid active
 * plan or clear the selection, but nothing auto-promotes a candidate. The
 * select is disabled unless the section is being edited; staging happens in the
 * draft only.
 */
function PrimarySelectionControl({
  plans,
  primaryId,
  planType,
  inputsDisabled,
  onSelect,
  getLabel,
}: {
  plans: ReadonlyArray<TripTransportPlan | TripAccommodationPlan>;
  primaryId: string | null | undefined;
  planType: 'Transport' | 'Accommodation';
  inputsDisabled: boolean;
  onSelect: (id: string | null) => void;
  getLabel: (plan: TripTransportPlan | TripAccommodationPlan) => string;
}) {
  const { partition, resolution } = partitionPlanningReferencesWithPrimary(
    plans,
    primaryId ?? undefined
  );
  const eligiblePlans = [...partition.selected, ...partition.eligibleActive];
  const hasValidSelection = resolution.state === 'valid-explicit-selection';
  const value = hasValidSelection && resolution.selectedId ? resolution.selectedId : '';
  const statusLabel = getPrimarySelectionStatusLabel(resolution.state);
  const ariaPrefix = `Primary ${planType.toLowerCase()} plan`;
  const statusStyle = hasValidSelection
    ? PRIMARY_SELECTED_CHIP_STYLE
    : isPrimarySelectionAttentionState(resolution.state)
      ? PRIMARY_ATTENTION_CHIP_STYLE
      : PRIMARY_NONE_CHIP_STYLE;

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.45rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '0.35rem 0',
      }}
    >
      <label htmlFor={`primary-${planType.toLowerCase()}`} style={LABEL_STYLE}>
        Primary
      </label>
      <select
        id={`primary-${planType.toLowerCase()}`}
        aria-label={`${ariaPrefix} reference`}
        value={value}
        disabled={inputsDisabled}
        onChange={(event) => onSelect(event.target.value === '' ? null : event.target.value)}
        style={{ ...INPUT_STYLE, flex: '1 1 14rem', minWidth: '10rem' }}
      >
        <option value="">No primary selected</option>
        {eligiblePlans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {getLabel(plan)}
          </option>
        ))}
      </select>
      <span
        aria-label={`${ariaPrefix} selection status`}
        title={resolution.reason ?? undefined}
        style={statusStyle}
      >
        {statusLabel}
      </span>
      {isPrimarySelectionAttentionState(resolution.state) && (
        <p aria-label={`${ariaPrefix} assignment guidance`} style={PRIMARY_CONFLICT_GUIDANCE_STYLE}>
          {getPrimaryAssignmentConflictDetail(resolution)}
        </p>
      )}
      <p style={PRIMARY_DISCLAIMER_LEGEND_STYLE}>{PRIMARY_ASSIGNMENT_DISCLAIMER_LEGEND}</p>
    </div>
  );
}

/** Deterministic select-option label for a transport plan (STEP 26, refactored STEP 29). */
function getTransportPlanSelectionLabel(plan: TripTransportPlan | TripAccommodationPlan): string {
  return getTransportPlanReferenceLabel(plan);
}

/** Deterministic select-option label for an accommodation plan (STEP 26, refactored STEP 29). */
function getAccommodationPlanSelectionLabel(
  plan: TripTransportPlan | TripAccommodationPlan
): string {
  return getAccommodationPlanReferenceLabel(plan);
}

/**
 * Renders the STEP 24 lifecycle control group for one plan card: a read-only
 * label for the current state plus the explicit user actions that change it
 * (needs review / active / replaced / archive / restore). Every action only
 * writes the plan's `lifecycleState` in the draft — explicit Save persists it,
 * and nothing else (readiness, provenance, checklist tasks) is touched.
 */
function PlanLifecycleControls({
  index,
  planType,
  lifecycleState,
  inputsDisabled,
  onLifecycleChange,
  transitionHint,
}: {
  index: number;
  planType: 'Transport' | 'Accommodation';
  lifecycleState: TripPlanLifecycleState;
  inputsDisabled: boolean;
  onLifecycleChange: (index: number, state: TripPlanLifecycleState) => void;
  transitionHint?: { tone: 'warning' | 'restore'; message: string } | null;
}) {
  const ariaPrefix = `${planType} plan ${index + 1}`;
  return (
    <>
      {lifecycleState !== 'active' && (
        <button
          type="button"
          onClick={() => onLifecycleChange(index, 'active')}
          disabled={inputsDisabled}
          aria-label={`Mark ${ariaPrefix} as active`}
          className="btn-secondary"
          style={LIFECYCLE_ACTION_STYLE}
        >
          Mark as active
        </button>
      )}
      {lifecycleState !== 'needs-review' && (
        <button
          type="button"
          onClick={() => onLifecycleChange(index, 'needs-review')}
          disabled={inputsDisabled}
          aria-label={`Mark ${ariaPrefix} for review`}
          className="btn-secondary"
          style={LIFECYCLE_ACTION_STYLE}
        >
          Needs review
        </button>
      )}
      {lifecycleState !== 'replaced' && lifecycleState !== 'archived' && (
        <button
          type="button"
          onClick={() => onLifecycleChange(index, 'replaced')}
          disabled={inputsDisabled}
          aria-label={`Mark ${ariaPrefix} as replaced`}
          className="btn-secondary"
          style={LIFECYCLE_ACTION_STYLE}
        >
          Replace
        </button>
      )}
      {lifecycleState !== 'archived' && (
        <button
          type="button"
          onClick={() => onLifecycleChange(index, 'archived')}
          disabled={inputsDisabled}
          aria-label={`Archive ${ariaPrefix}`}
          className="btn-secondary"
          style={LIFECYCLE_ACTION_STYLE}
        >
          Archive
        </button>
      )}
      {lifecycleState === 'archived' && (
        <button
          type="button"
          onClick={() => onLifecycleChange(index, 'active')}
          disabled={inputsDisabled}
          aria-label={`Restore ${ariaPrefix}`}
          className="btn-secondary"
          style={LIFECYCLE_ACTION_STYLE}
        >
          Restore
        </button>
      )}
      {transitionHint !== null && transitionHint !== undefined && (
        <span
          role="status"
          aria-label={`${ariaPrefix} primary lifecycle hint`}
          style={
            transitionHint.tone === 'warning'
              ? { ...LIFECYCLE_HINT_STYLE, color: '#fbbf24' }
              : { ...LIFECYCLE_HINT_STYLE, color: '#86efac' }
          }
        >
          {transitionHint.message}
        </span>
      )}
    </>
  );
}

const PROPOSAL_SECTION_LABELS: Record<TripPlanningDiffRow['section'], string> = {
  dates: 'Dates',
  destinations: 'Destinations',
  days: 'Daily itinerary',
  notes: 'Notes',
  references: 'References',
};

interface AiProposalPreviewProps {
  proposal: TripPlanningProposal;
  current: TripPlanningData;
  applied: boolean;
  applyDisabled: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/**
 * Human-review preview for a validated AI proposal (STEP 15). Shows the
 * explanation, any warnings/assumptions, and a compact current → proposed diff.
 * The proposal is never applied to persisted state here — approving only stages
 * it in the local draft, and persistence still happens via the explicit Save
 * planning button.
 */
const AiProposalPreview: React.FC<AiProposalPreviewProps> = ({
  proposal,
  current,
  applied,
  applyDisabled,
  onApply,
  onDiscard,
}) => {
  const rows = summarizeProposalChanges(proposal, current);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        padding: '0.8rem 0.9rem',
        borderRadius: '14px',
        background: 'rgba(34,211,238,0.06)',
        border: '1px solid rgba(34,211,238,0.25)',
      }}
    >
      <p style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: 0, lineHeight: 1.45 }}>
        {proposal.explanation}
      </p>

      {proposal.warnings && proposal.warnings.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: '1.2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          {proposal.warnings.map((warning, index) => (
            <li key={index} style={{ fontSize: '0.8rem', color: '#fbbf24', lineHeight: 1.4 }}>
              {warning}
            </li>
          ))}
        </ul>
      )}

      {proposal.assumptions && proposal.assumptions.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: '1.2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          {proposal.assumptions.map((assumption, index) => (
            <li key={index} style={{ fontSize: '0.8rem', color: '#a5b4c8', lineHeight: 1.4 }}>
              {assumption}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {rows.map((row) => (
            <div key={row.section} style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
              <span style={{ fontWeight: 800, color: '#7dd3fc' }}>
                {PROPOSAL_SECTION_LABELS[row.section]}
              </span>
              <div style={{ color: '#94a3b8' }}>
                <span style={{ color: '#94a3b8' }}>Current: </span>
                <span style={{ color: '#cbd5e1' }}>{row.current}</span>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>Proposed: </span>
                <span style={{ color: '#bbf7d0' }}>{row.proposed}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
          This suggestion has no editable sections to apply.
        </p>
      )}

      {applied && (
        <p style={{ fontSize: '0.8rem', color: '#4ade80', margin: 0 }} role="status">
          Applied to your draft. Press “Save planning” to persist these changes.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onApply}
          disabled={applied || applyDisabled}
          className="btn-primary"
          style={{
            padding: '0.5rem 1.1rem',
            fontSize: '0.82rem',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <Sparkles className="w-4 h-4" />
          {applied ? 'Applied' : 'Apply suggestion'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={applyDisabled}
          className="btn-secondary"
          style={{ padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 800 }}
        >
          Discard
        </button>
      </div>
    </div>
  );
};

type ActivityField =
  'time' | 'title' | 'description' | 'locationName' | 'category' | 'estimatedCost';

type ReferenceField = 'kind' | 'title' | 'url' | 'dayNumber' | 'provider' | 'estimatedCost';

function blankActivity(): Activity {
  return {
    time: '',
    title: '',
    description: '',
    locationName: '',
    category: '',
    estimatedCost: '',
  };
}

function setActivityValue(activity: Activity, field: ActivityField, value: string): Activity {
  const next: Activity = { ...activity };
  if (field === 'time') next.time = value;
  else if (field === 'title') next.title = value;
  else if (field === 'description') next.description = value;
  else if (field === 'locationName') next.locationName = value;
  else if (field === 'category') next.category = value;
  else next.estimatedCost = value;
  return next;
}

/**
 * Rebuilds a reference for a kind change, carrying over only the fields that
 * are valid across every kind and never emitting `undefined`-valued keys (which
 * Firestore rejects). Kind-specific fields are intentionally dropped on switch.
 */
function referenceWithKind(
  reference: TripPlanningReference,
  kind: ReferenceKind
): TripPlanningReference {
  const base = {
    id: reference.id,
    title: reference.title,
    ...(reference.url !== undefined ? { url: reference.url } : {}),
    ...(reference.dayNumber !== undefined ? { dayNumber: reference.dayNumber } : {}),
    ...(reference.provider !== undefined ? { provider: reference.provider } : {}),
    ...(reference.providerId !== undefined ? { providerId: reference.providerId } : {}),
    ...(reference.estimatedCost !== undefined ? { estimatedCost: reference.estimatedCost } : {}),
  };
  if (kind === 'activity') return { ...base, kind: 'activity' };
  if (kind === 'transport') return { ...base, kind: 'transport' };
  return { ...base, kind: 'accommodation' };
}

/** Stores a trimmed url, or physically drops the key when cleared. */
function referenceWithUrl(reference: TripPlanningReference, value: string): TripPlanningReference {
  const trimmed = value.trim();
  if (trimmed.length === 0) return referenceWithoutKey(reference, 'url');
  return { ...reference, url: trimmed };
}

/** Stores a positive integer day number, or drops the key when empty/invalid. */
function referenceWithDayNumber(
  reference: TripPlanningReference,
  value: string
): TripPlanningReference {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed.length > 0 && Number.isInteger(parsed) && parsed >= 1) {
    return { ...reference, dayNumber: parsed };
  }
  return referenceWithoutKey(reference, 'dayNumber');
}

function referenceWithoutKey(
  reference: TripPlanningReference,
  key: 'url' | 'dayNumber'
): TripPlanningReference {
  const { [key]: _removed, ...rest } = reference;
  void _removed;
  return rest;
}

/**
 * Lowers a transport-plan field into the record: the raw string is kept while
 * typing (interior spaces survive) and an empty/whitespace value physically
 * drops the key so no empty string reaches Firestore. Strings are trimmed at
 * the domain boundary on save; time fields keep their raw ISO value and are
 * validated on save.
 *
 * STEP 23: the `provenanceNote` field mutates only the note inside an existing
 * `provenance` record, preserving its kind and dropping just the note when
 * cleared. Editing the note never creates provenance on a legacy plan that has
 * none — that record is returned unchanged.
 */
function setTransportPlanValue(
  plan: TripTransportPlan,
  field: TransportPlanField,
  value: string
): TripTransportPlan {
  if (field === 'provenanceNote') {
    if (plan.provenance === undefined) return plan;
    if (value.trim().length === 0) {
      return { ...plan, provenance: { kind: plan.provenance.kind } };
    }
    return { ...plan, provenance: { kind: plan.provenance.kind, note: value } };
  }
  if (value.trim().length === 0) return withoutPlanKey(plan, field) as TripTransportPlan;
  return { ...plan, [field]: value };
}

/** Same present-only lowered-string semantics for accommodation plan fields. */
function setAccommodationPlanValue(
  plan: TripAccommodationPlan,
  field: AccommodationPlanField,
  value: string
): TripAccommodationPlan {
  if (field === 'provenanceNote') {
    if (plan.provenance === undefined) return plan;
    if (value.trim().length === 0) {
      return { ...plan, provenance: { kind: plan.provenance.kind } };
    }
    return { ...plan, provenance: { kind: plan.provenance.kind, note: value } };
  }
  if (value.trim().length === 0) return withoutPlanKey(plan, field) as TripAccommodationPlan;
  return { ...plan, [field]: value };
}

/**
 * Lowers one budget field into the plan. String fields keep their raw value
 * while typing and drop the key when empty (trimming happens on save). Numeric
 * fields parse to a finite number on input (empty or non-numeric entries drop
 * the key — a typed negative amount is kept so the domain can surface a
 * validation message). Start plans are created on first input from an
 * empty/null plan.
 */
function setBudgetPlanValue(
  plan: TripBudgetPlan | null,
  field: BudgetField,
  value: string
): TripBudgetPlan {
  const base: TripBudgetPlan = plan ? { ...plan } : {};

  if (field === 'currency' || field === 'notes') {
    if (value.trim().length === 0) {
      const { [field]: _removed, ...rest } = base;
      void _removed;
      return rest;
    }
    return { ...base, [field]: value };
  }

  if (field === 'totalPlanned') {
    if (value.trim().length === 0) {
      const { totalPlanned: _removed, ...rest } = base;
      void _removed;
      return rest;
    }
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return { ...base, totalPlanned: parsed };
    return base;
  }

  const allocations: TripBudgetAllocations = base.allocations ? { ...base.allocations } : {};
  if (value.trim().length === 0) {
    delete allocations[field];
  } else {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) allocations[field] = parsed;
  }
  if (Object.keys(allocations).length === 0) {
    const { allocations: _removed, ...rest } = base;
    void _removed;
    return rest;
  }
  return { ...base, allocations };
}

/**
 * Lowers one checklist task field into the task. Select fields (status,
 * category, related section) always store a recognized value; the related
 * section select's empty option drops the key. The required `title` keeps its
 * raw string while typing (the domain rejects an empty/whitespace title at save
 * time). Optional free-text and date fields follow the plan-field semantics: the
 * raw string is kept while typing and an empty/whitespace value physically drops
 * the key (their inputs render `?? ''`, so the field never becomes uncontrolled).
 */
function setTaskValue(task: TripChecklistItem, field: TaskField, value: string): TripChecklistItem {
  if (field === 'status') return { ...task, status: value as TripTaskStatus };
  if (field === 'category') return { ...task, category: value as TripTaskCategory };
  if (field === 'relatedSection') {
    if (value.trim().length === 0) return withoutPlanKey(task, 'relatedSection');
    return { ...task, relatedSection: value as TripTaskRelatedSection };
  }
  if (field === 'title') return { ...task, title: value };
  if (value.trim().length === 0) return withoutPlanKey(task, field) as TripChecklistItem;
  return { ...task, [field]: value };
}

/** Generic present-key drop so cleared optionals never serialize. */
function withoutPlanKey<T extends object, K extends keyof T>(plan: T, key: K): T {
  const { [key]: _removed, ...rest } = plan;
  void _removed;
  return rest as T;
}

function makeLocalId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}
