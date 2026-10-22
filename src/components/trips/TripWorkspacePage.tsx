import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { authService } from '../../services/authService';
import { tripService, TripNotFoundError, TripPermissionError } from '../../services/tripService';
import { TripWorkspaceView } from './TripWorkspace';
import { PlanningEditor, type AiAssistState, type PlanningSaveState } from './PlanningEditor';
import { DiscoveryPanel } from './DiscoveryPanel';
import type { DiscoveryHandoffNotice, DiscoverySource, DiscoveryViewState } from './DiscoveryPanel';
import { discoverTripOptions } from '../../services/mockDiscovery/mockDiscoveryService';
import {
  discoverRealOptionsViaServer,
  loadServerDiscoveryClientOptionsFromEnv,
  type ServerDiscoveryClientFetch,
} from '../../services/serverDiscoveryClient';
import { getAuthInstance } from '../../services/firebase';
import type { TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import {
  getDiscoveryHandoffPlanId,
  getDiscoveryHandoffProblem,
  mapDiscoveryResultToExternalProviderHandoffPlan,
  mapDiscoveryResultToHandoffPlan,
} from '../../domain/discovery/handoff';
import { stripTripId } from '../../domain/trips/tripPlanningEdit';
import type { PlanningDraft } from '../../domain/trips/tripPlanningEdit';
import { buildTripPlanningData } from '../../domain/trips/tripPlanning';
import { mergePlanningProposalIntoDraft } from '../../domain/trips/tripPlanningProposal';
import { AiPlanningError, generateTripPlanningProposal } from '../../services/aiPlanningService';
import { TRIPS_PATH } from '../../routes';
import {
  getAllowedTripStatusTransitions,
  isEditableTripStatus,
} from '../../domain/trips/tripModel';
import { Compass, ArrowLeft, Save, Trash2 } from 'lucide-react';
import type { User } from '../../types/travel';
import type { TripId, TripPlanningProposal, TripStatus, TripWorkspace } from '../../types/trip';

/**
 * Standalone screen for a single Trip Workspace, rendered by the
 * `/trips/:tripId` route — outside the App shell (no Navbar/global state).
 *
 * Load states are a discriminated union keyed by the current `tripId` so that
 * navigating between trips never flashes another trip's data: whenever the
 * loaded trip id no longer matches the URL, the view derives back to "loading".
 * No state is set synchronously inside effects; every transition happens after
 * an awaited service call (or is derived during render).
 *
 * Editing boundary: the page owns the minimal editable content for the
 * workspace — the title and the itinerary overview — via a draft buffer keyed
 * to the loaded trip id. `TripWorkspaceView` stays presentational and never
 * calls any trip service method. Saving calls `tripService.updateTrip()`.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }
  | { status: 'success'; trip: TripWorkspace };

/** Local edit draft for the minimal editing boundary (title + overview). */
type EditDraft = { tripId: string; title: string; overview: string };

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'error' };

/** Pending status transition, keyed to the loaded trip. */
type StatusDraft = { tripId: TripId; status: TripStatus } | null;

/** Delete flow: explicit confirmation is required before the trip is removed. */
type DeleteState =
  { status: 'idle' } | { status: 'confirming' } | { status: 'deleting' } | { status: 'error' };

/**
 * STEP 43: the read-only discovery source this build is wired to. The
 * capability flag is non-secret and defaults off, so the app keeps using the
 * deterministic mock providers until a deployment explicitly enables the server
 * boundary. The browser never reaches Amadeus directly in either mode.
 */
const SERVER_DISCOVERY_OPTIONS = loadServerDiscoveryClientOptionsFromEnv(import.meta.env);
const DISCOVERY_SOURCE: DiscoverySource = SERVER_DISCOVERY_OPTIONS.enabled ? 'external' : 'mock';

/** Injected browser transport for the server boundary (no direct provider call). */
const serverDiscoveryFetch: ServerDiscoveryClientFetch = (url, init) => window.fetch(url, init);

/** Supplies the signed-in user's Firebase ID token to the server boundary. */
async function provideServerDiscoveryIdToken(): Promise<string> {
  return (await getAuthInstance().currentUser?.getIdToken()) ?? '';
}

