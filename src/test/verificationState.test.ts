import { describe, expect, it } from 'vitest';
import {
  canProducerSetTripVerificationState,
  canTransitionTripVerificationState,
  canUserSetTripVerificationState,
  canUserTransitionTripVerificationState,
  describeProducerEvidenceRequirement,
  getAllowedUserVerificationTransitions,
  getTripVerificationStateExplanation,
  getTripVerificationStateLabel,
  getTripVerificationTransitionProblem,
  isProducerOnlyVerificationState,
  isTripEvidenceSourceKind,
  isTripVerificationEvidence,
  isTripVerificationState,
  isUserOwnedVerificationState,
  MAX_EVIDENCE_ID_LENGTH,
  MAX_EVIDENCE_REFERENCE_VALUE_LENGTH,
  normalizeTripVerificationEvidence,
  TRIP_EVIDENCE_SOURCE_KINDS,
  TRIP_VERIFICATION_PRODUCER_STATES,
  TRIP_VERIFICATION_STATES,
} from '../domain/trips/verificationState';
import { isSafeHttpUrl } from '../domain/trips/tripPlanning';
import type { TripVerificationState } from '../types/trip';

describe('STEP 19 verification vocabulary', () => {
  it('recognizes exactly the seven documented verification states', () => {
    expect(TRIP_VERIFICATION_STATES).toEqual([
      'user-entered',
      'user-confirmed',
      'manually-reviewed',
      'externally-verified',
      'provider-confirmed',
      'cancelled',
      'unknown',
    ]);
    for (const state of TRIP_VERIFICATION_STATES) {
      expect(isTripVerificationState(state)).toBe(true);
    }
    for (const junk of [
      'booked',
      'confirmed',
      'verified',
      'confirmed-reservation',
      'booked-online',
    ]) {
      expect(isTripVerificationState(junk)).toBe(false);
    }
    expect(isTripVerificationState(3)).toBe(false);
    expect(isTripVerificationState(null)).toBe(false);
    expect(isTripVerificationState(undefined)).toBe(false);
    expect(isTripVerificationState({})).toBe(false);
  });

  it('checklist task statuses are never verification states (no checklist coupling)', () => {
    for (const status of ['pending', 'in_progress', 'completed', 'skipped']) {
      expect(isTripVerificationState(status)).toBe(false);
    }
    expect(new Set(TRIP_VERIFICATION_STATES).size).toBe(7);
  });

  it('recognizes the documented evidence source kinds and rejects junk', () => {
    expect(TRIP_EVIDENCE_SOURCE_KINDS).toEqual([
      'user-provided-document',
      'public-webpage',
      'provider-communication',
      'provider-system',
      'manual-review',
      'other',
    ]);
    for (const kind of TRIP_EVIDENCE_SOURCE_KINDS) {
      expect(isTripEvidenceSourceKind(kind)).toBe(true);
    }
    for (const junk of ['provider', 'website', 'email', 'confirmation', 3, null, {}]) {
      expect(isTripEvidenceSourceKind(junk)).toBe(false);
    }
  });
});

