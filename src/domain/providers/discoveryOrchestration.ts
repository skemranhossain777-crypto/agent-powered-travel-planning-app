/**
 * Pure, provider-independent multi-adapter discovery orchestration (STEP 40).
 *
 * Runs one read-only discovery request against an ordered collection of
 * provider adapters through the shared STEP 39 `ProviderAdapter.search`
 * boundary, then aggregates every adapter's normalized outcome into a single
 * honest result set. Deliberately side-effect free and dependency-free: no
 * React, Firebase, Router, Zustand, service, component, network, clock, `any`,
 * or generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. **Deterministic adapter ordering.** Adapters run in the exact order the
 *    caller supplies. Provider stages are reported in that same order. Nothing
 *    depends on object-key enumeration, randomness, current time, network
 *    completion order, or unstable collection ordering.
 * 2. **Deterministic result ordering.** Results are emitted in adapter order
 *    first, then each adapter's own result order. No ranking or scoring is
 *    introduced.
 * 3. **Deterministic deduplication.** A result's identity is exactly
 *    `providerId` + `resultId` (`getProviderResultIdentity`). The first
 *    occurrence in the deterministic ordered stream wins; there is no fuzzy or
 *    title/description matching, and records from different providers are never
 *    merged just because they look similar.
 * 4. **Failure isolation.** One adapter's failure never discards another
 *    adapter's valid results. A provider that fails is reported with its own
 *    bounded safe error and status; the aggregate status distinguishes
 *    `success`, `partial` (some results plus at least one failed/unsupported
 *    provider), `empty`, `failed`, `unsupported`, and `no-adapters`.
 * 5. **Provider attribution.** Every result keeps its normalized
 *    `providerId`, `providerName`, and `resultId` throughout aggregation;
 *    provider SDK objects and raw provider payloads never appear here.
 * 6. **Capability gating.** An adapter whose required category capability is
 *    not operational reports an `unsupported` stage and its `search` is never
 *    invoked (STEP 20 guard).
 * 7. **Honest envelopes only.** A `search` returning `null`, an unexpected
 *    operation kind, or a failure carries the adapter's safe error category
 *    mapped to a distinct stage status (`timeout`, `rate-limited`,
 *    `provider-unavailable`, `malformed-response`, `provider-failure`, or
 *    `unknown-failure`). Failure messages never contain raw payloads.
 *
 * Nothing here books, pays, verifies, persists, schedules, or assigns a
 * primary reference; the aggregate is transient read-only data for display and
 * explicit user adoption.
 */

import type { DiscoveryCategory, TripDiscoveryQuery } from './discoveryInput';
import type { ProviderCapabilityId } from './providerCapabilities';
import { isAdapterCapabilityAvailable, type ProviderAdapter } from './providerAdapter';
import type { ProviderExecutionResult, ProviderSafeError } from './executionOperations';
import type { TripProviderResult } from './providerResults';

/** The capability id each discovery category must be operational for before a search runs. */
export const DISCOVERY_CATEGORY_CAPABILITY: Readonly<
  Record<DiscoveryCategory, ProviderCapabilityId>
> = {
  transport: 'search-transport',
  accommodation: 'search-accommodation',
};

/** One adapter's contribution to an aggregate discovery search. */
export interface ProviderDiscoveryStage {
  /** Provider identity — survives orchestration everywhere. */
  providerId: string;
  /** Human-readable provider label for display only. */
  providerName: string;
  /** Honest per-provider outcome status. */
  status: ProviderDiscoveryStageStatus;
  /** How many normalized results this adapter returned (before deduplication). */
  resultCount: number;
  /** Bounded safe error for failure-stage outcomes; null otherwise. */
  error: ProviderSafeError | null;
}

/**
 * The recognized per-provider discovery outcome statuses. The failure
 * vocabulary mirrors the STEP 39 safe error categories so a timeout is never
 * reported as "no results" and a malformed response is never reported as a
 * generic failure.
 */
export type ProviderDiscoveryStageStatus =
  | 'success'
  | 'empty'
  | 'unsupported'
  | 'timeout'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'malformed-response'
  | 'provider-failure'
  | 'unknown-failure';

/** Aggregate statuses that make partial success explicit and honest. */
export type ProviderDiscoveryAggregateStatus =
  'success' | 'partial' | 'empty' | 'failed' | 'unsupported' | 'no-adapters';

/** The deterministic, provider-neutral result of orchestrating many adapters. */
export interface ProviderDiscoveryAggregate {
  /** Aggregate status computed from the stages and the flattened results. */
  status: ProviderDiscoveryAggregateStatus;
  /** The normalized query that ran. */
  query: TripDiscoveryQuery;
  /** Deduplicated normalized results in deterministic order (never a raw payload). */
  results: TripProviderResult[];
  /** One stage per supplied adapter, in adapter order. */
  stages: ProviderDiscoveryStage[];
  /** Number of results after deduplication. */
  totalResults: number;
}

/** The separator used to build a provider result's deterministic identity. */
export const PROVIDER_RESULT_IDENTITY_SEPARATOR = '::';

/**
 * The deterministic identity of a normalized discovery result: provider
 * identity plus the provider's own result id. This is the only identity rule —
 * records are never merged by fuzzy title, summary, or price similarity.
 */
export function getProviderResultIdentity(result: TripProviderResult): string {
  return `${result.providerId}${PROVIDER_RESULT_IDENTITY_SEPARATOR}${result.resultId}`;
}

/**
 * Removes duplicate results while preserving deterministic order. A duplicate
 * is a later result whose `providerId` + `resultId` identity already appeared;
 * the first occurrence wins.
 */
