# VoyageAI — Dependency Rules

Practical rules for future development. Each rule is marked as either:

- **CURRENT** — a rule that new code must already satisfy today, or
- **TARGET** — a discipline that future migration phases should move toward
  (not enforced yet, but should steer new work).

The goal is to keep external providers behind services and to keep the test suite
deterministic and offline.

---

## Routing & Composition

- **[CURRENT]** The URL is the single source of truth for the active view. `src/routes.ts`
  owns the typed URL↔view mapping (`VIEW_PATH`, `pathToView`, `viewToPath`) and is pure —
  no React, no services, no Firebase imports.
- **[CURRENT]** Route definitions live at the composition layer (`src/AppRoutes.tsx`,
  mounted by `main.tsx` inside `BrowserRouter`), not inside `App` or components.
- **[CURRENT]** `react-router-dom` imports are restricted to the composition layer
  (`main.tsx`, `AppRoutes.tsx`), the pure mapping in `src/routes.ts` (types only), and
  navigation hooks in `App`/`Navbar`. Services and Firebase modules must never import
  `react-router-dom` or `zustand`.
- **[CURRENT]** The store is a UI compatibility layer only: `AppRoutes` syncs the URL to
  `uiStore.activeView` in one direction with an equality guard (no navigation loops, no
  two sources of truth). Nothing writes the store except that sync + `resetUiState`.
- **[CURRENT]** `/` and unknown paths redirect to `/explore`; back/forward and refresh must
  resolve to the same view (Firebase Hosting rewrites `**` → `/index.html` — the SPA
  fallback must stay in `firebase.json`).
- **[CURRENT]** No persistence middleware is added to the store for navigation state.

## UI Layer

- **[CURRENT]** Components focus on rendering and user interaction. Keep business
  orchestration out of components when it can live in `App` or an application module.
- **[CURRENT]** Components must not import from `firebase/*` directly (verified by a
  dependency-boundary test). Any Firebase access must happen through a service.
- **[CURRENT]** Components must not call Nominatim, Wikipedia, Wikimedia, Gemini, or any
  future travel provider directly. They call application/service interfaces instead
  (`aiAgent.*`, `dataConnect.*`, `authService.*`, `geolocation.*`, `placeImages.*`).
- **[CURRENT]** New external integrations must be added as services, not called from
  components.
- **[TARGET]** Long-term, components should receive data and callbacks via props from a
  thin orchestration layer instead of reaching into services directly.

## UI State Stores

- **[CURRENT]** Global UI state (e.g., active view) belongs in Zustand stores under
  `src/stores/` and is read with narrow selectors inside components/hooks only. The active
  view itself is mirrored from the URL by the routing layer rather than set by components;
  components navigate (`.navigate(...)`) instead of calling `setActiveView`.
- **[CURRENT]** Stores must not contain domain data (places, users, bookmarks,
  itineraries), AI results, service instances, or derived render-state.
- **[CURRENT]** Stores use no middleware and no persistence for now — a page refresh must
  restore the same defaults as before the store was introduced.
- **[CURRENT]** `zustand` hooks appear only in components/custom hooks. Services and
  Firebase modules must not import `zustand`, and the store module must not import React
  or any service (no circular dependencies). The dependency-boundary test must stay valid.

## Application Orchestration

- **[CURRENT]** `App.tsx` may coordinate UI and services for now — this is an accepted
  baseline for this application.
- **[CURRENT]** New business workflows should not increase `App.tsx` complexity
  unnecessarily.
- **[TARGET]** New domain workflows (and anything beyond simple pass-through) should be
  placed in dedicated application modules when introduced, rather than growing `App.tsx`.

## Service Layer

- **[CURRENT]** Services own external integration details (Firebase, Gemini, Nominatim,
  Wikipedia/Commons, future providers).
- **[CURRENT]** Services expose typed functions operating on domain types from
  `src/types/travel.ts`.
- **[CURRENT]** Services must not manipulate React state directly. They return data and
  throw errors; callers own state.
- **[CURRENT]** Services must not import or depend on UI components.
- **[TARGET]** Prefer one integration per service; move toward interfaces so a provider
  can be swapped without touching call sites.

## Domain / Data Layer

- **[CURRENT]** Domain models in `src/types/travel.ts` are the shared vocabulary. New
  domain types must be added there, not invented inside providers.
- **[CURRENT]** Untrusted JSON (Gemini, Nominatim, wiki APIs) is normalized at the service
  boundary through the guards in `src/utils/validation.ts`. Services must not `as`-cast raw
  `JSON.parse` output straight onto domain types or expose `any`.
- **[TARGET]** Domain models should not depend on Firebase-specific document shapes.
- **[TARGET]** Persistence mapping (Firestore documents ↔ domain types) should happen at
  the persistence boundary (`firestoreService`).
- **[TARGET]** External provider response formats (Gemini JSON, Nominatim JSON, Wikipedia
  API) should not leak into UI components.

## External Integrations

- **[CURRENT]** All network calls must be mockable — they must be reachable through a
  seam (`vi.stubGlobal('fetch', ...)`, module mock, or injected client) in tests.
- **[CURRENT]** No real external network calls in unit tests.
- **[CURRENT]** External API failures must be represented consistently as thrown `Error`
  objects or safe fallback values (existing pattern: friendly messages in
  `aiTravelAgent`, silent fallback in `geolocation.reverseGeocode`).
- **[CURRENT]** API keys and secrets remain in environment configuration
  (`VITE_FIREBASE_*`, `VITE_APPCHECK_DEBUG_TOKEN`, `VITE_RECAPTCHA_SITE_KEY`). Never
  commit `.env*`.
- **[TARGET]** Standardize error messages/types instead of string-matching error text.

## Trip Workspace (persistence & routing)

- **[CURRENT]** Trip domain types live in `src/types/trip.ts` and must not import React,
  Firebase, Zustand, services, or components; no `any` and no `Record<string, any>`
  escape hatches. String IDs and ISO date/date-time strings are the domain boundary.
- **[CURRENT]** Pure Trip utilities live in `src/domain/trips/tripModel.ts`: deterministic,
  side-effect free, no network, no clock (any time value must be passed in). Keep helpers
  small and avoid unnecessary abstraction. `toTripItinerarySnapshot` deep-copies nested
  arrays and must not mutate its input.
- **[CURRENT]** The Trip Workspace presentational boundary
  (`src/components/trips/TripWorkspace.tsx`) stays a shell — no fetching, no global state,
  no router, no services. It renders the persisted itinerary snapshot when present with
  friendly fallbacks; it never edits data.
- **[CURRENT]** Document↔domain mapping for `trips/{tripId}` lives in
  `src/services/tripSerialization.ts` and is **SDK-free** (no `firebase/*` imports,
  duck-typed `toDate()` for timestamps). It owns `TripDocument`, `tripToFirestore`,
  `tripFromFirestore`, `serializeTripUpdates` (values + deletions), and
  `isValidStorageId`.
- **[CURRENT]** Stored itinerary validation lives in
  `src/services/tripSerializationModel.ts`, also **SDK-free**: `isTripItinerarySnapshot`
  (type guard) and `normalizeTripItinerarySnapshot` (whitelists declared top-level keys,
  shape-checks nested day plans / activities / transport / hotels, returns `null` on
  malformed input). `tripSerialization` delegates all itinerary validation/normalization
  here; components and `tripModel` never import it.
