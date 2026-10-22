import { describe, expect, it } from 'vitest';
import type { TripDiscoveryQuery } from '../domain/providers/discoveryInput';
import type {
  ProviderCapabilityId,
  ProviderCapabilityStatus,
} from '../domain/providers/providerCapabilities';
import {
  isAdapterCapabilityAvailable,
  type ProviderAdapter,
  type ProviderAdapterProfile,
} from '../domain/providers/providerAdapter';
import {
  buildProviderExecutionFailure,
  buildProviderExecutionSuccess,
  type ProviderExecutionResult,
  type ProviderSafeErrorCategory,
} from '../domain/providers/executionOperations';
import {
  normalizeTripProviderResult,
  type TripProviderResult,
} from '../domain/providers/providerResults';
import {
  PROVIDER_RESULT_IDENTITY_SEPARATOR,
  deduplicateProviderResults,
  getProviderDiscoveryAggregateStatus,
  getProviderDiscoveryStageStatusLabel,
  getProviderResultIdentity,
  orchestrateDiscovery,
  type ProviderDiscoveryAggregateStatus,
  type ProviderDiscoveryStage,
  type ProviderDiscoveryStageStatus,
} from '../domain/providers/discoveryOrchestration';

const NOW = '2026-09-13T08:00:00.000Z';
const QUERY: TripDiscoveryQuery = { category: 'transport', destination: 'Tokyo' };

interface TestSource {
  id: string;
  name: string;
}

function makeResult(
  source: TestSource,
  resultId: string,
  overrides: Partial<TripProviderResult> = {}
): TripProviderResult {
  return {
    providerId: source.id,
    providerName: source.name,
    resultId,
    category: 'transport',
    title: `${source.name} ${resultId}`,
    destination: QUERY.destination,
    retrievedAt: NOW,
    availability: 'available',
    ...overrides,
  };
}

function makeSuccessEnvelope(
  source: TestSource,
  results: TripProviderResult[]
): ProviderExecutionResult<TripProviderResult[]> | null {
  return buildProviderExecutionSuccess('search', source, results, NOW);
}

function makeFailureEnvelope(
  source: TestSource,
  category: ProviderSafeErrorCategory
): ProviderExecutionResult<TripProviderResult[]> | null {
  return buildProviderExecutionFailure(
    'search',
    source,
    category,
    `The simulated provider search could not be completed (${category}).`,
    NOW
  );
}

function makeAdapter(
  source: TestSource,
  search: (
    query: TripDiscoveryQuery,
    now: string
  ) => ProviderExecutionResult<TripProviderResult[]> | null,
  capability: ProviderCapabilityId = 'search-transport',
  capabilityStatus: ProviderCapabilityStatus = 'available'
): ProviderAdapter {
  const profile: ProviderAdapterProfile = {
    id: source.id,
    name: source.name,
    capabilities: [{ capability, status: capabilityStatus }],
  };
  return {
    profile,
    isOperational: (id: ProviderCapabilityId) => isAdapterCapabilityAvailable(profile, id),
    id: () => profile.id,
    name: () => profile.name,
    search,
  };
}

const SOURCE_A: TestSource = { id: 'mock-provider-a', name: 'Mock Provider A' };
const SOURCE_B: TestSource = { id: 'mock-provider-b', name: 'Mock Provider B' };
const SOURCE_TIMEOUT: TestSource = { id: 'mock-provider-timeout', name: 'Mock Timeout Provider' };
const SOURCE_RATE_LIMITED: TestSource = {
  id: 'mock-provider-limited',
  name: 'Mock Rate-Limited Provider',
};
const SOURCE_UNAVAILABLE: TestSource = { id: 'mock-provider-down', name: 'Mock Down Provider' };
const SOURCE_MALFORMED: TestSource = {
  id: 'mock-provider-broken',
  name: 'Mock Malformed Provider',
};
const SOURCE_UNKNOWN: TestSource = { id: 'mock-provider-mystery', name: 'Mock Mystery Provider' };
const SOURCE_EMPTY = { id: 'mock-provider-empty', name: 'Mock Empty Provider' };

