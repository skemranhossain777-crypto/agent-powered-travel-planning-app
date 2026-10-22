import { describe, expect, it } from 'vitest';
import {
  classifyPrimaryResolutionDecision,
  type PrimaryResolutionAction,
  type PrimaryResolutionClassificationInput,
  clearingPrimaryResolvesConflict,
  doesActionResolveInactivePrimary,
  doesActionResolveMissingPrimary,
  getPrimaryResolutionDecisionDescription,
  getPrimaryResolutionDecisionLabel,
  isPrimaryConflictUnresolved,
  isPrimaryResolutionDecisionCompatible,
  restoringSelectedPlanResolvesConflict,
  selectingAnotherActivePlanResolvesConflict,
} from '../domain/trips/planningReferenceResolution';

function activePlan(id: string) {
  return { id, lifecycleState: 'active' as const };
}

function inactivePlan(id: string, state: 'needs-review' | 'replaced' | 'archived' = 'archived') {
  return { id, lifecycleState: state };
}

function input(
  overrides: Partial<PrimaryResolutionClassificationInput> & {
    action: PrimaryResolutionAction;
  }
): PrimaryResolutionClassificationInput {
  return {
    priorStatus: 'valid',
    priorSelectedId: null,
    plans: [],
    ...overrides,
  };
}

describe('planningReferenceResolution vocabulary', () => {
  it('defines exactly four resolution decisions', () => {
    const decisions = ['unresolved', 'selected-another', 'cleared', 'restored-selected'] as const;
    for (const d of decisions) {
      expect(typeof d).toBe('string');
      expect(getPrimaryResolutionDecisionLabel(d)).toBeTruthy();
      expect(getPrimaryResolutionDecisionDescription(d)).toBeTruthy();
    }
  });

  it('labels describe planning actions, never booking or verification', () => {
    const labels = [
      getPrimaryResolutionDecisionLabel('unresolved'),
      getPrimaryResolutionDecisionLabel('selected-another'),
      getPrimaryResolutionDecisionLabel('cleared'),
      getPrimaryResolutionDecisionLabel('restored-selected'),
    ];
    for (const label of labels) {
      expect(label.toLowerCase()).not.toMatch(
        /booking|reservation|payment|available|verified|confirmed/
      );
    }
  });

  it('description for unresolved always indicates the conflict persists', () => {
    expect(getPrimaryResolutionDecisionDescription('unresolved')).toMatch(/conflict/);
  });
});

describe('isPrimaryConflictUnresolved', () => {
  it('missing is unresolved', () => {
    expect(isPrimaryConflictUnresolved('missing')).toBe(true);
  });

  it('inactive is unresolved', () => {
    expect(isPrimaryConflictUnresolved('inactive')).toBe(true);
  });

  it('valid is not unresolved', () => {
    expect(isPrimaryConflictUnresolved('valid')).toBe(false);
  });

  it('none is not unresolved', () => {
    expect(isPrimaryConflictUnresolved('none')).toBe(false);
  });
});

describe('classifyPrimaryResolutionDecision — clear', () => {
  it('clear resolves a missing conflict', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({ priorStatus: 'missing', priorSelectedId: 'trp-1', action: { type: 'clear' } })
    );
    expect(outcome.decision).toBe('cleared');
    expect(outcome.resolved).toBe(true);
  });

  it('clear resolves an inactive conflict', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({ priorStatus: 'inactive', priorSelectedId: 'trp-1', action: { type: 'clear' } })
    );
    expect(outcome.decision).toBe('cleared');
    expect(outcome.resolved).toBe(true);
  });

  it('clear on a valid selection resolves=false (no conflict existed)', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({ priorStatus: 'valid', priorSelectedId: 'trp-1', action: { type: 'clear' } })
    );
    expect(outcome.decision).toBe('cleared');
    expect(outcome.resolved).toBe(false);
  });

  it('clear on none returns unresolved (nothing to clear)', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({ priorStatus: 'none', action: { type: 'clear' } })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });
});