- **[CURRENT]** The emitted `TripWorkspace.itinerary` is a `TripItinerarySnapshot` from
  `src/types/trip.ts` (destination, country, durationDays, budgetLevel, travelStyle,
  interests, summary, estimatedTotalCost, bestTimeToVisit, optional transport/hotels/
  sightseeingCost, dayPlans). It stores what was generated — not provider/booking
  references — and drops runtime-only fields (`id`/`createdAt`/`saved`).
- **[CURRENT]** Persistence for trips goes through `src/services/tripService.ts` only. It
  is the sole new `firebase/firestore` caller for the trips collection; components must
  never call the Firestore SDK for trips (the dependency-boundary test pattern keeps UI
  off `firebase/*`). `createTrip`/`updateTrip`/`deleteTrip` must stay owner-scoped and
  `getTrip` must surface permission errors without leaking raw SDK text. `updateTrip`
  validates an `itinerary` patch (set or cleared as `undefined`) before any write.
  `listTripsForOwner` filters with `where('ownerId','==',uid)` (the caller derives `uid`
  from the authenticated user, never from the URL), skips malformed docs, orders by
  `updatedAt` desc client-side (avoiding a composite-index requirement), and maps errors
  through `mapFirestoreError` — it never returns another owner's trips.
- **[CURRENT]** Ownership is enforced in `firestore.rules` for `trips/{tripId}`: create
  requires `signedIn()` + `ownerId == request.auth.uid` + valid shape; read/list are admin
  or owner; update/delete are owner-only and updates must not change `ownerId`. Rule
  writers must keep the `isTripItineraryShape` guard (bounded top-level contract: map,
  non-empty destination string, summary string, positive durationDays, list of day plans) —
  deep nested content is trusted to client-side normalization because all trips are
  owner-written. Do not weaken these rules to simplify tests (there is no rules harness —
  document that limitation instead).
- **[CURRENT]** `react-router-dom` may be used by the trip page component
  (`TripWorkspacePage` uses `useParams`/`Link`), but services and Firebase modules must
  never import the router.
- **[CURRENT]** The routed page (`TripWorkspacePage`) owns the load lifecycle (loading /
  not-found / unauthorized / error / success). Keep it out of `App` and avoid synchronous
  `setState` inside effects. Keep editing trivial (title + itinerary overview), confined
  to the page, non-destructive (Save enabled only when dirty and title non-empty), and
  never optimistic (no auto-save, no reload/prompt hooks). Rendering of loaded trip edits
  goes through `tripService.updateTrip`, not through Firestore directly.
- **[CURRENT]** Trip lifecycle actions are constrained by the pure domain policy in
  `tripModel.ts`: `TRIP_STATUS_TRANSITIONS` (explicit matrix; forward single-step progress
  plus cancellation from active stages) drives `canTransitionTripStatus` /
  `getAllowedTripStatusTransitions` / `isEditableTripStatus` (terminal = `completed` /
  `cancelled`), and `normalizeTripTitle` trims and rejects empty titles — never silently
  truncate user input. The UI must offer only the current status + allowed successors,
  the service must re-check transitions against the persisted current status, and
  arbitrary status strings must be rejected. If the matrix ever changes, update the policy
  and its tests first — the UI and service just consume it.
- **[CURRENT]** Lifecycle writes go through narrow, owner-verified service wrappers on
  `tripService`: `renameTrip(tripId, ownerId, title)`, `updateTripStatus(tripId, ownerId,
status)`, and `deleteTrip(tripId, ownerId?)`. Callers derive `ownerId` from the session —
  the URL `tripId` is an identifier, never an authorization source — and services verify
  ownership (and existence) against the persisted document before any write. Services must
  not import React/Router/Zustand, must stay UI-`any`-free, and must keep raw SDK text out
  of user messages.
- **[CURRENT]** Deleting a trip is a high-risk, irreversible action: the UI requires an
  explicit two-step confirmation (arm a `confirming` state; the service call happens only
  on the explicit confirm), there is no single-click accidental delete, success navigates
  to `/trips` and failure stays on the page with a safe error. No optimistic list
  mutation and no new collections for the delete flow.
- **[CURRENT]** The owner list (`MyTripsPage` at `/trips`, `MyTripsView` presentational) is
  a read-only backlog standing outside `App`. The page subscribes to `authService`,
  derives `ownerId` from the signed-in user, and fetches via
  `tripService.listTripsForOwner` (re-fetching when the user changes; no fetch when signed
  out). It renders safe, friendly messages (`TripPermissionError` → access message,
  anything else → generic retry message) — never raw Firestore error text — and keeps a
  loading guard while an auth transition is in flight. The view is presentational: no
  fetching, no router, no services; row taps call `onOpenTrip(id)` so the page can route
  to the workspace. It duplicates its own small status-style map rather than importing it
  from `TripWorkspace.tsx` (keeps the presentational shells independently testable).
- **[CURRENT]** Keep the core Trip identity free of external-provider specifics: provider
  ids are optional fields on bookable references, never part of `TripWorkspace` identity.
- **[CURRENT]** No booking, payment, live availability, collaboration, execution
  monitoring, or notification behavior in the Trip layer until a dedicated future step.
- **[CURRENT (STEP 13)]** `TripPlanningData` is a **derived, read-only projection** — it is
  rebuilt from the single canonical trip document on read and is **never persisted**, so it
  adds no collection, migration, index, or Firestore rules change (STEP 12 semantics stay
  untouched). The only new persisted surface is the optional `notes?: string[]` and
  `references?: TripPlanningReference[]` on the itinerary snapshot, both validated at the
  serialization boundary so malformed values still fail the snapshot guard.
- **[CURRENT (STEP 13)]** The projection module `src/domain/trips/tripPlanning.ts` is pure
  and deterministic like `tripModel`: no Firebase, React, Router, Zustand, or `any`;
  `buildTripPlanningData` never mutates its input; `normalizeTripPlanningData` returns
  `null` on malformed payloads rather than throwing.
- **[CURRENT (STEP 13)]** No new workflow behavior was added — read-only structured
  planning and identifier-only references only; no booking/execution/payment state. The
  presentational `TripWorkspaceView` still imports no service/router/state.
- **[CURRENT (STEP 14)]** Only the first five structured planning sections are editable —
  trip dates, destinations, daily itinerary (days + activities), planning notes, and
  external references — submitted through **one explicit** save (no autosave, no optimistic
  persistence). [STEP 16]: transport plans, accommodation plans, and the budget plan become
  editable as explicit STEP 16 sections through the same single save; there is still no
  booking, payment, availability, or execution behavior.
- **[CURRENT (STEP 14)]** Editing flows only through the pure, SDK-free domain module
  `src/domain/trips/tripPlanningEdit.ts` (normalize / apply / dirty / problem helpers +
  `PlanningDraft`/`stripTripId`), which shares `tripPlanning`'s validation guards. The UI
  component and the page never hand-patch the persisted document shape and never bypass
  `tripService.updateTripPlanning`. Dependency direction stays one-way: UI → domain and
  UI/services → domain; the new view (`PlanningEditor`) does not know the service layer.
- **[CURRENT (STEP 14)]** `tripService.updateTripPlanning(tripId, ownerId, update)` is the
  single narrowed write path: it awaits `assertTripId`/`assertOwnerId`, normalizes the
  payload (rejecting unknown keys, malformed sections, and duplicate ids **before** any
  Firestore query), ownership-checks the loaded document, rejects itinerary-section edits on
  a legacy no-itinerary workspace, applies the update in the domain, and patches only the
  changed canonical fields through the existing whitelisted `updateTrip` (ownership guard,
  `updatedAt` refresh, and error mapping unchanged). `firestore.rules` needs no change —
  rules validate top-level canonical fields while deep planning content stays
  client-validated (documented limitation).
