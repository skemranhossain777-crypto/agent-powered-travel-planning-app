import { describe, expect, it } from 'vitest';
import type { TripProviderResult } from '../domain/providers/providerResults';
import {
  DISCOVERY_HANDOFF_LIFECYCLE_STATE,
  DISCOVERY_HANDOFF_PLAN_ID_PREFIX,
  DISCOVERY_HANDOFF_PROVENANCE_LABELS,
  DISCOVERY_HANDOFF_PROVENANCE_NOTE,
  DISCOVERY_HANDOFF_READINESS_NOTE,
  getDiscoveryHandoffPlanId,
  getDiscoveryHandoffProblem,
  mapDiscoveryResultToHandoffPlan,
} from '../domain/discovery/handoff';
import {
  isPlanEligibleAsPrimary,
  resolvePrimarySelection,
} from '../domain/trips/planningReferenceSelection';
import { classifyPrimaryResolutionDecision } from '../domain/trips/planningReferenceResolution';
import { orchestrateDiscovery } from '../domain/providers/discoveryOrchestration';
import { mockTransportProviderAdapter } from '../services/mockDiscovery/mockTransportProvider';
import { mockAlternativeTransportProviderAdapter } from '../services/mockDiscovery/mockAlternativeTransportProvider';
import {
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
  MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME,
  MOCK_RESULT_DISCLAIMER,
} from '../services/mockDiscovery/mockFixtures';

function makeResult(overrides: Partial<TripProviderResult> = {}): TripProviderResult {
  return {
    providerId: 'mock-transport-provider',
    providerName: 'Mock Transport Provider',
    resultId: 'mock-transport-1',
    category: 'transport',
    title: 'Mock Express Rail',
    summary: 'Direct high-speed rail option',
    origin: 'LHR',
    destination: 'Tokyo',
    departureAt: '2026-09-13T10:00:00.000Z',
    arrivalAt: '2026-09-13T14:45:00.000Z',
    durationMinutes: 285,
    price: { amount: 149, currency: 'USD' },
    cancellationPolicy: 'Mock policy: fully refundable until 24 hours before departure.',
    sourceUrl: 'https://mock.example/transport/result-1',
    retrievedAt: '2026-09-13T08:00:00.000Z',
    expiresAt: '2026-09-14T08:00:00.000Z',
    availability: 'available',
    limitations: [
      'Simulated sample data — not live availability or a booking.',
      'Sample timetable.',
    ],
    ...overrides,
  };
}

/** A `now` timestamp before every fixture's expiry so results are current. */
const NOW = '2026-09-13T12:00:00.000Z';

describe('STEP 22 discovery handoff plan id', () => {
  it('prefixes a result id deterministically', () => {
    expect(getDiscoveryHandoffPlanId('mock-transport-1')).toBe('handoff-mock-transport-1');
    expect(getDiscoveryHandoffPlanId('abc')).toBe('handoff-abc');
    expect(getDiscoveryHandoffPlanId('mock-transport-1')).toMatch(
      new RegExp(`^${DISCOVERY_HANDOFF_PLAN_ID_PREFIX}`)
    );
  });
});

describe('STEP 22 discovery handoff problem guard', () => {
  it('allows a current transport or accommodation result', () => {
    expect(getDiscoveryHandoffProblem(makeResult(), NOW)).toBeNull();
    expect(getDiscoveryHandoffProblem(makeResult({ category: 'accommodation' }), NOW)).toBeNull();
  });

  it('allows a current result that carries no freshness bound', () => {
    expect(getDiscoveryHandoffProblem(makeResult({ expiresAt: undefined }), NOW)).toBeNull();
  });

  it('blocks results that are not transport or accommodation', () => {
    const problem = getDiscoveryHandoffProblem(makeResult({ category: 'activity' }), NOW);
    expect(problem).not.toBeNull();
    expect(problem).toContain('Only transport and accommodation results');
  });

  it('blocks results that are already expired at now', () => {
    const expired = makeResult({ expiresAt: '2026-09-13T08:00:00.000Z' });
    expect(getDiscoveryHandoffProblem(expired, '2026-09-13T12:00:00.000Z')).not.toBeNull();
    expect(getDiscoveryHandoffProblem(expired, '2026-09-13T12:00:00.000Z')).toContain('expired');
  });
});