describe('STEP 19 labels and explanations are unambiguous', () => {
  it('returns the documented read-only labels', () => {
    expect(getTripVerificationStateLabel('user-entered')).toBe('User-entered reference');
    expect(getTripVerificationStateLabel('user-confirmed')).toBe('User-confirmed plan');
    expect(getTripVerificationStateLabel('manually-reviewed')).toBe('Manually reviewed');
    expect(getTripVerificationStateLabel('externally-verified')).toBe('Externally verified');
    expect(getTripVerificationStateLabel('provider-confirmed')).toBe('Provider-confirmed booking');
    expect(getTripVerificationStateLabel('cancelled')).toBe('Cancelled');
    expect(getTripVerificationStateLabel('unknown')).toBe('Unknown or unavailable');
  });

  it('every state label is distinct', () => {
    const labels = TRIP_VERIFICATION_STATES.map(getTripVerificationStateLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('only provider-confirmed is ever labelled as a booking and no label collides', () => {
    const byState: Record<string, string> = {};
    for (const state of TRIP_VERIFICATION_STATES) {
      const label = getTripVerificationStateLabel(state).toLowerCase();
      byState[state] = label;
      expect(label).not.toMatch(/booked|ticket purchased|issued|live|proof/);
      if (state !== 'provider-confirmed') expect(label).not.toContain('booking');
    }
    expect(byState['externally-verified']).toBe('externally verified');
    expect(byState['provider-confirmed']).toBe('provider-confirmed booking');
    expect(byState['externally-verified']).not.toContain('provider');
    expect(byState['provider-confirmed']).not.toContain('externally');
  });

  it('user-authored states are never described as verified or externally confirmed', () => {
    expect(getTripVerificationStateLabel('user-entered').toLowerCase()).not.toMatch(
      /verified|confirmed|booking/
    );
    expect(getTripVerificationStateLabel('manually-reviewed').toLowerCase()).not.toMatch(
      /live|provider|verified|booked/
    );
  });

  it('explanations deny proof/live claims for user states and name the producer for producer states', () => {
    expect(getTripVerificationStateExplanation('user-entered')).toContain('not proof of a booking');
    expect(getTripVerificationStateExplanation('manually-reviewed')).toContain(
      'Not live or provider confirmation'
    );
    for (const state of ['externally-verified', 'provider-confirmed']) {
      expect(getTripVerificationStateExplanation(state as TripVerificationState)).toMatch(
        /producer/
      );
    }
    expect(getTripVerificationStateExplanation('unknown')).toMatch(/unavailable/);
  });
});

describe('STEP 19 evidence model', () => {
  it('normalizes a minimal user-authored evidence record', () => {
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'user-provided-document',
      })
    ).toEqual({ id: 'ev-1', state: 'user-entered', sourceKind: 'user-provided-document' });
  });

  it('trims optional strings, drops empty ones, and rebuilds (runtime keys stripped)', () => {
    const evidence = normalizeTripVerificationEvidence({
      id: '  ev-2  ',
      state: 'manually-reviewed',
      sourceKind: 'public-webpage',
      relatedRecordId: '  acp-1  ',
      sourceLabel: '  Provider site  ',
      referenceValue: '  ABC-9  ',
      notes: '  ',
      runtimeKey: 'drop-me',
    });
    expect(evidence).toEqual({
      id: 'ev-2',
      state: 'manually-reviewed',
      sourceKind: 'public-webpage',
      relatedRecordId: 'acp-1',
      sourceLabel: 'Provider site',
      referenceValue: 'ABC-9',
    });
  });

  it('requires id, state, and sourceKind', () => {
    expect(
      normalizeTripVerificationEvidence({ state: 'user-entered', sourceKind: 'other' })
    ).toBeNull();
    expect(normalizeTripVerificationEvidence({ id: 'ev-1', sourceKind: 'other' })).toBeNull();
    expect(normalizeTripVerificationEvidence({ id: 'ev-1', state: 'user-entered' })).toBeNull();
    expect(
      normalizeTripVerificationEvidence({ id: '   ', state: 'user-entered', sourceKind: 'other' })
    ).toBeNull();
    expect(normalizeTripVerificationEvidence(null)).toBeNull();
    expect(normalizeTripVerificationEvidence('ev-1')).toBeNull();
    expect(normalizeTripVerificationEvidence([])).toBeNull();
  });

  it('rejects unknown states and source kinds wholesale', () => {
    expect(
      normalizeTripVerificationEvidence({ id: 'ev-1', state: 'booked', sourceKind: 'other' })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'website',
      })
    ).toBeNull();
  });

  it('accepts only safe HTTP/HTTPS source URLs', () => {
    const withUrl = normalizeTripVerificationEvidence({
      id: 'ev-1',
      state: 'user-confirmed',
      sourceKind: 'public-webpage',
      sourceUrl: 'https://example.com/confirmation',
    });
    expect(withUrl?.sourceUrl).toBe('https://example.com/confirmation');
    expect(withUrl).not.toHaveProperty('verifiedAt');

    const unsafe = [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'not-a-url',
      'https://example.com/a b',
      'ftp://example.com',
    ];
    for (const url of unsafe) {
      expect(
        normalizeTripVerificationEvidence({
          id: 'ev-1',
          state: 'user-confirmed',
          sourceKind: 'public-webpage',
          sourceUrl: url,
        })
      ).toBeNull();
    }
  });

  it('reuses the exact same URL rule as planning references', () => {
    expect(isSafeHttpUrl('https://example.com/ref')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    const viaEvidence = normalizeTripVerificationEvidence({
      id: 'ev-1',
      state: 'user-confirmed',
      sourceKind: 'public-webpage',
      sourceUrl: 'file:///etc/passwd',
    });
    expect(viaEvidence).toBeNull();
  });

  it('validates evidence timestamps and drops empty ones', () => {
    const withTime = normalizeTripVerificationEvidence({
      id: 'ev-1',
      state: 'manually-reviewed',
      sourceKind: 'manual-review',
      verifiedAt: '2026-09-10',
      humanReviewedAt: '2026-09-10T14:30:00Z',
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
    expect(withTime?.verifiedAt).toBe('2026-09-10');
    expect(withTime?.humanReviewedAt).toBe('2026-09-10T14:30:00Z');
    expect(withTime?.expiresAt).toBe('2026-10-01T00:00:00.000Z');

    for (const timestamp of ['not-a-date', '2026-13-45', '2026-09-10T99:99:00Z', '10-09-2026']) {
      expect(
        normalizeTripVerificationEvidence({
          id: 'ev-1',
          state: 'user-confirmed',
          sourceKind: 'manual-review',
          verifiedAt: timestamp,
        })
      ).toBeNull();
    }

    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-confirmed',
        sourceKind: 'manual-review',
        verifiedAt: '  ',
      })
    ).toEqual({ id: 'ev-1', state: 'user-confirmed', sourceKind: 'manual-review' });
  });

  it('treats the reference value as plain user-entered text, never as proof', () => {
    const evidence = normalizeTripVerificationEvidence({
      id: 'ev-1',
      state: 'user-entered',
      sourceKind: 'user-provided-document',
      referenceValue: 'A random text that is not a booking code',
    });
    expect(evidence?.referenceValue).toBe('A random text that is not a booking code');

    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'user-provided-document',
        referenceValue: 'x'.repeat(MAX_EVIDENCE_REFERENCE_VALUE_LENGTH + 1),
      })
    ).toBeNull();
  });

  it('enforces documented maximum lengths by rejection', () => {
    const tooLong = 'x'.repeat(201);
    expect(MAX_EVIDENCE_ID_LENGTH).toBe(200);
    expect(
      normalizeTripVerificationEvidence({ id: tooLong, state: 'user-entered', sourceKind: 'other' })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        relatedRecordId: tooLong,
      })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        sourceLabel: tooLong,
      })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        notes: 'x'.repeat(501),
      })
    ).toBeNull();
  });

  it('rejects non-string optional fields without throwing', () => {
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        notes: 7,
      })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        sourceUrl: 7,
      })
    ).toBeNull();
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-1',
        state: 'user-entered',
        sourceKind: 'other',
        verifiedAt: true,
      })
    ).toBeNull();
  });
});