- **[CURRENT (STEP 14)]** Reference urls are security-checked at both boundaries: the pure
  `isSafeHttpUrl` gate (only bounded `http(s)` links with no whitespace/control characters;
  `javascript:`/`data:`/`file:` rejected) is enforced by `isTripPlanningReference`, which
  `tripSerializationModel` reuses, so read, write, and update serialization all reject
  unsafe urls. Cleared `url`/`dayNumber` keys are physically dropped from the payload (never
  `undefined`-valued), and locally generated ids (`dst-…`/`ref-…`) are UI-only — the domain
  stays deterministic.
- **[CURRENT (STEP 15)]** AI planning suggestions are **draft-only by construction**: the
  AI service `src/services/aiPlanningService.ts` imports no `firebase/firestore` and has no
  reference to `tripService`, so it cannot persist anything. Persistence happens only when a
  human clicks the existing explicit **Save planning** button, which calls
  `tripService.updateTripPlanning` with the merged draft. Generation must never trigger a
  write, auto-save, booking, notification, or collection creation.
- **[CURRENT (STEP 15)]** The bounded AI model lives in the pure, SDK-free
  `src/domain/trips/tripPlanningProposal.ts`: `normalizeTripPlanningRequest` whitelists
  `currentPlanning`/`instruction`/`constraints` and bounds the instruction at
  `MAX_PLANNING_INSTRUCTION_LENGTH = 1000`; `normalizeTripPlanningProposal` whitelists
  `explanation`/`warnings`/`assumptions`/`update` and runs the proposed `update` through the
  **same** `normalizeTripPlanningUpdate` used by manual editing — and `ALLOWED_PROPOSAL_UPDATE_KEYS`
  restricts the proposal to the five AI-owned sections (dates, destinations, days, notes,
  references). So malformed JSON, unknown keys, duplicate ids, unsafe reference urls, and any
  STEP 16 transport/accommodation/budget, lifecycle, owner, or metadata edit are rejected at
  the exact same strict boundary. The module must stay Firebase/React/Router-free and
  deterministic.
- **[CURRENT (STEP 15)]** Prompt/context privacy: only the structured `currentPlanning` and
  the user's instruction (plus optional `constraints`) are ever sent to the model. Never
  send auth tokens, owner ids, document ids, bookmarks, activity, or other private metadata
  in the AI context.
- **[CURRENT (STEP 15)]** The prompt must instruct the model to preserve existing
  destination/day/reference ids verbatim (no renumbering), to warn when dates change, and to
  output JSON only. The response is parsed as `unknown` and normalized; raw provider text
  must never reach the UI — every failure surfaces as a safe pre-baked `AiPlanningError`
  message (typed, no leaked SDK/provider detail).
- **[CURRENT (STEP 15)]** The UI flow keeps human approval mandatory: a proposal is shown as
  a preview in `PlanningEditor` (explanation, warnings, assumptions, current → proposed
  diff) and is merged into the local draft only on explicit **Apply**; **Discard** restores
  the previous draft. The draft stays client-side until the explicit save. Merge semantics
  are `{ ...draft, ...proposal.update }` — present keys override, absent keys untouched,
  `dateRange: null` still clears — without mutating inputs (`mergePlanningProposalIntoDraft`).
  Stale responses must be guarded (a proposal arriving after navigating to another trip is
  dropped).
- **[CURRENT (STEP 15)]** The assistant may suggest only the STEP 14 AI-owned sections
  (dates, destinations, days, notes, references). The STEP 16 user-editable transport plans,
  accommodation plans, and budget plan stay outside the AI proposal scope; booking, payment,
  availability, execution, and notifications remain out of the whole planning feature. No
  new collections, fields, indexes, or `firestore.rules` changes are introduced for AI
  planning.
- **[CURRENT (STEP 16)]** Transport plans, accommodation plans, and the budget plan are new
  **optional persisted itinerary-snapshot fields** (`transportPlans`, `accommodationPlans`,
  `budgetPlan`), validated by `tripSerializationModel` (unique plan ids, malformed values
  fail the snapshot guard) and written **only** through the existing single narrow path
  `tripService.updateTripPlanning`. An empty/`null` `budgetPlan` collapses to an absent
  budget (`collapseEmptyBudgetPlan`); `budgetPlan: null` clears a stored one. The STEP 16
  section helpers (`updateTripTransportPlans` / `updateTripAccommodationPlans` /
  `updateTripBudgetPlan`) apply caller-provided values raw (validate-then-apply) — unknown-key
  isolation is enforced at the `normalizeTripPlanningUpdate` boundary, never inside the
  editors or the UI. No new collections, migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 16)]** The AI proposal scope stays locked to the five STEP 14 AI-owned
  sections via `ALLOWED_PROPOSAL_UPDATE_KEYS`; the STEP 16 user-editable transport /
  accommodation / budget sections can be persisted only by an explicit human save, so AI
  output can never introduce plan data. This keeps the AI draft-only invariant intact even
  though those sections are now editable by the user.
- **[CURRENT (STEP 17)]** Per-plan execution readiness is **optional planning metadata**, not
  booking state: each `TripTransportPlan` / `TripAccommodationPlan` may carry
  `readiness: { state, note? }` with `state` ∈ `planned | user-confirmed |
externally-verified | cancelled | unknown`. Writing `booked`/`provider-confirmed` as a
  user state is rejected — that semantic is represented as `externally-verified`, which
  `canUserSetReadinessState` forbids for users, so the UI can never claim a booking.
  Validation is centralized in the pure, SDK-free `executionReadiness` module
  (`src/domain/trips/executionReadiness.ts`); `tripPlanning` plan normalizers delegate to it
  and reject a whole plan on malformed readiness. Its `TripExecutionRecord*` contracts are
  **DRAFT-ONLY** — no module imports them, no provider/verification API is introduced.
- **[CURRENT (STEP 17)]** Readiness rides the existing snapshot fields
  (`transportPlans` / `accommodationPlans`) through the single `updateTripPlanning` write
  path; `tripSerializationModel` accepts optional labels and rejects booking-claim /
  malformed states on read. It is rendered read-only in `PlanningEditor` (never user-edited
  this step). No new collections, indexes, migrations, `firestore.rules` changes, booking
  APIs, or external-verification calls.
- **[CURRENT (STEP 18)]** The execution-preparation checklist is **user-authored planning
  data only**: tasks live as the optional `tasks` key on `TripItinerarySnapshot` (ninth
  editable section) and are typed `TripChecklistItem[] | null` on `TripPlanningUpdate`
  (`null` clears the whole checklist; `tasks: []` collapses to an absent checklist at apply).
  Field semantics: required `id`/`category`/`title`/`status`; optional
  `description`/`dueDate` (real ISO `YYYY-MM-DD`)/`note`/`relatedSection`/`relatedPlanId`;
  statuses are `pending | in_progress | completed | skipped` and are pure owner progress
  labels — never external confirmation, and no task ever claims a booking, payment,
  cancellation, or live verification. No per-item timestamps exist.
- **[CURRENT (STEP 18)]** Checklist validation is centralized in the pure, SDK-free
  `executionChecklist` module (`normalizeTripChecklistItem` — strict whole-record rebuild,
  optional strings trimmed and dropped when empty, max lengths 120/500/500/200 enforced by
  rejection, absent-vs-null maps to absent) plus `hasUniqueTaskIds`. A malformed task or
  duplicate task id rejects the whole update / the whole snapshot — never partial apply.
  `tripPlanningEdit` owns `updateTripTasks` (throws `TypeError` on invalid non-null input;
  no-op on a legacy no-itinerary workspace) and `collapseTripTasks` for dirty-checking.
