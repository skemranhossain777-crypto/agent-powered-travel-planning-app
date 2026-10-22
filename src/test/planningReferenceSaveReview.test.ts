import { describe, expect, it } from 'vitest';
import {
  buildPlanningReferenceSaveReview,
  classifyPlanningReferenceSaveReview,
  describePlanningReferenceSaveReviewItem,
  getPlanningReferenceSaveReviewItemGuidance,
  getPlanningReferenceSaveReviewSectionLabel,
  type PlanningReferenceSaveReviewItem,
  type PlanningReferenceSaveReviewItemKind,
} from '../domain/trips/planningReferenceSaveReview';
import {
  buildPlanningReferenceChangeContext,
  type ChangeContextPlan,
  type ChangeContextSections,
} from '../domain/trips/planningReferenceChangeContext';

type LabelFields = Partial<Omit<ChangeContextPlan, 'id'>> & {
  mode?: string;
  name?: string;
  location?: string;
  departureLocation?: string;
  arrivalLocation?: string;
};

function activePlan(id: string, overrides: LabelFields = {}): ChangeContextPlan {
  return { id, lifecycleState: 'active', ...overrides };
}

function plan(id: string, overrides: LabelFields = {}): ChangeContextPlan {
  return { id, ...overrides };
}

function inactivePlan(
  id: string,
  state: 'needs-review' | 'replaced' | 'archived' = 'archived'
): ChangeContextPlan {
  return { id, lifecycleState: state };
}

function review(
  saved: ChangeContextSections | undefined,
  draft: ChangeContextSections | undefined
) {
  return buildPlanningReferenceSaveReview({ saved, draft });
}

function transportContextSaved(plans: ReadonlyArray<ChangeContextPlan>): ChangeContextSections {
  return { transportPlans: plans };
}

const REVIEW_KINDS: ReadonlyArray<PlanningReferenceSaveReviewItemKind> = [
  'primary-selected',
  'primary-changed',
  'primary-cleared',
  'primary-restored',
  'primary-unresolved',
  'lifecycle-changed',
  'provenance-changed',
  'source-changed',
];

describe('planningReferenceSaveReview vocabulary', () => {
  it('declares the full review-item vocabulary', () => {
    for (const kind of REVIEW_KINDS) {
      expect(kind.length).toBeGreaterThan(0);
    }
  });

  it('describes every item kind in honest planning wording', () => {
    const base: PlanningReferenceSaveReviewItem = {
      section: 'transport',
      kind: 'primary-changed',
      previousValue: 'Flight',
      currentValue: 'Train',
      planLabel: 'Flight',
      attention: false,
    };
    expect(
      describePlanningReferenceSaveReviewItem({
        ...base,
        kind: 'primary-selected',
        currentValue: 'Train',
      })
    ).toBe('Primary reference will be set to “Train”.');
    expect(describePlanningReferenceSaveReviewItem({ ...base, kind: 'primary-changed' })).toBe(
      'Primary reference will change from “Flight” to “Train”.'
    );
    expect(describePlanningReferenceSaveReviewItem({ ...base, kind: 'primary-cleared' })).toBe(
      'Primary reference will be cleared.'
    );
    expect(
      describePlanningReferenceSaveReviewItem({
        ...base,
        kind: 'primary-restored',
        currentValue: 'Flight',
      })
    ).toBe('Primary reference will be restored to Active (“Flight”).');
    expect(
      describePlanningReferenceSaveReviewItem({
        ...base,
        kind: 'primary-unresolved',
        currentValue: 'trp-missing',
      })
    ).toBe('Primary reference is unresolved and will remain unresolved if saved.');
    expect(
      describePlanningReferenceSaveReviewItem({
        ...base,
        kind: 'lifecycle-changed',
        previousValue: 'Active',
        currentValue: 'Archived',
      })
    ).toBe('Lifecycle for “Flight” will change from “Active” to “Archived”.');
    expect(
      describePlanningReferenceSaveReviewItem({
        ...base,
        kind: 'provenance-changed',
        previousValue: 'Simulated discovery',
        currentValue: 'Manual reference',
      })
    ).toBe('Provenance for “Flight” will change from “Simulated discovery” to “Manual reference”.');
    expect(describePlanningReferenceSaveReviewItem({ ...base, kind: 'source-changed' })).toBe(
      'Source URL for “Flight” will change.'
    );
  });

  it('maps section labels and describes items without repeating the section noun', () => {
    expect(getPlanningReferenceSaveReviewSectionLabel('transport')).toBe('Transport');
    expect(getPlanningReferenceSaveReviewSectionLabel('accommodation')).toBe('Accommodation');
    const item: PlanningReferenceSaveReviewItem = {
      section: 'accommodation',
      kind: 'primary-selected',
      previousValue: null,
      currentValue: 'Padi Hotel',
      planLabel: 'Padi Hotel',
      attention: false,
    };
    expect(describePlanningReferenceSaveReviewItem(item)).toBe(
      'Primary reference will be set to “Padi Hotel”.'
    );
  });

  it('offers actionable, neutral guidance only for unresolved items', () => {
    const base: PlanningReferenceSaveReviewItem = {
      section: 'transport',
      kind: 'primary-changed',
      previousValue: 'Flight',
      currentValue: 'Train',
      planLabel: 'Flight',
      attention: false,
    };
    const guidance = getPlanningReferenceSaveReviewItemGuidance({
      ...base,
      kind: 'primary-unresolved',
    });
    expect(guidance).toContain('Select another active reference');
    expect(guidance).toContain('or restore the plan to active.');
    expect(
      getPlanningReferenceSaveReviewItemGuidance({ ...base, kind: 'primary-cleared' })
    ).toBeNull();
    expect(
      getPlanningReferenceSaveReviewItemGuidance({
        ...base,
        kind: 'lifecycle-changed',
        attention: true,
      })
    ).toBeNull();
  });
});

