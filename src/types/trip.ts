/**
 * Trip Workspace domain vocabulary.
 *
 * These types describe a user-owned trip planning workspace: the container that is
 * intended to eventually hold AI itineraries, destinations, collaborators, and (in
 * future steps) bookable components. They form an architectural boundary for future
 * behavior such as booking, payments, live availability, trip execution, and
 * notifications — nothing in this module performs any of those behaviors.
 *
 * The module is intentionally pure:
 * - no React, no Firebase, no Zustand
 * - no `any` and no generic `Record<string, any>` escape hatches
 * - string IDs and ISO date/date-time strings at the domain boundary
 * - external provider identifiers are optional and isolated from the core Trip identity
 *
 * A TripWorkspace carries an optional `TripItinerarySnapshot`: the editable,
 * persistent copy of an AI-generated `Itinerary` (see `src/types/travel.ts`).
 * The snapshot reuses the existing nested travel types it needs instead of
 * duplicating them, but intentionally excludes runtime-only itinerary fields
 * (`id`, `createdAt`, `saved`) — those belong to the ephemeral itinerary the
 * workspace was promoted from. Mapping is provided by a pure function in
 * `src/domain/trips/tripModel.ts`, not in this module.
 */

import type { BudgetLevel, DayPlan, HotelOption, TransportOption } from './travel';

export type TripId = string;

export type TripStatus = 'draft' | 'planning' | 'ready' | 'in_progress' | 'completed' | 'cancelled';

export type TripVisibility = 'private' | 'shared';

/**
 * Execution-readiness / verification state for a planning item (STEP 17).
 *
 * A vocabulary-level marker that separates *planned* data from user-entered
 * confirmation details and (future) external verification. It never implies an
 * actual booking exists: the application has no booking integration, so only
 * user-authored information is representable by the UI today, and the
 * `externally-verified` state is reserved for a future provider source that the
 * application itself never produces.
 */
export type TripExecutionReadinessState =
  'planned' | 'user-confirmed' | 'externally-verified' | 'cancelled' | 'unknown';

/**
 * Optional execution-readiness metadata attached to an explicitly-entered plan
 * (STEP 17). `state` is required; `note` is an optional plain-text explanation.
 *
 * It carries no timestamps (the project has no item-level timestamp convention)
 * and no duplicated reference label — plan-level reference labels already exist
 * (`referenceNumber`) and readiness merely classifies them. A user-entered
 * reference is never proof of a booking, and a state here never claims
 * availability, pricing, or provider confirmation by itself.
 */
export interface TripExecutionReadiness {
  state: TripExecutionReadinessState;
  note?: string;
}

/**
 * Provenance vocabulary for an explicitly-entered planning reference (STEP 23).
 *
 * A source-of-record label that makes it clear where a transport or
 * accommodation plan came from: the owner typed it (`manual`), an AI assistant
 * drafted it (`ai-generated`), it was imported from the in-app simulated
 * discovery (`mock-discovery`), or a future external provider supplied it
 * (`external-provider` — reserved, never produced by this application today).
 *
 * Provenance is a label about *where the record came from*; it never implies
 * availability, pricing, verification, or a booking. `mock-discovery` is always
 * simulated sample data, `external-provider` is never treated as verified, and
 * `external-provider` is never selectable by user input. An absent provenance
 * on a legacy record stays absent — it is valid and never gets an inferred
 * label. No timestamps or freshness data live here.
 */
export type TripPlanProvenanceKind =
  'manual' | 'ai-generated' | 'mock-discovery' | 'external-provider';

/**
 * Optional provenance metadata attached to an explicitly-entered plan
 * (STEP 23). `kind` is required; `note` is an optional concise plain-text
 * source note (bounded, trimmed, dropped when empty). It never duplicates the
 * plan's free-form `notes` field and never claims a booking, live availability,
 * verification, or provider confirmation.
 */
export interface TripPlanProvenance {
  kind: TripPlanProvenanceKind;
  note?: string;
}

