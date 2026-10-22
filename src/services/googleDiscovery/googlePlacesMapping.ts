/**
 * Google Places app-category vocabulary, bounded input, and normalization
 * mapping (STEP 44).
 *
 * This module owns the ONLY bridge between the application's approved place
 * categories and the Google Places API (New) wire vocabulary, plus the pure,
 * offline-testable translation of a Nearby Search payload into the shared
 * STEP 20 `TripProviderResult[]` normalization contract.
 *
 * Rules:
 *
 * 1. **The application category is the source of truth.** Exactly twelve
 *    approved categories exist; arbitrary user-supplied Google `includedTypes`
 *    never pass through. `getGooglePlacesIncludedTypes` returns a fixed, vetted
 *    list of filterable Table A types for a category and nothing else.
 * 2. **Bounded inputs.** The Nearby Search query is exactly
 *    `{ latitude, longitude, radiusMeters, category, resultLimit }`. Unknown
 *    keys reject (no provider parameter smuggling), coordinates are finite and
 *    geographic, the radius is positive and bounded, and the result count is
 *    bounded to the provider-supported maximum.
 * 3. **Hard drop, never fabrication.** Every place is rebuilt field-by-field
 *    and passed through `normalizeTripProviderResult`. A missing place id or
 *    display name rejects that item; absent or invalid rating / rating count /
 *    address / coordinates are dropped, never guessed. A structurally unusable
 *    payload maps to `[]` — the caller reports `empty` honestly.
 * 4. **Hotel/resort honesty.** The requested application category and the
 *    provider-supplied `primaryType` are preserved separately in metadata. If
 *    Google does not classify a property as a resort (`resort_hotel`), nothing
 *    claims it is one merely because the user searched for resorts.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  normalizeTripProviderResult,
  type TripProviderResult,
} from '../../domain/providers/providerResults';
import { isSafeHttpUrl } from '../../domain/trips/tripPlanning';
import { GOOGLE_PLACES_PROVIDER_ID, GOOGLE_PLACES_PROVIDER_NAME } from './googlePlacesConfig';

/** The twelve approved application-controlled place-discovery categories. */
export type GooglePlacesAppCategory =
  | 'attractions'
  | 'landmarks'
  | 'museums'
  | 'parks'
  | 'beaches'
  | 'entertainment'
  | 'activities'
  | 'shopping'
  | 'restaurants'
  | 'cafes'
  | 'hotels'
  | 'resorts';

export const GOOGLE_PLACES_APP_CATEGORIES: ReadonlyArray<GooglePlacesAppCategory> = [
  'attractions',
  'landmarks',
  'museums',
  'parks',
  'beaches',
  'entertainment',
  'activities',
  'shopping',
  'restaurants',
  'cafes',
  'hotels',
  'resorts',
];

