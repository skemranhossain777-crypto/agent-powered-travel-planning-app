import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPABILITY_STATUS,
  getProviderCapabilityLabel,
  getProviderCapabilityStatusLabel,
  getProviderCapabilityUnavailabilityReason,
  isProviderCapabilityDeclaration,
  isProviderCapabilityId,
  isProviderCapabilityStatus,
  normalizeProviderCapabilityDeclaration,
  PROVIDER_CAPABILITY_IDS,
  PROVIDER_CAPABILITY_STATUSES,
  providerCapabilityIsOperational,
} from '../domain/providers/providerCapabilities';

describe('STEP 20 provider capability vocabulary', () => {
  it('recognizes exactly the seven documented capability ids and rejects junk', () => {
    expect(PROVIDER_CAPABILITY_IDS).toEqual([
      'search-transport',
      'retrieve-transport-details',
      'search-accommodation',
      'retrieve-accommodation-details',
      'verify-reference',
      'retrieve-booking-status',
      'retrieve-cancellation-information',
    ]);
    for (const id of PROVIDER_CAPABILITY_IDS) {
      expect(isProviderCapabilityId(id)).toBe(true);
    }
    for (const junk of ['book', 'api', 'stripe', 'cancel', 3, null, {}]) {
      expect(isProviderCapabilityId(junk)).toBe(false);
    }
  });

  it('recognizes exactly the six documented statuses and rejects junk', () => {
    expect(PROVIDER_CAPABILITY_STATUSES).toEqual([
      'unsupported',
      'available',
      'requires-authentication',
      'requires-user-approval',
      'unavailable-missing-credentials',
      'temporarily-unavailable',
    ]);
    for (const status of PROVIDER_CAPABILITY_STATUSES) {
      expect(isProviderCapabilityStatus(status)).toBe(true);
    }
    for (const junk of ['ok', 'yes', 'disabled', 1, null, {}]) {
      expect(isProviderCapabilityStatus(junk)).toBe(false);
    }
  });

  it('defaults an undeclared capability to unsupported and only available is operational', () => {
    expect(DEFAULT_CAPABILITY_STATUS).toBe('unsupported');
    expect(providerCapabilityIsOperational('available')).toBe(true);
    for (const status of PROVIDER_CAPABILITY_STATUSES) {
      if (status !== 'available') expect(providerCapabilityIsOperational(status)).toBe(false);
    }
  });

  it('labels every capability and status distinctly in read-only prose', () => {
    const idLabels = PROVIDER_CAPABILITY_IDS.map(getProviderCapabilityLabel);
    expect(new Set(idLabels).size).toBe(idLabels.length);
    const statusLabels = PROVIDER_CAPABILITY_STATUSES.map(getProviderCapabilityStatusLabel);
    expect(new Set(statusLabels).size).toBe(statusLabels.length);
  });

  it('explains non-operational statuses without claiming live integration', () => {
    expect(getProviderCapabilityUnavailabilityReason('unsupported')).toContain('not supported');
    expect(getProviderCapabilityUnavailabilityReason('unavailable-missing-credentials')).toMatch(
      /credentials/
    );
    expect(getProviderCapabilityUnavailabilityReason('temporarily-unavailable')).toMatch(
      /no execution should retry automatically/
    );
    expect(getProviderCapabilityUnavailabilityReason('available')).toContain('available');
  });
});

describe('STEP 20 capability declaration normalization', () => {
  it('normalizes a minimal declaration and trims its note', () => {
    expect(
      normalizeProviderCapabilityDeclaration({
        capability: 'verify-reference',
        status: 'temporarily-unavailable',
        note: '  scheduled maintenance  ',
      })
    ).toEqual({
      capability: 'verify-reference',
      status: 'temporarily-unavailable',
      note: 'scheduled maintenance',
    });
  });

  it('drops an empty note rather than persisting it', () => {
    expect(
      normalizeProviderCapabilityDeclaration({
        capability: 'search-transport',
        status: 'available',
        note: '   ',
      })
    ).toEqual({ capability: 'search-transport', status: 'available' });
  });

  it('rejects unknown capability ids, unknown statuses, and non-records (never guesses)', () => {
    expect(
      normalizeProviderCapabilityDeclaration({ capability: 'book-now', status: 'available' })
    ).toBeNull();
    expect(
      normalizeProviderCapabilityDeclaration({ capability: 'search-transport', status: 'yes' })
    ).toBeNull();
    expect(normalizeProviderCapabilityDeclaration({ status: 'available' })).toBeNull();
    expect(normalizeProviderCapabilityDeclaration('available')).toBeNull();
    expect(normalizeProviderCapabilityDeclaration(null)).toBeNull();
  });

  it('rejects a note that exceeds the documented maximum', () => {
    expect(
      normalizeProviderCapabilityDeclaration({
        capability: 'search-accommodation',
        status: 'available',
        note: 'x'.repeat(201),
      })
    ).toBeNull();
  });

  it('isProviderCapabilityDeclaration agrees with normalize', () => {
    expect(
      isProviderCapabilityDeclaration({
        capability: 'retrieve-booking-status',
        status: 'requires-authentication',
      })
    ).toBe(true);
    expect(isProviderCapabilityDeclaration({ capability: 'verify-reference' })).toBe(false);
  });
});