describe('STEP 22 transport handoff mapping', () => {
  it('maps only supported fields into a draft transport plan', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;

    expect(mapped.kind).toBe('transport');
    expect(mapped.plan).toMatchObject({
      id: 'handoff-mock-transport-1',
      provider: 'Mock Transport Provider',
      departureLocation: 'LHR',
      arrivalLocation: 'Tokyo',
      departureTime: '2026-09-13T10:00:00.000Z',
      arrivalTime: '2026-09-13T14:45:00.000Z',
      referenceNumber: 'mock-transport-1',
      sourceUrl: 'https://mock.example/transport/result-1',
      readiness: { state: 'planned', note: DISCOVERY_HANDOFF_READINESS_NOTE },
      provenance: { kind: 'mock-discovery', note: DISCOVERY_HANDOFF_PROVENANCE_NOTE },
    });
    expect(mapped.plan).not.toHaveProperty('mode');
  });

  it('documents provenance, price, duration, cancellation, and limitations in notes', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    if (mapped === null) return;

    expect(mapped.kind).toBe('transport');
    const notes = mapped.plan.notes ?? '';
    for (const label of DISCOVERY_HANDOFF_PROVENANCE_LABELS) {
      expect(notes).toContain(label);
    }
    expect(notes).toContain('Provider: Mock Transport Provider');
    expect(notes).toContain('Result id: mock-transport-1');
    expect(notes).toContain('Retrieved at: 2026-09-13T08:00:00.000Z');
    expect(notes).toContain('Sample price: 149.00 USD');
    expect(notes).toContain('Duration (minutes): 285');
    expect(notes).toContain(
      'Cancellation policy: Mock policy: fully refundable until 24 hours before departure.'
    );
    expect(notes).toContain(
      'Limitation: Simulated sample data — not live availability or a booking.'
    );
    expect(notes).toContain('Limitation: Sample timetable.');
  });

  it('omits provenance lines for fields the provider did not return', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({
        origin: undefined,
        destination: undefined,
        departureAt: undefined,
        arrivalAt: undefined,
        price: undefined,
        durationMinutes: undefined,
        cancellationPolicy: undefined,
        sourceUrl: undefined,
      }),
      NOW,
      'handoff-mock-transport-1'
    );
    if (mapped === null) return;

    expect(mapped.kind).toBe('transport');
    if (mapped.kind !== 'transport') return;
    const plan = mapped.plan;
    expect(plan.provider).toBe('Mock Transport Provider');
    expect(plan).not.toHaveProperty('departureLocation');
    expect(plan).not.toHaveProperty('arrivalLocation');
    expect(plan).not.toHaveProperty('departureTime');
    expect(plan).not.toHaveProperty('arrivalTime');
    expect(plan).not.toHaveProperty('sourceUrl');
    const notes = plan.notes ?? '';
    expect(notes).not.toContain('Sample price:');
    expect(notes).not.toContain('Duration (minutes):');
    expect(notes).not.toContain('Cancellation policy:');
    expect(notes).toContain('Retrieved at: 2026-09-13T08:00:00.000Z');
  });
});

describe('STEP 22 accommodation handoff mapping', () => {
  it('maps only supported fields into a draft accommodation plan', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({
        category: 'accommodation',
        providerId: 'mock-accommodation-provider',
        providerName: 'Mock Accommodation Provider',
        resultId: 'mock-accommodation-1',
        title: 'Tokyo Grand Hotel',
        destination: 'Tokyo',
        summary: 'Downtown 4-star option near Shinjuku station.',
        departureAt: undefined,
        arrivalAt: undefined,
        durationMinutes: undefined,
      }),
      NOW,
      'handoff-mock-accommodation-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped === null) return;

    expect(mapped.kind).toBe('accommodation');
    expect(mapped.plan).toMatchObject({
      id: 'handoff-mock-accommodation-1',
      name: 'Tokyo Grand Hotel',
      location: 'Tokyo',
      roomDetails: 'Downtown 4-star option near Shinjuku station.',
      referenceNumber: 'mock-accommodation-1',
      sourceUrl: 'https://mock.example/transport/result-1',
      readiness: { state: 'planned', note: DISCOVERY_HANDOFF_READINESS_NOTE },
      provenance: { kind: 'mock-discovery', note: DISCOVERY_HANDOFF_PROVENANCE_NOTE },
    });
    expect(mapped.plan).not.toHaveProperty('checkInDate');
    expect(mapped.plan).not.toHaveProperty('checkOutDate');
  });
});