/**
 * Lifecycle vocabulary for an explicitly-entered planning reference (STEP 24).
 *
 * A user-managed state that records what the owner intends to do with a
 * transport or accommodation plan: use it (`active`), revisit it before
 * relying on it (`needs-review`), supersede it with another user-selected
 * reference (`replaced`), or keep it without using it (`archived`).
 *
 * Lifecycle is strictly user-controlled and strictly separate from provenance
 * (where the record came from) and execution readiness (how far along the
 * plan is). It never implies availability, pricing, verification, a booking,
 * a replacement record, or a provider claim, and it is never derived from
 * dates, timestamps, or external freshness. An absent lifecycle on a legacy
 * record stays absent — it is treated as `active` at read time only and is
 * never written back merely by being viewed.
 */
export type TripPlanLifecycleState = 'active' | 'needs-review' | 'replaced' | 'archived';

export type TripMemberRole = 'owner' | 'editor' | 'viewer';

/** Inclusive trip start/end. Both fields are ISO date strings (`YYYY-MM-DD`). */
export interface TripDateRange {
  startDate: string;
  endDate: string;
}

export interface TripDestination {
  id: string;
  name: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * A bounded geographic coordinate pair for a reference item. Both coordinates
 * are required and geographically bounded when present; one is never carried
 * without the other, and values are never guessed or fabricated.
 */
export interface TripReferenceLocation {
  latitude: number;
  longitude: number;
}

/**
 * Common fields for references to future bookable trip components.
 * These are identifiers and display metadata only — they carry no live
 * availability, guaranteed pricing, or booking state. External provider
 * identifiers are optional and kept apart from the core Trip identity.
 */
export interface TripReferenceBase {
  id: string;
  title: string;
  /** Safe external link (http/https only), validated before any persisted write (STEP 14). */
  url?: string;
  /** 1-based day of the trip this item belongs to, when known. */
  dayNumber?: number;
  /** External provider name (e.g. an airline) — optional, not part of Trip identity. */
  provider?: string;
  /** The provider's own identifier for this item — optional. */
  providerId?: string;
  /** Human-readable estimate, consistent with existing Itinerary plain-text costs. */
  estimatedCost?: string;
  /**
   * Provider-neutral geographic location for this item, when known (STEP 46).
   * Both coordinates are required and geographically bounded when present; an
   * invalid or incomplete pair rejects the owning reference.
   */
  location?: TripReferenceLocation;
  /** Human-readable street address for this item, when known (STEP 46). */
  address?: string;
  /** Normalized category/type label (e.g. "hotel", "restaurant"), provider-neutral (STEP 46). */
  category?: string;
}

export interface TripActivityReference extends TripReferenceBase {
  kind: 'activity';
}

export interface TripTransportReference extends TripReferenceBase {
  kind: 'transport';
  /** Transport mode, semantically aligned with `TransportOption.mode` in travel.ts. */
  mode?: string;
  /**
   * Route origin coordinate pair (STEP 48). Present only for a routing-provider
   * reference; both coordinates are required and geographically bounded when
   * present. Independent of `location`, which remains place-oriented.
   */
  routeOrigin?: TripReferenceLocation;
  /**
   * Route destination coordinate pair (STEP 48). Present only for a
   * routing-provider reference; both coordinates are required and geographically
   * bounded when present.
   */
  routeDestination?: TripReferenceLocation;
  /**
   * Authoritative route distance in meters (STEP 48). Preserved verbatim from
   * the provider-neutral route contract; finite, non-negative, bounded.
   */
  distanceMeters?: number;
  /**
   * Authoritative route duration in seconds (STEP 48). Preserved verbatim from
   * the provider-neutral route contract; finite, non-negative, bounded.
   */
  durationSeconds?: number;
  /**
   * Optional provider-owned encoded polyline (STEP 48), bounded; a route plan
   * estimate, never a navigation instruction.
   */
  encodedPolyline?: string;
  /**
   * Optional provider-advisory warnings for this route (STEP 48), each trimmed
   * and bounded. Carried so walking/bicycling Beta-mode honesty survives the
   * handoff; absent when the provider returned none.
   */
  routeWarnings?: string[];
}

export interface TripAccommodationReference extends TripReferenceBase {
  kind: 'accommodation';
  /** ISO date strings tied to the stay, when known. */
  checkInDate?: string;
  checkOutDate?: string;
}

/**
 * Bounded budget summary for the structured planning view. It is a projection
 * of the canonical itinerary snapshot fields (`budgetLevel`,
 * `estimatedTotalCost`, `sightseeingCost`) — never persisted as a separate
 * copy.
 */
export interface TripPlanningBudget {
  /** One of the shared `BudgetLevel` values, when known. */
  level?: BudgetLevel;
  /** Human-readable total, consistent with existing Itinerary plain-text costs. */
  estimatedTotalCost?: string;
  /** Human-readable sightseeing cost estimate from the itinerary. */
  sightseeingCost?: string;
}

/**
 * An explicitly-entered transport plan (STEP 16).
 *
 * User-entered planning data for the trip's own tracking — semantically separate
 * from the AI-itinerary `TransportOption` and from identifier-only
 * `TripTransportReference`. It is never a booking: no availability, pricing,
 * payment, or confirmation state lives here. Every field is optional except the
 * stable `id` that the UI and merge logic use to address a record.
 */
export interface TripTransportPlan {
  /** Stable, unique per-plan id assigned by the editor (required). */
  id: string;
  /** Transport mode, semantically aligned with `TransportOption.mode`. */
  mode?: string;
  /** Provider name (e.g. an airline or rail company). */
  provider?: string;
  departureLocation?: string;
  arrivalLocation?: string;
  /** ISO date or ISO date-time string. */
  departureTime?: string;
  /** ISO date or ISO date-time string. */
  arrivalTime?: string;
  /** Provider/booking reference number, identifier only. */
  referenceNumber?: string;
  /**
   * Safe external link (http/https only), validated before any persisted write
   * (STEP 22). Mirrors `TripReferenceBase.url` and is the only field an
   * imported discovery quote may carry through to the plan.
   */
  sourceUrl?: string;
  /**
   * Optional provenance label (STEP 23): where this record came from
   * (manual / ai-generated / mock-discovery / external-provider). A label only
   * — never a booking, availability, verification, or price claim. Absent on
   * legacy plans stays absent.
   */
  provenance?: TripPlanProvenance;
  /** Free-form notes. */
  notes?: string;
  /**
   * Optional lifecycle metadata (STEP 24): the user-managed planning state for
   * this reference (active / needs-review / replaced / archived). Strictly
   * user-controlled and strictly separate from provenance and readiness —
   * never a booking, availability, verification, or price claim, and never
   * derived from dates or timestamps. Absent on legacy plans stays absent
   * (treated as `active` at read time only).
   */
  lifecycleState?: TripPlanLifecycleState;
  /**
   * Optional execution-readiness metadata (STEP 17): classifies this plan as
   * planned / user-confirmed / externally-verified / cancelled / unknown. It is
   * never a booking and never claims provider confirmation by itself.
   */
  readiness?: TripExecutionReadiness;
}

/**
 * An explicitly-entered accommodation plan (STEP 16).
 *
 * User-entered planning data (property, stay window, room details) — semantically
 * separate from the AI-itinerary `HotelOption` and identifier-only
 * `TripAccommodationReference`. It is never a booking: no reservation,
 * availability, pricing, or confirmation state lives here. Every field is
 * optional except the stable `id`.
 */
export interface TripAccommodationPlan {
  /** Stable, unique per-plan id assigned by the editor (required). */
  id: string;
  /** Property name. */
  name?: string;
  location?: string;
  /** ISO date string. */
  checkInDate?: string;
  /** ISO date string, on or after `checkInDate`. */
  checkOutDate?: string;
  /** Room details (room type, board, etc.). */
  roomDetails?: string;
  /** Provider/booking reference number, identifier only. */
  referenceNumber?: string;
  /**
   * Safe external link (http/https only), validated before any persisted write
   * (STEP 22). Mirrors `TripReferenceBase.url` and is the only field an
   * imported discovery quote may carry through to the plan.
   */
  sourceUrl?: string;
  /**
   * Optional provenance label (STEP 23): where this record came from
   * (manual / ai-generated / mock-discovery / external-provider). A label only
   * — never a booking, availability, verification, or price claim. Absent on
   * legacy plans stays absent.
   */
  provenance?: TripPlanProvenance;
  /** Free-form notes. */
  notes?: string;
  /**
   * Optional lifecycle metadata (STEP 24): the user-managed planning state for
   * this reference (active / needs-review / replaced / archived). Strictly
   * user-controlled and strictly separate from provenance and readiness —
   * never a booking, availability, verification, or price claim, and never
   * derived from dates or timestamps. Absent on legacy plans stays absent
   * (treated as `active` at read time only).
   */
  lifecycleState?: TripPlanLifecycleState;
  /**
   * Optional execution-readiness metadata (STEP 17): classifies this plan as
   * planned / user-confirmed / externally-verified / cancelled / unknown. It is
   * never a booking and never claims provider confirmation by itself.
   */
  readiness?: TripExecutionReadiness;
}

/** Per-category budget allocation amounts. All values are canonical numbers. */
export interface TripBudgetAllocations {
  transport?: number;
  accommodation?: number;
  food?: number;
  activities?: number;
  other?: number;
}

/**
 * An explicitly-entered numeric budget plan (STEP 16).
 *
 * All amounts are canonical numbers — never formatted currency strings.
 * Partial plans are valid: any field may be omitted; an empty object simply
 * means "no specific figures yet". This is user-entered planning data only.
 */
export interface TripBudgetPlan {
  /** ISO 4217-style currency code, e.g. "USD" (letters only, 1–8 chars). */
  currency?: string;
  /** Total planned spend as a number. */
  totalPlanned?: number;
  /** Per-category allocations as numbers. */
  allocations?: TripBudgetAllocations;
  /** Free-form notes. */
  notes?: string;
}

/**
 * A bookable-component reference in the structured planning block. Identifier
 * and display metadata only: it carries no live availability, guaranteed
 * pricing, booking, or confirmation state.
 */
export type TripPlanningReference =
  TripActivityReference | TripTransportReference | TripAccommodationReference;

/**
 * Editable planning sections (STEP 14, expanded in STEP 16 and STEP 18).
 *
 * Every key is optional: a present key means "persist this section on the
 * workspace", while an absent key leaves the persisted section untouched.
 * `dateRange: null` explicitly clears the trip dates;
 * `budgetPlan: null` explicitly clears the budget plan (STEP 16).
 *
 * The nine editable sections — dates, destinations, days, notes, references,
 * transport plans, accommodation plans, the budget plan (STEP 16), and the
 * execution-preparation checklist `tasks` (STEP 18) — are the only shape here.
 * Identity/lifecycle fields never pass through this type.
 */
export type TripPlanningUpdateKey =
  | 'dateRange'
  | 'destinations'
  | 'days'
  | 'notes'
  | 'references'
  | 'transportPlans'
  | 'accommodationPlans'
  | 'budgetPlan'
  | 'tasks'
  | 'primaryTransportPlanId'
  | 'primaryAccommodationPlanId';

export interface TripPlanningUpdate {
  /** Inclusive trip dates, or `null` to clear them. */
  dateRange?: TripDateRange | null;
  /** Destination records in planning order; stable ids required. */
  destinations?: TripDestination[];
  /** Daily itinerary sections (`TripItinerarySnapshot.dayPlans`). */
  days?: DayPlan[];
  /** Free-form planning notes (`TripItinerarySnapshot.notes`). */
  notes?: string[];
  /** External, identifier-only bookable-component references. */
  references?: TripPlanningReference[];
  /**
   * Explicitly-entered transport plans (STEP 16). User-entered planning data,
   * never a booking: it carries no live availability, pricing, or confirmation.
   */
  transportPlans?: TripTransportPlan[];
  /**
   * Explicitly-entered accommodation plans (STEP 16). User-entered planning
   * data, never a booking: it carries no reservation or availability state.
   */
  accommodationPlans?: TripAccommodationPlan[];
  /**
   * Explicit numeric budget plan, or `null` to clear it (STEP 16). All amounts
   * are canonical numbers — never formatted currency strings.
   */
  budgetPlan?: TripBudgetPlan | null;
  /**
   * Explicitly-entered execution-preparation checklist tasks (STEP 18), or
   * `null` to clear the whole checklist. Entirely user-authored,
   * provider-independent planning/tracking data: it never books, pays,
   * verifies, or monitors anything, and no external system ever creates or
   * mutates it. An absent key leaves the persisted checklist untouched.
   */
  tasks?: TripChecklistItem[] | null;
  /**
   * Explicitly chosen primary transport plan id (STEP 26). Absent means "no
   * explicit primary selected". Must refer to a plan in the same section;
   * only effective-lifecycle `active` plans are eligible for assignment.
   * No inference, no automatic persistence, no booking semantics.
   */
  primaryTransportPlanId?: string | null;
  /**
   * Explicitly chosen primary accommodation plan id (STEP 26). Absent means
   * "no explicit primary selected". Must refer to a plan in the same
   * section; only effective-lifecycle `active` plans are eligible for
   * assignment. No inference, no automatic persistence, no booking semantics.
   */
  primaryAccommodationPlanId?: string | null;
}

/**
 * Execution-preparation checklist vocabulary (STEP 18).
 *
 * A task status is a user-controlled progress label only — `completed` means
 * the owner marked it complete, never that an external system confirmed it.
 * There is deliberately no "cancelled" or provider-influenced status here:
 * `skipped` covers a task that no longer applies, and no status ever implies a
 * booking, payment, or live verification.
 */
export type TripTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Execution-preparation task categories (STEP 18). These are planning
 * categories for the owner's own tracking — they are not booking steps, and no
 * sensitive identity/payment/credential data belongs in a task.
 */
export type TripTaskCategory =
  | 'transport-preparation'
  | 'accommodation-preparation'
  | 'budget-preparation'
  | 'document-preparation'
  | 'itinerary-preparation'
  | 'general';

/**
 * The optional planning section a task relates to (STEP 18). A reference is a
 * free-form link to already-persisted planning data: it is never cross-checked
 * against the referenced section at the domain boundary, so a task pointing at
 * a section or plan that was later deleted never breaks the trip.
 */
export type TripTaskRelatedSection = 'transport' | 'accommodation' | 'budget' | 'itinerary';

/**
 * One execution-preparation checklist task (STEP 18).
 *
 * User-authored, provider-independent planning/tracking data — never a booking,
 * never external verification, never a live obligation. Field semantics:
 * - `id` is the stable, unique per-trip task id assigned by the editor.
 * - `category` and `title` are required; every other field is optional.
 * - `status` is required and defaults to `pending` for newly added tasks.
 * - `dueDate` is an ISO calendar date (`YYYY-MM-DD`) when known.
 * - `relatedSection`/`relatedPlanId` optionally point at planning data; they
 *   are never existence-validated, so invalid references cannot break the trip.
 * - There is no per-item `createdAt`/`updatedAt`: the project has no
 *   item-level timestamp convention (consistent with STEP 16/17 plan records).
 */
export interface TripChecklistItem {
  /** Stable, unique per-trip task id assigned by the editor (required). */
  id: string;
  /** One of the six documented preparation categories (required). */
  category: TripTaskCategory;
  /** Short, non-empty task title (required, max 120 characters). */
  title: string;
  /** Optional longer task description (max 500 characters). */
  description?: string;
  /** User-controlled progress label (required). */
  status: TripTaskStatus;
  /** Optional ISO calendar date (`YYYY-MM-DD`). */
  dueDate?: string;
  /** Optional plain-text note (max 500 characters). */
  note?: string;
  /** Optional planning section this task relates to. */
  relatedSection?: TripTaskRelatedSection;
  /** Optional stable plan/section id this task relates to. */
  relatedPlanId?: string;
}

/**
 * Provider-independent verification state of a planned reference or future
 * booking record (STEP 19). Domain-only: it is intentionally **not** a persisted
 * vocabulary — the app has no provider-backed producer, so nothing in the
 * persisted trip document ever carries this state.
 *
 * The seven states are deliberately fine-grained so that a user-entered
 * reference, a user-confirmed plan, manually reviewed information, external
 * verification, and a provider-confirmed booking are never confused:
 * - `user-entered` — the owner typed the reference in; it is not a proof.
 * - `user-confirmed` — the owner reviewed and confirmed their own information.
 * - `manually-reviewed` — the owner manually checked the information (e.g. a
 *   webpage or document). Still not live or provider confirmation.
 * - `externally-verified` — confirmed from an external source by a future
 *   provider-backed producer; never producible by user input.
 * - `provider-confirmed` — the provider confirmed a booking; never producible
 *   by user input.
 * - `cancelled` — cancelled (owner-marked today, producer-marked in the future).
 * - `unknown` — no state known or the information is unavailable.
 */
export type TripVerificationState =
  | 'user-entered'
  | 'user-confirmed'
  | 'manually-reviewed'
  | 'externally-verified'
  | 'provider-confirmed'
  | 'cancelled'
  | 'unknown';

/**
 * Evidence source kinds for a `TripVerificationEvidence` (STEP 19). They
 * classify where information came from without exposing any sensitive detail.
 * `provider-system` / `provider-communication` are reserved for the future
 * provider-backed producer; `user-provided-document` / `public-webpage` /
 * `manual-review` describe the owner's own sources.
 */
export type TripEvidenceSourceKind =
  | 'user-provided-document'
  | 'public-webpage'
  | 'provider-communication'
  | 'provider-system'
  | 'manual-review'
  | 'other';

/**
 * Minimal, provider-independent verification-evidence record (STEP 19).
 * Domain-only — never persisted, never sent to the AI, and never used as proof
 * of a booking. Every reference value is treated as plain user-entered text.
 *
 * Safety boundaries:
 * - `sourceUrl` appears only when it passes the project's existing safe
 *   HTTP/HTTPS validation (`isSafeHttpUrl`).
 * - Timestamps are ISO date-time strings and only meaningful when an actual
 *   verification or manual review happened.
 * - No sensitive personal data, payment details, passport/identity documents,
 *   credentials, raw provider payloads, or unnecessary user identifiers belong
 *   anywhere in this model.
 */
export interface TripVerificationEvidence {
  /** Stable, unique evidence record id (required). */
  id: string;
  /** Verification state this evidence documents (required). */
  state: TripVerificationState;
  /** How the information was obtained (required). */
  sourceKind: TripEvidenceSourceKind;
  /** Optional stable id of the related planning item or execution record. */
  relatedRecordId?: string;
  /** Optional short human-readable label for the source. */
  sourceLabel?: string;
  /** Safe HTTP/HTTPS source URL, only when valid. */
  sourceUrl?: string;
  /** User-provided reference text — a label, never a proof. */
  referenceValue?: string;
  /** Optional ISO date-time of the actual (external) verification. */
  verifiedAt?: string;
  /** Optional ISO date-time of the human/manual review. */
  humanReviewedAt?: string;
  /** Optional plain-text note. */
  notes?: string;
  /** Optional ISO date-time after which the evidence is stale. */
  expiresAt?: string;
}

/**
 * Future booking categories supported by the (draft-only) execution-record
 * contracts (STEP 19). No booking behavior exists today.
 */
export type TripBookingCategory = 'transport' | 'accommodation' | 'activity' | 'other';

/**
 * The persistent, editable snapshot of an AI-generated `Itinerary` stored on a
 * TripWorkspace.
 *
 * This intentionally reuses the existing nested travel types (`DayPlan`,
 * `Activity`, `TransportOption`, `HotelOption`, `BudgetLevel`) rather than
 * duplicating them, but it is its own type so the Trip domain can add Trip-owned
 * fields over time without changing the ephemeral itinerary vocabulary. It
 * carries no booking, payment, availability, or execution state.
 *
 * Only domain-pure values are allowed here (plain strings, numbers, and nested
 * JSON-safe structures) so the snapshot validates and serializes at the
 * persistence boundary without a Firestore/React/Zustand dependency.
 */
export interface TripItinerarySnapshot {
  destination: string;
  country: string;
  durationDays: number;
  budgetLevel: BudgetLevel;
  travelStyle: string;
  interests: string[];
  /** Editable trip overview. */
  summary: string;
  estimatedTotalCost: string;
  bestTimeToVisit: string;
  transport?: TransportOption[];
  hotels?: HotelOption[];
  sightseeingCost?: string;
  /** Optional free-form planning notes beyond the editable `summary`. */
  notes?: string[];
  /** Optional external, identifier-only references (STEP 13). */
  references?: TripPlanningReference[];
  /**
   * Optional explicitly-entered transport plans (STEP 16). User-entered
   * planning data only — never a booking.
   */
  transportPlans?: TripTransportPlan[];
  /**
   * Optional explicitly-entered accommodation plans (STEP 16). User-entered
   * planning data only — never a booking.
   */
  accommodationPlans?: TripAccommodationPlan[];
  /**
   * Optional numeric budget plan (STEP 16). User-entered planning data only.
   */
  budgetPlan?: TripBudgetPlan;
  /**
   * Optional execution-preparation checklist (STEP 18). Entirely user-authored,
   * provider-independent tracking data — never a booking and never touched by
   * any AI or external system.
   */
  tasks?: TripChecklistItem[];
  /**
   * Explicitly chosen primary transport plan id (STEP 26). Absent means "no
   * explicit primary selected". Stored in the itinerary snapshot so it
   * persists; never inferred from plans and never auto-assigned.
   */
  primaryTransportPlanId?: string;
  /**
   * Explicitly chosen primary accommodation plan id (STEP 26). Absent means
   * "no explicit primary selected". Stored in the itinerary snapshot so it
   * persists; never inferred from plans and never auto-assigned.
   */
  primaryAccommodationPlanId?: string;
  dayPlans: DayPlan[];
}

/**
 * The persistent trip planning shell the future travel agency will work from.
 *
 * `destinations` are display destinations, not a full booking manifest; references
 * to bookable components (activities, transport, accommodation) are modeled
 * separately and remain optional for now. `memberCount` is derived data maintained
 * by the (future) collaboration layer; no member list is stored here yet.
 *
 * `itinerary` is the optional editable itinerary snapshot promoted into the
 * workspace (absent on hand-created drafts). Booking, payments, live
 * availability, and execution monitoring are intentionally not modeled yet.
 */
export interface TripWorkspace {
  id: TripId;
  ownerId: string;
  title: string;
  status: TripStatus;
  visibility: TripVisibility;
  dateRange?: TripDateRange;
  destinations: TripDestination[];
  memberCount: number;
  /** Optional editable snapshot of the itinerary that created this workspace. */
  itinerary?: TripItinerarySnapshot;
  /** ISO date-time string of creation. */
  createdAt: string;
  /** ISO date-time string of last mutation. */
  updatedAt: string;
}

/**
 * The structured, typed planning surface for a Trip Workspace (STEP 13).
 *
 * This is a Firebase-independent derived/validation model over the canonical
 * persisted fields — it is never persisted as a copy. Field provenance:
 *
 *   dates          ← `TripWorkspace.dateRange`
 *   destinations   ← `TripWorkspace.destinations` (array order = stop order)
 *   days           ← `TripItinerarySnapshot.dayPlans`
 *   transportation ← `TripItinerarySnapshot.transport`
 *   accommodation  ← `TripItinerarySnapshot.hotels`
 *   transportPlans ← `TripItinerarySnapshot.transportPlans` (STEP 16)
 *   accommodationPlans ← `TripItinerarySnapshot.accommodationPlans` (STEP 16)
 *   budgetPlan     ← `TripItinerarySnapshot.budgetPlan` (STEP 16)
 *   budget         ← `TripItinerarySnapshot` (budgetLevel/estimatedTotalCost/sightseeingCost)
 *   notes          ← `TripItinerarySnapshot.notes`
 *   references     ← `TripItinerarySnapshot.references`
 *   primaryTransportPlanId ← `TripItinerarySnapshot.primaryTransportPlanId` (STEP 26)
 *   primaryAccommodationPlanId ← `TripItinerarySnapshot.primaryAccommodationPlanId` (STEP 26)
 *
 * `buildTripPlanningData` (in `src/domain/trips/tripPlanning.ts`) produces the
 * projection; `normalizeTripPlanningData` validates arbitrary payloads of this
 * shape and never throws. No booking, payment, availability, or execution
 * fields live here.
 */
export interface TripPlanningData {
  /** Inclusive trip start/end when the workspace has a valid range. */
  dates?: TripDateRange;
  /** Destination records in planning order (stable ids required). */
  destinations: TripDestination[];
  /** Daily itinerary sections; each `DayPlan.dayNumber` is a stable id. */
  days: DayPlan[];
  /** Transportation plans (canonical: `TripItinerarySnapshot.transport`). */
  transportation: TransportOption[];
  /** Accommodation details (canonical: `TripItinerarySnapshot.hotels`). */
  accommodation: HotelOption[];
  /** Explicitly-entered transport plans (canonical: `itinerary.transportPlans`). */
  transportPlans: TripTransportPlan[];
  /** Explicitly-entered accommodation plans (canonical: `itinerary.accommodationPlans`). */
  accommodationPlans: TripAccommodationPlan[];
  /** Explicit numeric budget plan (canonical: `itinerary.budgetPlan`). */
  budgetPlan?: TripBudgetPlan;
  /** Budget summary when the workspace has a persisted itinerary. */
  budget?: TripPlanningBudget;
  /** Free-form planning notes beyond the editable overview (`summary`). */
  notes: string[];
  /** External, identifier-only bookable-component references. */
  references: TripPlanningReference[];
  /**
   * Explicitly chosen primary transport plan id (STEP 26). Absent means no
   * explicit selection. Referenced plan must exist in `transportPlans` and
   * be effective-lifecycle `active` to be valid.
   */
  primaryTransportPlanId?: string;
  /**
   * Explicitly chosen primary accommodation plan id (STEP 26). Absent means
   * no explicit selection. Referenced plan must exist in
   * `accommodationPlans` and be effective-lifecycle `active` to be valid.
   */
  primaryAccommodationPlanId?: string;
}

/**
 * AI-assisted planning request (STEP 15).
 *
 * The minimal context needed to draft a planning proposal: the current
 * structured planning projection (which carries no owner ids, document ids,
 * credentials, or private metadata) plus the user's instruction and optional
 * bounded constraints. The AI layer receives exactly this and nothing more —
 * no account data, tokens, or unrelated Firestore fields.
 */
export interface TripPlanningRequest {
  /** Current structured planning state (editable + read-only context). */
  currentPlanning: TripPlanningData;
  /** Free-form user instruction describing the desired planning change. */
  instruction: string;
  /** Optional bounded constraints already modeled by the application. */
  constraints?: string[];
}

/**
 * AI-assisted planning proposal (STEP 15).
 *
 * Produced by the AI planning service and strictly validated through
 * `normalizeTripPlanningProposal()` before the UI presents it. The structured
 * `update` is a `TripPlanningUpdate` — it never carries booking, payment,
 * provider, availability, execution, lifecycle, ownership, or metadata fields.
 * An AI proposal is never persisted directly: the user must approve it and
 * save through the existing `updateTripPlanning()` boundary.
 */
export interface TripPlanningProposal {
  /** Concise human-readable explanation of the proposed change. */
  explanation: string;
  /** Risks or review-required notes the model surfaced. */
  warnings?: string[];
  /** Non-blocking assumptions the model made while drafting. */
  assumptions?: string[];
  /** The validated structured editing update (see `TripPlanningUpdate`). */
  update: TripPlanningUpdate;
}