describe('planningReferenceSaveReview — no review', () => {
  it('identical saved and draft reference state produces no review', () => {
    const result = review(
      transportContextSaved([activePlan('trp-1', { mode: 'Flight' })]),
      transportContextSaved([activePlan('trp-1', { mode: 'Flight' })])
    );
    expect(result.shouldReview).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.transport.shouldReview).toBe(false);
    expect(result.accommodation.shouldReview).toBe(false);
  });

  it('ordinary plan text edits are never review-worthy', () => {
    const result = review(
      transportContextSaved([activePlan('trp-1', { mode: 'Flight', departureLocation: 'LHR' })]),
      transportContextSaved([activePlan('trp-1', { mode: 'Train', departureLocation: 'CDG' })])
    );
    expect(result.shouldReview).toBe(false);
  });

  it('no primary on either side and no plan changes produces no review', () => {
    const result = review(
      transportContextSaved([activePlan('trp-1')]),
      transportContextSaved([activePlan('trp-1')])
    );
    expect(result.shouldReview).toBe(false);
  });

  it('legacy absence (no stored primary, no stored lifecycle) never triggers a review', () => {
    const result = review(
      { transportPlans: [plan('trp-1', { mode: 'Flight' })] },
      { transportPlans: [plan('trp-1', { mode: 'Flight' })] }
    );
    expect(result.shouldReview).toBe(false);
  });

  it('an absent draft never reads as a clear or a change', () => {
    const result = review(
      transportContextSaved([activePlan('trp-1', { mode: 'Flight' })]),
      undefined
    );
    expect(result.shouldReview).toBe(false);
  });

  it('adding or removing a reference does not trigger a review (no confirmation fatigue)', () => {
    const added = review(
      transportContextSaved([activePlan('trp-1')]),
      transportContextSaved([activePlan('trp-1'), activePlan('trp-2')])
    );
    expect(added.shouldReview).toBe(false);
    const removed = review(
      transportContextSaved([activePlan('trp-1'), activePlan('trp-2')]),
      transportContextSaved([activePlan('trp-1')])
    );
    expect(removed.shouldReview).toBe(false);
  });
});

