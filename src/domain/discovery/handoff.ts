/**
 * Pure domain boundary for the STEP 22 discovery-to-planning handoff.
 *
 * This module turns a user-selected normalized discovery result (STEP 20/21)
 * into an explicitly user-entered draft planning reference for the trip
 * workspace. It is deliberately side-effect free and dependency-free: no React,
 * Firebase, Router, services, component, Zustand, clock, network, `any`, or
 * generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. **User-controlled only.** Nothing auto-imports a result. The UI maps a
 *    user click into `mapDiscoveryResultToHandoffPlan`, then appends the
 *    returned plan to the existing planning draft via the workspace's normal
 *    explicit-save path. The plan lives in `planningDraft` until the user
 *    explicitly saves planning — handoff never mutates a trip or persists.
 * 2. **Stale or non-planning results are refused.** `getDiscoveryHandoffProblem`
 *    blocks results that are no longer transport/accommodation quotes or that
 *    are expired at `now`, so a stale quote never becomes planning data.
 * 3. **Provenance-labeled.** Every imported plan carries a deterministic
 *    `handoff-<resultId>` id, a fixed `planned` readiness state, appended
 *    `sourceUrl`, typed provenance metadata (STEP 23: `mock-discovery` for the
 *    in-app simulated discovery, `external-provider` for a real provider, both
 *    with exact source notes added at STEP 22/41), and provenance notes that
 *    state exactly where the record came from, that it is not externally
 *    verified, and that it is not a booking or reservation.
 * 4. **Active by default, never stale.** Every imported plan also carries the
 *    deterministic `active` lifecycle state (STEP 24) — the same effective
 *    default a legacy record without lifecycle metadata gets. This is a
 *    documented default, not an automatic transition, and the module never
 *    fabricates a staleness, verification, or booking state.
 * 5. **Only supported fields cross the boundary.** Time, price, cancellation,
 *    duration, limitations, provider identity (stable provider id and display
 *    name), and any isolated provider metadata pairs are documented in notes —
 *    they are never copied into plan fields the planning
 *    model does not own. Unknown keys are stripped because the mapped record
 *    always passes through the shared trip planning normalizers before leaving
 *    this module.
 * 6. `now` is an injected ISO timestamp string used only to evaluate
 *    staleness; this module never reads the current clock.
 * 7. **Primary selection is never assigned here (STEP 26).** A handoff only
 *    produces a draft plan record; it never writes the section-level
 *    `primaryTransportPlanId` / `primaryAccommodationPlanId` fields, so an
 *    imported reference never silently becomes the primary reference. Whether
 *    the user later marks one is a separate, explicit editor action.
 */

import type { TripAccommodationPlan, TripTransportPlan } from '../../types/trip';
import type { TripProviderResult } from '../providers/providerResults';
import { isTripProviderResultExpired } from '../providers/providerResults';
import { DEFAULT_TRIP_PLAN_LIFECYCLE_STATE } from '../trips/planningLifecycle';
import { normalizeTripAccommodationPlan, normalizeTripTransportPlan } from '../trips/tripPlanning';

/** The planning section an imported discovery result maps into. */
export type DiscoveryHandoffKind = 'transport' | 'accommodation';

/** A mapped discovery result ready to be appended to the planning draft. */
export type DiscoveryHandoffPlan =
  | { kind: 'transport'; plan: TripTransportPlan }
  | { kind: 'accommodation'; plan: TripAccommodationPlan };

/** Deterministic plan-id prefix so an imported plan is recognizable (STEP 22). */
export const DISCOVERY_HANDOFF_PLAN_ID_PREFIX = 'handoff-';

/**
 * Readiness note stamped on every imported mock-discovery plan. The handoff is
 * always a user-entered planning reference, never a booking or confirmation.
 */
export const DISCOVERY_HANDOFF_READINESS_NOTE =
  'Imported from simulated discovery as a user-entered planning reference.';

/**
 * Concise provenance note stamped on every imported mock-discovery plan
 * (STEP 23). Records exactly where the record came from — the in-app simulated
 * discovery — so the typed provenance (`mock-discovery`) carries a
 * human-readable source note without ever claiming live data, verification, or
 * a booking.
 */
export const DISCOVERY_HANDOFF_PROVENANCE_NOTE = DISCOVERY_HANDOFF_READINESS_NOTE;

/**
 * Readiness note stamped on every plan imported from a REAL external provider
 * (STEP 41). Like the simulated handoff, the import is a user-entered planning
 * reference; it is never a booking, reservation, or confirmation, and it never
 * claims verification.
 */
