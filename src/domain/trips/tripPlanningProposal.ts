/**
 * Pure, bounded AI proposal model (STEP 15).
 *
 * This module owns the only typed way to shape an AI planning proposal for
 * review. It is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 *
 * The AI layer may only ever produce a *proposal* — it never writes to
 * Firestore, never calls `updateTripPlanning()`, and never mutates the active
 * trip. Every proposal passes through the exact same strict domain boundary
 * used by manual editing (`normalizeTripPlanningUpdate`) so AI output can never
 * bypass date, destination, activity, reference, URL-safety, duplicate-ID, or
 * unknown-key checks. `dateRange: null` semantics and present/absent-key
 * semantics match STEP 14 exactly.
 *
 * STEP 16 scope lock: the AI layer stays limited to the five STEP 14 sections.
 * The user-only sections introduced in STEP 16 (`transportPlans`,
 * `accommodationPlans`, `budgetPlan`) are rejected from AI proposals up front
 * by `ALLOWED_PROPOSAL_UPDATE_KEYS` — the model can plan dates, destinations,
 * days, notes, and references, but it never drafts transport, accommodation,
 * or budget-plan numbers.
 *
 * STEP 26 scope lock: the section-level primary selection ids
 * (`primaryTransportPlanId`, `primaryAccommodationPlanId`) are strictly
 * user-controlled and are **not** in `ALLOWED_PROPOSAL_UPDATE_KEYS`. An AI
 * proposal that attempts to set, overwrite, or clear either selection is
 * rejected up front as an unknown update key, so no proposal can ever alter a
 * primary selection. The `currentPlanning` context an AI request carries may
 * include the selection (read-only projection of persisted state), but the
 * proposal envelope itself can never return one.
 */

import type {
  TripDateRange,
  TripPlanningData,
  TripPlanningProposal,
  TripPlanningRequest,
  TripPlanningUpdate,
} from '../../types/trip';
import type { PlanningDraft } from './tripPlanningEdit';
import { normalizeTripPlanningData } from './tripPlanning';
import { normalizeTripPlanningUpdate } from './tripPlanningEdit';

/** Upper bound on a planning instruction sent to the model (trimmed). */
export const MAX_PLANNING_INSTRUCTION_LENGTH = 1000;

/** The only keys allowed on an AI proposal envelope. */
const ALLOWED_PROPOSAL_KEYS: ReadonlyArray<string> = [
  'explanation',
  'warnings',
  'assumptions',
  'update',
];

/** The only sections an AI proposal may edit (the STEP 14 five). */
export const ALLOWED_PROPOSAL_UPDATE_KEYS: ReadonlyArray<string> = [
  'dateRange',
  'destinations',
  'days',
  'notes',
  'references',
];

/** The only keys allowed on an AI planning request envelope. */
const ALLOWED_REQUEST_KEYS: ReadonlyArray<string> = [
  'currentPlanning',
  'instruction',
  'constraints',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalizes an untrusted planning request for the AI service, or returns
 * `null` when it cannot be repaired. The instruction must be a non-empty
 * trimmed string within `MAX_PLANNING_INSTRUCTION_LENGTH`; `currentPlanning`
 * must pass the shared `normalizeTripPlanningData` boundary; `constraints` must
 * be an optional array of strings. Never throws.
 */
export function normalizeTripPlanningRequest(value: unknown): TripPlanningRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_REQUEST_KEYS.includes(key))) return null;

  const instruction = value.instruction;
  if (typeof instruction !== 'string') return null;
  const trimmed = instruction.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PLANNING_INSTRUCTION_LENGTH) return null;

  const currentPlanning = normalizeTripPlanningData(value.currentPlanning);
  if (currentPlanning === null) return null;

  let constraints: string[] | undefined;
  if (value.constraints !== undefined) {
    if (!Array.isArray(value.constraints) || value.constraints.some((c) => typeof c !== 'string')) {
      return null;
    }
    constraints = value.constraints.filter((c) => c.trim().length > 0);
  }

  return {
    currentPlanning,
    instruction: trimmed,
    ...(constraints && constraints.length > 0 ? { constraints } : {}),
  };
}

/**
 * Normalizes an untrusted AI response into a `TripPlanningProposal`, or returns
 * `null` when the shape cannot be repaired. The envelope is strict (no unknown
 * keys, no arbitrary fields) and the extracted `update` must first pass the AI
 * `ALLOWED_PROPOSAL_UPDATE_KEYS` whitelist, then the same
 * `normalizeTripPlanningUpdate` boundary used by manual editing — so the user
 * only STEP 16 plan sections (`transportPlans`, `accommodationPlans`,
 * `budgetPlan`), unknown update keys, malformed sections, duplicate ids, unsafe
 * urls, and invalid dates all reject the whole proposal. Never throws.
 */
