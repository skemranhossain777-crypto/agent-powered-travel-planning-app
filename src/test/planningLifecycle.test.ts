import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRIP_PLAN_LIFECYCLE_STATE,
  TRIP_PLAN_LIFECYCLE_STATES,
  getEffectiveTripPlanLifecycleState,
  getTripPlanLifecycleDescription,
  getTripPlanLifecycleLabel,
  isActiveReference,
  isArchivedReference,
  isTripPlanLifecycleState,
  normalizeTripPlanLifecycleState,
  requiresPlanReview,
} from '../domain/trips/planningLifecycle';

describe('STEP 24 lifecycle state vocabulary', () => {
  it('exposes exactly the four recognized states and validates them', () => {
    expect(TRIP_PLAN_LIFECYCLE_STATES).toEqual(['active', 'needs-review', 'replaced', 'archived']);
    for (const state of TRIP_PLAN_LIFECYCLE_STATES) {
      expect(isTripPlanLifecycleState(state)).toBe(true);
    }
    expect(isTripPlanLifecycleState('expired')).toBe(false);
    expect(isTripPlanLifecycleState('outdated')).toBe(false);
    expect(isTripPlanLifecycleState('live')).toBe(false);
    expect(isTripPlanLifecycleState('verified')).toBe(false);
    expect(isTripPlanLifecycleState(42)).toBe(false);
    expect(isTripPlanLifecycleState(null)).toBe(false);
    expect(isTripPlanLifecycleState(undefined)).toBe(false);
  });

  it('normalizes only recognized states and maps nothing to boolean checks', () => {
    expect(normalizeTripPlanLifecycleState('active')).toBe('active');
    expect(normalizeTripPlanLifecycleState('needs-review')).toBe('needs-review');
    expect(normalizeTripPlanLifecycleState('replaced')).toBe('replaced');
    expect(normalizeTripPlanLifecycleState('archived')).toBe('archived');
    expect(normalizeTripPlanLifecycleState('stale')).toBeNull();
    expect(normalizeTripPlanLifecycleState('expired')).toBeNull();
    expect(normalizeTripPlanLifecycleState(1)).toBeNull();
    expect(normalizeTripPlanLifecycleState(undefined)).toBeNull();
    expect(normalizeTripPlanLifecycleState(null)).toBeNull();
  });

  it('treats absent lifecycle as the documented active default', () => {
    expect(DEFAULT_TRIP_PLAN_LIFECYCLE_STATE).toBe('active');
    expect(getEffectiveTripPlanLifecycleState(undefined)).toBe('active');
    expect(getEffectiveTripPlanLifecycleState('needs-review')).toBe('needs-review');
    expect(getEffectiveTripPlanLifecycleState('archived')).toBe('archived');
  });

  it('classifies states precisely with the three predicates', () => {
    expect(isActiveReference('active')).toBe(true);
    expect(isActiveReference('needs-review')).toBe(false);
    expect(isActiveReference('replaced')).toBe(false);
    expect(isActiveReference('archived')).toBe(false);

    expect(requiresPlanReview('needs-review')).toBe(true);
    expect(requiresPlanReview('active')).toBe(false);
    expect(requiresPlanReview('replaced')).toBe(false);
    expect(requiresPlanReview('archived')).toBe(false);

    expect(isArchivedReference('archived')).toBe(true);
    expect(isArchivedReference('active')).toBe(false);
    expect(isArchivedReference('needs-review')).toBe(false);
    expect(isArchivedReference('replaced')).toBe(false);
  });
});

describe('STEP 24 labels and descriptions stay honest and user-controlled', () => {
  it('renders the exact four fixed labels, including the legacy Active default', () => {
    expect(getTripPlanLifecycleLabel('active')).toBe('Active');
    expect(getTripPlanLifecycleLabel('needs-review')).toBe('Needs review');
    expect(getTripPlanLifecycleLabel('replaced')).toBe('Replaced');
    expect(getTripPlanLifecycleLabel('archived')).toBe('Archived');
  });

  it('never claims expiry, provider staleness, price changes, or booking state', () => {
    for (const state of TRIP_PLAN_LIFECYCLE_STATES) {
      const label = getTripPlanLifecycleLabel(state).toLowerCase();
      expect(label).not.toMatch(/expired|expiry/);
      expect(label).not.toMatch(/outdated|stale/);
      expect(label).not.toMatch(/unavailable|price|verified|booking|booked|confirmed/);
    }
  });

  it('describes needs-review as user-marked, never as automatically stale', () => {
    const description = getTripPlanLifecycleDescription('needs-review').toLowerCase();
    expect(description).toContain('review before relying on this reference');
    expect(description).toContain('user-marked');
    expect(description).not.toMatch(/expired|outdated|stale|price|unavailable/);
  });

  it('describes the remaining states without inventing records or deleting data', () => {
    const active = getTripPlanLifecycleDescription('active');
    expect(active.toLowerCase()).toContain('active');
    expect(active.toLowerCase()).not.toMatch(/live|verified|price|booking/);

    const replaced = getTripPlanLifecycleDescription('replaced');
    expect(replaced.toLowerCase()).toContain('superseded by another user-selected reference');
    expect(replaced).not.toContain('replacement found');

    const archived = getTripPlanLifecycleDescription('archived');
    expect(archived.toLowerCase()).toContain('kept for reference but not active');
    expect(archived.toLowerCase()).not.toMatch(/delet|removed|hidden/);
  });
});