export function isGooglePlacesAppCategory(value: unknown): value is GooglePlacesAppCategory {
  return (
    typeof value === 'string' &&
    (GOOGLE_PLACES_APP_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * The fixed application-category → Google Places (New) `includedTypes` mapping.
 * Every value is a filterable Table A type from the official Places API type
 * table. This is the ONLY way Google types enter a request; a client can never
 * supply its own.
 */
export const GOOGLE_PLACES_CATEGORY_INCLUDED_TYPES: Readonly<
  Record<GooglePlacesAppCategory, readonly string[]>
> = Object.freeze({
  attractions: ['tourist_attraction'],
  landmarks: ['tourist_attraction', 'historical_landmark', 'cultural_landmark', 'monument'],
  museums: ['museum', 'art_gallery'],
  parks: ['park', 'national_park', 'city_park', 'state_park', 'botanical_garden', 'hiking_area'],
  beaches: ['beach'],
  entertainment: [
    'movie_theater',
    'night_club',
    'casino',
    'amusement_park',
    'amusement_center',
    'performing_arts_theater',
    'event_venue',
    'bowling_alley',
    'comedy_club',
    'planetarium',
  ],
  activities: [
    'spa',
    'gym',
    'hiking_area',
    'observation_deck',
    'marina',
    'amusement_center',
    'indoor_playground',
    'water_park',
  ],
  shopping: ['shopping_mall', 'store'],
  restaurants: ['restaurant'],
  cafes: ['cafe'],
  hotels: ['hotel', 'lodging'],
  resorts: ['resort_hotel'],
});

/** Returns the fixed Google `includedTypes` for an approved application category. */
export function getGooglePlacesIncludedTypes(category: GooglePlacesAppCategory): readonly string[] {
  return GOOGLE_PLACES_CATEGORY_INCLUDED_TYPES[category];
}

/** Geographic and provider bounds for a Nearby Search request. */
export const GOOGLE_PLACES_MIN_LATITUDE = -90;
export const GOOGLE_PLACES_MAX_LATITUDE = 90;
export const GOOGLE_PLACES_MIN_LONGITUDE = -180;
export const GOOGLE_PLACES_MAX_LONGITUDE = 180;
export const GOOGLE_PLACES_MIN_RADIUS_METERS = 1;
export const GOOGLE_PLACES_MAX_RADIUS_METERS = 50000;
export const GOOGLE_PLACES_MIN_RESULT_LIMIT = 1;
/** The provider-supported Nearby Search result-count ceiling (and default). */
export const GOOGLE_PLACES_MAX_RESULT_LIMIT = 20;
export const GOOGLE_PLACES_DEFAULT_RESULT_LIMIT = 20;

/**
 * The bounded, validated read-only Nearby Search input the provider accepts.
 * Everything is produced by `normalizeGooglePlacesNearbyQuery`; a client can
 * never smuggle additional provider parameters through.
 */
export interface GooglePlacesNearbyQuery {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  category: GooglePlacesAppCategory;
  resultLimit: number;
}

/** The recognized validation problems a Google Places query can report. */
export type GooglePlacesNearbyQueryProblemCode =
  | 'not-an-object'
  | 'unknown-key'
  | 'invalid-latitude'
  | 'latitude-out-of-range'
  | 'invalid-longitude'
  | 'longitude-out-of-range'
  | 'invalid-radius'
  | 'radius-out-of-range'
  | 'invalid-category'
  | 'invalid-result-limit'
  | 'result-limit-out-of-range';

/** A bounded, user-facing description of one validation problem. */
export interface GooglePlacesNearbyQueryProblem {
  code: GooglePlacesNearbyQueryProblemCode;
  message: string;
  /** Present only for `unknown-key`: the offending key. */
  key?: string;
}

const ALLOWED_GOOGLE_PLACES_QUERY_KEYS: ReadonlyArray<string> = [
  'latitude',
  'longitude',
  'radiusMeters',
  'category',
  'resultLimit',
];

export function isGooglePlacesNearbyQuery(value: unknown): value is GooglePlacesNearbyQuery {
  return normalizeGooglePlacesNearbyQuery(value) !== null;
}

/** The first validation problem for `value`, or `null` when it is well-formed. */
export function getGooglePlacesNearbyQueryProblem(
  value: unknown
): GooglePlacesNearbyQueryProblem | null {
  return analyzeGooglePlacesNearbyQuery(value).problem;
}

/**
 * Normalizes an untrusted Nearby Search input into the bounded
 * `GooglePlacesNearbyQuery`, or returns `null` when the shape cannot be
 * repaired. Unknown keys reject the whole value; missing/blank `resultLimit`
 * defaults to `GOOGLE_PLACES_DEFAULT_RESULT_LIMIT`. Never throws.
 */
export function normalizeGooglePlacesNearbyQuery(value: unknown): GooglePlacesNearbyQuery | null {
  return analyzeGooglePlacesNearbyQuery(value).query;
}

interface GooglePlacesNearbyQueryAnalysis {
  query: GooglePlacesNearbyQuery | null;
  problem: GooglePlacesNearbyQueryProblem | null;
}

function analyzeGooglePlacesNearbyQuery(value: unknown): GooglePlacesNearbyQueryAnalysis {
  if (!isRecord(value)) {
    return {
      query: null,
      problem: {
        code: 'not-an-object',
        message: 'A Google Places nearby query must be an object.',
      },
    };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_GOOGLE_PLACES_QUERY_KEYS.includes(key)) {
      return {
        query: null,
        problem: {
          code: 'unknown-key',
          key,
          message: `Google Places nearby queries do not accept the field "${key}".`,
        },
      };
    }
  }

  const latitude = requireFiniteNumber(value.latitude);
  if (latitude === null) {
    return {
      query: null,
      problem: { code: 'invalid-latitude', message: 'The latitude must be a finite number.' },
    };
  }
  if (latitude < GOOGLE_PLACES_MIN_LATITUDE || latitude > GOOGLE_PLACES_MAX_LATITUDE) {
    return {
      query: null,
      problem: {
        code: 'latitude-out-of-range',
        message: 'The latitude must be between -90 and 90.',
      },
    };
  }

  const longitude = requireFiniteNumber(value.longitude);
  if (longitude === null) {
    return {
      query: null,
      problem: { code: 'invalid-longitude', message: 'The longitude must be a finite number.' },
    };
  }
  if (longitude < GOOGLE_PLACES_MIN_LONGITUDE || longitude > GOOGLE_PLACES_MAX_LONGITUDE) {
    return {
      query: null,
      problem: {
        code: 'longitude-out-of-range',
        message: 'The longitude must be between -180 and 180.',
      },
    };
  }

  const radius = requireFiniteNumber(value.radiusMeters);
  if (radius === null) {
    return {
      query: null,
      problem: { code: 'invalid-radius', message: 'The radius must be a finite number.' },
    };
  }
  if (radius < GOOGLE_PLACES_MIN_RADIUS_METERS || radius > GOOGLE_PLACES_MAX_RADIUS_METERS) {
    return {
      query: null,
      problem: {
        code: 'radius-out-of-range',
        message: `The radius must be between ${GOOGLE_PLACES_MIN_RADIUS_METERS} and ${GOOGLE_PLACES_MAX_RADIUS_METERS} meters.`,
      },
    };
  }

  const category = value.category;
  if (!isGooglePlacesAppCategory(category)) {
    return {
      query: null,
      problem: { code: 'invalid-category', message: 'The category is not an approved category.' },
    };
  }

  let resultLimit = GOOGLE_PLACES_DEFAULT_RESULT_LIMIT;
  if (value.resultLimit !== undefined && value.resultLimit !== null) {
    const rawLimit = requireFiniteNumber(value.resultLimit);
    if (rawLimit === null || !Number.isInteger(rawLimit)) {
      return {
        query: null,
        problem: { code: 'invalid-result-limit', message: 'The result limit must be a whole number.' },
      };
    }
    if (rawLimit < GOOGLE_PLACES_MIN_RESULT_LIMIT || rawLimit > GOOGLE_PLACES_MAX_RESULT_LIMIT) {
      return {
        query: null,
        problem: {
          code: 'result-limit-out-of-range',
          message: `The result limit must be between ${GOOGLE_PLACES_MIN_RESULT_LIMIT} and ${GOOGLE_PLACES_MAX_RESULT_LIMIT}.`,
        },
      };
    }
    resultLimit = rawLimit;
  }

  return {
    query: { latitude, longitude, radiusMeters: radius, category, resultLimit },
    problem: null,
  };
}

/** Read-only disclaimer stamped on every Google Places result. */
export const GOOGLE_PLACES_RESULT_DISCLAIMER =
  'Live provider place result - read-only discovery reference; not a booking or reservation.';

/** How long a retrieved place result stays current before it is treated as stale. */
export const GOOGLE_PLACES_RESULT_FRESHNESS_MINUTES = 60;

/** Metadata labels attached to every normalized place result (isolated, display-only). */
export const GOOGLE_PLACES_METADATA_PLACE_ID = 'google-place-id';
export const GOOGLE_PLACES_METADATA_LATITUDE = 'google-latitude';
export const GOOGLE_PLACES_METADATA_LONGITUDE = 'google-longitude';
export const GOOGLE_PLACES_METADATA_FORMATTED_ADDRESS = 'google-formatted-address';
export const GOOGLE_PLACES_METADATA_PRIMARY_TYPE = 'google-primary-type';
export const GOOGLE_PLACES_METADATA_RATING = 'google-rating';
export const GOOGLE_PLACES_METADATA_USER_RATING_COUNT = 'google-user-rating-count';
export const GOOGLE_PLACES_METADATA_REQUESTED_CATEGORY = 'requested-category';

/**
 * Adds a fixed number of minutes to an ISO-8601 timestamp string and returns an
 * ISO date-time. `now` must already be a real, parseable timestamp; the caller
 * supplies it so the mapping stays pure. Returns the input unchanged when it
 * cannot be parsed.
 */
export function addGooglePlacesFreshnessWindow(now: string, minutes: number): string {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) return now;
  return new Date(parsed + minutes * 60 * 1000).toISOString();
}

/**
 * Maps a raw Google Places API (New) Nearby Search response into normalized
 * `TripProviderResult[]`. The payload is accepted as `unknown` and read
 * defensively end-to-end: items that fail the shared normalizer are dropped
 * individually, so a malformed place never poisons valid ones. A payload with
 * no usable `places` array maps to `[]`.
 */
export function mapGooglePlacesNearbyResponse(
  payload: unknown,
  query: GooglePlacesNearbyQuery,
  now: string
): TripProviderResult[] {
  const root = isRecord(payload) && Array.isArray(payload['places']) ? payload['places'] : [];
  const out: TripProviderResult[] = [];
  const expiresAt = addGooglePlacesFreshnessWindow(now, GOOGLE_PLACES_RESULT_FRESHNESS_MINUTES);

  for (const rawPlace of root) {
    if (!isRecord(rawPlace)) continue;

    const placeId = readString(rawPlace['id'], 200);
    if (placeId === undefined) continue;

    const displayName = isRecord(rawPlace['displayName']) ? rawPlace['displayName'] : undefined;
    const title = readString(displayName?.['text'], 200);
    if (title === undefined) continue;

    const candidate: Record<string, unknown> = {
      providerId: GOOGLE_PLACES_PROVIDER_ID,
      providerName: GOOGLE_PLACES_PROVIDER_NAME,
      resultId: placeId,
      category: bookingCategoryForRequestedCategory(query.category),
      title,
      retrievedAt: now,
      expiresAt,
      availability: 'available',
    };

    const formattedAddress = readString(rawPlace['formattedAddress'], 500);
    if (formattedAddress !== undefined) candidate['summary'] = formattedAddress;

    const sourceUrl = readString(rawPlace['googleMapsUri'], 500);
    if (sourceUrl !== undefined && isSafeHttpUrl(sourceUrl)) {
      candidate['sourceUrl'] = sourceUrl;
    }

    candidate['limitations'] = [GOOGLE_PLACES_RESULT_DISCLAIMER];
    candidate['metadata'] = buildPlaceMetadata(rawPlace, query, placeId, formattedAddress);

    const normalized = normalizeTripProviderResult(candidate);
    if (normalized !== null) out.push(normalized);
  }

  return out;
}

/**
 * The STEP 20 `TripBookingCategory` a place result carries, derived from the
 * approved application category. Hotels and resorts are accommodation;
 * food/shopping land in `other`; everything else is an `activity`. The
 * provider's own `primaryType` is preserved separately in metadata, so the
 * category here is only the coarse application bucket.
 */
export function bookingCategoryForRequestedCategory(
  category: GooglePlacesAppCategory
): 'accommodation' | 'activity' | 'other' {
  if (category === 'hotels' || category === 'resorts') return 'accommodation';
  if (category === 'restaurants' || category === 'cafes' || category === 'shopping') return 'other';
  return 'activity';
}

/** Metadata pairs for one place; invalid or absent fields are simply omitted. */
function buildPlaceMetadata(
  place: Record<string, unknown>,
  query: GooglePlacesNearbyQuery,
  placeId: string,
  formattedAddress: string | undefined
): { key: string; value: string }[] {
  const items: { key: string; value: string }[] = [];
  items.push({ key: GOOGLE_PLACES_METADATA_PLACE_ID, value: placeId });
  items.push({ key: GOOGLE_PLACES_METADATA_REQUESTED_CATEGORY, value: query.category });

  const primaryType = readString(place['primaryType'], 100);
  if (primaryType !== undefined) {
    items.push({ key: GOOGLE_PLACES_METADATA_PRIMARY_TYPE, value: primaryType });
  }

  const location = isRecord(place['location']) ? place['location'] : undefined;
  const latitude = readFiniteCoordinate(location?.['latitude']);
  const longitude = readFiniteCoordinate(location?.['longitude']);
  if (latitude !== undefined) {
    items.push({ key: GOOGLE_PLACES_METADATA_LATITUDE, value: String(latitude) });
  }
  if (longitude !== undefined) {
    items.push({ key: GOOGLE_PLACES_METADATA_LONGITUDE, value: String(longitude) });
  }

  if (formattedAddress !== undefined) {
    items.push({ key: GOOGLE_PLACES_METADATA_FORMATTED_ADDRESS, value: formattedAddress.slice(0, 200) });
  }

  const rating = readRating(place['rating']);
  if (rating !== undefined) items.push({ key: GOOGLE_PLACES_METADATA_RATING, value: String(rating) });

  const ratingCount = readRatingCount(place['userRatingCount']);
  if (ratingCount !== undefined) {
    items.push({ key: GOOGLE_PLACES_METADATA_USER_RATING_COUNT, value: String(ratingCount) });
  }

  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return undefined;
  return trimmed;
}

/** A finite coordinate within geographic bounds, rounded to 6 decimals. */
function readFiniteCoordinate(value: unknown): number | undefined {
  const number = requireFiniteNumber(value);
  if (number === null) return undefined;
  if (number < -180 || number > 180) return undefined;
  return Math.round(number * 1e6) / 1e6;
}

/** A rating is only trusted as a finite number within the 0..5 rating scale. */
function readRating(value: unknown): number | undefined {
  const number = requireFiniteNumber(value);
  if (number === null) return undefined;
  if (number < 0 || number > 5) return undefined;
  return Math.round(number * 100) / 100;
}

/** A user rating count is only trusted as a non-negative integer. */
function readRatingCount(value: unknown): number | undefined {
  const number = requireFiniteNumber(value);
  if (number === null) return undefined;
  if (!Number.isInteger(number) || number < 0) return undefined;
  return number;
}

/**
 * STEP 45 - bounded Google Place ID validation (read-only Place Details input).
 *
 * A Place Details attempt names a place only by a validated application-owned
 * Place ID. The rules are deliberately broad (Google Place IDs are compact
 * printable-ASCII tokens): non-empty after trimming, bounded length, printable
 * ASCII only (no whitespace or control characters), and no path separators or
 * path-traversal semantics - so an ID can never smuggle a URL, an endpoint, or
 * a filesystem path into the fixed request the connection builds.
 */
export const GOOGLE_PLACES_PLACE_ID_MAX_LENGTH = 200;

/** The recognized Place ID validation problems. */
export type GooglePlacesPlaceIdProblemCode =
  | 'not-a-string'
  | 'empty'
  | 'too-long'
  | 'invalid-character'
  | 'path-like';

/** A bounded, user-facing description of one Place ID validation problem. */
export interface GooglePlacesPlaceIdProblem {
  code: GooglePlacesPlaceIdProblemCode;
  message: string;
}

function analyzeGooglePlacesPlaceId(value: unknown): {
  id: string | null;
  problem: GooglePlacesPlaceIdProblem | null;
} {
  if (typeof value !== 'string') {
    return { id: null, problem: { code: 'not-a-string', message: 'The place id must be a string.' } };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { id: null, problem: { code: 'empty', message: 'The place id must not be empty.' } };
  }
  if (trimmed.length > GOOGLE_PLACES_PLACE_ID_MAX_LENGTH) {
    return {
      id: null,
      problem: {
        code: 'too-long',
        message: `The place id must be at most ${GOOGLE_PLACES_PLACE_ID_MAX_LENGTH} characters.`,
      },
    };
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      return {
        id: null,
        problem: {
          code: 'invalid-character',
          message: 'The place id may only contain printable ASCII characters.',
        },
      };
    }
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return {
      id: null,
      problem: {
        code: 'path-like',
        message: 'The place id must not contain path separators or traversal semantics.',
      },
    };
  }
  return { id: trimmed, problem: null };
}

