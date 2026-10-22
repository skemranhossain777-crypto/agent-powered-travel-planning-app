# VoyageAI — Developer Guide

Developer workflow for the VoyageAI codebase (Vite + React 18 + TypeScript + Firebase).

## Install dependencies

```bash
npm install
```

You also need to configure your environment variables (see `.env.example`):

- Local development: copy `.env.example` to `.env.local` and set `VITE_APPCHECK_DEBUG_TOKEN`.
- Production builds: `.env.production` holds the reCAPTCHA site key and Firebase web config.

## Run the app

```bash
npm run dev        # starts the Vite dev server on http://localhost:3000
```

## Validation commands

| Command                 | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `npm run typecheck`     | TypeScript type-check only (`tsc --noEmit`)            |
| `npm run lint`          | ESLint correctness checks (config: `eslint.config.js`) |
| `npm run format`        | Format all supported files with Prettier               |
| `npm run format:check`  | Verify formatting without writing (CI-safe)            |
| `npm run build`         | Type-check, then production build to `dist/`           |
| `npm run preview`       | Preview the production build locally                   |
| `npm run test`          | Run tests in interactive/watch mode (Vitest)           |
| `npm run test:run`      | Run all tests once (CI-friendly, deterministic)        |
| `npm run test:watch`    | Run tests in watch mode                                |
| `npm run test:coverage` | Run tests with a v8 coverage report                    |

## Automated tests

Tests use **Vitest** (Vite-native test runner) with the React Testing Library, jsdom, and
`@testing-library/jest-dom`. The suite is intentionally offline — it never calls production
Firebase, Gemini, Nominatim, Wikipedia, Wikimedia, or any external provider.

### Where tests live

All tests are colocated under `src/test/`:

```
src/test/
  setup.ts                   # jest-dom matchers + per-test cleanup
  dependencyBoundary.test.ts # guardrails: components never import firebase/*; services never import React; verificationState stays provider-/checklist-free (STEP 19); provider modules stay pure/standalone — exactly 8 files under src/domain/providers/, no firebase/react/zustand/router/services/fetch/axios/stripe/provider-env imports, no cross-boundary cycles (STEP 20); STEP 21: the mockDiscovery service modules are deterministic/network-/SDK-/Firebase-/UI-free, never read the current clock, never persist or touch Firestore, and carry no booking/payment/verify/cancel vocabulary; STEP 22: the handoff lives in exactly one pure src/domain/discovery handoff.ts — no clock, no services/React/Firebase/UI, no persistence, no booking/payment vocabulary; STEP 23: planningProvenance stays a pure, SDK-free vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network and no booking/payment/verify vocabulary; STEP 24: planningLifecycle stays a pure, SDK-free vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network, no auto-transitions, and no booking/payment/verify vocabulary; STEP 25: planningReferenceProjection stays a pure, SDK-free read-only projection in domain/trips — no firebase/react/zustand/router/services/clock/network, no writes, no edit/provenance/readiness imports, and no booking/payment/verify/volatility vocabulary; STEP 26: planningReferenceSelection stays a pure, SDK-free read-time primary-selection vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network, no auto-select/auto-promote machinery, no writes or persistence, and no booking/payment/verify vocabulary; STEP 27: planningReferenceConflict stays a pure, SDK-free, read-only conflict vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network, composes lifecycle/projection/selection only, never repairs/clears/promotes/falls back, and no booking/payment/verify vocabulary; STEP 28: planningReferenceResolution stays a pure, SDK-free, transient resolution vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network, composes the STEP 27 conflict type + STEP 26 selection only, never auto-resolves/auto-selects, never persists, and no booking/payment/verify vocabulary; STEP 29: planningReferenceChangeContext stays a pure, SDK-free, transient saved-vs-draft change-context vocabulary in domain/trips — no firebase/react/zustand/router/services/clock/network, composes the STEP 24 lifecycle + STEP 23 provenance + STEP 27 conflict vocabulary only, never writes stored primary ids, never auto-fixes, never persists, and no booking/payment/verify vocabulary
  geolocation.test.ts       # currency mapping, reverse geocoding, GPS boundary behavior
  placeImages.test.ts       # image resolution, caching, fallbacks
  aiTravelAgent.test.ts    # AI JSON parsing, model fallback, error wrapping, cache, malformed-input coercion
  dataConnectService.test.ts # seed data, signed-out guards, signed-in behavior
  ErrorBoundary.test.tsx    # component smoke test (fallback + recovery)
  routes.test.tsx          # whole-routing-boundary behavior (redirects, back/forward, /trips, /trips/:tripId)
  tripModel.test.ts        # pure Trip workspace helpers + permissions + Itinerary adapter + lifecycle policy (title normalization, status transitions, delete eligibility)
  tripPlanning.test.ts     # pure structured planning projection (STEP 13/16/17/22/23/24/26): buildTripPlanningData / isTripPlanningData / normalizeTripPlanningData / getTripDayDate / isSafeHttpUrl / plan guards (incl. readiness) / sourceUrl guards (safe http/https accepted, unsafe dropped/rejected) / provenance guards (manual/ai-generated/mock-discovery/external-provider accepted, unknown kind + over-long/non-string note rejected, legacy absent stays absent) / lifecycle guards (active/needs-review/replaced/archived accepted, unknown value rejects, legacy absent stays absent) / STEP 26 primary id guards (present trimmed id accepted, null treated as absent, non-string/empty rejected) / STEP 27: primary ids + lifecycle states project verbatim through build/normalize — never repaired, re-assigned, or promoted on save
  tripPlanningEdit.test.ts # pure structured planning editing (STEP 14/16/17/18/23/24/26): normalizeTripPlanningUpdate / applyTripPlanningUpdate / isPlanningUpdateDirty / getPlanningUpdateProblem / section helpers (incl. transport & accommodation plans + budget plan updates + checklist tasks; readiness deep-clone in apply/cloneSnapshot; updateTripTasks incl. null-clear + no-op; STEP 23 provenance normalize/reject/legacy + clonePlanWithMetadata deep-clone keeps provenance out of the snapshot; STEP 24 lifecycle normalize/reject/legacy + dirty-state + helpers; STEP 26 primary selection apply/set-clear/null/absent-no-op + dirty checks + problem messages) / STEP 27: lifecycle-only edits leave stored primary ids untouched (never cleared, never auto-reassigned; restore keeps the selection)
  executionReadiness.test.ts # execution-readiness vocabulary (STEP 17): states, guards, normalizeTripExecutionReadiness, labels never claim a booking, canUserSetReadinessState gate, draft-only execution-record contracts
  executionChecklist.test.ts # execution-checklist vocabulary (STEP 18): status/category/related-section enums, guards, normalizeTripChecklistItem (required fields, optional-string trimming/empties, real ISO dueDate, max-length rejection, absent-vs-null), duplicate-id gate, neutral labels never claim a booking
  verificationState.test.ts # external-verification vocabulary & producer boundary (STEP 19): seven-state vocabulary & guards (distinct from task statuses), distinct labels (only provider-confirmed is ever labelled a booking), honest explanations, evidence normalization (safe-http-only url, plain-text referenceValue, length bounds, producer-state rejection), producer-owned states never user-producible on any path, controlled user transitions, guards
  providerCapabilities.test.ts # provider capability contract (STEP 20): 7 ids/6 statuses + guards, declaration normalizer (trim/bound note, unknown id/status reject wholesale), operational only for available, labels + unavailability reasons never over-claim
  providerResults.test.ts # normalized provider result contract (STEP 20): field-by-field rebuild, required/bounded strings, real ISO timestamps with expiresAt>=retrievedAt, positive duration, finite non-negative price + letters-only currency, safe-http sourceUrl, availability default unknown, limitations/warnings arrays, expiry + recency warnings
  providerAdapter.test.ts # provider adapter boundary (STEP 20): profile guard/normalizer (id/name bounds, capabilities, last-wins dedupe), ProviderAdapter interface shape, isAdapterCapabilityAvailable, deterministic getAdapterOperationalCapabilityIds in PROVIDER_CAPABILITY_IDS order
  verificationProducer.test.ts # verification producer boundary (STEP 20): 5 outcomes, normalizeProviderVerificationResult (evidence + error-only-for-error), normalizeProducerEvidence (producer states + provider source kinds only, verifiedAt + reference/URL required, safe-http, bounds), canMintStateFromProducerResult (stale/evidence-less never mint), getProducerVerificationProofOfEvidence, describeProducerVerificationClaim never over-claims
  bookingLifecycle.test.ts # booking lifecycle model (STEP 20): 9 states/guards/labels, transition matrix (allowed + denied + producer-message + not-allowed problems), user-approval-before-submission, terminal success/failure, no auto transitions, canProviderMarkBookingConfirmed gate
  executionOperations.test.ts # execution envelope vocabulary (STEP 20): operation/status/retryability/safe-error-category vocabularies + guards, readOnly classification, labels, success/failure/requires-user-action builders (bounds, real ISO performedAt, no data on failure)
  executionApprovalAudit.test.ts # execution approval & audit boundary (STEP 20): 5 approval states, 9 audit event types, approve-only gate, read-only ops need no approval / mutations always do, normalizeExecutionAuditEvent (bounded safeSummary, ISO performedAt, actor whitelist), labels
  discoveryInput.test.ts # discovery query boundary (STEP 21): 2 categories, 43 normalization/problem tests (unknown-key rejection, bounded destination/origin/currency/traveler-count, real ISO calendar dates, end-without-start / end-before-start, never throws, normalize round-trips)
  mockProviders.test.ts   # mock adapter registry (STEP 21): both adapters declare read-only search-* only, verify-reference temporarily-unavailable, booking/cancellation unsupported, category→capability map, search envelopes normalize as TripProviderResult
  mockDiscoveryService.test.ts # read-only discovery service (STEP 21): success/empty/unsupported/provider-failure/invalid-input/unexpected-failure outcomes, sentinel destinations, capability guard consulted before search, deterministic for same (raw, now), never persists
  discoveryHandoff.test.ts # discovery-to-planning handoff (STEP 22): deterministic plan ids, problem guard (only transport/accommodation, expired quotes refused), transport + accommodation mapping with provenance notes (labels + provider + result id + retrieved-at + sample price + duration + cancellation policy + limitations), null for expired/non-planning/unsafe-sourceUrl categories; STEP 23: typed mock-discovery provenance (kind + DISCOVERY_HANDOFF_PROVENANCE_NOTE) carried on every mapped plan; STEP 24: explicit active lifecycle (DISCOVERY_HANDOFF_LIFECYCLE_STATE) carried on every mapped plan; STEP 26: the handoff never assigns primary ids; STEP 27: a handoff plan is an active primary candidate that is never auto-selected, and selection writes are structurally impossible through the mapping; STEP 28: handoff plans carry no resolution vocabulary, a user select over a missing prior state resolves selected-another, and adding a candidate never re-resolves a recovered or open conflict
  planningProvenance.test.ts # provenance vocabulary (STEP 23): 4 criteria — normalize/strict-gate/legacy-absent/predicates; label + honest description constants, note bounds (trim/drop-empty, >500 reject), never infers a kind, drops runtime-only keys, no booking/payment/verify vocabulary
  planningLifecycle.test.ts # lifecycle vocabulary (STEP 24): 4 criteria — vocabulary/normalize/strict-gate/legacy-default; effective-state read-time default (never written back), honest labels + descriptions (never claim expiry/staleness/price/verification/booking), predicates (isActiveReference/requiresPlanReview/isArchivedReference), no auto-transitions, no booking/payment/verify vocabulary
  planningReferenceProjection.test.ts # read-only lifecycle projection (STEP 25): legacy→active, primary/secondary classification, order-preserving partition, non-mutation, empty-safe, counts, honest display labels + summary, no provenance/clock/framework inference
  planningReferenceSelection.test.ts # user-controlled primary reference selection (STEP 26): strict id normalization (trim, non-string/empty reject), effective-active eligibility only (legacy included, needs-review/replaced/archived excluded), four-state resolution with honest reasons (missing/inactive preserved, never repaired or auto-promoted), order-preserving non-mutating partition with the selection applied, attention-state predicate, honest status labels, supports transport + accommodation plans
  planningReferenceConflict.test.ts # primary-reference assignment conflict model (STEP 27): four-state assignment status (none/valid/missing/inactive) via the selection vocabulary, transport/accommodation conveniences, attention predicate, honest status labels (missing/inactive share "Primary assignment needs attention"), plain-english conflict details (missing → "no longer present"; inactive → named lifecycle label + explicit user options only), selectable-as-primary composition, lifecycle-transition conflict/resolution predicates (moving the selected plan non-active creates/keeps a conflict; restoring the stored inactive selected plan to active resolves it without rewriting the id), no repair/promote/clear/fallback behavior
  planningReferenceResolution.test.ts # explicit conflict-resolution vocabulary (STEP 28): four-decision classification (unresolved/selected-another/cleared/restored-selected), select/clear/restore actions over missing/inactive/valid/none prior states (invalid/non-eligible actions → unresolved, resolved:false), honest labels + descriptions (never claim booking/payment/verification), predicates (isPrimaryConflictUnresolved + per-action resolve checks), compatibility check suppresses stale feedback, not-persisted/transient contract
  planningReferenceChangeContext.test.ts # saved-vs-draft change-context vocabulary (STEP 29): section-level kind classification (unchanged/primary-selected/primary-changed/primary-cleared/primary-restored/primary-unresolved/lifecycle-changed/provenance-changed/source-changed/reference-added/reference-removed), absent-draft → no change, null/empty ids absent on both sides (legacy never "cleared"), effective-lifecycle comparison (untouched legacy plan never a lifecycle change), deterministic reference labels (getTransportPlanReferenceLabel Route/mode/placeholder, getAccommodationPlanReferenceLabel Name/Location/Stay-in/placeholder), descriptor order + consolidated message, changed/unresolved flags, transport/accommodation independence, pure/product-null-free boundaries (null-safe and deterministic labels), and never claims booking/payment/verification
  DiscoveryPanel.test.tsx # presentational discovery panel (STEP 21): idle/loading/submits, all outcome states, disclaimer + mock-data pill, recency/expiry warning, searched-at + Clear, never renders any book/reserve/pay/verify affordance; STEP 22: handoff actions (Use as planning reference forwards the result, Added to planning draft blocks the card, Cannot add for expired quotes) + notice with Remove from draft
  tripPlanningProposal.test.ts # pure AI proposal model (STEP 15): normalizeTripPlanningRequest / normalizeTripPlanningProposal / mergePlanningProposalIntoDraft (incl. stable-id preservation) / summarizeProposalChanges (STEP 16: proposal scope rejects plan sections) / plan guards (STEP 17: merge preserves per-plan readiness) / tasks (STEP 18: proposal scope rejects tasks; merge preserves draft tasks) / STEP 19: proposal scope never accepts verification/execution/readiness/booking keys / STEP 20: proposal scope never accepts capability/provider-result/lifecycle/execution/approval keys / STEP 21: proposal scope never accepts discovery/mock-result/simulated-option keys / STEP 26: proposal scope never accepts primary-selection keys / STEP 27: proposal scope can never stage a plan lifecycle state or a selection change, and merging preserves existing staged primary selections verbatim / STEP 28: proposal scope can never stage resolution vocabulary, and merging over resolved/unresolved/cleared drafts preserves each classifier-visible assignment state
  aiPlanningService.test.ts # AI planning generation boundary (STEP 15): mocked firebase/ai + getAIService, valid/partial JSON, invalid JSON, unknown keys, unsafe urls, duplicate ids, invalid sections, model-alias fallback, no provider-text leaks, never persists
  uiStore.test.ts          # URL-driven store compat layer
  tripSerialization.test.ts # SDK-free document↔domain mapping, update splitting, storage ids, itinerary set/clear, reference url round-tripping (STEP 16: transport/accommodation/budget plan serialize + reject + round-trip; STEP 17: readiness round-trips, booking-claim states rejected)
tripSerializationModel.test.ts # pure itinerary shape validation (type guard + normalizer; STEP 16: transportPlans/accommodationPlans/budgetPlan sections; STEP 17: per-plan readiness accepted / booking-claim + malformed rejected; STEP 18: tasks accepted / duplicate ids + malformed tasks reject; STEP 22: safe sourceUrl round-trips, unsafe snapshots rejected; STEP 23: per-plan provenance round-trips, unknown kind / over-long notes reject, legacy valid; STEP 24: per-plan lifecycleState round-trips, unknown value rejects, legacy valid; STEP 26: primaryTransportPlanId / primaryAccommodationPlanId round-trip trimmed, null treated as absent, malformed rejects / STEP 27: present/missing/inactive stored selections round-trip verbatim — the serializer never re-assigns a primary on save)
tripService.test.ts      # trip persistence boundary (in-memory store, mocked firebase/firestore; incl. renameTrip / updateTripStatus / verified-owner deleteTrip / updateTripPlanning with STEP 16 sections + STEP 17 readiness + STEP 18 tasks persist / clear / reject)
  TripWorkspace.test.tsx   # presentational TripWorkspaceView rendering (incl. itinerary snapshot sections; STEP 25: read-only plan projection — primary vs always-visible "Replaced / archived" subgroup, lifecycle + provenance chips, no editing controls, plan-section omission when empty; STEP 26: "Primary reference" chip on the valid selected plan listed first, needs-attention notices for missing/inactive selections, transport vs accommodation independence, no chip for invalid selections, empty-plan omission) / STEP 27: amber attention chip on the referenced-but-inactive plan row in whichever lifecycle group it appears (needs-review in the main group, archived in the secondary subgroup) + muted "No primary reference selected." caption only when plans exist without an explicit selection / STEP 28: the five resolution-outcome categories render read-only (resolved-by-selection → valid green chip, resolved-by-clear → healthy absence + muted caption, resolved-by-restore → recovered assignment, transport/accommodation independent, unresolved states echoed honestly and never fabricated)
  TripWorkspacePage.test.tsx # routed page states (loading, owned, not-found, unauthorized, error) + editing boundary + structured planning editor + lifecycle controls (status transitions, rename, confirmed delete, navigation) + AI planning suggestions (draft-never-persist, merge, discard, safe errors, stale-response guard, failed-save keeps approved draft) + STEP 21 read-only mock discovery (results/empty/failure/invalid-input, Clear, never calls updateTripPlanning/updateTrip) + STEP 22 handoff (import→draft→explicit save, duplicate refusal, discard without persisting, editable sourceUrl carried to save) + STEP 23 provenance (imported plans carry mock-discovery provenance end-to-end; marking manually re-labels to manual before save) + STEP 24 lifecycle (imported as active, archived, restored, and saved — lifecycle written only on explicit save) + STEP 27: handoff save payload never carries a primary selection key (import can never create, change, or clear a selection) and preserves an archived plan verbatim / STEP 29: the STEP 22 handoff `role="status"` notice stays unique (change-context lines carry aria-labels, not role="status") and the workspace render is untouched
  PlanningEditor.test.tsx  # presentational planning editor (STEP 14–18): bounded sections, gating, explicit save, validation problems, unsaved-changes pill + transport/accommodation/budget editors + read-only readiness chips + checklist editor (read-only rows, Edit-then-capture, add with local id, status/category/due-date capture, remove, untitled-task block, Cancel revert, inputs disabled while saving) + sourceUrl inputs on transport/accommodation editors (STEP 22) + provenance chip/labels/source-note/mark-as-manual (STEP 23) + lifecycle chip/labels + lifecycle actions (Mark for review / Mark as active / Mark as replaced / Archive / Restore, section-editing only) with legacy-active read default (STEP 24) + STEP 26 primary control (status chips, eligible-plans-only select, stage/save the choice, clear stages null, no auto-select on open, disabled while saving, omitted for empty sections, attention states on the status chip, never reserializes untouched plans) / STEP 27: conflict guidance paragraph + "primary is a planning designation, not a booking" disclaimer legend, green "Primary reference" / amber "Primary assignment needs attention" card chips, and a warning/restore lifecycle-transition hint (never auto-clears, never auto-reassigns) / STEP 28: transient per-section resolution feedback (updated / cleared / restored-to-active / remains-unresolved), feedback only after an explicit user action, stale-feedback suppression when a later action re-creates the conflict, and Save persisting only the selection/lifecycle outcome (never a resolution record) / STEP 29: transient per-section change-context lines (fresh selection, changed labels, cleared deduped to exactly one message against STEP 28 feedback, restore change line alongside restore feedback, lifecycle/provenance/source/add/remove descriptors, accommodation independent, Cancel reverting an added reference and clearing the line; guest no-role-status lines with aria-labels)
  tripRoute.test.tsx       # app-level: /trips/:tripId mounts the page (App mocked out)
  MyTripsView.test.tsx     # presentational MyTripsView rendering (loading, signed-out, error, empty, ready)
  MyTripsPage.test.tsx     # owner-scoped /trips list (fetch on auth, empty/error, open route, user change, signed-out)
  ItineraryView.test.tsx   # promotion button visibility + click callback
```