describe('STEP 23 discovery handoff provenance carrying', () => {
  it('stamps the same source note on both the readiness label and the provenance record', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    if (mapped === null) return;
    if (mapped.kind !== 'transport') return;

    expect(DISCOVERY_HANDOFF_PROVENANCE_NOTE).toBe(DISCOVERY_HANDOFF_READINESS_NOTE);
    expect(mapped.plan.provenance).toEqual({
      kind: 'mock-discovery',
      note: DISCOVERY_HANDOFF_PROVENANCE_NOTE,
    });
    expect(mapped.plan.readiness?.note).toBe(DISCOVERY_HANDOFF_PROVENANCE_NOTE);
  });

  it('every imported plan keeps its simulated provenance through normalization', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'accommodation', sourceUrl: undefined }),
      NOW,
      'handoff-mock-accommodation-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(mapped.kind).toBe('accommodation');
    expect(mapped.plan.provenance?.kind).toBe('mock-discovery');
    expect(mapped.plan.provenance?.note).toBe(DISCOVERY_HANDOFF_PROVENANCE_NOTE);
  });
});

describe('STEP 24 discovery handoff lifecycle default', () => {
  it('stamps the documented active default on every imported plan (both categories)', () => {
    expect(DISCOVERY_HANDOFF_LIFECYCLE_STATE).toBe('active');
    const transport = mapDiscoveryResultToHandoffPlan(
      makeResult(),
      NOW,
      'handoff-mock-transport-1'
    );
    expect(transport).not.toBeNull();
    if (transport === null) return;
    expect(transport.plan.lifecycleState).toBe('active');
    if (transport.kind !== 'transport') return;
    expect(transport.plan.provenance?.kind).toBe('mock-discovery');

    const accommodation = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'accommodation' }),
      NOW,
      'handoff-mock-accommodation-1'
    );
    expect(accommodation).not.toBeNull();
    if (accommodation === null) return;
    expect(accommodation.plan.lifecycleState).toBe('active');
    expect(accommodation.plan.provenance?.kind).toBe('mock-discovery');
  });

  it('keeps lifecycle, provenance, and readiness separable and never claims staleness', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(mapped.plan.lifecycleState).toBe('active');
    expect(mapped.plan.provenance?.kind).toBe('mock-discovery');
    expect(mapped.plan.readiness?.state).toBe('planned');
    const notes = mapped.plan.notes ?? '';
    expect(notes.toLowerCase()).not.toMatch(/expired|outdated|stale/);
    expect(notes).toContain('Not a booking or reservation');
  });

  it('handoff never auto-transitions a lifecycle or invents a verification state', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    const plan = mapped.plan;
    expect(plan.lifecycleState).toBe('active');
    expect(plan).not.toHaveProperty('verifiedAt');
    expect(plan).not.toHaveProperty('checkedAt');
    expect(plan).not.toHaveProperty('bookingState');
  });
});

describe('STEP 22 handoff mapping allowed/refused cases', () => {
  it('returns null when the result is expired at now', () => {
    const expired = makeResult({ expiresAt: '2026-09-12T08:00:00.000Z' });
    expect(
      mapDiscoveryResultToHandoffPlan(expired, '2026-09-13T12:00:00.000Z', 'handoff-x')
    ).toBeNull();
  });

  it('returns null for non transport/accommodation results', () => {
    expect(
      mapDiscoveryResultToHandoffPlan(makeResult({ category: 'other' }), NOW, 'handoff-x')
    ).toBeNull();
    expect(
      mapDiscoveryResultToHandoffPlan(makeResult({ category: 'activity' }), NOW, 'handoff-x')
    ).toBeNull();
  });

  it('never invents an unsafe source URL through the mapping', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ sourceUrl: 'javascript:alert(1)' }),
      NOW,
      'handoff-x'
    );
    expect(mapped).toBeNull();
  });

  it('handoff never assigns primary selection fields (STEP 26)', () => {
    const transport = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-mt-1'
    );
    expect(transport).not.toBeNull();
    if (transport !== null) {
      expect(transport.plan).not.toHaveProperty('primaryTransportPlanId');
      expect(transport.plan).not.toHaveProperty('primaryAccommodationPlanId');
    }

    const accommodation = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'accommodation' }),
      NOW,
      'handoff-ma-1'
    );
    expect(accommodation).not.toBeNull();
    if (accommodation !== null) {
      expect(accommodation.plan).not.toHaveProperty('primaryTransportPlanId');
      expect(accommodation.plan).not.toHaveProperty('primaryAccommodationPlanId');
    }
  });

  it('handoff plan type has no primary selection fields in its type shape (STEP 26)', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-mt-2'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      const keys = Object.keys(mapped.plan);
      expect(keys).not.toContain('primaryTransportPlanId');
      expect(keys).not.toContain('primaryAccommodationPlanId');
    }
  });
});