const providerA = makeAdapter(SOURCE_A, () =>
  makeSuccessEnvelope(SOURCE_A, [
    makeResult(SOURCE_A, 'mock-a-1', {
      metadata: [{ key: 'vehicle-class', value: 'sample high-speed rail' }],
    }),
    makeResult(SOURCE_A, 'mock-a-2'),
  ])
);

const providerB = makeAdapter(SOURCE_B, () =>
  makeSuccessEnvelope(SOURCE_B, [
    makeResult(SOURCE_B, 'mock-b-1', {
      metadata: [{ key: 'property-type', value: 'sample hotel' }],
    }),
    makeResult(SOURCE_B, 'mock-b-2'),
  ])
);

const timeoutProvider = makeAdapter(SOURCE_TIMEOUT, () =>
  makeFailureEnvelope(SOURCE_TIMEOUT, 'timeout')
);
const rateLimitedProvider = makeAdapter(SOURCE_RATE_LIMITED, () =>
  makeFailureEnvelope(SOURCE_RATE_LIMITED, 'rate-limited')
);
const unavailableProvider = makeAdapter(SOURCE_UNAVAILABLE, () =>
  makeFailureEnvelope(SOURCE_UNAVAILABLE, 'provider-unavailable')
);
const malformedProvider = makeAdapter(SOURCE_MALFORMED, () =>
  makeFailureEnvelope(SOURCE_MALFORMED, 'malformed-response')
);
const unknownProvider = makeAdapter(SOURCE_UNKNOWN, () =>
  makeFailureEnvelope(SOURCE_UNKNOWN, 'unknown')
);
const emptyProvider = makeAdapter(SOURCE_EMPTY, () => makeSuccessEnvelope(SOURCE_EMPTY, []));

const partialFailureCases: Array<{
  label: string;
  adapter: ProviderAdapter;
  stageStatus: ProviderDiscoveryStageStatus;
  category: ProviderSafeErrorCategory;
}> = [
  { label: 'timed out', adapter: timeoutProvider, stageStatus: 'timeout', category: 'timeout' },
  {
    label: 'is rate-limited',
    adapter: rateLimitedProvider,
    stageStatus: 'rate-limited',
    category: 'rate-limited',
  },
  {
    label: 'is unavailable',
    adapter: unavailableProvider,
    stageStatus: 'provider-unavailable',
    category: 'provider-unavailable',
  },
  {
    label: 'returns a malformed response',
    adapter: malformedProvider,
    stageStatus: 'malformed-response',
    category: 'malformed-response',
  },
  {
    label: 'fails for an unknown reason',
    adapter: unknownProvider,
    stageStatus: 'unknown-failure',
    category: 'unknown',
  },
];

describe('orchestrateDiscovery single/multi adapter success', () => {
  it('runs one adapter and returns its results with a success stage', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA], NOW);
    expect(aggregate.status).toBe('success');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
    expect(aggregate.totalResults).toBe(2);
    expect(aggregate.query).toEqual(QUERY);
    expect(aggregate.stages).toEqual([
      {
        providerId: SOURCE_A.id,
        providerName: SOURCE_A.name,
        status: 'success',
        resultCount: 2,
        error: null,
      },
    ]);
  });

  it('merges multiple adapters in adapter order with one stage each', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    expect(aggregate.status).toBe('success');
    expect(aggregate.totalResults).toBe(4);
    expect(aggregate.results.map((r) => r.resultId)).toEqual([
      'mock-a-1',
      'mock-a-2',
      'mock-b-1',
      'mock-b-2',
    ]);
    expect(aggregate.stages.map((s) => s.providerId)).toEqual([SOURCE_A.id, SOURCE_B.id]);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['success', 'success']);
  });

  it('handles a reversed adapter order deterministically', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerB, providerA], NOW);
    expect(aggregate.results.map((r) => r.resultId)).toEqual([
      'mock-b-1',
      'mock-b-2',
      'mock-a-1',
      'mock-a-2',
    ]);
    expect(aggregate.stages.map((s) => s.providerId)).toEqual([SOURCE_B.id, SOURCE_A.id]);
  });
});

