import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_LABELS,
  EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_NOTE,
  EXTERNAL_DISCOVERY_HANDOFF_READINESS_NOTE,
  mapDiscoveryResultToExternalProviderHandoffPlan,
  mapDiscoveryResultToHandoffPlan,
} from '../domain/discovery/handoff';
import type { TripProviderResult } from '../domain/providers/providerResults';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
} from '../services/realDiscovery/amadeusConfig';
import { AMADEUS_RESULT_DISCLAIMER } from '../services/realDiscovery/amadeusMapping';

const NOW = '2026-09-13T08:00:00.000Z';

function accommodationResult(): TripProviderResult {
  return {
    providerId: AMADEUS_PROVIDER_ID,
    providerName: AMADEUS_PROVIDER_NAME,
    resultId: 'HOTEL-101:OFFER-1',
    category: 'accommodation',
    title: 'Riverside Hotel',
    destination: 'AMS',
    departureAt: '2026-09-20',
    arrivalAt: '2026-09-25',
    summary: 'King room with city view',
    price: { amount: 178.5, currency: 'EUR' },
    cancellationPolicy: 'Free cancellation until 2026-09-18.',
    sourceUrl: 'https://test.api.amadeus.com/hotel-offers/HOTEL-101:OFFER-1',
    retrievedAt: NOW,
    expiresAt: '2026-09-13T09:00:00.000Z',
    availability: 'available',
    limitations: [AMADEUS_RESULT_DISCLAIMER],
    metadata: [{ key: 'amadeus-hotel-id', value: 'HOTEL-101' }],
  };
}

function transportResult(): TripProviderResult {
  return {
    providerId: 'mock-rail',
    providerName: 'Mock Rail',
    resultId: 'FR-100',
    category: 'transport',
    title: 'Paris to Amsterdam express',
    origin: 'PAR',
    destination: 'AMS',
    departureAt: '2026-09-20T08:30:00.000Z',
    arrivalAt: '2026-09-20T12:15:00.000Z',
    durationMinutes: 225,
    price: { amount: 89, currency: 'EUR' },
    retrievedAt: NOW,
    expiresAt: '2026-09-13T09:00:00.000Z',
    availability: 'available',
  };
}