export const EXTERNAL_DISCOVERY_HANDOFF_READINESS_NOTE =
  'Imported from live provider discovery as a user-entered planning reference.';

/**
 * Concise provenance note stamped on every plan imported from a real external
 * provider. The typed provenance is `external-provider`; the note says exactly
 * what is known (imported from live provider discovery, user-entered reference)
 * and never claims live verification, guaranteed availability, or a booking.
 */
export const EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_NOTE = EXTERNAL_DISCOVERY_HANDOFF_READINESS_NOTE;

/**
 * The deterministic lifecycle state (STEP 24) stamped on every imported plan.
 * An import is an explicit user choice, so the reference starts as an `active`
 * planning reference — the same state a legacy plan with no lifecycle metadata
 * is treated as. It is a documented default, never an automatic transition: the
 * user can re-mark the reference (needs-review / replaced / archived / active)
 * in the editor, and nothing here ever claims staleness or verification.
 */
export const DISCOVERY_HANDOFF_LIFECYCLE_STATE = DEFAULT_TRIP_PLAN_LIFECYCLE_STATE;

/**
 * The fixed provenance labels recorded in every imported plan's notes. These
 * are the full handoff provenance contract: the source, the nature (user-entered
 * planning reference), the sample status, and the explicit no-booking/no-
 * verification guarantees.
 */
export const DISCOVERY_HANDOFF_PROVENANCE_LABELS = [
  'Imported from simulated discovery',
  'User-entered planning reference',
  'Sample data — not live availability',
  'Not externally verified',
  'Not a booking or reservation',
] as const;

/**
 * The fixed provenance labels recorded in every plan imported from a real
 * external provider (STEP 41). They state the source, the nature (user-entered
 * planning reference), the unverified status, and the explicit no-booking/no-
 * verification guarantees. Deliberately parallel to the mock labels so both
 * paths stay honest about exactly where their plan came from.
 */
export const EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_LABELS = [
  'Imported from live provider discovery',
  'User-entered planning reference',
  'Live provider quote — not externally verified',
  'Not a booking or reservation',
] as const;

/** True when `result` is a category the planning handoff supports. */
function isHandoffCategory(result: TripProviderResult): boolean {
  return result.category === 'transport' || result.category === 'accommodation';
}

/**
 * The stable draft-plan id an imported `resultId` maps to. Both the UI and the
 * duplicate guards use this helper so an already-imported result is never
 * imported twice.
 */
export function getDiscoveryHandoffPlanId(resultId: string): string {
  return `${DISCOVERY_HANDOFF_PLAN_ID_PREFIX}${resultId}`;
}

/**
 * A user-facing problem that blocks importing `result` at `now`, or `null`
 * when the result can be handed off. A result that is not a transport or
 * accommodation quote, or one that is already stale, is never turned into
 * planning data.
 */
export function getDiscoveryHandoffProblem(result: TripProviderResult, now: string): string | null {
  if (!isHandoffCategory(result)) {
    return 'Only transport and accommodation results can be added as planning references.';
  }
  if (isTripProviderResultExpired(result, now)) {
    return 'This quote has expired and must not be used as planning data.';
  }
  return null;
}

/**
 * Maps a user-selected normalized discovery result into a draft planning record
 * (STEP 22). Returns `null` when the result cannot be handed off (non-planning
 * category or already expired at `now`), or when the mapped record fails the
 * shared trip planning normalizers.
 *
 * Only supported fields cross the boundary:
 * - Transport maps provider → `provider`, origin → `departureLocation`,
 *   destination → `arrivalLocation`, `departureAt`/`arrivalAt` →
 *   `departureTime`/`arrivalTime`; the mode is never invented, so it stays
 *   absent. Check-in/out dates are never copied for accommodation.
 * - `sourceUrl` is appended only because it already passed `isSafeHttpUrl` in
 *   the provider result normalizer and is re-validated by the plan normalizer.
 * - Everything else (price, duration, cancellation, limitations, retrieval
 *   timestamp) is documented in notes, never copied into unsupported fields.
 */
export function mapDiscoveryResultToHandoffPlan(
  result: TripProviderResult,
  now: string,
  planId: string
): DiscoveryHandoffPlan | null {
  return mapDiscoveryResultToHandoffPlanWith(result, now, planId, {
    provenanceKind: 'mock-discovery',
    provenanceNote: DISCOVERY_HANDOFF_PROVENANCE_NOTE,
    readinessNote: DISCOVERY_HANDOFF_READINESS_NOTE,
    provenanceLabels: DISCOVERY_HANDOFF_PROVENANCE_LABELS,
    priceLabel: 'Sample price',
  });
}