> Architecture reference: see `docs/architecture.md` (as-built system), `docs/dependency-rules.md`
> (dependency rules by layer), and `docs/dependency-map.md` (Mermaid dependency diagram).
> Run `npm run test:run` and `npm run test:coverage` here before any architectural change.

### How to run the suite

```bash
npm run test:run           # one deterministic pass — run before any architectural changes
npm run test:coverage      # same pass plus a coverage report (text + html in coverage/)
npm run test               # interactive watch mode during development
```

### How external services are mocked

- **Gemini / Firebase AI Logic** — `firebase/ai` is replaced with a hoisted mock in
  `aiTravelAgent.test.ts`; model responses are driven by test-controlled behavior maps, so
  quota/retry/fallback logic is deterministic. `aiPlanningService.test.ts` (STEP 15) uses the
  same hoisted `firebase/ai` mock plus a mocked `./firebase` (`getAIService`), driving
  model responses through a per-alias behavior map so proposal generation, normalization
  rejection, model fallback, and safe error mapping are exercised offline — and asserting
  `updateTripPlanning`/Firestore is never touched.
- **Firestore / Data Connect** — `dataConnectService` tests exercise only the in-memory seed
  data and local persistence (`localStorage`/`sessionStorage`); genuine Firebase modules
  (`firebase.ts`, `firestoreService.ts`) are never loaded. `tripService.test.ts` replaces
  `firebase/firestore` with a hoisted `vi.fn()` factory whose functions read/write an
  in-memory Map keyed by document path, and mocks `./firebase` for `getFirestoreInstance`;
  `src/services/tripService.ts` is imported (SDK-free `tripSerialization.ts` likewise), so
  service logic runs against a fake store with `permission-denied`/`not-found` errors
  injected through the mock.
- **Wikipedia / Wikimedia / Nominatim** — `global.fetch` is stubbed at the network boundary
  (`vi.stubGlobal`) with canned JSON routes. No real HTTP requests occur.
- **Geolocation API** — stubbed/removed on `window.navigator` per test case.
- **`TripWorkspacePage` / routing tests** — `authService.subscribe`/`user` and `tripService`
  are mocked with hoisted classes so `instanceof` checks (e.g.
  `TripNotFoundError`/`TripPermissionError`) work; `AppRoutes`-level tests reuse the
  `routes.test.tsx` mock set plus a `tripService` mock.

### Rules

- Tests must never call production Firebase, Gemini, Auth, Firestore, or any external API.
- All mocks are scoped to the boundary; no global mocks that hide application problems.
- The suite must stay deterministic and runnable offline after `npm install`.

### Coverage

Coverage uses the `v8` provider and reports to the console (text), `coverage/html/`, and
`coverage/coverage-summary.json`. Scope is limited to `src/services/**` and
`src/components/ErrorBoundary.tsx`; Firebase init modules and generated Data Connect files are
excluded. Current baseline is ~93.4% statements across the instrumented modules
(`tripService` 100% at the service level — including the lifecycle wrappers and
`updateTripPlanning`; `tripSerialization` 100%, `tripSerializationModel` 100% —
including STEP 16's `transportPlans`/`accommodationPlans`/`budgetPlan` round-trips,
STEP 17's per-plan `readiness` persist/reject, and STEP 18's `tasks` persist/clear/reject;
`aiPlanningService` 99% — STEP 15's AI planning boundary; STEP 21's read-only
`src/services/mockDiscovery/**` layer adds `discoverTripOptions` coverage measured at
97.68% statements overall, with `mockFixtures`, `mockProviders`, and `mockTransportProvider`
at 100% and `mockDiscoveryService` at 91.89% lines). No passing
threshold is enforced yet. (STEP 17's pure domain module `executionReadiness.ts`,
STEP 18's `executionChecklist.ts`, STEP 19's `verificationState.ts` — which STEP 19's 30
tests exercise — STEP 20's seven `src/domain/providers/` contract modules plus STEP 21's
eighth `discoveryInput.ts`, STEP 22's `src/domain/discovery/handoff.ts`, and the
`PlanningEditor` sit outside the instrumented
`src/services/**` scope by design, as do the component-level `DiscoveryPanel` tests
exercised by the full suite. STEP 24 kept the instrumented scope identical: the new pure
`planningLifecycle.ts` vocabulary and its tests live outside `src/services/**`, so the
services-only coverage metrics are unchanged by design (line/statement metrics match the
STEP 23 baseline; the branch metric varies by ~0.04% run-to-run because of the pre-existing
timing-sensitive page test under parallel workers). STEP 25 kept the instrumented scope identical
again: the new pure `planningReferenceProjection.ts` projection and its tests also live outside
`src/services/**`, so the services-only coverage metrics stay unchanged by design. STEP 26 does
the same: `planningReferenceSelection.ts` and its tests live outside `src/services/**`, so the
services-only coverage metrics remain unchanged by design.)

## Domain types and service contracts

- **`src/types/travel.ts`** is the single source of domain truth. `BudgetLevel` and `TravelStyle`
  are shared union aliases used by `UserProfile.budgetPreference`, `Itinerary.budgetLevel`, and
  `AiPlannerParams.budgetLevel`/`travelStyle`. It never imports Firebase or Gemini types.
- **`src/utils/validation.ts`** holds runtime type guards/accessors (`isRecord`,
  `asOptionalString`, `asOptionalNumber`, `asStringArray`, `asRecordArray`) used at every
  service-boundary JSON edge (Gemini output, Nominatim, Wikipedia/Wikimedia). Untrusted payloads
  are normalized through these accessors instead of being cast straight to a domain type.
- **Service boundaries are `any`-free**:
  - `aiTravelAgent.ts` parses model JSON as `unknown`, then validates through `toRawDiscoveredPlace`
    / `toRawItinerary` (and nested `toRaw*` helpers). Non-object entries are dropped; numeric
    strings are coerced; all existing fallback values are preserved.
  - `geolocation.ts` types the Nominatim `reverse` response (`NominatimReverseResponse`,
    `NominatimAddress`).
  - `placeImages.ts` types wiki API responses and extracts pages through `queryPages` /
    `sortedPages` / `firstImageInfo`.
  - `firebase.ts` sets the App Check debug token on a typed `typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }`

## Trip Workspace (persistence & routing)

STEP 08 introduced a deliberately disconnected, fully tested Trip domain. STEP 09 wired it
into the running product: ownership rules, a persistence service, and a routed page. It is
still a planning shell — no booking, payments, live availability, collaboration, or
execution.

- **`src/types/trip.ts`** — the Trip vocabulary: `TripId`, `TripStatus` (`draft`,
  `planning`, `ready`, `in_progress`, `completed`, `cancelled`), `TripVisibility`
  (`private`, `shared`), `TripMemberRole` (`owner`, `editor`, `viewer`), `TripDateRange`,
  `TripDestination`, `TripWorkspace`, the persisted `TripItinerarySnapshot`, and the
  bookable-component reference types (`TripActivityReference`,
  `TripTransportReference`, `TripAccommodationReference`). Pure by construction: no
  React/Firebase/Zustand, no `any`, string IDs and ISO dates/date-times.
