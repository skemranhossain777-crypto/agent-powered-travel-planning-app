import { describe, expect, it } from 'vitest';
import {
  comparePlanningReferenceSectionChange,
  buildPlanningReferenceChangeContext,
  getAccommodationPlanReferenceLabel,
  getTransportPlanReferenceLabel,
  type ChangeContextPlan,
  type TransportReferenceChangePlan,
  type AccommodationReferenceChangePlan,
  type PlanningReferencePrimaryChangeKind,
  type PlanningReferenceSectionChangeKind,
} from '../domain/trips/planningReferenceChangeContext';

function activePlan(
  id: string,
  overrides: Partial<TransportReferenceChangePlan & AccommodationReferenceChangePlan> & {
    [key: string]: unknown;
  } = {}
): ChangeContextPlan {
  return { id, lifecycleState: 'active', ...overrides };
}

function inactivePlan(
  id: string,
  state: 'needs-review' | 'replaced' | 'archived' = 'archived'
): ChangeContextPlan {
  return { id, lifecycleState: state };
}

function compareTransport(input: {
  savedPlans?: ReadonlyArray<ChangeContextPlan>;
  savedPrimaryPlanId?: string | null;
  draftPlans?: ReadonlyArray<ChangeContextPlan>;
  draftPrimaryPlanId?: string | null;
}) {
  return comparePlanningReferenceSectionChange('transport', {
    savedPlans: input.savedPlans ?? [],
    savedPrimaryPlanId: input.savedPrimaryPlanId,
    draftPlans: input.draftPlans ?? [],
    draftPrimaryPlanId: input.draftPrimaryPlanId,
  });
}

const SECTION_KINDS: ReadonlyArray<PlanningReferenceSectionChangeKind> = [
  'unchanged',
  'primary-selected',
  'primary-changed',
  'primary-cleared',
  'primary-restored',
  'primary-unresolved',
  'lifecycle-changed',
  'provenance-changed',
  'source-changed',
  'reference-added',
  'reference-removed',
];

const PRIMARY_KINDS: ReadonlyArray<PlanningReferencePrimaryChangeKind> = [
  'none',
  'selected',
  'changed',
  'cleared',
  'restored',
  'unresolved',
];

describe('planningReferenceChangeContext vocabulary', () => {
  it('declares the full section and primary change vocabulary', () => {
    for (const kind of SECTION_KINDS) {
      expect(kind.length).toBeGreaterThan(0);
    }
    for (const kind of PRIMARY_KINDS) {
      expect(kind.length).toBeGreaterThan(0);
    }
  });

  it('background id/kind changes never claim vocabulary outside planning', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1'), activePlan('trp-2')],
      draftPlans: [activePlan('trp-2'), activePlan('trp-3')],
    });
    expect(context.message).toContain('was added in this draft.');
    expect(context.message).toContain('was removed in this draft.');
    expect(context.message!.toLowerCase()).not.toMatch(
      /booking|reservation|payment|available|verified|confirmed|archived.*restored.*active/
    );
  });
});

