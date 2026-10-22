import { describe, expect, it } from 'vitest';
import type { TripPlanLifecycleState } from '../types/trip';
import {
  countPlanningReferences,
  getEffectivePlanningReferenceState,
  getPlanningReferenceDisplayLabel,
  getPlanningReferenceSummary,
  isArchivedPlanningReference,
  isLegacyPlanningReference,
  isPrimaryPlanningReference,
  isReplacedPlanningReference,
  isSecondaryPlanningReference,
  partitionPlanningReferences,
} from '../domain/trips/planningReferenceProjection';

function plan(overrides: { id?: string; lifecycleState?: TripPlanLifecycleState } = {}): {
  id: string;
  lifecycleState?: TripPlanLifecycleState;
} {
  return { id: 'p1', ...overrides };
}

describe('planningReferenceProjection (STEP 25)', () => {
  describe('legacy records with absent lifecycle', () => {
    it('marks a plan with undefined lifecycle as legacy', () => {
      expect(isLegacyPlanningReference(plan({}))).toBe(true);
      expect(isLegacyPlanningReference(plan({ lifecycleState: 'active' }))).toBe(false);
    });

    it('treats absent lifecycle as active at read time', () => {
      expect(getEffectivePlanningReferenceState(plan({}))).toBe('active');
    });

    it('classifies a legacy plan as primary', () => {
      expect(isPrimaryPlanningReference(plan({}))).toBe(true);
    });
  });

  describe('primary classification', () => {
    it('active plans are primary', () => {
      expect(isPrimaryPlanningReference(plan({ lifecycleState: 'active' }))).toBe(true);
    });

    it('needs-review plans are primary (visibly marked, not hidden)', () => {
      expect(isPrimaryPlanningReference(plan({ lifecycleState: 'needs-review' }))).toBe(true);
    });

    it('replaced plans are not primary', () => {
      expect(isPrimaryPlanningReference(plan({ lifecycleState: 'replaced' }))).toBe(false);
    });

    it('archived plans are not primary', () => {
      expect(isPrimaryPlanningReference(plan({ lifecycleState: 'archived' }))).toBe(false);
    });
  });

  describe('secondary classification', () => {
    it('replaced plans are secondary', () => {
      expect(isSecondaryPlanningReference(plan({ lifecycleState: 'replaced' }))).toBe(true);
    });

    it('archived plans are secondary', () => {
      expect(isSecondaryPlanningReference(plan({ lifecycleState: 'archived' }))).toBe(true);
    });

    it('active plans are not secondary', () => {
      expect(isSecondaryPlanningReference(plan({ lifecycleState: 'active' }))).toBe(false);
    });

    it('needs-review plans are not secondary', () => {
      expect(isSecondaryPlanningReference(plan({ lifecycleState: 'needs-review' }))).toBe(false);
    });
  });

  describe('single-state predicates', () => {
    it('identifies replaced plans', () => {
      expect(isReplacedPlanningReference(plan({ lifecycleState: 'replaced' }))).toBe(true);
      expect(isReplacedPlanningReference(plan({ lifecycleState: 'active' }))).toBe(false);
    });

    it('identifies archived plans', () => {
      expect(isArchivedPlanningReference(plan({ lifecycleState: 'archived' }))).toBe(true);
      expect(isArchivedPlanningReference(plan({ lifecycleState: 'replaced' }))).toBe(false);
    });
  });

  describe('stable ordering and non-mutation', () => {
    it('preserves original order inside each partition group', () => {
      const input = [
        plan({ id: 'a', lifecycleState: 'archived' }),
        plan({ id: 'b', lifecycleState: 'active' }),
        plan({ id: 'c', lifecycleState: 'needs-review' }),
        plan({ id: 'd', lifecycleState: 'replaced' }),
      ];

      const { primary, secondary } = partitionPlanningReferences(input);

      expect(primary.map((p) => p.id)).toEqual(['b', 'c']);
      expect(secondary.map((p) => p.id)).toEqual(['a', 'd']);
    });

    it('does not mutate the source array or plan objects', () => {
      const p1 = plan({ id: 'a', lifecycleState: 'replaced' });
      const p2 = plan({ id: 'b', lifecycleState: 'active' });
      const input = [p1, p2];
      const inputBefore = [...input];

      const { primary, secondary } = partitionPlanningReferences(input);

      expect(input).toEqual(inputBefore);
      expect(primary[0]).toBe(p2);
      expect(secondary[0]).toBe(p1);
    });
  });

  describe('empty collections', () => {
    it('partition returns empty groups for an empty input', () => {
      const { primary, secondary } = partitionPlanningReferences([]);
      expect(primary).toEqual([]);
      expect(secondary).toEqual([]);
    });

    it('counts all zeros for an empty input', () => {
      const counts = countPlanningReferences([]);
      expect(counts).toEqual({
        active: 0,
        needsReview: 0,
        replaced: 0,
        archived: 0,
        secondary: 0,
        total: 0,
      });
    });
  });

  describe('deterministic counts', () => {
    it('breaks down counts by lifecycle state including legacy resolution', () => {
      const input = [
        plan({}), // legacy → active
        plan({ lifecycleState: 'active' }),
        plan({ lifecycleState: 'needs-review' }),
        plan({ lifecycleState: 'needs-review' }),
        plan({ lifecycleState: 'replaced' }),
        plan({ lifecycleState: 'archived' }),
      ];

      const counts = countPlanningReferences(input);
      expect(counts.active).toBe(2);
      expect(counts.needsReview).toBe(2);
      expect(counts.replaced).toBe(1);
      expect(counts.archived).toBe(1);
      expect(counts.secondary).toBe(2);
      expect(counts.total).toBe(6);
    });
  });

  describe('no provenance-based lifecycle inference', () => {
    it('does not treat a plan with provenance but no lifecycle as secondary', () => {
      const p = plan({}); // no lifecycleState, but in a real plan would have provenance
      expect(isPrimaryPlanningReference(p)).toBe(true);
      expect(isSecondaryPlanningReference(p)).toBe(false);
    });
  });

  describe('display labels', () => {
    it('returns the correct wording for each lifecycle state', () => {
      expect(getPlanningReferenceDisplayLabel(plan({}))).toBe(
        'Legacy reference — treated as active'
      );
      expect(getPlanningReferenceDisplayLabel(plan({ lifecycleState: 'active' }))).toBe('Active');
      expect(getPlanningReferenceDisplayLabel(plan({ lifecycleState: 'needs-review' }))).toBe(
        'Needs review'
      );
      expect(getPlanningReferenceDisplayLabel(plan({ lifecycleState: 'replaced' }))).toBe(
        'Replaced reference'
      );
      expect(getPlanningReferenceDisplayLabel(plan({ lifecycleState: 'archived' }))).toBe(
        'Archived reference'
      );
    });
  });

  describe('summary label', () => {
    it('returns a deterministic one-line summary of the reference counts', () => {
      const input = [
        plan({ lifecycleState: 'active' }),
        plan({ lifecycleState: 'active' }),
        plan({ lifecycleState: 'needs-review' }),
        plan({ lifecycleState: 'archived' }),
      ];
      expect(getPlanningReferenceSummary(input)).toBe('2 active · 1 needs review · 1 archived');
    });

    it('returns a safe fallback for an empty list', () => {
      expect(getPlanningReferenceSummary([])).toBe('No references');
    });
  });
});