/**
 * Maps a user-selected normalized discovery result from a REAL external
 * provider into a draft planning record (STEP 41). Identical boundary rules to
 * the simulated handoff, but the typed provenance is `external-provider` and
 * the notes state the record came from live provider discovery without ever
 * claiming verification, guaranteed availability, or a booking.
 */
export function mapDiscoveryResultToExternalProviderHandoffPlan(
  result: TripProviderResult,
  now: string,
  planId: string
): DiscoveryHandoffPlan | null {
  return mapDiscoveryResultToHandoffPlanWith(result, now, planId, {
    provenanceKind: 'external-provider',
    provenanceNote: EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_NOTE,
    readinessNote: EXTERNAL_DISCOVERY_HANDOFF_READINESS_NOTE,
    provenanceLabels: EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_LABELS,
    priceLabel: 'Quote price',
  });
}

interface DiscoveryHandoffPlanOptions {
  provenanceKind: 'mock-discovery' | 'external-provider';
  provenanceNote: string;
  readinessNote: string;
  provenanceLabels: ReadonlyArray<string>;
  priceLabel: string;
}

/**
 * Shared handoff core. Guards staleness/category first, then maps only the
 * supported fields into a draft transport or accommodation plan with the
 * requested provenance vocabulary. Unknown keys are never copied; primary
 * selection is never assigned.
 */
function mapDiscoveryResultToHandoffPlanWith(
  result: TripProviderResult,
  now: string,
  planId: string,
  options: DiscoveryHandoffPlanOptions
): DiscoveryHandoffPlan | null {
  if (getDiscoveryHandoffProblem(result, now) !== null) return null;

  const notes = buildDiscoveryHandoffNotes(result, options.provenanceLabels, options.priceLabel);

  if (result.category === 'transport') {
    const mapped: TripTransportPlan = {
      id: planId,
      provider: result.providerName,
      departureLocation: result.origin,
      arrivalLocation: result.destination,
      departureTime: result.departureAt,
      arrivalTime: result.arrivalAt,
      referenceNumber: result.resultId,
      sourceUrl: result.sourceUrl,
      notes,
      provenance: { kind: options.provenanceKind, note: options.provenanceNote },
      lifecycleState: DISCOVERY_HANDOFF_LIFECYCLE_STATE,
      readiness: { state: 'planned', note: options.readinessNote },
    };
    const plan = normalizeTripTransportPlan(mapped);
    return plan === null ? null : { kind: 'transport', plan };
  }

  const mapped: TripAccommodationPlan = {
    id: planId,
    name: result.title,
    location: result.destination,
    roomDetails: result.summary,
    referenceNumber: result.resultId,
    sourceUrl: result.sourceUrl,
    notes,
    provenance: { kind: options.provenanceKind, note: options.provenanceNote },
    lifecycleState: DISCOVERY_HANDOFF_LIFECYCLE_STATE,
    readiness: { state: 'planned', note: options.readinessNote },
  };
  const accommodationPlan = normalizeTripAccommodationPlan(mapped);
  return accommodationPlan === null ? null : { kind: 'accommodation', plan: accommodationPlan };
}

function buildDiscoveryHandoffNotes(
  result: TripProviderResult,
  provenanceLabels: ReadonlyArray<string>,
  priceLabel: string
): string {
  const lines: string[] = [...provenanceLabels];
  lines.push(`Provider: ${result.providerName}`);
  lines.push(`Provider id: ${result.providerId}`);
  lines.push(`Result id: ${result.resultId}`);
  lines.push(`Retrieved at: ${result.retrievedAt}`);
  if (result.price !== undefined) {
    lines.push(`${priceLabel}: ${result.price.amount.toFixed(2)} ${result.price.currency}`);
  }
  if (result.durationMinutes !== undefined) {
    lines.push(`Duration (minutes): ${result.durationMinutes}`);
  }
  if (result.cancellationPolicy !== undefined) {
    lines.push(`Cancellation policy: ${result.cancellationPolicy}`);
  }
  for (const limitation of result.limitations ?? []) {
    lines.push(`Limitation: ${limitation}`);
  }
  for (const meta of result.metadata ?? []) {
    lines.push(`Provider metadata: ${meta.key} — ${meta.value}`);
  }
  return lines.join('\n');
}
