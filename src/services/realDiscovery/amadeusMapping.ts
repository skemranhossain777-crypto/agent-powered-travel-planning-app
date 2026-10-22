/**
 * Pure, offline-testable mapping of the Amadeus Self-Service Hotel Offers
 * response into the normalized app discovery contract (STEP 41).
 *
 * This is the first REAL external-provider payload mapper: it translates the
 * raw Amadeus v3 `hotel-offers` wire shape (an OAuth-protected, read-only
 * accommodation quote search) into `TripProviderResult[]` using the shared
 * STEP 20/39 provider-result normalizer — the exact boundary a real provider
 * must cross before anything in the app can see its data.
 *
 * Rules:
 *
 * 1. **Pure and deterministic.** Given `(payload, now)` the mapping always
 *    returns the same results; `expiresAt` derives from the caller-supplied
 *    `now` plus a fixed freshness window, never from a clock read.
 * 2. **Hard drop, never fabrication.** Every offer is rebuilt field-by-field
 *    and passed through `normalizeTripProviderResult`. A field that cannot be
 *    normalized (missing hotel name, unsafe URL, malformed timestamp ...)
 *    rejects that item; the item is dropped and never guessed. A present-but-
 *    unquotable price (absent `total`, non-numeric/negative amount, or invalid
 *    currency) also rejects the offer, because importing a quote without a
 *    price would be fabrication. A structurally unusable payload (no `data`
 *    array) maps to `[]` — the caller reports `empty`/`malformed-response`
 *    honestly, never a fake quote.
 * 3. **App contracts only.** `category` is always `accommodation`; `resultId`
 *    is the deterministic `hotelId:offerId` pair; price, dates, availability,
 *    and any cancellation note map only when present and valid. Raw keys are
 *    stripped by the normalizer, so no Amadeus-specific vocabulary leaks into
 *    the app model.
 * 4. **No booking/payment/verification.** A quote is a point-in-time, read-only
 *    availability estimate. The disclaimer states it is not a booking,
 *    reservation, or payment; nothing here books, pays, verifies, or persists.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  normalizeTripProviderResult,
  type TripProviderResult,
} from '../../domain/providers/providerResults';
import { AMADEUS_PROVIDER_ID, AMADEUS_PROVIDER_NAME } from './amadeusConfig';

/** Read-only disclaimer stamped on every real-provider result. */
export const AMADEUS_RESULT_DISCLAIMER =
  'Live provider quote — not a booking, reservation, or payment.';

/** How long a retrieved quote stays current before the normalizer treats it as stale. */
export const AMADEUS_RESULT_FRESHNESS_MINUTES = 60;

/** Metadata label carrying the Amadeus hotel id, isolated per result. */
export const AMADEUS_HOTEL_ID_METADATA_KEY = 'amadeus-hotel-id';

/**
 * The loose wire shape of a single Amadeus hotel-offers `data` item. Optional
 * keys are read defensively; anything absent stays absent in the result.
 */
export interface AmadeusHotelOfferWire {
  /** Opaque provider endpoint/response node. Deliberately untyped at the source. */
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return undefined;
  return trimmed;
}

function readFiniteAmount(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return amount;
}

/**
 * Adds a fixed number of minutes to an ISO-8601 timestamp string (date or
 * date-time) and returns an ISO date-time. `now` must already be a real,
 * parseable timestamp; the caller supplies it so the mapping stays pure.
 * Returns the input unchanged when it cannot be parsed.
 */
export function addIsoMinutesToTimestamp(now: string, minutes: number): string {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) return now;
  return new Date(parsed + minutes * 60 * 1000).toISOString();
}

/**
 * Maps a raw Amadeus Self-Service Hotel Offers search response into normalized
 * `TripProviderResult[]`. The payload is accepted as `unknown` and read
 * defensively end-to-end: items that fail the shared normalizer are dropped
 * individually, so a malformed offer never poisons valid ones.
 */