describe('STEP 19 producer boundary', () => {
  it('only externally-verified and provider-confirmed are producer-only states', () => {
    expect(TRIP_VERIFICATION_PRODUCER_STATES).toEqual([
      'externally-verified',
      'provider-confirmed',
    ]);
    for (const state of TRIP_VERIFICATION_PRODUCER_STATES) {
      expect(isProducerOnlyVerificationState(state)).toBe(true);
      expect(canUserSetTripVerificationState(state)).toBe(false);
      expect(canProducerSetTripVerificationState(state)).toBe(true);
    }
    for (const state of [
      'user-entered',
      'user-confirmed',
      'manually-reviewed',
      'cancelled',
      'unknown',
    ]) {
      expect(canUserSetTripVerificationState(state as TripVerificationState)).toBe(true);
      expect(canProducerSetTripVerificationState(state as TripVerificationState)).toBe(false);
    }
  });

  it('classifies the user-owned authoring states', () => {
    for (const state of ['user-entered', 'user-confirmed', 'manually-reviewed']) {
      expect(isUserOwnedVerificationState(state as TripVerificationState)).toBe(true);
    }
    for (const state of ['externally-verified', 'provider-confirmed', 'cancelled', 'unknown']) {
      expect(isUserOwnedVerificationState(state as TripVerificationState)).toBe(false);
    }
  });

  it('rejects externally-verified claims even when full evidence metadata is supplied', () => {
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-x',
        state: 'externally-verified',
        sourceKind: 'provider-system',
        verifiedAt: '2026-09-10T12:00:00Z',
        sourceUrl: 'https://example.com',
        referenceValue: 'ABC-123',
      })
    ).toBeNull();
  });

  it('rejects provider-confirmed claims even when full evidence metadata is supplied', () => {
    expect(
      normalizeTripVerificationEvidence({
        id: 'ev-x',
        state: 'provider-confirmed',
        sourceKind: 'provider-communication',
        verifiedAt: '2026-09-10T12:00:00Z',
      })
    ).toBeNull();
  });

  it('documents the producer contract without exposing a fake manual path', () => {
    expect(describeProducerEvidenceRequirement('externally-verified')).toMatch(/producer/);
    expect(describeProducerEvidenceRequirement('externally-verified')).toMatch(/verifiedAt/);
    expect(describeProducerEvidenceRequirement('provider-confirmed')).toMatch(/producer/);
    for (const state of [
      'user-entered',
      'user-confirmed',
      'manually-reviewed',
      'cancelled',
      'unknown',
    ]) {
      expect(describeProducerEvidenceRequirement(state as TripVerificationState)).toBeNull();
    }
  });
});