describe('orchestrateDiscovery empty providers', () => {
  it('reports an empty aggregate when every provider returns zero results', () => {
    const aggregate = orchestrateDiscovery(QUERY, [emptyProvider, emptyProvider], NOW);
    expect(aggregate.status).toBe('empty');
    expect(aggregate.results).toEqual([]);
    expect(aggregate.totalResults).toBe(0);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['empty', 'empty']);
    expect(aggregate.stages.every((s) => s.error === null)).toBe(true);
  });

  it('keeps a zero-result provider honest as empty when another provider succeeds', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, emptyProvider], NOW);
    expect(aggregate.status).toBe('success');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['success', 'empty']);
    expect(aggregate.stages.some((s) => s.status !== 'success' && s.status !== 'empty')).toBe(
      false
    );
  });

  it('reports an empty aggregate as success-with-zero only when nothing failed', () => {
    const aggregate = orchestrateDiscovery(
      QUERY,
      [
        emptyProvider,
        makeAdapter({ id: 'mock-provider-empty-2', name: 'Mock Empty Provider 2' }, () =>
          makeSuccessEnvelope({ id: 'mock-provider-empty-2', name: 'Mock Empty Provider 2' }, [])
        ),
      ],
      NOW
    );
    expect(aggregate.status).toBe('empty');
    expect(aggregate.results).toEqual([]);
  });
});

describe('orchestrateDiscovery failure isolation and partial success', () => {
  for (const { label, adapter, stageStatus, category } of partialFailureCases) {
    it(`keeps valid provider A results when provider B ${label}`, () => {
      const aggregate = orchestrateDiscovery(QUERY, [providerA, adapter], NOW);
      expect(aggregate.status).toBe('partial');
      expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
      expect(aggregate.totalResults).toBe(2);
      expect(aggregate.stages.map((s) => s.status)).toEqual(['success', stageStatus]);
      const failedStage = aggregate.stages[1];
      expect(failedStage.resultCount).toBe(0);
      expect(failedStage.error).toEqual(expect.objectContaining({ category }));
    });

    it(`keeps valid provider B results when provider A ${label}`, () => {
      const aggregate = orchestrateDiscovery(QUERY, [adapter, providerB], NOW);
      expect(aggregate.status).toBe('partial');
      expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-b-1', 'mock-b-2']);
      expect(aggregate.stages.map((s) => s.status)).toEqual([stageStatus, 'success']);
    });
  }

  it('keeps a succeeding provider when another provider is empty (empty is not a failure)', () => {
    const aggregate = orchestrateDiscovery(QUERY, [emptyProvider, providerB], NOW);
    expect(aggregate.status).toBe('success');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-b-1', 'mock-b-2']);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['empty', 'success']);
  });

  it('reports a failed aggregate when every provider fails the same way', () => {
    const aggregate = orchestrateDiscovery(QUERY, [timeoutProvider, timeoutProvider], NOW);
    expect(aggregate.status).toBe('failed');
    expect(aggregate.results).toEqual([]);
    expect(aggregate.totalResults).toBe(0);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['timeout', 'timeout']);
    expect(aggregate.stages.every((s) => s.error !== null)).toBe(true);
  });

  it('reports a failed aggregate when all providers fail in mixed ways', () => {
    const aggregate = orchestrateDiscovery(QUERY, [timeoutProvider, malformedProvider], NOW);
    expect(aggregate.status).toBe('failed');
    expect(aggregate.results).toEqual([]);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['timeout', 'malformed-response']);
  });

  it('a timeout is never turned into "no results found" while another provider has results', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, timeoutProvider], NOW);
    expect(aggregate.status).toBe('partial');
    expect(aggregate.results).toHaveLength(2);
    expect(aggregate.stages[1].status).toBe('timeout');
  });

  it('all-providers-failed is never reported as success with zero results', () => {
    const aggregate = orchestrateDiscovery(QUERY, [rateLimitedProvider, unavailableProvider], NOW);
    expect(aggregate.status).toBe('failed');
    expect(aggregate.stages.map((s) => s.status)).toEqual(['rate-limited', 'provider-unavailable']);
  });

  it('returns no-adapters with no results and no stages when no adapters are supplied', () => {
    const aggregate = orchestrateDiscovery(QUERY, [], NOW);
    expect(aggregate.status).toBe('no-adapters');
    expect(aggregate.results).toEqual([]);
    expect(aggregate.stages).toEqual([]);
    expect(aggregate.totalResults).toBe(0);
  });
});