describe('planningReferenceSaveReview — primary changes', () => {
  it('a fresh selection reports primary-selected with the draft label', () => {
    const result = review(
      transportContextSaved([
        activePlan('trp-1', { mode: 'Flight' }),
        activePlan('trp-2', { mode: 'Train' }),
      ]),
      {
        transportPlans: [
          activePlan('trp-1', { mode: 'Flight' }),
          activePlan('trp-2', { mode: 'Train' }),
        ],
        primaryTransportPlanId: 'trp-2',
      }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'primary-selected',
        previousValue: null,
        currentValue: 'Train',
        planLabel: 'Train',
        attention: false,
      }),
    ]);
  });

  it('a changed selection reports primary-changed with both labels', () => {
    const result = review(
      {
        transportPlans: [
          activePlan('trp-1', { mode: 'Flight' }),
          activePlan('trp-2', { mode: 'Train' }),
        ],
        primaryTransportPlanId: 'trp-1',
      },
      {
        transportPlans: [
          activePlan('trp-1', { mode: 'Flight' }),
          activePlan('trp-2', { mode: 'Train' }),
        ],
        primaryTransportPlanId: 'trp-2',
      }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'primary-changed',
        previousValue: 'Flight',
        currentValue: 'Train',
      }),
    ]);
  });

  it('a cleared selection reports primary-cleared with the previous label and a null current', () => {
    const result = review(
      {
        transportPlans: [activePlan('trp-1', { mode: 'Flight' })],
        primaryTransportPlanId: 'trp-1',
      },
      { transportPlans: [activePlan('trp-1', { mode: 'Flight' })], primaryTransportPlanId: null }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'primary-cleared',
        previousValue: 'Flight',
        currentValue: null,
      }),
    ]);
  });

  it('a restored primary reports primary-restored ahead of the lifecycle change', () => {
    const result = review(
      {
        transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })],
        primaryTransportPlanId: 'trp-1',
      },
      {
        transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'active' })],
        primaryTransportPlanId: 'trp-1',
      }
    );
    expect(result.shouldReview).toBe(true);
    const kinds = result.transport.items.map((item) => item.kind);
    expect(kinds).toEqual(['primary-restored', 'lifecycle-changed']);
    expect(result.transport.items[0]).toEqual(
      expect.objectContaining({
        previousValue: 'Flight',
        currentValue: 'Flight',
        planLabel: 'Flight',
      })
    );
    expect(result.transport.items[1]).toEqual(
      expect.objectContaining({
        kind: 'lifecycle-changed',
        previousValue: 'Archived',
        currentValue: 'Active',
        attention: false,
      })
    );
  });

  it('archiving the selected primary stays unresolved and never auto-repairs', () => {
    const result = review(
      {
        transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'active' })],
        primaryTransportPlanId: 'trp-1',
      },
      {
        transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })],
        primaryTransportPlanId: 'trp-1',
      }
    );
    expect(result.shouldReview).toBe(true);
    const items = result.transport.items;
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'primary-unresolved',
        currentValue: 'Flight',
        attention: true,
      })
    );
    expect(describePlanningReferenceSaveReviewItem(items[0])).toBe(
      'Primary reference is unresolved and will remain unresolved if saved.'
    );
    expect(getPlanningReferenceSaveReviewItemGuidance(items[0])).toContain('Select another active');
    expect(items[1].kind).toBe('lifecycle-changed');
  });

  it('a pre-existing unresolved primary triggers a review even when nothing else changed', () => {
    const result = review(
      { transportPlans: [activePlan('trp-1')], primaryTransportPlanId: 'trp-missing' },
      { transportPlans: [activePlan('trp-1')], primaryTransportPlanId: 'trp-missing' }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toHaveLength(1);
    expect(result.transport.items[0]).toEqual(
      expect.objectContaining({
        kind: 'primary-unresolved',
        planLabel: 'trp-missing',
        attention: true,
      })
    );
  });
});

