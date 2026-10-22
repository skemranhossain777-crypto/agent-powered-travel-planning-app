# VoyageAI — Current Architecture

This document describes the VoyageAI architecture **as it actually exists today**.
It is a baseline snapshot to be used before any refactoring begins. It is not a
target-state design.

---

## A. System Overview

VoyageAI is a client-side single-page application (React 18 + TypeScript + Vite). There
is no server-operated runtime of its own: all dynamic behavior is produced in the browser
and backed by Firebase services plus public web APIs.

The application is organized into seven rough layers:

1. **Routing & composition** (`src/routes.ts`, `src/AppRoutes.tsx`) — typed URL↔view mapping
   (`/explore`, `/bookmarks`, `/itineraries`, `/profile`; plus the trip route
   `/trips/:tripId`), root/unknown-path redirects, and the router→store sync. `main.tsx`
   mounts `BrowserRouter` around `AppRoutes`.
2. **UI components** (`src/components/`) — presentational React components plus a set of
   "smart" components that talk to services directly (`TripWorkspacePage` is one such
   smart component).
3. **App orchestration** (`src/App.tsx`) — a single large component that owns most
   cross-cutting state and discovery/data workflows. View content is conditionally rendered
   from the store, which the URL drives.
4. **UI stores** (`src/stores/`) — Zustand stores for global UI state. Currently only
   `uiStore.ts` exists (active view + reset); the URL is the single source of truth for the
   active view and the store only mirrors it.
5. **Services** (`src/services/`) — typed modules that encapsulate Firebase, AI, location,
   and image-resolution integrations. STEP 09 adds two Trip modules: `tripService.ts` (the
   Firestore boundary for `trips/{tripId}`) and `tripSerialization.ts` (a pure, SDK-free
   document↔domain mapper).
6. **Domain types** (`src/types/`) — shared vocabulary. `travel.ts` holds the existing
   domain interfaces (places, users, itineraries, reviews, bookmarks, activity, geometry);
   `trip.ts` holds the future **Trip Workspace** model; `src/utils/validation.ts` provides
   runtime JSON guards used at service boundaries.
7. **Pure domain utilities** (`src/domain/trips/tripModel.ts`) — deterministic, side-effect
   free Trip Workspace helpers (assembly, date-range math, permissions, an adapter from the
   existing `Itinerary`, and the lifecycle policy: normalized title, explicit status
   transitions, delete eligibility). No React/Firebase/Zustand/network.

The app has three AI workflows (place discovery, itinerary generation, concierge chat), a
signed-in user area (profile, bookmarks, saved trips, reviews, activity feed), an admin
dashboard (signed-in privileged user), and an offline-friendly local persistence layer
that mirrors to Firestore. It provides no booking, payment, maps, or real-time features.
The **Trip Workspace** model (STEP 08) is persisted and routed (STEP 09): a user-owned
`trips/{tripId}` document written through `tripService` under owner-scoped rules,
reachable at `/trips/:tripId`, and created from a generated `Itinerary` via the
"Create Trip Workspace" action in `ItineraryView`. It is still a planning shell only.
There is no routing split; all views live in one SPA, and Firebase Hosting rewrites
every path to `index.html` (SPA fallback) so deep links/refreshes resolve to the entry.

---

## B. Runtime Entry Flow

```
index.html
  └── src/main.tsx
        React.StrictMode
          └── ErrorBoundary (src/components/ErrorBoundary.tsx)
└── BrowserRouter (react-router-dom)
                    └── AppRoutes (src/AppRoutes.tsx)
                          ├── ViewRoute(view) → SyncActiveView + App (src/App.tsx)
                          │     ├── Navbar            (navigates + active tab from URL)
                          │     ├── Hero              (props)
                          │     ├── PlaceExplorer     (props)
                          │     ├── Bookmark/Profile props via sub-views
                          │     ├── ItineraryView     (props, + trip workspace promotion)
                          │     ├── AiPlannerModal    (calls aiAgent + geolocation directly)
                          │     ├── PlaceDetailsModal (calls dataConnect directly)
                          │     ├── ReviewModal       (props)
                          │     ├── AiChatDrawer      (calls aiAgent + geolocation directly)
                          │     ├── AuthModal         (calls authService directly)
                          │     ├── AdminDashboard    (calls firestoreService + authService directly)
                          │     ├── NotificationToast (props)
                          │     └── Footer            (inline JSX)
                          └── TripWorkspacePage (src/components/trips/TripWorkspacePage.tsx)
                                // /trips/:tripId — the FIRST routed page outside `App`
                                ├── authService  (subscribe for the owner gate)
                                ├── tripService  (getTrip by id; renameTrip /
                                │                 updateTripStatus / deleteTrip via the
                                │                 session-derived ownerId; errors → safe states)
                                ├── tripModel    (lifecycle policy: allowed transitions,
                                │                 title normalization — from the domain)
                                └── TripWorkspaceView (presentational, from STEP 08)
At App mount: firebase.ts initialized on import → authService constructor starts
onAuthStateChanged → dataConnectService constructor hydrates localStorage seed data.
```

Routing details:

- `main.tsx` wraps `<AppRoutes />` in `BrowserRouter` (inside `ErrorBoundary`, under
  `React.StrictMode`).
- `AppRoutes` defines `/`, `/explore`, `/bookmarks`, `/itineraries`, `/profile`,
  `/trips`, `/trips/:tripId`, and a catch-all. `/` and unknown paths redirect to
  `/explore`. Each view
  path renders a `ViewRoute` that syncs the URL to `uiStore.activeView` (one direction only)
  and renders the single persistent `App`. `/trips` renders the standalone owner list
  `MyTripsPage` and `/trips/:tripId` renders the standalone `TripWorkspacePage` instead of
  `App` (the list route is registered first so it wins for the exact `/trips` path).
- Route definitions are colocated in `src/routes.ts` (typed `VIEW_PATH` / `pathToView`)
  and `src/AppRoutes.tsx` (the composition layer).

Entry detail:

- `App` subscribes to auth changes once (`authService.subscribe`) and loads initial
  categories + the Explore feed once on mount.
- `App` passes data/handlers down to most views via props, but several components reach
  into services directly (see Dependency Direction).
- **SPA fallback:** `firebase.json` hosting rewrites `**` → `/index.html`, so refreshing or
  deep-linking to any route (e.g. `/bookmarks`) serves the same SPA entry. This predates
  routing and is unchanged.

---

## C. Current Layer Map

