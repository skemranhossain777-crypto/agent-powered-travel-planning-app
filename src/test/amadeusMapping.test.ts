import { describe, expect, it } from 'vitest';
import {
  AMADEUS_HOTEL_ID_METADATA_KEY,
  AMADEUS_RESULT_DISCLAIMER,
  AMADEUS_RESULT_FRESHNESS_MINUTES,
  addIsoMinutesToTimestamp,
  mapAmadeusHotelOffersResponse,
} from '../services/realDiscovery/amadeusMapping';
import {
  AMADEUS_PROVIDER_ID,
  AMADEUS_PROVIDER_NAME,
} from '../services/realDiscovery/amadeusConfig';

const NOW = '2026-09-13T08:00:00.000Z';

function fullOffer(): Record<string, unknown> {
  return {
    checkInDate: '2026-09-20',
    checkOutDate: '2026-09-25',
    id: 'OFFER-1',
    room: { typeEstimated: { category: 'DELUXE' } },
    price: { currency: 'EUR', total: 178.5 },
    cancellation: {
      type: 'FREE_CANCELLATION',
      description: [{ text: 'Free cancellation until 2026-09-18.' }],
    },
    description: { text: 'King room with city view' },
  };
}

function fullHotel(): Record<string, unknown> {
  return {
    hotelId: 'HOTEL-101',
    name: 'Riverside Hotel',
    cityCode: 'AMS',
    available: true,
  };
}

function wirePayload(): unknown {
  return {
    data: [{ hotel: fullHotel(), offers: [fullOffer()] }],
  };
}

describe('STEP 41 addIsoMinutesToTimestamp', () => {
  it('adds the fixed freshness window to an ISO date-time', () => {
    expect(addIsoMinutesToTimestamp(NOW, AMADEUS_RESULT_FRESHNESS_MINUTES)).toBe(
      '2026-09-13T09:00:00.000Z'
    );
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(addIsoMinutesToTimestamp('not-a-date', 60)).toBe('not-a-date');
    expect(addIsoMinutesToTimestamp('', 60)).toBe('');
  });
});