describe('planningReferenceSaveReview — lifecycle changes', () => {
  const transitions: ReadonlyArray<{
    from: 'active' | 'needs-review' | 'replaced' | 'archived';
    to: 'active' | 'needs-review' | 'replaced' | 'archived';
    fromLabel: string;
    toLabel: string;
  }> = [
    { from: 'active', to: 'needs-review', fromLabel: 'Active', toLabel: 'Needs review' },
    { from: 'needs-review', to: 'active', fromLabel: 'Needs review', toLabel: 'Active' },
    { from: 'active', to: 'replaced', fromLabel: 'Active', toLabel: 'Replaced' },
    { from: 'replaced', to: 'archived', fromLabel: 'Replaced', toLabel: 'Archived' },
    { from: 'archived', to: 'active', fromLabel: 'Archived', toLabel: 'Active' },
  ];

  it('reports every lifecycle transition with the correct labels', () => {
    for (const transition of transitions) {
      const result = review(
        transportContextSaved([plan('trp-1', { mode: 'Flight', lifecycleState: transition.from })]),
        transportContextSaved([plan('trp-1', { mode: 'Flight', lifecycleState: transition.to })])
      );
      expect(result.shouldReview).toBe(true);
      expect(result.transport.items).toEqual([
        expect.objectContaining({
          kind: 'lifecycle-changed',
          previousValue: transition.fromLabel,
          currentValue: transition.toLabel,
          planLabel: 'Flight',
          attention: transition.to !== 'active',
        }),
      ]);
    }
  });

  it('a lifecycle change on a non-primary plan is review-worthy without primary feedback', () => {
    const result = review(
      transportContextSaved([plan('trp-1', { mode: 'Flight', lifecycleState: 'active' })]),
      transportContextSaved([plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })])
    );
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'lifecycle-changed',
        previousValue: 'Active',
        currentValue: 'Archived',
        attention: true,
      }),
    ]);
  });
});

describe('planningReferenceSaveReview — provenance and source changes', () => {
  it('a provenance-kind change reports both provenance labels', () => {
    const result = review(
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', provenance: { kind: 'mock-discovery' } }),
      ]),
      transportContextSaved([plan('trp-1', { mode: 'Flight', provenance: { kind: 'manual' } })])
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'provenance-changed',
        previousValue: 'Simulated discovery',
        currentValue: 'Manual reference',
        planLabel: 'Flight',
      }),
    ]);
  });

  it('a provenance note-only edit never triggers a review', () => {
    const result = review(
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', provenance: { kind: 'mock-discovery', note: 'first' } }),
      ]),
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', provenance: { kind: 'mock-discovery', note: 'second' } }),
      ])
    );
    expect(result.shouldReview).toBe(false);
  });

  it('a source URL change reports the previous and trimmed current values', () => {
    const result = review(
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', sourceUrl: 'https://example.com/original' }),
      ]),
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', sourceUrl: 'https://example.com/updated' }),
      ])
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toEqual([
      expect.objectContaining({
        kind: 'source-changed',
        previousValue: 'https://example.com/original',
        currentValue: 'https://example.com/updated',
        planLabel: 'Flight',
      }),
    ]);
  });

  it('an unchanged source URL never triggers a review', () => {
    const result = review(
      transportContextSaved([
        plan('trp-1', { mode: 'Flight', sourceUrl: 'https://example.com/a' }),
      ]),
      transportContextSaved([plan('trp-1', { mode: 'Flight', sourceUrl: 'https://example.com/a' })])
    );
    expect(result.shouldReview).toBe(false);
  });
});

describe('planningReferenceSaveReview — composition', () => {
  it('transport and accommodation are reviewed independently', () => {
    const result = review(
      {
        transportPlans: [activePlan('trp-1', { mode: 'Flight' })],
        accommodationPlans: [plan('acp-1', { name: 'Padi Hotel', lifecycleState: 'archived' })],
      },
      {
        transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })],
        accommodationPlans: [plan('acp-1', { name: 'Padi Hotel', lifecycleState: 'archived' })],
      }
    );
    expect(result.transport.shouldReview).toBe(true);
    expect(result.accommodation.shouldReview).toBe(false);
    expect(result.items).toEqual(result.transport.items);
  });

  it('orders primary items before plan items and transport before accommodation', () => {
    const result = review(
      {
        transportPlans: [
          plan('trp-1', { mode: 'Flight', lifecycleState: 'active' }),
          activePlan('trp-2', { mode: 'Train' }),
        ],
        accommodationPlans: [activePlan('acp-1', { name: 'Padi Hotel' })],
        primaryTransportPlanId: 'trp-1',
      },
      {
        transportPlans: [
          plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' }),
          activePlan('trp-2', { mode: 'Train' }),
        ],
        accommodationPlans: [
          activePlan('acp-1', { name: 'Padi Hotel' }),
          activePlan('acp-2', { name: 'Old Resort' }),
        ],
        primaryTransportPlanId: 'trp-1',
        primaryAccommodationPlanId: 'acp-2',
      }
    );
    const kinds = result.items.map((item) => item.kind);
    expect(kinds).toEqual(['primary-unresolved', 'lifecycle-changed', 'primary-selected']);
    expect(result.items[0].section).toBe('transport');
    expect(result.items[2].section).toBe('accommodation');
  });

  it('never duplicates the primary-unresolved item for a section', () => {
    const result = review(transportContextSaved([plan('trp-1', { mode: 'Flight' })]), {
      transportPlans: [plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })],
      primaryTransportPlanId: 'trp-1',
    });
    const unresolved = result.transport.items.filter((item) => item.kind === 'primary-unresolved');
    expect(unresolved).toHaveLength(1);
  });

  it('equivalence: a primary kept identical on both sides never emits a review item', () => {
    const result = review(
      {
        transportPlans: [activePlan('trp-1', { mode: 'Flight' })],
        primaryTransportPlanId: 'trp-1',
      },
      {
        transportPlans: [activePlan('trp-1', { mode: 'Flight' })],
        primaryTransportPlanId: 'trp-1',
      }
    );
    expect(result.items).toHaveLength(0);
  });
});