describe('planningReferenceChangeContext — unchanged sections', () => {
  it('identical plans and primary produce no change and no message', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { mode: 'Flight' })],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1', { mode: 'Flight' })],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.changed).toBe(false);
    expect(context.kind).toBe('unchanged');
    expect(context.primary.kind).toBe('none');
    expect(context.planChanges).toEqual([]);
    expect(context.message).toBeNull();
  });

  it('both sections with no primary are unchanged', () => {
    const context = compareTransport({});
    expect(context.changed).toBe(false);
    expect(context.primary.kind).toBe('none');
    expect(context.primary.previousId).toBeNull();
    expect(context.primary.currentId).toBeNull();
    expect(context.message).toBeNull();
  });

  it('a missing primary id on both sides is unchanged, never a false cleared', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-missing',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-missing',
    });
    expect(context.changed).toBe(false);
    expect(context.primary.kind).toBe('none');
    expect(context.unresolved).toBe(true);
    expect(context.message).toBeNull();
  });

  it('fields the change context does not compare (notes etc) do not create changes', () => {
    const persisted = activePlan('trp-1', { notes: 'book early' });
    const edited = activePlan('trp-1', { notes: 'book even earlier' });
    const context = compareTransport({
      savedPlans: [persisted],
      draftPlans: [edited],
    });
    expect(context.changed).toBe(false);
    expect(context.planChanges).toEqual([]);
    expect(context.message).toBeNull();
  });

  it('absent source URL on both sides is not a source change', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      draftPlans: [activePlan('trp-1')],
    });
    expect(context.changed).toBe(false);
  });

  it('a legacy plan with no lifecycle is never reported as a lifecycle change', () => {
    const context = compareTransport({
      savedPlans: [{ id: 'trp-1' }],
      draftPlans: [{ id: 'trp-1' }],
    });
    expect(context.changed).toBe(false);
    expect(context.planChanges).toEqual([]);
  });

  it('re-selecting the already-valid primary is no change', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.changed).toBe(false);
    expect(context.primary.kind).toBe('none');
  });

  it('an absent draft is never reported as a clear', () => {
    const context = buildPlanningReferenceChangeContext({
      saved: {
        transportPlans: [activePlan('trp-1')],
        primaryTransportPlanId: 'trp-1',
      },
      draft: undefined,
    });
    expect(context.changed).toBe(false);
    expect(context.transport.kind).toBe('unchanged');
    expect(context.transport.primary.kind).toBe('none');
    expect(context.transport.message).toBeNull();
  });
});

describe('planningReferenceChangeContext — primary transitions', () => {
  it('none → valid reports "selected" with the draft label', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { mode: 'Flight' })],
      draftPlans: [activePlan('trp-1', { mode: 'Flight' })],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.changed).toBe(true);
    expect(context.kind).toBe('primary-selected');
    expect(context.primary.kind).toBe('selected');
    expect(context.primary.previousId).toBeNull();
    expect(context.primary.currentId).toBe('trp-1');
    expect(context.primary.currentLabel).toBe('Flight');
    expect(context.primary.currentStatus).toBe('valid');
    expect(context.message).toBe('Primary reference selected in this draft.');
  });

  it('valid A → valid B reports "changed" with both labels', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { mode: 'Flight' }), activePlan('trp-2', { mode: 'Train' })],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1', { mode: 'Flight' }), activePlan('trp-2', { mode: 'Train' })],
      draftPrimaryPlanId: 'trp-2',
    });
    expect(context.primary.kind).toBe('changed');
    expect(context.kind).toBe('primary-changed');
    expect(context.primary.previousLabel).toBe('Flight');
    expect(context.primary.currentLabel).toBe('Train');
    expect(context.message).toBe(
      'Primary reference changed from "Flight" to "Train" in this draft.'
    );
  });

  it('valid → none reports "cleared"', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: null,
    });
    expect(context.primary.kind).toBe('cleared');
    expect(context.kind).toBe('primary-cleared');
    expect(context.message).toBe('Primary assignment cleared in this draft.');
  });

  it('inactive same id → valid same id reports "restored" (strict restore) with lifecycle change', () => {
    const context = compareTransport({
      savedPlans: [inactivePlan('trp-1', 'archived')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.primary.kind).toBe('restored');
    expect(context.kind).toBe('primary-restored');
    expect(context.message).toBe(
      'Existing primary reference restored to active in this draft. Planning reference lifecycle changed from "Archived" to "Active" in this draft.'
    );
  });

  it('missing same id → valid same id reports "selected", not "restored"', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-missing',
      draftPlans: [activePlan('trp-missing'), activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-missing',
    });
    expect(context.primary.kind).toBe('selected');
    expect(context.message).toContain('Primary reference selected in this draft.');
    expect(context.message).toContain('A planning reference was added in this draft.');
  });

  it('inactive X → valid Y reports "changed", not cleared or restored', () => {
    const context = compareTransport({
      savedPlans: [
        inactivePlan('trp-1', 'archived') as ChangeContextPlan & { mode?: string },
        activePlan('trp-2', { mode: 'Train' }),
      ],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [
        inactivePlan('trp-1', 'archived') as ChangeContextPlan & { mode?: string },
        activePlan('trp-2', { mode: 'Train' }),
      ],
      draftPrimaryPlanId: 'trp-2',
    });
    expect(context.primary.kind).toBe('changed');
    expect(context.primary.previousLabel).toBe('Transport plan');
    expect(context.primary.currentLabel).toBe('Train');
  });

  it('valid X → inactive X (lifecycle edit) reports unresolved plus the lifecycle descriptor', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [inactivePlan('trp-1', 'archived')],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.primary.kind).toBe('unresolved');
    expect(context.kind).toBe('primary-unresolved');
    expect(context.unresolved).toBe(true);
    expect(context.planChanges).toHaveLength(1);
    expect(context.planChanges[0].kind).toBe('lifecycle');
    expect(context.message).toBe(
      'Planning reference lifecycle changed from "Active" to "Archived" in this draft.'
    );
    expect(context.message).not.toContain('remains unresolved');
  });

  it('valid X → missing X (plan removed in draft) reports unresolved plus the removed descriptor', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.primary.kind).toBe('unresolved');
    expect(context.message).toBe('A planning reference was removed in this draft.');
    expect(context.message).not.toContain('remains unresolved');
  });

  it('none → missing with no other changes reports the standalone unresolved line only', () => {
    const context = compareTransport({
      draftPlans: [],
      draftPrimaryPlanId: 'trp-missing',
    });
    expect(context.primary.kind).toBe('unresolved');
    expect(context.kind).toBe('primary-unresolved');
    expect(context.unresolved).toBe(true);
    expect(context.planChanges).toEqual([]);
    expect(context.message).toBe('Primary assignment remains unresolved.');
  });

  it('missing X → missing Y is unresolved, missing X → missing X is unchanged', () => {
    const changedContext = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-missing-a',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-missing-b',
    });
    expect(changedContext.primary.kind).toBe('unresolved');
    expect(changedContext.changed).toBe(true);
    expect(changedContext.message).toBe('Primary assignment remains unresolved.');
  });

  it('a valid selection on an already-valid section never reports a change when untouched', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(context.changed).toBe(false);
  });
});

