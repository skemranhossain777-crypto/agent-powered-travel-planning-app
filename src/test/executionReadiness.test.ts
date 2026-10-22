import { describe, expect, it } from 'vitest';
import {
  canUserSetReadinessState,
  getTripExecutionReadinessLabel,
  isExternallyVerifiedState,
  isTripExecutionReadiness,
  isTripExecutionReadinessState,
  normalizeTripExecutionReadiness,
  TRIP_EXECUTION_READINESS_STATES,
} from '../domain/trips/executionReadiness';
import type { TripExecutionRecord } from '../domain/trips/executionReadiness';
import type { TripExecutionReadinessState } from '../types/trip';

describe('STEP 17 execution-readiness vocabulary', () => {
  it('recognizes exactly the five documented readiness states', () => {
    expect(TRIP_EXECUTION_READINESS_STATES).toEqual([
      'planned',
      'user-confirmed',
      'externally-verified',
      'cancelled',
      'unknown',
    ]);
    for (const state of TRIP_EXECUTION_READINESS_STATES) {
      expect(isTripExecutionReadinessState(state)).toBe(true);
    }
    expect(isTripExecutionReadinessState('booked')).toBe(false);
    expect(isTripExecutionReadinessState('confirmed-reservation')).toBe(false);
    expect(isTripExecutionReadinessState('verified-externally')).toBe(false);
    expect(isTripExecutionReadinessState(3)).toBe(false);
    expect(isTripExecutionReadinessState(null)).toBe(false);
    expect(isTripExecutionReadinessState(undefined)).toBe(false);
    expect(isTripExecutionReadinessState({})).toBe(false);
  });

  it('normalizes valid readiness records and trims the optional note', () => {
    expect(normalizeTripExecutionReadiness({ state: 'planned' })).toEqual({ state: 'planned' });
    expect(
      normalizeTripExecutionReadiness({ state: 'user-confirmed', note: '  ABC-123  ' })
    ).toEqual({ state: 'user-confirmed', note: 'ABC-123' });
    expect(normalizeTripExecutionReadiness({ state: 'externally-verified', note: '  ' })).toEqual({
      state: 'externally-verified',
    });
  });

  it('rejects malformed readiness records without throwing', () => {
    expect(normalizeTripExecutionReadiness({ state: 'booked' })).toBeNull();
    expect(normalizeTripExecutionReadiness({ state: 7 })).toBeNull();
    expect(normalizeTripExecutionReadiness({ state: 'planned', note: 7 })).toBeNull();
    expect(normalizeTripExecutionReadiness('planned')).toBeNull();
    expect(normalizeTripExecutionReadiness(true)).toBeNull();
    expect(normalizeTripExecutionReadiness(null)).toBeNull();
    expect(normalizeTripExecutionReadiness(undefined)).toBeNull();
    expect(normalizeTripExecutionReadiness([])).toBeNull();
  });

  it('isTripExecutionReadiness reflects the normalizer', () => {
    expect(isTripExecutionReadiness({ state: 'cancelled' })).toBe(true);
    expect(isTripExecutionReadiness({ state: 'booked' })).toBe(false);
    expect(isTripExecutionReadiness({ state: 'planned', note: 'x' })).toBe(true);
    expect(isTripExecutionReadiness(null)).toBe(false);
  });
});

describe('STEP 17 readiness labels keep planning data honest', () => {
  it('returns the documented read-only labels', () => {
    expect(getTripExecutionReadinessLabel('planned')).toBe('Planned');
    expect(getTripExecutionReadinessLabel('user-confirmed')).toBe('User-entered reference');
    expect(getTripExecutionReadinessLabel('externally-verified')).toBe('Verified externally');
    expect(getTripExecutionReadinessLabel('cancelled')).toBe('Cancelled');
    expect(getTripExecutionReadinessLabel('unknown')).toBe('Unknown or unavailable');
  });

  it('never labels planning data as a booking', () => {
    for (const state of TRIP_EXECUTION_READINESS_STATES) {
      const label = getTripExecutionReadinessLabel(state);
      expect(label.toLowerCase()).not.toMatch(
        /booked|reservation.*confirmed|ticket purchased|ready to execute/
      );
    }
  });
});

describe('STEP 17 verification gating', () => {
  it('only the externally-verified state is external proof', () => {
    expect(isExternallyVerifiedState('externally-verified')).toBe(true);
    expect(isExternallyVerifiedState('user-confirmed')).toBe(false);
    expect(isExternallyVerifiedState('planned')).toBe(false);
  });

  it('the user editor can never produce the externally-verified state', () => {
    for (const state of TRIP_EXECUTION_READINESS_STATES) {
      expect(canUserSetReadinessState(state)).toBe(state !== 'externally-verified');
    }
  });
});

describe('STEP 17/19 draft-only execution-record contracts', () => {
  it('documents the refined provider-independent contract shape without persistence', () => {
    const record: TripExecutionRecord = {
      id: 'exec-1',
      componentId: 'trp-1',
      category: 'transport',
      state: 'user-confirmed',
      verification: [],
      provider: 'SomeRail',
      confirmationReference: 'X-9',
    };
    expect(record.category).toBe('transport');
    expect(record.componentId).toBe('trp-1');
    expect(record.state).toBe('user-confirmed');
    expect(record.verification).toEqual([]);
    expect(isTripExecutionReadinessState(record.state)).toBe(true);
    expect(isExternallyVerifiedState(record.state as TripExecutionReadinessState)).toBe(false);
  });

  it('the enriched vocabulary never collides with the persisted readiness states', () => {
    const booked: TripExecutionRecord = {
      id: 'exec-2',
      componentId: 'trp-2',
      category: 'accommodation',
      state: 'provider-confirmed',
      verification: [],
    };
    expect(booked.state).toBe('provider-confirmed');
    expect(isTripExecutionReadinessState('provider-confirmed')).toBe(false);
    expect(isTripExecutionReadinessState('manually-reviewed')).toBe(false);
  });
});