describe('planningReferenceSaveReview — pure classify composition with STEP 29', () => {
  it('classify derives its items from the STEP 29 change contexts', () => {
    const savedPlans = [activePlan('trp-1')];
    const contexts = buildPlanningReferenceChangeContext({
      saved: { transportPlans: savedPlans },
      draft: { transportPlans: savedPlans, primaryTransportPlanId: 'trp-1' },
    });
    expect(contexts.changed).toBe(true);
    const result = classifyPlanningReferenceSaveReview(
      { transport: contexts.transport, accommodation: contexts.accommodation },
      { transportPlans: savedPlans, accommodationPlans: [] }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items[0].kind).toBe('primary-selected');
  });
});

describe('planningReferenceSaveReview — safety', () => {
  it('never mutates the saved or draft inputs', () => {
    const savedPlans = [activePlan('trp-1', { mode: 'Flight' })];
    const draftPlans = [plan('trp-1', { mode: 'Flight', lifecycleState: 'archived' })];
    const savedSnapshot = JSON.stringify(savedPlans);
    const draftSnapshot = JSON.stringify(draftPlans);
    review(
      { transportPlans: savedPlans, primaryTransportPlanId: 'trp-1' },
      { transportPlans: draftPlans, primaryTransportPlanId: 'trp-1' }
    );
    expect(JSON.stringify(savedPlans)).toBe(savedSnapshot);
    expect(JSON.stringify(draftPlans)).toBe(draftSnapshot);
  });

  it('an unresolved draft is never auto-selected, auto-cleared, or restored by the review', () => {
    const result = review(
      {
        transportPlans: [activePlan('trp-1'), activePlan('trp-2')],
        primaryTransportPlanId: 'trp-missing',
      },
      {
        transportPlans: [activePlan('trp-1'), activePlan('trp-2')],
        primaryTransportPlanId: 'trp-missing',
      }
    );
    expect(result.shouldReview).toBe(true);
    expect(result.transport.items).toHaveLength(1);
    expect(result.transport.items[0].kind).toBe('primary-unresolved');
    expect(result.transport.items[0].currentValue).toBe('trp-missing');
  });
});

// ---------------------------------------------------------------------------
// STEP 33 regression-matrix — full-flow review classification (A, B, C, D, E)
// ---------------------------------------------------------------------------