- **[CURRENT (STEP 18)]** Tasks persist only through the single `updateTripPlanning` write
  path; `tripSerializationModel` validates each task at the snapshot boundary. The AI
  proposal scope stays locked to the five STEP 14 sections via
  `ALLOWED_PROPOSAL_UPDATE_KEYS` — the AI can never create, edit, complete, or skip a task.
  No new collections, migrations, indexes, or `firestore.rules` changes.
- **[CURRENT (STEP 19)]** The external-verification foundation is **domain-only and
  unconsumed**: the pure, SDK-free module `src/domain/trips/verificationState.ts` owns the
  seven-state vocabulary `TripVerificationState` (`user-entered | user-confirmed |
manually-reviewed | externally-verified | provider-confirmed | cancelled | unknown`), the
  evidence model `TripVerificationEvidence` (`TripEvidenceSourceKind` sources, a
  safe-HTTP-only `url` when present, plain-text reference values), and the controlled
  transition gates (`canTransitionTripVerificationState` /
  `getAllowedUserVerificationTransitions` / `getTripVerificationTransitionProblem`). No module
  imports it and nothing in the app persists, sends to the AI, or renders any verification
  state or evidence as a control. No new collections, indexes, migrations, or
  `firestore.rules` changes.
- **[CURRENT (STEP 19)]** Provider-owned states are reserved by construction:
  `externally-verified` and `provider-confirmed` are produced only by a future provider-backed
  producer — `canUserTransitionTripVerificationState` returns `false` when the current state
  is producer-only, `getAllowedUserVerificationTransitions` returns `[]`, and
  `getTripVerificationTransitionProblem` reports the producer-ownership message for
  producer-origin transitions. User input (`normalizeTripVerificationEvidence`) uses only
  user-entered source kinds and can never mint those states, so a user-entered reference never
  claims a booking or live verification.
- **[CURRENT (STEP 19)]** The verification evidence normalizer reuses the project's
  `isSafeHttpUrl` gate (unsafe urls reject the record), treats every `referenceValue` as plain
  user text, and bounds lengths (`MAX_EVIDENCE_ID_LENGTH` / `MAX_EVIDENCE_REFERENCE_VALUE_LENGTH`
  = 200). It never throws, never mutates input, and rejects unknown kinds/keys/state values.
  The checklist vocabulary (`pending | in_progress | completed | skipped`) is never a
  verification state, and the STEP 17 `TripExecutionReadinessState` remains the only persisted
  planning label.
- **[CURRENT (STEP 19)]** STEP 19 refines the DRAFT-ONLY execution-record contracts in
  `executionReadiness`: `TripExecutionRecord` is a category-based union (`TripBookingCategory`)
  carrying `state: TripVerificationState` and `verification: TripVerificationEvidence[]`; the
  earlier `TripBookingReferenceRecord` is removed. These contracts remain compile-time only —
  no module imports them and no provider/verification API, booking, payment, or execution
  behavior is introduced. `ALLOWED_PROPOSAL_UPDATE_KEYS` is untouched, so the AI can never
  suggest any verification or booking data.
- **[CURRENT (STEP 20)]** Provider and execution integration is **architecture-only and
  unconsumed**: exactly eight pure, SDK-free contract modules exist under
  `src/domain/providers/` — `providerCapabilities`, `providerResults`, `providerAdapter`,
  `verificationProducer`, `bookingLifecycle`, `executionOperations`,
  `executionApprovalAudit` (STEP 20), plus `discoveryInput` (STEP 21) — and none of the seven
  STEP 20 modules is imported by any module outside `src/domain/providers/`. `discoveryInput` is
  consumed only by the read-only mock discovery service (STEP 21). They declare the
  surface a future provider adapter and verification producer will implement: capability
  ids/statuses, the normalized `TripProviderResult` shape, the `ProviderAdapterProfile`
  boundary, the producer proof-of-evidence boundary, the booking-lifecycle transition table,
  the `ProviderExecutionResult<T>` envelope builders, the approval/audit vocabulary, and the
  discovery query boundary. Nothing executes: no provider SDK, credential, API key, `fetch`,
  network call, booking, payment, ticket, verification, or cancellation exists, and
  `canBookingTransitionAutomatically` always returns `false`.
- **[CURRENT (STEP 20)]** Booking lifecycle transitions are explicit-matrix-only. A booking can
  only reach `provider_confirmed` from `submitted` or `provider_pending` **and** with a
  producer-backed verification record (`externally-verified`/`provider-confirmed` current
  verification state) via `canProviderMarkBookingConfirmed`. The steps `submitted →
provider_pending → provider_confirmed` are required; `canTransitionBookingLifecycleState`
  rejects any other success path. Only `provider_confirmed` is a success state; no checklist
  completion, readiness label, or user-entered reference can ever masquerade as a booking.
- **[CURRENT (STEP 20)]** Execution operations are enveloped and honest. `ProviderExecutionResult<T>`
  envelopes name their operation, provider, performed-at timestamp, and retryability. Success
  carries normalized app-contract `data` only (never raw provider payloads); failure carries
  a bounded `ProviderSafeError` (category + ≤500-char message — no credentials, payment
  details, tokens, or provider internals) and never carries `data`. Read-only operations
  (`search`, `verify`, `retrieve-booking-status`) may run without approval; mutating
  operations (`prepare-booking`, `submit-booking`, `cancel-booking`) require
  `executionApprovalAudit`'s `approved` state via `canExecutionProceedOnApprovalState`.
  Nothing auto-executes, auto-retries, or schedules work.
- **[CURRENT (STEP 20)]** Producer verification stays provable. `verificationProducer`
  accepts only 5 outcomes (`verified | not-verified | cancelled | unavailable | error`);
  only `verified → externally-verified` and `cancelled → cancelled` mint a state claim.
  Evidence minted by a producer must carry a provider source kind
  (`provider-system`/`provider-communication`), a `verifiedAt` timestamp, and a bounded
  reference value or `isSafeHttpUrl`-checked URL — the same requirement STEP 19 documented
  in `describeProducerEvidenceRequirement`. A stale result (past `expiresAt`) or one with no
  usable timestamps can never mint a state. No user input and no AI output can mint
  producer-owned states.
- **[CURRENT (STEP 20)]** STEP 20 adds **no persistence, no Firestore surfaces, and no
  UI/control of any kind.** Nothing from `src/domain/providers/` is persisted, sent to the
  AI, or rendered; no collections, fields, indexes, migrations, or `firestore.rules`
  changes were made; `ALLOWED_PROPOSAL_UPDATE_KEYS` stays locked to the five AI-owned
  sections; the persisted STEP 13–18 snapshot fields are untouched. All STEP-20 contracts are
  exercised only by their tests, which run offline against pure functions.
- **[CURRENT (STEP 21)]** Read-only external discovery is **deterministic mock-only and
  strictly read-only.** The only discovery front-end is `DiscoveryPanel` (presentational)
  wired by `TripWorkspacePage`; the only entry point is
  `src/services/mockDiscovery/mockDiscoveryService.ts` `discoverTripOptions(raw, now)`, which
  normalizes through the pure `discoveryInput` boundary, selects a mock adapter
  (Transport / Accommodation), checks the STEP 20 `search-*` capability guard, and maps the
  normalized execution envelope to a stable outcome (`success` / `empty` / `unsupported` /
  `provider-failure` / `invalid-input` / `unexpected-failure`). Mock adapters execute ONLY the
  read-only `search` operation; `verify-reference` is `temporarily-unavailable` and booking /
  cancellation capabilities are `unsupported`.
