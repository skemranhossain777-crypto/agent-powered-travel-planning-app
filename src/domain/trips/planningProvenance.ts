/**
 * Pure planning-reference provenance vocabulary (STEP 23).
 *
 * This module owns the only provenance vocabulary for explicitly-entered
 * transport/accommodation plans: the four-kind marker (`manual`,
 * `ai-generated`, `mock-discovery`, `external-provider`) plus the pure helpers
 * that validate, normalize, label, and classify it. It is deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches.
 *
 * Truthfulness rules that keep provenance honest:
 *
 * 1. Provenance answers "where did this record come from" — it never implies
 *    availability, pricing, verification, or a booking, and this module never
 *    claims any of those.
 * 2. `mock-discovery` is always simulated sample data from the in-app
 *    discovery panel — it is never presentable as live or verified.
 * 3. `external-provider` is reserved for a future provider source. It is never
 *    produced by user input and never presented as verified or current.
 * 4. An absent provenance on a legacy record is valid and stays absent; a
 *    missing value is never inferred from text or notes, and an untrusted
 *    value is rejected, never guessed.
 * 5. There are no timestamps here and no freshness semantics: provenance does
 *    not record when or how current a source is.
 */

import type { TripPlanProvenance, TripPlanProvenanceKind } from '../../types/trip';

/** The only recognized provenance kinds (unknown values are always rejected). */
export const TRIP_PLAN_PROVENANCE_KINDS: ReadonlyArray<TripPlanProvenanceKind> = [
  'manual',
  'ai-generated',
  'mock-discovery',
  'external-provider',
];

/** Upper bound on a provenance source note (concise plain text only). */
export const MAX_PLAN_PROVENANCE_NOTE_LENGTH = 500;

/**
 * True when `value` is one of the recognized provenance kinds. Unknown or
 * arbitrary strings are rejected — they must never reach a persisted record.
 */
export function isTripPlanProvenanceKind(value: unknown): value is TripPlanProvenanceKind {
  return (
    typeof value === 'string' &&
    (TRIP_PLAN_PROVENANCE_KINDS as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Normalizes an untrusted provenance payload into a valid `TripPlanProvenance`,
 * or returns `null` when the shape cannot be repaired. The `kind` is required
 * and must be a recognized value (unknown states reject the whole record —
 * never guessed); the optional `note` is trimmed and dropped when empty, and
 * bounded to `MAX_PLAN_PROVENANCE_NOTE_LENGTH` when present. The record is
 * rebuilt field-by-field so runtime-only keys never persist. `null` is treated
 * like an absent value by the plan normalizers. Never throws.
 */
export function normalizeTripPlanProvenance(value: unknown): TripPlanProvenance | null {
  if (!isRecord(value)) return null;
  const { kind, note } = value;
  if (!isTripPlanProvenanceKind(kind)) return null;
  const provenance: TripPlanProvenance = { kind };
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') return null;
    const trimmed = note.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > MAX_PLAN_PROVENANCE_NOTE_LENGTH) return null;
      provenance.note = trimmed;
    }
  }
  return provenance;
}

/** True when `value` is a well-formed `TripPlanProvenance` record. */
export function isTripPlanProvenance(value: unknown): value is TripPlanProvenance {
  return normalizeTripPlanProvenance(value) !== null;
}

/**
 * Human-readable label for a provenance kind, used only by read-only UI
 * presentation. Every label stays honest: a simulated import is "Simulated
 * discovery", an external provider is explicitly "not verified", and nothing
 * here ever claims a booking, live availability, or a confirmed price.
 */
export function getTripPlanProvenanceLabel(kind: TripPlanProvenanceKind): string {
  switch (kind) {
    case 'manual':
      return 'Manual reference';
    case 'ai-generated':
      return 'AI-generated reference';
    case 'mock-discovery':
      return 'Simulated discovery';
    case 'external-provider':
      return 'External provider reference — not verified';
  }
}

/**
 * Optional short description for a provenance kind used as read-only tooltip
 * text. Only the kinds that need disambiguation return one.
 */
export function getTripPlanProvenanceDescription(kind: TripPlanProvenanceKind): string | undefined {
  switch (kind) {
    case 'mock-discovery':
      return 'Sample data imported from the in-app simulated discovery — not live availability, not externally verified, and not a booking.';
    case 'external-provider':
      return 'Supplied by a future external provider — not verified and never treated as current availability today.';
    default:
      return undefined;
  }
}

/**
 * True only for the `mock-discovery` kind. The single predicate that marks a
 * plan as simulated/illustrative so the UI always identifies it as such.
 */
export function isSimulatedProvenance(kind: TripPlanProvenanceKind): boolean {
  return kind === 'mock-discovery';
}

/**
 * True only for the `external-provider` kind. Keeps future-facing provider
 * references distinct from user-authored data without presenting them as
 * verified.
 */
export function isExternalProviderProvenance(kind: TripPlanProvenanceKind): boolean {
  return kind === 'external-provider';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