describe('planningReferenceSaveReview — full-flow regression matrix', () => {
  type FlowCase = {
    name: string;
    saved: ChangeContextSections | undefined;
    draft: ChangeContextSections | undefined;
    expectedShouldReview: boolean;
    expectedKinds: ReadonlyArray<PlanningReferenceSaveReviewItemKind>;
    expectedSections: ReadonlyArray<'transport' | 'accommodation'>;
  };

  const active1 = activePlan('trp-1', { mode: 'Flight' });
  const active2 = activePlan('trp-2', { mode: 'Train' });
  const activeAcp = activePlan('acp-1', { name: 'Padi Hotel' });

  const cases: ReadonlyArray<FlowCase> = [
    {
      name: 'no-review: identical saved and draft state',
      saved: { transportPlans: [active1] },
      draft: { transportPlans: [active1] },
      expectedShouldReview: false,
      expectedKinds: [],
      expectedSections: [],
    },
    {
      name: 'no-review: adding a plan is never review-worthy',
      saved: { transportPlans: [active1] },
      draft: { transportPlans: [active1, active2] },
      expectedShouldReview: false,
      expectedKinds: [],
      expectedSections: [],
    },
    {
      name: 'primary cleared on transport — review shows primary-cleared',
      saved: {
        transportPlans: [active1],
        primaryTransportPlanId: 'trp-1',
      },
      draft: {
        transportPlans: [active1],
        primaryTransportPlanId: null,
      },
      expectedShouldReview: true,
      expectedKinds: ['primary-cleared'],
      expectedSections: ['transport'],
    },
    {
      name: 'primary changed from A to B on different active plans',
      saved: {
        transportPlans: [active1, active2],
        primaryTransportPlanId: 'trp-1',
      },
      draft: {
        transportPlans: [active1, active2],
        primaryTransportPlanId: 'trp-2',
      },
      expectedShouldReview: true,
      expectedKinds: ['primary-changed'],
      expectedSections: ['transport'],
    },
    {
      name: 'primary restored from archived — review shows primary-restored and lifecycle-changed',
      saved: {
        transportPlans: [plan('trp-1', { lifecycleState: 'archived', mode: 'Flight' })],
        primaryTransportPlanId: 'trp-1',
      },
      draft: {
        transportPlans: [activePlan('trp-1', { mode: 'Flight' })],
        primaryTransportPlanId: 'trp-1',
      },
      expectedShouldReview: true,
      expectedKinds: ['primary-restored', 'lifecycle-changed'],
      expectedSections: ['transport', 'transport'],
    },
    {
      name: 'transport lifecycle change + accommodation source URL change are reviewed independently',
      saved: {
        transportPlans: [activePlan('trp-1', { mode: 'Flight', lifecycleState: 'active' })],
        accommodationPlans: [
          activePlan('acp-1', { sourceUrl: 'https://old.com', name: 'Padi Hotel' }),
        ],
      },
      draft: {
        transportPlans: [inactivePlan('trp-1', 'needs-review')],
        accommodationPlans: [
          activePlan('acp-1', { sourceUrl: 'https://new.com', name: 'Padi Hotel' }),
        ],
      },
      expectedShouldReview: true,
      expectedKinds: ['lifecycle-changed', 'source-changed'],
      expectedSections: ['transport', 'accommodation'],
    },
    {
      name: 'unresolved primary persists even when unrelated accommodation changes',
      saved: {
        transportPlans: [active1],
        primaryTransportPlanId: 'trp-missing',
        accommodationPlans: [activeAcp],
      },
      draft: {
        transportPlans: [active1],
        primaryTransportPlanId: 'trp-missing',
        accommodationPlans: [plan('acp-1', { name: 'Padi Hotel', lifecycleState: 'archived' })],
      },
      expectedShouldReview: true,
      expectedKinds: ['primary-unresolved', 'lifecycle-changed'],
      expectedSections: ['transport', 'accommodation'],
    },
    {
      name: 'only lifecycle change on a non-primary plan without any primary present',
      saved: { transportPlans: [plan('trp-1', { lifecycleState: 'active', mode: 'Flight' })] },
      draft: {
        transportPlans: [plan('trp-1', { lifecycleState: 'archived', mode: 'Flight' })],
      },
      expectedShouldReview: true,
      expectedKinds: ['lifecycle-changed'],
      expectedSections: ['transport'],
    },
    {
      name: 'source URL change on a plan is reviewed independently of primary selection',
      saved: {
        transportPlans: [activePlan('trp-1', { sourceUrl: 'https://old.com' })],
      },
      draft: {
        transportPlans: [activePlan('trp-1', { sourceUrl: 'https://new.com' })],
        primaryTransportPlanId: 'trp-1',
      },
      expectedShouldReview: true,
      expectedKinds: ['primary-selected', 'source-changed'],
      expectedSections: ['transport', 'transport'],
    },
  ];

  it.each(cases.map((c) => [c.name, c]))('%s', (_name, tc) => {
    const result = review(tc.saved, tc.draft);
    expect(result.shouldReview).toBe(tc.expectedShouldReview);
    expect(result.items.map((i) => i.kind)).toEqual(tc.expectedKinds);
    expect(result.items.map((i) => i.section)).toEqual(tc.expectedSections);
  });
});
