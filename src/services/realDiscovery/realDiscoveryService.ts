/**
 * Read-only real external-provider discovery service (STEP 41).
 *
 * The single read-only entry point for a REAL external discovery provider in
 * the app today. It composes the unchanged STEP 39/40 architecture with the new
 * Amadeus adapter — it never rewrites orchestration — and always returns a
 * first-class, bounded outcome:
 *
 * - `not-configured` — attempt disabled (default) or credentials missing. This
 *   is the honest answer for the browser build: no server-side execution
 *   boundary exists to decrypt/hold credentials, so the client never even
 *   tries. Never a silent empty result and never a crash.
 * - `invalid-input` — the raw query failed the shared STEP 21 discovery-input
 *   boundary.
 * - `provider-failure` — the real provider network/parse path failed, with a
 *   bounded safe STEP 20 error category.
 * - `success`/`partial`/`empty`/`unsupported` — resolved by the unchanged
 *   STEP 40 orchestrator through the real adapter.
 *
 * Contract rules:
 *
 * 1. **Default off, always.** `discoverRealOptions` with the browser default
 *    config (`{ attemptEnabled: false }`) returns `not-configured` before any
 *    transport is ever touched. The app's UI is never wired to this service; a
 *    real-provider attempt is never a UI default.
 * 2. **Offline-testable.** `runRealDiscoveryWithAdapter` / `outcomeFromAggregate`
 *    exercise the full orchestrator path with an injected adapter + injected
 *    payload provider (no network). The async `discoverRealOptions` accepts an
 *    injected transport; every test feeds a fake one.
 * 3. **Read-only and transient.** No Firestore, tripService, AI, booking,
 *    payment, verification, persistence, or primary assignment. Results are
 *    transient quotes for display and explicit user adoption only.
 * 4. **Honest composition.** A not-ready adapter is handled before the
 *    orchestrator so "credentials missing" is its own outcome instead of an
 *    `unsupported` stage; a ready adapter flows through `orchestrateDiscovery`
 *    unchanged.
 *
 * Determinism: same `(raw, config, now, transport)` yields the same outcome.
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderAdapterProfile } from '../../domain/providers/providerAdapter';
import type {
  TripDiscoveryQuery,
  TripDiscoveryQueryProblem,
} from '../../domain/providers/discoveryInput';
import {
  getTripDiscoveryQueryProblem,
  normalizeTripDiscoveryQuery,
} from '../../domain/providers/discoveryInput';
import {
  orchestrateDiscovery,
  PROVIDER_DISCOVERY_FAILURE_STATUSES,
  type ProviderDiscoveryAggregate,
  type ProviderDiscoveryStage,
} from '../../domain/providers/discoveryOrchestration';
import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { ProviderAdapter } from '../../domain/providers/providerAdapter';
import type { ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import type { TripProviderResult } from '../../domain/providers/providerResults';
import type { AmadeusDiscoveryConfig } from './amadeusConfig';
import { getRealDiscoveryAttemptGate } from './amadeusConfig';
import { createAmadeusDiscoveryAdapter } from './amadeusAdapter';
import { runAmadeusHotelSearch, type AmadeusTransport } from './amadeusConnection';

/** The stable outcome statuses a real-provider discovery search can report. */
export type RealDiscoveryStatus =
  | 'success'
  | 'partial'
  | 'empty'
  | 'unsupported'
  | 'provider-failure'
  | 'invalid-input'
  | 'not-configured'
  | 'unexpected-failure';

/** Per-provider attribution for one consulted adapter during a real search. */
export interface RealDiscoveryProviderOutcome {
  /** The adapter's stable source identifier. */
  providerId: string;
  /** The adapter's display source name. */
  providerName: string;
  /** How this provider's stage resolved (STEP 40 per-provider status). */
  status: ProviderDiscoveryStage['status'];
  /** How many normalized results this provider contributed. */
  resultCount: number;
  /** Bounded safe error when this provider failed; `null` otherwise. */
  error: ProviderSafeError | null;
}