describe('classifyPrimaryResolutionDecision — select', () => {
  it('selecting another active plan resolves a missing conflict', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'missing',
        priorSelectedId: 'trp-missing',
        action: { type: 'select', selectedId: 'trp-2' },
        plans: [activePlan('trp-2')],
      })
    );
    expect(outcome.decision).toBe('selected-another');
    expect(outcome.resolved).toBe(true);
  });

  it('selecting another active plan resolves an inactive conflict', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-1',
        action: { type: 'select', selectedId: 'trp-2' },
        plans: [inactivePlan('trp-1'), activePlan('trp-2')],
      })
    );
    expect(outcome.decision).toBe('selected-another');
    expect(outcome.resolved).toBe(true);
  });

  it('selecting the same plan when valid returns unresolved (no conflict)', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'valid',
        priorSelectedId: 'trp-1',
        action: { type: 'select', selectedId: 'trp-1' },
        plans: [activePlan('trp-1')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('selecting a different plan when valid returns unresolved (no conflict existed)', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'valid',
        priorSelectedId: 'trp-1',
        action: { type: 'select', selectedId: 'trp-2' },
        plans: [activePlan('trp-1'), activePlan('trp-2')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('selecting the first plan when no prior selection exists returns unresolved (no conflict)', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'none',
        action: { type: 'select', selectedId: 'trp-1' },
        plans: [activePlan('trp-1')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('selecting an inactive plan is rejected as unresolved', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'missing',
        priorSelectedId: 'trp-missing',
        action: { type: 'select', selectedId: 'trp-1' },
        plans: [inactivePlan('trp-1', 'archived')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('selecting a nonexistent plan is rejected as unresolved', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'missing',
        priorSelectedId: 'trp-missing',
        action: { type: 'select', selectedId: 'trp-ghost' },
        plans: [],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });
});

describe('classifyPrimaryResolutionDecision — restore', () => {
  it('restoring the selected inactive plan resolves the conflict', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-1',
        action: { type: 'restore', planId: 'trp-1' },
        plans: [activePlan('trp-1')],
      })
    );
    expect(outcome.decision).toBe('restored-selected');
    expect(outcome.resolved).toBe(true);
  });

  it('restoring a plan that is not the selected plan is rejected', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-2',
        action: { type: 'restore', planId: 'trp-1' },
        plans: [activePlan('trp-1'), inactivePlan('trp-2', 'archived')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('restoring the selected plan when status is not inactive is rejected', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'valid',
        priorSelectedId: 'trp-1',
        action: { type: 'restore', planId: 'trp-1' },
        plans: [activePlan('trp-1')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });

  it('restoring the selected plan when status is missing is rejected', () => {
    const outcome = classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'missing',
        priorSelectedId: 'trp-1',
        action: { type: 'restore', planId: 'trp-1' },
        plans: [activePlan('trp-1')],
      })
    );
    expect(outcome.decision).toBe('unresolved');
    expect(outcome.resolved).toBe(false);
  });
});

describe('section 2 — resolving helpers', () => {
  it('doesActionResolveMissingPrimary returns true for a clear action on a missing status', () => {
    expect(
      doesActionResolveMissingPrimary(
        input({ priorStatus: 'missing', priorSelectedId: 'trp-1', action: { type: 'clear' } })
      )
    ).toBe(true);
  });

  it('doesActionResolveMissingPrimary returns false for a select action on valid status', () => {
    expect(
      doesActionResolveMissingPrimary(
        input({
          priorStatus: 'valid',
          priorSelectedId: 'trp-1',
          action: { type: 'select', selectedId: 'trp-2' },
          plans: [activePlan('trp-1'), activePlan('trp-2')],
        })
      )
    ).toBe(false);
  });

  it('doesActionResolveInactivePrimary returns true for restoring the selected plan', () => {
    expect(
      doesActionResolveInactivePrimary(
        input({
          priorStatus: 'inactive',
          priorSelectedId: 'trp-1',
          action: { type: 'restore', planId: 'trp-1' },
          plans: [activePlan('trp-1')],
        })
      )
    ).toBe(true);
  });

  it('doesActionResolveInactivePrimary returns false for a no-op', () => {
    expect(
      doesActionResolveInactivePrimary(
        input({ priorStatus: 'inactive', priorSelectedId: 'trp-1', action: { type: 'clear' } })
      )
    ).toBe(true);
  });

  it('selectingAnotherActivePlanResolvesConflict is true when status is conflict and plan differs', () => {
    expect(
      selectingAnotherActivePlanResolvesConflict({
        priorStatus: 'missing',
        priorSelectedId: 'trp-missing',
        selectedId: 'trp-2',
        plans: [activePlan('trp-2')],
      })
    ).toBe(true);
  });

  it('selectingAnotherActivePlanResolvesConflict is false when plan id equals prior id', () => {
    expect(
      selectingAnotherActivePlanResolvesConflict({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-1',
        selectedId: 'trp-1',
        plans: [activePlan('trp-1')],
      })
    ).toBe(false);
  });

  it('clearingPrimaryResolvesConflict is true for missing', () => {
    expect(clearingPrimaryResolvesConflict('missing')).toBe(true);
  });

  it('clearingPrimaryResolvesConflict is true for inactive', () => {
    expect(clearingPrimaryResolvesConflict('inactive')).toBe(true);
  });

  it('clearingPrimaryResolvesConflict is false for none', () => {
    expect(clearingPrimaryResolvesConflict('none')).toBe(false);
  });

  it('restoringSelectedPlanResolvesConflict is true for inactive status with matching planId', () => {
    expect(
      restoringSelectedPlanResolvesConflict({
        planId: 'trp-1',
        priorStatus: 'inactive',
        priorSelectedId: 'trp-1',
        plans: [activePlan('trp-1')],
      })
    ).toBe(true);
  });

  it('restoringSelectedPlanResolvesConflict is false when status is valid', () => {
    expect(
      restoringSelectedPlanResolvesConflict({
        planId: 'trp-1',
        priorStatus: 'valid',
        priorSelectedId: 'trp-1',
        plans: [activePlan('trp-1')],
      })
    ).toBe(false);
  });
});