describe('STEP 41 external-provider handoff provenance', () => {
  it('stamps the external-provider provenance and vocabulary on an accommodation plan', () => {
    const mapped = mapDiscoveryResultToExternalProviderHandoffPlan(
      accommodationResult(),
      NOW,
      'handoff-HOTEL-101:OFFER-1'
    );
    expect(mapped?.kind).toBe('accommodation');
    if (mapped?.kind !== 'accommodation') return;
    expect(mapped.plan.id).toBe('handoff-HOTEL-101:OFFER-1');
    expect(mapped.plan.name).toBe('Riverside Hotel');
    expect(mapped.plan.location).toBe('AMS');
    expect(mapped.plan.roomDetails).toBe('King room with city view');
    expect(mapped.plan.referenceNumber).toBe('HOTEL-101:OFFER-1');
    expect(mapped.plan.sourceUrl).toBe(
      'https://test.api.amadeus.com/hotel-offers/HOTEL-101:OFFER-1'
    );
    expect(mapped.plan.provenance?.kind).toBe('external-provider');
    expect(mapped.plan.provenance?.note).toBe(EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_NOTE);
    expect(mapped.plan.readiness?.state).toBe('planned');
    expect(mapped.plan.readiness?.note).toBe(EXTERNAL_DISCOVERY_HANDOFF_READINESS_NOTE);
    expect(mapped.plan.lifecycleState).toBe('active');
  });

  it('writes the fixed external labels, quote price, provider id, and disclaimer into notes', () => {
    const mapped = mapDiscoveryResultToExternalProviderHandoffPlan(
      accommodationResult(),
      NOW,
      'handoff-1'
    );
    if (mapped?.kind !== 'accommodation') throw new Error('expected accommodation plan');
    const notes = mapped.plan.notes;
    for (const label of EXTERNAL_DISCOVERY_HANDOFF_PROVENANCE_LABELS) {
      expect(notes).toContain(label);
    }
    expect(notes).toContain(`Provider: ${AMADEUS_PROVIDER_NAME}`);
    expect(notes).toContain(`Provider id: ${AMADEUS_PROVIDER_ID}`);
    expect(notes).toContain('Result id: HOTEL-101:OFFER-1');
    expect(notes).toContain('Quote price: 178.50 EUR');
    expect(notes).toContain(`Limitation: ${AMADEUS_RESULT_DISCLAIMER}`);
    expect(notes).toContain('Provider metadata: amadeus-hotel-id — HOTEL-101');
    expect(notes).toContain('Cancellation policy: Free cancellation until 2026-09-18.');
  });

  it('maps a real transport result with the transport field rules', () => {
    const mapped = mapDiscoveryResultToExternalProviderHandoffPlan(transportResult(), NOW, 'h-2');
    expect(mapped?.kind).toBe('transport');
    if (mapped?.kind !== 'transport') return;
    expect(mapped.plan.provider).toBe('Mock Rail');
    expect(mapped.plan.departureLocation).toBe('PAR');
    expect(mapped.plan.arrivalLocation).toBe('AMS');
    expect(mapped.plan.departureTime).toBe('2026-09-20T08:30:00.000Z');
    expect(mapped.plan.arrivalTime).toBe('2026-09-20T12:15:00.000Z');
    expect(mapped.plan.referenceNumber).toBe('FR-100');
    expect(mapped.plan.notes).toContain('Quote price: 89.00 EUR');
    expect(mapped.plan.notes).toContain('Duration (minutes): 225');
    expect(mapped.plan.provenance?.kind).toBe('external-provider');
    expect(mapped.plan.notes).toContain('Not a booking or reservation');
  });

  it('never copies primary-selection or booking fields into the plan', () => {
    const mapped = mapDiscoveryResultToExternalProviderHandoffPlan(
      accommodationResult(),
      NOW,
      'h-3'
    );
    if (mapped?.kind !== 'accommodation') throw new Error('expected accommodation plan');
    const record = mapped.plan as unknown as Record<string, unknown>;
    expect('primaryAccommodationPlanId' in record).toBe(false);
    expect('confirmationCode' in record).toBe(false);
    expect('bookingStatus' in record).toBe(false);
  });
});

describe('STEP 41 external handoff refusals', () => {
  it('refuses a result that is expired at now', () => {
    const result = accommodationResult();
    result.expiresAt = NOW;
    expect(mapDiscoveryResultToExternalProviderHandoffPlan(result, NOW, 'h-4')).toBeNull();
  });

  it('refuses a non-planning category', () => {
    const result = accommodationResult();
    result.category = 'activity' as TripProviderResult['category'];
    expect(mapDiscoveryResultToExternalProviderHandoffPlan(result, NOW, 'h-5')).toBeNull();
  });
});

describe('STEP 41 mock handoff remains unchanged alongside the external variant', () => {
  it('still maps the same accommodation result with the mock vocabulary', () => {
    const mapped = mapDiscoveryResultToHandoffPlan(accommodationResult(), NOW, 'handoff-mock-1');
    expect(mapped?.kind).toBe('accommodation');
    if (mapped?.kind !== 'accommodation') return;
    expect(mapped.plan.provenance?.kind).toBe('mock-discovery');
    expect(mapped.plan.notes).toContain('Sample price: 178.50 EUR');
    expect(mapped.plan.notes).toContain('Imported from simulated discovery');
    expect(mapped.plan.notes).toContain('Sample data — not live availability');
    expect(mapped.plan.notes).not.toContain('Imported from live provider discovery');
    expect(mapped.plan.notes).not.toContain('Quote price: ');
    expect(mapped.plan.notes).toContain('Not a booking or reservation');
  });
});