describe('STEP 27 discovery handoff primary-reference integrity', () => {
  it('a handoff plan is a primary candidate (active by default) but is never auto-selected', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t27-transport-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      expect(mapped.plan.lifecycleState).toBe(DISCOVERY_HANDOFF_LIFECYCLE_STATE);
      expect(isPlanEligibleAsPrimary(mapped.plan)).toBe(true);
      expect('primaryTransportPlanId' in mapped.plan).toBe(false);
      expect('primaryAccommodationPlanId' in mapped.plan).toBe(false);
    }

    const accommodation = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'accommodation' }),
      NOW,
      'handoff-t27-accommodation-1'
    );
    expect(accommodation).not.toBeNull();
    if (accommodation !== null) {
      expect(accommodation.plan.lifecycleState).toBe(DISCOVERY_HANDOFF_LIFECYCLE_STATE);
      expect(isPlanEligibleAsPrimary(accommodation.plan)).toBe(true);
    }
  });

  it('handoff output can never change an existing selection: no selection write exists', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t27-transport-2'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      expect(JSON.stringify(mapped.plan)).not.toContain('primaryTransportPlanId');
      expect(JSON.stringify(mapped.plan)).not.toContain('primaryAccommodationPlanId');
    }
  });

  it('a handoff plan selected as primary is only ever a user act — selecting it resolves valid (STEP 26)', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t27-transport-3'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      const resolution = resolvePrimarySelection('handoff-t27-transport-3', [mapped.plan]);
      expect(resolution.state).toBe('valid-explicit-selection');
    }
  });
});

describe('STEP 39 provider metadata handoff', () => {
  it('documents provider metadata pairs in notes and never copies them into plan fields', () => {
    const withMetadata = makeResult({
      metadata: [
        { key: 'vehicle-class', value: 'sample high-speed rail' },
        { key: 'operator', value: 'sample carrier' },
      ],
    });
    const mapped = mapDiscoveryResultToHandoffPlan(withMetadata, NOW, 'handoff-mock-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    const notes = mapped.plan.notes ?? '';
    expect(notes).toContain('Provider metadata: vehicle-class — sample high-speed rail');
    expect(notes).toContain('Provider metadata: operator — sample carrier');
    expect(Object.keys(mapped.plan)).not.toContain('metadata');
  });

  it('documents accommodation metadata in notes the same way', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({
        category: 'accommodation',
        metadata: [{ key: 'property-type', value: 'sample hotel' }],
      }),
      NOW,
      'handoff-mock-accommodation-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(mapped.plan.notes ?? '').toContain('Provider metadata: property-type — sample hotel');
    expect(mapped.plan).not.toHaveProperty('metadata');
  });

  it('omits metadata lines when a result carries none', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(makeResult(), NOW, 'handoff-mock-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(mapped.plan.notes ?? '').not.toContain('Provider metadata:');
  });

  it('metadata never becomes structured planning data on the imported plan', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({
        metadata: [{ key: 'vehicle-class', value: 'sample high-speed rail' }],
      }),
      NOW,
      'handoff-mock-transport-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    // The pair is preserved only inside the notes text; no plan field carries it.
    expect(mapped.plan.notes ?? '').toContain('sample high-speed rail');
    expect(mapped.plan).not.toHaveProperty('metadata');
    const planFields = Object.entries(mapped.plan).filter(
      ([key, value]) => key !== 'notes' && typeof value === 'string'
    );
    for (const [, value] of planFields) {
      expect(value).not.toContain('sample high-speed rail');
    }
  });
});