- **`src/domain/trips/tripModel.ts`** — pure helpers with no side effects and no clock:
  - `createDraftTrip(input)` — builds a `draft`/`private`/owner-only workspace; throws on
    empty owner/title or an invalid date range. Pass `now` for deterministic timestamps.
  - `isTripDateRangeValid(range)` / `getTripDurationDays(range)` — ISO-date validation and
    inclusive day counts (same-day = 1, invalid = 0).
  - `canViewTrip(...)` / `canEditTrip(...)` — owner/role/shared-visibility permission checks.
  - `toTripItinerarySnapshot(snapshot)` — non-mutating deep copy of a snapshot’s nested
    arrays (interests, day plan activities, transport, hotels).
  - `itineraryToTripWorkspace(itinerary, { ownerId, id?, dateRange? })` — a one-way, lossy,
    non-mutating adapter from the existing `Itinerary` to a `planning` workspace that also
    embeds the itinerary as `workspace.itinerary` (the persisted snapshot).
    `ownerId` is required (an `Itinerary` carries no owner); an invalid `dateRange` is
    dropped rather than thrown.
  - **Lifecycle policy (STEP 12):** `normalizeTripTitle(title)` — trims, rejects empty
    titles with a `TypeError` (`/non-empty title/`), never truncates. `TRIP_STATUS_TRANSITIONS`
    is the explicit matrix (`draft→[planning,cancelled]`, `planning→[ready,cancelled]`,
    `ready→[in_progress,cancelled]`, `in_progress→[completed,cancelled]`, terminal
    `completed`/`cancelled` → none) consumed by `canTransitionTripStatus(from, to)`,
    `getAllowedTripStatusTransitions(status)`, and `isEditableTripStatus(status)`.
    `canDeleteTrip(status)` returns true for every known status today — the single gate to
    tighten if a future execution layer makes any status non-deletable.
- **`src/domain/trips/tripPlanning.ts`** (STEP 13) - pure, SDK-free **structured planning
  projection** built on top of the Trip domain, mirroring `tripModel`'s determinism:
  `buildTripPlanningData(workspace)` projects a loaded workspace's canonical fields (date
  range, destinations, itinerary snapshot: days, transportation, accommodation) plus the
  optional `notes`/`references` on the snapshot into the typed `TripPlanningData` surface
  (dates, destinations, days, transportation, accommodation, budget, notes, references);
  `isTripPlanningData` is the type guard; `normalizeTripPlanningData` normalizes an
  untrusted payload (whitelists declared keys, shape-checks days/transportation/
  accommodation/notes/references, fuses the date range, clamps day numbers to the trip's
  duration) and returns `null` on malformed input rather than throwing; `getTripDayDate`
  resolves an ISO date for a day number within the date range. STEP 14 also exports the
  shared editing guards `isSafeHttpUrl` (bounded `http(s)` links; no whitespace/control
  chars; rejects `javascript:`/`data:`/`file:`), `isTripDateRange`,
  `isTripDestinationRecord`, and `isActivityRecord`. No Firebase/React/Router/
  Zustand/`any` - the projection is read-only and never persisted. STEP 16 adds the plan
  guards/normalizers `isTripTransportPlan` / `normalizeTripTransportPlan` (mode, from/to,
  optional day/provider/link), `isTripAccommodationPlan` /
  `normalizeTripAccommodationPlan` (name, check-in/check-out), and `isTripBudgetPlan` /
  `normalizeTripBudgetPlan` (unknown allocation keys dropped). STEP 22: both plan normalizers
  also validate an optional `sourceUrl` (non-string → `null`; trimmed; empty → dropped;
  otherwise must pass `isSafeHttpUrl`). STEP 23: the same plan normalizers validate an
  optional `provenance` via the pure `planningProvenance` gate — unknown kinds, non-string
  notes, and notes over 500 chars reject the whole plan; notes are trimmed and dropped when
  empty; absent/null provenance stays absent. STEP 24: the same plan normalizers validate an
  optional `lifecycleState` through the pure `planningLifecycle` gate — any unknown value
  rejects the whole plan; absent/null lifecycle stays absent (read as `active` at read time
  only, never written back). STEP 17: the transport and
  accommodation plan normalizers accept the optional per-plan `readiness`, delegating to
  `executionReadiness.normalizeTripExecutionReadiness` — malformed readiness rejects the
  whole plan, an omitted readiness leaves the key absent.
- **`src/domain/trips/tripPlanningEdit.ts`** (STEP 14) - pure, SDK-free **structured
  planning editing** module sharing `tripPlanning`'s guards: `normalizeTripPlanningUpdate`
  (strict wholesale validation of untrusted `TripPlanningUpdate`s — unknown keys,
  malformed nested items, duplicate ids/day numbers reject the whole update; `dateRange:
null` means clear), `applyTripPlanningUpdate` (builds the next workspace by deep clone;
  never touches identity/lifecycle or read-only sections; trims `notes`; itinerary-section
  edits no-op on legacy no-itinerary workspaces), `isPlanningUpdateDirty` (whether an edit
  differs from the persisted trip), `getPlanningUpdateProblem` (UI feedback strings), and
  per-section helpers plus `PlanningDraft`/`stripTripId`. No Firebase/React/Router/
  Zustand/`any`. STEP 16 extends the model to **eight updatable sections**
  (`ALLOWED_UPDATE_KEYS` adds `transportPlans` / `accommodationPlans` / `budgetPlan`) with
  the per-section helpers `updateTripTransportPlans` / `updateTripAccommodationPlans` /
  `updateTripBudgetPlan` (caller-provided values are applied raw; validation happens at the
  `normalizeTripPlanningUpdate` boundary) and `collapseEmptyBudgetPlan` (an empty
  `budgetPlan` collapses to an absent budget). STEP 17: `clonePlanWithReadiness`
  deep-clones the optional per-plan `readiness` through `applyTripPlanningUpdate` and
  `cloneSnapshot`, so a planning draft never shares readiness object references with the
  persisted snapshot. STEP 23: `clonePlanWithMetadata` also deep-clones the optional
  `provenance`, so provenance-bearing drafts never alias the snapshot either. STEP 24: the
  optional overlay scalar `lifecycleState` is carried by the same spread (scalars are copied by
  value, so lifecycle-aware drafts never alias the snapshot either), and lifecycle-changing
  sections count as dirty like any other plan reference edit. STEP 18 extends the model to the **ninth section** `tasks`
  (a user-authored execution-preparation checklist): `normalizeTripPlanningUpdate` validates
  it through `executionChecklist.normalizeTripChecklistItem` + `hasUniqueTaskIds`
  (`tasks: null` clears; `tasks: []` collapses to absent at apply); `applyTripPlanningUpdate`
  sets or deletes the snapshot `tasks` key (itinerary no-op on legacy workspaces);
  `updateTripTasks(workspace, tasks: TripChecklistItem[] | null)` throws `TypeError` on
  invalid non-null input and is a no-op without an itinerary; and `collapseTripTasks` keeps
  an empty/`null` checklist from reading as a dirty change on a no-itinerary workspace.
- **`src/domain/trips/tripPlanningProposal.ts`** (STEP 15) - pure, SDK-free **bounded AI
  proposal model**: `MAX_PLANNING_INSTRUCTION_LENGTH` (1000), `normalizeTripPlanningRequest`
  (whitelists `currentPlanning`/`instruction`/`constraints`; instruction required +
  trimmed + bounded), `normalizeTripPlanningProposal` (whitelists
  `explanation`/`warnings`/`assumptions`/`update`; the proposed `update` is run through the
  **same** `normalizeTripPlanningUpdate` as manual edits, and `ALLOWED_PROPOSAL_UPDATE_KEYS`
  restricts it to the five AI-owned sections (dates, destinations, days, notes, references)
  — so STEP 16 transport/accommodation/budget edits and any lifecycle/metadata smuggling are
  rejected at the identical boundary; `null` on any
  malformed/unknown-key/duplicate/unsafe payload), `mergePlanningProposalIntoDraft`
  (`{ ...draft, ...proposal.update }` — present keys override, absent keys untouched,
  `dateRange: null` clears; never mutates inputs), and `summarizeProposalChanges`
  (deterministic plain-text current → proposed diff rows). No
  Firebase/React/Router/Zustand/`any`.
- **`src/domain/trips/executionReadiness.ts`** (STEP 17) - pure, SDK-free **execution-readiness
  vocabulary**: `TRIP_EXECUTION_READINESS_STATES` (5 states), `isTripExecutionReadinessState`
  / `isTripExecutionReadiness` guards, and `normalizeTripExecutionReadiness` (unknown state
  or non-string note → null; note trimmed, dropped when empty). `getTripExecutionReadinessLabel`
  renders "Planned" / "User-entered reference" / "Verified externally" / "Cancelled" /
  "Unknown or unavailable" — a label is never a proof of a booking. `isExternallyVerifiedState`
  - `canUserSetReadinessState` gate who may set `externally-verified` (only the app, never the
    user: "booked/provider-confirmed" semantics are not user-producible). Also exports
    **DRAFT-ONLY** contracts for a future execution layer (`TripExecutionRecord` union over
    `TripTransportExecutionRecord` / `TripAccommodationExecutionRecord` /
    `TripBookingReferenceRecord`) that no module imports yet. No Firebase/React/Router/
    Zustand/`any`.
- **`src/domain/trips/executionChecklist.ts`** (STEP 18) - pure, SDK-free
  **execution-checklist vocabulary**: `TRIP_TASK_STATUSES` (`pending | in_progress |
completed | skipped`), `TRIP_TASK_CATEGORIES` (six preparation categories), and
  `TRIP_TASK_RELATED_SECTIONS` (`transport | accommodation | budget | itinerary`), the
  guards `isTripTaskStatus` / `isTripTaskCategory` / `isTripTaskRelatedSection` /
  `isTripChecklistItem`, and `normalizeTripChecklistItem` (strict whole-record rebuild:
  required `id`/`category`/`title`/`status`; optional strings trimmed and dropped when
  empty; `dueDate` must be a real ISO calendar date; max lengths 120/500/500/200 enforced by
  rejection, never silent truncation; absent-vs-null maps to absent; unknown enums reject
  wholesale). Also exports `hasUniqueTaskIds` (duplicate-id gate shared by the editing and
  persistence boundaries) and the neutral read-only labels `getTripTaskStatusLabel` /
  `getTripTaskCategoryLabel` / `getTripTaskRelatedSectionLabel` — a status like `completed`
  is presented as the owner's own action and never claims a booking, payment, or external
  confirmation. No Firebase/React/Router/Zustand/`any`.
- **`src/domain/trips/verificationState.ts`** (STEP 19) - pure, SDK-free
  **external-verification vocabulary and producer boundary** that the app does **not consume**:
  `TRIP_VERIFICATION_STATES` (seven states, `user-entered | user-confirmed | manually-reviewed |
externally-verified | provider-confirmed | cancelled | unknown`, defined in `types/trip`),
  `TRIP_EVIDENCE_SOURCE_KINDS` (six evidence kinds), the guards `isTripVerificationState` /
  `isTripEvidenceSourceKind` / `isTripVerificationEvidence`, and
  `normalizeTripVerificationEvidence` (strict whole-record rebuild reusing `isSafeHttpUrl` for
  the optional `url`, every `referenceValue` treated as plain user text, length bounds
  `MAX_EVIDENCE_ID_LENGTH` / `MAX_EVIDENCE_REFERENCE_VALUE_LENGTH` = 200, producer-state
  sources and unknown keys/kinds rejected, absent-vs-null maps to absent). The controlled
  transition gates are `canTransitionTripVerificationState` /
  `getAllowedUserVerificationTransitions` / `getTripVerificationTransitionProblem`, plus the
  honest label/explanation helpers. **Producer boundary:** `externally-verified` and
  `provider-confirmed` are reserved for a future provider-backed producer —
  `canUserTransitionTripVerificationState` returns `false` for producer-only current states,
  `getAllowedUserVerificationTransitions` returns `[]` for them, and
  `getTripVerificationTransitionProblem` reports the producer-ownership message on
  producer-origin transitions — user input can never mint these states. Nothing here is
  persisted, sent to the AI, or rendered as a control; no module imports this file.
  No Firebase/React/Router/Zustand/`any`.
- **`src/domain/providers/providerCapabilities.ts`** (STEP 20) - pure, SDK-free **provider
  capability contract**: `PROVIDER_CAPABILITY_IDS` (seven ids from `search-transport` through
  `retrieve-cancellation-information`), `PROVIDER_CAPABILITY_STATUSES` (six statuses),
  `MAX_CAPABILITY_NOTE_LENGTH` = 200, `DEFAULT_CAPABILITY_STATUS = 'unsupported'`, the guards
  `isProviderCapabilityId` / `isProviderCapabilityStatus` / `isProviderCapabilityDeclaration`,
  `normalizeProviderCapabilityDeclaration` (recognized id + status required; optional note
  trimmed/bounded and dropped when empty; unknown values reject the whole record — nothing is
  guessed), `providerCapabilityIsOperational` (true **only** for `available`), and the
  read-only labels / unavailability reasons. No SDK, credential, or network anywhere.
- **`src/domain/providers/providerResults.ts`** (STEP 20) - pure, SDK-free **normalized
  provider result contract**: `TripProviderResult` (required provider id/name, `resultId`,
  `TripBookingCategory`, `title`, `retrievedAt`, `availability`; optional bounded
  `summary`/`origin`/`destination`/`departureAt`/`arrivalAt`/`durationMinutes`/`price`/
  `cancellationPolicy`/`isSafeHttpUrl` `sourceUrl`/`expiresAt`/`limitations`/`warnings`),
  `normalizeTripProviderResult` (field-by-field rebuild strips unknown keys so raw provider
  payloads never leak; real ISO timestamps with `expiresAt ≥ retrievedAt`; positive integer
  duration; finite non-negative price + letters-only currency (1–8); `availability` defaults
  to `unknown`), plus `isTripProviderResultExpired` and `getTripProviderResultRecencyWarning`
  (expiry is the only staleness ever reported — a missing freshness bound is never presented
  as fresh).
- **`src/domain/providers/providerAdapter.ts`** (STEP 20) - pure, SDK-free **adapter boundary**:
  `ProviderAdapterProfile` (bounded id/name + capability declarations), `ProviderAdapter`
  (the service interface a future adapter implements — nothing calls it today), bounds
  `MAX_ADAPTER_ID_LENGTH`/`MAX_ADAPTER_NAME_LENGTH` = 100, `normalizeProviderAdapterProfile`
  (last-wins dedupe; unknown values reject), `isAdapterCapabilityAvailable`, and
  `getAdapterOperationalCapabilityIds` (deterministic `PROVIDER_CAPABILITY_IDS` order).
  Nothing here implements or calls an adapter.