- **[CURRENT (STEP 21)]** Discovery never touches the trip. The mock discovery service and
  panel never import or call `tripService`, `firestoreService`, `dataConnectService`,
  `aiPlanningService`, or the checklists; a search never calls `updateTripPlanning`,
  `updateTrip`, `updateTripStatus`, or `deleteTrip`, never writes a readiness, verification,
  execution, or checklist record, and never persists — results are transient display state
  owned by `TripWorkspacePage` (cleared on trip change, presented with a working Clear).
- **[CURRENT (STEP 21)]** Mock results are honest and labeled. Every result carries the
  disclaimer "Simulated sample data - not live availability or a booking.", explicit provider
  and source identity, retrieval timestamps, `expiresAt`/freshness (with STEP 20 recency
  warnings when stale), and limitations. No "live availability", real price, booking
  reference, or provider that exists in reality is ever claimed; sentinel destinations
  (`MOCK-EMPTY-RESULTS` / `MOCK-PROVIDER-FAILURE`) exercise empty and failure paths.
- **[CURRENT (STEP 21)]** STEP 21 adds **no network, SDK, credential, booking, payment,
  verification, cancellation, or persistence.** The mock layer performs zero `fetch` calls,
  holds no API keys or env vars, and its guardrail (`dependencyBoundary.test.ts`) asserts the
  mock discovery modules and the provider domain stay pure/deterministic (no clock reads, no
  Firebase, no UI, no service imports, no booking/payment vocabulary). The AI proposal scope
  (`ALLOWED_PROPOSAL_UPDATE_KEYS`) stays locked to the five AI-owned sections — STEP 21
  boundary tests reject every discovery key in an AI proposal update — and the persisted
  snapshot fields and `firestore.rules` are untouched.
- **[CURRENT (STEP 23)]** Planning-reference **provenance is typed, singular, and
  cell-owner-gated.** The ONLY provenance vocabulary for explicitly-entered transport and
  accommodation plans lives in the pure `src/domain/trips/planningProvenance.ts`
  (`TripPlanProvenanceKind`: `manual` / `ai-generated` / `mock-discovery` /
  `external-provider`). The shared `tripPlanning` plan normalizers validate any present
  `provenance` field and **reject the whole record** on an unknown kind, non-string note, or
  over-long (> 500) note. Legacy plans without provenance stay valid and keep no provenance
  (a missing value is never inferred, a null is dropped at the domain boundary).
- **[CURRENT (STEP 23)]** Provenance is **read-only labeling, not a permission.** No plan
  field implies a state machine, capability, booking, or execution right, and
  `external-provider` never claims anything about a vendor: the label reads "External provider
  reference — not verified." Ordinary plan-field edits never re-type a kind; the two
  provenance-affecting gestures are the explicit **Mark as manually entered** action
  (available only on `mock-discovery` plans — the sole kind-changing gesture) and the bounded
  "Source note" input, rendered **only** when provenance exists, so viewing/focusing/opening a
  legacy plan never creates provenance and clearing the note keeps the kind (the note is
  trimmed/dropped at the domain boundary; a raw in-progress string on a NEW plan is
  automatically typed `manual` via the manual default). Newly added plans default to the
  honest `manual` label.
- **[CURRENT (STEP 23)]** STEP 23 adds **no booking, payment, verification, freshness,
  provider-integration, or auto-execution claims, and no new surface.** `planningProvenance.ts`
  imports nothing from services/React/Zustand/Firebase, reads no clock, and never writes;
  `domain/trips` stays a pure dependency layer, `domain/discovery/` remains exactly
  `handoff.ts` (it stamps `mock-discovery` provenance by construction), and the persisted
  snapshot gains only the optional `provenance` field, which `tripSerializationModel`
  round-trips. No collections, indexes, migrations, or `firestore.rules` changes; the AI
  proposal scope stays locked to the five AI-owned sections.
- **[CURRENT (STEP 24)]** Planning-reference **lifecycle is typed, singular, and strictly
  user-controlled.** The ONLY lifecycle vocabulary for explicitly-entered transport and
  accommodation plans lives in the pure `src/domain/trips/planningLifecycle.ts`
  (`TripPlanLifecycleState`: `active` / `needs-review` / `replaced` / `archived`). The shared
  `tripPlanning` plan normalizers validate any present `lifecycleState` field and **reject the
  whole record** on an unknown value. Legacy plans without a lifecycle stay valid and carry
  none — they are treated as `active` at read time only (`getEffectiveTripPlanLifecycleState`),
  a value that is computed for display and **never written back** merely by viewing, focusing,
  or editing. Nothing here transitions automatically: no staleness detection, no date math, no
  timers, no clock, no external freshness source, and no code path that writes a lifecycle
  value on its own.
- **[CURRENT (STEP 24)]** Lifecycle is **a decision about intent, not a claim about data, and
  replace/archive are not deletions.** `active`, `needs-review`, `replaced`, and `archived`
  describe what the owner intends to do with a reference; they never imply availability,
  pricing, verification, a booking, a provider claim, or automatic expiry. Wording stays
  honest — "Needs review" means "user-marked for review", never "expired" / "outdated" /
  "unavailable" / "price changed". Marking a plan `replaced` or `archived` keeps the plan's
  data, provenance, `sourceUrl`, and readiness intact, invents no replacement record, deletes
  nothing, and is reversible (Restore returns an archived plan to `active`).
- **[CURRENT (STEP 24)]** STEP 24 adds **no booking, payment, verification, freshness,
  provider-integration, or auto-execution claims, and no new surface.** `planningLifecycle.ts`
  imports nothing from services/React/Zustand/Firebase, reads no clock, and never writes;
  `domain/discovery/` remains exactly `handoff.ts` (it stamps `lifecycleState: 'active'` by
  construction via `DISCOVERY_HANDOFF_LIFECYCLE_STATE`), the persisted snapshot gains only the
  optional `lifecycleState` field round-tripped by `tripSerializationModel`, and the AI
  proposal scope stays locked to the five AI-owned sections. No collections, indexes,
  migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 25)]** The active-vs-inactive **planning-reference distinction is projected
  consistently on every read-only surface** through one pure, dedicated module —
  `src/domain/trips/planningReferenceProjection.ts`. It owns the only read-time grouping:
  legacy plans (no lifecycle) resolve to `active` at read time (labeled "Legacy reference —
  treated as active" and **never written back**), `active`/`needs-review` plans form the
  primary display (needs-review visibly marked), and `replaced`/`archived` plans form an
  always-visible "Replaced / archived" subgroup in original order
  (`partitionPlanningReferences`, `countPlanningReferences`, `getPlanningReferenceSummary`,
  `getPlanningReferenceDisplayLabel`, and the single-state predicates). Order is preserved,
  arrays are never mutated, and lifecycle is never inferred from provenance, readiness, dates,
  texts, or URLs.
- **[CURRENT (STEP 25)]** The STEP 25 projection is **read-only by construction and adds no new
  surface.** `planningReferenceProjection.ts` imports only `types/trip` and `planningLifecycle`,
  reads no clock/network (no React, Firebase, Router, Zustand, fetch, `process.env`), never
  writes to a plan, never persists, never imports edit/provenance/readiness vocabulary, and
  carries no booking/payment/verification/freshness/staleness vocabulary. The read-only
  `TripWorkspaceView` renders the plan references (lifecycle chip + separate provenance chip,
  no editing controls); `PlanningEditor` remains the ONLY lifecycle-editing surface. The AI
  proposal scope stays locked to the five AI-owned sections, and there are no collections,
  indexes, migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 26)]** The section-level **primary reference selection is strictly
  user-controlled and explicitly stored** — never auto-assigned and never inferred.
  `src/domain/trips/planningReferenceSelection.ts` is the only module that interprets
  `primaryTransportPlanId` / `primaryAccommodationPlanId` (optional fields on the itinerary
  snapshot): absence means no selection (the first plan is never promoted, no label claims an
  automatic primary), eligibility is purely lifecycle-based (effective-active only, legacy
  read-time default included; needs-review/replaced/archived are never assignable), and a stored
  selection that no longer names an eligible plan resolves to a concise, non-blocking
  "needs attention" state (`selected-plan-missing` / `selected-plan-inactive`) with an honest
  `reason` — the stored id is preserved as-is and never rewritten or repaired. The vocabulary
  (`isPrimaryPlanId`, `normalizePrimaryPlanId`, `isPlanEligibleAsPrimary`,
  `resolvePrimarySelection`, `partitionPlanningReferencesWithPrimary`,
  `isPrimarySelectionAttentionState`, `getPrimarySelectionStatusLabel`) is pure, order-stable,
  and non-mutating.