/**
 * The normalized outcome of a read-only real-provider discovery search.
 * `results` are live provider quotes strictly for display; nothing is
 * persisted. All boundaries carry bounded safe errors — no stack traces, raw
 * payloads, or credentials ever reach the UI.
 */
export interface RealDiscoveryOutcome {
  status: RealDiscoveryStatus;
  /** The adapters that were consulted (for presenting provider/source identity). */
  adaptersConsulted: ProviderAdapterProfile[];
  /** Normalized real-provider results when `success` or `partial`; empty otherwise. */
  results: TripProviderResult[];
  /** The normalized query that ran, or `null` when the input was rejected. */
  query: TripDiscoveryQuery | null;
  /** Present only for `invalid-input`. */
  problem: TripDiscoveryQueryProblem | null;
  /** Present for `not-configured` / `provider-failure` (bounded, safe category). */
  error: ProviderSafeError | null;
  /** Per-provider attribution for every consulted adapter (STEP 40). */
  providerOutcomes: RealDiscoveryProviderOutcome[];
}

/** The capability id a real accommodation search needs before it may run. */
export const REAL_DISCOVERY_ACCOMMODATION_CAPABILITY: ProviderCapabilityId = 'search-accommodation';

/** Options the async search accepts (all optional; tests inject a fake transport). */
export interface DiscoverRealOptions {
  /** Injected network seam; required only when the config gate is `ready`. */
  transport?: AmadeusTransport;
}

/**
 * Runs a read-only real-provider discovery search for a raw query and the
 * injected config. Never throws; never persists; never mutates anything; never
 * books, pays, or verifies. With the always-off browser default it returns
 * `not-configured` before any network or provider code is touched.
 */
export async function discoverRealOptions(
  raw: unknown,
  config: AmadeusDiscoveryConfig,
  now: string,
  options?: DiscoverRealOptions
): Promise<RealDiscoveryOutcome> {
  const attemptGate = getRealDiscoveryAttemptGate(config);
  if (attemptGate === 'disabled') {
    return {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: {
        category: 'not-implemented',
        message: 'Real-provider discovery is not enabled in this build.',
      },
      providerOutcomes: [],
    };
  }
  if (attemptGate === 'credentials-missing') {
    return {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: {
        category: 'credentials-missing',
        message: 'Real-provider credentials are not configured for this build.',
      },
      providerOutcomes: [],
    };
  }

  const problem = getTripDiscoveryQueryProblem(raw);
  if (problem !== null) {
    return {
      status: 'invalid-input',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem,
      error: null,
      providerOutcomes: [],
    };
  }

  const query = normalizeTripDiscoveryQuery(raw);
  if (query === null) {
    return unexpectedOutcome(null, []);
  }

  if (options?.transport === undefined) {
    return {
      status: 'provider-failure',
      adaptersConsulted: [],
      results: [],
      query,
      problem: null,
      error: {
        category: 'not-implemented',
        message: 'No Amadeus transport is configured for this build.',
      },
      providerOutcomes: [],
    };
  }

  const search = await runAmadeusHotelSearch(config, options.transport, query);
  if (!search.ok) {
    return {
      status: 'provider-failure',
      adaptersConsulted: [],
      results: [],
      query,
      problem: null,
      error: search.error,
      providerOutcomes: [],
    };
  }

  return runRealDiscoveryWithPayload(raw, config, search.payload, now);
}

/**
 * Runs a real-provider discovery against an already-fetched payload
 * (synchronous, deterministic, offline). This is the path every success case
 * composes to, and tests use it to prove the full orchestrator flow without a
 * network. The payload still passes through the real adapter's mapping.
 */
export function runRealDiscoveryWithPayload(
  raw: unknown,
  config: AmadeusDiscoveryConfig,
  payload: unknown,
  now: string
): RealDiscoveryOutcome {
  const problem = getTripDiscoveryQueryProblem(raw);
  if (problem !== null) {
    return {
      status: 'invalid-input',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem,
      error: null,
      providerOutcomes: [],
    };
  }

  const query = normalizeTripDiscoveryQuery(raw);
  if (query === null) {
    return unexpectedOutcome(null, []);
  }

  const adapter = createAmadeusDiscoveryAdapter(config, () => payload);
  return outcomeFromAggregate(orchestrateDiscovery(query, [adapter], now));
}