/** The first validation problem for a Place ID, or `null` when it is usable. */
export function getGooglePlacesPlaceIdProblem(value: unknown): GooglePlacesPlaceIdProblem | null {
  return analyzeGooglePlacesPlaceId(value).problem;
}

/** Normalizes a Place ID to a bounded, request-safe string, or `null`. */
export function normalizeGooglePlacesPlaceId(value: unknown): string | null {
  return analyzeGooglePlacesPlaceId(value).id;
}

/** True only when `value` is a request-safe Place ID. */
export function isValidGooglePlacesPlaceId(value: unknown): boolean {
  return normalizeGooglePlacesPlaceId(value) !== null;
}

/** Normalized opening-hours facts for a place detail (only what Google provided). */
export interface GooglePlacesPlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
}

/** Normalized provider-grounded photo metadata (a resource reference, never an image URL). */
export interface GooglePlacesPlacePhoto {
  /** Safe provider resource reference (e.g. `places/PLACE_ID/photos/REF`), not a URL. */
  name: string;
  widthPx?: number;
  heightPx?: number;
}

/**
 * The application-owned normalized Place Detail object (STEP 45). Every field
 * except the identity/name pair is optional and present only when Google
 * actually provided it - nothing is fabricated, generated, or repaired.
 */
export interface GooglePlacesPlaceDetail {
  providerId: string;
  providerName: string;
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: GooglePlacesPlaceOpeningHours;
  currentOpeningHours?: GooglePlacesPlaceOpeningHours;
  websiteUri?: string;
  phone?: string;
  googleMapsUri?: string;
  editorialSummary?: string;
  photos?: GooglePlacesPlacePhoto[];
  retrievedAt: string;
  expiresAt: string;
  limitations: string[];
}

