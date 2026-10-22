import { describe, expect, it } from 'vitest';
import {
  canMintStateFromProducerResult,
  describeProducerVerificationClaim,
  evidenceSupportsProducerState,
  getProducerVerificationProofOfEvidence,
  isProviderVerificationResult,
  normalizeProducerEvidence,
  normalizeProviderVerificationResult,
  PROVIDER_VERIFICATION_OUTCOMES,
} from '../domain/providers/verificationProducer';

const providerId = 'acme-provider';

const VERIFIED_RESULT = {
  providerId: 'acme-provider',
  providerName: 'Acme Provider',
  outcome: 'verified',
  evidence: {
    id: 'ev-1',
    state: 'externally-verified',
    sourceKind: 'provider-system',
    verifiedAt: '2026-09-01T09:00:00Z',
    referenceValue: 'REF-123',
  },
  retrievedAt: '2026-09-01T09:00:00Z',
  expiresAt: '2026-09-08T09:00:00Z',
};

const NOW = '2026-09-02T09:00:00Z';

describe('STEP 20 verification producer outcome contract', () => {
  it('recognizes exactly the five documented outcomes', () => {
    expect(PROVIDER_VERIFICATION_OUTCOMES).toEqual([
      'verified',
      'not-verified',
      'cancelled',
      'unavailable',
      'error',
    ]);
  });

  it('verified and cancelled outcomes map to producer states; others mint nothing', () => {
    expect(getProducerVerificationProofOfEvidence('verified')).toBe('externally-verified');
    expect(getProducerVerificationProofOfEvidence('cancelled')).toBe('cancelled');
    for (const outcome of ['not-verified', 'unavailable', 'error'] as const) {
      expect(getProducerVerificationProofOfEvidence(outcome)).toBeNull();
    }
  });

  it('normalizes a verified result and exposes evidence', () => {
    const result = normalizeProviderVerificationResult(VERIFIED_RESULT);
    expect(result).toEqual({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'verified',
      evidence: {
        id: 'ev-1',
        state: 'externally-verified',
        sourceKind: 'provider-system',
        verifiedAt: '2026-09-01T09:00:00Z',
        referenceValue: 'REF-123',
      },
      retrievedAt: '2026-09-01T09:00:00Z',
      expiresAt: '2026-09-08T09:00:00Z',
    });
    expect(isProviderVerificationResult(result)).toBe(true);
  });

  it('rejects a provider-confirmed claim that has no verifiedAt (evidence integrity)', () => {
    expect(
      normalizeProviderVerificationResult({
        providerId,
        providerName: 'Acme Provider',
        outcome: 'verified',
        evidence: {
          id: 'ev-x',
          state: 'provider-confirmed',
          sourceKind: 'provider-system',
          referenceValue: 'REF-9',
        },
        retrievedAt: '2026-09-01T09:00:00Z',
      })
    ).toBeNull();
  });

  it('rejects a non-provider source kind and missing reference/URL (STEP 19 producer requirement)', () => {
    expect(
      normalizeProducerEvidence({
        id: 'ev-a',
        state: 'externally-verified',
        sourceKind: 'public-webpage',
        verifiedAt: '2026-09-01T09:00:00Z',
        referenceValue: 'REF',
      })
    ).toBeNull();
    expect(
      normalizeProducerEvidence({
        id: 'ev-b',
        state: 'externally-verified',
        sourceKind: 'provider-system',
        verifiedAt: '2026-09-01T09:00:00Z',
      })
    ).toBeNull();
  });

  it('accepts a safe sourceUrl as the evidence reference and rejects unsafe URLs', () => {
    expect(
      normalizeProducerEvidence({
        id: 'ev-c',
        state: 'provider-confirmed',
        sourceKind: 'provider-system',
        verifiedAt: '2026-09-01T09:00:00Z',
        sourceUrl: 'https://example.com/booking/123',
      })
    ).not.toBeNull();
    expect(
      normalizeProducerEvidence({
        id: 'ev-d',
        state: 'provider-confirmed',
        sourceKind: 'provider-system',
        verifiedAt: '2026-09-01T09:00:00Z',
        sourceUrl: 'javascript:alert(1)',
      })
    ).toBeNull();
  });

  it('outcomes that mint nothing never produce evidence or state', () => {
    for (const outcome of ['not-verified', 'unavailable', 'error'] as const) {
      const result = normalizeProviderVerificationResult({
        providerId,
        providerName: 'Acme Provider',
        outcome,
        retrievedAt: '2026-09-01T09:00:00Z',
      });
      expect(result?.outcome).toBe(outcome);
      expect(result?.evidence).toBeUndefined();
      expect(getProducerVerificationProofOfEvidence(outcome)).toBeNull();
    }
  });

  it('an error outcome may carry a bounded safe error and never a state claim', () => {
    const result = normalizeProviderVerificationResult({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'error',
      retrievedAt: '2026-09-01T09:00:00Z',
      error: { category: 'provider-unavailable', message: 'Provider is down' },
    });
    expect(result?.error).toEqual({
      category: 'provider-unavailable',
      message: 'Provider is down',
    });
    expect(getProducerVerificationProofOfEvidence('error')).toBeNull();

    expect(
      normalizeProviderVerificationResult({
        providerId,
        providerName: 'Acme Provider',
        outcome: 'verified',
        retrievedAt: '2026-09-01T09:00:00Z',
        error: { category: 'provider-unavailable', message: 'should-not-be-here' },
      })
    ).toBeNull();
  });

  it('rejects unsafe/missing provider identity and malformed payloads', () => {
    expect(normalizeProviderVerificationResult({ ...VERIFIED_RESULT, providerId: ' ' })).toBeNull();
    expect(
      normalizeProviderVerificationResult({ ...VERIFIED_RESULT, outcome: 'maybe' })
    ).toBeNull();
    expect(
      normalizeProviderVerificationResult({ ...VERIFIED_RESULT, retrievedAt: 'later' })
    ).toBeNull();
    expect(normalizeProviderVerificationResult(null)).toBeNull();
  });
});