describe('orchestrateDiscovery hostile envelopes', () => {
  it('treats a null envelope as an unknown-failure stage without discarding other results', () => {
    const nullProvider = makeAdapter(
      { id: 'mock-provider-null', name: 'Mock Null Provider' },
      () => null
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, nullProvider], NOW);
    expect(aggregate.status).toBe('partial');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
    expect(aggregate.stages[1].status).toBe('unknown-failure');
    expect(aggregate.stages[1].error).toEqual(expect.objectContaining({ category: 'unknown' }));
  });

  it('treats a non-search operation envelope as an unknown-failure stage', () => {
    const wrongOperationProvider = makeAdapter(
      { id: 'mock-provider-wrong-op', name: 'Mock Wrong Operation Provider' },
      () => buildProviderExecutionSuccess('verify', { id: 'mock-x', name: 'Mock X' }, [], NOW)
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, wrongOperationProvider], NOW);
    expect(aggregate.status).toBe('partial');
    expect(aggregate.stages[1].status).toBe('unknown-failure');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
  });

  it('treats a throwing adapter as an unknown-failure stage and keeps sibling results', () => {
    const throwingProvider = makeAdapter(
      { id: 'mock-provider-throws', name: 'Mock Throwing Provider' },
      () => {
        throw new Error('boom');
      }
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, throwingProvider], NOW);
    expect(aggregate.status).toBe('partial');
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['mock-a-1', 'mock-a-2']);
    expect(aggregate.stages[1].status).toBe('unknown-failure');
  });

  it('treats a success envelope whose data is not an array as unknown-failure', () => {
    const badDataProvider = makeAdapter(
      { id: 'mock-provider-bad-data', name: 'Mock Bad Data Provider' },
      (query, now) => ({
        operation: 'search' as const,
        status: 'success' as const,
        providerId: 'mock-provider-bad-data',
        providerName: 'Mock Bad Data Provider',
        performedAt: now,
        retryability: 'retryable' as const,
        data: { not: 'an array' } as unknown as TripProviderResult[],
      })
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, badDataProvider], NOW);
    expect(aggregate.status).toBe('partial');
    expect(aggregate.stages[1].status).toBe('unknown-failure');
    expect(aggregate.stages[1].error).toEqual(expect.objectContaining({ category: 'unknown' }));
  });
});

describe('orchestrateDiscovery capability gating', () => {
  it('does not invoke search for an adapter whose required category capability is not operational', () => {
    let called = false;
    const unsupportedProvider = makeAdapter(
      { id: 'mock-provider-unsupported', name: 'Mock Unsupported Provider' },
      () => {
        called = true;
        return makeSuccessEnvelope(SOURCE_A, []);
      },
      'search-transport',
      'temporarily-unavailable'
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, unsupportedProvider], NOW);
    expect(called).toBe(false);
    expect(aggregate.stages[1].status).toBe('unsupported');
    expect(aggregate.stages[1].error).toBeNull();
    expect(aggregate.status).toBe('partial');
  });

  it('reports unsupported when every adapter lacks the queried category capability', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA], NOW);
    expect(aggregate.status).toBe('success');
    const accommodation = orchestrateDiscovery(
      { category: 'accommodation', destination: 'Osaka' },
      [providerA, providerB],
      NOW
    );
    expect(accommodation.status).toBe('unsupported');
    expect(accommodation.results).toEqual([]);
    expect(accommodation.stages.map((s) => s.status)).toEqual(['unsupported', 'unsupported']);
  });
});