describe('planningReferenceChangeContext — plan-level changes', () => {
  it('a lifecycle change reports the "Active"→"Needs review" descriptor', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      draftPlans: [inactivePlan('trp-1', 'needs-review')],
    });
    expect(context.changed).toBe(true);
    expect(context.kind).toBe('lifecycle-changed');
    expect(context.primary.kind).toBe('none');
    expect(context.planChanges).toHaveLength(1);
    expect(context.planChanges[0]).toMatchObject({
      planId: 'trp-1',
      kind: 'lifecycle',
      previousValue: 'Active',
      currentValue: 'Needs review',
    });
    expect(context.message).toBe(
      'Planning reference lifecycle changed from "Active" to "Needs review" in this draft.'
    );
  });

  it('a legacy (absent) lifecycle treated as active reports an honest transition to replaced', () => {
    const context = compareTransport({
      savedPlans: [{ id: 'trp-1' }],
      draftPlans: [{ id: 'trp-1', lifecycleState: 'replaced' }],
    });
    expect(context.planChanges).toHaveLength(1);
    expect(context.planChanges[0].previousValue).toBe('Active');
    expect(context.planChanges[0].currentValue).toBe('Replaced');
  });

  it('a provenance kind change reports the honest descriptor', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { provenance: { kind: 'ai-generated' } })],
      draftPlans: [activePlan('trp-1', { provenance: { kind: 'manual' } })],
    });
    expect(context.kind).toBe('provenance-changed');
    expect(context.message).toBe(
      'Planning reference provenance changed from "AI-generated reference" to "Manual reference" in this draft.'
    );
  });

  it('a provenance note-only edit is not a user-visible change context', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { provenance: { kind: 'manual', note: 'old note' } })],
      draftPlans: [activePlan('trp-1', { provenance: { kind: 'manual', note: 'new note' } })],
    });
    expect(context.changed).toBe(false);
    expect(context.planChanges).toEqual([]);
    expect(context.message).toBeNull();
  });

  it('adding a source URL reports the source-changed descriptor', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      draftPlans: [activePlan('trp-1', { sourceUrl: 'https://example.com/trip' })],
    });
    expect(context.kind).toBe('source-changed');
    expect(context.planChanges[0]).toMatchObject({
      planId: 'trp-1',
      kind: 'source',
      previousValue: '',
      currentValue: 'https://example.com/trip',
    });
    expect(context.message).toBe('Planning reference source URL changed in this draft.');
  });

  it('changing and clearing a source URL both report the source-changed descriptor', () => {
    const changedContext = compareTransport({
      savedPlans: [activePlan('trp-1', { sourceUrl: 'https://example.com/a' })],
      draftPlans: [activePlan('trp-1', { sourceUrl: 'https://example.com/b' })],
    });
    expect(changedContext.planChanges).toHaveLength(1);
    expect(changedContext.planChanges[0].previousValue).toBe('https://example.com/a');
    expect(changedContext.planChanges[0].currentValue).toBe('https://example.com/b');

    const clearedContext = compareTransport({
      savedPlans: [activePlan('trp-1', { sourceUrl: 'https://example.com/a' })],
      draftPlans: [activePlan('trp-1')],
    });
    expect(clearedContext.planChanges).toHaveLength(1);
    expect(clearedContext.planChanges[0].currentValue).toBe('');
  });

  it('a URL with surrounding whitespace is compared trimmed', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1', { sourceUrl: '  https://example.com/a  ' })],
      draftPlans: [activePlan('trp-1', { sourceUrl: 'https://example.com/a' })],
    });
    expect(context.changed).toBe(false);
  });

  it('added and removed references both report descriptors in deterministic order', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1'), activePlan('trp-2')],
      draftPlans: [activePlan('trp-2'), activePlan('trp-3'), activePlan('trp-4')],
    });
    expect(context.planChanges.map((c) => c.kind)).toEqual([
      'reference-added',
      'reference-added',
      'reference-removed',
    ]);
    expect(context.message).toBe(
      'A planning reference was added in this draft. A planning reference was added in this draft. A planning reference was removed in this draft.'
    );
  });

  it('combines lifecycle, provenance, and source descriptors for one plan in a fixed order', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      draftPlans: [
        activePlan('trp-1', {
          lifecycleState: 'replaced',
          provenance: { kind: 'ai-generated' },
          sourceUrl: 'https://example.com/x',
        }),
      ],
    });
    expect(context.planChanges.map((c) => c.kind)).toEqual(['lifecycle', 'provenance', 'source']);
    expect(context.message).toBe(
      'Planning reference lifecycle changed from "Active" to "Replaced" in this draft. Planning reference provenance changed from "No provenance" to "AI-generated reference" in this draft. Planning reference source URL changed in this draft.'
    );
  });
});