describe('STEP 20 producer minting gates and staleness', () => {
  it('mints a state only when evidence is complete and the result is not expired', () => {
    const current = normalizeProviderVerificationResult(VERIFIED_RESULT)!;
    expect(canMintStateFromProducerResult(current, NOW)).toBe(true);
  });

  it('refuses to mint from stale results (no stale-as-current path)', () => {
    const stale = normalizeProviderVerificationResult({
      ...VERIFIED_RESULT,
      expiresAt: '2026-09-01T10:00:00Z',
    })!;
    expect(canMintStateFromProducerResult(stale, NOW)).toBe(false);
  });

  it('refuses to mint without evidence and from non-producer outcomes', () => {
    const noEvidence = normalizeProviderVerificationResult({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'verified',
      retrievedAt: '2026-09-01T09:00:00Z',
    })!;
    expect(canMintStateFromProducerResult(noEvidence, NOW)).toBe(false);

    const unavailable = normalizeProviderVerificationResult({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'unavailable',
      retrievedAt: '2026-09-01T09:00:00Z',
    })!;
    expect(canMintStateFromProducerResult(unavailable, NOW)).toBe(false);
  });

  it('evidence supports a state only when state kind, source, and verifiedAt all agree', () => {
    expect(
      evidenceSupportsProducerState(
        {
          id: 'e1',
          state: 'externally-verified',
          sourceKind: 'provider-system',
          verifiedAt: '2026-09-01T09:00:00Z',
          referenceValue: 'R',
        },
        'externally-verified'
      )
    ).toBe(true);
    expect(
      evidenceSupportsProducerState(
        {
          id: 'e2',
          state: 'externally-verified',
          sourceKind: 'public-webpage',
          verifiedAt: '2026-09-01T09:00:00Z',
          referenceValue: 'R',
        },
        'externally-verified'
      )
    ).toBe(false);
    expect(
      evidenceSupportsProducerState(
        {
          id: 'e3',
          state: 'externally-verified',
          sourceKind: 'provider-system',
          referenceValue: 'R',
        },
        'externally-verified'
      )
    ).toBe(false);
    expect(
      evidenceSupportsProducerState(
        {
          id: 'e4',
          state: 'provider-confirmed',
          sourceKind: 'provider-system',
          verifiedAt: '2026-09-01T09:00:00Z',
          referenceValue: 'R',
        },
        'externally-verified'
      )
    ).toBe(false);
  });

  it('claims prose never over-claims: unavailable/error/not-verified change nothing', () => {
    const unavailable = normalizeProviderVerificationResult({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'unavailable',
      retrievedAt: '2026-09-01T09:00:00Z',
    })!;
    expect(describeProducerVerificationClaim(unavailable, NOW)).toContain(
      'no verification state changed'
    );
    const error = normalizeProviderVerificationResult({
      providerId,
      providerName: 'Acme Provider',
      outcome: 'error',
      retrievedAt: '2026-09-01T09:00:00Z',
      error: { category: 'network-error', message: 'timeout' },
    })!;
    expect(describeProducerVerificationClaim(error, NOW)).toContain('Error: timeout');
  });

  it('claims prose flags staleness instead of claiming currency', () => {
    const stale = normalizeProviderVerificationResult({
      ...VERIFIED_RESULT,
      expiresAt: '2026-09-01T10:00:00Z',
    })!;
    expect(describeProducerVerificationClaim(stale, NOW)).toMatch(/stale/);
  });
});