export function deduplicateProviderResults(
  results: ReadonlyArray<TripProviderResult>
): TripProviderResult[] {
  const seen = new Set<string>();
  const out: TripProviderResult[] = [];
  for (const result of results) {
    const key = getProviderResultIdentity(result);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

/** Outcome statuses that represent a failed or unavailable provider (not success/empty). */
export const PROVIDER_DISCOVERY_FAILURE_STATUSES: ReadonlyArray<ProviderDiscoveryStageStatus> = [
  'unsupported',
  'timeout',
  'rate-limited',
  'provider-unavailable',
  'malformed-response',
  'provider-failure',
  'unknown-failure',
];

/**
 * Computes the deterministic aggregate status from the per-provider stages and
 * the deduplicated result count:
 *
 * - `no-adapters` — no adapters were supplied.
 * - `success` — at least one result and no failed/unsupported provider.
 * - `partial` — at least one result and at least one failed/unsupported provider.
 * - `unsupported` — every adapter reported an unsupported capability.
 * - `failed` — no results and at least one failed/unsupported provider.
 * - `empty` — no results, no failures, and at least one provider returned zero.
 */
export function getProviderDiscoveryAggregateStatus(
  stages: ReadonlyArray<ProviderDiscoveryStage>,
  totalResults: number
): ProviderDiscoveryAggregateStatus {
  if (stages.length === 0) return 'no-adapters';
  const hasResults = totalResults > 0;
  const hasFailure = stages.some((stage) =>
    (PROVIDER_DISCOVERY_FAILURE_STATUSES as ReadonlyArray<string>).includes(stage.status)
  );
  if (hasResults && !hasFailure) return 'success';
  if (hasResults && hasFailure) return 'partial';
  if (stages.every((stage) => stage.status === 'unsupported')) return 'unsupported';
  if (hasFailure) return 'failed';
  if (stages.some((stage) => stage.status === 'empty')) return 'empty';
  return 'unsupported';
}

/**
 * Runs one read-only discovery request against a deterministic collection of
 * adapters and returns the aggregate. Never throws: an adapter that throws, or
 * returns an unusable envelope, contributes an `unknown-failure` stage without
 * discarding other adapters' results.
 */
export function orchestrateDiscovery(
  query: TripDiscoveryQuery,
  adapters: ReadonlyArray<ProviderAdapter>,
  now: string
): ProviderDiscoveryAggregate {
  const stages: ProviderDiscoveryStage[] = [];
  const flattened: TripProviderResult[] = [];
  const capability = DISCOVERY_CATEGORY_CAPABILITY[query.category];

  for (const adapter of adapters) {
    const profile = adapter.profile;
    if (!isAdapterCapabilityAvailable(profile, capability)) {
      stages.push({
        providerId: profile.id,
        providerName: profile.name,
        status: 'unsupported',
        resultCount: 0,
        error: null,
      });
      continue;
    }

    let envelope: ProviderExecutionResult<TripProviderResult[]> | null;
    try {
      envelope = adapter.search(query, now);
    } catch {
      envelope = null;
    }

    if (envelope === null || envelope.operation !== 'search') {
      stages.push({
        providerId: profile.id,
        providerName: profile.name,
        status: 'unknown-failure',
        resultCount: 0,
        error: {
          category: 'unknown',
          message: 'The provider search returned an unexpected result.',
        },
      });
      continue;
    }

    if (envelope.status === 'success') {
      const data = Array.isArray(envelope.data) ? envelope.data : null;
      if (data === null) {
        stages.push({
          providerId: profile.id,
          providerName: profile.name,
          status: 'unknown-failure',
          resultCount: 0,
          error: {
            category: 'unknown',
            message: 'The provider search returned an unexpected result.',
          },
        });
        continue;
      }
      flattened.push(...data);
      stages.push({
        providerId: profile.id,
        providerName: profile.name,
        status: data.length === 0 ? 'empty' : 'success',
        resultCount: data.length,
        error: null,
      });
      continue;
    }

    stages.push({
      providerId: profile.id,
      providerName: profile.name,
      status: stageStatusForFailure(envelope),
      resultCount: 0,
      error: envelope.error ?? {
        category: 'unknown',
        message: 'The provider search could not be completed.',
      },
    });
  }

  const results = deduplicateProviderResults(flattened);
  return {
    status: getProviderDiscoveryAggregateStatus(stages, results.length),
    query,
    results,
    stages,
    totalResults: results.length,
  };
}

/** Maps a failed envelope's safe error category to a distinct stage status. */
function stageStatusForFailure(
  envelope: ProviderExecutionResult<TripProviderResult[]>
): ProviderDiscoveryStageStatus {
  const category = envelope.error?.category;
  switch (category) {
    case 'timeout':
      return 'timeout';
    case 'rate-limited':
      return 'rate-limited';
    case 'provider-unavailable':
      return 'provider-unavailable';
    case 'malformed-response':
      return 'malformed-response';
    case 'unknown':
      return 'unknown-failure';
    default:
      return 'provider-failure';
  }
}

/** Human-readable, read-only label for a per-provider discovery outcome. */
export function getProviderDiscoveryStageStatusLabel(status: ProviderDiscoveryStageStatus): string {
  switch (status) {
    case 'success':
      return 'Returned options';
    case 'empty':
      return 'No options returned';
    case 'unsupported':
      return 'Capability unsupported';
    case 'timeout':
      return 'Timed out';
    case 'rate-limited':
      return 'Rate limited';
    case 'provider-unavailable':
      return 'Provider unavailable';
    case 'malformed-response':
      return 'Malformed response';
    case 'provider-failure':
      return 'Search failed';
    case 'unknown-failure':
      return 'Unknown failure';
  }
}