describe('isPrimaryResolutionDecisionCompatible', () => {
  it('cleared is compatible when no plan is selected', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('cleared', {
        status: 'none',
        selectedId: null,
        activePlanIds: [],
      })
    ).toBe(true);
  });

  it('cleared is incompatible when a valid plan is selected', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('cleared', {
        status: 'valid',
        selectedId: 'trp-1',
        activePlanIds: ['trp-1'],
      })
    ).toBe(false);
  });

  it('selected-another is compatible when status is valid', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('selected-another', {
        status: 'valid',
        selectedId: 'trp-2',
        activePlanIds: ['trp-2'],
      })
    ).toBe(true);
  });

  it('selected-another is incompatible when status is missing', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('selected-another', {
        status: 'missing',
        selectedId: 'trp-missing',
        activePlanIds: [],
      })
    ).toBe(false);
  });

  it('restored-selected is compatible when valid', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('restored-selected', {
        status: 'valid',
        selectedId: 'trp-1',
        activePlanIds: ['trp-1'],
      })
    ).toBe(true);
  });

  it('restored-selected is incompatible when still inactive', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('restored-selected', {
        status: 'inactive',
        selectedId: 'trp-1',
        activePlanIds: [],
      })
    ).toBe(false);
  });

  it('unresolved is compatible when conflict persists', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('unresolved', {
        status: 'inactive',
        selectedId: 'trp-1',
        activePlanIds: [],
      })
    ).toBe(true);
  });

  it('unresolved is incompatible when there is no conflict', () => {
    expect(
      isPrimaryResolutionDecisionCompatible('unresolved', {
        status: 'valid',
        selectedId: 'trp-1',
        activePlanIds: ['trp-1'],
      })
    ).toBe(false);
  });
});

describe('non-mutation and safety', () => {
  it('classify does not modify input plan objects', () => {
    const plan = activePlan('trp-1');
    const originalPlan = { ...plan };
    classifyPrimaryResolutionDecision(
      input({
        priorStatus: 'inactive',
        priorSelectedId: 'trp-1',
        action: { type: 'restore', planId: 'trp-1' },
        plans: [plan],
      })
    );
    expect(plan).toEqual(originalPlan);
  });

  it('labels never mention availability, payment, or verification', () => {
    const allDecisions = [
      'unresolved',
      'selected-another',
      'cleared',
      'restored-selected',
    ] as const;
    for (const d of allDecisions) {
      const label = getPrimaryResolutionDecisionLabel(d);
      const desc = getPrimaryResolutionDecisionDescription(d);
      expect(label.toLowerCase()).not.toMatch(
        /available|guaranteed|booked|paid|verified|confirmed/
      );
      expect(desc.toLowerCase()).not.toMatch(/available|guaranteed|booked|paid|verified|confirmed/);
    }
  });
});
