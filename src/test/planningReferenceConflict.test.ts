import { describe, expect, it } from 'vitest';
import type { TripAccommodationPlan, TripPlanningData, TripTransportPlan } from '../types/trip';
import {
  doesLifecycleTransitionCreatePrimaryConflict,
  doesLifecycleTransitionResolvePrimaryConflict,
  getPrimaryAssignmentConflictDetail,
  getPrimaryAssignmentStatusLabel,
  isPlanSelectableAsPrimary,
  isPrimaryAssignmentAttentionNeeded,
  resolveAccommodationPrimaryAssignmentStatus,
  resolvePrimaryAssignmentStatus,
  resolveTransportPrimaryAssignmentStatus,
} from '../domain/trips/planningReferenceConflict';
import { resolvePrimarySelection } from '../domain/trips/planningReferenceSelection';

function activeTransport(overrides: Partial<TripTransportPlan> = {}): TripTransportPlan {
  return { id: 'trp-1', mode: 'Flight', lifecycleState: 'active', ...overrides };
}

function activeAccommodation(
  overrides: Partial<TripAccommodationPlan> = {}
): TripAccommodationPlan {
  return { id: 'acp-1', name: 'Padi Hotel', lifecycleState: 'active', ...overrides };
}

function planningData(overrides: Partial<TripPlanningData> = {}): TripPlanningData {
  return {
    destinations: [],
    days: [],
    transportation: [],
    accommodation: [],
    transportPlans: [],
    accommodationPlans: [],
    notes: [],
    references: [],
    ...overrides,
  };
}