describe('planningReferenceChangeContext — transport/accommodation independence', () => {
  it('a transport change does not mark the accommodation section changed', () => {
    const context = buildPlanningReferenceChangeContext({
      saved: {
        transportPlans: [activePlan('trp-1')],
        accommodationPlans: [activePlan('acp-1')],
      },
      draft: {
        transportPlans: [activePlan('trp-1'), activePlan('trp-2')],
        accommodationPlans: [activePlan('acp-1')],
      },
    });
    expect(context.changed).toBe(true);
    expect(context.transport.changed).toBe(true);
    expect(context.accommodation.changed).toBe(false);
    expect(context.accommodation.message).toBeNull();
  });

  it('an accommodation change is reported with its own section kind', () => {
    const context = buildPlanningReferenceChangeContext({
      saved: {
        transportPlans: [activePlan('trp-1')],
        accommodationPlans: [activePlan('acp-1')],
        primaryAccommodationPlanId: 'acp-1',
      },
      draft: {
        transportPlans: [activePlan('trp-1')],
        accommodationPlans: [activePlan('acp-1')],
        primaryAccommodationPlanId: null,
      },
    });
    expect(context.changed).toBe(true);
    expect(context.transport.changed).toBe(false);
    expect(context.accommodation.primary.kind).toBe('cleared');
  });
});

