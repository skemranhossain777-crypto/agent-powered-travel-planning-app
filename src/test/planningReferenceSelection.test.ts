import { describe, expect, it } from 'vitest';
import type { TripAccommodationPlan, TripTransportPlan } from '../types/trip';
import {
  getPrimarySelectionStatusLabel,
  isPlanEligibleAsPrimary,
  isPrimaryPlanId,
  isPrimarySelectionAttentionState,
  normalizePrimaryPlanId,
  partitionPlanningReferencesWithPrimary,
  resolvePrimarySelection,
} from '../domain/trips/planningReferenceSelection';

function activeTransport(overrides: Partial<TripTransportPlan> = {}): TripTransportPlan {
  return { id: 'trp-1', mode: 'Flight', lifecycleState: 'active', ...overrides };
}

function activeAccommodation(overrides: Partial<TripAccommodationPlan> = {}): TripAccommodationPlan {
  return { id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active', ...overrides };
}

describe('planningReferenceSelection (STEP 26)', () => {
  describe('normalizePrimaryPlanId', () => {
    it('returns a trimmed valid string id', () => {
      expect(normalizePrimaryPlanId('trp-1')).toBe('trp-1');
      expect(normalizePrimaryPlanId('  acp-2  ')).toBe('acp-2');
    });

    it('returns null for non-string values', () => {
      expect(normalizePrimaryPlanId(null)).toBeNull();
      expect(normalizePrimaryPlanId(undefined)).toBeNull();
      expect(normalizePrimaryPlanId(42)).toBeNull();
      expect(normalizePrimaryPlanId(true)).toBeNull();
      expect(normalizePrimaryPlanId({})).toBeNull();
    });

    it('returns null for empty or whitespace-only strings', () => {
      expect(normalizePrimaryPlanId('')).toBeNull();
      expect(normalizePrimaryPlanId('   ')).toBeNull();
    });
  });

  describe('isPrimaryPlanId', () => {
    it('returns true for a non-empty trimmed string', () => {
      expect(isPrimaryPlanId('trp-1')).toBe(true);
      expect(isPrimaryPlanId('  acp-2  ')).toBe(true);
    });

    it('returns false for null, undefined, empty, or non-string', () => {
      expect(isPrimaryPlanId(null)).toBe(false);
      expect(isPrimaryPlanId(undefined)).toBe(false);
      expect(isPrimaryPlanId('')).toBe(false);
      expect(isPrimaryPlanId('   ')).toBe(false);
      expect(isPrimaryPlanId(42)).toBe(false);
    });
  });

  describe('isPlanEligibleAsPrimary', () => {
    it('returns true for an active plan', () => {
      expect(isPlanEligibleAsPrimary(activeTransport())).toBe(true);
    });

    it('returns true for a legacy plan without lifecycle', () => {
      const legacy: TripTransportPlan = { id: 'trp-1', mode: 'Train' };
      expect(isPlanEligibleAsPrimary(legacy)).toBe(true);
    });

    it('returns false for needs-review plans', () => {
      expect(isPlanEligibleAsPrimary(activeTransport({ lifecycleState: 'needs-review' }))).toBe(false);
    });

    it('returns false for replaced plans', () => {
      expect(isPlanEligibleAsPrimary(activeTransport({ lifecycleState: 'replaced' }))).toBe(false);
    });

    it('returns false for archived plans', () => {
      expect(isPlanEligibleAsPrimary(activeTransport({ lifecycleState: 'archived' }))).toBe(false);
    });

    it('is lifecycle-only: an empty id does not make an active plan ineligible', () => {
      const emptyId: TripTransportPlan = { id: '', mode: 'Flight' };
      expect(isPlanEligibleAsPrimary(emptyId)).toBe(true);
    });
  });

  describe('resolvePrimarySelection', () => {
    const transportPlans = [
      activeTransport({ id: 'trp-1' }),
      activeTransport({ id: 'trp-2', mode: 'Train' }),
      activeTransport({ id: 'trp-3', mode: 'Bus', lifecycleState: 'needs-review' }),
      activeTransport({ id: 'trp-4', mode: 'Ferry', lifecycleState: 'replaced' }),
    ];

    it('returns no-explicit-selection when id is undefined', () => {
      const result = resolvePrimarySelection(undefined, transportPlans);
      expect(result.state).toBe('no-explicit-selection');
      expect(result.selectedId).toBeUndefined();
      expect(result.selectedPlan).toBeUndefined();
      expect(result.reason).toBeNull();
    });

    it('returns valid-explicit-selection for a valid active id', () => {
      const result = resolvePrimarySelection('trp-2', transportPlans);
      expect(result.state).toBe('valid-explicit-selection');
      expect(result.selectedId).toBe('trp-2');
      expect(result.selectedPlan).toBe(transportPlans[1]);
      expect(result.inactiveState).toBeUndefined();
    });

    it('returns selected-plan-missing when the id does not match any plan', () => {
      const result = resolvePrimarySelection('trp-missing', transportPlans);
      expect(result.state).toBe('selected-plan-missing');
      expect(result.selectedId).toBe('trp-missing');
      expect(result.selectedPlan).toBeUndefined();
      expect(result.reason).toMatch(/trp-missing/);
      expect(result.reason).toMatch(/missing/);
    });

    it('returns selected-plan-inactive when the referenced plan is not eligible', () => {
      const result = resolvePrimarySelection('trp-3', transportPlans);
      expect(result.state).toBe('selected-plan-inactive');
      expect(result.selectedId).toBe('trp-3');
      expect(result.selectedPlan).toBeUndefined();
      expect(result.inactiveState).toBe('needs-review');
      expect(result.reason).toMatch(/needs.review/);
    });

    it('returns selected-plan-inactive for a replaced plan', () => {
      const result = resolvePrimarySelection('trp-4', transportPlans);
      expect(result.state).toBe('selected-plan-inactive');
      expect(result.inactiveState).toBe('replaced');
    });

    it('resolves a legacy plan without lifecycle as valid', () => {
      const legacyPlans = [{ id: 'trp-1', mode: 'Train' }];
      const result = resolvePrimarySelection('trp-1', legacyPlans);
      expect(result.state).toBe('valid-explicit-selection');
      expect(result.selectedPlan).toBe(legacyPlans[0]);
    });

    it('treats an empty id string as an absent selection', () => {
      const result = resolvePrimarySelection('', transportPlans);
      expect(result.state).toBe('no-explicit-selection');
      expect(result.selectedId).toBeUndefined();
    });
  });

  describe('partitionPlanningReferencesWithPrimary', () => {
    it('puts the valid selected plan first, remaining actives second, needs-review third, and secondary last', () => {
      const plans = [
        activeTransport({ id: 'a', lifecycleState: 'replaced' }),
        activeTransport({ id: 'b' }),
        activeTransport({ id: 'c', lifecycleState: 'needs-review' }),
        activeTransport({ id: 'd' }),
      ];
      const { partition, resolution } = partitionPlanningReferencesWithPrimary(plans, 'd');

      expect(resolution.state).toBe('valid-explicit-selection');
      expect(partition.selected.map((p) => p.id)).toEqual(['d']);
      expect(partition.eligibleActive.map((p) => p.id)).toEqual(['b']);
      expect(partition.needsReview.map((p) => p.id)).toEqual(['c']);
      expect(partition.secondary.map((p) => p.id)).toEqual(['a']);
    });

    it('with no selection, all actives go to eligibleActive in original order', () => {
      const plans = [
        activeTransport({ id: 'a' }),
        activeTransport({ id: 'b', lifecycleState: 'needs-review' }),
        activeTransport({ id: 'c' }),
        activeTransport({ id: 'd', lifecycleState: 'archived' }),
      ];
      const { partition, resolution } = partitionPlanningReferencesWithPrimary(plans, undefined);

      expect(resolution.state).toBe('no-explicit-selection');
      expect(partition.selected).toEqual([]);
      expect(partition.eligibleActive.map((p) => p.id)).toEqual(['a', 'c']);
      expect(partition.needsReview.map((p) => p.id)).toEqual(['b']);
      expect(partition.secondary.map((p) => p.id)).toEqual(['d']);
    });

    it('with an invalid selection, selected is empty and resolution is needs-attention', () => {
      const plans = [
        activeTransport({ id: 'a' }),
        activeTransport({ id: 'b', lifecycleState: 'replaced' }),
      ];
      const { partition, resolution } = partitionPlanningReferencesWithPrimary(plans, 'missing');

      expect(resolution.state).toBe('selected-plan-missing');
      expect(partition.selected).toEqual([]);
      expect(partition.eligibleActive.map((p) => p.id)).toEqual(['a']);
      expect(partition.secondary.map((p) => p.id)).toEqual(['b']);
    });

    it('with an inactive selection, the selected plan stays in its lifecycle group (not duplicated)', () => {
      const plans = [
        activeTransport({ id: 'a' }),
        activeTransport({ id: 'b', lifecycleState: 'archived' }),
      ];
      const { partition, resolution } = partitionPlanningReferencesWithPrimary(plans, 'b');

      expect(resolution.state).toBe('selected-plan-inactive');
      expect(partition.selected).toEqual([]);
      expect(partition.eligibleActive.map((p) => p.id)).toEqual(['a']);
      expect(partition.secondary.map((p) => p.id)).toEqual(['b']);
    });

    it('preserves original order inside each partition group', () => {
      const plans = [
        activeTransport({ id: 'c', lifecycleState: 'needs-review' }),
        activeTransport({ id: 'a' }),
        activeTransport({ id: 'b', lifecycleState: 'archived' }),
        activeTransport({ id: 'd' }),
      ];
      const { partition } = partitionPlanningReferencesWithPrimary(plans, 'd');
      expect(partition.selected.map((p) => p.id)).toEqual(['d']);
      expect(partition.eligibleActive.map((p) => p.id)).toEqual(['a']);
      expect(partition.needsReview.map((p) => p.id)).toEqual(['c']);
      expect(partition.secondary.map((p) => p.id)).toEqual(['b']);
    });

    it('does not mutate the source array or plan objects', () => {
      const planA = activeTransport({ id: 'a' });
      const planB = activeTransport({ id: 'b', lifecycleState: 'replaced' });
      const input = [planA, planB];
      const inputSnapshot = [...input];

      const { partition } = partitionPlanningReferencesWithPrimary(input, 'a');

      expect(input).toEqual(inputSnapshot);
      expect(partition.selected[0]).toBe(planA);
      expect(partition.secondary[0]).toBe(planB);
    });

    it('returns empty groups for an empty input', () => {
      const { partition, resolution } = partitionPlanningReferencesWithPrimary([], undefined);
      expect(partition.selected).toEqual([]);
      expect(partition.eligibleActive).toEqual([]);
      expect(partition.needsReview).toEqual([]);
      expect(partition.secondary).toEqual([]);
      expect(resolution.state).toBe('no-explicit-selection');
    });

    it('supports accommodation plans as well', () => {
      const plans = [
        activeAccommodation({ id: 'a1' }),
        activeAccommodation({ id: 'a2', lifecycleState: 'replaced' }),
      ];
      const { partition } = partitionPlanningReferencesWithPrimary(plans, 'a1');
      expect(partition.selected.map((p) => p.id)).toEqual(['a1']);
      expect(partition.eligibleActive).toEqual([]);
      expect(partition.secondary.map((p) => p.id)).toEqual(['a2']);
    });
  });

  describe('getPrimarySelectionStatusLabel', () => {
    it('returns the correct wording for all four states', () => {
      expect(getPrimarySelectionStatusLabel('no-explicit-selection')).toBe('No primary selected');
      expect(getPrimarySelectionStatusLabel('valid-explicit-selection')).toBe('Primary selected');
      expect(getPrimarySelectionStatusLabel('selected-plan-missing')).toBe(
        'Primary assignment needs attention'
      );
      expect(getPrimarySelectionStatusLabel('selected-plan-inactive')).toBe(
        'Primary assignment needs attention'
      );
    });
  });

  describe('isPrimarySelectionAttentionState', () => {
    it('returns true for missing and inactive states', () => {
      expect(isPrimarySelectionAttentionState('selected-plan-missing')).toBe(true);
      expect(isPrimarySelectionAttentionState('selected-plan-inactive')).toBe(true);
    });

    it('returns false for no-explicit-selection and valid-explicit-selection', () => {
      expect(isPrimarySelectionAttentionState('no-explicit-selection')).toBe(false);
      expect(isPrimarySelectionAttentionState('valid-explicit-selection')).toBe(false);
    });
  });
});