describe('orchestrateDiscovery deterministic ordering', () => {
  it('reports stages in adapter order even when a middle adapter fails', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, timeoutProvider, providerB], NOW);
    expect(aggregate.stages.map((s) => s.providerId)).toEqual([
      SOURCE_A.id,
      SOURCE_TIMEOUT.id,
      SOURCE_B.id,
    ]);
    expect(aggregate.stages.map((s) => s.status)).toEqual(['success', 'timeout', 'success']);
    expect(aggregate.results.map((r) => r.resultId)).toEqual([
      'mock-a-1',
      'mock-a-2',
      'mock-b-1',
      'mock-b-2',
    ]);
    expect(aggregate.status).toBe('partial');
  });

  it('preserves each adapter own result order within the aggregate', () => {
    const outOfOrderSource = { id: 'mock-provider-sorted', name: 'Mock Sorted Provider' };
    const outOfOrderProvider = makeAdapter(outOfOrderSource, () =>
      makeSuccessEnvelope(outOfOrderSource, [
        makeResult(outOfOrderSource, 'sort-1'),
        makeResult(outOfOrderSource, 'sort-2'),
        makeResult(outOfOrderSource, 'sort-3'),
      ])
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, outOfOrderProvider], NOW);
    expect(aggregate.results.map((r) => r.resultId)).toEqual([
      'mock-a-1',
      'mock-a-2',
      'sort-1',
      'sort-2',
      'sort-3',
    ]);
  });

  it('produces identical output for identical input across calls (no hidden state)', () => {
    const first = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    const second = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    expect(first).toEqual(second);
  });
});

describe('orchestrateDiscovery deterministic duplicate handling', () => {
  it('deduplicates repeated results from the same provider by providerId + resultId (first wins)', () => {
    const duplicatedSource = { id: 'mock-provider-dup', name: 'Mock Duplicate Provider' };
    const duplicateProvider = makeAdapter(duplicatedSource, () =>
      makeSuccessEnvelope(duplicatedSource, [
        makeResult(duplicatedSource, 'dup-1'),
        makeResult(duplicatedSource, 'dup-2'),
        makeResult(duplicatedSource, 'dup-1'),
      ])
    );
    const aggregate = orchestrateDiscovery(QUERY, [duplicateProvider], NOW);
    expect(aggregate.status).toBe('success');
    expect(aggregate.totalResults).toBe(2);
    expect(aggregate.results.map((r) => r.resultId)).toEqual(['dup-1', 'dup-2']);
    expect(aggregate.stages[0].resultCount).toBe(3);
  });

  it('keeps identical-looking results from different providers (identity includes provider)', () => {
    const otherSource = { id: 'mock-provider-other', name: 'Mock Other Provider' };
    const otherProvider = makeAdapter(otherSource, () =>
      makeSuccessEnvelope(otherSource, [
        makeResult(otherSource, 'same-id', { title: 'Identical-looking title' }),
      ])
    );
    const aggregate = orchestrateDiscovery(QUERY, [providerA, otherProvider], NOW);
    expect(aggregate.totalResults).toBe(3);
    const ids = aggregate.results.map((r) => `${r.providerId}::${r.resultId}`);
    expect(ids).toEqual([
      `${SOURCE_A.id}::mock-a-1`,
      `${SOURCE_A.id}::mock-a-2`,
      `${otherSource.id}::same-id`,
    ]);
  });

  it('never merges records by title or summary similarity', () => {
    const a = makeResult(SOURCE_A, 'similar-1', {
      title: 'Coastal Coach',
      summary: 'Direct coach to the coast',
    });
    const b = makeResult(SOURCE_B, 'similar-2', {
      title: 'Coastal Coach',
      summary: 'Direct coach to the coast',
    });
    const deduped = deduplicateProviderResults([a, b]);
    expect(deduped).toHaveLength(2);
  });

  it('builds a deterministic identity as providerId :: resultId', () => {
    expect(PROVIDER_RESULT_IDENTITY_SEPARATOR).toBe('::');
    expect(getProviderResultIdentity(makeResult(SOURCE_A, 'mock-a-1'))).toBe(
      `${SOURCE_A.id}${PROVIDER_RESULT_IDENTITY_SEPARATOR}mock-a-1`
    );
  });
});