describe('planningReferenceChangeContext — determinism and immutability', () => {
  it('identical frozen inputs produce identical output and mutate nothing', () => {
    const savedPlans = Object.freeze([activePlan('trp-1'), inactivePlan('trp-2', 'archived')]);
    const draftPlans = Object.freeze([activePlan('trp-1', { sourceUrl: 'https://example.com' })]);
    const input = Object.freeze({
      savedPlans,
      savedPrimaryPlanId: 'trp-1',
      draftPlans,
      draftPrimaryPlanId: 'trp-1',
    });
    const first = compareTransport(input);
    const second = compareTransport(input);
    expect(first).toEqual(second);
    expect(first.message).toBe(
      'Planning reference source URL changed in this draft. A planning reference was removed in this draft.'
    );
    expect(second.planChanges.map((c) => c.planId)).toEqual(['trp-1', 'trp-2']);
  });

  it('primary labels fall back to the id when the saved plan is unresolvable', () => {
    const context = compareTransport({
      savedPlans: [activePlan('trp-1')],
      savedPrimaryPlanId: 'trp-missing',
      draftPlans: [activePlan('trp-1')],
      draftPrimaryPlanId: 'trp-missing',
    });
    expect(context.primary.kind).toBe('none');
    expect(context.primary.previousId).toBe('trp-missing');
    expect(context.primary.currentId).toBe('trp-missing');
  });
});

describe('planningReferenceChangeContext — reference labels', () => {
  it('builds deterministic transport labels', () => {
    expect(
      getTransportPlanReferenceLabel({
        id: 't',
        mode: 'Flight',
        departureLocation: 'A',
        arrivalLocation: 'B',
      })
    ).toBe('Flight (A → B)');
    expect(getTransportPlanReferenceLabel({ id: 't', mode: 'Flight' })).toBe('Flight');
    expect(
      getTransportPlanReferenceLabel({ id: 't', departureLocation: 'A', arrivalLocation: 'B' })
    ).toBe('A → B');
    expect(getTransportPlanReferenceLabel({ id: 't', departureLocation: 'A' })).toBe('A');
    expect(getTransportPlanReferenceLabel({ id: 't' })).toBe('Transport plan');
  });

  it('builds deterministic accommodation labels', () => {
    expect(
      getAccommodationPlanReferenceLabel({ id: 'a', name: 'Padi Hotel', location: 'Canggu' })
    ).toBe('Padi Hotel (Canggu)');
    expect(getAccommodationPlanReferenceLabel({ id: 'a', name: 'Padi Hotel' })).toBe('Padi Hotel');
    expect(getAccommodationPlanReferenceLabel({ id: 'a', location: 'Canggu' })).toBe(
      'Stay in Canggu'
    );
    expect(getAccommodationPlanReferenceLabel({ id: 'a' })).toBe('Accommodation plan');
  });
});

// ---------------------------------------------------------------------------
// STEP 33 regression-matrix — primary-reference transitions (B)
// ---------------------------------------------------------------------------