/**
 * Runs a real-provider discovery against an explicitly supplied adapter
 * (exported for the unsupported-capability test path, mirroring the mock
 * service contract). The adapter's capability is gated before `search`.
 */
export function runRealDiscoveryWithAdapter(
  query: TripDiscoveryQuery,
  adapter: ProviderAdapter,
  now: string
): RealDiscoveryOutcome {
  return outcomeFromAggregate(orchestrateDiscovery(query, [adapter], now));
}

/**
 * Maps an orchestrator aggregate to the stable real-provider outcome. Exported
 * for the defensive-contract test path: the `unexpected-failure` fallback is
 * reachable only by feeding an aggregate the orchestrator could never produce.
 */
export function outcomeFromAggregate(aggregate: ProviderDiscoveryAggregate): RealDiscoveryOutcome {
  const adaptersConsulted: ProviderAdapterProfile[] = aggregate.stages.map((stage) => ({
    id: stage.providerId,
    name: stage.providerName,
    capabilities: [
      {
        capability: REAL_DISCOVERY_ACCOMMODATION_CAPABILITY,
        status: 'unavailable-missing-credentials',
      },
    ],
  }));

  const providerOutcomes = aggregate.stages.map(providerOutcomeFromStage);

  if (aggregate.status === 'success' || aggregate.status === 'partial') {
    return {
      status: aggregate.status,
      adaptersConsulted,
      results: aggregate.results,
      query: aggregate.query,
      problem: null,
      error: null,
      providerOutcomes,
    };
  }

  if (aggregate.status === 'empty') {
    return {
      status: 'empty',
      adaptersConsulted,
      results: [],
      query: aggregate.query,
      problem: null,
      error: null,
      providerOutcomes,
    };
  }

  if (aggregate.status === 'unsupported' || aggregate.status === 'no-adapters') {
    return {
      status: 'unsupported',
      adaptersConsulted,
      results: [],
      query: aggregate.query,
      problem: null,
      error: null,
      providerOutcomes,
    };
  }

  if (aggregate.status === 'failed') {
    const failingStage = aggregate.stages.find((stage) =>
      PROVIDER_DISCOVERY_FAILURE_STATUSES.includes(stage.status)
    );
    const error =
      failingStage?.error ??
      ({
        category: 'provider-unavailable',
        message: 'No real provider could complete the search.',
      } satisfies ProviderSafeError);
    return {
      status: 'provider-failure',
      adaptersConsulted,
      results: [],
      query: aggregate.query,
      problem: null,
      error,
      providerOutcomes,
    };
  }

  return unexpectedOutcome(aggregate.query, adaptersConsulted);
}

function providerOutcomeFromStage(stage: ProviderDiscoveryStage): RealDiscoveryProviderOutcome {
  if (stage.status === 'success' || stage.status === 'empty') {
    return {
      providerId: stage.providerId,
      providerName: stage.providerName,
      status: stage.status,
      resultCount: stage.resultCount,
      error: null,
    };
  }
  return {
    providerId: stage.providerId,
    providerName: stage.providerName,
    status: stage.status,
    resultCount: stage.resultCount,
    error:
      stage.error ??
      ({
        category: 'provider-unavailable',
        message: 'The real provider could not complete the search.',
      } satisfies ProviderSafeError),
  };
}

function unexpectedOutcome(
  query: TripDiscoveryQuery | null,
  adaptersConsulted: ProviderAdapterProfile[]
): RealDiscoveryOutcome {
  return {
    status: 'unexpected-failure',
    adaptersConsulted,
    results: [],
    query,
    problem: null,
    error: {
      category: 'unknown',
      message: 'The real provider search returned an unexpected result.',
    },
    providerOutcomes: [],
  };
}