describe('STEP 19 controlled state transitions', () => {
  it('enforces the explicit transition matrix', () => {
    expect(canTransitionTripVerificationState('user-entered', 'user-confirmed')).toBe(true);
    expect(canTransitionTripVerificationState('user-confirmed', 'manually-reviewed')).toBe(true);
    expect(canTransitionTripVerificationState('manually-reviewed', 'user-confirmed')).toBe(true);
    expect(canTransitionTripVerificationState('user-confirmed', 'cancelled')).toBe(true);
    expect(canTransitionTripVerificationState('cancelled', 'user-entered')).toBe(true);
    expect(canTransitionTripVerificationState('unknown', 'user-entered')).toBe(true);
    expect(canTransitionTripVerificationState('unknown', 'cancelled')).toBe(true);
    expect(canTransitionTripVerificationState('cancelled', 'externally-verified')).toBe(false);
    expect(canTransitionTripVerificationState('cancelled', 'provider-confirmed')).toBe(false);
  });

  it('keeps producer edges out of the user affordance', () => {
    expect(canTransitionTripVerificationState('user-entered', 'externally-verified')).toBe(true);
    expect(canUserTransitionTripVerificationState('user-entered', 'externally-verified')).toBe(
      false
    );
    expect(canUserTransitionTripVerificationState('user-entered', 'provider-confirmed')).toBe(
      false
    );
    expect(
      canUserTransitionTripVerificationState('externally-verified', 'provider-confirmed')
    ).toBe(false);
    expect(canUserTransitionTripVerificationState('externally-verified', 'cancelled')).toBe(false);
    expect(canUserTransitionTripVerificationState('provider-confirmed', 'cancelled')).toBe(false);
    expect(getAllowedUserVerificationTransitions('externally-verified')).toEqual([]);
    expect(getAllowedUserVerificationTransitions('provider-confirmed')).toEqual([]);
  });

  it('the user affordance lists only reachable, user-settable transitions', () => {
    const fromUserEntered = getAllowedUserVerificationTransitions('user-entered');
    expect(fromUserEntered).not.toContain('externally-verified');
    expect(fromUserEntered).not.toContain('provider-confirmed');
    expect(fromUserEntered).toContain('user-confirmed');
    expect(fromUserEntered).toContain('manually-reviewed');
    expect(fromUserEntered).toContain('cancelled');
    expect(canUserTransitionTripVerificationState('user-confirmed', 'user-entered')).toBe(true);
    expect(canUserTransitionTripVerificationState('user-confirmed', 'manually-reviewed')).toBe(
      true
    );
    expect(canUserTransitionTripVerificationState('user-confirmed', 'cancelled')).toBe(true);
  });

  it('never yields checklist task statuses from any state (no completion-driven transitions)', () => {
    for (const state of TRIP_VERIFICATION_STATES) {
      const allowed = getAllowedUserVerificationTransitions(state);
      for (const next of allowed) {
        expect(canUserSetTripVerificationState(next)).toBe(true);
        expect(isTripVerificationState(next)).toBe(true);
      }
      expect(allowed).not.toContain('pending');
      expect(allowed).not.toContain('in_progress');
      expect(allowed).not.toContain('completed');
      expect(allowed).not.toContain('skipped');
    }
  });

  it('reports invalid transitions as structured safe messages', () => {
    expect(getTripVerificationTransitionProblem('user-entered', 'user-confirmed')).toBeNull();
    expect(getTripVerificationTransitionProblem('user-entered', 'externally-verified')).toMatch(
      /producer/
    );
    expect(getTripVerificationTransitionProblem('user-confirmed', 'provider-confirmed')).toMatch(
      /producer/
    );
    expect(getTripVerificationTransitionProblem('externally-verified', 'cancelled')).toMatch(
      /producer/
    );
    expect(getTripVerificationTransitionProblem('cancelled', 'externally-verified')).toMatch(
      /not allowed/
    );
  });

  it('treats unknown as a neutral fallback state', () => {
    expect(canUserTransitionTripVerificationState('unknown', 'user-entered')).toBe(true);
    expect(canUserTransitionTripVerificationState('unknown', 'user-confirmed')).toBe(true);
    expect(canUserTransitionTripVerificationState('unknown', 'manually-reviewed')).toBe(true);
    expect(canUserTransitionTripVerificationState('unknown', 'cancelled')).toBe(true);
    expect(canUserTransitionTripVerificationState('unknown', 'externally-verified')).toBe(false);
  });
});

describe('STEP 19 guard functions', () => {
  it('isTripVerificationEvidence reflects the normalizer', () => {
    expect(
      isTripVerificationEvidence({ id: 'ev-1', state: 'user-entered', sourceKind: 'other' })
    ).toBe(true);
    expect(
      isTripVerificationEvidence({
        id: 'ev-1',
        state: 'provider-confirmed',
        sourceKind: 'provider-system',
      })
    ).toBe(false);
    expect(isTripVerificationEvidence(null)).toBe(false);
  });
});