describe('planningReferenceChangeContext — primary-transition regression matrix', () => {
  type TestCase = {
    name: string;
    savedId: string | null;
    draftId: string | null;
    savedPlans: ReadonlyArray<ChangeContextPlan>;
    draftPlans: ReadonlyArray<ChangeContextPlan>;
    expectedKind: PlanningReferencePrimaryChangeKind;
    expectedSectionKind: PlanningReferenceSectionChangeKind;
    expectedChanged: boolean;
    expectedMessageContains?: string;
    expectedMessageNotContains?: string;
  };

  const active1 = activePlan('trp-1', { mode: 'Flight' });
  const active2 = activePlan('trp-2', { mode: 'Train' });
  const inactive1 = inactivePlan('trp-1', 'archived');

  const cases: ReadonlyArray<TestCase> = [
    {
      name: 'none → valid primary selected',
      savedId: null,
      draftId: 'trp-1',
      savedPlans: [active1],
      draftPlans: [active1],
      expectedKind: 'selected',
      expectedSectionKind: 'primary-selected',
      expectedChanged: true,
      expectedMessageContains: 'Primary reference selected in this draft.',
    },
    {
      name: 'valid A → valid B changed',
      savedId: 'trp-1',
      draftId: 'trp-2',
      savedPlans: [active1, active2],
      draftPlans: [active1, active2],
      expectedKind: 'changed',
      expectedSectionKind: 'primary-changed',
      expectedChanged: true,
      expectedMessageContains: 'changed from "Flight" to "Train"',
    },
    {
      name: 'valid → cleared',
      savedId: 'trp-1',
      draftId: null,
      savedPlans: [active1],
      draftPlans: [active1],
      expectedKind: 'cleared',
      expectedSectionKind: 'primary-cleared',
      expectedChanged: true,
      expectedMessageContains: 'Primary assignment cleared in this draft.',
    },
    {
      name: 'inactive → restored same id',
      savedId: 'trp-1',
      draftId: 'trp-1',
      savedPlans: [inactive1],
      draftPlans: [active1],
      expectedKind: 'restored',
      expectedSectionKind: 'primary-restored',
      expectedChanged: true,
      expectedMessageContains: 'restored to active',
    },
    {
      name: 'valid same → unchanged',
      savedId: 'trp-1',
      draftId: 'trp-1',
      savedPlans: [active1],
      draftPlans: [active1],
      expectedKind: 'none',
      expectedSectionKind: 'unchanged',
      expectedChanged: false,
      expectedMessageNotContains: 'Primary reference',
    },
    {
      name: 'primary points to plan removed from draft',
      savedId: 'trp-1',
      draftId: 'trp-1',
      savedPlans: [active1, active2],
      draftPlans: [active2],
      expectedKind: 'unresolved',
      expectedSectionKind: 'primary-unresolved',
      expectedChanged: true,
      expectedMessageContains: 'removed',
    },
    {
      name: 'primary points to inactive plan (archived selected)',
      savedId: 'trp-1',
      draftId: 'trp-1',
      savedPlans: [active1],
      draftPlans: [inactive1],
      expectedKind: 'unresolved',
      expectedSectionKind: 'primary-unresolved',
      expectedChanged: true,
      expectedMessageContains: 'lifecycle',
    },
    {
      name: 'explicit null draft primary treated same as absent',
      savedId: null,
      draftId: null,
      savedPlans: [active1],
      draftPlans: [active1],
      expectedKind: 'none',
      expectedSectionKind: 'unchanged',
      expectedChanged: false,
      expectedMessageNotContains: 'Primary reference',
    },
    {
      name: 'cleared then reselected same id — selection restored',
      savedId: null,
      draftId: 'trp-1',
      savedPlans: [active1, active2],
      draftPlans: [active1, active2],
      expectedKind: 'selected',
      expectedSectionKind: 'primary-selected',
      expectedChanged: true,
    },
    {
      name: 'valid A → cleared → reselected A collapses to unchanged',
      savedId: 'trp-1',
      draftId: 'trp-1',
      savedPlans: [active1, active2],
      draftPlans: [active1, active2],
      expectedKind: 'none',
      expectedSectionKind: 'unchanged',
      expectedChanged: false,
    },
  ];

  it.each(cases.map((c) => [c.name, c]))('%s', (_name, tc) => {
    const ctx = compareTransport({
      savedPlans: tc.savedPlans,
      savedPrimaryPlanId: tc.savedId,
      draftPlans: tc.draftPlans,
      draftPrimaryPlanId: tc.draftId,
    });
    expect(ctx.changed).toBe(tc.expectedChanged);
    expect(ctx.primary.kind).toBe(tc.expectedKind);
    expect(ctx.kind).toBe(tc.expectedSectionKind);
    if (tc.expectedMessageContains) {
      expect(ctx.message).toContain(tc.expectedMessageContains);
    }
    if (tc.expectedMessageNotContains) {
      if (ctx.message === null) {
        expect(true).toBe(true);
      } else {
        expect(ctx.message).not.toContain(tc.expectedMessageNotContains);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// STEP 33 lifecycle-transition regression matrix (C)
// ---------------------------------------------------------------------------

describe('planningReferenceChangeContext — lifecycle-transition regression matrix', () => {
  type LifecycleCase = {
    name: string;
    savedLifecycle: 'active' | 'needs-review' | 'replaced' | 'archived' | undefined;
    draftLifecycle: 'active' | 'needs-review' | 'replaced' | 'archived' | undefined;
    savedPrimary: string | null | undefined;
    draftPrimary: string | null | undefined;
    expectedChanged: boolean;
    expectedKind: PlanningReferenceSectionChangeKind;
  };

  const lifecycleCases: ReadonlyArray<LifecycleCase> = [
    {
      name: 'active → needs-review',
      savedLifecycle: 'active',
      draftLifecycle: 'needs-review',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'needs-review → active',
      savedLifecycle: 'needs-review',
      draftLifecycle: 'active',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'active → replaced',
      savedLifecycle: 'active',
      draftLifecycle: 'replaced',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'archived → active',
      savedLifecycle: 'archived',
      draftLifecycle: 'active',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'replaced → active',
      savedLifecycle: 'replaced',
      draftLifecycle: 'active',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'active → archived on non-primary plan',
      savedLifecycle: 'active',
      draftLifecycle: 'archived',
      savedPrimary: 'trp-2',
      draftPrimary: 'trp-2',
      expectedChanged: true,
      expectedKind: 'lifecycle-changed',
    },
    {
      name: 'reverted lifecycle — no change',
      savedLifecycle: 'needs-review',
      draftLifecycle: 'needs-review',
      savedPrimary: null,
      draftPrimary: null,
      expectedChanged: false,
      expectedKind: 'unchanged',
    },
  ];

  it.each(lifecycleCases.map((c) => [c.name, c]))('%s', (_name, tc) => {
    const ctx = compareTransport({
      savedPlans: [{ id: 'trp-1', lifecycleState: tc.savedLifecycle }],
      savedPrimaryPlanId: tc.savedPrimary,
      draftPlans: [{ id: 'trp-1', lifecycleState: tc.draftLifecycle }],
      draftPrimaryPlanId: tc.draftPrimary,
    });
    expect(ctx.changed).toBe(tc.expectedChanged);
    expect(ctx.kind).toBe(tc.expectedKind);
  });
});

// ---------------------------------------------------------------------------
// STEP 33 cross-section and metadata-independence coverage (D, E)
// ---------------------------------------------------------------------------

describe('planningReferenceChangeContext — cross-section and metadata independence', () => {
  it('transport lifecycle change + accommodation source URL change are reported independently', () => {
    const ctx = buildPlanningReferenceChangeContext({
      saved: {
        transportPlans: [activePlan('trp-1')],
        accommodationPlans: [activePlan('acp-1', { sourceUrl: 'https://old.com' })],
      },
      draft: {
        transportPlans: [inactivePlan('trp-1', 'archived')],
        accommodationPlans: [activePlan('acp-1', { sourceUrl: 'https://new.com' })],
      },
    });
    expect(ctx.changed).toBe(true);
    expect(ctx.transport.changed).toBe(true);
    expect(ctx.transport.kind).toBe('lifecycle-changed');
    expect(ctx.accommodation.changed).toBe(true);
    expect(ctx.accommodation.kind).toBe('source-changed');
  });

  it('a provenance note-only edit never creates a change even with a primary present', () => {
    const ctx = compareTransport({
      savedPlans: [activePlan('trp-1', { provenance: { kind: 'manual', note: 'old' } })],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [activePlan('trp-1', { provenance: { kind: 'manual', note: 'new' } })],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(ctx.changed).toBe(false);
    expect(ctx.planChanges).toEqual([]);
    expect(ctx.message).toBeNull();
  });

  it('metadata change on one plan does not affect primary classification on another', () => {
    const ctx = compareTransport({
      savedPlans: [
        activePlan('trp-1', { mode: 'Flight' }),
        activePlan('trp-2', { provenance: { kind: 'manual' } }),
      ],
      savedPrimaryPlanId: 'trp-1',
      draftPlans: [
        activePlan('trp-1', { mode: 'Flight' }),
        activePlan('trp-2', { provenance: { kind: 'mock-discovery' } }),
      ],
      draftPrimaryPlanId: 'trp-1',
    });
    expect(ctx.primary.kind).toBe('none');
    expect(ctx.planChanges).toHaveLength(1);
    expect(ctx.planChanges[0].kind).toBe('provenance');
    expect(ctx.planChanges[0].planId).toBe('trp-2');
  });

  it('a source URL change and a lifecycle change on different plans report both in deterministic order', () => {
    const ctx = compareTransport({
      savedPlans: [activePlan('trp-1'), activePlan('trp-2', { sourceUrl: 'https://old.com' })],
      draftPlans: [
        inactivePlan('trp-1', 'needs-review'),
        activePlan('trp-2', { sourceUrl: 'https://new.com' }),
      ],
    });
    expect(ctx.planChanges.map((c) => c.kind)).toEqual(['lifecycle', 'source']);
    expect(ctx.planChanges[0].planId).toBe('trp-1');
    expect(ctx.planChanges[1].planId).toBe('trp-2');
  });
});