- **`src/domain/providers/verificationProducer.ts`** (STEP 20) - pure, SDK-free **producer
  proof-of-evidence boundary**: five outcomes (`verified | not-verified | cancelled |
unavailable | error`), `ProviderVerificationResult`, `normalizeProviderVerificationResult`
  (evidence rebuilt through the strict `normalizeProducerEvidence`; safe errors accepted only
  for the `error` outcome), `normalizeProducerEvidence` (producer states + provider source
  kinds only; `verifiedAt` required; bounded reference value or `isSafeHttpUrl` URL required;
  unknown keys rejected), `getProducerVerificationProofOfEvidence` (`verified →
externally-verified`, `cancelled → cancelled`, else `null`), `canMintStateFromProducerResult`
  (stale or evidence-less results never mint), `evidenceSupportsProducerState`, and
  `describeProducerVerificationClaim` (read-only prose that never over-claims). Re-exports
  STEP 19's `describeProducerEvidenceRequirement`.
- **`src/domain/providers/bookingLifecycle.ts`** (STEP 20) - pure, SDK-free **booking lifecycle
  model**: nine states (`not_started | draft | awaiting_user_approval | submitted |
provider_pending | provider_confirmed | failed | cancelled | unknown`), the explicit
  `TRIP_BOOKING_LIFECYCLE_TRANSITIONS` matrix, `canTransitionBookingLifecycleState`,
  `getAllowedBookingLifecycleTransitions`, `getBookingLifecycleTransitionProblem` (the
  producer-verification message on `submitted` / `provider_pending → provider_confirmed`, a
  "not allowed" message outside the matrix), `requiresUserApprovalBeforeSubmission`,
  `isBookingLifecycleSuccessState` (only `provider_confirmed`),
  `isBookingLifecycleFailureState`, `canBookingTransitionAutomatically` (always `false`),
  `canProviderMarkBookingConfirmed` (requires `submitted`/`provider_pending` plus
  `externally-verified`/`provider-confirmed`), and neutral labels.
- **`src/domain/providers/executionOperations.ts`** (STEP 20) - pure, SDK-free **execution
  envelope vocabulary**: `ProviderOperationKind` (6 kinds), `ProviderOperationStatus`
  (success/failure/requires-user-action), `ProviderRetryability`
  (retryable/not-retryable/manual-review-required), `ProviderSafeErrorCategory` (10 bounded
  categories), the generic `ProviderExecutionResult<T>` envelope, the guards,
  `providerOperationIsReadOnly` (search/verify/retrieve-booking-status), labels, and
  `buildProviderExecutionSuccess` / `buildProviderExecutionFailure` /
  `buildProviderExecutionRequiresUserAction` (normalize source identity, real ISO performedAt,
  bounded strings/arrays; failure never carries `data`; safe errors never hold credentials,
  payment details, tokens, or provider internals).
- **`src/domain/providers/executionApprovalAudit.ts`** (STEP 20) - pure, SDK-free **execution
  approval & audit boundary**: five `ExecutionApprovalState` values (`not-requested |
requested | approved | rejected | expired`), nine `ExecutionAuditEventType` values,
  `ExecutionAuditEvent` (operation/type/ISO `performedAt`/optional bounded `safeSummary`/
  actor), `canExecutionProceedOnApprovalState` (**only** `approved`),
  `providerOperationRequiresApproval` (mutations need approval; read-only ops never do),
  `normalizeExecutionAuditEvent`, and read-only labels. No approval flow, no audit
  persistence, and no execution whatsoever is implemented.
- **`src/domain/providers/discoveryInput.ts`** (STEP 21) - pure, SDK-free **discovery query
  boundary** (the eighth `src/domain/providers/` module): `DiscoveryCategory`
  (`transport | accommodation`), `DISCOVERY_CATEGORIES`, `TripDiscoveryQuery` (required
  `category` + `destination`; optional `origin`, real ISO calendar `startDate`/`endDate`
  (end requires start, end ≥ start), `travelerCount` 1–50, letters-only `currency` ≤ 8
  uppercased), `MAX_DISCOVERY_*` bounds, `isDiscoveryCategory`, `isTripDiscoveryQuery`,
  `getTripDiscoveryQueryProblem` (unknown-key / missing / invalid / bound problems; never
  throws), and `normalizeTripDiscoveryQuery`. No Firebase/React/Router/Zustand; consumed
  only by `src/services/mockDiscovery/`.
- **`src/services/mockDiscovery/`** (STEP 21) - deterministic, **read-only mock discovery
  service layer** (no network, credential, SDK, Firestore, `tripService`, clock reads, or
  persistence):
  - `mockFixtures.ts` - fixture data (3 transport + 3 accommodation results incl. `Mock
Express Rail`), `MOCK_RESULT_DISCLAIMER`, `MOCK_RESULT_FRESHNESS_MINUTES`, sentinel
    destinations `MOCK_EMPTY_RESULTS_DESTINATION` / `MOCK_PROVIDER_FAILURE_DESTINATION`,
    `MOCK_SOURCE_URL_PREFIX`, `addIsoMinutes` (invalid input passes through unchanged),
    `buildMockTransportResults` / `buildMockAccommodationResults`, `getMockAvailabilityLabel`.
  - `mockTransportProvider.ts` / `mockAccommodationProvider.ts` - the two `MockDiscoveryAdapter`s
    (profiles declare read-only `search-*` only; `verify-reference` is `temporarily-unavailable`,
    booking/cancellation `unsupported`). `search(query, now)` is the only executed operation:
    for the failure/empty sentinels it returns a `provider-unavailable` failure or `[]`; else
    deterministic fixtures via `buildProviderExecutionSuccess('search', …)` with the disclaimer
    as a limitation on every result.
  - `mockProviders.ts` - `MockDiscoveryAdapter` type, `MOCK_DISCOVERY_ADAPTERS`,
    `MOCK_DISCOVERY_CATEGORY_ADAPTER`, `DISCOVERY_CATEGORY_CAPABILITY`
    (`transport` → `search-transport`, `accommodation` → `search-accommodation`).
  - `mockDiscoveryService.ts` - the single entry point `discoverTripOptions(raw, now)`
    (normalize → pick adapter via the category map → guard with
    `isAdapterCapabilityAvailable` → map the normalized envelope to a `MockDiscoveryOutcome`;
    statuses `success | empty | unsupported | provider-failure | invalid-input |
unexpected-failure`) plus exported `runDiscoveryWithAdapter(query, adapter, now)` for the
    unsupported-capability / injected-failure test paths. Deterministic: same `(raw, now)` →
    same outcome. Errors are always bounded STEP 20 safe categories.