export function TripWorkspacePage() {
  const { tripId } = useParams<{ tripId: TripId }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => authService.user);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [statusDraft, setStatusDraft] = useState<StatusDraft>(null);
  const [statusState, setStatusState] = useState<SaveState>({ status: 'idle' });
  const [deleteState, setDeleteState] = useState<DeleteState>({ status: 'idle' });
  const [planningDraft, setPlanningDraft] = useState<PlanningDraft | null>(null);
  const [planningSaveState, setPlanningSaveState] = useState<PlanningSaveState>({ status: 'idle' });
  const [aiState, setAiState] = useState<AiAssistState>({ status: 'idle' });
  const [discoveryState, setDiscoveryState] = useState<DiscoveryViewState>({ status: 'idle' });
  const [handoffNotice, setHandoffNotice] = useState<DiscoveryHandoffNotice | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | undefined;
    queueMicrotask(() => {
      if (disposed) return;
      unsub = authService.subscribe((next) => setUser(next));
    });
    return () => {
      disposed = true;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    if (!tripId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const trip = await tripService.getTrip(tripId);
        if (cancelled) return;
        setState(trip === null ? { status: 'not-found' } : { status: 'success', trip });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TripNotFoundError) {
          setState({ status: 'not-found' });
        } else if (err instanceof TripPermissionError) {
          setState({ status: 'unauthorized' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not load this trip.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, user?.id]);

  const displayState: LoadState = (() => {
    if (!tripId) return { status: 'error', message: 'Invalid trip link.' };
    if (!user) return { status: 'unauthorized' };
    if (state.status === 'success' && state.trip.id !== tripId) return { status: 'loading' };
    return state;
  })();

  return (
    <div className="section-container animate-fade-in">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <Link
          to={TRIPS_PATH}
          className="btn-secondary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.82rem' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to My Trips
        </Link>
      </div>

      {displayState.status === 'loading' && (
        <div className="state-panel">
          <div className="state-panel-icon">
            <Compass className="w-7 h-7" />
          </div>
          <h3>Loading trip…</h3>
        </div>
      )}

      {displayState.status === 'not-found' && (
        <div className="state-panel">
          <div className="state-panel-icon">
            <Compass className="w-7 h-7" />
          </div>
          <h3>Trip not found</h3>
          <p>This trip may have been deleted, or the link is incorrect.</p>
        </div>
      )}

      {displayState.status === 'unauthorized' && (
        <div className="state-panel">
          <div className="state-panel-icon">
            <Compass className="w-7 h-7" />
          </div>
          <h3>Sign in to view this trip</h3>
          <p>Trip workspaces are private to their owner until shared.</p>
        </div>
      )}

      {displayState.status === 'error' && (
        <div className="state-panel">
          <div className="state-panel-icon">
            <Compass className="w-7 h-7" />
          </div>
          <h3>Could not load trip</h3>
          <p>{displayState.message}</p>
        </div>
      )}

      {displayState.status === 'success' && (
        <SuccessContent
          trip={displayState.trip}
          ownerId={user!.id}
          setDraft={setDraft}
          saveState={saveState}
          setSaveState={setSaveState}
          setState={setState}
          statusDraft={statusDraft}
          setStatusDraft={setStatusDraft}
          statusState={statusState}
          setStatusState={setStatusState}
          deleteState={deleteState}
          setDeleteState={setDeleteState}
          onDeleteSuccess={() => navigate(TRIPS_PATH)}
          planningDraft={planningDraft}
          setPlanningDraft={setPlanningDraft}
          planningSaveState={planningSaveState}
          setPlanningSaveState={setPlanningSaveState}
          aiState={aiState}
          setAiState={setAiState}
          discoveryState={discoveryState}
          setDiscoveryState={setDiscoveryState}
          handoffNotice={handoffNotice}
          setHandoffNotice={setHandoffNotice}
          editedTitle={
            displayState.trip && draft && draft.tripId === displayState.trip.id
              ? draft.title
              : displayState.trip.title
          }
          editedOverview={
            displayState.trip && draft && draft.tripId === displayState.trip.id
              ? draft.overview
              : (displayState.trip.itinerary?.summary ?? '')
          }
          isDirty={
            displayState.trip && draft && draft.tripId === displayState.trip.id
              ? draft.title !== displayState.trip.title ||
                draft.overview !== (displayState.trip.itinerary?.summary ?? '')
              : false
          }
        />
      )}
    </div>
  );
}

/**
 * Editable success-state rendering. The component receives the (already narrowed)
 * non-null `trip` plus the draft/save/status/delete state so TypeScript does not
 * need to track the union narrowing across closures. Every async handler
 * internally compares a ref-stored `trip.id` snapshot against the URL id at
 * call-site to suppress stale responses overwriting newer state.
 */
function SuccessContent({
  trip,
  ownerId,
  setDraft,
  saveState,
  setSaveState,
  setState,
  statusDraft,
  setStatusDraft,
  statusState,
  setStatusState,
  deleteState,
  setDeleteState,
  onDeleteSuccess,
  planningDraft,
  setPlanningDraft,
  planningSaveState,
  setPlanningSaveState,
  aiState,
  setAiState,
  discoveryState,
  setDiscoveryState,
  handoffNotice,
  setHandoffNotice,
  editedTitle,
  editedOverview,
  isDirty,
}: {
  trip: TripWorkspace;
  ownerId: string;
  setDraft: React.Dispatch<React.SetStateAction<EditDraft | null>>;
  saveState: SaveState;
  setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  statusDraft: StatusDraft;
  setStatusDraft: React.Dispatch<React.SetStateAction<StatusDraft>>;
  statusState: SaveState;
  setStatusState: React.Dispatch<React.SetStateAction<SaveState>>;
  deleteState: DeleteState;
  setDeleteState: React.Dispatch<React.SetStateAction<DeleteState>>;
  onDeleteSuccess: () => void;
  planningDraft: PlanningDraft | null;
  setPlanningDraft: React.Dispatch<React.SetStateAction<PlanningDraft | null>>;
  planningSaveState: PlanningSaveState;
  setPlanningSaveState: React.Dispatch<React.SetStateAction<PlanningSaveState>>;
  aiState: AiAssistState;
  setAiState: React.Dispatch<React.SetStateAction<AiAssistState>>;
  discoveryState: DiscoveryViewState;
  setDiscoveryState: React.Dispatch<React.SetStateAction<DiscoveryViewState>>;
  handoffNotice: DiscoveryHandoffNotice | null;
  setHandoffNotice: React.Dispatch<React.SetStateAction<DiscoveryHandoffNotice | null>>;
  editedTitle: string;
  editedOverview: string;
  isDirty: boolean;
}) {
  const tripIdRef = useRef(trip.id);
  useEffect(() => {
    tripIdRef.current = trip.id;
  });

  useEffect(() => {
    setAiState({ status: 'idle' });
    setDiscoveryState({ status: 'idle' });
    setHandoffNotice(null);
    // Reset suggestion/discovery/handoff state when switching trips; handlers also guard on trip id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  /** True while a suggestion is being generated (blocks parallel actions). */
  const aiBusy = aiState.status === 'generating';

  /** A proposal that arrived for a different trip must not render here. */
  const effectiveAiState: AiAssistState =
    aiState.status === 'ready' && aiState.tripId !== trip.id ? { status: 'idle' } : aiState;

  const canSave =
    isDirty &&
    editedTitle.trim().length > 0 &&
    saveState.status !== 'saving' &&
    planningSaveState.status !== 'saving' &&
    deleteState.status === 'idle' &&
    !aiBusy;

  const statusValue = statusDraft?.tripId === trip.id ? statusDraft.status : trip.status;
  const allowedTransitions = getAllowedTripStatusTransitions(trip.status);
  const statusOptions = [trip.status, ...allowedTransitions];
  const statusChanged =
    statusDraft !== null && statusDraft.tripId === trip.id && statusDraft.status !== trip.status;
  const canUpdateStatus =
    statusChanged &&
    saveState.status !== 'saving' &&
    statusState.status !== 'saving' &&
    planningSaveState.status !== 'saving' &&
    deleteState.status === 'idle' &&
    !aiBusy;
  const terminalStatus = !isEditableTripStatus(trip.status);

  const handleSaveChanges = async () => {
    if (!isDirty || editedTitle.trim().length === 0) return;
    const tripIdAtCall = trip.id;
    setSaveState({ status: 'saving' });
    try {
      let updated: TripWorkspace;
      if (trip.itinerary) {
        updated = await tripService.updateTrip(trip.id, {
          title: editedTitle.trim(),
          itinerary: { ...trip.itinerary, summary: editedOverview.trim() },
        });
      } else {
        updated = await tripService.renameTrip(trip.id, ownerId, editedTitle);
      }
      if (tripIdRef.current !== tripIdAtCall) return;
      setState({ status: 'success', trip: updated });
      setDraft({
        tripId: updated.id,
        title: updated.title,
        overview: updated.itinerary?.summary ?? '',
      });
      setSaveState({ status: 'idle' });
    } catch (err) {
      if (tripIdRef.current !== tripIdAtCall) return;
      if (err instanceof TripNotFoundError) {
        setState({ status: 'not-found' });
      } else if (err instanceof TripPermissionError) {
        setState({ status: 'unauthorized' });
      } else {
        setSaveState({ status: 'error' });
      }
    }
  };

  const handleUpdateStatus = async () => {
    const next = statusDraft?.tripId === trip.id ? statusDraft.status : null;
    if (next === null || next === trip.status) return;
    const tripIdAtCall = trip.id;
    setStatusState({ status: 'saving' });
    try {
      const updated = await tripService.updateTripStatus(trip.id, ownerId, next);
      if (tripIdRef.current !== tripIdAtCall) return;
      setState({ status: 'success', trip: updated });
      setStatusDraft(null);
      setStatusState({ status: 'idle' });
    } catch (err) {
      if (tripIdRef.current !== tripIdAtCall) return;
      if (err instanceof TripNotFoundError) {
        setState({ status: 'not-found' });
      } else if (err instanceof TripPermissionError) {
        setState({ status: 'unauthorized' });
      } else {
        setStatusState({ status: 'error' });
      }
    }
  };

  const handleConfirmDelete = async () => {
    const tripIdAtCall = trip.id;
    setDeleteState({ status: 'deleting' });
    try {
      await tripService.deleteTrip(trip.id, ownerId);
      if (tripIdRef.current === tripIdAtCall) onDeleteSuccess();
    } catch (err) {
      if (tripIdRef.current !== tripIdAtCall) return;
      if (err instanceof TripNotFoundError) {
        setState({ status: 'not-found' });
      } else if (err instanceof TripPermissionError) {
        setState({ status: 'unauthorized' });
      } else {
        setDeleteState({ status: 'error' });
      }
    }
  };

  const deleteDisabled =
    saveState.status === 'saving' ||
    statusState.status === 'saving' ||
    planningSaveState.status === 'saving' ||
    deleteState.status === 'deleting' ||
    aiBusy;

  const handleSavePlanning = async (draftToSave: PlanningDraft) => {
    if (draftToSave.tripId !== trip.id) return;
    const tripIdAtCall = trip.id;
    setPlanningSaveState({ status: 'saving' });
    try {
      const updated = await tripService.updateTripPlanning(
        trip.id,
        ownerId,
        stripTripId(draftToSave)
      );
      if (tripIdRef.current !== tripIdAtCall) return;
      setState({ status: 'success', trip: updated });
      setPlanningDraft(null);
      setPlanningSaveState({ status: 'idle' });
      setHandoffNotice(null);
    } catch (err) {
      if (tripIdRef.current !== tripIdAtCall) return;
      if (err instanceof TripNotFoundError) {
        setState({ status: 'not-found' });
      } else if (err instanceof TripPermissionError) {
        setState({ status: 'unauthorized' });
      } else {
        setPlanningSaveState({ status: 'error' });
      }
    }
  };

  /**
   * Requests a validated AI proposal. The AI layer only drafts — nothing is
   * written here — and any stale response (trip changed meanwhile) is dropped.
   */
  const handleGenerateSuggestion = async (instruction: string) => {
    const tripIdAtCall = trip.id;
    const previousDraft =
      planningDraft !== null && planningDraft.tripId === trip.id ? planningDraft : null;
    setAiState({ status: 'generating' });
    try {
      const proposal = await generateTripPlanningProposal(buildTripPlanningData(trip), instruction);
      if (tripIdRef.current !== tripIdAtCall) return;
      setAiState({
        status: 'ready',
        tripId: tripIdAtCall,
        proposal,
        previousDraft,
        applied: false,
      });
    } catch (err) {
      if (tripIdRef.current !== tripIdAtCall) return;
      const message =
        err instanceof AiPlanningError
          ? err.message
          : 'Could not generate a planning suggestion right now. Please try again.';
      setAiState({ status: 'error', message });
    }
  };

  /**
   * Approves a proposal: stages its edits into the LOCAL draft only (existing
   * draft edits survive — present proposal keys win, absent keys untouched).
   * Nothing reaches Firestore here; persistence still goes through Save planning.
   */
  const handleApplySuggestion = (proposal: TripPlanningProposal): void => {
    if (aiState.status !== 'ready' || aiState.tripId !== trip.id) return;
    const base =
      planningDraft !== null && planningDraft.tripId === trip.id
        ? planningDraft
        : { tripId: trip.id };
    setPlanningDraft(mergePlanningProposalIntoDraft(base, proposal));
    setAiState({
      status: 'ready',
      tripId: trip.id,
      proposal,
      previousDraft: aiState.previousDraft,
      applied: true,
    });
  };

  /** Cancels the active suggestion; restores a staged-applied proposal from its draft snapshot. */
  const handleDiscardSuggestion = (): void => {
    if (aiState.status === 'ready' && aiState.tripId === trip.id && aiState.applied) {
      const previous =
        aiState.previousDraft !== null && aiState.previousDraft.tripId === trip.id
          ? aiState.previousDraft
          : null;
      if (previous !== null) setPlanningDraft(previous);
    }
    setAiState({ status: 'idle' });
  };

  /**
   * Runs a read-only discovery search. The page chooses the source: the
   * authenticated server boundary when the non-secret capability flag is on
   * (STEP 43), otherwise the deterministic mock providers. The service is
   * deliberately wired through a microtask boundary so the loading state is a
   * real, renderable stage in the async search flow — no timers, no fake
   * delays. Discovery never persists: it only builds a transient outcome for
   * display, and stale responses (trip changed meanwhile) are dropped.
   */
  const handleDiscoverySearch = async (query: TripDiscoveryQuery): Promise<void> => {
    const tripIdAtCall = trip.id;
    setDiscoveryState({ status: 'loading' });
    await Promise.resolve();
    if (tripIdRef.current !== tripIdAtCall) return;
    const now = new Date().toISOString();
    const outcome =
      DISCOVERY_SOURCE === 'external'
        ? await discoverRealOptionsViaServer(query, {
            endpoint: SERVER_DISCOVERY_OPTIONS.endpoint,
            enabled: true,
            tokenProvider: provideServerDiscoveryIdToken,
            fetchImpl: serverDiscoveryFetch,
          })
        : discoverTripOptions(query, now);
    if (tripIdRef.current !== tripIdAtCall) return;
    setDiscoveryState({ status: 'complete', searchedAt: now, outcome });
  };

  const handleDiscoveryReset = (): void => {
    setDiscoveryState({ status: 'idle' });
  };

  /** Plan ids already staged in the draft or persisted on the itinerary. */
  const existingPlanIds = new Set<string>([
    ...(planningDraft?.transportPlans ?? trip.itinerary?.transportPlans ?? []).map((p) => p.id),
    ...(planningDraft?.accommodationPlans ?? trip.itinerary?.accommodationPlans ?? []).map(
      (p) => p.id
    ),
  ]);

  /**
   * STEP 22: user-triggered discovery-to-planning handoff. The page is the only
   * writer — it appends the mapped plan into the existing local planning draft
   * (never into Firestore) and stamps the notice. The selected result is
   * guarded here too: only a complete, current, transport/accommodation result
   * whose `handoff-<resultId>` plan id is not already present can be imported.
   */
  const handleDiscoveryHandoff = (result: TripProviderResult): void => {
    if (discoveryState.status !== 'complete') return;
    const now = discoveryState.searchedAt;
    if (getDiscoveryHandoffProblem(result, now) !== null) return;
    const planId = getDiscoveryHandoffPlanId(result.resultId);
    if (existingPlanIds.has(planId)) return;
    const mapped =
      DISCOVERY_SOURCE === 'external'
        ? mapDiscoveryResultToExternalProviderHandoffPlan(result, now, planId)
        : mapDiscoveryResultToHandoffPlan(result, now, planId);
    if (mapped === null) return;
    const base =
      planningDraft !== null && planningDraft.tripId === trip.id
        ? planningDraft
        : { tripId: trip.id };
    if (mapped.kind === 'transport') {
      setPlanningDraft({
        ...base,
        transportPlans: [
          ...(base.transportPlans ?? trip.itinerary?.transportPlans ?? []),
          mapped.plan,
        ],
      });
    } else {
      setPlanningDraft({
        ...base,
        accommodationPlans: [
          ...(base.accommodationPlans ?? trip.itinerary?.accommodationPlans ?? []),
          mapped.plan,
        ],
      });
    }
    setHandoffNotice({ planId, kind: mapped.kind, title: result.title });
  };

  /**
   * STEP 22: removes a handoff plan from the staging draft only. When the
   * removable plan was the only staged one for its section, the section key is
   * dropped so the persisted section (if any) shows through again — a scoped
   * cancel, never a persistence or trip mutation.
   */
  const handleDiscardHandoff = (planId: string): void => {
    const base =
      planningDraft !== null && planningDraft.tripId === trip.id
        ? planningDraft
        : { tripId: trip.id };
    const nextDraft: PlanningDraft = { ...base };
    if (base.transportPlans !== undefined) {
      const remainingTransport = base.transportPlans.filter((p) => p.id !== planId);
      if (remainingTransport.length > 0) nextDraft.transportPlans = remainingTransport;
      else delete nextDraft.transportPlans;
    }
    if (base.accommodationPlans !== undefined) {
      const remainingAccommodation = base.accommodationPlans.filter((p) => p.id !== planId);
      if (remainingAccommodation.length > 0) nextDraft.accommodationPlans = remainingAccommodation;
      else delete nextDraft.accommodationPlans;
    }
    setPlanningDraft(nextDraft);
    setHandoffNotice((prev) => (prev !== null && prev.planId === planId ? null : prev));
  };

  return (
    <>
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderRadius: '20px',
          background: 'rgba(15,23,42,0.75)',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginBottom: '0.9rem',
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
            Edit trip details
          </p>
          {isDirty && (
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
            }}
          >
            <label
              htmlFor="trip-title"
              style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}
            >
              Title
            </label>
            <input
              id="trip-title"
              value={editedTitle}
              onChange={(event) =>
                setDraft({ tripId: trip.id, title: event.target.value, overview: editedOverview })
              }
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '0.9rem',
                padding: '0.6rem 0.8rem',
                outline: 'none',
              }}
            />
          </div>

          {trip.itinerary && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              <label
                htmlFor="trip-overview"
                style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}
              >
                Overview
              </label>
              <textarea
                id="trip-overview"
                rows={4}
                value={editedOverview}
                onChange={(event) =>
                  setDraft({
                    tripId: trip.id,
                    title: editedTitle,
                    overview: event.target.value,
                  })
                }
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  padding: '0.6rem 0.8rem',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
              />
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => void handleSaveChanges()}
              disabled={!canSave}
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
              {saveState.status === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
            {saveState.status === 'error' && (
              <span role="alert" style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                Could not save your changes. Please try again.
              </span>
            )}
          </div>
        </div>
      </div>

      <PlanningEditor
        trip={trip}
        draft={planningDraft}
        onChange={setPlanningDraft}
        onSave={(draftToSave) => void handleSavePlanning(draftToSave)}
        saveState={planningSaveState}
        disabled={
          saveState.status === 'saving' ||
          statusState.status === 'saving' ||
          deleteState.status === 'deleting' ||
          aiBusy
        }
        aiState={effectiveAiState}
        onGenerateSuggestion={(instruction) => void handleGenerateSuggestion(instruction)}
        onApplySuggestion={handleApplySuggestion}
        onDiscardSuggestion={handleDiscardSuggestion}
      />

      <DiscoveryPanel
        state={discoveryState}
        source={DISCOVERY_SOURCE}
        onSearch={(query) => void handleDiscoverySearch(query)}
        onReset={handleDiscoveryReset}
        handoff={{
          getPlanId: getDiscoveryHandoffPlanId,
          isPlanPresent: (planId) => existingPlanIds.has(planId),
          onImport: handleDiscoveryHandoff,
          onRemove: (planId) => handleDiscardHandoff(planId),
          notice: handoffNotice,
        }}
      />

      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderRadius: '20px',
          background: 'rgba(15,23,42,0.75)',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: '1.25rem',
        }}
      >
        <p
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#a78bfa',
            margin: '0 0 0.9rem 0',
          }}
        >
          Lifecycle
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label
              htmlFor="trip-status"
              style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}
            >
              Status
            </label>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
            >
              <select
                id="trip-status"
                value={statusValue}
                onChange={(event) =>
                  setStatusDraft({
                    tripId: trip.id,
                    status: event.target.value as TripStatus,
                  })
                }
                disabled={
                  terminalStatus ||
                  saveState.status === 'saving' ||
                  statusState.status === 'saving' ||
                  planningSaveState.status === 'saving' ||
                  deleteState.status === 'deleting' ||
                  aiBusy
                }
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  padding: '0.6rem 0.8rem',
                  outline: 'none',
                  minWidth: '11rem',
                }}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s === trip.status ? `${s.replace(/_/g, ' ')} (current)` : s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleUpdateStatus()}
                disabled={!canUpdateStatus}
                className="btn-secondary"
                style={{
                  padding: '0.55rem 1.2rem',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                }}
              >
                {statusState.status === 'saving' ? 'Updating…' : 'Update status'}
              </button>
            </div>
            {terminalStatus && (
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                This status is final.
              </span>
            )}
            {statusState.status === 'error' && (
              <span role="alert" style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                Could not update the trip status. Please try again.
              </span>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              paddingTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            <p
              style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#fca5a5',
                margin: 0,
              }}
            >
              Delete trip
            </p>
            {deleteState.status === 'idle' && (
              <>
                <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0 }}>
                  Permanently remove this trip and all its data. This cannot be undone.
                </p>
                <button
                  type="button"
                  onClick={() => setDeleteState({ status: 'confirming' })}
                  disabled={deleteDisabled}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '0.55rem 1.2rem',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    borderRadius: '14px',
                    border: '1px solid rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#fca5a5',
                    cursor: deleteDisabled ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete trip
                </button>
              </>
            )}
            {deleteState.status === 'confirming' && (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: '0.85rem', color: '#fde68a' }}>
                  Are you sure? This action cannot be undone.
                </span>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={deleteDisabled}
                  className="btn-primary"
                  style={{
                    padding: '0.55rem 1.1rem',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    borderRadius: '14px',
                    background: 'rgba(239,68,68,0.8)',
                    border: '1px solid rgba(239,68,68,0.5)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Yes, delete trip
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteState({ status: 'idle' })}
                  disabled={deleteDisabled}
                  className="btn-secondary"
                  style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem', fontWeight: 800 }}
                >
                  Keep trip
                </button>
              </div>
            )}
            {deleteState.status === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <span role="alert" style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                  Could not delete the trip. Please try again.
                </span>
                <button
                  type="button"
                  onClick={() => setDeleteState({ status: 'idle' })}
                  disabled={deleteDisabled}
                  className="btn-secondary"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '0.5rem 1rem',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <TripWorkspaceView workspace={trip} />
    </>
  );
}
