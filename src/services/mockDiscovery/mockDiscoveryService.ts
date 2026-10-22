/**
 * Read-only mock discovery service (STEP 40).
 *
 * The single read-only entry point for external discovery in the app today. It
 * exercises the STEP 40 provider orchestration architecture end-to-end with
 * deterministic mock adapters and fixture data:
 *
 * 1. The caller passes a raw query plus an explicit `now` (ISO date-time). The
 *    service normalizes the query through the shared STEP 39 discovery-input
 *    boundary — malformed input returns `invalid-input` with a bounded problem,
 *    never a guess.
 * 2. The per-category adapter registry is resolved to the adapters for the
 *    queried category and handed to the pure STEP 40 orchestrator
 *    (`orchestrateDiscovery`). The orchestrator runs each adapter behind its
 *    STEP 20 capability guard, isolates every failure, bounds every error, and
 *    computes the honest aggregate (`success`, `partial`, `empty`, `failed`,
 *    `unsupported`, `no-adapters`).
 * 3. The aggregate is mapped to a stable outcome that keeps per-provider
 *    attribution (`providerOutcomes`) so results always say which provider
 *    supplied which option and never claim one provider represents them all.
 *
 * This service is deliberately read-only, read-model-only, and side-effect free:
 *   - It never touches Firestore, tripService, the AI, or any persistence.
 *   - It never books, pays, verifies, retrieves a booking, or cancels.
 *   - It performs no network calls, holds no provider credentials, and carries
 *     no provider SDK objects.
 *   - Results are transient mock fixtures for display only and are never stored
 *     or merged into a trip.
 *
 * Determinism: same `(raw, now)` always yields the same outcome. Errors are
 * always bounded, safe STEP 20 categories — no stack traces, raw payloads, or
 * credentials ever reach the UI.
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
import type { TripProviderResult } from '../../domain/providers/providerResults';
import {
  DISCOVERY_CATEGORY_CAPABILITY,
  MOCK_DISCOVERY_CATEGORY_ADAPTERS,
  type MockDiscoveryAdapter,
} from './mockProviders';

/** The stable outcome statuses a discovery search can report. */
export type MockDiscoveryStatus =
  | 'success'
  | 'partial'
  | 'empty'
  | 'unsupported'
  | 'provider-failure'
  | 'invalid-input'
  | 'unexpected-failure';

/** Per-provider attribution for one consulted adapter during a search. */
export interface MockDiscoveryProviderOutcome {
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
 * The normalized outcome of a read-only mock discovery search. `results` are
 * mock fixture results strictly for display; nothing here is persisted.
 */
export interface MockDiscoveryOutcome {
  status: MockDiscoveryStatus;
  /** The adapters that were consulted (for presenting provider/source identity). */
  adaptersConsulted: ProviderAdapterProfile[];
  /** Normalized mock results when `success` or `partial`; always empty otherwise. */
  results: TripProviderResult[];
  /** The normalized query that ran, or `null` when the input was rejected. */
  query: TripDiscoveryQuery | null;
  /** Present only for `invalid-input`. */
  problem: TripDiscoveryQueryProblem | null;
  /** Present only for `provider-failure` (bounded, safe STEP 20 category). */
  error: ProviderSafeError | null;
  /** Per-provider attribution for every consulted adapter (STEP 40). */
  providerOutcomes: MockDiscoveryProviderOutcome[];
}

/**
 * Runs a read-only mock discovery search for a raw query. Never throws; never
 * persists; never mutates anything. `now` is an explicit caller-supplied ISO
 * date-time that keeps every result deterministic and testable.
 */
export function discoverTripOptions(raw: unknown, now: string): MockDiscoveryOutcome {
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

  const adapters = MOCK_DISCOVERY_CATEGORY_ADAPTERS[query.category] ?? [];
  return outcomeFromAggregate(orchestrateDiscovery(query, adapters, now));
}

/**
 * Runs a discovery search against an explicitly supplied adapter (exported for
 * the unsupported-capability and injected-failure test paths). The adapter's
 * capability is checked before `search` is ever called — a non-operational
 * capability returns `unsupported` and the adapter's `search` is not invoked.
 */
export function runDiscoveryWithAdapter(
  query: TripDiscoveryQuery,
  adapter: MockDiscoveryAdapter,
  now: string
): MockDiscoveryOutcome {
  return outcomeFromAggregate(orchestrateDiscovery(query, [adapter], now));
}

/**
 * Maps an orchestrator aggregate to the stable read-only outcome. Exported for
 * the defensive-contract test path: `orchestrateDiscovery` seals its status
 * vocabulary to exactly the six statuses mapped here, so the composition's
 * `unexpected-failure` fallback is reachable only by feeding an aggregate the
 * orchestrator could never produce.
 */
export function outcomeFromAggregate(aggregate: ProviderDiscoveryAggregate): MockDiscoveryOutcome {
  const adaptersConsulted = aggregate.stages.map((stage) => ({
    id: stage.providerId,
    name: stage.providerName,
    capabilities: [
      {
        capability: DISCOVERY_CATEGORY_CAPABILITY[aggregate.query.category],
        status: 'available' as const,
      },
    ],
    adapterType: 'mock' as const,
    sourceDomain: 'external' as const,
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
        message: 'No mock provider could complete the simulated search.',
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

function providerOutcomeFromStage(stage: ProviderDiscoveryStage): MockDiscoveryProviderOutcome {
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
        message: 'The simulated provider could not complete the search.',
      } satisfies ProviderSafeError),
  };
}

/** Provider stage statuses that reflect a provider that failed or was unavailable. */

function unexpectedOutcome(
  query: TripDiscoveryQuery | null,
  adaptersConsulted: ProviderAdapterProfile[]
): MockDiscoveryOutcome {
  return {
    status: 'unexpected-failure',
    adaptersConsulted,
    results: [],
    query,
    problem: null,
    error: {
      category: 'unknown',
      message: 'The simulated search returned an unexpected result.',
    },
    providerOutcomes: [],
  };
}