describe('planningReferenceConflict (STEP 27)', () => {
  describe('resolvePrimaryAssignmentStatus', () => {
    it('returns none when there is no explicit selection', () => {
      expect(resolvePrimaryAssignmentStatus(undefined, [activeTransport()])).toBe('none');
      expect(resolvePrimaryAssignmentStatus('', [activeTransport()])).toBe('none');
    });

    it('returns none for a valid-but-whitespace-only selection id', () => {
      expect(resolvePrimaryAssignmentStatus('   ', [activeTransport()])).toBe('none');
    });

    it('returns none when the section is empty', () => {
      expect(resolvePrimaryAssignmentStatus('trp-1', [])).toBe('missing');
      expect(resolvePrimaryAssignmentStatus(undefined, [])).toBe('none');
    });

    it('returns valid for an effective-active selected plan', () => {
      expect(resolvePrimaryAssignmentStatus('trp-1', [activeTransport()])).toBe('valid');
    });

    it('returns valid for a legacy selected plan without lifecycle metadata', () => {
      const legacy: TripTransportPlan = { id: 'trp-1', mode: 'Train' };
      expect(resolvePrimaryAssignmentStatus('trp-1', [legacy])).toBe('valid');
    });

    it('returns missing when the selected id resolves to no plan in the section', () => {
      expect(resolvePrimaryAssignmentStatus('ghost-1', [activeTransport({ id: 'trp-2' })])).toBe(
        'missing'
      );
    });

    it('returns inactive for a needs-review selected plan', () => {
      expect(
        resolvePrimaryAssignmentStatus('trp-1', [
          activeTransport({ lifecycleState: 'needs-review' }),
        ])
      ).toBe('inactive');
    });

    it('returns inactive for a replaced selected plan', () => {
      expect(
        resolvePrimaryAssignmentStatus('trp-1', [activeTransport({ lifecycleState: 'replaced' })])
      ).toBe('inactive');
    });

    it('returns inactive for an archived selected plan', () => {
      expect(
        resolvePrimaryAssignmentStatus('trp-1', [activeTransport({ lifecycleState: 'archived' })])
      ).toBe('inactive');
    });

    it('accepts accommodation plans', () => {
      expect(resolvePrimaryAssignmentStatus('acp-1', [activeAccommodation()])).toBe('valid');
      expect(
        resolvePrimaryAssignmentStatus('acp-1', [
          activeAccommodation({ lifecycleState: 'replaced' }),
        ])
      ).toBe('inactive');
    });
  });

  describe('resolveTransportPrimaryAssignmentStatus / resolveAccommodationPrimaryAssignmentStatus', () => {
    it('resolves the transport section from the planning projection', () => {
      expect(
        resolveTransportPrimaryAssignmentStatus(
          planningData({
            transportPlans: [activeTransport(), activeTransport({ id: 'trp-2' })],
            primaryTransportPlanId: 'trp-1',
          })
        )
      ).toBe('valid');
      expect(
        resolveTransportPrimaryAssignmentStatus(
          planningData({ transportPlans: [activeTransport()] })
        )
      ).toBe('none');
      expect(
        resolveTransportPrimaryAssignmentStatus(
          planningData({ transportPlans: [activeTransport()], primaryTransportPlanId: 'ghost' })
        )
      ).toBe('missing');
      expect(
        resolveTransportPrimaryAssignmentStatus(
          planningData({
            transportPlans: [activeTransport({ lifecycleState: 'archived' })],
            primaryTransportPlanId: 'trp-1',
          })
        )
      ).toBe('inactive');
    });

    it('resolves the accommodation section from the planning projection', () => {
      expect(
        resolveAccommodationPrimaryAssignmentStatus(
          planningData({
            accommodationPlans: [activeAccommodation()],
            primaryAccommodationPlanId: 'acp-1',
          })
        )
      ).toBe('valid');
      expect(
        resolveAccommodationPrimaryAssignmentStatus(
          planningData({ accommodationPlans: [activeAccommodation()] })
        )
      ).toBe('none');
      expect(
        resolveAccommodationPrimaryAssignmentStatus(
          planningData({
            accommodationPlans: [activeAccommodation()],
            primaryAccommodationPlanId: 'ghost',
          })
        )
      ).toBe('missing');
      expect(
        resolveAccommodationPrimaryAssignmentStatus(
          planningData({
            accommodationPlans: [activeAccommodation({ lifecycleState: 'needs-review' })],
            primaryAccommodationPlanId: 'acp-1',
          })
        )
      ).toBe('inactive');
    });

    it('keeps transport and accommodation sections independent', () => {
      const data = planningData({
        transportPlans: [activeTransport()],
        accommodationPlans: [activeAccommodation()],
        primaryTransportPlanId: 'trp-1',
      });
      expect(resolveTransportPrimaryAssignmentStatus(data)).toBe('valid');
      expect(resolveAccommodationPrimaryAssignmentStatus(data)).toBe('none');
    });
  });

  describe('isPrimaryAssignmentAttentionNeeded', () => {
    it('is false when there is no conflict to resolve', () => {
      expect(isPrimaryAssignmentAttentionNeeded('none')).toBe(false);
      expect(isPrimaryAssignmentAttentionNeeded('valid')).toBe(false);
    });

    it('is true for missing and inactive selections', () => {
      expect(isPrimaryAssignmentAttentionNeeded('missing')).toBe(true);
      expect(isPrimaryAssignmentAttentionNeeded('inactive')).toBe(true);
    });
  });

  describe('getPrimaryAssignmentStatusLabel', () => {
    it('produces honest labels for all four states', () => {
      expect(getPrimaryAssignmentStatusLabel('none')).toBe('No primary reference selected');
      expect(getPrimaryAssignmentStatusLabel('valid')).toBe('Primary reference selected');
      expect(getPrimaryAssignmentStatusLabel('missing')).toBe('Primary assignment needs attention');
      expect(getPrimaryAssignmentStatusLabel('inactive')).toBe(
        'Primary assignment needs attention'
      );
    });
  });

  describe('getPrimaryAssignmentConflictDetail', () => {
    const plans = [activeTransport()];

    it('returns null when there is no conflict', () => {
      expect(
        getPrimaryAssignmentConflictDetail(resolvePrimarySelection(undefined, plans))
      ).toBeNull();
      expect(
        getPrimaryAssignmentConflictDetail(resolvePrimarySelection('trp-1', plans))
      ).toBeNull();
    });

    it('describes a missing selection with guidance', () => {
      const resolution = resolvePrimarySelection('ghost-1', [activeTransport({ id: 'trp-2' })]);
      const detail = getPrimaryAssignmentConflictDetail(resolution);
      expect(detail).toContain('ghost-1');
      expect(detail).toContain('no longer present');
      expect(detail).toContain('Choose an active reference');
      expect(detail).toContain('clear the assignment');
    });

    it('describes an inactive selection with its actual lifecycle and guidance', () => {
      const resolution = resolvePrimarySelection('trp-1', [
        activeTransport({ lifecycleState: 'archived' }),
      ]);
      const detail = getPrimaryAssignmentConflictDetail(resolution);
      expect(detail).toContain('archived');
      expect(detail).toContain('no longer eligible');
      expect(detail).toContain('Restore this plan to Active');
      expect(detail).toContain('clear the assignment');
    });

    it('describes a needs-review selection honestly', () => {
      const resolution = resolvePrimarySelection('trp-1', [
        activeTransport({ lifecycleState: 'needs-review' }),
      ]);
      expect(getPrimaryAssignmentConflictDetail(resolution)).toContain('needs review');
    });
  });

  describe('isPlanSelectableAsPrimary', () => {
    it('composes with the STEP 26 eligibility rule', () => {
      expect(isPlanSelectableAsPrimary(activeTransport())).toBe(true);
      const legacy: TripTransportPlan = { id: 'trp-1', mode: 'Train' };
      expect(isPlanSelectableAsPrimary(legacy)).toBe(true);
      expect(isPlanSelectableAsPrimary(activeTransport({ lifecycleState: 'needs-review' }))).toBe(
        false
      );
      expect(isPlanSelectableAsPrimary(activeTransport({ lifecycleState: 'replaced' }))).toBe(
        false
      );
      expect(isPlanSelectableAsPrimary(activeTransport({ lifecycleState: 'archived' }))).toBe(
        false
      );
    });
  });

  describe('doesLifecycleTransitionCreatePrimaryConflict', () => {
    const plans = [activeTransport(), activeTransport({ id: 'trp-2' })];

    it('flags a transition of the valid selected plan away from active', () => {
      const resolution = resolvePrimarySelection('trp-1', plans);
      expect(
        doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'needs-review')
      ).toBe(true);
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'replaced')).toBe(
        true
      );
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'archived')).toBe(
        true
      );
    });

    it('is false when the selected plan stays active', () => {
      const resolution = resolvePrimarySelection('trp-1', plans);
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'active')).toBe(
        false
      );
    });

    it('is false when the target plan is not the selected plan', () => {
      const resolution = resolvePrimarySelection('trp-1', plans);
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-2', 'archived')).toBe(
        false
      );
    });

    it('keeps an already-inactive selection flagged while it stays non-active', () => {
      const resolution = resolvePrimarySelection('trp-1', [
        activeTransport({ lifecycleState: 'replaced' }),
      ]);
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'archived')).toBe(
        true
      );
      expect(
        doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'needs-review')
      ).toBe(true);
    });

    it('is false for a transition that restores the inactive selection to active', () => {
      const resolution = resolvePrimarySelection('trp-1', [
        activeTransport({ lifecycleState: 'replaced' }),
      ]);
      expect(doesLifecycleTransitionCreatePrimaryConflict(resolution, 'trp-1', 'active')).toBe(
        false
      );
    });

    it('is false for none and missing resolutions', () => {
      const none = resolvePrimarySelection(undefined, plans);
      const missing = resolvePrimarySelection('ghost-1', plans);
      expect(doesLifecycleTransitionCreatePrimaryConflict(none, 'trp-1', 'archived')).toBe(false);
      expect(doesLifecycleTransitionCreatePrimaryConflict(missing, 'trp-1', 'archived')).toBe(
        false
      );
    });
  });

  describe('doesLifecycleTransitionResolvePrimaryConflict', () => {
    const plans = [activeTransport(), activeTransport({ id: 'trp-2' })];

    it('is true only when the inactive selected plan is restored to active', () => {
      const resolution = resolvePrimarySelection('trp-1', [
        activeTransport({ lifecycleState: 'archived' }),
      ]);
      expect(doesLifecycleTransitionResolvePrimaryConflict(resolution, 'trp-1', 'active')).toBe(
        true
      );
      expect(
        doesLifecycleTransitionResolvePrimaryConflict(resolution, 'trp-1', 'needs-review')
      ).toBe(false);
      expect(doesLifecycleTransitionResolvePrimaryConflict(resolution, 'trp-2', 'active')).toBe(
        false
      );
    });

    it('is false for a valid, none, or missing selection', () => {
      const valid = resolvePrimarySelection('trp-1', plans);
      const none = resolvePrimarySelection(undefined, plans);
      const missing = resolvePrimarySelection('ghost-1', plans);
      expect(doesLifecycleTransitionResolvePrimaryConflict(valid, 'trp-1', 'active')).toBe(false);
      expect(doesLifecycleTransitionResolvePrimaryConflict(none, 'trp-1', 'active')).toBe(false);
      expect(doesLifecycleTransitionResolvePrimaryConflict(missing, 'trp-1', 'active')).toBe(false);
    });
  });

  describe('pure read-only behavior', () => {
    it('never mutates input arrays or plan objects', () => {
      const trp = activeTransport();
      const acp = activeAccommodation();
      const transportPlans: TripTransportPlan[] = [trp, { ...trp, id: 'trp-2' }];
      const accommodationPlans: TripAccommodationPlan[] = [acp];
      const sourcePlans = [...transportPlans];

      const data = planningData({
        transportPlans,
        accommodationPlans,
        primaryTransportPlanId: 'trp-1',
        primaryAccommodationPlanId: 'missing-acp',
      });

      const statusBefore = resolvePrimaryAssignmentStatus('trp-1', transportPlans);
      resolveTransportPrimaryAssignmentStatus(data);
      resolveAccommodationPrimaryAssignmentStatus(data);

      expect(resolvePrimaryAssignmentStatus('trp-1', transportPlans)).toBe(statusBefore);
      expect(transportPlans).toEqual(sourcePlans);
      expect(transportPlans[0]).toBe(trp);
      expect(data.primaryTransportPlanId).toBe('trp-1');
      expect(data.primaryAccommodationPlanId).toBe('missing-acp');
    });

    it('never generates a fallback primary or silently clears a stored id', () => {
      const plans = [
        activeTransport({ id: 'trp-1', lifecycleState: 'archived' }),
        activeTransport({ id: 'trp-2' }),
      ];
      expect(resolvePrimaryAssignmentStatus('trp-1', plans)).toBe('inactive');
      // The active fallback plan is never promoted into a valid selection.
      expect(resolvePrimaryAssignmentStatus('trp-1', plans)).not.toBe('valid');
    });
  });
});