export function normalizeTripPlanningProposal(value: unknown): TripPlanningProposal | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_PROPOSAL_KEYS.includes(key))) return null;

  const explanation = value.explanation;
  if (typeof explanation !== 'string' || explanation.trim().length === 0) return null;

  let warnings: string[] | undefined;
  if (value.warnings !== undefined) {
    if (!Array.isArray(value.warnings) || value.warnings.some((w) => typeof w !== 'string')) {
      return null;
    }
    warnings = value.warnings.filter((w) => w.trim().length > 0);
  }

  let assumptions: string[] | undefined;
  if (value.assumptions !== undefined) {
    if (!Array.isArray(value.assumptions) || value.assumptions.some((a) => typeof a !== 'string')) {
      return null;
    }
    assumptions = value.assumptions.filter((a) => a.trim().length > 0);
  }

  if (!isRecord(value.update)) return null;
  const updateKeys = Object.keys(value.update);
  if (updateKeys.some((key) => !ALLOWED_PROPOSAL_UPDATE_KEYS.includes(key))) return null;

  const update = normalizeTripPlanningUpdate(value.update);
  if (update === null) return null;

  return {
    explanation: explanation.trim(),
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
    ...(assumptions && assumptions.length > 0 ? { assumptions } : {}),
    update,
  };
}

/**
 * Merges an approved proposal into the local planning draft (STEP 15 merge
 * semantics). Returns a fresh draft — the base draft and the proposal are never
 * mutated. Present keys in the proposal override the draft, absent keys leave
 * the draft untouched, and `dateRange: null` keeps its clear-date meaning. This
 * matches the editor's own patch-merge semantics exactly.
 */
export function mergePlanningProposalIntoDraft(
  base: PlanningDraft,
  proposal: TripPlanningProposal
): PlanningDraft {
  return { ...base, ...proposal.update };
}

/** One row of a human-readable current → proposed diff used by the preview. */
export interface TripPlanningDiffRow {
  section: 'dates' | 'destinations' | 'days' | 'notes' | 'references';
  current: string;
  proposed: string;
}

/**
 * Builds the compact current → proposed diff rows for a proposal against the
 * current structured planning values. Only sections actually present in the
 * proposal's `update` produce a row; untouched sections are not listed. All
 * output is plain text (deterministic for tests); never mutates inputs.
 */
export function summarizeProposalChanges(
  proposal: TripPlanningProposal,
  current: TripPlanningData
): TripPlanningDiffRow[] {
  const rows: TripPlanningDiffRow[] = [];

  if (proposal.update.dateRange !== undefined) {
    const proposed =
      proposal.update.dateRange === null ? 'Clear dates' : formatDates(proposal.update.dateRange);
    rows.push({
      section: 'dates',
      current: current.dates ? formatDates(current.dates) : 'No dates set',
      proposed,
    });
  }

  if (proposal.update.destinations !== undefined) {
    rows.push({
      section: 'destinations',
      current: formatNames(current.destinations.map((d) => d.name)),
      proposed: formatNames(proposal.update.destinations.map((d) => d.name)),
    });
  }

  if (proposal.update.days !== undefined) {
    rows.push({
      section: 'days',
      current: formatDays(current.days),
      proposed: formatDays(proposal.update.days),
    });
  }

  if (proposal.update.notes !== undefined) {
    const notes = proposal.update.notes;
    rows.push({
      section: 'notes',
      current: formatNotes(current.notes),
      proposed: formatNotes(notes),
    });
  }

  if (proposal.update.references !== undefined) {
    rows.push({
      section: 'references',
      current: formatNames(current.references.map((r) => r.title)),
      proposed: formatNames(proposal.update.references.map((r) => r.title)),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Internal formatting helpers (plain, deterministic text only).
// ---------------------------------------------------------------------------

function formatDates(dates: TripDateRange): string {
  return `${dates.startDate} → ${dates.endDate}`;
}

function formatNames(names: string[]): string {
  if (names.length === 0) return 'None';
  return truncate(names.join(', '));
}

function formatDays(days: TripPlanningData['days']): string {
  if (days.length === 0) return 'None';
  return truncate(days.map((day) => `Day ${day.dayNumber}: ${day.title}`).join('; '));
}

function formatNotes(notes: string[]): string {
  const trimmed = notes.map((note) => note.trim()).filter((note) => note.length > 0);
  if (trimmed.length === 0) return 'None';
  return `${trimmed.length} note(s)`;
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export type { TripPlanningUpdate };
