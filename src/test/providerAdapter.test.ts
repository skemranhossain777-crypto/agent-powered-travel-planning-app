import { describe, expect, it } from 'vitest';
import {
  getAdapterOperationalCapabilityIds,
  isAdapterCapabilityAvailable,
  isProviderAdapterProfile,
  normalizeProviderAdapterProfile,
  type ProviderAdapter,
} from '../domain/providers/providerAdapter';
import { providerOperationIsReadOnly } from '../domain/providers/executionOperations';
import { isProviderCapabilityDeclaration } from '../domain/providers/providerCapabilities';
import { mockAccommodationProviderAdapter } from '../services/mockDiscovery/mockAccommodationProvider';
import { mockTransportProviderAdapter } from '../services/mockDiscovery/mockTransportProvider';

describe('STEP 20 provider adapter boundary', () => {
  it('normalizes a full adapter profile and drops duplicate capability ids (last wins)', () => {
    const profile = normalizeProviderAdapterProfile({
      id: 'rail-europe',
      name: 'Rail Europe',
      capabilities: [
        { capability: 'search-transport', status: 'available' },
        { capability: 'retrieve-transport-details', status: 'available' },
        { capability: 'verify-reference', status: 'temporarily-unavailable' },
        { capability: 'search-transport', status: 'requires-authentication' },
      ],
    });
    expect(profile).toEqual({
      id: 'rail-europe',
      name: 'Rail Europe',
      capabilities: [
        { capability: 'search-transport', status: 'requires-authentication' },
        { capability: 'retrieve-transport-details', status: 'available' },
        { capability: 'verify-reference', status: 'temporarily-unavailable' },
      ],
    });
    expect(isProviderAdapterProfile(profile)).toBe(true);
  });

  it('rejects profiles with missing id, name, or non-array capabilities', () => {
    expect(normalizeProviderAdapterProfile({ name: 'X', capabilities: [] })).toBeNull();
    expect(normalizeProviderAdapterProfile({ id: 'x', capabilities: [] })).toBeNull();
    expect(normalizeProviderAdapterProfile({ id: 'x', name: 'X', capabilities: 'no' })).toBeNull();
    expect(normalizeProviderAdapterProfile(null)).toBeNull();
  });

  it('rejects a profile containing a malformed capability declaration', () => {
    expect(
      normalizeProviderAdapterProfile({
        id: 'x',
        name: 'X',
        capabilities: [{ capability: 'not-real', status: 'available' }],
      })
    ).toBeNull();
  });

  it('a capability is available only when declared as available; undeclared and non-operational are blocked', () => {
    const profile = normalizeProviderAdapterProfile({
      id: 'rail-europe',
      name: 'Rail Europe',
      capabilities: [
        { capability: 'search-transport', status: 'available' },
        { capability: 'verify-reference', status: 'requires-authentication' },
      ],
    })!;
    expect(isAdapterCapabilityAvailable(profile, 'search-transport')).toBe(true);
    expect(isAdapterCapabilityAvailable(profile, 'verify-reference')).toBe(false);
    expect(isAdapterCapabilityAvailable(profile, 'retrieve-booking-status')).toBe(false);
  });

  it('collects operational capability ids in a deterministic id order', () => {
    const profile = normalizeProviderAdapterProfile({
      id: 'across',
      name: 'Across',
      capabilities: [
        { capability: 'retrieve-booking-status', status: 'available' },
        { capability: 'search-accommodation', status: 'available' },
        { capability: 'search-transport', status: 'unavailable-missing-credentials' },
        { capability: 'retrieve-transport-details', status: 'available' },
      ],
    })!;
    expect(getAdapterOperationalCapabilityIds(profile)).toEqual([
      'retrieve-transport-details',
      'search-accommodation',
      'retrieve-booking-status',
    ]);
  });

  it('a profile with no operational capabilities reports an empty list', () => {
    const profile = normalizeProviderAdapterProfile({
      id: 'none',
      name: 'None',
      capabilities: [
        { capability: 'search-transport', status: 'unsupported' },
        { capability: 'verify-reference', status: 'unavailable-missing-credentials' },
      ],
    })!;
    expect(getAdapterOperationalCapabilityIds(profile)).toEqual([]);
  });

  it('normalized adapter capabilities are valid declarations', () => {
    const profile = normalizeProviderAdapterProfile({
      id: 'a',
      name: 'A',
      capabilities: [{ capability: 'search-transport', status: 'available', note: '  hi  ' }],
    })!;
    for (const decl of profile.capabilities) {
      expect(isProviderCapabilityDeclaration(decl)).toBe(true);
    }
  });
});

describe('STEP 39 adapter search boundary', () => {
  it('the ProviderAdapter interface carries the narrow read-only search operation', () => {
    // Compile-time proof the in-app mock adapters satisfy the extended
    // interface; runtime-verified that the operation surface exists.
    const transport: ProviderAdapter = mockTransportProviderAdapter satisfies ProviderAdapter;
    const accommodation: ProviderAdapter =
      mockAccommodationProviderAdapter satisfies ProviderAdapter;
    expect(typeof transport.search).toBe('function');
    expect(typeof accommodation.search).toBe('function');
  });

  it('search is the only executed discovery operation and is read-only by contract', () => {
    const envelope = mockTransportProviderAdapter.search(
      { category: 'transport', destination: 'Tokyo' },
      '2026-09-13T08:00:00.000Z'
    );
    expect(envelope).not.toBeNull();
    expect(envelope!.operation).toBe('search');
    expect(providerOperationIsReadOnly(envelope!.operation)).toBe(true);
    expect(envelope!.status).toBe('success');
  });
});