describe('STEP 28 discovery handoff primary-resolution integrity', () => {
  it('a handoff plan carries no resolution vocabulary on its type shape', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t28-transport-1'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      expect(JSON.stringify(mapped.plan)).not.toContain('explicitResolution');
      expect(JSON.stringify(mapped.plan)).not.toContain('resolutions');
      expect(JSON.stringify(mapped.plan)).not.toContain('primaryTransportPlanId');
      expect(JSON.stringify(mapped.plan)).not.toContain('primaryAccommodationPlanId');
    }
  });

  it('selecting a handoff-added plan by a user act resolves a missing primary', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t28-transport-2'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      const outcome = classifyPrimaryResolutionDecision({
        priorStatus: 'missing',
        priorSelectedId: 'legacy-missing-id',
        action: { type: 'select', selectedId: mapped.plan.id },
        plans: [mapped.plan],
      });
      expect(outcome.decision).toBe('selected-another');
      expect(outcome.resolved).toBe(true);
    }
  });

  it('adding a handoff candidate never resolves or changes a pre-existing restored selection', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t28-transport-3'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      const restored: { id: string; mode: string; lifecycleState: 'active' }[] = [
        { id: 'trp-restored', mode: 'Ferry', lifecycleState: 'active' },
      ];
      const outcome = classifyPrimaryResolutionDecision({
        priorStatus: 'valid',
        priorSelectedId: 'trp-restored',
        action: { type: 'select', selectedId: mapped.plan.id },
        plans: [...restored, mapped.plan],
      });
      expect(outcome.resolved).toBe(false);
      expect(resolvePrimarySelection('trp-restored', [...restored, mapped.plan]).state).toBe(
        'valid-explicit-selection'
      );
    }
  });

  it('a workspace with an unresolved conflict stays unresolved after a handoff candidate is added', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(
      makeResult({ category: 'transport' }),
      NOW,
      'handoff-t28-transport-4'
    );
    expect(mapped).not.toBeNull();
    if (mapped !== null) {
      const plans = [mapped.plan];
      const outcome = classifyPrimaryResolutionDecision({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-archived-selected',
        action: { type: 'restore', planId: 'something-else' },
        plans,
      });
      expect(outcome.resolved).toBe(false);
      expect(outcome.decision).toBe('unresolved');
    }
  });
});

describe('STEP 40 orchestrated provider attribution handoff', () => {
  it('routes an orchestrated alternative-provider result through handoff with full attribution', () => {
    const aggregate = orchestrateDiscovery(
      { category: 'transport', destination: 'Tokyo' },
      [mockTransportProviderAdapter, mockAlternativeTransportProviderAdapter],
      '2026-09-13T08:00:00.000Z'
    );
    expect(aggregate.status).toBe('success');
    const alternative = aggregate.results.find(
      (r) => r.providerId === MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID
    );
    expect(alternative).toBeDefined();
    if (alternative === undefined) return;

    const mapped = mapDiscoveryResultToHandoffPlan(alternative, NOW, 'handoff-alt-transport-1');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    if (mapped.kind !== 'transport') return;

    expect(mapped.plan.provider).toEqual(MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME);
    expect(mapped.plan.provenance).toEqual({
      kind: 'mock-discovery',
      note: DISCOVERY_HANDOFF_PROVENANCE_NOTE,
    });
    expect(mapped.plan.lifecycleState).toBe(DISCOVERY_HANDOFF_LIFECYCLE_STATE);
    const notes = mapped.plan.notes ?? '';
    expect(notes).toContain(`Provider: ${MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME}`);
    expect(notes).toContain(`Provider id: ${MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID}`);
    expect(notes).toContain('Result id: mock-alternative-transport-1');
    expect(notes).toContain(MOCK_RESULT_DISCLAIMER);
  });

  it('an orchestrated result handoff carries no booking, verification, or primary-selection fields', () => {
    const aggregate = orchestrateDiscovery(
      { category: 'transport', destination: 'Kyoto' },
      [mockAlternativeTransportProviderAdapter],
      '2026-09-13T08:00:00.000Z'
    );
    expect(aggregate.status).toBe('success');
    const alternative = aggregate.results[0];
    const mapped = mapDiscoveryResultToHandoffPlan(alternative, NOW, 'handoff-alt-transport-2');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(JSON.stringify(mapped.plan)).not.toContain('bookingConfirmation');
    expect(JSON.stringify(mapped.plan)).not.toContain('verifiedAt');
    expect(JSON.stringify(mapped.plan)).not.toContain('primaryTransportPlanId');
    expect(JSON.stringify(mapped.plan)).not.toContain('primaryAccommodationPlanId');
    expect(JSON.stringify(mapped.plan)).not.toContain('resolutions');
  });

  it('preserves explicit sourceUrl from orchestrated alternative provider result', () => {
    const aggregate = orchestrateDiscovery(
      { category: 'transport', destination: 'Tokyo' },
      [mockAlternativeTransportProviderAdapter],
      '2026-09-13T08:00:00.000Z'
    );
    expect(aggregate.status).toBe('success');
    const alternative = aggregate.results.find(
      (r) => r.resultId === 'mock-alternative-transport-1'
    );
    expect(alternative).toBeDefined();
    if (alternative === undefined) return;

    const mapped = mapDiscoveryResultToHandoffPlan(alternative, NOW, 'handoff-alt-transport-3');
    expect(mapped).not.toBeNull();
    if (mapped === null) return;
    expect(mapped.plan.sourceUrl).toEqual(alternative.sourceUrl);
    expect(mapped.plan.referenceNumber).toEqual(alternative.resultId);
  });
});