- **[CURRENT (STEP 26)]** The STEP 26 selection module adds **no new surface, drafting rules,
  or claims.** `planningReferenceSelection.ts` imports only `types/trip`, `planningLifecycle`,
  and `planningReferenceProjection`; it reads no clock/network, never auto-selects or
  auto-promotes, never writes a primary id, never persists, and has no
  booking/payment/verification vocabulary. `tripPlanning` trims present ids at normalization
  (malformed/empty ids reject), `tripPlanningEdit` applies or clears them only when an itinerary
  exists (`null` = explicit clear; absent = untouched; 42/true/{} reject) with a matching dirty
  check and a clear problem message, and `tripSerializationModel` round-trips a present trimmed
  id. `PlanningEditor` offers the choice (eligibility-limited select + status chip, staged in the
  local draft, persisted only on the explicit "Save planning") and the read-only `TripWorkspaceView`
  renders the valid primary first with a "Primary reference" chip; neither surface ever
  fake-books or validates availability. The AI proposal ownership boundary — `ALLOWED_PROPOSAL_UPDATE_KEYS`
  still lists exactly the five STEP 14 keys — and the discovery handoff are unchanged (proposals
  containing the new keys are rejected as unknown; the handoff never assigns a primary id). No
  new collections, indexes, migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 27)]** The primary-assignment **conflict model is read-only guidance, never a
  repair.** `src/domain/trips/planningReferenceConflict.ts` is the only module that owns the
  concise conflict wording for a stored primary selection: `none | valid | missing | inactive`
  status, the attention predicate, the shared "Primary assignment needs attention" headline, the
  plain-english conflict detail (names the stored id and the user's explicit options — select
  another active reference or clear the assignment, plus restore when the plan still exists), and
  the lifecycle-transition predicates. It reads the stored primary ids for reporting but never
  writes, clears, repairs, promotes, or falls back; it never auto-reassigns, never auto-promotes,
  never stages a lifecycle change, and never resolves the selection on the owner's behalf.
- **[CURRENT (STEP 27)]** The STEP 27 conflict module adds **no new surface, drafting rules, or
  claims.** `planningReferenceConflict.ts` imports only `types/trip`, `planningLifecycle`,
  `planningReferenceProjection`, and `planningReferenceSelection`; it reads no clock/network
  (no React, Firebase, Router, Zustand, fetch, `process.env`), never persists (no
  `updateTripPlanning`, no Firestore calls), never imports edit/provenance/readiness vocabulary,
  and carries no booking/payment/verification/freshness/staleness vocabulary. `PlanningEditor`
  renders the guidance paragraph + "primary is a planning designation, not a booking" disclaimer
  legend, the green "Primary reference" / amber "Primary assignment needs attention" card chips,
  and a warning/restore hint when a lifecycle transition would create or resolve a conflict; the
  read-only `TripWorkspaceView` marks the referenced-but-inactive plan row with the amber
  attention chip in whichever lifecycle group it appears and adds a muted "No primary reference
  selected." caption when plans exist without an explicit selection. The AI proposal boundary
  (`ALLOWED_PROPOSAL_UPDATE_KEYS` still the five STEP 14 keys — a proposal can never stage a plan
  lifecycle state or a primary selection) and the handoff save path (a payload never carries a
  primary key, so importing can never create, change, or clear a selection) are unchanged. No new
  collections, indexes, migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 28)]** The explicit primary-assignment **conflict-resolution vocabulary is
  transient draft feedback, never persisted.** `src/domain/trips/planningReferenceResolution.ts`
  is the only module that owns the explicit user-action classification: the four-decision
  vocabulary (`unresolved | selected-another | cleared | restored-selected`), the
  `classifyPrimaryResolutionDecision` classifier (input: prior status + prior selected id + user
  action + post-action plan list; invalid/inconsistent actions resolve as `unresolved`), honest
  user-visible labels and descriptions that never claim booking, payment, verification, or
  reservation confirmation, and pure predicates (`isPrimaryConflictUnresolved`,
  `isPrimaryResolutionDecisionCompatible`, etc.). No resolution record is ever stored: the
  primary ID + lifecycle state are the persisted truth, and legacy trips without a resolution
  record remain valid and complete. Nothing here auto-resolves, auto-selects, auto-clears,
  auto-promotes, or repairs a conflict; the classification is strictly what the owner explicitly
  chose to do. No new collections, indexes, migrations, or `firestore.rules` changes.