- **`src/components/trips/DiscoveryPanel.tsx`** (STEP 21) - presentational, read-only
  discovery panel (no fetching, router, or services; owns only its local search-form state).
  Props: `state` (`DiscoveryViewState` idle/loading/complete), `onSearch`, `onReset`. Renders
  the category toggle (aria-pressed), destination/origin/start/end/travelers/currency inputs,
  the "Mock data — read-only" pill + `MOCK_RESULT_DISCLAIMER` note, outcome states (results
  list, empty, unsupported, bounded provider-failure alert, validation problem, unexpected
  failure), result cards with provider/source identity, `formatDiscoveryPrice` price, route +
  `formatDiscoveryDateTime` departures/arrivals, availability via `getMockAvailabilityLabel`,
  limitation/disclaimer list, and the STEP 20 recency/expiry warning via
  `getTripProviderResultRecencyWarning`. No book/reserve/pay/verify/confirm affordance exists.
  STEP 22 adds the **handoff surface**: an optional `handoff` prop
  (`DiscoveryHandoffConfig` — `getPlanId` / `isPlanPresent` / `onImport` / `onRemove` /
  `notice`) renders a **Use as planning reference** button per transport/accommodation result
  (disabled to "Added to planning draft" when the plan id is already drafted, or "Cannot add"
  for expired/non-planning results with the `getDiscoveryHandoffProblem` text) and a
  `role="status"` notice box ("Added “{title}” to your planning draft as a user-entered
  reference." + "Nothing imported here is booked or reserved.") with a Remove from draft button.
- **`src/domain/trips/planningProvenance.ts`** (STEP 23) - pure, SDK-free **planning-reference
  provenance vocabulary** for the explicitly-entered transport/accommodation plans, owned by the
  presence of provenance, not by any service or editor. It is the single source for the four
  `TripPlanProvenanceKind`s (`manual` / `ai-generated` / `mock-discovery` /
  `external-provider`), `MAX_PLAN_PROVENANCE_NOTE_LENGTH = 500`, the strict
  `normalizeTripPlanProvenance` gate (rejects unknown kinds and over-long/non-string notes;
  trims notes and drops empty ones; strips runtime-only keys), the honest read-only
  `getTripPlanProvenanceLabel` / `getTripPlanProvenanceDescription` helpers, and the
  `isSimulatedProvenance` / `isExternalProviderProvenance` predicates.
  `tripPlanning` validates `provenance` through this module; the STEP 22 handoff stamps
  `mock-discovery` provenance by construction (`DISCOVERY_HANDOFF_PROVENANCE_NOTE` equals the
  readiness note); `tripSerializationModel` round-trips the field; `PlanningEditor` renders the
  provenance chip, the "Source note" input, and the explicit **Mark as manually entered**
  action. No React/Firebase/Router/Zustand/`any`, no clock, no network — pure vocabulary only.
- **`src/domain/trips/planningLifecycle.ts`** (STEP 24) - pure, SDK-free **planning-reference
  lifecycle vocabulary** for the explicitly-entered transport/accommodation plans, owned by
  user action, not by any service, editor, timer, or clock. It is the single source for the four
  `TripPlanLifecycleState`s (`active` / `needs-review` / `replaced` / `archived`),
  `TRIP_PLAN_LIFECYCLE_STATES`, `DEFAULT_TRIP_PLAN_LIFECYCLE_STATE = 'active'`, the strict
  `isTripPlanLifecycleState` / `normalizeTripPlanLifecycleState` gates (any unknown value
  rejects — never guessed), the read-only `getEffectiveTripPlanLifecycleState` (legacy absent
  lifecycle reads as `active`, computed but never written back), the honest
  `getTripPlanLifecycleLabel` / `getTripPlanLifecycleDescription` helpers (wording never
  claims expiry, staleness, price changes, verification, or a booking), and the
  `isActiveReference` / `requiresPlanReview` / `isArchivedReference` predicates.
  `tripPlanning` validates `lifecycleState` through this module; the STEP 22 handoff stamps
  `active` by construction (`DISCOVERY_HANDOFF_LIFECYCLE_STATE`); `tripSerializationModel`
  round-trips the field; `PlanningEditor` renders the lifecycle chip and the lifecycle-action
  controls. No React/Firebase/Router/Zustand/`any`, no clock, no timers, no network — pure
  vocabulary only, and nothing here ever transitions a state automatically.
- **`src/domain/trips/planningReferenceProjection.ts`** (STEP 25) - pure, SDK-free **read-only
  lifecycle projection** for non-editing surfaces. It reads (never writes) planning-reference
  lifecycle state through the single `planningLifecycle` vocabulary, resolving absent legacy
  lifecycle to `active` at read time only ("Legacy reference — treated as active"), classifying
  `active`/`needs-review` as primary (needs-review visibly marked), classifying
  `replaced`/`archived` as secondary (always-visible "Replaced / archived" subgroup), and
  exposing order-preserving `partitionPlanningReferences`, `countPlanningReferences`,
  `getPlanningReferenceSummary`, and the honest `getPlanningReferenceDisplayLabel`. It imports
  only `types/trip` and `planningLifecycle` — never edit, provenance, readiness, React,
  Firebase, Router, Zustand, clock, network, or booking/payment/verify vocabulary.
- **`src/domain/trips/planningReferenceSelection.ts`** (STEP 26) - pure, SDK-free
  **user-controlled primary reference selection** for the section-level
  `primaryTransportPlanId` / `primaryAccommodationPlanId` stored on the itinerary snapshot. It
  owns the only read-time interpretation: `isPrimaryPlanId` / `normalizePrimaryPlanId` (a
  present id is stored trimmed; non-string/empty/whitespace rejects — never guessed),
  `isPlanEligibleAsPrimary` (effective-active only, legacy read-time default included;
  needs-review/replaced/archived never assignable), `resolvePrimarySelection` (exactly
  `no-explicit-selection | valid-explicit-selection | selected-plan-missing |
selected-plan-inactive` with a concise, honest `reason`), the order-preserving, non-mutating
  `partitionPlanningReferencesWithPrimary` (selected + eligibleActive + needsReview + secondary),
  `isPrimarySelectionAttentionState`, and `getPrimarySelectionStatusLabel`. Absence is never
  auto-assigned: nothing promotes the first plan, and a missing/inactive stored selection is
  preserved as-is and surfaced as a non-blocking "Primary assignment needs attention" state —
  never repaired or rewritten. It imports only `types/trip`, `planningLifecycle`, and
  `planningReferenceProjection`; no React, Firebase, Router, Zustand, clock, network, writes,
  persistence, or booking/payment/verify vocabulary.
- **`src/domain/trips/planningReferenceConflict.ts`** (STEP 27) - pure, SDK-free
  **primary-reference assignment conflict model** layered on the STEP 26 selection. It owns the
  concise, honest conflict vocabulary for a stored section-level primary assignment:
  `PrimaryAssignmentStatus` (`none | valid | missing | inactive`),
  `resolvePrimaryAssignmentStatus(selectedId, plans)` plus the transport/accommodation
  conveniences (`resolveTransportPrimaryAssignmentStatus` /
  `resolveAccommodationPrimaryAssignmentStatus`), `isPrimaryAssignmentAttentionNeeded`
  (missing/inactive), `getPrimaryAssignmentStatusLabel` (missing/inactive share "Primary
  assignment needs attention"), the plain-english `getPrimaryAssignmentConflictDetail`
  (names the stored selected id; `missing` → "no longer present in this section"; `inactive` →
  named lifecycle label + the user's explicit options: restore, select another active reference,
  or clear the assignment), `isPlanSelectableAsPrimary` (composed over the STEP 26 eligibility),
  and the transition-impact predicates `doesLifecycleTransitionCreatePrimaryConflict`
  (moving the valid/inactive selected plan non-active keeps the conflict) /
  `doesLifecycleTransitionResolvePrimaryConflict` (restoring the stored inactive selected plan
  to active resolves the conflict — a restore never rewrites a primary id). It reads the stored
  ids for reporting but never writes, clears, repairs, promotes, or falls back. It imports only
  `types/trip`, `planningLifecycle`, `planningReferenceProjection`, and
  `planningReferenceSelection`; no React, Firebase, Router, Zustand, clock, network, writes,
  persistence, or booking/payment/verify vocabulary.
- **`src/domain/discovery/handoff.ts`** (STEP 22) - pure, SDK-free **discovery-to-planning
  handoff** (the single module under `src/domain/discovery/`; no clock, no
  services/React/Firebase/UI, no persistence, no booking/payment vocabulary):
  `DiscoveryHandoffKind` / `DiscoveryHandoffPlan` (a `TripTransportPlan` or
  `TripAccommodationPlan`), `DISCOVERY_HANDOFF_PLAN_ID_PREFIX` (`handoff-`),
  `DISCOVERY_HANDOFF_READINESS_NOTE`, `DISCOVERY_HANDOFF_PROVENANCE_LABELS` (5
  honest labels: imported from simulated discovery, user-entered planning reference, sample
  data, not externally verified, not a booking/reservation), `getDiscoveryHandoffPlanId`
  (`handoff-<resultId>`), `getDiscoveryHandoffProblem(result, now)` (blocks non
  transport/accommodation results and expired quotes), and
  `mapDiscoveryResultToHandoffPlan(result, now, planId)` (maps provider/locations/times/
  reference/sourceUrl + typed `mock-discovery` provenance (`DISCOVERY_HANDOFF_PROVENANCE_NOTE`
  — equals the readiness note — stamped on every imported plan; STEP 23) + `lifecycleState:
'active'` by construction (`DISCOVERY_HANDOFF_LIFECYCLE_STATE`, equal to
  `DEFAULT_TRIP_PLAN_LIFECYCLE_STATE`; STEP 24) + provenance notes —
  provider, result id, retrieved-at, sample price, duration, cancellation policy, limitations —
  then re-validates through the STEP 16 plan normalizers, so only valid, safe-HTTP-URL-carrying
  plans import; otherwise `null`).
- **`src/services/aiPlanningService.ts`** (STEP 15) - **AI planning generation boundary**:
  `generateTripPlanningProposal(currentPlanning, instruction)` validates the request,
  sends only the structured `currentPlanning` + instruction to Gemini via
  `getGenerativeModel` (`firebase/ai`), demands strict `application/json` under a bounded
  schema, parses the response as `unknown`, and normalizes through
  `normalizeTripPlanningProposal`. Model aliases and retriable-error fallback follow the
  `aiTravelAgent` convention. All failures surface as a typed `AiPlanningError` with a
  safe pre-baked message — raw provider text never reaches the UI. The module imports
  `firebase/ai` + `./firebase` only: **no `firebase/firestore` import and no reference to
  `tripService`**, so the AI cannot write by construction — persistence happens only via
  the explicit `tripService.updateTripPlanning` save a human triggers.
- **`src/components/trips/TripWorkspace.tsx`** — `TripWorkspaceView`, a presentational
  shell rendering title, status, optional date range, destination names, a "Workspace
  foundation" placeholder, and (when `workspace.itinerary` exists) the itinerary snapshot
  as overview + day-by-day plan + transport + accommodation sections with friendly
  fallbacks. No fetching, state, route, or services. Mounted by `TripWorkspacePage`.
- **`src/components/trips/PlanningEditor.tsx`** (STEP 14) — `PlanningEditor`, a
  presentational editor (no fetching, router, or services; own local form state) rendering
  the five editable planning sections — trip dates, destinations, daily itinerary
  (day + activities), planning notes, and external references. It receives the loaded trip,
  a `PlanningSaveState`, a `disabled` flag, and `onSave(draft)`; it computes an "Unsaved
  changes" pill via `isPlanningUpdateDirty`, disables Save while unchanged/saving/errored/disabled,
  blocks save while `getPlanningUpdateProblem` reports a problem (rendered as an
  `role="alert"` message), and gates the days/notes/references sections behind a hint when
  the workspace has no itinerary. If gated by `TripWorkspacePage`, it stays blank + disabled
  (hidden). STEP 15 adds the **AI suggestion block**: an instruction textarea bounded at
  `MAX_PLANNING_INSTRUCTION_LENGTH`, a "Generate suggestion" action with a loading state
  (Save/title/status/delete/planning disabled while generating), and per-proposal previews —
  explanation, warnings, assumptions, and a current → proposed diff via
  `summarizeProposalChanges` — with Apply (merge into the local draft via
  `mergePlanningProposalIntoDraft`) and Discard (restore the previous draft) actions.
  STEP 16 adds the explicit **transport plans**, **accommodation plans**, and **budget plan**
  editors: each plan section renders read-only until its Edit frame is opened (adding a plan
  opens it with a local `trp-`/`acp-` id, saving replaces the whole list; removing an
  existing plan collects non-empty plans, with a hint when none remain); the budget editor
  auto-totals plan costs, normalizes the currency, names the five allocations, and offers
  "Clear budget plan". Inputs keep raw strings while typing; trimming/empties are handled by
  the domain normalization on save.
  Re-exports `PlanningDraft`; exported API = `PlanningEditor`, `PlanningSaveState`,
  `AiAssistState`, `ReferenceKind`.
  STEP 17 adds a read-only execution-readiness chip to each transport and accommodation plan
  card via `getTripExecutionReadinessLabel` (defaults to "Planned"; visually distinct for
  externally-verified). The chip is pure display of persisted planning metadata — it is not
  user-editable and never claims a booking.
  STEP 18 adds the explicit **checklist editor** (the ninth editable planning section): a
  "Checklist" frame (caption "Your own preparation tasks — full control, never autopilot.")
  renders neutral task rows read-only until its Edit frame is opened, then per-task
  status/category/title/due-date rows with remove actions, description and note rows, an
  optional related-plan select + free plan-id input, and an "Add task" action minting a local
  `tsk-` id with default `category: 'general'` / `status: 'pending'`. `setTaskValue` keeps the
  required `title` as its raw string while typing; optional empty fields physically drop their
  key. Saving blocks untitled tasks via `getPlanningUpdateProblem`; Cancel reverts the section;
  inputs disable while another write is in flight. The no-itinerary hint mentions the
  checklist like the other itinerary-gated sections.
  STEP 22 adds a **Source URL** input to the transport and accommodation plan editors (after
  the reference input; `aria-label` "... source URL ${index+1}", placeholder "Source URL"),
  editable like any other plan field once the section frame is open.
  STEP 23 adds the **planning-reference provenance layer**: each transport/accommodation plan
  card whose current draft plan has `provenance` renders a read-only provenance chip via
  `getTripPlanProvenanceLabel` ("Manual reference" / "AI-generated reference" / "Simulated
  discovery" / "External provider reference — not verified") with the honest
  `getTripPlanProvenanceDescription` as its title, styled distinctly for simulated provenance;
  mock-discovery plans also expose an explicit **Mark as manually entered** button (the only
  kind-changing gesture; disabled while `inputsDisabled`), which re-labels the plan to `manual`
  and drops any note. A bounded **Source note** input (caption "Where did this plan come
  from?…", `aria-label` "... source note ${index+1}" — "manual" / "generated" / "imported" /
  "external", placeholder "e.g." — visible only when provenance exists) keeps the raw string
  while typing; clearing the field drops the note but keeps the kind. Newly added plans default
  to `{ provenance: { kind: 'manual' } }` (accommodation adds mint local `acp-` ids, transport
  `trp-`). Legacy plans without provenance are never furnished one by rendering, focusing, or
  saving.
  STEP 24 adds the **planning-reference lifecycle layer**: each transport/accommodation plan
  card renders a read-only lifecycle chip that always shows the effective
  `getTripPlanLifecycleLabel` ("Active" / "Needs review" / "Replaced" / "Archived"; legacy
  plans without a lifecycle read as "Active" via the read-time default without being written),
  with `getTripPlanLifecycleDescription` as its title; a `PlanLifecycleControls` row with
  explicit lifecycle actions (**Mark for review**, **Mark as active**, **Mark as replaced**,
  **Archive**, and **Restore** for archived plans) renders only while the section is being
  edited and is disabled while `inputsDisabled`; lifecycle actions write only the local draft's
  `lifecycleState` (like every other plan reference edit, they persist only on an explicit
  save). A plan whose draft lifecycle is `archived` renders its card subdued
  (`ARCHIVED_PLAN_CARD_STYLE`). Legacy plans with no `lifecycleState` are never furnished one
  by rendering, editing, focusing, or saving.
- **`src/services/tripSerializationModel.ts`** — pure SDK-free validation of a stored
  itinerary: `isTripItinerarySnapshot` (type guard) and `normalizeTripItinerarySnapshot`
  (whitelists declared top-level keys, shape-checks day plans/activities/transport/hotels,
  and returns `null` when malformed). STEP 16 also validates the optional `transportPlans` /
  `accommodationPlans` / `budgetPlan` snapshot sections (unique plan ids; malformed or
  duplicate ids fail the snapshot guard). STEP 17 also accepts the optional per-plan
  `readiness` label and rejects booking-claim (`externally-verified` as user-supplied) as
  well as malformed readiness shapes on read. STEP 18 validates the optional `tasks` array
  through the shared `normalizeTripChecklistItem` normalizer (`normalizeTaskArray`; a
  malformed task or duplicate task id rejects the snapshot). STEP 22 accepts an optional per-plan
  `sourceUrl` (safe-HTT(P)-checked; unsafe values reject the snapshot) and round-trips it.
  STEP 23 also accepts an optional per-plan `provenance` via the shared
  `normalizeTripPlanProvenance` gate (unknown kind or over-long/non-string note rejects the
  snapshot; notes trimmed; absent/null provenance stays absent) and round-trips it.
  STEP 24 also accepts an optional per-plan `lifecycleState` via the shared
  `normalizeTripPlanLifecycleState` gate (any unknown value rejects the snapshot; absent/null
  lifecycle stays absent) and round-trips it.
  This is where the guard triple (types →
  serialization → rules) is anchored on the client.
- **`src/services/tripSerialization.ts`** — SDK-free Firestore mapper: `TripDocument`
  (incl. optional `itinerary`), `tripToFirestore`, `tripFromFirestore` (duck-typed
  `toDate()` for real Firestore Timestamps), `serializeTripUpdates` (splits a patch into
  `values` + `deletions`, ready for `deleteField()`; itinerary set or cleared),
  `serializeItinerarySnapshot`, `isValidStorageId`, and `TripSerializationError`. No
  `firebase/*` imports, so it is fully unit-testable offline.
- **`src/services/tripService.ts`** — the trip persistence boundary (`trips/{tripId}`),
  the only new `firebase/firestore` caller: `createTrip`, `getTrip`, `updateTrip`,
  `deleteTrip`, `listTripsForOwner` plus typed errors (`TripNotFoundError`,
  `TripPermissionError`, `TripValidationError`, `TripParseError`) and `mapFirestoreError`
  (never leaks raw SDK messages to the UI). `listTripsForOwner` runs
  `where('ownerId','==',uid)` (blank id rejected as `TripValidationError`), skips malformed
  docs that cannot be mapped (`tripFromFirestore` → `null`), and sorts by `updatedAt`
  newest-first client-side so no composite index is required. The constructor is a no-op
  and Firestore is resolved lazily so importing the module never initializes Firebase.
  `updateTrip` rejects identity/managed fields and rewrites `updatedAt`; `createTrip`
  returns the id chosen by Firestore.
  **Lifecycle wrappers (STEP 12):** `renameTrip(tripId, ownerId, title)` verifies ownership,
  normalizes the title via `normalizeTripTitle` (map `TypeError` →
  `TripValidationError`), and writes through `updateTrip`. `updateTripStatus(tripId,
ownerId, status)` rejects unknown status strings and illegal transitions (checked against
  the persisted current status via `canTransitionTripStatus`) before writing `{ status }`.
  `deleteTrip(tripId, ownerId?)` — with `ownerId` it verifies existence/ownership first;
  the one-arg form remains the historical rules-scoped path. `assertOwnerId` rejects blank
  session ids before any query.
  **Structured planning editing (STEP 14 / STEP 16 / STEP 17 / STEP 18):** `updateTripPlanning(tripId, ownerId, update)`
  is the single narrow write path for the editable planning sections. Guard order:
  `assertTripId` + `assertOwnerId` → `getTrip` (`TripNotFoundError`) → ownership check
  (`TripPermissionError`) → `normalizeTripPlanningUpdate` (malformed/no-itinerary
  inconsistency → `TripValidationError`, all _before_ any Firestore query) → apply in the
  domain → write only the changed canonical fields
  (`dateRange`/`destinations`/`itinerary`/`transportPlans`/`accommodationPlans`/`budgetPlan`/`tasks`)
  through `updateTrip` (ownership guard, `updatedAt` refresh, error mapping unchanged).
  STEP 16 also persists the new snapshot sections and clears a stored budget on
  `budgetPlan: null`. STEP 17: each plan's optional `readiness` rides the same write path
  unchanged (normalized at the domain boundary, carried verbatim to the snapshot).
  STEP 18: the user-authored `tasks` checklist persists through the same path — malformed
  tasks / duplicate ids reject before any query, `tasks: null` (or an empty array) clears
  the stored checklist, and task edits are rejected on a legacy no-itinerary workspace.
- **`src/components/trips/TripWorkspacePage.tsx`** — the routed page at `/trips/:tripId`
  (registered first in `AppRoutes`, a non-view route that renders without mounting `App`).
  It reads the param, subscribes to `authService`, loads via `tripService.getTrip`, and
  derives `loading | not-found | unauthorized | error | success` (including a stale-key
  guard back to loading when a loaded id differs from the URL id). No synchronous
  `setState` inside effects. On success it renders an internal `SuccessContent` editing
  boundary (title + itinerary overview) that saves through `tripService.updateTrip` (or
  the narrow `renameTrip` when no itinerary snapshot exists), shows
  an "Unsaved changes" pill when dirty, disables Save while unchanged/empty-title/saving,
  and maps save failures to the panel or an inline `role="alert"` message. **Lifecycle
  controls (STEP 12):** a status `<select>` listing the current status + the domain-allowed
  transitions (disabled on terminal statuses, per `isEditableTripStatus`, and while any
  other write is in flight) saved via `tripService.updateTripStatus`, and a "Delete trip"
  zone with an explicit confirm step ("Yes, delete trip" / "Keep trip") that calls
  `tripService.deleteTrip(trip.id, ownerId)` — navigating to `/trips` on success, staying
  with a safe error on failure. All async handlers use the URL-`tripId` stale guard so a
  late response cannot overwrite newer state; no optimistic updates or auto-save.
  **Structured planning editing (STEP 14):** the page composes the presentational
  `PlanningEditor` between the details card and the lifecycle card. It owns a `PlanningDraft`
  (plain `TripPlanningUpdate` + the tripId it was built from; stale drafts for other trips are
  ignored via a ref guard) and a `PlanningSaveState`; `handleSavePlanning` strips the tripId,
  calls `tripService.updateTripPlanning`, maps failures to the not-found panel / sign-in
  prompt / inline alert, and on success resets the draft and refreshes the trip. Planning
  saves and title/status/delete writes are mutually disabling (single-flight conflict rules).
  **AI planning suggestions (STEP 15):** the page owns an `AiAssistState` (idle →
  generating → ready → applied) and an instruction handler that calls
  `aiPlanningService.generateTripPlanningProposal(buildTripPlanningData(trip), instruction)`
  against the current trip, drops stale responses (ref-guarded on the URL trip id), maps
  every failure to a safe pre-baked `AiPlanningError` message (never raw provider text),
  and hands the normalized proposal to `PlanningEditor` for preview. **Apply** merges the
  proposal into the local `PlanningDraft` only (`mergePlanningProposalIntoDraft`) — nothing
  is persisted by the AI; **Discard** restores the pre-suggestion draft snapshot; and the
  merged draft reaches Firestore only through the existing explicit "Save planning" button
  (`updateTripPlanning`). A failed save keeps the approved draft applied and re-enables
  Save for retry. Generation (like every write) is disabled on terminal statuses and while
  any other write is in flight.
- **`src/components/trips/MyTripsView.tsx`** — `MyTripsViewState` is a discriminated union
  (`loading | signed-out | error{message} | empty | ready{trips}`). Presentational only:
  no fetching, no router, no services. The signed-out/empty prompts offer a "Browse
  Places" button firing `onBrowse`; ready renders each trip as an entire-card `<button>`
  calling `onOpenTrip(trip.id)`, with status badge, title, destination names, date range
  `start → end`, duration (`getTripDurationDays`, only when a date range is set), and an
  "Itinerary attached" badge when a snapshot exists. It keeps its own small status-style
  map instead of importing `TripWorkspace.tsx`'s (presentational shells stay independent).
- **`src/components/trips/MyTripsPage.tsx`** — the routed owner list at `/trips`
  (registered in `AppRoutes` before `/trips/:tripId`, a non-view route rendering without
  mounting `App`). It subscribes to `authService` (with the TripWorkspacePage
  `queueMicrotask` pattern, no synchronous `setState` in effects) and, only for a
  signed-in user, loads `tripService.listTripsForOwner(user.id)` with a `cancelled`
  cleanup guard, re-fetching when the user changes. A loading guard covers auth
  transitions (list owner ≠ current user). Errors are surfaced as safe text via
  `safeListMessage` (`TripPermissionError` → "You do not have access to this list.",
  otherwise a generic retry message). Renders `MyTripsView` and routes row taps to
  `tripPath(id)`. Its header links "Back to Explore" (`VIEW_PATH.explore`).
- **Promotion flow (in `App.tsx` + `ItineraryView.tsx`)** — `ItineraryView` shows a
  "Create Trip Workspace" button only when given the `onCreateTripWorkspace` prop; `App`
  gates on a signed-in user (auth modal otherwise), runs the pure adapter, persists via
  `tripService.createTrip`, toasts, and navigates to the new trip.
- **Rules** (`firestore.rules` `trips/{tripId}` block) — create: `signedIn()` +
  `ownerId == request.auth.uid` + valid shape; read/list: admin or owner; update/delete:
  owner-only with an ownership-transfer guard. There is no automated rules test harness;
  client-side guards + service error mapping are covered instead.

## Persistent document shape

`trips/{tripId}` documents are `ownerId`, `title`, `status`, `visibility`, optional
`dateRange` (ISO start/end), `destinations[]`, `memberCount`, `createdAt`, `updatedAt`
(all ISO date-times). `updatedAt` is maintained by the service; clearing `dateRange`
translates to a field deletion.

**STEP 13 (structured planning):** the **itinerary snapshot** (`itinerary`) is the single
canonical persisted home for structured planning data — `dayPlans`, `transport`, `hotels`,
and the optional `notes`/`references` — plus the workspace-level `dateRange` and
`destinations[]`. `TripPlanningData` is a derived projection rebuilt on every read and
**never persisted** (no extra collection/migration). Legacy documents without `notes`/
`references` stay byte-compatible: both keys are optional and read as absent.

**STEP 14 (structured planning editing):** the first five structured planning sections are
now editable — trip dates (`dateRange`, cleared via a `null` sentinel → field deletion),
`destinations[]`, the daily itinerary (`dayPlans`; only when an itinerary snapshot exists),
`notes`, and `references` — all persisted through the single narrow write path
`tripService.updateTripPlanning(tripId, ownerId, update)` with the domain module
`src/domain/trips/tripPlanningEdit.ts` doing normalize/apply/dirty/problem-checking. Present
keys persist that section, absent keys leave it untouched, nested duplicates/unknown keys
reject the whole update, `notes` are trimmed, and reference urls must pass `isSafeHttpUrl`
at both the domain and serialization boundaries. There is no autosave, no optimistic
persistence, and deep planning content stays client-validated.
`destinations[]` is capped at `MAX_TRIP_DESTINATIONS` (20): a changed list must be ≤20, while
an unchanged list on a legacy over-limit trip is allowed so such trips stay editable. The
cap is mirrored in `firestore.rules` (`validDestinations` + `destinationsAcceptable`).

**STEP 16 (explicit transport / accommodation / budget planning):** the three remaining
planning sections become editable and are persisted as **optional itinerary-snapshot
fields** — `transportPlans`, `accommodationPlans`, `budgetPlan` — through the same single
narrow `updateTripPlanning` write path (written only when present/changed; `budgetPlan: null`
clears a stored budget and an empty budget collapses to absent). Each plan section gets
explicit Edit/Cancel frames in `PlanningEditor` (remove empties the list; adding opens a
local `trp-`/`acp-` id; the budget auto-totals plan costs with five named allocations and a
"Clear budget plan" action). Validation stays client-side at the domain and serialization
boundaries (`tripSerializationModel` enforces unique plan ids and rejects malformed
sections); no collections, migrations, indexes, or `firestore.rules` changes.

**STEP 17 (execution-readiness foundation):** each transport/accommodation plan gains an
optional `readiness: { state, note? }` label persisted **inside the existing snapshot
fields** (`transportPlans` / `accommodationPlans`) through the same single
`updateTripPlanning` write path — no new collections, fields, indexes, migrations, or
`firestore.rules` changes. "Booked/provider-confirmed" is represented as
`externally-verified`, which `canUserSetReadinessState` forbids for users, and the label
functions never render a booking claim. `normalizeTripPlanningUpdate` / plan normalizers
and `tripSerializationModel` both accept the optional label; booking-claim or malformed
readiness is rejected. `PlanningEditor` renders it read-only. AI-proposal scoping is
unchanged — readiness is not an AI-owned section.

**STEP 18 (execution-preparation checklist):** the user-authored checklist is stored as the
optional `tasks: TripChecklistItem[]` snapshot field (ninth editable planning section) —
no new collections, indexes, migrations, or `firestore.rules` changes. It persists only
through the single `updateTripPlanning` write path; `normalizeTripPlanningUpdate` and
`tripSerializationModel` validate each task (`normalizeTripChecklistItem` +
`hasUniqueTaskIds`), `tasks: null` (or `[]`) clears the stored checklist, and `PlanningEditor`
edits it behind an explicit Edit frame. Task `status` is an owner progress label only —
no status claims a booking, payment, or external verification, and the AI proposal scope
(`ALLOWED_PROPOSAL_UPDATE_KEYS`) excludes `tasks`, so the AI can never author tasks.

**STEP 19 (external-verification foundation):** **no persistence changes at all.** The new
pure `verificationState` module introduces no collections, fields, indexes, migrations, or
`firestore.rules` changes — nothing is persisted, and the module drafts types/concepts that
only a future execution step may adopt. The earlier DRAFT-ONLY `TripExecutionRecord`
contracts in `executionReadiness` were refined (compile-time only) to carry the richer
`TripVerificationState` / `TripVerificationEvidence` / `TripBookingCategory` shape, but no
module imports them. The AI proposal scope (`ALLOWED_PROPOSAL_UPDATE_KEYS`) and the
verification transition gates ensure a user-entered reference is never labelled a booking
and no verification state is ever produced from AI output or checklist completion.

**STEP 20 (provider and execution integration architecture):** **no persistence changes at
all.** The seven pure `src/domain/providers/` contract modules
(`providerCapabilities`, `providerResults`, `providerAdapter`, `verificationProducer`,
`bookingLifecycle`, `executionOperations`, `executionApprovalAudit`) introduce no
collections, fields, indexes, migrations, or `firestore.rules` changes — nothing is
persisted, and the modules only declare contracts that a future adapter/producer layer may
implement. No provider SDK, credential, API key, `fetch`, or network call exists; no
booking, payment, ticket, verification, or cancellation is executed;
`canBookingTransitionAutomatically` always returns `false`; and every module is unconsumed
(no importer anywhere). The persisted STEP 13–18 snapshot fields, `ALLOWED_PROPOSAL_UPDATE_KEYS`
(five AI-owned sections), and `firestore.rules` are untouched.

**STEP 25 adds a read-only, lifecycle-consistent plan reference projection** on the presentational
trip workspace shell (`TripWorkspace.tsx` → `StructuredPlanningSection`). The component now
renders the transport and accommodation plan references already present on the
`TripPlanningData` snapshot: each plan row shows a lifecycle chip
(`getPlanningReferenceDisplayLabel`) and a separate provenance chip
(`getTripPlanProvenanceLabel`), plans are split into a primary list (active/needs-review, with
needs-review visibly marked) and an always-visible "Replaced / archived" subgroup using
`partitionPlanningReferences`, and no editing controls are rendered on this surface. Helper
counts display a brief deterministic summary (`getPlanningReferenceSummary`); legacy plans (no
`lifecycleState`) render as "Legacy reference — treated as active" and are never written back by
viewing. The surface stays entirely presentational (props-only, `types/trip` + pure projection
helpers + `planningProvenance` label helpers), and no persistence changes, new surfaces,
collections, migrations, indexes, or `firestore.rules` changes are introduced. The AI proposal
ownership boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS`) remains unchanged.

**STEP 26 adds a strictly user-controlled primary reference selection.** The itinerary snapshot
can now carry an optional `primaryTransportPlanId` / `primaryAccommodationPlanId` — a plain,
explicitly stored choice per section. Absence means no selection: nothing ever auto-selects the
first plan and nothing auto-promotes when a selection becomes invalid. A new pure, SDK-free
module `src/domain/trips/planningReferenceSelection.ts` owns the read-time interpretation: strict
id normalization (present id trimmed; non-string/empty rejects the owning update/snapshot),
lifecycle-only eligibility (effective-active, legacy read-time default included;
needs-review/replaced/archived never assignable), a four-state resolution with concise honest
reasons, and an order-preserving partition (selected + eligibleActive + needsReview + secondary)
that never mutates its inputs. In the editor (`PlanningEditor.tsx`), each section gains a
"Primary" control — a status chip plus a select offering eligible plans only — staged into the
local draft and persisted only on the existing explicit **Save planning**; `null` (the empty
option) is an explicit clear. The read-only workspace view (`TripWorkspace.tsx`) lists a valid
primary first with a "Primary reference" chip and renders missing/inactive selections as a
non-blocking "Primary assignment needs attention" notice that preserves the stored id. Persistence
is plain data: `tripPlanning` trims the id, `tripPlanningEdit` applies/clears it only when an
itinerary exists, and `tripSerializationModel` round-trips a present trimmed id. The AI proposal
ownership boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS`) still lists exactly the five STEP 14 keys —
proposals containing the new keys are rejected as unknown — and the discovery handoff never
assigns primary fields. No new collections, migrations, indexes, or `firestore.rules` changes.

**STEP 27 adds a read-only primary-reference assignment conflict model.** A new pure, SDK-free
module `src/domain/trips/planningReferenceConflict.ts` layers honest conflict wording on the
STEP 26 selection. It resolves the assignment status (`none | valid | missing | inactive`),
flags attention states, and explains a conflict in plain English: the stored selected id plus the
user's explicit options (select another active reference, clear the assignment, or — when the
plan still exists — restore it to active). It also predicts lifecycle-transition impact:
`doesLifecycleTransitionCreatePrimaryConflict` warns before a transition makes a valid/inactive
selection non-active; `doesLifecycleTransitionResolvePrimaryConflict` confirms that restoring
the stored inactive selected plan to active resolves the conflict — a restore never rewrites a
primary id. The module reads the stored ids for reporting but never writes, clears, repairs,
promotes, or falls back; it composes lifecycle/projection/selection vocabulary only. In the
editor, each section renders a guidance paragraph + a "primary is a planning designation, not a
booking" disclaimer legend, green "Primary reference" / amber "Primary assignment needs
attention" card chips, and a warning (valid selection being made inactive) or restore (inactive
selection being reactivated) lifecycle hint. The read-only workspace view marks the
referenced-but-inactive plan row with the amber attention chip in whichever lifecycle group it
appears and shows a muted "No primary reference selected." caption when plans exist without an
explicit selection. The AI boundary stays locked (a proposal can never stage a lifecycle state
or a selection; merging preserves existing staged selections), and a handoff save payload never
carries a primary key — importing can never create, change, or clear a selection. No new
collections, migrations, indexes, or `firestore.rules` changes.

