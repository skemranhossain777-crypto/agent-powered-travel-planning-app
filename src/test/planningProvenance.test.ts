import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_PROVENANCE_NOTE_LENGTH,
  TRIP_PLAN_PROVENANCE_KINDS,
  getTripPlanProvenanceDescription,
  getTripPlanProvenanceLabel,
  isExternalProviderProvenance,
  isSimulatedProvenance,
  isTripPlanProvenance,
  isTripPlanProvenanceKind,
  normalizeTripPlanProvenance,
} from '../domain/trips/planningProvenance';

describe('STEP 23 provenance kind vocabulary', () => {
  it('exposes exactly the four recognized kinds and validates them', () => {
    expect(TRIP_PLAN_PROVENANCE_KINDS).toEqual([
      'manual',
      'ai-generated',
      'mock-discovery',
      'external-provider',
    ]);
    for (const kind of TRIP_PLAN_PROVENANCE_KINDS) {
      expect(isTripPlanProvenanceKind(kind)).toBe(true);
    }
    expect(isTripPlanProvenanceKind('booked')).toBe(false);
    expect(isTripPlanProvenanceKind('live-listing')).toBe(false);
    expect(isTripPlanProvenanceKind(42)).toBe(false);
    expect(isTripPlanProvenanceKind(undefined)).toBe(false);
  });

  it('classifies simulation and external-provider kinds precisely', () => {
    expect(isSimulatedProvenance('mock-discovery')).toBe(true);
    expect(isSimulatedProvenance('manual')).toBe(false);
    expect(isSimulatedProvenance('ai-generated')).toBe(false);
    expect(isSimulatedProvenance('external-provider')).toBe(false);

    expect(isExternalProviderProvenance('external-provider')).toBe(true);
    expect(isExternalProviderProvenance('mock-discovery')).toBe(false);
    expect(isExternalProviderProvenance('manual')).toBe(false);
  });
});

describe('STEP 23 provenance normalization', () => {
  it('accepts a bare kind and a trimmed bounded note', () => {
    expect(normalizeTripPlanProvenance({ kind: 'manual' })).toEqual({ kind: 'manual' });
    expect(
      normalizeTripPlanProvenance({ kind: 'mock-discovery', note: '  sample import  ' })
    ).toEqual({ kind: 'mock-discovery', note: 'sample import' });
    expect(normalizeTripPlanProvenance({ kind: 'ai-generated', note: 'x'.repeat(500) })).toEqual({
      kind: 'ai-generated',
      note: 'x'.repeat(500),
    });
  });

  it('drops a whitespace-only note and preserves the kind', () => {
    expect(normalizeTripPlanProvenance({ kind: 'external-provider', note: '   ' })).toEqual({
      kind: 'external-provider',
    });
  });

  it('rejects malformed, unknown, and over-length payloads', () => {
    expect(normalizeTripPlanProvenance(null)).toBeNull();
    expect(normalizeTripPlanProvenance('manual')).toBeNull();
    expect(normalizeTripPlanProvenance(42)).toBeNull();
    expect(normalizeTripPlanProvenance([])).toBeNull();
    expect(normalizeTripPlanProvenance({})).toBeNull();
    expect(normalizeTripPlanProvenance({ kind: 'live-listing' })).toBeNull();
    expect(normalizeTripPlanProvenance({ kind: 7 })).toBeNull();
    expect(normalizeTripPlanProvenance({ kind: 'manual', note: 9 })).toBeNull();
    expect(
      normalizeTripPlanProvenance({
        kind: 'manual',
        note: 'x'.repeat(MAX_PLAN_PROVENANCE_NOTE_LENGTH + 1),
      })
    ).toBeNull();
  });

  it('never repairs an invalid payload and never emits runtime-only keys', () => {
    expect(normalizeTripPlanProvenance({ kind: 'manual', runtimeFlag: 1 })).toEqual({
      kind: 'manual',
    });
    expect(normalizeTripPlanProvenance({ kind: 'booked', note: 'confirmation' })).toBeNull();
  });

  it('round-trips through the well-formed predicate', () => {
    expect(isTripPlanProvenance({ kind: 'mock-discovery', note: 'sample' })).toBe(true);
    expect(isTripPlanProvenance({ kind: 'mock-discovery' })).toBe(true);
    expect(isTripPlanProvenance({ kind: 'draft' })).toBe(false);
    expect(isTripPlanProvenance(null)).toBe(false);
  });
});

describe('STEP 23 labels keep provenance honest', () => {
  it('renders the exact fixed labels for all four kinds', () => {
    expect(getTripPlanProvenanceLabel('manual')).toBe('Manual reference');
    expect(getTripPlanProvenanceLabel('ai-generated')).toBe('AI-generated reference');
    expect(getTripPlanProvenanceLabel('mock-discovery')).toBe('Simulated discovery');
    expect(getTripPlanProvenanceLabel('external-provider')).toBe(
      'External provider reference — not verified'
    );
  });

  it('never claims a booking, live data, or a confirmed price in any label', () => {
    for (const kind of TRIP_PLAN_PROVENANCE_KINDS) {
      const label = getTripPlanProvenanceLabel(kind).toLowerCase();
      expect(label).not.toMatch(/booked/);
      expect(label).not.toMatch(/live/);
      expect(label).not.toMatch(/confirmed|reservation|ticket|purchased/);
    }
  });

  it('describes only the kinds that need disambiguation, always noting the sample/not-verified status', () => {
    expect(getTripPlanProvenanceDescription('manual')).toBeUndefined();
    expect(getTripPlanProvenanceDescription('ai-generated')).toBeUndefined();
    expect(getTripPlanProvenanceDescription('mock-discovery')).toContain('simulated discovery');
    expect(getTripPlanProvenanceDescription('mock-discovery')).toContain('not live availability');
    expect(getTripPlanProvenanceDescription('mock-discovery')).toContain('not a booking');
    expect(getTripPlanProvenanceDescription('external-provider')).toContain('not verified');
    expect(getTripPlanProvenanceDescription('external-provider')).toContain(
      'future external provider'
    );
  });
});
