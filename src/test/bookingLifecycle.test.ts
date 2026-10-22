import { describe, expect, it } from 'vitest';
import {
  canBookingTransitionAutomatically,
  canProviderMarkBookingConfirmed,
  canTransitionBookingLifecycleState,
  getAllowedBookingLifecycleTransitions,
  getBookingLifecycleTransitionProblem,
  getTripBookingLifecycleStateLabel,
  isBookingLifecycleFailureState,
  isBookingLifecycleSuccessState,
  isTripBookingLifecycleState,
  requiresUserApprovalBeforeSubmission,
  TRIP_BOOKING_LIFECYCLE_STATES,
} from '../domain/providers/bookingLifecycle';

describe('STEP 20 booking lifecycle vocabulary', () => {
  it('recognizes exactly the nine documented lifecycle states', () => {
    expect(TRIP_BOOKING_LIFECYCLE_STATES).toEqual([
      'not_started',
      'draft',
      'awaiting_user_approval',
      'submitted',
      'provider_pending',
      'provider_confirmed',
      'failed',
      'cancelled',
      'unknown',
    ]);
    for (const state of TRIP_BOOKING_LIFECYCLE_STATES) {
      expect(isTripBookingLifecycleState(state)).toBe(true);
    }
    for (const junk of ['booked', 'paid', 'confirmed', 3, null, {}]) {
      expect(isTripBookingLifecycleState(junk)).toBe(false);
    }
  });

  it('only provider_confirmed counts as success; failed is a real failure', () => {
    for (const state of TRIP_BOOKING_LIFECYCLE_STATES) {
      expect(isBookingLifecycleSuccessState(state)).toBe(state === 'provider_confirmed');
      expect(isBookingLifecycleFailureState(state)).toBe(state === 'failed');
    }
  });

  it('draft and not_started require explicit user approval before submission', () => {
    expect(requiresUserApprovalBeforeSubmission('draft')).toBe(true);
    expect(requiresUserApprovalBeforeSubmission('not_started')).toBe(true);
    expect(requiresUserApprovalBeforeSubmission('awaiting_user_approval')).toBe(false);
    expect(requiresUserApprovalBeforeSubmission('submitted')).toBe(false);
  });

  it('never allows any automatic transition (no auto-execution path)', () => {
    expect(canBookingTransitionAutomatically()).toBe(false);
  });

  it('labels every lifecycle state distinctly', () => {
    const labels = TRIP_BOOKING_LIFECYCLE_STATES.map(getTripBookingLifecycleStateLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(getTripBookingLifecycleStateLabel('provider_confirmed')).toBe('Provider confirmed');
    expect(getTripBookingLifecycleStateLabel('failed')).toBe('Failed');
  });
});

describe('STEP 20 booking lifecycle transition rules', () => {
  it('holds the explicit, controlled transition matrix', () => {
    expect(canTransitionBookingLifecycleState('not_started', 'draft')).toBe(true);
    expect(canTransitionBookingLifecycleState('draft', 'awaiting_user_approval')).toBe(true);
    expect(canTransitionBookingLifecycleState('awaiting_user_approval', 'submitted')).toBe(true);
    expect(canTransitionBookingLifecycleState('submitted', 'provider_pending')).toBe(true);
    expect(canTransitionBookingLifecycleState('provider_pending', 'provider_confirmed')).toBe(true);
    expect(canTransitionBookingLifecycleState('provider_confirmed', 'cancelled')).toBe(true);
  });

  it('a booking cannot jump from draft straight to submitted (approval boundary)', () => {
    expect(canTransitionBookingLifecycleState('draft', 'submitted')).toBe(false);
    expect(canTransitionBookingLifecycleState('not_started', 'awaiting_user_approval')).toBe(false);
    expect(canTransitionBookingLifecycleState('not_started', 'submitted')).toBe(false);
    expect(canTransitionBookingLifecycleState('not_started', 'provider_confirmed')).toBe(false);
  });

  it('returns the allowed target states for each state', () => {
    const fromDraft = new Set(getAllowedBookingLifecycleTransitions('draft'));
    expect(fromDraft.has('awaiting_user_approval')).toBe(true);
    expect(fromDraft.has('submitted')).toBe(false);
    expect(getAllowedBookingLifecycleTransitions('cancelled')).toEqual(['cancelled']);
  });

  it('produces a structured problem message instead of throwing for invalid transitions', () => {
    expect(getBookingLifecycleTransitionProblem('draft', 'submitted')).toContain('not allowed');
    expect(getBookingLifecycleTransitionProblem('draft', 'awaiting_user_approval')).toBeNull();
    expect(getBookingLifecycleTransitionProblem('submitted', 'provider_pending')).toBeNull();
  });

  it('provider confirmation requires a legitimate producer-backed verification record', () => {
    expect(canProviderMarkBookingConfirmed('submitted', 'externally-verified')).toBe(true);
    expect(canProviderMarkBookingConfirmed('provider_pending', 'provider-confirmed')).toBe(true);
    expect(canProviderMarkBookingConfirmed('draft', 'externally-verified')).toBe(false);
    expect(canProviderMarkBookingConfirmed('provider_confirmed', 'user-entered')).toBe(false);
    expect(canProviderMarkBookingConfirmed('submitted', 'user-confirmed')).toBe(false);
    expect(canProviderMarkBookingConfirmed('submitted', 'manually-reviewed')).toBe(false);
  });

  it('a submission problem message names the producer requirement', () => {
    expect(
      getBookingLifecycleTransitionProblem('provider_pending', 'provider_confirmed')
    ).toContain('producer-backed');
    expect(getBookingLifecycleTransitionProblem('submitted', 'provider_confirmed')).toContain(
      'not allowed'
    );
  });
});