**STEP 21 (read-only external discovery simulation):** **no persistence changes at all.** The
discovery path is strictly read-only and transient: `discoverTripOptions(raw, now)` performs
no write, `TripWorkspacePage` treats results as ephemeral display state (cleared on trip
change, with a working Clear), and step 21 adds no collections, fields, indexes, migrations,
or `firestore.rules` changes. Nothing is stored, sent to the AI, or merged into a trip —
STEP 21 boundary tests assert the page never calls `updateTripPlanning`/`updateTrip` during a
search and that proposals never accept discovery/mock-result keys. `ALLOWED_PROPOSAL_UPDATE_KEYS`
(five AI-owned sections) stays locked and the persisted STEP 13–18 snapshot fields are untouched.

**STEP 22 (user-controlled discovery-to-planning handoff):** **no persistence-shape changes besides
the optional `sourceUrl`.** Importing a discovery result into the planning draft never writes
anything by itself — the imported plan (deterministic `handoff-<resultId>` id,
`readiness.planned`, the result's `sourceUrl`, provenance `notes`) is appended to the existing
draft and persists only when the human clicks the existing explicit **Save planning** button
through the same narrow `updateTripPlanning` write path. The optional `sourceUrl` on
transport/accommodation plans is validated by the `tripPlanning` normalizers
(`isSafeHttpUrl`-checked; trimmed; dropped when empty) and round-tripped by
`tripSerializationModel`. No collections, indexes, migrations, or `firestore.rules` changes;
`ALLOWED_PROPOSAL_UPDATE_KEYS` stays locked to the five AI-owned sections; nothing in
`handoff.ts` touches services, React, Firebase, the clock, or any booking/payment vocabulary.

**STEP 15 (AI planning suggestions):** **no persistence changes at all.** `tripPlanningProposal`
and `aiPlanningService` introduce no collections, fields, indices, or rules. A proposal lives
only in `TripWorkspacePage` state until the human clicks the existing explicit **Save planning**
button, which persists through the same narrow `updateTripPlanning` write path; the AI service
has no Firestore import and cannot write by construction. The system instruction tells the model
to preserve existing destination/day/reference ids verbatim and to warn when dates change; the
proposed `update` is validated by the same shared `normalizeTripPlanningUpdate` boundary as
manual edits and restricted to the five AI-owned sections by
`ALLOWED_PROPOSAL_UPDATE_KEYS` — the STEP 16 transport/accommodation/budget sections are
user-editable only and can never be introduced by AI output (STEP 17's readiness labels
and STEP 18's checklist `tasks` likewise — neither is an AI-owned section).

## Routing (React Router DOM)

- **`src/routes.ts`** owns the typed URL↔view mapping: `VIEW_PATH` (`/explore`, `/bookmarks`,
  `/itineraries`, `/profile`), `TRIPS_PATH` + `tripPath(tripId)` (URI-encoded),
  `pathToView(pathname)`, and `viewToPath(view)`. It is a pure module (no React import)
  shared by `AppRoutes`, `App`, and `Navbar`.
- **`src/AppRoutes.tsx`** is the composition layer mounted by `main.tsx` inside
  `BrowserRouter` (under `ErrorBoundary`/`StrictMode`). It defines the route table: `/`
  redirects to `/explore`, each view path renders a `ViewRoute` (which syncs the URL to
  `uiStore.activeView` one-way and renders the single persistent `App`), `/trips` renders
  `MyTripsPage` (the owner list), `/trips/:tripId` renders `TripWorkspacePage` (registered
  after `/trips`), both standalone pages that do not mount `App`, and unknown paths
  redirect to `/explore`. `App` stays mounted across tab switches, so domain state is
  preserved without lifting.
- **URL is the source of truth; the store is a compatibility layer.** `SyncActiveView`
  mirrors location.pathname → `activeView` with an equality guard (no navigation loops).
  Back/forward and refresh resolve to the same view; Firebase Hosting's existing SPA
  fallback rewrite (`**` → `/index.html`) handles deep links.
- Special navigation: brand logo → `/explore`, profile avatar → `/profile`, sign-out →
  `/explore` (transition-detected via `wasSignedInRef`, so deep-link refreshes do not
  redirect), generated/bookmark-selected itineraries → `/itineraries`, and ProfileView
  callbacks → the matching route.

## UI state management (Zustand)

- **`src/stores/uiStore.ts`** is the single Zustand store so far. It owns **global UI state
  only**: `activeView` (`'explore' | 'bookmarks' | 'itineraries' | 'profile'`, default
  `'explore'`), plus `setActiveView` and `resetUiState`. The active view is now mirrored
  from the URL by `AppRoutes`; components navigate instead of setting it.
- Only `App.tsx` consumes the store today (via `useUiStore((s) => s.activeView)`); `Navbar`
  derives active styling from the URL. The store has **no persistence middleware**, so a page
  refresh restores the default view exactly as before the migration.
- Boundary rules: `zustand` and `react-router-dom` live only in components/composition;
  services and Firebase modules never import them; the store module never imports React or
  any service. The dependency-boundary test keeps enforcing the firebase/React rules.
- Store tests (`src/test/uiStore.test.ts`) reset the singleton between cases and assert the
  default view, view changes, reset, valid values, and the exact state shape (no unexpected
  fields).

## Testing routing & dependencies

- `src/test/routes.test.tsx` exercises the whole routing boundary: `/` → `/explore`, each of
  the four view paths rendering the correct view, unknown paths → `/explore`, and browser
  back/forward. It mocks `authService`, `dataConnectService`, `aiTravelAgent`,
  `geolocation`, and `placeImages` so no real network/services are touched.
- `src/test/tripRoute.test.tsx` exercises the trip page alongside the app-level route table:
  `/trips/trip-xyz` renders `TripWorkspacePage` (App itself is replaced with a stub so the
  heavy orchestration module never loads), the page passes its id load through the mocked
  `tripService`, and it renders the workspace title/status when owned.
- `src/test/MyTripsPage.test.tsx` mounts the page inside `MemoryRouter` with a matching
  `<Route path="/trips">` (plus a `/trips/:tripId` probe that captures the `id` param),
  mocking `authService` and `tripService`; it covers the signed-in owner list (called with
  the user id, newest-first ordering from the service), empty, generic error (safe text,
  no raw message), `TripPermissionError`, signed-out (no fetch, browse prompt), opening a
  selected trip's workspace route, re-fetch when the signed-in user changes, and the
  signed-out prompt on logout.
- `src/test/MyTripsView.test.tsx` renders `MyTripsView` for each state directly: loading,
  signed-out, error (safe message), empty, and ready (title, status badge, destinations,
  date range, duration, itinerary badge, and the `onOpenTrip(id)` callback), plus the
  sign-in/browse prompts.
- `src/test/TripWorkspacePage.test.tsx` mounts the page inside `MemoryRouter` with a
  matching `<Route path="/trips/:tripId">` (required so `useParams` resolves), mocking
  `authService` (getter + subscribe) and `tripService` with hoisted error classes; it covers
  loading, the signed-in-owner success case, not-found, unauthorized (signed-out), the
  safe unexpected-error message, safe handling of a malformed stored itinerary, and the
  editing boundary (prefilled title/overview, dirty tracking, Save disabled while
  unchanged/empty-title/saving, a successful save via `updateTrip`, inline save errors, and
  not-found on save). STEP 12 adds the lifecycle suite: status select constrained to the
  current status + allowed transitions, terminal-status disablement (with hint), a legal
  transition via `updateTripStatus`, inline status errors preserving the draft, cross-control
  disabling while a save is in flight, rename via `renameTrip` (no-itinerary trips) success
  - failure preserving the draft, delete confirmation required, delete cancellation without
    a service call, delete success navigating the mocked `/trips` route, delete failure
    staying on the page with a safe error, not-found on delete, and Delete disabled during an
    in-flight save.
- `src/test/tripPlanning.test.ts` (STEP 13) exercises the pure structured planning
  projection module offline: building `TripPlanningData` from a loaded workspace
  (structure, day-number fusion, date resolution), the `isTripPlanningData` type guard,
  normalization that whitelists declared keys, shape-checks structured days/
  transportation/accommodation/notes/references, fuses the date range, clamps day numbers
  to the trip's duration, and returns `null` (never throws) on malformed payloads - plus
  the budget/notes/references surface in `TripWorkspace` renders read-only. STEP 16 adds
  the plan guard/normalizer suite; STEP 17 covers per-plan `readiness` acceptance, an
  absent-key default, and rejection of booking-claim / malformed readiness.
- `src/test/executionReadiness.test.ts` (STEP 17) exercises the execution-readiness module
  offline: the five-state vocabulary and guards, `normalizeTripExecutionReadiness`
  (unknown state / non-string note → null, note trimming), labels that never claim a
  booking, the `canUserSetReadinessState` gate (users cannot set `externally-verified`),
  and the DRAFT-ONLY `TripExecutionRecord` contract shapes (compile-time only; no importers
  in the codebase).
- `src/test/executionChecklist.test.ts` (STEP 18) exercises the execution-checklist module
  offline: the status/category/related-section vocabularies and guards (provider-like
  strings such as `booked` are rejected), `normalizeTripChecklistItem` (required
  id/category/title/status, optional-string trimming and empty-drops, real ISO `dueDate`,
  max-length rejection, absent-vs-null mapping, unknown-key stripping, malformed-field
  wholesale rejection), `hasUniqueTaskIds`, and the neutral read-only labels that never
  claim a booking.
- `src/test/verificationState.test.ts` (STEP 19) exercises the external-verification module
  offline: the seven-state vocabulary and guards (provider-like task statuses such as
  `completed`/`in_progress` are rejected, and no state collides with the STEP 17 readiness
  vocabulary), distinct labels (only `provider-confirmed` is ever labelled a booking),
  honest explanations ("not proof of a booking", "Not live or provider confirmation"),
  `normalizeTripVerificationEvidence` (trim/drop-empty rebuild, `isSafeHttpUrl` url guards,
  ISO timestamp validation, `referenceValue` kept as plain text, length bounds, producer-state
  source kinds rejected wholesale), and the controlled transition gates — including the
  producer boundary asserting `externally-verified` / `provider-confirmed` cannot be minted,
  matched, or left by user input on any path.
- `src/test/providerCapabilities.test.ts` (STEP 20) exercises the provider capability contract
  offline: the seven capability ids / six statuses and their guards (unknown values reject),
  `normalizeProviderCapabilityDeclaration` (note trimming/bounding/drop-when-empty, unknown
  id/status wholesale rejection), `providerCapabilityIsOperational` (true only for
  `available`), and the labels + unavailability reasons.
- `src/test/providerResults.test.ts` (STEP 20) exercises the normalized provider result
  contract offline: field-by-field rebuild (unknown keys dropped), required bounded strings,
  real-ISO `retrievedAt` required + `expiresAt ≥ retrievedAt` optional, positive integer
  `durationMinutes`, finite non-negative `price.amount` + letters-only currency,
  `isSafeHttpUrl`-gated `sourceUrl`, `availability` defaulting to `unknown`,
  `limitations`/`warnings` array handling, and the expiry / recency-warning helpers.
- `src/test/providerAdapter.test.ts` (STEP 20) exercises the adapter boundary offline:
  profile guard/normalizer (id/name bounds, capability declarations, last-wins dedupe), the
  `ProviderAdapter` interface shape, `isAdapterCapabilityAvailable`, and
  `getAdapterOperationalCapabilityIds` returning ids in `PROVIDER_CAPABILITY_IDS` order.
- `src/test/verificationProducer.test.ts` (STEP 20) exercises the producer boundary offline:
  `normalizeProviderVerificationResult` (evidence rebuilt, safe errors only for the `error`
  outcome), `normalizeProducerEvidence` (producer states + provider source kinds only,
  required `verifiedAt` + reference/URL, bounds), `canMintStateFromProducerResult` (stale or
  evidence-less results never mint), `getProducerVerificationProofOfEvidence`, and
  `describeProducerVerificationClaim` never over-claiming.
- `src/test/bookingLifecycle.test.ts` (STEP 20) exercises the lifecycle model offline: the
  nine states/guards/labels, the transition matrix, allowed + denied transitions incl. the
  producer-verification problem message, user-approval-before-submission keys, terminal
  success/failure classification, no automatic transitions, and the
  `canProviderMarkBookingConfirmed` gate.
- `src/test/executionOperations.test.ts` (STEP 20) exercises the execution envelope
  vocabulary offline: operation/status/retryability/safe-error-category vocabularies + guards,
  `providerOperationIsReadOnly`, label helpers, and the success/failure/requires-user-action
  builders (bounds, real ISO performedAt, no `data` on failure).
- `src/test/executionApprovalAudit.test.ts` (STEP 20) exercises the approval & audit boundary
  offline: the five approval states and nine audit event types + guards, the
  approved-only gate, read-only ops never requiring approval vs mutations always requiring it,
  `normalizeExecutionAuditEvent` (bounded `safeSummary`, ISO `performedAt`, actor whitelist),
  and labels.
- `src/test/tripPlanningProposal.test.ts` STEP 20 adds AI-boundary regressions: proposals
  carrying `capabilities`, `providerResults`, `adapter`, `adapterProfile`,
  `verificationResult`, `producerResult`, `bookingLifecycle`, `bookingState`, `lifecycle`,
  `executionOperation`, `executionResult`, `auditEvent`, `approvalState`, or
  `providerOperations` normalize to `null`, and `ALLOWED_PROPOSAL_UPDATE_KEYS` remains exactly
  the five AI-owned Step-14 sections.
- `src/test/dependencyBoundary.test.ts` STEP 20 adds a guardrail: the provider modules stay
  exactly seven files under `src/domain/providers/`, they import none of
  react/react-router/zustand/firebase/services/components/fetch/axios/stripe/
  `@google-cloud`/`process.env`, and `verificationProducer`/`bookingLifecycle` introduce no
  cross-boundary cycles.
- `src/test/discoveryInput.test.ts` (STEP 21) exercises the discovery query boundary offline:
  43 tests covering both discovery categories, the boundary/bounds constants,
  `normalizeTripDiscoveryQuery` (trimming, ISO calendar-date validation, end-without-start and
  end-before-start rejection, traveler-count bounds, currency normalization), unknown-key
  rejection (nothing is guessed), and `getTripDiscoveryQueryProblem` (never throws across the
  problem matrix).
- `src/test/mockProviders.test.ts` (STEP 21) exercises the mock adapter registry offline: both
  adapters declare read-only `search-*` capabilities as available with `verify-reference`
  `temporarily-unavailable` and booking/cancellation `unsupported`, the category→capability map
  is exact, and the read-only `search` outcome normalizes to the STEP 20 `TripProviderResult`
  shape (the mock layer never books, verifies, or cancels).
- `src/test/mockDiscoveryService.test.ts` (STEP 21) exercises the read-only discovery service
  offline: `discoverTripOptions` maps success/empty/unsupported/provider-failure/
  invalid-input/unexpected-failure for the fixture and sentinel destinations, consults the
  STEP 20 capability guard before searching (unsupported category → `unsupported`), is
  deterministic for identical `(raw, now)`, and performs no persistence — same-tolerant
  error paths surface bounded safe categories only.
- `src/test/DiscoveryPanel.test.tsx` (STEP 21) exercises the presentational discovery panel:
  idle/loading/submit states, all outcome states (results, empty, unsupported, provider-failure
  alert, invalid-input alert, unexpected failure), the `MOCK_RESULT_DISCLAIMER` note + "Mock
  data — read-only" pill, provider/source identity on result cards, the STEP 20 recency/expiry
  warning, searched-at + Clear actions, and the absence of any book/reserve/pay/verify/confirm
  affordance.
- `src/test/TripWorkspacePage.test.tsx` STEP 21 adds a describe (`TripWorkspacePage read-only
mock discovery`) covering the wiring end-to-end: a successful search shows the mock
  transport result ("Mock Express Rail", "Mock Transport Provider · mock-transport-1",
  149.00 USD), `MOCK-EMPTY-RESULTS` renders the empty message, `MOCK-PROVIDER-FAILURE` renders
  the bounded provider-unavailable alert, an end-date-without-start search renders the
  validation problem,
  and Clear returns to the idle prompt — every test asserts `updateTripPlanning`/`updateTrip`
  are **never** called.
- `src/test/tripPlanningProposal.test.ts` STEP 21 adds AI-boundary regressions: proposals
  carrying `discovery`, `discoveryQuery`, `discoveryResults`, `mockResults`, `providerSearch`,
  `simulatedOptions`, `discoveryOutcome`, `mockDiscovery`, `adaptersConsulted`, or
  `availability` — including nested payloads — normalize to `null`, and merging never
  introduces a discovery key into the draft.
- `src/test/dependencyBoundary.test.ts` STEP 21 adds a guardrail: the `mockDiscovery` service
  modules are deterministic and boundary-clean (no react/firebase/services/components/clock/
  `fetch`/network imports, nothing booking/paying/verifying/cancelling, no Firestore or
  persistence vocabulary) and the provider module list grows to exactly eight files.
- `src/test/discoveryHandoff.test.ts` (STEP 22) exercises the handoff domain module offline:
  12 tests covering `getDiscoveryHandoffPlanId` determinism, the `getDiscoveryHandoffProblem`
  guard (current transport/accommodation results and results without `expiresAt` pass;
  activity/other categories and expired quotes are refused with honest problem text),
  `mapDiscoveryResultToHandoffPlan` transport + accommodation mapping (provider, locations,
  times, reference, `sourceUrl`, readiness `planned`, and the full provenance `notes` —
  5 labels + provider, result id, retrieved-at, sample price, duration, cancellation policy,
  limitations), and the `null` cases (expired, non-planning categories, unsafe `sourceUrl`).
- `src/test/tripPlanning.test.ts` STEP 22 adds plan-guard regressions: transport + accommodation
  plans accept safe `http`/`https` `sourceUrl` (trimmed), reject `javascript:`/non-URL/numeric
  values with `null`, and drop whitespace-only values.
- `src/test/tripSerializationModel.test.ts` STEP 22 adds snapshot-boundary regressions: safe
  `sourceUrl` values round-trip on transport/accommodation plans and snapshots carrying unsafe
  `sourceUrl` values are rejected.
- `src/test/DiscoveryPanel.test.tsx` STEP 22 adds a handoff describe: `Use as planning
reference` forwards the selected result to `onImport`, an already-drafted plan id renders
  "Added to planning draft" and disables the button, an expired result renders "Cannot add"
  with the expiry problem text, and the `role="status"` notice appears with "Added “{title}”
  to your planning draft as a user-entered reference." plus a Remove from draft button that
  calls `onRemove` with the handoff plan id.
- `src/test/TripWorkspacePage.test.tsx` STEP 22 adds a describe (`TripWorkspacePage STEP 22
discovery-to-planning handoff`) covering the wiring end-to-end: clicking a result's action
  appends a `handoff-` plan with provenance notes into the existing draft and the explicit
  Save planning persists it via `updateTripPlanning`, an already-present handoff plan id is
  treated as imported and the card is de-duplicated, Remove from draft discards the local plan
  without ever calling `updateTripPlanning`, and editing the Source URL (after opening the
  transport frame's Edit) carries the trimmed value into save.
- `src/test/dependencyBoundary.test.ts` STEP 22 adds a guardrail: `src/domain/discovery/`
  contains exactly `handoff.ts` — pure (no react/router/zustand/firebase/services/components/
  `fetch`/network/env), no clock reads (deterministic given `now`), no persistence or
  Firestore, and no booking/payment vocabulary.
- `src/test/tripPlanningProposal.test.ts` STEP 19 adds AI-boundary regressions: proposals
  carrying `verification`, `executionStatus`, `readiness`, or `executionRecords` keys
  normalize to `null`, and merging a proposal never introduces those keys into the draft.
- `src/test/dependencyBoundary.test.ts` STEP 19 adds a guardrail: `verificationState.ts` stays
  provider-/checklist-free (no `executionChecklist`, `react`, `firebase`, `fetch`, axios,
  stripe, or provider-api imports).
- `src/test/tripPlanningProposal.test.ts` (STEP 15) exercises the pure AI proposal model
  offline: `normalizeTripPlanningRequest` (whitelisted keys, instruction trimming/
  bounding/missing), `normalizeTripPlanningProposal` (envelope whitelist, every editable
  section accepted, missing/empty explanation rejected, non-string warnings dropped, unknown
  envelope keys rejected, transport/accommodation/budget updates rejected, malformed date
  ranges/destinations/duplicate ids/days/activities/unsafe reference urls rejected wholesale,
  non-array section values rejected), `mergePlanningProposalIntoDraft` (override present /
  preserve untouched incl. stable-id preservation / `dateRange: null` clears / bare-trip-key
  construction / no input mutation / clean application through the shared workspace boundary),
  and `summarizeProposalChanges` (per-section current → proposed rows, plain deterministic
  text, no mutation). STEP 17 adds a merge-preservation case: a draft carrying per-plan
  `readiness` keeps those labels through the merge (readiness is plan data, not an AI
  proposal key).
- `src/test/aiPlanningService.test.ts` (STEP 15) exercises the generation boundary against a
  hoisted `firebase/ai` mock + mocked `./firebase` (`getAIService`): a valid proposal is
  normalized and returned; a partial update (only dates) is honored; unparseable JSON,
  non-JSON, unknown keys, empty explanation, invalid date ranges, invalid destinations,
  invalid activities, invalid references, unsafe reference urls, and duplicate destination
  ids all reject as `invalid-output`; retriable provider errors fall back across model
  aliases and an exhausted-alias set surfaces a safe retriable error; non-retriable and
  wrapped provider errors map to safe pre-baked messages that never contain raw provider
  text; and no call ever touches `tripService`/Firestore (draft-only boundary).
- `src/test/TripWorkspacePage.test.tsx` STEP 15 describe (`TripWorkspacePage AI planning
suggestions`) covers the editor flow: a suggestion is drafted and persisted **only after
  explicit approval** (asserts `updateTripPlanning` is not called until "Save planning" and
  is then called with the exact merged payload); an approved proposal is **merged** into the
  existing draft rather than replacing it; Discard restores the previous draft; generation
  failures show a safe `AiPlanningError` message and a generic safe message for unexpected
  failures (`updateTripPlanning` never called in either case); title/status/delete/planning
  controls disable while generating; navigation-away stale responses are dropped; and a
  **failed save keeps an approved suggestion applied** (preview + applied badge + proposed
  end date + Unsaved pill all persist, Save re-enabled for retry, exactly one
  `updateTripPlanning` attempt).
- `src/test/tripSerializationModel.test.ts` exercises the pure itinerary guard/normalizer:
  valid snapshots, sanitization of runtime-only/unknown top-level keys, and rejection of
  malformed destination/duration/budget/day plans/activities (incl. coordinates)/transport/
  hotels. STEP 16 adds the plan sections; STEP 17 adds per-plan `readiness` acceptance and
  rejection of booking-claim / malformed states (note carried as-is on object reads);
  STEP 18 adds `tasks` acceptance, runtime-key stripping, and wholesale rejection of
  malformed / duplicate-id tasks.
- `src/test/tripPlanningEdit.test.ts` (STEP 14/16/17/18) and `src/test/tripService.test.ts`
  cover the STEP-18 checklist through the editing and persistence boundaries:
  normalize/apply validate `tasks` wholesale, `tasks: null` and `tasks: []` clear a stored
  checklist, deep-clone/no-aliasing on apply, the legacy no-itinerary no-op, duplicate-id
  rejection before any Firestore query, problem messages ("Every checklist task needs a
  category, a title, and a valid due date." / "Checklist task ids must be unique."), the
  dirty-collapse (`collapseTripTasks`), and `updateTripTasks` persist round-trips.
- **Destination cap (20).** `MAX_TRIP_DESTINATIONS` bounds a trip's destination list and is
  enforced at three layers that stay in step: `firestore.rules` `validDestinations`
  (bounded, index-by-index) with the unchanged-legacy-list exception in
  `destinationsAcceptable`; `tripPlanningEdit.getDestinationLimitProblem` +
  `getPlanningUpdateProblem`'s optional `{ existingDestinations }` context; and
  `tripService.updateTripPlanning`, which rejects a changed over-limit list with a
  `TripValidationError` after the ownership read (so malformed updates still reject before
  any `getDoc`). `PlanningEditor` disables Add at the cap, shows "A trip can have at most 20
  destinations.", and (for a legacy over-limit trip) blocks Save until the list is reduced
  to the cap. Covered by `tripPlanningEdit.test.ts` (`destination cap`),
  `tripService.test.ts` (unchanged legacy list persists alongside an unrelated edit;
  growth/shrink-to-24 rejected; shrink-to-20 allowed), and `PlanningEditor.test.tsx`.

- `src/test/tripPlanningProposal.test.ts` STEP 18 adds AI-boundary regressions: a proposal
  carrying `update.tasks` (or a `checklist` wrapper) normalizes to `null` (outside the
  whitelist), and `mergePlanningProposalIntoDraft` preserves any existing draft tasks.
- `src/test/ItineraryView.test.tsx` covers the promotion trigger: the button is absent
  without the callback prop and fires the callback when present.
- `src/test/Navbar.test.tsx` verifies navigation under a `MemoryRouter` with a
  `LocationProbe`: default explore active, desktop/mobile tab clicks update the URL and the
  active styling, logo → `/explore`, profile route/avatar → `/profile`, and the profile tab
  matching both desktop and mobile buttons via `getAllByRole`.

## Linting

ESLint uses the flat config format (`eslint.config.js`). It focuses on correctness:

- TypeScript correctness (`typescript-eslint`)
- React correctness (`eslint-plugin-react`)
- React Hooks rules (`eslint-plugin-react-hooks`)
- Vite fast-refresh rules (`eslint-plugin-react-refresh`)

Formatting concerns are intentionally excluded from ESLint — Prettier owns formatting
(`eslint-config-prettier` disables any conflicting rules).

## Formatting

Prettier configuration lives in `.prettierrc.json`:

- Semicolons: yes
- Quotes: single
- Print width: 100
- Trailing commas: es5

`.prettierignore` excludes build output, node_modules, generated Data Connect files, and
logs. If a file is flagged by `npm run format:check`, format it with `npm run format` or
`npx prettier --write <file>`.

## Error Boundary

`src/components/ErrorBoundary.tsx` is a class-based React Error Boundary that wraps the root
`<App />` in `src/main.tsx`. If any descendant throws during render, the boundary:

- Shows a safe "Something went wrong" recovery panel (styled with the VoyageAI design system)
- Provides a **Try Again** button that re-renders children via local state reset
- Logs diagnostic details to the console in development only; production logs a minimal identifier

The boundary never force-reloads the page, so it cannot create an infinite reload loop. If the
error re-occurs when children re-render, the fallback is shown again.

## Deployment (Firebase Hosting + Cloud Functions)

The app ships as a static Vite build (`dist/`) on Firebase Hosting plus the Node 20 Cloud
Functions in `functions/` (runtime `nodejs20`). The default project is
`my-first-project-55f9a`; confirm it with `npx firebase-tools use` before deploying.

### Required production build config (names only)

A production `npm run build` requires the four core Firebase web values, sourced from the
build environment (for example `.env.production`, which is gitignored). Only the names are
documented here — never their values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Optional values (not required to boot): `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, and — for production
App Check — `VITE_RECAPTCHA_SITE_KEY` (public by design). The server-side provider keys
described in `.env.example` must never use the `VITE_` prefix.

The build fails fast, naming any missing required variable, via the
`voyageai-validate-firebase-env` plugin in `vite.config.ts` (pure rules in
`src/config/firebaseEnv.ts`). It runs only for `vite build` in `production` mode, so
`npm run dev` and the test suite are unaffected.

### Functions build & predeploy

`firebase.json` declares a `functions.predeploy` hook:

```json
"predeploy": ["npm --prefix functions run build"]
```

The CLI runs predeploy hooks from the **project root**, so the relative `--prefix functions`
reliably compiles `functions/src/index.ts` to `functions/lib/functions/src/index.js` (per
`functions/tsconfig.json`) immediately before deploying — a functions deploy never ships
stale compiled output. The hook assumes the Functions dependencies are installed; run
`npm --prefix functions install` once in a fresh checkout (or after dependency changes).

### Scoped deploy commands

```bash
npm run build                                        # type-check + build dist/ (needs the required VITE_FIREBASE_* config)
npx firebase-tools deploy --only functions,hosting   # predeploy compiles functions, then ships dist/
npx firebase-tools deploy --only hosting             # static app only
npx firebase-tools deploy --only functions           # Cloud Functions only (predeploy still builds)
npx firebase-tools deploy --only firestore:rules     # Firestore rules (firestore.rules)
```

Deployment is a manual, reviewed step — never wire it into the test suite or CI test jobs.

## What not to do

- Do not commit `.env.local`, `.env.production`, or any real keys/tokens (gitignored).
- Do not run `npx eslint --fix` or `npm run format` across the whole repository unprompted —
  pre-existing violations are being resolved systematically in later steps.