describe('STEP 41 mapping a well-formed hotel-offers payload', () => {
  it('maps a full offer into the normalized app contract', () => {
    const results = mapAmadeusHotelOffersResponse(wirePayload(), NOW);
    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.providerId).toBe(AMADEUS_PROVIDER_ID);
    expect(result.providerName).toBe(AMADEUS_PROVIDER_NAME);
    expect(result.resultId).toBe('HOTEL-101:OFFER-1');
    expect(result.category).toBe('accommodation');
    expect(result.title).toBe('Riverside Hotel');
    expect(result.destination).toBe('AMS');
    expect(result.departureAt).toBe('2026-09-20');
    expect(result.arrivalAt).toBe('2026-09-25');
    expect(result.retrievedAt).toBe(NOW);
    expect(result.expiresAt).toBe('2026-09-13T09:00:00.000Z');
    expect(result.availability).toBe('available');
    expect(result.price).toEqual({ amount: 178.5, currency: 'EUR' });
    expect(result.cancellationPolicy).toBe('Free cancellation until 2026-09-18.');
    expect(result.limitations).toEqual([AMADEUS_RESULT_DISCLAIMER]);
    expect(result.metadata).toEqual([{ key: AMADEUS_HOTEL_ID_METADATA_KEY, value: 'HOTEL-101' }]);
  });

  it('maps unavailable flags to the unavailable label and preserves the summary', () => {
    const hotel = fullHotel();
    const offer = fullOffer();
    hotel['available'] = false;
    const results = mapAmadeusHotelOffersResponse({ data: [{ hotel, offers: [offer] }] }, NOW);
    expect(results[0].availability).toBe('unavailable');
    expect(results[0].summary).toBe('King room with city view');
  });

  it('drops offers that cannot produce a result id or a title (hard-drop, never fabricates)', () => {
    const brokeIdHotel = fullHotel();
    const noIdOffer = fullOffer();
    delete noIdOffer['id'];
    const noTitleHotel = fullHotel();
    delete noTitleHotel['name'];

    const results = mapAmadeusHotelOffersResponse(
      {
        data: [
          { hotel: brokeIdHotel, offers: [noIdOffer] },
          { hotel: noTitleHotel, offers: [fullOffer()] },
          { hotel: 'not-a-record' },
          { hotel: fullHotel(), offers: 'not-a-list' },
        ],
      },
      NOW
    );
    expect(results).toHaveLength(0);
  });

  it('drops an offer whose price node is missing or unquotable (never imports a priceless quote)', () => {
    const noPriceOffer = fullOffer();
    delete noPriceOffer['price'];
    const results = mapAmadeusHotelOffersResponse(
      { data: [{ hotel: fullHotel(), offers: [noPriceOffer] }] },
      NOW
    );
    expect(results).toHaveLength(0);
  });

  it('does not let one malformed offer poison a valid sibling', () => {
    const goodHotel = fullHotel();
    const goodOffer = fullOffer();
    const badOffer: Record<string, unknown> = {
      checkInDate: '2026-09-20',
      checkOutDate: '2026-09-24',
      id: 'BAD-1',
      price: { currency: 'EUR', total: 'not-a-number' },
      description: { text: 'Malformed price offer' },
    };
    const results = mapAmadeusHotelOffersResponse(
      { data: [{ hotel: goodHotel, offers: [badOffer, goodOffer] }] },
      NOW
    );
    expect(results).toHaveLength(1);
    expect(results[0].resultId).toBe('HOTEL-101:OFFER-1');
  });

  it('drops a negative, non-numeric, or non-quotable total', () => {
    for (const total of [-5, 'NaN', 'Infinity']) {
      const offer = fullOffer();
      offer['price'] = { currency: 'EUR', total };
      const results = mapAmadeusHotelOffersResponse(
        { data: [{ hotel: fullHotel(), offers: [offer] }] },
        NOW
      );
      expect(results).toHaveLength(0);
    }
    const offer = fullOffer();
    offer['price'] = { currency: 'EU', total: 100 };
    const results = mapAmadeusHotelOffersResponse(
      { data: [{ hotel: fullHotel(), offers: [offer] }] },
      NOW
    );
    expect(results[0].price).toEqual({ amount: 100, currency: 'EU' });
  });

  it('maps an absent or non-array data node to no results', () => {
    expect(mapAmadeusHotelOffersResponse({}, NOW)).toEqual([]);
    expect(mapAmadeusHotelOffersResponse({ data: 'nope' }, NOW)).toEqual([]);
    expect(mapAmadeusHotelOffersResponse(null, NOW)).toEqual([]);
    expect(mapAmadeusHotelOffersResponse('text', NOW)).toEqual([]);
  });

  it('is deterministic: the same payload and now map to the identical results', () => {
    const a = mapAmadeusHotelOffersResponse(wirePayload(), NOW);
    const b = mapAmadeusHotelOffersResponse(wirePayload(), NOW);
    expect(a).toEqual(b);
  });

  it('uses the wire cancellation type only when no human-readable text exists', () => {
    const offer = fullOffer();
    offer['cancellation'] = { type: 'FULL_PAYMENT_NON_REFUNDABLE' };
    const results = mapAmadeusHotelOffersResponse(
      { data: [{ hotel: fullHotel(), offers: [offer] }] },
      NOW
    );
    expect(results[0].cancellationPolicy).toBe('FULL_PAYMENT_NON_REFUNDABLE');
  });

  it('records no cancellation note when the wire policy is unusable', () => {
    const offer = fullOffer();
    offer['cancellation'] = 42;
    const results = mapAmadeusHotelOffersResponse(
      { data: [{ hotel: fullHotel(), offers: [offer] }] },
      NOW
    );
    expect(results[0].cancellationPolicy).toBeUndefined();
  });
});