- **[CURRENT (STEP 28)]** The STEP 28 resolution module adds **no new surface, drafting rules,
  or claims.** `planningReferenceResolution.ts` imports only the STEP 27 conflict vocabulary
  (the `PrimaryAssignmentStatus` type from `planningReferenceConflict`) and the STEP 26
  selection model (`SelectablePlan`, `isPlanEligibleAsPrimary` from `planningReferenceSelection`);
  it reads no clock/network (no React, Firebase, Router, Zustand, fetch, `process.env`), never
  persists (no `updateTripPlanning`, no Firestore calls), never imports
  editing/propersistence/provenance/readiness vocabulary, and carries no
  booking/payment/verification/freshness/staleness vocabulary. `PlanningEditor` renders
  per-section transient feedback ("Primary reference updated in this draft." /
  "Primary assignment cleared in this draft." / "Existing primary reference restored to active
  in this draft.") when the user acts, or the derived "Primary assignment remains unresolved."
  when the conflict is still open; after Save, the explicit decision label disappears and
  the read-only workspace projection (`TripWorkspaceView`) continues displaying the standard
  STEP 27 attention/valid states from the persisted data. The AI proposal boundary
  (`ALLOWED_PROPOSAL_UPDATE_KEYS` still the five STEP 14 keys — a proposal can never stage a
  resolution, lifecycle state, or primary selection) and the discovery handoff are unchanged.
  The planner-level constraints from sections 8–9 of the STEP 28 spec (no artificial hysteresis,
  no proxy-write of ids/lifecycle, no new backend endpoints, no config surface, no new
  dependencies, no new AI-proposed resolution, no weakened security rules, no commit) hold.
- **[CURRENT (STEP 29)]** The planning-reference **change history context is transient,
  derived-only, and never persists.** `src/domain/trips/planningReferenceChangeContext.ts` is the
  only module that owns how the draft's transport/accommodation planning sections differ from the
  persisted snapshot: the section-level change state machine (`unchanged | primary-selected |
primary-changed | primary-cleared | primary-restored | primary-unresolved | lifecycle-changed |
provenance-changed | source-changed | reference-added | reference-removed`), the saved-vs-draft
  comparison `comparePlanningReferenceSectionChange` + combined `buildPlanningReferenceChangeContext`
  (an **absent draft is never read as a clear** — `draft === undefined` reports no change),
  deterministic reference labels (`getTransportPlanReferenceLabel` / `getAccommodationPlanReferenceLabel`),
  and a consolidated one-liner per section. It is derived from two inputs only (persisted snapshot
  vs effective draft): there is no audit log, no history, no timestamps, no user identifiers, and no
  change record is ever persisted or written back. Nothing here selects, clears, promotes,
  restores, or repairs a primary; an unresolved draft stays unresolved and is reported honestly.
  Absence is honest: `null`/empty ids are absent on both sides, a legacy trip with no stored id is
  never reported as "cleared", an untouched legacy plan is never a lifecycle change (effective
  lifecycle is compared, never written back), and the wording never claims booking, payment,
  verification, availability, or an automatic fix. No new collections, indexes, migrations, or
  `firestore.rules` changes.
- **[CURRENT (STEP 29)]** The STEP 29 module adds **no new surface, drafting rules, or claims.**
  `planningReferenceChangeContext.ts` imports only `types/trip` (types), the STEP 24
  `planningLifecycle` label/effective-state helpers, the STEP 23 `planningProvenance` label helper,
  and the STEP 27 `planningReferenceConflict` primary-assignment status vocabulary; it reads no
  clock/network (no React, Firebase, Router, Zustand, fetch, `process.env`), never persists (no
  `updateTripPlanning`, no Firestore calls), never imports editing/projection/selection/readiness
  vocabulary, and carries no booking/payment/verification/freshness/staleness vocabulary.
  `PlanningEditor` renders one transient violet change-context line per section (aria-label, **no
  `role="status"`** — so it never collides with the STEP 22 handoff `role="status"` notice),
  suppressed when its message exactly equals the STEP 28 resolution feedback (rule-based dedup;
  both render when the messages differ), and cleared after Save via `setPlanningDraft(null)`. The
  AI proposal boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS` still the five STEP 14 keys) and the
  discovery handoff are unchanged. All STEP 22/28 planner-level constraints (no auto-repair, no
  proxy-write, no new config surface, no new dependencies, no weakened security rules, no commit)
  hold.
- **[CURRENT (STEP 22)]** The discovery-to-planning handoff is **user-controlled and
  explicit-save-only.** A simulated result can only enter the planning draft when the user
  clicks the per-result **Use as planning reference** action; the import is a pure,
  SDK-free `src/domain/discovery/handoff.ts` module (`getDiscoveryHandoffPlanId`,
  `getDiscoveryHandoffProblem`, `mapDiscoveryResultToHandoffPlan`) that converts a selected
  transport/accommodation result into a **user-entered planning reference** (deterministic
  `handoff-<resultId>` plan id, `readiness.planned`, the result's `sourceUrl`, and provenance
  `notes` = "imported from simulated discovery" + "never a booking" labels), and that
  refuses non-transport/accommodation results and expired quotes. Importing appends to the
  existing draft and persists **only** through the existing `tripService.updateTripPlanning`
  save; removing the reference from the draft deletes just the local draft line and never
  contacts any provider. Nothing is booked, reserved, priced live, verified, or executed by
  importing, and the AI proposal scope stays untouched.
- **[CURRENT (STEP 22)]** Handoff data is honest and labeled. `sourceUrl` (new optional
  `sourceUrl` field on transport/accommodation plans) is validated by the STEP 16 plan
  normalizers (`isSafeHttpUrl`-checked, trimmed, dropped when empty) and round-tripped by
  `tripSerializationModel`; the "Added “{title}” to your planning draft as a user-entered
  reference." notice is explicit that nothing imported is booked or reserved. The user may
  edit the pasted `sourceUrl` in the STEP 16 editors like any other plan field.
- **[CURRENT (STEP 22)]** STEP 22 adds **no network, SDK, credential, booking, payment,
  verification, cancellation, or persistence surface.** `handoff.ts` imports nothing from
  services/React/Zustand/Firebase, reads no clock (deterministic given `now`), calls no
  `fetch`, and never writes — its guardrail (`dependencyBoundary.test.ts`) asserts the
  `src/domain/discovery/` set is exactly that one file and stays pure. No collections,
  fields (snapshot shape gains only the optional `sourceUrl`), indexes, migrations, or
  `firestore.rules` changes; the AI proposal scope stays locked to the five AI-owned
  sections.

## Testing

- **[CURRENT]** New business logic requires focused tests (Vitest, colocated in
  `src/test/`).
- **[CURRENT]** New external integrations require mocked boundary tests; the mock lives at
  the network/module boundary.
- **[CURRENT]** Existing behavior must remain covered before migrating it.
- **[CURRENT]** Tests must never call production Firebase, Gemini, Auth, Firestore, or any
  external API. They must run offline and deterministically after `npm install`.

## Security

- **[CURRENT]** Never weaken Firestore rules to simplify development. Rules are the
  real security boundary.
- **[CURRENT]** Never expose secrets in client code unless the integration explicitly
  requires public client configuration (e.g., Firebase web config is public by design).
- **[CURRENT]** High-risk actions — payments, bookings, cancellations, or irreversible
  changes — must require explicit user approval before execution. (No such actions exist
  yet; this rule governs future additions.)

---

## Quick Reference

| Concern                        | Go through                                                                           | Never directly                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Firebase Auth                  | `authService`                                                                        | `firebase/auth` in components                                                                                   |
| Firestore                      | `firestoreService` / `dataConnect`                                                   | `firebase/firestore` in components                                                                              |
| Gemini                         | `aiAgent`; `aiPlanningService` (STEP 15 planning proposals)                          | `firebase/ai` outside `aiTravelAgent`/`aiPlanningService`                                                       |
| App Check                      | `firebase.ts`                                                                        | —                                                                                                               |
| Nominatim / geolocation        | `geolocation`                                                                        | `fetch` to Nominatim in components                                                                              |
| Wikipedia / Wikimedia          | `placeImages`                                                                        | `fetch` to Wikipedia/Commons in components                                                                      |
| Domain types                   | `src/types/travel.ts`                                                                | —                                                                                                               |
| JSON validation                | `src/utils/validation.ts`                                                            | raw `as` casts / `any` in services                                                                              |
| Global UI state                | `src/stores/uiStore.ts` (mirrored from the URL by `AppRoutes`)                       | domain data / service instances in a store                                                                      |
| Routing / active view          | `src/routes.ts` + `src/AppRoutes.tsx` (composition layer)                            | `react-router-dom` in services/transport                                                                        |
| Trip page route                | `src/components/trips/TripWorkspacePage.tsx` (`/trips/:tripId`)                      | mounting `App` / state in the presentational view                                                               |
| My Trips list route            | `src/components/trips/MyTripsPage.tsx` (`/trips`) + `MyTripsView.tsx`                | fetching in the presentational view / raw SDK errors surfaced                                                   |
| Trip domain types              | `src/types/trip.ts`                                                                  | React/Firebase/Zustand/`any` in the Trip model                                                                  |
| Trip domain utilities          | `src/domain/trips/tripModel.ts` (pure, `now` passed in)                              | network calls / clock / persistence                                                                             |
| Trip document mapping          | `src/services/tripSerialization.ts` (SDK-free)                                       | `firebase/firestore` in the mapper                                                                              |
| Trip persistence               | `src/services/tripService.ts` (owner-scoped)                                         | `firebase/firestore` in components                                                                              |
| Trip planning editing          | `src/domain/trips/tripPlanningEdit.ts` (pure, shared validation)                     | hand-patching documents / bypassing `updateTripPlanning`                                                        |
| Trip planning AI               | `aiPlanningService` (draft-only) + `tripPlanningProposal.ts` (pure)                  | writing to Firestore from AI / raw provider errors in the UI                                                    |
| Execution readiness            | `src/domain/trips/executionReadiness.ts` (pure, STEP 17)                             | claiming a booking in the UI / user-set `externally-verified`                                                   |
| Execution checklist            | `src/domain/trips/executionChecklist.ts` (pure, STEP 18)                             | AI-authored tasks / claiming a booking in the UI                                                                |
| External verification          | `src/domain/trips/verificationState.ts` (pure, STEP 19, unconsumed)                  | user-producible provider states / a user-entered reference claiming a booking                                   |
| Provider capabilities          | `src/domain/providers/providerCapabilities.ts` (pure, STEP 20)                       | naming/importing/calling any provider SDK or `fetch` to a provider                                              |
| Provider results               | `src/domain/providers/providerResults.ts` (pure, STEP 20)                            | treating a quote as a booking / persisting or AI-sending a provider result                                      |
| Provider adapter               | `src/domain/providers/providerAdapter.ts` (pure, STEP 20)                            | a provider adapter outside the adapter boundary / raw provider payloads                                         |
| Verification producer          | `src/domain/providers/verificationProducer.ts` (pure, STEP 20)                       | minting a producer state without provider evidence / user/AI producer claims                                    |
| Booking lifecycle              | `src/domain/providers/bookingLifecycle.ts` (pure, STEP 20)                           | auto-transitions / any success state other than `provider_confirmed`                                            |
| Execution envelope             | `src/domain/providers/executionOperations.ts` (pure, STEP 20)                        | raw provider shapes in `data` / sensitive text in safe errors                                                   |
| Approval & audit               | `src/domain/providers/executionApprovalAudit.ts` (pure, STEP 20)                     | running a mutation without an approved approval state / persisting audits today                                 |
| Discovery input                | `src/domain/providers/discoveryInput.ts` (pure, STEP 21)                             | accepting unknown keys / lenient dates/traveler count/currency in a query                                       |
| Mock discovery service         | `src/services/mockDiscovery/mockDiscoveryService.ts` (read-only, STEP 21)            | importing or calling `tripService`/`firestoreService`/`dataConnectService`                                      |
| Mock provider adapters         | `src/services/mockDiscovery/mock{Transport,Accommodation}Provider.ts` (STEP 21)      | executing anything but the read-only `search` operation / nondeterministic fixtures                             |
| Mock data labeling             | `mockFixtures.ts` `MOCK_RESULT_DISCLAIMER` (STEP 21)                                 | claiming live availability / real prices / booking references in the UI                                         |
| Discovery panel                | `src/components/trips/DiscoveryPanel.tsx` (presentational, STEP 21)                  | any reserve/book/pay/verify/confirm affordance or service call                                                  |
| Discovery-to-planning          | `src/domain/discovery/handoff.ts` (pure, STEP 22)                                    | importing anything but a transport/accommodation result / expired quotes / persisting on import                 |
| Handoff plan source URL        | `tripPlanning` plan normalizers + `PlanningEditor` (sourceUrl field, STEP 22)        | unsafe URLs (`javascript:` etc.) / unvalidated pasted links                                                     |
| Plan provenance                | `src/domain/trips/planningProvenance.ts` (pure, STEP 23)                             | duplicate provenance vocabularies / inferring a kind / labeling `external-provider` as verified                 |
| Plan provenance note           | `tripPlanning` gate + `PlanningEditor` ("Source note", shown only on provenance)     | note-bearing legacy rewrite / kind-changing ordinary edits / notes > 500 chars persisted                        |
| Simulated provenance           | `handoff.ts` stamp + `PlanningEditor` **Mark as manually entered** (STEP 23)         | claiming "Simulated discovery" / "external-provider" labels as live, verified, or booked                        |
| Plan lifecycle                 | `src/domain/trips/planningLifecycle.ts` (pure, STEP 24)                              | duplicate lifecycle vocabularies / auto-transitions / stale-derived states                                      |
| Plan lifecycle state           | `tripPlanning` gate + `PlanningEditor` lifecycle chip/actions (STEP 24)              | writing a lifecycle value on view / inferring a state / claiming expiry or price changes                        |
| Handoff lifecycle              | `handoff.ts` `DISCOVERY_HANDOFF_LIFECYCLE_STATE` stamp (STEP 24)                     | importing a handoff plan without an explicit `active` lifecycle                                                 |
| Read-only lifecycle projection | `src/domain/trips/planningReferenceProjection.ts` (pure, STEP 25)                    | writing back a lifecycle / inferring lifecycle from provenance/dates/URLs / importing edit/provenance/readiness |
| Read-only plan projection      | `TripWorkspace.tsx` StructuredPlanningSection (STEP 25)                              | editing controls / mutation / not split into primary + visible subgroup                                         |
| Primary reference selection    | `src/domain/trips/planningReferenceSelection.ts` (pure, STEP 26)                     | auto-selecting a default / promoting another plan / rewriting a stored id / writing or persisting               |
| Primary selection in snapshot  | `tripPlanning` gate + `tripPlanningEdit` (STEP 26)                                   | malformed/empty ids persisted / applying a selection without an itinerary / touching another section            |
| Primary selection UI           | `PlanningEditor` Primary control + `TripWorkspaceView` chip/notice (STEP 26)         | offering ineligible plans / claiming a booking or availability / auto-assigning on open                         |
| AI primary scope lock          | `ALLOWED_PROPOSAL_UPDATE_KEYS` in `tripPlanningProposal.ts` (STEP 26)                | proposals containing `primaryTransportPlanId` / `primaryAccommodationPlanId`                                    |
| Primary-assignment conflict    | `src/domain/trips/planningReferenceConflict.ts` (pure, STEP 27)                      | auto-repairing / clearing / promoting / falling back / writing the stored selection                             |
| Conflict guidance UI           | `PlanningEditor` guidance + disclaimer + card chips + lifecycle hint (STEP 27)       | claiming a booking, availability, or auto-fix / implying the system resolves the choice                         |
| Conflict row marking           | `TripWorkspace.tsx` attention chip + muted "No primary reference selected.", STEP 27 | marking an always-eligible row / hiding the referenced-but-inactive row                                         |
| AI conflict scope lock         | `ALLOWED_PROPOSAL_UPDATE_KEYS` + handoff save payload (STEP 26/27)                   | a proposal or handoff carrying the primary keys so an import changes a selection                                |
| Trip Workspace shell           | `src/components/trips/TripWorkspace.tsx` (presentational)                            | fetching / global state / routes in the shell                                                                   |
| Trip ↔ Itinerary               | `itineraryToTripWorkspace` (pure adapter, type-only)                                 | mutation of the source Itinerary                                                                                |
| Tests                          | mock boundaries                                                                      | real network / production Firebase                                                                              |