/**
 * Normalizes one Google Places API (New) Place Details response into the
 * application-owned detail object, or returns `null` when the payload cannot be
 * a usable detail (missing/blank place id or display name). Optional fields are
 * omitted honestly; invalid optional values are dropped, never guessed; URLs
 * pass through the shared domain `isSafeHttpUrl` contract unchanged.
 */
export function normalizeGooglePlacesPlaceDetail(
  payload: unknown,
  now: string
): GooglePlacesPlaceDetail | null {
  if (!isRecord(payload)) return null;

  const placeId = normalizeGooglePlacesPlaceId(payload['id']);
  if (placeId === null) return null;

  const displayName = isRecord(payload['displayName']) ? payload['displayName'] : undefined;
  const title = readString(displayName?.['text'], 200);
  if (title === undefined) return null;

  const detail: GooglePlacesPlaceDetail = {
    providerId: GOOGLE_PLACES_PROVIDER_ID,
    providerName: GOOGLE_PLACES_PROVIDER_NAME,
    placeId,
    displayName: title,
    retrievedAt: now,
    expiresAt: addGooglePlacesFreshnessWindow(now, GOOGLE_PLACES_RESULT_FRESHNESS_MINUTES),
    limitations: [GOOGLE_PLACES_RESULT_DISCLAIMER],
  };

  const formattedAddress = readString(payload['formattedAddress'], 500);
  if (formattedAddress !== undefined) detail.formattedAddress = formattedAddress;

  const location = isRecord(payload['location']) ? payload['location'] : undefined;
  const latitude = readFiniteCoordinate(location?.['latitude']);
  const longitude = readFiniteCoordinate(location?.['longitude']);
  if (latitude !== undefined && longitude !== undefined) {
    detail.location = { latitude, longitude };
  }

  const primaryType = readString(payload['primaryType'], 100);
  if (primaryType !== undefined) detail.primaryType = primaryType;

  const types = readStringArray(payload['types'], 100);
  if (types !== undefined) detail.types = types;

  const rating = readRating(payload['rating']);
  if (rating !== undefined) detail.rating = rating;

  const ratingCount = readRatingCount(payload['userRatingCount']);
  if (ratingCount !== undefined) detail.userRatingCount = ratingCount;

  const regularHours = readOpeningHours(payload['regularOpeningHours']);
  if (regularHours !== undefined) detail.regularOpeningHours = regularHours;

  const currentHours = readOpeningHours(payload['currentOpeningHours']);
  if (currentHours !== undefined) detail.currentOpeningHours = currentHours;

  const websiteUri = readSafeUrl(payload['websiteUri'], 500);
  if (websiteUri !== undefined) detail.websiteUri = websiteUri;

  const googleMapsUri = readSafeUrl(payload['googleMapsUri'], 500);
  if (googleMapsUri !== undefined) detail.googleMapsUri = googleMapsUri;

  const phone =
    readString(payload['internationalPhoneNumber'], 60) ??
    readString(payload['nationalPhoneNumber'], 60);
  if (phone !== undefined) detail.phone = phone;

  const editorial = isRecord(payload['editorialSummary']) ? payload['editorialSummary'] : undefined;
  const summary = readString(editorial?.['text'], 1000);
  if (summary !== undefined) detail.editorialSummary = summary;

  const photos = readPhotos(payload['photos']);
  if (photos !== undefined) detail.photos = photos;

  return detail;
}