describe('orchestrateDiscovery provider attribution', () => {
  it('keeps provider identity and provider result identity on every aggregated result', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    for (const result of aggregate.results) {
      expect(typeof result.providerId).toBe('string');
      expect(typeof result.providerName).toBe('string');
      expect(typeof result.resultId).toBe('string');
    }
    expect(aggregate.results.map((r) => r.providerName)).toEqual([
      SOURCE_A.name,
      SOURCE_A.name,
      SOURCE_B.name,
      SOURCE_B.name,
    ]);
  });

  it('keeps provider-specific metadata isolated to the results that carried it', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    const aResults = aggregate.results.filter((r) => r.providerId === SOURCE_A.id);
    const bResults = aggregate.results.filter((r) => r.providerId === SOURCE_B.id);
    expect(aResults[0].metadata).toEqual([
      { key: 'vehicle-class', value: 'sample high-speed rail' },
    ]);
    expect(bResults[0].metadata).toEqual([{ key: 'property-type', value: 'sample hotel' }]);
  });

  it('exposes only normalized provider-neutral results — no envelopes or raw payload fields', () => {
    const aggregate = orchestrateDiscovery(QUERY, [providerA, providerB], NOW);
    for (const result of aggregate.results) {
      expect(normalizeTripProviderResult(result)).not.toBeNull();
      const keys = Object.keys(result);
      expect(keys).not.toContain('operation');
      expect(keys).not.toContain('status');
      expect(keys).not.toContain('performedAt');
      expect(keys).not.toContain('data');
      expect(keys).not.toContain('rawPayload');
      expect(keys).not.toContain('providerResponse');
    }
  });
});

describe('orchestrateDiscovery aggregate status helpers', () => {
  const stage = (
    providerId: string,
    status: ProviderDiscoveryStageStatus,
    resultCount: number
  ): ProviderDiscoveryStage => ({
    providerId,
    providerName: 'Mock Provider',
    status,
    resultCount,
    error: null,
  });

  it('computes every aggregate status deterministically', () => {
    const cases: Array<{
      stages: ProviderDiscoveryStage[];
      total: number;
      expected: ProviderDiscoveryAggregateStatus;
    }> = [
      { stages: [], total: 0, expected: 'no-adapters' },
      { stages: [stage('a', 'success', 2)], total: 2, expected: 'success' },
      {
        stages: [stage('a', 'success', 2), stage('b', 'timeout', 0)],
        total: 2,
        expected: 'partial',
      },
      { stages: [stage('a', 'empty', 0), stage('b', 'empty', 0)], total: 0, expected: 'empty' },
      { stages: [stage('a', 'timeout', 0)], total: 0, expected: 'failed' },
      {
        stages: [stage('a', 'unsupported', 0), stage('b', 'empty', 0)],
        total: 0,
        expected: 'failed',
      },
      {
        stages: [stage('a', 'unsupported', 0), stage('b', 'unsupported', 0)],
        total: 0,
        expected: 'unsupported',
      },
    ];
    for (const { stages, total, expected } of cases) {
      expect(getProviderDiscoveryAggregateStatus(stages, total)).toBe(expected);
    }
  });

  it('produces a distinct non-empty label for every per-provider status', () => {
    const statuses: ProviderDiscoveryStageStatus[] = [
      'success',
      'empty',
      'unsupported',
      'timeout',
      'rate-limited',
      'provider-unavailable',
      'malformed-response',
      'provider-failure',
      'unknown-failure',
    ];
    const labels = statuses.map(getProviderDiscoveryStageStatusLabel);
    expect(labels.every((label) => typeof label === 'string' && label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(statuses.length);
  });
});