| Layer / Module                                                                                                                                                                                                                                                      | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`                                                                                                                                                                                                                                                      | Root render; wires ErrorBoundary + BrowserRouter + AppRoutes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/routes.ts`                                                                                                                                                                                                                                                     | Typed URL↔view mapping: `VIEW_PATH` (`/explore`, `/bookmarks`, `/itineraries`, `/profile`), `TRIPS_PATH` + `tripPath(tripId)`, `pathToView`, `viewToPath`. Pure, no React.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/AppRoutes.tsx`                                                                                                                                                                                                                                                 | Composition layer: route table (incl. `/trips` → `MyTripsPage` before `/trips/:tripId` → `TripWorkspacePage`), root/unknown → `/explore` redirects, and `ViewRoute` which syncs URL→`uiStore` (one-way) and renders the persistent `App`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/ErrorBoundary.tsx`                                                                                                                                                                                                                                  | Catches render errors; shows recovery UI; never reloads the page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/App.tsx`                                                                                                                                                                                                                                                       | Orchestration: auth-driven session state, view content via `uiStore.activeView` (URL-driven), Explore feed loading (AI + location + fallback), category discovery, keyword discovery, load-more pagination, bookmarks/reviews/itineraries flows, trip-workspace promotion, toasts, modal coordination.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/components/*` (Hero, Navbar, PlaceExplorer, PlaceImage, ItineraryView, BookmarksView, ReviewModal, NotificationToast)                                                                                                                                          | Presentational; receive data + callbacks via props. `ItineraryView` may render an optional "Create Trip Workspace" button (callback from `App`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/components/AuthModal.tsx`                                                                                                                                                                                                                                      | Sign-in UI; calls `authService` directly (Google, email/password, reset).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/AiPlannerModal.tsx`                                                                                                                                                                                                                                 | Planner form; calls `aiAgent.generateItinerary` and `geolocation` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/components/AiChatDrawer.tsx`                                                                                                                                                                                                                                   | Concierge chat UI; calls `aiAgent.processChatMessage` + `geolocation` directly; renders markdown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/components/PlaceDetailsModal.tsx`                                                                                                                                                                                                                              | Detail view; calls `dataConnect.getReviewsForPlace` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/components/trips/TripWorkspace.tsx`                                                                                                                                                                                                                            | **Presentational boundary** `TripWorkspaceView`: renders a `TripWorkspace` (title, status, date range, destinations, "Workspace foundation" placeholder, and — when present — the `TripItinerarySnapshot` as an itinerary overview with day-by-day plan, transport, and accommodation sections). No fetching, no state, no route, no services. Mounted by `TripWorkspacePage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/components/trips/TripWorkspacePage.tsx`                                                                                                                                                                                                                        | **Trip workspace page** at `/trips/:tripId`: the first routed page outside `App`. Reads `tripId` from the URL, subscribes to `authService`, loads via `tripService.getTrip`, and renders `TripWorkspaceView` with loading / not-found / unauthorized / error / success states. When loaded, a `SuccessContent` editing boundary lets the owner edit the trip title and itinerary overview (saved via `tripService.updateTrip` for itinerary trips, else `tripService.renameTrip`; Save locked until dirty, non-empty, and not already saving; inline error on failure) plus a **lifecycle card**: a status `<select>` offering only the current status + the domain-allowed transitions (disabled on terminal statuses; saved via `tripService.updateTripStatus`) and a **Delete trip** zone requiring explicit confirmation (`confirming → deleting`), navigating to `/trips` on success and staying with a safe error on failure. STEP 14 adds a `PlanningEditor` block for structured planning sections (dates, destinations, days, notes, references) saved via `tripService.updateTripPlanning` (explicit "Save planning" only). STEP 15 adds the **AI planning-assist flow**: the page owns an `AiAssistState` that sends the current structured `TripPlanningData` + the user's plain-text instruction to `aiPlanningService.generateTripPlanningProposal`, shows the proposal's diff + warnings + assumptions, merges an explicitly approved proposal into the local `PlanningDraft` (never persisted by the AI — saving always flows through `updateTripPlanning`), restores the previous draft on discard, and maps all AI errors to safe pre-baked messages. STEP 16 adds the **explicit transport / accommodation / budget planning sections** — persisted as `transportPlans` / `accommodationPlans` / `budgetPlan` on the itinerary snapshot through the same `updateTripPlanning` path. STEP 17 persists each plan's optional execution-readiness label (`readiness`) through the same `updateTripPlanning` path. STEP 18 adds the user-authored **execution-preparation checklist** — the ninth editable planning section (`tasks`) — persisted on the itinerary snapshot through the same `updateTripPlanning` path and rejected on legacy no-itinerary workspaces like the other itinerary sections. Its "Back" link goes to `/trips`. |
| `src/components/trips/PlanningEditor.tsx`                                                                                                                                                                                                                           | **Structured planning editor boundary** (STEP 14): a presentational component (mounted by `TripWorkspacePage`) that renders the five editable planning sections (dates, destinations, days/activities, notes, references) plus an "Unsaved changes" pill and explicit "Save planning"; days/notes/references are gated behind a hint when the workspace has no itinerary. STEP 15 adds the **AI suggestion block**: an instruction textarea (bounded to `MAX_PLANNING_INSTRUCTION_LENGTH`), a "Generate suggestion" action with a loading state, a preview of the proposal (explanation, warnings, assumptions, and a current → proposed diff via `summarizeProposalChanges`), and per-proposal Apply/Discard actions. STEP 16 adds the explicit **transport plans**, **accommodation plans**, and **budget plan** editors (each with its own Edit/Cancel frame and explicit removal; the budget plan has auto-totaled cost, currency, and five named allocations with a "Clear budget plan" action). It re-exports the `PlanningDraft` type and the `AiAssistState` / `PlanningSaveState` state shapes the page owns. STEP 17 renders a read-only execution-readiness chip on each transport/accommodation plan card via `getTripExecutionReadinessLabel` (defaults to "Planned"); the label is a planning-data status and never claims a booking. STEP 18 adds the explicit **checklist** editor: read-only neutral task rows with an Edit affordance, then status/category/title/due-date rows with remove actions, description and note rows, an optional related-plan select + plan-id input, an "Add task" action (local `tsk-` id, default `general`/`pending`), and an explicit Cancel. Saving blocks untitled tasks with a clear problem message; the checklist is user-authored only (never AI-suggested). No fetching, no services, no router.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/trips/MyTripsView.tsx`                                                                                                                                                                                                                              | **My Trips presentational boundary** `MyTripsView`: a pure view over `MyTripsViewState` (loading, signed-out, error with a message, empty, or ready with trips). No fetching, no state, no route, no services — row taps fire `onOpenTrip(id)`; signed-out/empty prompts fire `onBrowse`. Uses `tripModel.getTripDurationDays` for per-row duration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/components/trips/MyTripsPage.tsx`                                                                                                                                                                                                                              | **My Trips owner list** at `/trips` (standalone, outside `App`): subscribes to `authService`, fetches via `tripService.listTripsForOwner(user.id)` (loading guard across auth transitions), maps errors to safe text (`TripPermissionError` → "You do not have access to this list.", else a generic retry message), and routes row taps to `tripPath(id)`. Re-fetches when the signed-in user changes; renders a signed-out prompt when unauthenticated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/types/trip.ts`                                                                                                                                                                                                                                                 | **Trip Workspace domain types** (`TripId`, `TripStatus`, `TripVisibility`, `TripMemberRole`, `TripDateRange`, `TripDestination`, `TripWorkspace`, `TripItinerarySnapshot`, activity/transport/accommodation references). Pure: no React/Firebase/Zustand, no `any`, string IDs + ISO dates. STEP 17 adds `TripExecutionReadinessState` / `TripExecutionReadiness` — an optional per-plan `readiness` label on `TripTransportPlan` / `TripAccommodationPlan`. STEP 18 adds the execution-checklist vocabulary `TripTaskStatus` / `TripTaskCategory` / `TripTaskRelatedSection` / `TripChecklistItem`, an optional `tasks` key on `TripItinerarySnapshot`, and `tasks?: TripChecklistItem[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | null`on`TripPlanningUpdate` (`null`clears the checklist). STEP 19 adds the provider-independent verification vocabulary`TripVerificationState`(seven states) /`TripEvidenceSourceKind`/`TripVerificationEvidence`/`TripBookingCategory`. |
| `src/domain/trips/tripModel.ts`                                                                                                                                                                                                                                     | **Pure Trip utilities**: `createDraftTrip`, `isTripDateRangeValid`, `getTripDurationDays`, `canViewTrip`, `canEditTrip`, `itineraryToTripWorkspace` (carries the generated itinerary through as a `TripItinerarySnapshot`), `toTripItinerarySnapshot` (non-mutating deep copy for the workspace), plus the **lifecycle policy**: `normalizeTripTitle` (trim + non-empty; never silently truncates), `TRIP_STATUS_TRANSITIONS` + `canTransitionTripStatus` / `getAllowedTripStatusTransitions` / `isEditableTripStatus` (explicit status matrix), and `canDeleteTrip`. Deterministic and side-effect free; time values are passed in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/services/tripSerialization.ts`                                                                                                                                                                                                                                 | **SDK-free Firestore mapper** for `TripWorkspace`: `tripToFirestore`, `tripFromFirestore` (duck-typed `toDate()` timestamps), `serializeTripUpdates` (values + field deletions), `isValidStorageId`, `TripSerializationError`. Itinerary persistence delegates to `tripSerializationModel.ts`. No `firebase/*` imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/services/tripSerializationModel.ts`                                                                                                                                                                                                                            | **SDK-free itinerary validation boundary** (pure): `isTripItinerarySnapshot` type guard + `normalizeTripItinerarySnapshot` (returns a sanitized snapshot with only declared keys, or `null`). Nested shape checks for day plans, activities (incl. optional coordinates), transport, hotel options, and STEP 16 the explicit `transportPlans` / `accommodationPlans` / `budgetPlan` (with unique plan ids). STEP 17 accepts the optional per-plan `readiness` label (booking-claim `externally-verified` states are rejected as user-supplied; malformed shapes reject the snapshot). STEP 18 validates the optional `tasks` array through the shared `normalizeTripChecklistItem` normalizer (`normalizeTaskArray`; duplicate task ids reject the snapshot). No `firebase/*` imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/services/tripService.ts`                                                                                                                                                                                                                                       | **Trip persistence boundary** (`trips/{tripId}`, owner-scoped): `createTrip`, `getTrip`, `updateTrip`, `renameTrip` (normalizes the title, verifies ownership, writes via `updateTrip`), `updateTripStatus` (validates the status is known and the transition is legal per `tripModel` against the persisted current status), `updateTripPlanning` (STEP 14: the single narrow write for the structured planning sections — normalize the payload, reject itinerary-section edits on a legacy no-itinerary workspace, apply, patch only changed canonical fields; STEP 16 extends it to persist `transportPlans` / `accommodationPlans` / `budgetPlan` and to clear a stored budget on `budgetPlan: null`; STEP 17: each plan's optional `readiness` rides the same `updateTripPlanning` write path unchanged; STEP 18 extends it to persist / clear the user-authored `tasks` checklist), `deleteTrip` (with optional `ownerId` for existence/ownership verification before delete), `listTripsForOwner` (`where('ownerId','==',uid)`, skips un-mappable docs, sorts by `updatedAt` newest-first client-side); typed errors (`TripNotFoundError`, `TripPermissionError`, `TripValidationError`, `TripParseError`); Firestore-error mapping without leaking raw SDK messages. The session-derived `ownerId` is passed in by callers — the URL trip id is an identifier only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/domain/trips/tripPlanning.ts`                                                                                                                                                                                                                                  | **Structured planning projection** (STEP 13): pure, SDK-free domain owning `buildTripPlanningData` (workspace → `TripPlanningData` surface), `isTripPlanningData`, `normalizeTripPlanningData` (whitelists keys, shape-checks days/transportation/accommodation/notes/references, fuses date range, clamps day numbers), `getTripDayDate`, and the shared section guards `isTripDateRange` / `isTripDestinationRecord` / `isActivityRecord` / `isTripPlanningReference` / `isSafeHttpUrl`. STEP 16 adds the plan guards and normalizers `isTripTransportPlan` / `normalizeTripTransportPlan`, `isTripAccommodationPlan` / `normalizeTripAccommodationPlan`, and `isTripBudgetPlan` / `normalizeTripBudgetPlan` (unknown allocation keys are dropped). STEP 17: the transport/accommodation plan normalizers accept the optional `readiness` label, normalized through `executionReadiness.normalizeTripExecutionReadiness` (malformed readiness rejects the whole plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/domain/trips/tripPlanningEdit.ts`                                                                                                                                                                                                                              | **Structured planning edit boundary** (STEP 14): pure, SDK-free domain owning `normalizeTripPlanningUpdate` (strict wholesale validation shared by manual editing **and** AI proposals), `applyTripPlanningUpdate` (deep-clone successor; never mutates), `isPlanningUpdateDirty`, `getPlanningUpdateProblem`, `PlanningDraft` / `stripTripId`. STEP 16 adds the **eight-section** update model (`ALLOWED_UPDATE_KEYS`), the per-section helpers `updateTripTransportPlans` / `updateTripAccommodationPlans` / `updateTripBudgetPlan`, and `collapseEmptyBudgetPlan` (an empty `budgetPlan` collapses to a null/absent budget). STEP 17: `clonePlanWithReadiness` deep-clones the optional per-plan `readiness` through `applyTripPlanningUpdate` and `cloneSnapshot`. STEP 18 adds the **ninth section** `tasks` to `ALLOWED_UPDATE_KEYS`, the `updateTripTasks` helper (null clears; no-op without an itinerary), `collapseTripTasks` for dirty-checking, and the "Every checklist task needs a category, a title, and a valid due date." / "Checklist task ids must be unique." problem messages. Reuses `tripPlanning`'s guards + `executionChecklist.normalizeTripChecklistItem`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/domain/trips/executionReadiness.ts`                                                                                                                                                                                                                            | **Execution-readiness vocabulary** (STEP 17): pure, SDK-free domain owning `TRIP_EXECUTION_READINESS_STATES`, `isTripExecutionReadinessState` / `isTripExecutionReadiness` guards, `normalizeTripExecutionReadiness` (unknown state or non-string note → null; note trimmed and dropped when empty), `getTripExecutionReadinessLabel` (Planned / User-entered reference / Verified externally / Cancelled / Unknown), `isExternallyVerifiedState`, and `canUserSetReadinessState` ("booked/provider-confirmed" maps to `externally-verified` and is **not** user-producible). Also carries **DRAFT-ONLY** future execution-record contracts (`TripExecutionRecord` union over `TripTransportExecutionRecord` / `TripAccommodationExecutionRecord` / `TripActivityExecutionRecord` / `TripOtherExecutionRecord`, each tagged with `category: TripBookingCategory`, `state: TripVerificationState`, and `verification: TripVerificationEvidence[]`) that no module imports yet. STEP 19 refined these from the earlier kind-based contracts (the old `TripBookingReferenceRecord` was removed). No `firebase/*`, no React.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/domain/trips/tripPlanningProposal.ts`                                                                                                                                                                                                                          | **Bounded AI proposal model** (STEP 15): pure, SDK-free. `normalizeTripPlanningRequest` (whitelists `currentPlanning`/`instruction`/`constraints`, bounds the instruction at `MAX_PLANNING_INSTRUCTION_LENGTH` = 1000), `normalizeTripPlanningProposal` (whitelists `explanation`/`warnings`/`assumptions`/`update`; the proposed `update` must pass the **same** `normalizeTripPlanningUpdate` used by manual editing, and `ALLOWED_PROPOSAL_UPDATE_KEYS` restricts the proposal to the five STEP 14 AI-owned sections — dates, destinations, days, notes, references — so the STEP 16 user-editable transport/accommodation/budget/lifecycle/metadata keys are rejected; returns `null` on any malformed, unknown-key, duplicate-id, or unsafe payload), `mergePlanningProposalIntoDraft` (STEP 15 merge: present keys override, absent keys untouched, `dateRange: null` still clears — never mutates inputs), and `summarizeProposalChanges` (plain-text current → proposed diff rows for the preview). No `firebase/*`, no React.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/domain/trips/executionChecklist.ts`                                                                                                                                                                                                                            | **Execution-checklist vocabulary** (STEP 18): pure, SDK-free domain owning `TRIP_TASK_STATUSES`, `TRIP_TASK_CATEGORIES`, `TRIP_TASK_RELATED_SECTIONS`, the guards `isTripTaskStatus` / `isTripTaskCategory` / `isTripTaskRelatedSection` / `isTripChecklistItem`, the strict normalizer `normalizeTripChecklistItem` (rebuilt field-by-field: required id/category/title/status; optional strings trimmed and dropped when empty; real ISO `dueDate` required when present; max lengths 120/500/500/200 enforced by rejection; absent-vs-null → absent), `hasUniqueTaskIds`, and the neutral read-only labels `getTripTaskStatusLabel` / `getTripTaskCategoryLabel` / `getTripTaskRelatedSectionLabel` (never claim a booking or external confirmation). No `firebase/*`, no React.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/domain/trips/verificationState.ts`                                                                                                                                                                                                                             | **External-verification vocabulary & producer boundary** (STEP 19): pure, SDK-free domain owning the seven-state `TripVerificationState` vocabulary (`user-entered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | user-confirmed                                                                                                                                                                                                                           | manually-reviewed | externally-verified | provider-confirmed | cancelled | unknown`), the evidence-source `TripEvidenceSourceKind`enumerator, the strict`normalizeTripVerificationEvidence`(rebuilds each record; reuses`isSafeHttpUrl`; reference values are plain user text), the labels/explanations, the controlled transition gates (`canTransitionTripVerificationState`, `getAllowedUserVerificationTransitions`, `getTripVerificationTransitionProblem`), and the producer-boundary contract: `externally-verified`and`provider-confirmed` are reserved for a future provider-backed producer (`canUserTransitionTripVerificationState`returns false when the current state is producer-only). Nothing is persisted, sent to the AI, or rendered as a control. No`firebase/*`, no React. |
| `src/services/aiPlanningService.ts`                                                                                                                                                                                                                                 | **AI planning generation boundary** (STEP 15): `generateTripPlanningProposal(currentPlanning, instruction)`. Validates the request via `normalizeTripPlanningRequest` (instruction required + bounded), sends only the structured `currentPlanning` + instruction to Gemini via `getGenerativeModel` from `firebase/ai` (same model-alias fallback convention as `aiTravelAgent`), demands strict `application/json` output with a bounded schema, parses the response as `unknown`, normalizes through `normalizeTripPlanningProposal`, and returns a typed `AiPlanningError` (safe pre-baked messages; raw provider errors are never surfaced). **No Firestore import** — the service cannot persist anything by construction; persistence happens only via the explicit `tripService.updateTripPlanning` call a human triggers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/components/ProfileView.tsx`                                                                                                                                                                                                                                    | Profile editing; calls `dataConnect.updateUserProfile` and `authService.signOut` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/components/AdminDashboard.tsx`                                                                                                                                                                                                                                 | Admin UI; calls `firestoreService` and `authService` directly; hardcodes the admin email.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/services/firebase.ts`                                                                                                                                                                                                                                          | Firebase init: app, Auth, Firestore (persistent cache), AI (Gemini Developer API), App Check. Exposes `getFirebaseApp`, `getAuthInstance`, `getFirestoreInstance`, `getAIService`, `FIREBASE_CONFIG`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/services/aiTravelAgent.ts`                                                                                                                                                                                                                                     | Gemini integration: place discovery, itinerary generation, concierge chat. Model-aliasing, retry/fallback, JSON parsing/normalization, discovery caching. `export const aiAgent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/services/authService.ts`                                                                                                                                                                                                                                       | Firebase Auth wrapper: Google popup, email/password, reset, sign-out, auth state subscription, user mapping, friendly errors. `export const authService`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/services/firestoreService.ts`                                                                                                                                                                                                                                  | Real Firestore persistence: users, profiles, sessions, bookmarks, itineraries, reviews, activity, admin reads. `export const firestoreService`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/services/dataConnectService.ts`                                                                                                                                                                                                                                | Local-first data + persistence boundary: seed categories/places/reviews, per-user data in `localStorage`, fire-and-forget mirror to Firestore. **Despite its name it does NOT use Firebase Data Connect.** `export const dataConnect`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/services/geolocation.ts`                                                                                                                                                                                                                                       | Browser Geolocation API wrapper; Nominatim reverse geocoding; country→currency and currency→symbol maps; `describeLocation`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/services/placeImages.ts`                                                                                                                                                                                                                                       | Resolves verified place photos via Wikipedia/Wikimedia Commons; verifies AI-supplied `upload.wikimedia.org` URLs; in-memory 24h cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/types/travel.ts`                                                                                                                                                                                                                                               | Shared domain interfaces (`User`, `Place`, `Itinerary`, `Review`, `Bookmark`, `UserActivityEvent`, `UserLocation`, `ChatMessage`, etc.) plus `BudgetLevel`/`TravelStyle` union aliases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/utils/validation.ts`                                                                                                                                                                                                                                           | Runtime JSON type guards/accessors (`isRecord`, `asOptionalString`, `asOptionalNumber`, `asStringArray`, `asRecordArray`) used at service JSON edges; no domain-specific logic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/stores/uiStore.ts`                                                                                                                                                                                                                                             | Zustand UI store: `activeView` (one of `explore`, `bookmarks`, `itineraries`, `profile`), `setActiveView`, `resetUiState`. UI state only; no domain data, no service instances, no persistence middleware.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/test/`                                                                                                                                                                                                                                                         | Vitest tests + setup (see docs/development.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/domain/providers/` (8 STEP 20/21 contract modules: `providerCapabilities.ts` + `providerResults.ts` + `providerAdapter.ts` + `verificationProducer.ts` + `bookingLifecycle.ts` + `executionOperations.ts` + `executionApprovalAudit.ts` + `discoveryInput.ts`) | **Provider and execution integration architecture** (STEP 20, pure, SDK-free, unconsumed). `providerCapabilities` owns 7 capability ids / 6 statuses / the declaration normalizer / the operational guard (`available` only) / labels + unavailability reasons. `providerResults` owns the single normalized `TripProviderResult` shape (live-planning quotes, never bookings) + availability vocabulary + `expiresAt ≤`-checked timestamps + expiry/recency helpers. `providerAdapter` owns the `ProviderAdapterProfile` normalizer (last-wins dedupe) + the `ProviderAdapter` service interface + deterministic operational-capability queries. `verificationProducer` owns the producer proof-of-evidence boundary (5 outcomes; only `verified` → `externally-verified` and `cancelled` → `cancelled` mint a state; evidence must be provider-sourced + `verifiedAt`-stamped + carry a reference or safe URL; stale results never mint). `bookingLifecycle` owns the 9-state lifecycle matrix (`not_started … provider_confirmed … unknown`), the transition gates, the user-approval-before-submission predicate, the producer-confirmation gate, terminal success/failure classification, and `canBookingTransitionAutomatically() → always false`. `executionOperations` owns the 6-operation / 3-status / 3-retryability / 10-safe-error-category vocabulary + the normalized `ProviderExecutionResult<T>` envelope builders (success/failure/requires-user-action; failures carry only bounded safe errors). `executionApprovalAudit` owns the 5-state approval vocabulary, the 9 audit-event types, the read-only-vs-mutation approval gate (mutations need `approved`), and the `normalizeExecutionAuditEvent` boundary (safe summaries only). `discoveryInput` (STEP 21) owns the read-only discovery query boundary (2 categories, bounded destination/origin/dates/traveler-count/currency, strict unknown-key rejection). **No provider exists today** — no SDK, credential, network, payment, booking, ticket, verification, or cancellation execution; every value is produced only inside these modules and their tests. No `firebase/*`, no React.                                                                                                                                                                                     |
| `src/services/mockDiscovery/` (5 STEP 21 modules: `mockFixtures.ts` + `mockTransportProvider.ts` + `mockAccommodationProvider.ts` + `mockProviders.ts` + `mockDiscoveryService.ts`) + `src/components/trips/DiscoveryPanel.tsx`                                     | **Read-only external discovery (STEP 21, deterministic mock only).** `mockDiscoveryService.discoverTripOptions(raw, now)` is the single entry point: normalize via `discoveryInput`, select the mock adapter, check the STEP 20 `search-*` capability guard, then map the normalized execution envelope to a stable outcome (`success`/`empty`/`unsupported`/`provider-failure`/`invalid-input`/`unexpected-failure`). Two deterministic mock adapters (`Mock Transport Provider` / `Mock Accommodation Provider`) with fixed fixtures, sentinel destinations (`MOCK-EMPTY-RESULTS`/`MOCK-PROVIDER-FAILURE`), `MOCK_SOURCE_URL_PREFIX` sample links, and the required "Simulated sample data - not live availability or a booking." disclaimer on every result. **Read-only**: never calls `tripService`, never persists, never books/pays/verifies/cancels, no network call, SDK, or credential. `DiscoveryPanel` is presentational (search form, category toggle, outcome states, recency/expiry warnings) and is wired by `TripWorkspacePage` through a microtask boundary; results are transient and a search can never mutate the trip, its readiness, or the execution checklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/domain/discovery/handoff.ts` (single STEP 22 module) + optional `sourceUrl` and STEP 23 `provenance` on transport/accommodation plans                                                                                                                          | **User-controlled discovery-to-planning handoff (STEP 22, pure, SDK-free).** `handoff.ts` converts a selected STEP 21 `TripProviderResult` into a **user-entered planning reference** — a `TripTransportPlan`/`TripAccommodationPlan` with deterministic plan id `handoff-<resultId>`, `readiness.planned`, the result's `sourceUrl`, typed **`provenance: { kind: 'mock-discovery', note: … }`** (STEP 23) and provenance `notes` ("imported from simulated discovery", "never a booking"). It owns `DISCOVERY_HANDOFF_PLAN_ID_PREFIX`, `DISCOVERY_HANDOFF_READINESS_NOTE`, `DISCOVERY_HANDOFF_PROVENANCE_NOTE` (equal to the readiness note, STEP 23), `DISCOVERY_HANDOFF_PROVENANCE_LABELS`, `getDiscoveryHandoffPlanId`, `getDiscoveryHandoffProblem` (rejects non-transport/accommodation results and expired quotes) and `mapDiscoveryResultToHandoffPlan` (reuses the STEP 16 plan normalizers, so only valid plan shapes with safe-HTTP-URL `sourceUrl` import). `DiscoveryPanel` renders the per-result **Use as planning reference** action and a `role="status"` "Added … as a user-entered reference." notice with Remove from draft; `TripWorkspacePage` owns the handoff state, dedupes against existing draft plan ids, appends into the existing draft, and persists **only** through the explicit `tripService.updateTripPlanning` save (transport/accommodation plans may carry a `sourceUrl` field, validated by `tripPlanning` and round-tripped by `tripSerializationModel`). Importing books/reserves/prices/verifies nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/domain/trips/planningProvenance.ts` (single STEP 23 module)                                                                                                                                                                                                    | **Planning-reference provenance vocabulary (STEP 23, pure, SDK-free).** Owns the ONLY provenance vocabulary for explicitly-entered transport/accommodation plans: the four-kind marker (`manual` / `ai-generated` / `mock-discovery` / `external-provider`), `MAX_PLAN_PROVENANCE_NOTE_LENGTH = 500`, `normalizeTripPlanProvenance` (rejects unknown kinds/over-long or non-string notes; trims and drops empty notes; strips runtime-only keys), plus `isTripPlanProvenanceKind`, `isTripPlanProvenance`, the honest read-only `getTripPlanProvenanceLabel` / `getTripPlanProvenanceDescription` helpers, and `isSimulatedProvenance` / `isExternalProviderProvenance` predicates. Absent provenance on legacy records stays absent; a missing value is never inferred and an untrusted value is rejected, never guessed. No React, Firebase, Router, Zustand, network, clock, or booking/payment/verification vocabulary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/domain/trips/planningLifecycle.ts` (single STEP 24 module)                                                                                                                                                                                                     | **Planning-reference lifecycle vocabulary (STEP 24, pure, SDK-free).** Owns the ONLY lifecycle vocabulary for explicitly-entered transport/accommodation plans: the four user-controlled states (`active` / `needs-review` / `replaced` / `archived`), `TRIP_PLAN_LIFECYCLE_STATES`, `DEFAULT_TRIP_PLAN_LIFECYCLE_STATE = 'active'`, `isTripPlanLifecycleState`, `normalizeTripPlanLifecycleState` (unknown values reject, never guessed), `getEffectiveTripPlanLifecycleState` (the legacy read-time default `active`, computed but never written back), the honest read-only `getTripPlanLifecycleLabel` / `getTripPlanLifecycleDescription` helpers (wording never claims expiry, staleness, price changes, verification, or a booking), and `isActiveReference` / `requiresPlanReview` / `isArchivedReference` predicates. Strictly user-controlled — no staleness detection, no date math, no timers, no clock, no external freshness source. Replace/archive are decisions, not deletions: nothing invents a replacement record and nothing deletes the plan. The discovery handoff stamps `active` by construction (`DISCOVERY_HANDOFF_LIFECYCLE_STATE`). No React, Firebase, Router, Zustand, network, or booking/payment vocabulary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

| `src/domain/trips/planningReferenceProjection.ts` (single STEP 25 module) | **Lifecycle-consistent read-only plan projection (STEP 25, pure, SDK-free).** Complements `planningLifecycle` with the read-time grouping used by non-editing surfaces: `isLegacyPlanningReference`, `getEffectivePlanningReferenceState` (delegates to the lifecycle `active` default), `isPrimaryPlanningReference` (active/needs-review; legacy included), `isSecondaryPlanningReference` (replaced/archived), `isReplacedPlanningReference`, `isArchivedPlanningReference`, `partitionPlanningReferences` (order-preserving, non-mutating split into primary/secondary), `countPlanningReferences`, `getPlanningReferenceSummary`, and the honest read-only `getPlanningReferenceDisplayLabel` ("Legacy reference — treated as active", "Active", "Needs review", "Replaced reference", "Archived reference"). Imports only `types/trip` and `planningLifecycle`; never writes to a plan, never persists, never imports edit/provenance/readiness vocabulary, and adds no clock, network, Firebase, React, Router, or Zustand dependency. Consumed exclusively by the read-only workspace projection (`TripWorkspace.tsx`). |
| `src/domain/trips/planningReferenceSelection.ts` (single STEP 26 module) | **User-controlled primary reference selection (STEP 26, pure, SDK-free).** Owns the ONLY read-time interpretation of the section-level primary selection (`primaryTransportPlanId` / `primaryAccommodationPlanId`, stored on the itinerary snapshot): `isPrimaryPlanId`, `normalizePrimaryPlanId` (trim; reject non-string/empty), `isPlanEligibleAsPrimary` (effective-active only, legacy read-time default included), `resolvePrimarySelection` (exact vocabulary `no-explicit-selection | valid-explicit-selection | selected-plan-missing | selected-plan-inactive`, with honest `reason` strings), the order-preserving, non-mutating `partitionPlanningReferencesWithPrimary` (selected + eligibleActive + needsReview + secondary), `isPrimarySelectionAttentionState`, and `getPrimarySelectionStatusLabel` (never claims a promotion). Absence is never auto-assigned: nothing promotes the first plan, and a missing/inactive selection is preserved as stored and surfaced as a non-blocking "needs attention" state. Reuses the shared STEP 24/25 lifecycle/projection vocabulary (`planningLifecycle`, `planningReferenceProjection`); imports only `types/trip` and those two modules; no clock, network, Firebase, React, Router, or Zustand, and no booking/payment/verification vocabulary. Consumed by `PlanningEditor` (the select/status control) and the read-only workspace projection (`TripWorkspace.tsx`). |
| `src/domain/trips/planningReferenceConflict.ts` (single STEP 27 module) | **Primary-reference assignment conflict model (STEP 27, pure, SDK-free).** Owns the concise, honest conflict vocabulary layered on the STEP 26 selection: the four-state assignment status `none | valid | missing | inactive` (`resolvePrimaryAssignmentStatus`, plus transport/accommodation conveniences), `isPrimaryAssignmentAttentionNeeded` (missing/inactive), the status label (`getPrimaryAssignmentStatusLabel` — missing/inactive share "Primary assignment needs attention"), the plain-english `getPrimaryAssignmentConflictDetail` (names the stored id; `missing` → "no longer present", `inactive` → named lifecycle label + the user's explicit options: restore, select another active reference, or clear the assignment), `isPlanSelectableAsPrimary` (composed over the STEP 26 eligibility), and the transition-impact predicates `doesLifecycleTransitionCreatePrimaryConflict` (valid/inactive selection moved non-active → conflict; `targetState !== 'active'`) and `doesLifecycleTransitionResolvePrimaryConflict` (the stored inactive selected plan restored to active → conflict resolved; restore never rewrites a primary id). Strictly composed: imports only `types/trip`, `planningLifecycle`, `planningReferenceProjection`, and `planningReferenceSelection`; read-only and non-mutating (reads the stored ids for reporting, never writes, clears, repairs, promotes, or falls back); no clock, network, Firebase, React, Router, Zustand, and no booking/payment/verification vocabulary. Consumed by `PlanningEditor` (guidance paragraph + disclaimer legend + primary/attention card chips + lifecycle-transition hint) and `TripWorkspace.tsx` (attention chip on the referenced-but-inactive row). |
| `src/domain/trips/planningReferenceResolution.ts` (single STEP 28 module) | **Explicit primary-reference conflict resolution vocabulary (STEP 28, pure, SDK-free).** Owns the transient user-action classification that describes _how_ a primary-assignment conflict was resolved in a draft: the four-decision vocabulary `unresolved | selected-another | cleared | restored-selected` (`PrimaryResolutionDecision`), `classifyPrimaryResolutionDecision` (takes prior status, prior selected id, user action, post-action plans; rejects invalid actions as `unresolved` with `resolved: false`), honest read-only labels (`getPrimaryResolutionDecisionLabel`) and descriptions (`getPrimaryResolutionDecisionDescription`) that never claim booking, payment, verification, or reservation confirmation, plus the pure predicates `isPrimaryConflictUnresolved`, `doesActionResolveMissingPrimary`, `doesActionResolveInactivePrimary`, `selectingAnotherActivePlanResolvesConflict`, `clearingPrimaryResolvesConflict`, `restoringSelectedPlanResolvesConflict`, and the compatibility check `isPrimaryResolutionDecisionCompatible` (suppresses stale feedback when the staged state no longer matches the stored decision). No persisted resolution record — the primary ID + lifecycle state are the persisted truth; this module is strictly transient draft feedback. Strictly composed: imports only the STEP 27 conflict vocabulary (`PrimaryAssignmentStatus` type from `planningReferenceConflict`) and the STEP 26 selection model (`SelectablePlan`, `isPlanEligibleAsPrimary` from `planningReferenceSelection`). No clock, network, Firebase, React, Router, Zustand, persistence, mutation, edit plumbing, or booking/payment/verification vocabulary. Consumed by `PlanningEditor` (transient resolution feedback via explicit decision labels; the derived "remains unresolved" note when no explicit action resolves a conflict). |
| `src/domain/trips/planningReferenceChangeContext.ts` (single STEP 29 module) | **Planning-reference change history context (STEP 29, pure, SDK-free).** Owns the transient, user-visible description of how the draft's transport/accommodation planning sections differ from the persisted snapshot: the section-level change state machine `unchanged | primary-selected | primary-changed | primary-cleared | primary-restored | primary-unresolved | lifecycle-changed | provenance-changed | source-changed | reference-added | reference-removed`, `comparePlanningReferenceSectionChange` (saved-vs-draft section comparison over plans + primary ids, with `null`/empty ids treated as absent on both sides) and `buildPlanningReferenceChangeContext` (combines both sections; an **absent draft is never read as a clear** — when `draft` is `undefined` the context reports `changed: false`). Reports deterministic per-plan descriptors (primary labels, lifecycle/provenance labels, trimmed source URLs, added/removed rows) and the consolidated one-liner `message`. Deterministic reference labels: `getTransportPlanReferenceLabel` (`Flight (Jakarta → Bali)`, mode, or `Transport plan`) and `getAccommodationPlanReferenceLabel` (`Name (Location)`, `Stay in <location>`, or `Accommodation plan`). Honest planning-only wording — every descriptor describes a planning designation and a draft-vs-saved difference; nothing claims booking, payment, verification, or an automatic fix. Effective lifecycle state (STEP 24/25 read-time default) is used so an untouched legacy plan is never reported as a lifecycle change, and an unresolved draft simply stays unresolved. Strictly composed: imports only `types/trip` (types), `planningLifecycle` and `planningProvenance` (label helpers), and `planningReferenceConflict` (primary-assignment status vocabulary); no clock, network, Firebase, React, Router, Zustand, persistence, mutation, or booking vocabulary. Consumed by `PlanningEditor` (transient violet change-context line per section, deduped against STEP 28 resolution feedback). |

---

## D. Dependency Direction

**Intended direction (by convention):**

```
types ← services ← components ← App ← main
              (services may also be called from App directly)
```

**Actual direction:**

```
main.tsx
  └── AppRoutes.tsx
        ├── routes.ts (typed URL↔view mapping)
        ├── ViewRoute → App.tsx
        │     ├── components (via props)   ── presentational
        │     ├── stores (via hooks): uiStore (URL-driven compat layer)
        │     ├── services (direct): dataConnect, aiAgent, authService, geolocation, placeImages, tripService
        │     └── types
        └── TripWorkspacePage   → routes (VIEW_PATH), authService, tripService, tripModel,
                                 tripPlanning, tripPlanningEdit, tripPlanningProposal,
                                 aiPlanningService, TripWorkspaceView, PlanningEditor,
                                 DiscoveryPanel, mockDiscoveryService, discoveryInput,
                                 handoff (STEP 22), planningProvenance (STEP 23),
planningLifecycle (STEP 24),
                                  planningReferenceSelection (STEP 26),
                                  planningReferenceConflict (STEP 27),
                                  planningReferenceResolution (STEP 28),
                                  planningReferenceChangeContext (STEP 29),
                                  types/trip, react-router-dom (its own route)
AppRoutes → routes.ts, App, uiStore (SyncActiveView), react-router-dom
components
  ├── presentational components (props only)
  ├── Navbar → routes.ts + react-router-dom (active tab from URL, navigate on click)
  ├── TripWorkspaceView (src/components/trips/TripWorkspace.tsx) → types/trip,
  │                       planningProvenance, planningReferenceProjection,
  │                       planningReferenceSelection
  └── smart components (direct service calls):
        AuthModal        → authService
        AiPlannerModal   → aiAgent, geolocation
        AiChatDrawer     → aiAgent, geolocation
        PlaceDetailsModal→ dataConnect
        ProfileView      → dataConnect, authService
        AdminDashboard   → firestoreService, authService
        TripWorkspacePage→ authService, tripService, tripModel, routes, TripWorkspaceView,
                          PlanningEditor, planningProvenance, planningLifecycle, handoff
stores
  └── uiStore           → zustand (UI state only; no service/React dependencies)
services
  ├── aiTravelAgent     → dataConnect, placeImages, geolocation, firebase, utils, types
  ├── authService       → dataConnect, firestoreService, firebase, types
  ├── dataConnectService→ firestoreService, types
  ├── firestoreService  → firebase, types
  ├── geolocation       → utils, types
  ├── placeImages       → utils, types (fetch to Wikipedia/Commons at runtime)
  ├── tripService       → firebase, tripSerialization, types/trip (firestore SDK for trips only)
  ├── tripSerialization → types/trip, tripSerializationModel (pure, SDK-free)
  ├── tripSerializationModel → types/trip (pure itinerary validation, SDK-free)
  ├── aiPlanningService → firebase (getAIService only, `firebase/ai`),
  │                       tripPlanningProposal, tripPlanningEdit, tripPlanning, types/trip
  ├── mockFixtures → types/trip, providerResults (STEP 21 fixture data + disclaimer + sentinel
  │                 constants; deterministic, SDK-free, no persistence)
  ├── mockDiscoveryService → discoveryInput, providerAdapter (isAdapterCapabilityAvailable),
  │                         executionOperations, providerResults, mockProviders
  │                         (STEP 21 read-only entry point; no tripService/firestore/network)
  ├── mockProviders → mockTransportProvider, mockAccommodationProvider (STEP 21 adapter registry)
  ├── mockTransportProvider → mockFixtures, providerAdapter, providerCapabilities,
  │                           executionOperations, providerResults, discoveryInput
  ├── mockAccommodationProvider → mockFixtures, providerAdapter, providerCapabilities,
  │                               executionOperations, providerResults, discoveryInput
  └── firebase          → firebase SDK (app/auth/firestore/ai/app-check)
trip domain (structured planning + verification foundation: STEP 13–20; persisted since STEP 09)
  ├── types/trip        → (no internal dependencies)
  ├── tripModel         → types/trip, types/travel (type-only Itinerary for the adapter)
  ├── tripPlanning      → types/trip, executionReadiness, planningProvenance,
  │                        planningLifecycle (STEP 23 provenance gate, STEP 24 lifecycle gate)
  │                        (pure projection + shared section guards)
  ├── executionReadiness → types/trip (STEP 17, refined STEP 19: readiness vocabulary/guards/normalizer/labels
  │                         + DRAFT-ONLY execution-record contracts; pure, SDK-free, no importers yet)
  ├── executionChecklist → types/trip (STEP 18: task vocabulary/guards/normalizer/duplicate-id
  │                         gate/labels; pure, SDK-free)
  ├── verificationState  → types/trip, tripPlanning isSafeHttpUrl (STEP 19: seven-state verification
  │                         vocabulary + evidence model + producer boundary; pure, SDK-free, unconsumed)
  ├── providerCapabilities → (no internal dependencies; STEP 20 capability contract, pure, SDK-free)
  ├── providerAdapter → providerCapabilities (STEP 20 adapter profile boundary, pure, SDK-free)
  ├── providerResults → types/trip, tripPlanning isSafeHttpUrl (STEP 20 normalized result contract)
  ├── verificationProducer → types/trip, verificationState, tripPlanning, executionOperations
  │                         (STEP 20 producer proof-of-evidence boundary; pure, SDK-free)
  ├── bookingLifecycle → types/trip (STEP 20 lifecycle matrix + gates; pure, SDK-free)
  ├── executionOperations → (no internal dependencies; STEP 20 envelope vocabulary + builders)
  ├── executionApprovalAudit → executionOperations (STEP 20 approval/audit vocabulary; pure, SDK-free;
  │                         all eight provider modules unconsumed by the domain level)
  ├── discoveryInput → (no internal dependencies; STEP 21 discovery query boundary, pure, SDK-free;
  │                         consumed only by the mockDiscovery service level)
  ├── handoff → trips/tripPlanning, types/trip (STEP 22 discovery-to-planning handoff: result →
  │                         user-entered planning reference; stamps typed mock-discovery provenance (STEP 23)
  │                         and the active lifecycle by construction (STEP 24);
  │                         pure, SDK-free, deterministic given `now`)
  ├── planningProvenance → types/trip (STEP 23 provenance vocabulary: kinds, normalization,
  │                         honest labels/predicates; pure, SDK-free; NO booking/payment/verification claims)
  ├── planningLifecycle → types/trip (STEP 24 lifecycle vocabulary: active/needs-review/replaced/
  │                         archived, normalization, honest labels/predicates; pure, SDK-free;
  │                         user-controlled only — no auto-staleness, no booking/payment claims)
  ├── planningReferenceProjection → types/trip, planningLifecycle (STEP 25 lifecycle-consistent
  │                         read-only projection: primary/secondary partition, counts, summary,
  │                         honest display labels; pure, SDK-free, never writes or persists)
  ├── planningReferenceSelection → planningReferenceProjection, planningLifecycle, types/trip
  │                         (STEP 26 user-controlled primary selection vocabulary: strict id
  │                         normalization, effective-active eligibility, the four-state read-time
  │                         resolution + honest reasons, order-preserving partition with the
  │                         selection applied, attention predicate + status labels; pure, SDK-free,
  │                         never auto-selects, never promotes, never writes or persists)
  ├── planningReferenceConflict → planningReferenceProjection, planningLifecycle,
  │                         planningReferenceSelection, types/trip
  │                         (STEP 27 primary-assignment conflict vocabulary: the none/valid/missing/
  │                         inactive status, attention predicate + labels, the plain-english conflict
  │                         detail naming the stored id and the user's explicit options, and the
  │                         lifecycle-transition conflict predicates; pure, SDK-free, read-only —
  │                         reports conflicts, never repairs, clears, promotes, or falls back)
  ├── planningReferenceResolution → planningReferenceConflict (type), planningReferenceSelection
  │                         (STEP 28 explicit conflict-resolution vocabulary: the four-decision
  │                         user-action classification, honest labels/descriptions, compatibility
  │                         check, and predicates; pure, SDK-free, read-only, transient — no
  │                         persistence, no automatic resolution, no booking/payment vocabulary)
  ├── planningReferenceChangeContext → planningLifecycle, planningProvenance,
  │                         planningReferenceConflict, types/trip
  │                         (STEP 29 saved-vs-draft change-context vocabulary: the 11-kind
  │                         section-change state machine, deterministic per-plan descriptors
  │                         and reference labels, consolidated message; pure, SDK-free,
  │                         read-only, transient — no history log, no persistence, no
  │                         auto-fix, absent draft never reported as a clear)
  ├── tripPlanningEdit  → tripPlanning, executionChecklist, types/trip (pure edit boundary/shared validation)
  ├── tripPlanningProposal → tripPlanningEdit, tripPlanning, types/trip (pure AI proposal model;
  │                         **no Firestore import** — the AI cannot persist by construction)
  ├── TripWorkspace.tsx → types/trip, planningReferenceProjection,
  │                         planningReferenceSelection, planningReferenceConflict
  │                         (presentational; mounted by TripWorkspacePage)
  ├── PlanningEditor.tsx → types/trip, tripPlanningEdit, tripPlanningProposal,
  │                         executionReadiness, executionChecklist, planningProvenance,
  │                         planningLifecycle, planningReferenceSelection,
  │                         planningReferenceConflict, planningReferenceResolution,
  │                         planningReferenceChangeContext
  │                         (STEP 23 provenance
  │                         chips/source-note/mark-as-manual; STEP 24 lifecycle chip + controls;
  │                         STEP 26 per-section Primary selection control + status chips;
  │                         STEP 27 assignment-guidance paragraph + disclaimer legend, primary/attention
  │                         card chips, and lifecycle-transition conflict hint;
  │                         STEP 28 explicit transient resolution feedback labels per section;
  │                         STEP 29 per-section saved-vs-draft change-context line (violet,
  │                         deduped against STEP 28 feedback; aria-label, no role=status);
  │                         presentational;
  │                         re-exports PlanningDraft/AiAssistState/PlanningSaveState shapes)
  ├── tripSerialization → types/trip, tripSerializationModel (SDK-free document↔domain mapper)
  ├── tripSerializationModel → types/trip, executionChecklist (SDK-free itinerary validation)
  └── TripWorkspacePage → routes, authService, tripService, tripModel, tripPlanning,
                          tripPlanningEdit, tripPlanningProposal, aiPlanningService,
                          TripWorkspaceView, PlanningEditor, handoff (STEP 22 smart page)
utils
  └── validation        → (no internal dependencies)
```

**Observations / coupling:**

1. **No component imports `firebase/*` directly** — components reach Firebase only through
   services (good). This is enforced by a dependency-boundary test.
2. **Routing is centralized in the composition layer** — `AppRoutes` owns the route table and
   URL→store sync; `App` no longer writes the active view directly (it navigates via the
   router), so the URL is the single source of truth for the active view.
3. **Components call services directly**, bypassing `App`'s orchestration, so the service
   call sites are split between `App.tsx` and at least six components.
4. **Services depend on each other** in a triangle: `aiTravelAgent → dataConnect →
firestoreService`, and `authService → {dataConnect, firestoreService}`. The "data"
   service is the hub.
5. **`dataConnectService` is the real persistence boundary** but is named after Firebase
   Data Connect, which is not used at runtime — a naming trap for future work.
6. **`App.tsx` concentrates orchestration** for navigation, discovery, location, load-more,
   bookmarks, reviews, itineraries, and toasts.
7. **AdminDashboard is a special case**: it reads all users via `firestoreService` admin
   methods and hardcodes the admin identity in the component (mirrored in `firestore.rules`).
8. **Trip Workspace is now persisted, routed, editable, and listable.** STEP 08 introduced
   the pure domain (`types/trip`, `tripModel`, presentational `TripWorkspace.tsx`); STEP 09
   added the persistence boundary (`tripSerialization.ts` — SDK-free mapper; `tripService.ts`
   — the only `firebase/firestore` caller for trips), ownership rules in `firestore.rules`,
   and the routed `TripWorkspacePage` at `/trips/:tripId`. STEP 10 added the persisted
   itinerary snapshot: `TripWorkspace.itinerary` (a `TripItinerarySnapshot` populated from
   the generated `Itinerary` at promotion), SDK-free nested validation in
   `tripSerializationModel.ts` (used by serialization, keeping the guard triple
   types→domain→serializer in force), bounded `isTripItineraryShape` checks in
   `firestore.rules`, presentational rendering in `TripWorkspaceView`, and an
   owner-only title/overview editing boundary in `TripWorkspacePage`. STEP 11 added the
   owner-scoped list: `tripService.listTripsForOwner` (a `where('ownerId','==',uid)` query
   that skips malformed docs and sorts newest-first client-side to avoid a composite
   index) feeding the standalone `/trips` route (`MyTripsPage` composing auth + service +
   `MyTripsView`, with safe error messaging and a "Back to My Trips" link from the
   workspace page). STEP 12 added the lifecycle boundary: a pure status-transition policy
   and `normalizeTripTitle` in `tripModel`, narrow `renameTrip`/`updateTripStatus`/
   verified-owner `deleteTrip` wrappers in `tripService`, and the workspace lifecycle card
   (status select constrained to legal transitions, rename via the normal save boundary,
   explicit-confirmation delete that navigates to `/trips`). STEP 13 added the read-only
   `TripPlanningData` projection (`tripPlanning.ts`, pure domain) consumed by the workspace;
   STEP 14 added the explicit-save editing boundary (`tripPlanningEdit.ts` — strict shared
   update normalization, `updateTripPlanning` service write, `PlanningEditor` UI);
   **STEP 15 added AI-assisted structured planning**: `tripPlanningProposal.ts` (pure
   bounded AI proposal/request model + proposal merge) and `aiPlanningService.ts` (gemini
   generation behind a typed service boundary) feed a human-approved, editor-previewed
   draft that is persisted **only** through the explicit `updateTripPlanning` call — the AI
   service imports no Firestore and cannot write. **STEP 16 added the explicit transport /
   accommodation / budget planning sections**: `tripPlanning`/`tripPlanningEdit` gain plan
   guards, normalizers, and per-section update helpers for `transportPlans`,
   `accommodationPlans`, and `budgetPlan` (optional persisted snapshot fields written only
   through `updateTripPlanning`); `PlanningEditor` gains explicit Edit/Cancel editors for the
   three sections; the AI proposal scope stays locked to the five AI-owned sections. `App`
   promotes a generated `Itinerary` into a workspace (owner = signed-in user) and navigates
   to the new trip.
   **STEP 17 added the execution-readiness foundation**: an optional, user-settable
   `readiness` label on each transport/accommodation plan (`TripExecutionReadiness` =
   `{ state, note? }`, states `planned | user-confirmed | externally-verified | cancelled |
 unknown`; "booked/provider-confirmed" maps to `externally-verified` and is not
   user-producible via `canUserSetReadinessState`). The new pure `executionReadiness` module
   owns the vocabulary, guards, normalizer, labels, and DRAFT-ONLY future
   `TripExecutionRecord` contracts (no importers yet). `tripPlanning` plan normalizers accept
   the optional readiness; `tripPlanningEdit` deep-clones it through the update/apply path
   and `cloneSnapshot`; `PlanningEditor` renders a read-only chip per plan. Persistence rides
   the existing snapshot through `updateTripPlanning`; `tripSerializationModel` accepts it
   and rejects booking-claim / malformed states. No booking provider, external-verification
   API, new collection, index, or rules change. **STEP 19 added the provider-independent
   external-verification foundation**: a new pure, SDK-free `verificationState` module owns
   the seven-state verification vocabulary (`user-entered | user-confirmed |
 manually-reviewed | externally-verified | provider-confirmed | cancelled | unknown`), the
   `TripVerificationEvidence` evidence model (normalized through the shared `isSafeHttpUrl`),
   explicit transition gates, and the producer boundary: `externally-verified` and
   `provider-confirmed` are reserved for a future provider-backed producer and are never
   producible from user input — producer-only states block all user transitions. The
   seven-state vocabulary supersets the persisted STEP 17 readiness states: `planned`(ready)
   vs `user-entered`, `user-confirmed`, `externally-verified`, `cancelled`, and `unknown`
   all have verification counterparts, while `manually-reviewed` and `provider-confirmed` are
   verification-only.
   `verificationState` is **unconsumed by the app** — nothing persists it, sends it to the AI,
   or renders it as a control — and STEP 19 also refined the DRAFT-ONLY `TripExecutionRecord`
   contracts in `executionReadiness` to use the richer `TripVerificationState` / evidence /
   `TripBookingCategory` shape. No booking, payment, provider, external-verification API,
   collection, migration, index, or rules change.
   **STEP 20 added the provider and execution integration architecture** — a new pure,
   SDK-free `src/domain/providers/` module set: capability declarations and the adapter
   boundary (`providerCapabilities` / `providerAdapter`), the single normalized provider
   result shape (`providerResults`), the verification evidence producer that SPE 19 reserved
   for provider-owned states (`verificationProducer`, consuming the STEP 19
   `externally-verified`/`provider-confirmed` producer boundary), the explicit booking
   lifecycle table (`bookingLifecycle`), the execution envelope vocabulary
   (`executionOperations`), and the approval/audit boundary (`executionApprovalAudit`).
   These declare that a future adapter can _say_ it can search/verify/retrieve and that a
   booking may only reach `provider_confirmed` through a producer-backed verification
   record — but **nothing executes**: no provider SDK, credential, network call, booking,
   payment, ticket, verification, or cancellation exists, and `canBookingTransitionAutomatically`
   always returns `false`. Every module is unconsumed (no importer anywhere), nothing is
   persisted, and the AI proposal scope, the persisted snapshot fields, and
   `firestore.rules` are untouched. No new collection, migration, index, or rules change.
   **STEP 21 added read-only external discovery** that exercises this architecture for real
   inside the app: a pure `discoveryInput` query boundary (the eighth `src/domain/providers/`
   module), a deterministic `src/services/mockDiscovery/` service with two mock adapters
   (Transport + Accommodation), and the presentational `DiscoveryPanel` wired into
   `TripWorkspacePage`. The panel and service are strictly read-only — `discoverTripOptions`
   NEVER calls `tripService`, never persists, never books/pays/verifies/cancels, performs no
   network call, and holds no credentials; results always carry the "Simulated sample data -
   not live availability or a booking." disclaimer, provider/source identity, retrieval
   timestamps, and recency/expiry warnings. The AI proposal scope, the persisted snapshot
   fields, `firestore.rules`, readiness, and the execution checklist are untouched: discovery
   is a transient view, not a storage surface.
   **STEP 22 added the user-controlled discovery-to-planning handoff**: a pure,
   SDK-free `src/domain/discovery/handoff.ts` converts a selected transport/accommodation
   result into a **user-entered planning reference** (deterministic `handoff-<resultId>` plan
   id, `readiness.planned`, the result's `sourceUrl`, provenance "imported from simulated
   discovery — never a booking" `notes`), refuses non-transport/accommodation results and
   expired quotes, and re-validates the result through the STEP 16 plan normalizers. The
   optional `sourceUrl` field on transport/accommodation plans is validated by `tripPlanning`,
   round-tripped by `tripSerializationModel`, and user-editable in the STEP 16 editors.
   `DiscoveryPanel` surfaces per-result **Use as planning reference** actions and the
   role="status" "Added … as a user-entered reference." notice with Remove from draft;
   `TripWorkspacePage` owns the handoff state (dedupe via existing draft plan ids), appends
   the plan into the existing planning draft, and persists ONLY through the explicit
   `updateTripPlanning` save. Importing never books, reserves, prices live, verifies, or
   executes anything; the AI proposal scope, `firestore.rules`, and all other persistence
   surfaces are untouched.
   **STEP 23 added typed planning-reference provenance.** A new pure module
   `src/domain/trips/planningProvenance.ts` owns the only provenance vocabulary for the
   explicitly-entered transport/accommodation plans: `manual`, `ai-generated`,
   `mock-discovery`, and `external-provider`, with a bounded (500-char) source `note`. The
   shared plan normalizers (`tripPlanning`) validate any present `provenance` field and reject
   the whole record on an unknown kind; legacy plans without provenance stay valid and are
   never auto-labeled. The discovery handoff stamps `mock-discovery` provenance with a fixed
   honest note on every imported plan, the serialization model round-trips the field, and the
   STEP 16 editors render a read-only provenance chip (labels: "Manual reference",
   "AI-generated reference", "Simulated discovery", "External provider reference — not
   verified"), a bounded "Source note" input (rendered only when provenance exists, so legacy
   plans are untouched by mere viewing/focusing), and an explicit **Mark as manually entered**
   action available only on simulated-discovery plans. Newly added plans default to the honest
   `manual` label. No claim about live availability, verification, booking, payment,
   cancellation, provider integration, freshness, or auto-execution is ever made or implied;
   the AI proposal ownership boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS`) is unchanged.
   **STEP 24 added user-controlled planning-reference lifecycle.** A new pure module
   `src/domain/trips/planningLifecycle.ts` owns the only lifecycle vocabulary for the
   explicitly-entered transport/accommodation plans: `active`, `needs-review`, `replaced`,
   and `archived`. The shared plan normalizers (`tripPlanning`) validate any present
   `lifecycleState` field and reject the whole record on an unknown value; legacy plans
   without a lifecycle are treated as `active` at read time only and are never written back
   merely by being viewed or edited. The discovery handoff stamps imported plans with
   `lifecycleState: 'active'` by construction. `replace`/`archive` are decisions, not
   deletions — marking a reference replaced or archived keeps the plan's data, provenance,
   and readiness intact, invents no replacement record, and deletes nothing. `PlanningEditor`
   renders a read-only lifecycle chip on every plan card and exposes lifecycle actions
   (Mark for review / Mark as active / Mark as replaced / Archive / Restore) only while the
   section is being edited; a plan marked archived renders subdued. Every lifecycle value is
   strictly user-controlled: no staleness detection, no date math, no timers, no clock, and
   no code path that writes a lifecycle value automatically. Lifecycle is separate from
   provenance (where a record came from) and readiness (how far along it is), and never
   implies availability, pricing, verification, a booking, or a provider claim. The AI
   proposal ownership boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS`) and `firestore.rules` are
   unchanged.
   **STEP 25 made the lifecycle projection consistent on read-only surfaces.** The pure
   module `src/domain/trips/planningReferenceProjection.ts` (new) owns the only read-time
   grouping of planning references used by non-editing views: legacy plans (no lifecycle)
   resolve to `active` at read time — labeled "Legacy reference — treated as active" — and are
   never written back; `active`/`needs-review` plans form the primary display (needs-review
   visibly marked), while `replaced`/`archived` plans form an always-visible "Replaced /
   archived" subgroup in original order. Counts and a one-line summary are deterministic and
   derive from the single lifecycle vocabulary (`planningLifecycle`), never inferred from
   provenance, readiness, dates, texts, or URLs. The read-only workspace view
   (`TripWorkspace.tsx` → `StructuredPlanningSection`) now renders the transport and
   accommodation plan references with lifecycle and provenance as separate labels and no
   editing controls. The projection exports `partitionPlanningReferences`,
   `countPlanningReferences`, `getPlanningReferenceSummary`, `getPlanningReferenceDisplayLabel`,
   and single-state predicates; it imports only `types/trip` and `planningLifecycle`, never
   writes, persists, or infers a lifecycle, and stays deterministic (no clock, network,
   Firebase, React, Router, or Zustand). `PlanningEditor` remains the ONLY lifecycle-editing
   surface; the AI proposal ownership boundary (`ALLOWED_PROPOSAL_UPDATE_KEYS`) and
   `firestore.rules` are unchanged.
   **STEP 26 added a user-controlled primary reference selection.** A new pure, SDK-free
   module `src/domain/trips/planningReferenceSelection.ts` owns the section-level primary
   selection (`primaryTransportPlanId` / `primaryAccommodationPlanId`) as a strictly
   user-controlled, explicitly stored choice. Absence means no selection — nothing is ever
   auto-promoted or auto-selected. Eligibility is purely lifecycle-based: only effective-active
   plans (legacy included, via the shared read-time `active` default) can be assigned. The
   read-time resolution vocabulary is exactly `no-explicit-selection | valid-explicit-selection
| selected-plan-missing | selected-plan-inactive`; a missing or inactive selection renders as
   a concise non-blocking "needs attention" notice and is preserved as stored (never repaired or
   rewritten). `PlanningEditor` gained a per-section "Primary" control (staged into the local
   draft, persisted only on explicit Save, offering only eligible active plans); the read-only
   `TripWorkspace.tsx` projection lists the valid primary first with a "Primary reference" chip
   and keeps absent/invalid selections honest. Persistence is plain data on the itinerary
   snapshot (`tripPlanning` normalization trims ids, `tripPlanningEdit` applies/clears only when
   an itinerary exists with `null` = explicit clear, and `tripSerializationModel` round-trips a
   present trimmed id). The AI proposal ownership boundary — `ALLOWED_PROPOSAL_UPDATE_KEYS`
   still lists exactly the five STEP 14 keys — and `firestore.rules` are unchanged; the discovery
   handoff never assigns primary fields.
   **STEP 27 added the primary-reference assignment conflict model.** A new pure, SDK-free module
   `src/domain/trips/planningReferenceConflict.ts` layers concise, honest conflict wording on the
   STEP 26 selection vocabulary. It resolves the assignment status (`none | valid | missing |
inactive`), surfaces attention states and the plain-english conflict detail (naming the stored
   selected id and the two explicit user options — select another active reference or clear the
   assignment, plus restore when the plan still exists), and predicts lifecycle-transition impact
   (`doesLifecycleTransitionCreatePrimaryConflict` warns before a transition makes a valid
   selection stale; `doesLifecycleTransitionResolvePrimaryConflict` confirms that restoring the
   stored inactive selected plan to active resolves the conflict — a restore never rewrites a
   primary id). The module is strictly composed (imports only `types/trip`, `planningLifecycle`,
   `planningReferenceProjection`, `planningReferenceSelection`), read-only, and non-mutating: it
   reads the stored ids for reporting but never writes, clears, repairs, promotes, or falls back.
   `PlanningEditor` shows the section guidance paragraph + a "primary is a planning designation,
   not a booking" disclaimer legend, green "Primary reference" / amber "Primary assignment needs
   attention" card chips, and a warning/restore hint when a lifecycle transition would create or
   resolve a conflict. `TripWorkspace.tsx` marks the referenced-but-inactive plan row with the
   amber attention chip in whichever lifecycle group it appears and adds a muted
   "No primary reference selected." caption when plans exist without an explicit selection. The
   AI boundary and handoff remain untouched: no proposal can carry the primary keys and a handoff
   save payload never includes one, so import can neither create, change, nor clear a selection.

---

## E. State Ownership

| State                | Owner(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication state | `App` holds `currentUser` (fed by `authService.subscribe`); `AuthService` keeps the canonical `currentUser` + listener set; `dataConnectService` mirrors `activeUid` to `localStorage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Active tab / view    | URL is the source of truth (routes `/explore` `/bookmarks` `/itineraries` `/profile`). `uiStore.activeView` (Zustand) is a UI compatibility layer mirrored one-way from the URL by `AppRoutes`; `App` renders from it, `Navbar` styles from it via the URL. Not persisted — navigation state lives in the URL/history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Modal state          | `App` — `isAiPlannerOpen`, `isChatOpen`, `isAuthOpen`, `selectedPlace`, `reviewingPlace`, `activeItinerary`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Discovery results    | `App` — `places`, `exploreHeading`, `discoverContext` ({query, loc}), `isExploring`, `isLoadingMore`. Discover cache (memory + sessionStorage) lives in `aiTravelAgent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Selected category    | `App` — `selectedCategory`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Search query         | `App` — `searchQuery`; `Hero` keeps its own input buffer; `PlaceExplorer` receives the value for display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Location             | `App` — `discoverContext.loc`; `AiPlannerModal` — local `userLocation`; `AiChatDrawer` — local `userLocation`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Bookmarks            | `App` — `bookmarkedPlaces` + derived `bookmarkedIds`; canonical store is `dataConnectService` (per-user in localStorage, mirrored to Firestore).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reviews              | `dataConnectService` stores reviews and recomputes place ratings; `PlaceDetailsModal` keeps local `reviews` state for display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Itineraries          | `App` — `savedItineraries`, `activeItinerary`; canonical store is `dataConnectService`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Trip workspace       | Owned by `TripWorkspacePage` (derived load/trip/error state for the `/trips/:tripId` route + `draft`/`saveState` for the on-page editing boundary + `statusDraft`/`statusState` for the pending status transition + `deleteState` for the confirmed-delete flow + `discovery` for the transient STEP 21 result set + `handoffNotice` for the STEP 22 imported-reference notice); canonical store is Firestore `trips/{tripId}` via `tripService` (incl. the persisted `itinerary` snapshot, whose transport/accommodation plans may carry STEP 23 `provenance`, STEP 24 `lifecycleState`, and STEP 26 `primaryTransportPlanId`/`primaryAccommodationPlanId` metadata — all user-controlled, strictly validated at the domain boundary, and never inferred from a missing value). On read-only surfaces the plan lifecycle is projected through the pure STEP 25 `planningReferenceProjection` helpers (primary vs "Replaced / archived" grouping) and the section-level primary selection through the pure STEP 26 `planningReferenceSelection` helpers (explicit choice only, resolved read-time, never auto-promoted), and conflicts through the pure STEP 27 `planningReferenceConflict` helpers (honest status wording + attention chip on the referenced-but-inactive row). Creation flows through `App.handleCreateTripWorkspace`. |
| Profile              | `dataConnectService.userData[uid].profile`; surfaced via `App.currentUser.profile`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Activity feed        | `App` — `activities`; canonical store is `dataConnectService` activity (bounded to 120 events).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Loading states       | `App` (`isExploring`, `isLoadingMore`); modals keep local `submitting/sending` flags.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Errors               | `App` — toast stream (`toasts`); modals keep local inline error text. No centralized error taxonomy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AI chat state        | `AiChatDrawer` — local `messages`/`history`; `aiAgent` is stateless between calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## F. Data Flow

**Place discovery (Explore feed / category tabs / keyword search):**

1. `App` triggers `loadExploreFeed` / `discoverByCategory` / keyword branch of `fetchPlaces`.
2. It obtains location via `getCurrentLocation()` → `reverseGeocode()` (Nominatim) — best effort.
3. It calls `aiAgent.discoverPlaces(query, loc, EXPLORE_COUNT, user, excludeNames)`.
4. `aiTravelAgent` builds a prompt, runs Gemini via `runWithModelFallback` (4 model aliases,
   1.2s backoff between retries), parses/sanitizes JSON, resolves category IDs, enriches
   images via `placeImages`, records up to 2 activity events, and caches the result
   (10 min, memory + sessionStorage, skipped for load-more/exclusion requests).
5. On failure, `App` falls back to `dataConnect.getPlaces(catId, query)` (local seed) and
   image enrichment.

**AI planning (itinerary):**

1. `AiPlannerModal` collects destination/duration/budget/style/interests/notes + optional
   location, then calls `aiAgent.generateItinerary(params, currentUser)`.
2. Prompt includes currency from location, user context from profile/activity,
3. Gemini returns JSON (schema-constrained for dayPlans/transport/hotels-site-seeing).
4. `aiTravelAgent` normalizes via `buildItinerary`, throws friendly error on failure.
5. `App.handleItineraryGenerated` shows the itinerary view; saving goes through
   `dataConnect.saveItinerary` → localStorage + Firestore mirror + activity event.

**AI concierge (chat):**

1. `AiChatDrawer` calls `aiAgent.processChatMessage(prompt, history, location, user)`.
2. `aiTravelAgent` starts a Gemini chat (last 20 messages), system-instruction includes
   location/currency context and user profile/history.
3. Result text rendered as markdown. Errors wrapped in a friendly message.

**Bookmarks:** `App.handleToggleBookmark` → `authService` gate → `dataConnect.toggleBookmark`
(local, activity event) → Firestore mirror → reload `getMyBookmarks()` → image enrichment →
state update + toast.

**Reviews:** `PlaceDetailsModal` loads reviews via `dataConnect.getReviewsForPlace` (seed +
local + Firestore merged). Submit via `App.handleSubmitReview` → `dataConnect.createReview`
(recompute place rating, activity event, Firestore mirror).

**Itineraries (saved):** `App.handleSaveItinerary` / `handleDeleteItinerary` →
`dataConnect.saveItinerary`/`deleteItinerary` → localStorage + Firestore mirror.

**Profile:** `ProfileView` → `dataConnect.updateUserProfile` → localStorage + Firestore mirror.

**Activity feed:** `dataConnectService` tracks events (bounded to latest 120 per user);
`App` refreshes from `dataConnect.getActivity(uid)` after auth changes and key actions.

**Image resolution:** `placeImages.enrichPlacesWithImages` → `resolvePlaceImageUrl` →
(candidate Wikimedia URL verification → Wikipedia lead-image search → Commons search),
24h in-memory cache. Blank image URL → branded placeholder in UI.

**Geolocation:** `getCurrentLocation()` (browser, 8s timeout, high accuracy) →
`reverseGeocode()` (Nominatim, 8s abort) → `describeLocation/label` + `countryCode` →
used for currency + location-aware prompts.

**Trip persistence (`trips/{tripId}`):** signed-in users create/read/update/delete their own
workspaces through `tripService`. `createTrip` derives the document id from Firestore and
returns a workspace whose `id` is that id. `updateTrip` rejects any attempt to change
`id`/`ownerId`/`createdAt`/`updatedAt` (guarded before any writes) and always stamps a new
`updatedAt`. `getTrip` returns `null` for a missing document; ownership failures surface as
`TripPermissionError` (from rules or `mapFirestoreError`). All writes pass
`serializeTripUpdates` in `tripSerialization.ts`, which splits a patch into `values`
(including a `dateRange` → Firestore Timestamp via `deleteField`-ready deletions when
cleared). Firestore writes/re-reads serialize through `tripToFirestore`/`tripFromFirestore`.
The persisted `itinerary` field is validated/normalized by `tripSerializationModel.ts`
(`isTripItinerarySnapshot` / `normalizeTripItinerarySnapshot`): writes throw
`TripSerializationError` on a malformed snapshot, reads return `null` from
`tripFromFirestore` for an unparseable stored snapshot, and clearing the field is
expressed as a field deletion. Old documents without `itinerary` remain valid.

**Trip promotion (Itinerary → Workspace):** `App.handleCreateTripWorkspace` requires a
signed-in user (opens the auth modal otherwise), converts the active `Itinerary` with
`itineraryToTripWorkspace(itinerary, { ownerId })`, calls `tripService.createTrip`, shows a
success toast, and navigates to `tripPath(created.id)`. `ItineraryView` renders the trigger
button only when the callback prop is supplied. The source `Itinerary` is never mutated.

**Trip page load (`/trips/:tripId`):** `TripWorkspacePage` derives
`loading → (not-found | unauthorized | error | success)` state without any synchronous
`setState` in effects: auth is read once (`useState(() => authService.user)`) and subscribed
after first render; if the loaded trip id differs from the URL id the view re-enters
`loading` (stale-keyed guard); missing user → `unauthorized` without fetching. On success,
a `SuccessContent` editing boundary renders a `Title` input (always) and an `Overview`
textarea (only when `trip.itinerary` exists) prefilled from the loaded trip, with an
"Unsaved changes" pill while dirty and a "Save changes" button disabled until the draft
differs from the persisted trip, the title is non-empty, and no save is in flight. Saving
calls `tripService.updateTrip(id, { title, itinerary: { ...snapshot, summary } })` when an
itinerary snapshot exists, else the narrow `tripService.renameTrip(id, ownerId, title)`
(there is no itinerary field to preserve, so `updateTrip` would otherwise be a broader
write path). The page re-renders from the returned trip and maps `TripNotFoundError` /
`TripPermissionError` / generic failures to the not-found panel / unauthorized panel /
inline alert (`role="alert"`). The trip id never changes, so a loaded trip's `itinerary`
cannot be cleared accidentally by a summary-only edit.

**Lifecycle card (STEP 12):** the same `SuccessContent` renders a second card with the
_Status_ control and the _Delete trip_ zone. The status `<select>` lists only the current
status plus the domain-allowed successors (`getAllowedTripStatusTransitions(trip.status)`);
it and its "Update status" button are disabled on terminal statuses (`completed`/`cancelled`,
per `isEditableTripStatus`) and while any other save/delete is in flight. Selecting a target
and confirming calls `tripService.updateTripStatus(trip.id, ownerId, next)`, which validates
locally against the persisted current status (server-enforced ownership) before writing. The
delete flow is two-step by design: "Delete trip" arms a `confirming` state ("Yes, delete
trip" / "Keep trip") and only the confirm handler calls
`tripService.deleteTrip(trip.id, ownerId)` (session-derived owner, existence + owner
verification client-side, owner-only rules server-side). A successful delete navigates to
`/trips`; a failed one stays on the page with a safe alert and no dropped draft. All three
async handlers compare a ref-stored `tripId` against the URL at call time so stale responses
never overwrite newer state. No optimistic updates, no auto-save, and no unload prompts.

**My Trips list (`/trips`):** `MyTripsPage` reads auth once (`useState(() => authService.user)`),
subscribes after first render, and — only for a signed-in user — calls
`tripService.listTripsForOwner(user.id)` (with a `cancelled` flag to ignore stale results,
re-fetching when the session user changes). It derives `loading → (signed-out | error |
empty | ready)`, keeping a loading guard while a loaded list's owner differs from the
current user (auth in transition). The service runs `where('ownerId','==',uid)`, skips
docs that `tripFromFirestore` cannot map, sorts by `updatedAt` newest-first client-side
(no composite index needed), and throws `TripPermissionError` on rule denials. The page
maps errors to safe text (`TripPermissionError` → "You do not have access to this list.",
anything else → a generic retry message) and renders `MyTripsView`; row taps navigate to
`tripPath(id)`; a signed-out user sees a "Browse Places" prompt linking back to `/explore`.
No Navbar mounts on this route (it is outside `App`), so `pathToView('/trips')` resolving
to `explore` is never rendered there.

---

## G. External Integrations

Verified live integrations (runtime, client-side):

| Integration                                                  | Module                                       | Purpose                                                                                                                                                               | Boundary                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Auth (Google popup, email/password, password reset) | `authService.ts` → `firebase/auth`           | Sign in/up/out, reset, auth state.                                                                                                                                    | SDK calls only inside `authService`.                                                                                                                                                                                      |
| Firestore                                                    | `firestoreService.ts` → `firebase/firestore` | Cloud persistence mirror, admin reads. Uses persistent local cache. `tripService.ts` writes/reads `trips/{tripId}` (owner-scoped).                                    | SDK calls only inside `firestoreService` (delegated by `dataConnectService`) and `tripService` for trips.                                                                                                                 |
| Firebase AI Logic (Gemini Developer API)                     | `aiTravelAgent.ts` → `firebase/ai`           | Place discovery, itinerary generation, concierge chat.                                                                                                                | SDK calls only inside `aiTravelAgent`; App Check enforced.                                                                                                                                                                |
| Firebase App Check (reCAPTCHA Enterprise)                    | `firebase.ts` → `firebase/app-check`         | Hardens AI Logic + backend calls; debug token in dev.                                                                                                                 | Configured in `firebase.ts`.                                                                                                                                                                                              |
| Nominatim (OpenStreetMap)                                    | `geolocation.ts` (raw `fetch`)               | Reverse geocoding coordinates → label + country.                                                                                                                      | Raw HTTP; must stay mockable.                                                                                                                                                                                             |
| Wikipedia API                                                | `placeImages.ts` (raw `fetch`)               | Lead-image resolution + candidate URL verification.                                                                                                                   | Raw HTTP; must stay mockable.                                                                                                                                                                                             |
| Wikimedia Commons API                                        | `placeImages.ts` (raw `fetch`)               | Commons image search + `upload.wikimedia.org` verification.                                                                                                           | Raw HTTP; must stay mockable.                                                                                                                                                                                             |
| Google Fonts (Outfit, Plus Jakarta Sans)                     | `index.html`                                 | Typography.                                                                                                                                                           | Static `<link>`.                                                                                                                                                                                                          |
| lucide-react                                                 | local dependency                             | Icon set.                                                                                                                                                             | Local.                                                                                                                                                                                                                    |
| zustand                                                      | local dependency                             | Tiny state-management store used by `src/stores/uiStore.ts`.                                                                                                          | Local; hooks used only in components, store module has no React import.                                                                                                                                                   |
| react-router-dom                                             | local dependency                             | URL routing for the four SPA views (`/explore`, `/bookmarks`, `/itineraries`, `/profile`) and the trip routes (`/trips` owner list, `/trips/:tripId` workspace page). | Local; imports restricted to the composition layer (`main.tsx`, `AppRoutes.tsx`), `routes.ts` types, `Navbar`/`App` navigation, `MyTripsPage`, and `TripWorkspacePage`. Services and Firebase modules must not import it. |

Note: `firebase.json` also configures Firebase Data Connect (emulator + dataconnect source),
but the running application does not use the Data Connect SQL backend or its generated SDK.

---

## H. Persistence Model

**Firestore collections (written/read by the app):**

| Collection  | Path                              | Notes                                                                                   |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| users       | `users/{uid}`                     | Identity + login metadata (upsert on login).                                            |
| profiles    | `profiles/{uid}`                  | User preferences (`UserProfile`).                                                       |
| sessions    | `sessions/{uid}/logins/{id}`      | One document per non-anonymous sign-in.                                                 |
| bookmarks   | `bookmarks/{uid}/items/{placeId}` | Bookmark records.                                                                       |
| itineraries | `itineraries/{uid}/items/{id}`    | Saved itineraries.                                                                      |
| reviews     | `reviews/{id}`                    | Author-owned reviews.                                                                   |
| activity    | `activity/{uid}/events/{id}`      | Activity events.                                                                        |
| trips       | `trips/{tripId}`                  | User-owned Trip Workspaces (via `tripService`); owner-scoped rules, private by default. |

`places`, `categories`, `bookmarksMeta` appear in `firestore.rules` but are **not used by
the runtime services** — the app renders local seed data instead. `trips` is the only
collection written directly by a dedicated trip service (it does not flow through the
`dataConnect` local-first mirror).

**localStorage (main persistence for the local-first layer):**

| Key                                      | Contents                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `voyage_categories`                      | Categories (seeded or edited locally).                                      |
| `voyage_places`                          | Places (seeded; `createPlace` writes here).                                 |
| `voyage_seed_reviews`                    | Seed reviews.                                                               |
| `voyage_user_data`                       | Per-UID nested `{ bookmarks, itineraries, profile, reviews, activity }`.    |
| `voyage_active_uid`                      | Currently active user id.                                                   |
| `voyage_hydrated`                        | Marker key (unused constant `LISTENERS_KEY`).                               |
| `voyage_bookmarks`, `voyage_itineraries` | Legacy pre-migration stores, folded into `voyage_user_data['legacy-demo']`. |

**sessionStorage:**

| Key                                         | Contents                                 |
| ------------------------------------------- | ---------------------------------------- |
| `reveao_discover_<query>::<label>::<count>` | AI discovery cache entries (10 min TTL). |

Note the internal `'reveao_discover_'` prefix (historical typo), preserved for
compatibility.

**Caching behavior:**

- AI discovery: in-memory `Map` + sessionStorage; 10-minute TTL.
- Place images: in-memory `Map` + per-key 24h expiry timer.
- Firestore: SDK `persistentLocalCache({ tabManager: persistentSingleTabManager })` —
  survives reloads, single-tab.
- No service-worker / offline asset caching (not a PWA).

**Synchronization behavior:**

- The local-first layer (`dataConnectService`) writes to localStorage immediately and mirrors
  to Firestore via a **fire-and-forget** `sync()` helper. Firestore failures are logged as
  warnings and never surfaced to the UI.
- Reviews are the only entity read back and merged from Firestore (`getReviewsForPlace`);
  bookmarks/itineraries/profile/activity are read from local state by the app.
- Offline behavior: the local layer works fully offline; Firestore mirror logs warnings and
  is silently skipped. There is no write queue/retry.

**Current limitations:**

- Fire-and-forget mirroring means cloud data can diverge from local data; no conflict
  resolution or offline queue.
- `places`/`categories` are not read from Firestore by the app, so admin-managed content in
  those collections does not surface.
- No cross-device read-back of users' bookmarks/itineraries/activity/profiles (only
  Firestore-write; local read).

---

## I. Known Architectural Risks

1. **App.tsx concentration** — ~580 lines that do view rendering (driven by the
   URL-synced `uiStore.activeView`), location capture, AI
   discovery orchestration, pagination, auth-gated flows, bookmarks/reviews/itineraries,
   and toasts. Hard to test at the unit level; high change blast radius. View switching
   itself now lives in the router (`AppRoutes`), but the view content branches remain here.
2. **Misleading service name** — `dataConnectService` is local-first persistence, not
   Firebase Data Connect. Future work may be misled into expecting a Data Connect SDK.
3. **Fire-and-forget writes** — `dataConnect.sync()` swallows Firestore errors (console
   warning only). Silent data-loss risk across devices; no retry/queue.
4. **Mixed responsibilities in services** — `aiTravelAgent` does prompting, model fallback,
   JSON normalization, caching, activity recording, and image enrichment; `geolocation`
   mixes GPS, geocoding, and currency tables.
5. **Components reaching into services directly** — at least six components call services
   bypassing `App`, splitting the call sites and making behavior harder to trace.
6. **Service coupling triangle** — `aiTravelAgent → dataConnect → firestoreService` and
   `authService → {dataConnect, firestoreService}` create implicit ordering/deployment
   coupling.
7. **Implicit contracts** — AI JSON parsing trusts schema + prompts; category IDs are
   duplicated as label→ID maps (`CATEGORY_LABEL_TO_ID`), hardcoded `CATEGORY_DISCOVER`
   queries in `App`, and icon mappings in `PlaceExplorer`.
8. **Hardcoded admin configuration** — admin email is duplicated in `firestore.rules`
   (`isAdmin`) and `AdminDashboard.tsx`.
9. **Validation boundaries are typed, with semantic blind spots remaining** — service
   JSON edges (Gemini, Nominatim, Wikipedia/Wikimedia) parse `unknown` through
   `src/utils/validation.ts` guards (no `any`); non-object entries are dropped and numeric
   strings coerced. Trust defaults still hide model errors: `averageRating`/`reviewCount`
   clamp to 4.5/1, price levels fall back to `$$`, and category IDs rely on duplicated
   label→ID maps.
10. **Lack of centralized error taxonomy** — errors are string-matched
    (`isRetriableModelError`, quota regex), and user messaging is duplicated across `App`
    and `aiTravelAgent`.
11. **No provider abstraction** — services are module singletons; no DI seams (the chosen
    test strategy uses module mocks).
12. **Duplicated constants** — `EXPLORE_COUNT` (App) vs default `count = 8`
    (discoverPlaces); currency tables live in `geolocation.ts` only.
13. **Unused key** — `LISTENERS_KEY`/`voyage_hydrated` marker is written but never read.
14. **Trip rules lack automated tests** — ownership behavior in `firestore.rules`
    (`trips/{tripId}` block) is reviewed but not executed by the suite (no rules test
    harness exists). Client-side guards + service error mapping are tested instead.
15. **The trips list is owner-scoped and client-ordered** — `MyTripsPage` at `/trips` calls
    `listTripsForOwner` (Firestore `where('ownerId','==',uid)`); malformed docs are skipped
    and ordering is a client-side `updatedAt` sort because no composite index exists (a
    `orderBy` on the query would require deploying one). Rules restrict list reads to
    admin or owner, and there is no public/shared browsing of trips yet.

---

## J. Trip Workspace (foundation → persisted & routed)

STEP 08 added a pure, fully tested Trip domain boundary. STEP 09 wired it into the running
product as a user-owned, route-addressable persistence shell. There is still no booking,
payment, live availability, collaboration, or execution — those remain future steps.

### Ownership

- **`src/types/trip.ts`** owns the Trip domain vocabulary: `TripId`, `TripStatus`
  (`draft | planning | ready | in_progress | completed | cancelled`), `TripVisibility`
  (`private | shared`), `TripMemberRole` (`owner | editor | viewer`), `TripDateRange`,
  `TripDestination`, `TripWorkspace`, the persisted `TripItinerarySnapshot` (ED: `destination`,
  `country`, `durationDays`, `budgetLevel`, `travelStyle`, `interests`, `summary`,
  `estimatedTotalCost`, `bestTimeToVisit`, optional `transport`/`hotels`/`sightseeingCost`,
  and `dayPlans`), and bookable-component references
  (`TripActivityReference`, `TripTransportReference`, `TripAccommodationReference`).
- **`src/domain/trips/tripModel.ts`** owns pure, deterministic helpers: `createDraftTrip`,
  `isTripDateRangeValid`, `getTripDurationDays`, `canViewTrip`, `canEditTrip`,
  `toTripItinerarySnapshot` (non-mutating deep copy from a typed snapshot),
  and the pure adapter `itineraryToTripWorkspace` (which embeds the generated `Itinerary`
  as a `TripItinerarySnapshot`). STEP 12 adds the lifecycle policy: `normalizeTripTitle`
  (trims and rejects empty titles — never silently truncated),
  `TRIP_STATUS_TRANSITIONS` (the explicit status matrix
  `draft→planning→ready→in_progress→completed`, plus cancellation from any active stage)
  backed by `canTransitionTripStatus` / `getAllowedTripStatusTransitions` /
  `isEditableTripStatus` (terminal = `completed`/`cancelled`), and `canDeleteTrip`
  (currently every known status is deletable — the single gate to tighten later).
  Time values are passed in (`now`); nothing uses the clock, network, React, Firebase,
  or Zustand.
- **`src/components/trips/TripWorkspace.tsx`** is the presentational boundary
  (`TripWorkspaceView`). It renders title, status, optional date range, destination names,
  a "Workspace foundation" placeholder, and — when `workspace.itinerary` exists — an
  itinerary overview (meta like budget/duration/travel style), a day-by-day plan with
  activities (time, title, location, cost), a transport section, and an accommodation
  section, each with a friendly fallback when empty/absent. It has no data fetching, no
  state, no route, and no services.
- **`src/services/tripSerializationModel.ts`** owns pure, SDK-free validation of a stored
  itinerary: `isTripItinerarySnapshot` (type guard) and `normalizeTripItinerarySnapshot`
  (whitelists declared keys, shape-checks nested day plans/activities/transport/hotels,
  returns `null` on malformed input). No `firebase/*` imports.
- **`src/services/tripSerialization.ts`** is the SDK-free document↔domain mapper for
  `trips/{tripId}`. It owns the Firestore-safe shape (`TripDocument`, now incl. an
  optional `itinerary`), duck-typed Timestamp reading (`toDate()`), patch splitting into
  `values` + `deletions` (`serializeTripUpdates`, now incl. itinerary clear/set), the
  `serializeItinerarySnapshot` helper, and the `isValidStorageId`/`assertTripId` boundary
  used by the service.
- **`src/services/tripService.ts`** is the persistence boundary. `createTrip` / `getTrip` /
  `updateTrip` / `deleteTrip` / `listTripsForOwner` all resolve Firestore lazily and map
  SDK errors to safe, typed errors. Ownership is enforced client-side (`ownerId` always
  from the signed-in user; mutations of `id`/`ownerId`/timestamps rejected) **and**
  server-side (`firestore.rules`). `updateTrip` accepts an `itinerary` patch (validated
  before any write). `listTripsForOwner` issues the owner query, skips docs that fail to
  map, and sorts by `updatedAt` newest-first client-side. STEP 12 adds three narrow
  lifecycle wrappers: `renameTrip(tripId, ownerId, title)` (verifies ownership, normalizes
  the title via the domain, writes through `updateTrip`), `updateTripStatus(tripId,
ownerId, status)` (rejects unknown statuses and illegal transitions against the
  persisted current status, then writes `{ status }`), and the optional `ownerId` form of
  `deleteTrip(tripId, ownerId?)` (existence + ownership verified client-side before the
  delete; the historical one-arg rules-scoped call still works).
- **`src/components/trips/TripWorkspacePage.tsx`** is the routed shell at `/trips/:tripId`.
  It owns the load lifecycle and renders `TripWorkspaceView`; on success it also owns a
  minimal editing boundary (title + itinerary overview) through an internal
  `SuccessContent` component that receives the already-narrowed trip and the draft/save
  state, plus STEP 12's lifecycle card (status select constrained by the domain transition
  policy, and an explicit-confirmation delete flow; both disabled while any other write is
  in flight, with ref-guarded handlers so stale async responses never win). Deleting
  navigates to `/trips` on success and stays put with a safe error on failure. It is
  intentionally separate from `App` so a workspace route does not re-mount the whole
  orchestration hub. Its "Back" link targets `/trips`.
- **`src/components/trips/MyTripsPage.tsx` + `MyTripsView.tsx`** are the routed owner list at
  `/trips`, also separate from `App`. `MyTripsPage` composes auth + `listTripsForOwner` +
  safe error mapping and routes row taps to `/trips/:tripId`; `MyTripsView` is a pure view
  over the `loading | signed-out | error{message} | empty | ready{trips}` union (duration
  from `tripModel.getTripDurationDays`, itinerary badge when a snapshot is attached).

### Persistence & security model

- Create: `signedIn()` and document `ownerId == request.auth.uid` and valid shape
  (`isTripShape`, `isTripStatus`, `isTripVisibility`, `validDestinations`); a client can
  only ever create a trip it owns. If `itinerary` is written, it must match
  `isTripItineraryShape` (a bounded field-level check: map, non-empty destination string,
  summary string, positive durationDays, list of day plans).
- Read: `request.auth.uid == resource.data.ownerId` (or admin) — non-owners get a
  permission denied, which `tripService` maps to `TripPermissionError`.
- Update: owner only, and `request.resource.data.ownerId == resource.data.ownerId` blocks
  ownership transfer. `updatedAt` is always rewritten by the service. `itinerary` writes
  pass the same `isTripItineraryShape` guard.
- **Destination cap (20).** `validDestinations` bounds a trip to
  `MAX_TRIP_DESTINATIONS` (20) destinations, inspecting the first 20 indices explicitly
  (rules have no loops). A changed destination list must be ≤20, but an update may leave an
  over-limit legacy list untouched — `destinationsAcceptable` accepts a list that either
  passes the cap **or** exactly equals the persisted `resource.data.destinations` on update
  (the create path passes `null`, so no over-limit list can be created). The same bound is
  mirrored in the app: `MAX_TRIP_DESTINATIONS` + `getDestinationLimitProblem` in
  `tripPlanningEdit.ts`, enforced in `tripService.updateTripPlanning` and surfaced by
  `PlanningEditor` (Add disabled at the cap, save blocked with a clear message).
- Delete: owner only.
- No public/shared read path is opened yet (`visibility` is stored but not consulted in
  rules); collaboration is future work.
- Rules validate the itinerary **top-level contract** only; deep nested content
  (activities, transport, hotels) is trusted to the client-side `tripSerializationModel`
  normalization because all trips are owner-written. This boundary is documented in the
  rules file; there is no rules test harness.

### Boundaries enforced

- Trip domain types import no React, Firebase, or Zustand; no `any`; string IDs and ISO
  date/date-time strings only.
- Domain utilities are side-effect free and deterministic; any time value is passed in.
- `tripSerialization` and `tripSerializationModel` import no Firebase SDK; `tripService` is
  the only new `firebase/firestore` caller, and it is separately mockable (no Firestore in
  unit tests).
- The presentational `TripWorkspaceView` has no services/router/state; the `MyTripsView`
  list shell is presentational too (row taps callback `onOpenTrip`, prompts callback
  `onBrowse`).
- The editing boundary is confined to `TripWorkspacePage` (title + itinerary overview);
  the `/trips` list is read-only.
- Lifecycle transitions are constrained end-to-end by the domain policy (the UI offers
  only legal successors, and the service re-checks against the persisted status); the URL
  `tripId` is never an authorization source — ownership verification always uses the
  session-derived `ownerId`. Renames normalize through the domain (trim + non-empty, never
  silently truncated). Deletion is always explicit (two-step confirm); success leaves the
  workspace (`/trips`), failure stays in place with a safe message.
- No booking, payments, live availability, collaboration, execution monitoring, or
  notifications.

### The Itinerary adapter

`Itinerary` is intentionally unchanged. `itineraryToTripWorkspace` performs a one-way
lossy mapping (no owner → required `ownerId` option; no dates → optional `dateRange`;
`status` becomes `planning`), embeds the generated itinerary as the workspace's
`TripItinerarySnapshot` (via `toTripItinerarySnapshot`, a non-mutating deep copy that
drops runtime-only `id`/`createdAt`/`saved` fields), and does not mutate the source.
`App` uses it in `handleCreateTripWorkspace` before persisting.

### Remaining future extension points

- Add pagination or a server-side `orderBy` for the /trips list (currently client-side
  `updatedAt` sort; would require a composite index in `firestore.rules`/console).
- Flesh out bookable references (status, provider booking ids) at the service layer,
  keeping the core `TripWorkspace` identity free of provider specifics.
- Collaboration: shared visibility + member roles + list rules covering shared reads.

### Structured planning projection (STEP 13)

STEP 13 adds a **read-only, derived structured planning model** (the `TripPlanningData`
projection) so the persisted trip can be consumed as a bounded, typed planning surface
without duplicating data in a parallel collection. Nothing is re-persisted and no
migration/index/rules change is required.

- **`src/types/trip.ts`** extends the canonical snapshot types. `TripItinerarySnapshot`
  gains an optional `notes?: string[]` (planning notes) and an optional
  `references?: TripPlanningReference[]` (identifier-only bookable-component references:
  activity / transport / accommodation). `TripPlanningReference` is the persisted shape
  (`kind` ∈ `activity | transport | accommodation`, `id`, `title`, `dayNumber?`,
  `provider?`, `providerId?`, `estimatedCost?`, accommodation date span). The projected
  `TripPlanningData` is declared here as the structured surface (dates, destinations,
  days, transportation, accommodation, budget, notes, references) but is **never stored**.
- **`src/domain/trips/tripPlanning.ts`** (new, pure domain) owns the projection helpers:
  `buildTripPlanningData(workspace)` projects a `TripWorkspace`'s canonical fields
  (date range, destinations, and the itinerary snapshot) into the structured surface;
  `isTripPlanningData` is the type guard; `normalizeTripPlanningData` normalizes an
  untrusted payload (whitelists declared keys, shape-checks days/transportation/
  accommodation/notes/references, fuses date range, clamps day numbers to the trip's
  duration) and returns `null` on malformed input; `getTripDayDate` resolves an ISO date
  for a day number within the date range. No Firebase/React/Router/Zustand/`any` — the
  module stays pure and deterministic like `tripModel`.
- **Persistence boundary:** not a new collection. `TripPlanningData` is always rebuilt
  from the single canonical trip document on read; `tripSerializationModel.ts` accepts
  the optional `notes`/`references` keys on the itinerary snapshot (validating both so
  malformed values still fail the snapshot guard), and `tripSerialization.ts` passes them
  through document mapping. This keeps ownership, lifecycle, and rules semantics
  unchanged (STEP 12) while exposing the structured planning surface read-only.
- **Canonical location, editability, and next step:** the itinerary snapshot is the single
  canonical persisted home for planning data (`dayPlans`, `transport`, `hotels`, `notes`,
  `references`; budget is a projection of snapshot cost fields); `TripWorkspace.dateRange`
  and `.destinations` are equally canonical. Legacy documents without `notes`/`references`
  are preserved unchanged (both keys optional, read as absent). In STEP 13 the workspace was
  read-only over the structured planning sections — only title and itinerary overview were
  editable on `TripWorkspacePage`. Editing the structured planning records (destinations,
  days, transport, accommodation, budget, notes, references) was the next incremental
  editing step and is intentionally **not** implemented in STEP 13 (implemented for
  dates/destinations/days/notes/references in STEP 14 and for transport/accommodation/
  budget in STEP 16).

### Structured planning editing (STEP 14)

STEP 14 realizes the first bounded editing slice promised in STEP 13: **trip dates,
destinations, the daily itinerary (days + activities), planning notes, and external
references** are now editable, with **explicit-save** (never autosave) persistence through
a single narrow write path. (STEP 16 subsequently extended the same write path to transport
plans, accommodation plans, and the budget plan — see the STEP 16 section below.) Booking,
payment, availability, and other execution behavior remain future
steps.

- **Edited surface and types.** `src/types/trip.ts` adds `url?: string` to
  `TripReferenceBase` (a bounded external link on a reference) and declares
  `TripPlanningUpdate = { dateRange?: TripDateRange | null; destinations?: TripDestination[];
days?: DayPlan[]; notes?: string[]; references?: TripPlanningReference[] }`. A **present
  key persists that section, an absent key leaves it untouched**, and `dateRange: null`
  explicitly clears trip dates (translated to a field deletion by the existing
  `serializeTripUpdates`).
- **Editable-only boundary (STEP 14 slice).** `dateRange` and `destinations` live on
  `TripWorkspace`; days, notes, and references live inside the canonical itinerary snapshot.
  Transport, hotels, the budget summary, and every identity/lifecycle field are **never**
  written in this step (STEP 16 adds explicit transport/accommodation/budget sections on the
  same path).
- **Domain editing module.** `src/domain/trips/tripPlanningEdit.ts` (new, pure, SDK-free)
  owns all edit logic: `normalizeTripPlanningUpdate` (strict wholesale validation — unknown
  keys, malformed nested items, duplicate ids/day numbers reject the entire update, and any
  guard failure surfaces as `null`), `applyTripPlanningUpdate` (builds the successor
  workspace by deep-cloning; trims `notes`; never throws; keeps identity/lifecycle and
  read-only sections), `isPlanningUpdateDirty`, `getPlanningUpdateProblem` (human UI
  feedback; accepts an optional `{ existingDestinations }` context so a changed over-limit
  list is reported while an unchanged legacy list is allowed), `getDestinationLimitProblem`
  + `MAX_TRIP_DESTINATIONS` (the 20-destination cap shared with `firestore.rules`),
  per-section normalization helpers, plus `PlanningDraft` and `stripTripId`.
  It reuses `tripPlanning`'s guards, which are now exported there (`isSafeHttpUrl`,
  `isTripDateRange`, `isTripDestinationRecord`, `isActivityRecord`). Itinerary-section
  edits on a legacy no-itinerary workspace are no-ops in the domain and rejected by the
  service before any write. Day numbers are validated structurally (positive, unique) but
  are **not** coupled to the date range; out-of-range days remain filtered only in the
  derived projection.
- **Validation and security boundary.** Reference urls must pass `isSafeHttpUrl` (only
  bounded `http(s)` links; `javascript:`/`data:`/`file:` and any whitespace/control
  characters rejected). Because `isTripPlanningReference` enforces it and
  `tripSerializationModel` reuses that guard, **read, write, and update serialization all
  reject unsafe or malformed reference urls**. `firestore.rules` is unchanged — the rules
  validate the top-level canonical fields (`ownerId`/shape) while deep planning content
  stays client-validated (documented limitation).
- **Service write path.** `tripService.updateTripPlanning(tripId, ownerId, update)` is the
  only new write entry: `assertTripId`/`assertOwnerId` → load + ownership check
  (`TripNotFoundError`/`TripPermissionError`) → normalize (malformed payloads rejected
  before any Firestore query, as `TripValidationError`) → reject itinerary-section edits on
  a legacy no-itinerary workspace → apply → patch only the changed canonical fields through
  the existing whitelisted `updateTrip` (ownership guard, `updatedAt` refresh, and error
  mapping preserved).
- **UI.** The presentational `src/components/trips/PlanningEditor.tsx` (mounted by
  `TripWorkspacePage` between the details card and the Lifecycle card; hidden when the page
  is in a loading/not-found state) renders the five editable sections and nothing else.
  The page owns the `PlanningDraft` (keyed to the loaded trip id; stale drafts from other
  trips are ignored via a ref guard) and a `PlanningSaveState`. Saving is **always
  explicit** through one "Save planning" button; failed saves keep the draft with a retry
  alert; successful saves reset the draft and refresh the trip. The editor shows an
  "Unsaved changes" pill and disables Save while unchanged/saving/errored/disabled; save is
  blocked with an `role="alert"` problem message. Days/notes/references sections are gated
  behind a hint when the workspace has no itinerary. Reference `url`/`dayNumber` keys are
  physically dropped from the payload when cleared (Firestore rejects `undefined`-valued
  keys), and locally generated ids (`dst-…`, `ref-…`) are UI-only — the domain stays
  deterministic.
- **Conflict rules.** Exactly one write path is active at a time: a planning save disables
  title editing, status changes, and delete, and vice versa (single-flight semantics shared
  with the STEP 12 lifecycle controls). No autosave, no optimistic persistence, no unload
  prompts (future work).
- **Test surface.** New `src/test/tripPlanningEdit.test.ts` (pure domain) and
  `src/test/PlanningEditor.test.tsx` (component) plus extensions to `tripPlanning.test.ts`
  (`isSafeHttpUrl`), `tripSerialization.test.ts` (reference url round-trip / unsafe
  rejection on read, write, updates), `tripService.test.ts` (`updateTripPlanning` guard
  order and persisted-section patching), and `TripWorkspacePage.test.tsx` (planning save
  handling, conflict disables, failure/not-found/unauthorized states). Full suite: 365 tests
  across 22 files, green.

### Structured planning AI suggestions (STEP 15)

STEP 15 layers an **AI assistant** on top of the STEP 14 editing boundary. The assistant
suggests edits to the _editable-only_ structured planning surface; it can never persist, and
every change is still written only through the human-activated, explicit `updateTripPlanning`
call.

- **Bounded AI proposal model.** `src/domain/trips/tripPlanningProposal.ts` (new, pure,
  SDK-free) owns the only types the AI may produce or consume. `normalizeTripPlanningRequest`
  whitelists `currentPlanning` / `instruction` / `constraints` and bounds the instruction at
  `MAX_PLANNING_INSTRUCTION_LENGTH = 1000`. `normalizeTripPlanningProposal` whitelists
  `explanation` / `warnings` / `assumptions` / `update` and runs the proposed `update` through
  the **same** `normalizeTripPlanningUpdate` used by manual editing — but
  `ALLOWED_PROPOSAL_UPDATE_KEYS` restricts the proposal to the five AI-owned sections
  (dates, destinations, days, notes, references). So any STEP 16 transport, accommodation,
  budget, lifecycle, title, owner, or metadata edit is rejected at the same boundary that
  rejects manual smuggling. Malformed JSON, unknown keys, duplicate ids,
  malformed nested items, unsafe reference urls, and invalid/missing explanation all yield
  `null` (rejected output). `mergePlanningProposalIntoDraft` applies STEP 15 merge semantics
  onto a planning draft (present key overrides, absent key untouched, `dateRange: null`
  clears) without mutating inputs, and `summarizeProposalChanges` produces the plain-text
  current → proposed diff rows for the UI preview.
- **Generation service boundary.** `src/services/aiPlanningService.ts` exports
  `generateTripPlanningProposal(currentPlanning, instruction)`. It validates the request
  first, sends the **entire** structured `currentPlanning` + the instruction to Gemini via
  `getGenerativeModel` (from `firebase/ai`, reusing the model-alias fallback convention of
  `aiTravelAgent`), requests strict `application/json` with a bounded output schema, parses
  the raw response as `unknown`, and normalizes it through `normalizeTripPlanningProposal`.
  Every failure path returns a typed `AiPlanningError` with a safe pre-baked message — raw
  provider text is never surfaced. The module imports `firebase/ai` + `./firebase` only;
  **it has no `firebase/firestore` import and no reference to `tripService`**, so the AI
  cannot write to the database by construction. Persistence happens only when the user
  explicitly approves and the page calls `tripService.updateTripPlanning`.
- **Privacy-minimized context.** Only the structured `currentPlanning` and the user's
  instruction (plus any approved-in-future optional `constraints`) leave the browser. No auth
  tokens, owner ids, document ids, bookmark/activity data, or private metadata are sent.
- **Prompt and response rules.** The system instruction (embedded in `aiPlanningService`)
  demands JSON-only output, tells the model to preserve existing destination/day/reference
  ids verbatim (no renumbering), to warn when changing dates, and to make every proposed
  id collision-free. The schema is bounded to the editable sections (`dateRange`,
  `destinations`, `days`, `notes`, `references`) only — transport, accommodation, budget,
  lifecycle, and ownership fields are not representable and are whitelist-rejected anyway.
- **UI flow.** `TripWorkspacePage` owns an `AiAssistState` (idle → generating → ready →
  applied) and passes a proposal down to `PlanningEditor`, which renders the instruction
  textarea, a "Generate suggestion" action with a loading state (disabling title/status/
  delete/planning controls while in flight, and gating on `isEditableTripStatus` like every
  other edit), and a preview (explanation, warnings, assumptions, and the current→proposed
  diff). Apply calls `mergePlanningProposalIntoDraft` against the **local** draft only;
  Discard restores the previous draft snapshot. Nothing is touched on the server until the
  user clicks the existing "Save planning" button, which calls `updateTripPlanning` with the
  merged draft and then re-reads the persisted trip. Generation failures map to safe error
  alerts and never persist (`updateTripPlanning` is never called). A stale response guard
  drops a proposal that arrives after the user has navigated to another trip.
- **Merge semantics.** Approved proposals are merged, not wholesale-replaced: the proposal
  updates only the sections it names, keeps all other draft edits intact, and `dateRange:
null` retains its clear-dates meaning. This is the same patch-merge the editor uses for
  manual edits, so AI-assisted and manual edits compose cleanly.
- **Edit restrictions (STEP 16 scope lock).** The assistant may suggest changes to
  the five AI-owned sections — dates, destinations, days/activities, notes, and references —
  only. The STEP 16 user-editable transport plans, accommodation plans, and budget plan stay
  outside the AI proposal scope (whitelist-rejected even though a human may edit them
  directly); booking, payment, availability, execution, and notifications remain explicitly
  out of scope.
- **No new persistence.** No new collections, no new fields, no `firestore.rules` change —
  a proposal lives only in component state until approved and saved via the existing narrow
  write path.
- **Test surface.** New `src/test/tripPlanningProposal.test.ts` (request/proposal
  normalization, merge semantics incl. stable-id preservation and clear-dates, diff
  summarization, and STEP 16 scope rejection of transport/accommodation/budget keys) and
  `src/test/aiPlanningService.test.ts` (service with mocked `firebase/ai`
  - `getAIService`: valid/partial JSON, invalid JSON, unknown keys, unsafe urls, duplicate
    destinations, missing explanation, invalid date range/destination/activity/reference,
    model-alias fallback, error mapping that never leaks provider text), plus
    `TripWorkspacePage.test.tsx` AI-planning describe (draft-but-never-persist before
    explicit approval, merge-into-existing-draft, discard restores previous draft, safe
    generation errors, stale-response protection, failed-save preserves the approved draft)
    and a `dependencyBoundary` assertion that `aiPlanningService` never imports Firestore.

---

### Explicit transport / accommodation / budget planning (STEP 16)

STEP 16 completes the editable structured-planning surface: **transport plans**,
**accommodation plans**, and the **budget plan** become explicit, human-editable sections
persisted through the existing STEP 14 write path. The AI proposal scope from STEP 15 stays
locked to the five AI-owned sections.

- **Types.** `src/types/trip.ts` adds `TripTransportPlan`, `TripAccommodationPlan`,
  `TripBudgetAllocations`, `TripBudgetPlan`, and the `TripPlanningUpdateKey` union. The
  optional `transportPlans` / `accommodationPlans` / `budgetPlan` fields live on
  `TripItinerarySnapshot` (persisted), and `TripPlanningData` gains the optional
  `transportPlans` / `accommodationPlans` / `budgetPlan` projection fields alongside the
  original five sections.
- **Domain guards/normalizers.** `src/domain/trips/tripPlanning.ts` adds
  `isTripTransportPlan` / `normalizeTripTransportPlan` (mode, `from`/`to` strings, optional
  day number + provider + link), `isTripAccommodationPlan` / `normalizeTripAccommodationPlan`
  (name, check-in/check-out ISO date-times with `checkOut >= checkIn`), and `isTripBudgetPlan`
  / `normalizeTripBudgetPlan` (currency regex, allocations map where **unknown keys are
  dropped**, total trimmed with finite `>= 0` amounts, optional notes array). Malformed plans
  normalize to `null`, so a section that fails validation is omitted rather than partially
  applied.
- **Edit boundary.** `src/domain/trips/tripPlanningEdit.ts` extends the update model from
  five to **eight** updatable keys (`ALLOWED_UPDATE_KEYS`). Values are applied through the
  trust-boundary convention: `updateTripTransportPlans` / `updateTripAccommodationPlans` /
  `updateTripBudgetPlan` take raw typed values (validate-then-apply at the normalize
  boundary), where a non-array (`transportPlans` / `accommodationPlans`) or non-record
  (`budgetPlan`) value types a `TypeError` and identity checks pass through
  `normalizePlanArray`. `applyTripPlanningUpdate` writes the sections only when the successor
  has an itinerary snapshot and collapses an empty budget to an absent one
  (`collapseEmptyBudgetPlan`). Unknown budget-allocation keys never persist (dropped by the
  normalizer).
- **Persistence.** No new collections or rules. `tripService.updateTripPlanning` already
  patches changed canonical fields; STEP 16 adds the three snapshot sections and lets
  `budgetPlan: null` clear a stored budget (field deletion). `tripSerializationModel` verifies
  the optional sections (unique plan ids; malformed or duplicate ids fail the snapshot guard)
  so read/write/update serialization all reject bad data. Legacy documents without these keys
  stay byte-compatible.
- **UI.** `PlanningEditor` renders the three sections read-only until the user opens their
  explicit Edit frame; adding a plan opens the frame with a local `trp-`/`acp-` id and saves
  replace the whole list, while removing existing plans collects the non-empty remainder (a
  hint explains when none remain). The budget editor auto-totals plan costs, normalizes the
  currency, keeps raw input strings while typing (trimming/empties are handled by domain
  normalization on save), and offers "Clear budget plan". Editing stays gated by the same
  explicit-save and `isEditableTripStatus` rules as the other sections.
- **AI scope.** `normalizeTripPlanningProposal` rejects any proposal touching the STEP 16
  sections — the AI can neither read them into suggestions nor write them; the five
  AI-owned sections are unchanged.
- **Test surface.** Guard/normalizer tests in `tripPlanning.test.ts`; STEP 16 update model,
  helpers, dirty-checking, and budget collapse in `tripPlanningEdit.test.ts`; snapshot +
  Firestore round-trip and `updateTripPlanning` persistence (incl. `budgetPlan: null` clear
  and no-itinerary rejection) in `tripSerializationModel.test.ts` / `tripSerialization.test.ts`
  / `tripService.test.ts`; the explicit editors and gating in `PlanningEditor.test.tsx`.

---

### Execution-readiness foundation (STEP 17)

STEP 17 adds an optional, user-settable **execution-readiness label** to each transport and
accommodation plan — the first forward-compatible slice toward a future booking/execution
layer, while explicitly keeping the app planning-only today.

- **Semantics (Option 2 — minimal optional planning metadata).** `TripExecutionReadiness` =
  `{ state, note? }` where `state` ∈
  `planned | user-confirmed | externally-verified | cancelled | unknown`. A "booked /
  provider-confirmed" label is represented as `externally-verified` and is **not**
  user-producible (`canUserSetReadinessState('externally-verified') === false`) — only the
  app would show it once an external verification path exists. The optional `note` is a
  free-form user note (trimmed; dropped when empty). No reference number, timestamps, or
  `booked` state exist.
- **New domain module.** `src/domain/trips/executionReadiness.ts` (pure, SDK-free) owns
  `TRIP_EXECUTION_READINESS_STATES`, `isTripExecutionReadinessState` /
  `isTripExecutionReadiness` guards, `normalizeTripExecutionReadiness` (unknown state or
  non-string note → null), `getTripExecutionReadinessLabel`, `isExternallyVerifiedState`, and
  `canUserSetReadinessState`, plus **DRAFT-ONLY** contracts for a future execution layer
  (`TripExecutionRecord` union over `TripTransportExecutionRecord` /
  `TripAccommodationExecutionRecord` / `TripBookingReferenceRecord`) that **no module imports
  yet** — they document the intended payload shape without wiring any behavior.
- **Types.** `src/types/trip.ts` adds `TripExecutionReadinessState` / `TripExecutionReadiness`
  and an optional `readiness` key on `TripTransportPlan` / `TripAccommodationPlan`.
- **Normalization.** `tripPlanning.ts`'s plan normalizers accept the optional readiness,
  delegating to `normalizeTripExecutionReadiness`; a plan with malformed readiness is
  rejected whole (absent key when omitted). `tripPlanningEdit.ts` deep-clones readiness
  through the update/apply path and `cloneSnapshot` (`clonePlanWithReadiness`), so edits never
  reference the same readiness object.
- **Persistence.** No new collections, indexes, migrations, or rules. Readiness rides the
  existing snapshot fields (`transportPlans` / `accommodationPlans`) through the single
  `updateTripPlanning` write path; `tripSerializationModel` accepts the optional labels and
  rejects booking-claim / malformed states on read. Legacy documents without readiness stay
  byte-compatible.
- **UI.** `PlanningEditor` renders a read-only readiness chip on each transport and
  accommodation plan card (`getTripExecutionReadinessLabel`; visual states distinguish
  externally-verified). It is deliberately not editable this step. No booking provider or
  external-verification API is introduced.
- **Test surface.** New `executionReadiness.test.ts`; STEP 17 extenders in
  `tripPlanning.test.ts`, `tripPlanningEdit.test.ts`, `tripPlanningProposal.test.ts` (merge
  preserves readiness), `tripSerializationModel.test.ts`, `tripSerialization.test.ts`,
  `tripService.test.ts`, and `PlanningEditor.test.tsx`.

---

### Execution-preparation checklist (STEP 18)

STEP 18 adds the user-controlled **execution-preparation checklist**: optional `tasks` on
the itinerary snapshot — the **ninth editable planning section** — persisted through the
existing single `updateTripPlanning` write path, rendered in `PlanningEditor`, and kept
entirely **outside the AI proposal scope**.

- **Semantics (Option 2 — user-authored tasks on the existing snapshot).** A
  `TripChecklistItem` is `{ id, category, title, status, description?, dueDate?, note?,
relatedSection?, relatedPlanId? }`. Task statuses are `pending | in_progress | completed |
skipped` — `completed` means the owner marked it complete, never external confirmation.
  Categories are preparation-phase labels (`transport-preparation`, `accommodation-preparation`,
  `budget-preparation`, `document-preparation`, `itinerary-preparation`, `general`);
  `relatedSection`/`relatedPlanId` optionally point at existing planning data and are never
  existence-validated. There are deliberately **no per-item timestamps** and no
  booking/payment/provider/credential fields.
- **New domain module.** `src/domain/trips/executionChecklist.ts` (pure, SDK-free) owns the
  vocabularies (`TRIP_TASK_STATUSES`, `TRIP_TASK_CATEGORIES`,
  `TRIP_TASK_RELATED_SECTIONS`), the guards (`isTripTaskStatus`, `isTripTaskCategory`,
  `isTripTaskRelatedSection`, `isTripChecklistItem`), the strict normalizer
  (`normalizeTripChecklistItem`: required id/category/title/status, optional strings trimmed
  and dropped when empty, ISO `YYYY-MM-DD` `dueDate` validated, documented maximum lengths
  (120/500/500/200) enforced by rejection, absent-vs-null → absent), the duplicate-id gate
  (`hasUniqueTaskIds`), and neutral read-only labels (`getTripTaskStatusLabel`,
  `getTripTaskCategoryLabel`, `getTripTaskRelatedSectionLabel`). No React/Firebase/
  Router/Zustand/`any`.
- **Clear semantics.** `tasks: null` **and** `tasks: []` both collapse to an absent checklist
  at apply time (`applyTripPlanningUpdate` deletes the key); `TripPlanningUpdate.tasks` is
  typed `TripChecklistItem[] | null` (mirrors `budgetPlan`); `updateTripTasks(workspace, tasks)`
  throws `TypeError` on invalid non-null tasks and is a **no-op on a workspace without an
  itinerary** (like the other itinerary sections).
- **Persistence.** No new collections, indexes, migrations, or rules. Tasks ride the
  existing snapshot field through `tripService.updateTripPlanning`; `tripSerializationModel`
  validates each task at the snapshot boundary (`normalizeTaskArray`, duplicate ids reject the
  snapshot) and strips runtime-only keys. Legacy documents without `tasks` stay
  byte-compatible.
- **AI boundary.** `ALLOWED_PROPOSAL_UPDATE_KEYS` stays locked to the five STEP 14 sections —
  a proposal can never create, edit, complete, or skip a task. Tasks are **user-authored
  only**, so the AI cannot touch the checklist by construction.
- **UI.** `PlanningEditor` adds a "Checklist" section (caption "Your own preparation tasks —
  full control, never autopilot."): read-only neutral task rows with an explicit Edit
  affordance, then status/category/title/due-date rows with remove buttons, description and
  note rows, an optional related-plan select + free plan-id input, and an "Add task" action
  minting `{ id: makeLocalId('tsk'), category: 'general', title: '', status: 'pending' }`.
  Saving blocks untitled tasks (`getPlanningUpdateProblem`); Cancel reverts the section; the
  dirty pill honors the legacy-clear collapse.
- **Test surface.** New `executionChecklist.test.ts`; STEP 18 extenders in
  `tripPlanningEdit.test.ts`, `tripSerializationModel.test.ts`, `tripService.test.ts`,
  `tripPlanningProposal.test.ts` (tasks are rejected in proposal scope; merge preserves draft
  tasks), and `PlanningEditor.test.tsx` (incl. the no-itinerary empty state).

---

## K. Target Evolution Principles

Guiding principles for future steps (not yet implemented):

- **Preserve existing behavior during migration** — every refactor must remain green on
  the existing test/build/lint baseline.
- **Introduce boundaries before replacing implementations** — add interfaces/seams first,
  swap internals later.
- **Keep the UI independent of external provider details** — components should not import
  `firebase/*` or call raw provider HTTP APIs.
- **Isolate AI provider calls** — keep Gemini specifics (models, schemas, fallback)
  behind `aiTravelAgent`.
- **Isolate future booking/provider integrations** — never scatter provider code through
  `App` or components.
- **Keep high-risk actions behind explicit approval** — payments, bookings, cancellations,
  and irreversible changes require user confirmation.
- **Use structured domain models** — `src/types/travel.ts` should remain the vocabulary,
  independent of Firebase document shapes and provider response formats.
- **Make external calls mockable** — any new network call must be stub-able in tests.
- **Keep tests deterministic and offline** — no real Firebase/Gemini/external calls.
- **Avoid mixing persistence with presentation** — data access stays in services.
- **Prefer incremental migration over a big-bang rewrite.**

---

## Appendix: Public Service Contracts

### `aiTravelAgent.ts` — `export const aiAgent`

| Function                                                         | Purpose                         | Inputs                                        | Output                   | External deps        | Tested                                                        | Limitations                                                                 |
| ---------------------------------------------------------------- | ------------------------------- | --------------------------------------------- | ------------------------ | -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `discoverPlaces(query, location?, count?, user?, excludeNames?)` | Real-place discovery via Gemini | `string`, `UserLocation                       | null`, `number=8`, `User | null`, `string[]=[]` | `Promise<Place[]>`                                            | Gemini (`firebase/ai`), `dataConnect` (categories, activity), `placeImages` | Yes                                                           | Uses 10-min cache unless `excludeNames` non-empty; up to 2 activity events recorded |
| `generateItinerary(params, user?)`                               | Day-by-day itinerary via Gemini | `AiPlannerParams`, `User                      | null`                    | `Promise<Itinerary>` | Gemini, `dataConnect`/geolocation (currency/location context) | Yes                                                                         | Throws friendly error; id generated client-side (`itin-<ts>`) |
| `processChatMessage(prompt, history?, location?, user?)`         | Concierge chat reply            | `string`, `Array<{role;text}>`, `UserLocation | null`, `User             | null`                | `Promise<ChatMessage>`                                        | Gemini (chat), geolocation/`dataConnect` (context)                          | Yes                                                           | Keeps last 20 history messages; stateless                                           |

### `authService.ts` — `export const authService`

| Function                                        | Purpose                      | Inputs                       | Output                     | External deps                  | Tested | Limitations                              |
| ----------------------------------------------- | ---------------------------- | ---------------------------- | -------------------------- | ------------------------------ | ------ | ---------------------------------------- |
| `get user()`                                    | Current mapped user          | —                            | `User \| null`             | —                              | No     | —                                        |
| `subscribe(cb)`                                 | Auth state subscription      | `(user: User\|null) => void` | `() => void` (unsubscribe) | `firebase/auth`                | No     | Calls back immediately with current user |
| `signInWithGoogle()`                            | Google popup                 | —                            | `Promise<User>`            | `firebase/auth`, `dataConnect` | No     | Popup-based                              |
| `signInWithEmail(email, password)`              | Email/password sign in       | `string, string`             | `Promise<User>`            | `firebase/auth`, `dataConnect` | No     | —                                        |
| `signUpWithEmail(email, password, displayName)` | Email sign up + profile seed | `string, string, string`     | `Promise<User>`            | `firebase/auth`, `dataConnect` | No     | Calls `updateProfile`                    |
| `sendPasswordReset(email)`                      | Password reset email         | `string`                     | `Promise<void>`            | `firebase/auth`                | No     | Friendly errors                          |
| `signOut()`                                     | Sign out                     | —                            | `Promise<void>`            | `firebase/auth`                | No     | —                                        |

### `firestoreService.ts` — `export const firestoreService`

| Function                                                                                                        | Purpose                            | External deps        | Tested |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------- | ------ |
| `recordUserLogin(params)`                                                                                       | Upsert user doc + record session   | `firebase/firestore` | No     |
| `updateUserProfile(uid, partial)`                                                                               | Merge profile                      | Firestore            | No     |
| `getProfile(uid)`                                                                                               | Read profile                       | Firestore            | No     |
| `getBookmarkIds(uid)`                                                                                           | Read bookmark ids                  | Firestore            | No     |
| `setBookmark(uid, placeId)` / `removeBookmark(uid, placeId)`                                                    | Toggle bookmark                    | Firestore            | No     |
| `saveItinerary(uid, itinerary)` / `getItineraries(uid)` / `deleteItinerary(uid, id)`                            | Itinerary CRUD                     | Firestore            | No     |
| `getReviewsForPlace(placeId)` / `getReviewsByUser(uid)` / `createReview(uid, placeId, rating, comment, place?)` | Review read/write                  | Firestore            | No     |
| `recordActivity(uid, type, event)` / `getActivity(uid)`                                                         | Activity events                    | Firestore            | No     |
| `adminListUsers()` / `adminGetSessions(uid, take?)` / `adminCountUser(uid)`                                     | Admin reads (requires admin rules) | Firestore            | No     |

### `dataConnectService.ts` — `export const dataConnect`

| Function                                                              | Purpose                            | Output                                                       | External deps      | Tested                       | Limitations                    |
| --------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------ | ---------------------------- | ------------------------------ |
| `getCategories()`                                                     | Seed categories                    | `Promise<Category[]>`                                        | localStorage       | Yes                          | Local only                     |
| `getPlaces(categoryId?, searchQuery?)`                                | Filter/search seed places          | `Promise<Place[]>`                                           | localStorage       | Yes                          | Local only                     |
| `getPlaceById(id)`                                                    | Single place                       | `Promise<Place\|undefined>`                                  | localStorage       | Yes                          | —                              |
| `createPlace(data)`                                                   | New place (for admin)              | `Promise<Place>`                                             | localStorage       | Yes                          | Rating/reviewCount seeded      |
| `getReviewsForPlace(placeId)`                                         | seed + local + Firestore merged    | `Promise<Review[]>`                                          | Firestore (read)   | No                           | Firestore read is best-effort  |
| `getCurrentUserReviews()`                                             | Signed-in user reviews             | `Promise<Review[]>`                                          | localStorage       | No                           | —                              |
| `createReview(placeId, rating, comment)`                              | Add review; recompute place rating | `Promise<Review>`                                            | Firestore (mirror) | Yes                          | Throws if signed out           |
| `getMyBookmarks()` / `isBookmarked(id)` / `toggleBookmark(id)`        | Bookmark read/toggle               | `Promise<Place[]>` / `Promise<boolean>` / `Promise<boolean>` | Firestore (mirror) | Yes                          | Throws if signed out on toggle |
| `getSavedItineraries()` / `saveItinerary(it)` / `deleteItinerary(id)` | Itinerary CRUD                     | various                                                      | Firestore (mirror) | Yes (save throws signed out) | —                              |
| `getCurrentUser()`                                                    | Active local user                  | `Promise<User\|null>`                                        | localStorage       | No                           | Provider always `'anonymous'`  |
| `getUserProfile(uid)`                                                 | Profile lookup                     | `UserProfile`                                                | localStorage       | No                           | Defaults for unknown           |
| `ensureUserProfile(uid, partial)`                                     | Seed profile on first use          | `void`                                                       | localStorage       | No                           | —                              |
| `updateUserProfile(partial)`                                          | Merge profile                      | `void`                                                       | Firestore (mirror) | No                           | No-op when signed out          |
| `getActivity(uid)`                                                    | Activity feed                      | `UserActivityEvent[]`                                        | localStorage       | Yes                          | Bounded 120                    |
| `recordActivityFromService(type, event, uid)`                         | Activity insertion (service→data)  | `void`                                                       | Firestore (mirror) | Yes                          | Bounded 120                    |
| `setActiveUser(uid)` / `clearActiveUser()`                            | Auth-scoped user switch            | `void`                                                       | localStorage       | No                           | —                              |

### `tripSerialization.ts`

| Export                                         | Purpose                                                                          | External deps                      | Tested |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| `TripDocument`                                 | Firestore-safe trip document shape (ISO date-times, no IDs; optional itinerary). | —                                  | —      |
| `tripToFirestore(trip)`                        | Map `TripWorkspace` → `TripDocument`; throws `TripSerializationError`.           | types/trip, tripSerializationModel | Yes    |
| `tripFromFirestore(docId, raw)`                | Map `unknown` doc → `TripWorkspace \| null` (duck-typed `toDate()`).             | types/trip, tripSerializationModel | Yes    |
| `serializeTripUpdates(patch)`                  | Split a partial update into `{ values, deletions }`; `deleteField`-ready.        | types/trip, tripSerializationModel | Yes    |
| `serializeItinerarySnapshot(value)`            | Normalize an itinerary patch (set) or `undefined` (clear).                       | tripSerializationModel             | Yes    |
| `isValidStorageId(candidate)` / `assertTripId` | Ownership/id boundary for trip ids (`/^[A-Za-z0-9_-]{1,128}$/`).                 | —                                  | Yes    |
| `TripSerializationError`                       | Typed serialization failure.                                                     | —                                  | Yes    |

### `tripSerializationModel.ts`

| Export                                  | Purpose                                                                                                                                                                                                                                                                                                                                                  | External deps | Tested |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| `isTripItinerarySnapshot(value)`        | Type guard: is this a well-formed `TripItinerarySnapshot` (nested shape incl. activity coordinates)?                                                                                                                                                                                                                                                     | types/trip    | Yes    |
| `normalizeTripItinerarySnapshot(value)` | Rebuild a top-level snapshot with only declared keys (drops runtime-only/unknown), shape-check nested day plans/activities/transport/hotels plus STEP 16 `transportPlans`/`accommodationPlans`/`budgetPlan` (unique plan ids) and STEP 17 per-plan `readiness` labels (booking-claim / malformed states rejected); returns `null` on any malformed part. | types/trip    | Yes    |

### `tripService.ts` — `export const tripService`

| Function                                      | Purpose                                                                                     | Inputs                                                   | Output                           | External deps        | Tested | Limitations                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- | -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTrip(trip)`                            | Add a trip owned by `trip.ownerId`; Firestore id wins.                                      | `TripWorkspace`                                          | `Promise<TripWorkspace>`         | `firebase/firestore` | Yes    | Owner must equal signed-in uid (rules enforce).                                                                                                                                                                                                                                                                                                                                                                                                      |
| `getTrip(tripId)`                             | Read own trip by id.                                                                        | `TripId`                                                 | `Promise<TripWorkspace \| null>` | Firestore            | Yes    | Non-owner → `TripPermissionError`; malformed → `TripParseError`.                                                                                                                                                                                                                                                                                                                                                                                     |
| `updateTrip(tripId, patch)`                   | Merge patch; rejects identity/managed fields; rewrites `updatedAt`; returns refreshed trip. | `TripId`, `Partial<Omit<TripWorkspace,'id'\|'ownerId'>>` | `Promise<TripWorkspace>`         | Firestore            | Yes    | Throws `TripValidationError` / `TripNotFoundError`; deletes cleared `dateRange`; `itinerary` validated/normalized (set or cleared) before writing.                                                                                                                                                                                                                                                                                                   |
| `renameTrip(tripId, ownerId, title)`          | Rename own trip via the domain-normalized title.                                            | `TripId`, `string`, `string`                             | `Promise<TripWorkspace>`         | Firestore            | Yes    | Owner verified first (session-derived `ownerId`); empty/whitespace title → `TripValidationError`; missing → `TripNotFoundError`; other-owner → `TripPermissionError`. Writes through `updateTrip` so `updatedAt` is stamped.                                                                                                                                                                                                                         |
| `updateTripStatus(tripId, ownerId, status)`   | Apply a legal lifecycle transition.                                                         | `TripId`, `string`, `TripStatus`                         | `Promise<TripWorkspace>`         | Firestore            | Yes    | Unknown status or illegal transition (checked against the persisted current status) → `TripValidationError`; ownership/existence verified like `renameTrip`.                                                                                                                                                                                                                                                                                         |
| `deleteTrip(tripId, ownerId?)`                | Delete own trip by id (owner verified when `ownerId` supplied).                             | `TripId`, `string?`                                      | `Promise<void>`                  | Firestore            | Yes    | Two-arg form throws `TripNotFoundError` / `TripPermissionError` before deleting; one-arg form is the historical rules-scoped path. Fails safe through `mapFirestoreError`.                                                                                                                                                                                                                                                                           |
| `updateTripPlanning(tripId, ownerId, update)` | Apply a validated structured planning update (STEP 14–18).                                  | `TripId`, `string`, `TripPlanningUpdate`                 | `Promise<TripWorkspace>`         | Firestore            | Yes    | Single write path: `assertTripId`/`assertOwnerId` → load + ownership → `normalizeTripPlanningUpdate` (malformed → `TripValidationError`, before any query) → reject itinerary-section edits on a legacy no-itinerary workspace → apply → patch changed canonical fields (incl. `transportPlans`/`accommodationPlans`/`budgetPlan` and STEP 17 per-plan `readiness`; `budgetPlan: null` clears; STEP 18 `tasks` persists / clears via `tasks: null`). |

Typed errors: `TripNotFoundError`, `TripPermissionError`, `TripValidationError`,
`TripParseError`; `mapFirestoreError` converts `permission-denied` /
`not-found` / fallbacks to safe messages without leaking raw SDK text.

### `aiPlanningService.ts` (STEP 15)

| Export                                                       | Purpose                                                                                                                   | External deps                                                                                                                  | Tested |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `generateTripPlanningProposal(currentPlanning, instruction)` | Generate a validated structured-proposal suggestion for a planning draft.                                                 | `firebase/ai` (`getGenerativeModel`), `./firebase` (`getAIService`), `tripPlanningProposal` (request + proposal normalization) | Yes    |
| `AiPlanningError`                                            | Typed error with safe pre-baked message (`busy` / `invalid-output` / `unsupported` fallbacks); never leaks provider text. | —                                                                                                                              | Yes    |

Constraints: no `firebase/firestore` import (cannot persist by construction); bounded
instruction length (`MAX_PLANNING_INSTRUCTION_LENGTH`, from `tripPlanningProposal`); strict
`application/json` response schema; model-alias fallback on retriable provider errors.

### `tripPlanningProposal.ts` (STEP 15)

| Export                                           | Purpose                                                                                                                                                | External deps                              | Tested |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------ |
| `MAX_PLANNING_INSTRUCTION_LENGTH`                | Length bound (1000) applied to the user instruction.                                                                                                   | —                                          | Yes    |
| `normalizeTripPlanningRequest(value)`            | Whitelist `currentPlanning`/`instruction`/`constraints`; bound + trim the instruction; `null` on malformed input.                                      | tripPlanning, types/trip                   | Yes    |
| `normalizeTripPlanningProposal(value)`           | Whitelist `explanation`/`warnings`/`assumptions`/`update`; proposed `update` passes the shared `normalizeTripPlanningUpdate`; `null` on any rejection. | tripPlanningEdit, tripPlanning, types/trip | Yes    |
| `mergePlanningProposalIntoDraft(base, proposal)` | Merge approved proposal into a planning draft (present overrides, absent untouched, `dateRange: null` clears); never mutates inputs.                   | types/trip                                 | Yes    |
| `summarizeProposalChanges(proposal, current)`    | Plain-text current → proposed diff rows for preview.                                                                                                   | types/trip                                 | Yes    |

### `executionChecklist.ts` (STEP 18)

| Export                                                                                                                                      | Purpose                                                                                                                                                                                                                                                | External deps | Tested |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------ |
| `TRIP_TASK_STATUSES` / `TRIP_TASK_CATEGORIES` / `TRIP_TASK_RELATED_SECTIONS`                                                                | The only recognized task statuses / categories / related sections (unknown values always rejected).                                                                                                                                                    | —             | Yes    |
| `MAX_TASK_TITLE_LENGTH` / `MAX_TASK_DESCRIPTION_LENGTH` / `MAX_TASK_NOTE_LENGTH` / `MAX_TASK_RELATED_PLAN_ID_LENGTH` / `MAX_TASK_ID_LENGTH` | Documented max lengths (120 / 500 / 500 / 200 / 200) enforced by rejection.                                                                                                                                                                            | —             | Yes    |
| `isTripTaskStatus(value)` / `isTripTaskCategory(value)` / `isTripTaskRelatedSection(value)`                                                 | Enum guards; provider-like strings such as `booked` are rejected.                                                                                                                                                                                      | types/trip    | Yes    |
| `isTripChecklistItem(value)` / `normalizeTripChecklistItem(value)`                                                                          | Whole-record guard / strict normalizer (required id+category+title+status; optional strings trimmed & dropped when empty; real ISO `dueDate`; max lengths by rejection; absent-vs-null → absent). Returns `null` on any malformed field, never throws. | types/trip    | Yes    |
| `hasUniqueTaskIds(items)`                                                                                                                   | Duplicate-id gate used by the editing + persistence boundaries.                                                                                                                                                                                        | —             | Yes    |
| `getTripTaskStatusLabel(status)` / `getTripTaskCategoryLabel(category)` / `getTripTaskRelatedSectionLabel(section)`                         | Neutral read-only labels — never claim a booking / external confirmation.                                                                                                                                                                              | types/trip    | Yes    |

### `geolocation.ts`

| Function                        | Purpose                          | External deps           | Tested |
| ------------------------------- | -------------------------------- | ----------------------- | ------ |
| `getCurrentLocation()`          | Browser GPS (8s timeout)         | `navigator.geolocation` | Yes    |
| `reverseGeocode(location)`      | Nominatim reverse geocode        | `fetch` → Nominatim     | Yes    |
| `getCurrencyCode(countryCode?)` | Country → currency (default USD) | —                       | Yes    |
| `currencySymbol(code)`          | Currency → symbol (default code) | —                       | Yes    |
| `describeLocation(location)`    | Human-readable location label    | —                       | Yes    |

### `placeImages.ts`

| Function                                                   | Purpose                                                         | External deps               | Tested |
| ---------------------------------------------------------- | --------------------------------------------------------------- | --------------------------- | ------ |
| `resolvePlaceImageUrl(name, city, country, candidateUrl?)` | Verified photo URL (wikimedia → wikipedia → commons), 24h cache | `fetch` → Wikipedia/Commons | Yes    |
| `enrichPlacesWithImages(places)`                           | In-place mutation of `places[].imageUrl`                        | `resolvePlaceImageUrl`      | Yes    |

### `firebase.ts`

| Export                   | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `FIREBASE_CONFIG`        | Env-driven client config (public by design).     |
| `getFirebaseApp()`       | Lazy `initializeApp`.                            |
| `getAuthInstance()`      | Lazy `getAuth` (browser local persistence).      |
| `getFirestoreInstance()` | Lazy Firestore with persistent single-tab cache. |
| `getAIService()`         | Lazy Gemini (GoogleAIBackend) + App Check init.  |