export function mapAmadeusHotelOffersResponse(payload: unknown, now: string): TripProviderResult[] {
  const root = isRecord(payload) && Array.isArray(payload['data']) ? payload['data'] : [];
  const out: TripProviderResult[] = [];
  const expiresAt = addIsoMinutesToTimestamp(now, AMADEUS_RESULT_FRESHNESS_MINUTES);

  for (const rawHotel of root) {
    if (!isRecord(rawHotel)) continue;
    const hotel = isRecord(rawHotel['hotel']) ? rawHotel['hotel'] : undefined;
    const offers = Array.isArray(rawHotel['offers']) ? rawHotel['offers'] : [];
    for (const rawOffer of offers) {
      if (!isRecord(rawOffer)) continue;

      const resultId = buildAmadeusResultId(hotel, rawOffer);
      if (resultId === undefined) continue;

      const title = readString(hotel?.['name'], 200);
      if (title === undefined) continue;

      const candidate: Record<string, unknown> = {
        providerId: AMADEUS_PROVIDER_ID,
        providerName: AMADEUS_PROVIDER_NAME,
        resultId,
        category: 'accommodation',
        title,
        retrievedAt: now,
        expiresAt,
        availability: availabilityFromWire(hotel?.['available']),
      };

      const destination = readString(hotel?.['cityCode'], 200);
      if (destination !== undefined) candidate['destination'] = destination;

      const summary = offerSummary(rawOffer);
      if (summary !== undefined) candidate['summary'] = summary;

      const checkIn = readString(rawOffer['checkInDate'], 10);
      if (checkIn !== undefined) candidate['departureAt'] = checkIn;

      const checkOut = readString(rawOffer['checkOutDate'], 10);
      if (checkOut !== undefined) candidate['arrivalAt'] = checkOut;

      const price = offerPrice(rawOffer);
      if (price === undefined) continue;
      candidate['price'] = price;

      const cancellation = offerCancellationNote(rawOffer);
      if (cancellation !== undefined) candidate['cancellationPolicy'] = cancellation;

      candidate['limitations'] = [AMADEUS_RESULT_DISCLAIMER];

      const hotelId = readString(hotel?.['hotelId'], 100);
      if (hotelId !== undefined) {
        candidate['metadata'] = [{ key: AMADEUS_HOTEL_ID_METADATA_KEY, value: hotelId }];
      }

      const normalized = normalizeTripProviderResult(candidate);
      if (normalized !== null) out.push(normalized);
    }
  }

  return out;
}

/** Deterministic `hotelId:offerId` identity, or `undefined` when either side is unusable. */
function buildAmadeusResultId(
  hotel: Record<string, unknown> | undefined,
  offer: Record<string, unknown>
): string | undefined {
  const hotelId = readString(hotel?.['hotelId'], 100);
  const offerId = readString(offer['id'], 100);
  if (hotelId === undefined || offerId === undefined) return undefined;
  return `${hotelId}:${offerId}`;
}

/** Availability label from the wire `available` flag; `unknown` when absent. */
function availabilityFromWire(value: unknown): 'available' | 'unavailable' | 'unknown' {
  if (typeof value !== 'boolean') return 'unknown';
  return value ? 'available' : 'unavailable';
}

/** Optional one-line room/property summary, bounded like every result string. */
function offerSummary(offer: Record<string, unknown>): string | undefined {
  const description = offer['description'];
  if (!isRecord(description)) return undefined;
  const text = readString(description['text'], 500);
  return text;
}

/** Present, valid price quote or `undefined` (never a fabricated fallback). */
function offerPrice(
  offer: Record<string, unknown>
): { amount: number; currency: string } | undefined {
  const price = offer['price'];
  if (!isRecord(price)) return undefined;
  const amount = readFiniteAmount(price['total']);
  const currency = readString(price['currency'], 8);
  if (amount === undefined || currency === undefined) return undefined;
  if (!/^[A-Za-z]{1,8}$/.test(currency)) return undefined;
  return { amount, currency };
}

/** Bounded plain-text cancellation note from the wire policy, or `undefined`. */
function offerCancellationNote(offer: Record<string, unknown>): string | undefined {
  const cancellation = offer['cancellation'];
  if (!isRecord(cancellation)) return undefined;
  const asText = readString(cancellation['description'], 500);
  if (asText !== undefined) return asText;
  const description = cancellation['description'];
  if (Array.isArray(description)) {
    const parts: string[] = [];
    for (const item of description) {
      if (!isRecord(item)) continue;
      const text = readString(item['text'], 500);
      if (text !== undefined) parts.push(text);
    }
    if (parts.length > 0) return parts.join(' ');
  }
  return readString(cancellation['type'], 200);
}