/** Reads only strings that survive the shared domain URL-safety contract. */
function readSafeUrl(value: unknown, maxLength: number): string | undefined {
  const candidate = readString(value, maxLength);
  if (candidate === undefined) return undefined;
  if (!isSafeHttpUrl(candidate)) return undefined;
  return candidate;
}

function readStringArray(value: unknown, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = readString(item, maxLength);
    if (entry === undefined || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  if (out.length === 0) return undefined;
  return out;
}

function readOpeningHours(value: unknown): GooglePlacesPlaceOpeningHours | undefined {
  if (!isRecord(value)) return undefined;
  const out: GooglePlacesPlaceOpeningHours = {};
  if (typeof value['openNow'] === 'boolean') out.openNow = value['openNow'];
  const descriptions = readStringArray(value['weekdayDescriptions'], 200);
  if (descriptions !== undefined) out.weekdayDescriptions = descriptions;
  if (out.openNow === undefined && out.weekdayDescriptions === undefined) return undefined;
  return out;
}

function readDimension(value: unknown): number | undefined {
  const number = requireFiniteNumber(value);
  if (number === null) return undefined;
  if (!Number.isInteger(number) || number < 0 || number > 99999) return undefined;
  return number;
}

function readPhotos(value: unknown): GooglePlacesPlacePhoto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GooglePlacesPlacePhoto[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = readString(item['name'], 300);
    if (name === undefined) continue;
    const photo: GooglePlacesPlacePhoto = { name };
    const width = readDimension(item['widthPx']);
    if (width !== undefined) photo.widthPx = width;
    const height = readDimension(item['heightPx']);
    if (height !== undefined) photo.heightPx = height;
    out.push(photo);
  }
  if (out.length === 0) return undefined;
  return out;
}