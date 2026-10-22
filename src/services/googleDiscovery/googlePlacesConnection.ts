/**
 * Google Places API (New) Nearby Search connection seam (STEP 44).
 *
 * The only module that knows the real Google Places wire protocol: the fixed
 * read-only `POST /v1/places:searchNearby` call and the fixed read-only
 * `GET /v1/places/{id}` Place Details call (STEP 45), both against
 * places.googleapis.com. Everything here is explicitly deterministic and
 * unit-testable offline: all HTTP is performed through an injected
 * `GooglePlacesTransport` function, so tests hand the connection a fake
 * transport and no network call ever happens in the suite.
 *
 * Contract rules:
 *
 * 1. **Mockable transport only.** No literal `fetch(` call exists in this
 *    module. `createGooglePlacesFetchTransport` adapts a `fetch` implementation
 *    into the seam for a server/runtime; the seam itself
 *    (`runGooglePlacesNearbySearch`) only ever calls the injected transport.
 *    All async failures are captured into the existing STEP 20 safe error
 *    categories — network errors and HTTP-level provider rejections never
 *    surface as raw payloads or stack traces.
 * 2. **Fixed host, path, method, field mask, and types.** Every request URL is
 *    exactly `GOOGLE_PLACES_BASE_URL` plus a fixed path (Nearby Search or Place
 *    Details); Nearby Search is always `POST` and Place Details (STEP 45) always
 *    `GET`; field masks are fixed constants (never request-supplied); and
 *    `includedTypes` come only from the mapping's approved category table. A
 *    client can never choose a URL, an HTTP method, a field mask, or a Google
 *    type. No write/mutation operation exists anywhere in this module.
 * 3. **Secrets never leak.** The API key travels only inside the request
 *    `x-goog-api-key` header envelope and is never part of a search outcome.
 *    Nothing here reads environment variables or the client bundle.
 * 4. **Bounded failures.** A non-2xx status maps to a distinct STEP 20 safe
 *    category (`authentication-required`, `provider-rejected`, `rate-limited`,
 *    `provider-unavailable`); an unparseable body is `malformed-response`.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { GooglePlacesDiscoveryConfig } from './googlePlacesConfig';
import type { GooglePlacesNearbyQuery } from './googlePlacesMapping';
import { getGooglePlacesIncludedTypes, normalizeGooglePlacesPlaceId } from './googlePlacesMapping';

/** Fixed base host for the Google Places API (New). */
export const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com';
/** Fixed read-only Nearby Search path (POST only). */
export const GOOGLE_PLACES_NEARBY_SEARCH_PATH = '/v1/places:searchNearby';
/** The fixed result ranking the provider uses for read-only place discovery. */
export const GOOGLE_PLACES_RANK_PREFERENCE = 'POPULARITY';

/**
 * The explicit response field mask. Only the fields needed to normalize the
 * existing discovery contract are requested; the mask is a fixed constant and
 * can never be supplied by a client.
 */
export const GOOGLE_PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.rating,places.userRatingCount,places.googleMapsUri';

/** Fixed read-only Place Details path prefix (GET only). */
export const GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX = '/v1/places/';

/**
 * The explicit Place Details (STEP 45) field mask. Only the fields the
 * application-owned normalized detail object can hold are requested, and the
 * mask is a fixed constant - a client can never supply its own.
 */
export const GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,location,primaryType,types,rating,userRatingCount,regularOpeningHours,currentOpeningHours,websiteUri,internationalPhoneNumber,nationalPhoneNumber,googleMapsUri,editorialSummary,photos';

/** A fully-resolved HTTP request the transport executes (read-only GET/POST only). */
export interface GooglePlacesTransportRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Readonly<Record<string, string>>;
  body?: string;
}

/** A minimal HTTP response the transport resolves with. */
export interface GooglePlacesTransportResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** The injected network seam: the only place real I/O can happen. */
export type GooglePlacesTransport = (
  request: GooglePlacesTransportRequest
) => Promise<GooglePlacesTransportResponse>;

/** Builds a transport from a `fetch`-shaped implementation (server/runtime use). */
export function createGooglePlacesFetchTransport(fetchImpl: typeof fetch): GooglePlacesTransport {
  return async (request: GooglePlacesTransportRequest): Promise<GooglePlacesTransportResponse> => {
    const init: RequestInit = { method: request.method, headers: request.headers };
    if (request.body !== undefined) init.body = request.body;
    const response = await fetchImpl(request.url, init);
    return { status: response.status, json: () => response.json() };
  };
}

/**
 * Builds the read-only Nearby Search request for a validated query. The API
 * key travels only inside the `x-goog-api-key` header; the field mask and
 * `includedTypes` are fixed/approved values. Returns `null` when credentials
 * are missing (a bounded `credentials-missing` gate must handle that before
 * any network access).
 */
export function buildGooglePlacesNearbySearchRequest(
  config: GooglePlacesDiscoveryConfig,
  query: GooglePlacesNearbyQuery
): GooglePlacesTransportRequest | null {
  const apiKey = config.credentials?.apiKey;
  if (apiKey === undefined || apiKey === null) return null;

  const body = JSON.stringify({
    includedTypes: getGooglePlacesIncludedTypes(query.category),
    maxResultCount: query.resultLimit,
    rankPreference: GOOGLE_PLACES_RANK_PREFERENCE,
    locationRestriction: {
      circle: {
        center: { latitude: query.latitude, longitude: query.longitude },
        radius: query.radiusMeters,
      },
    },
  });

  return {
    url: `${GOOGLE_PLACES_BASE_URL}${GOOGLE_PLACES_NEARBY_SEARCH_PATH}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': GOOGLE_PLACES_FIELD_MASK,
    },
    body,
  };
}

/**
 * Builds the fixed read-only Place Details (STEP 45) request for a validated
 * Place ID. The URL is exactly `GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX`
 * followed by a URL-escaped, bounded Place ID; the method is always `GET`; the
 * field mask is the fixed constant; the key travels only in the header. Returns
 * `null` when credentials are missing or the Place ID is not request-safe.
 */
export function buildGooglePlacesPlaceDetailsRequest(
  config: GooglePlacesDiscoveryConfig,
  placeId: string
): GooglePlacesTransportRequest | null {
  const apiKey = config.credentials?.apiKey;
  if (apiKey === undefined || apiKey === null) return null;

  const normalized = normalizeGooglePlacesPlaceId(placeId);
  if (normalized === null) return null;

  return {
    url: `${GOOGLE_PLACES_BASE_URL}${GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX}${encodeURIComponent(normalized)}`,
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK,
    },
  };
}

/** Outcome of parsing a Nearby Search response body. */
export type GooglePlacesNearbySearchParseResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: ProviderSafeError };

/** Parses a Nearby Search response; a non-object body is `malformed-response`. */
export function parseGooglePlacesNearbyResponse(value: unknown): GooglePlacesNearbySearchParseResult {
  if (isRecord(value)) {
    return { ok: true, payload: value };
  }
  return {
    ok: false,
    error: {
      category: 'malformed-response',
      message: 'The Google Places response could not be parsed.',
    },
  };
}

/** Outcome of an entire Nearby Search run. */
export type GooglePlacesNearbySearchResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: ProviderSafeError };

/**
 * Maps a transport HTTP status to a bounded STEP 20 safe error. 401/403 are
 * credential/authentication problems, 400 a provider rejection of the request,
 * 429 a rate limit, 404/5xx an unavailable endpoint/service; anything else
 * falls back to a provider rejection. Never throws.
 */
export function googlePlacesTransportStatusToError(
  status: number,
  fallbackMessage: string
): ProviderSafeError {
  if (status === 401 || status === 403) {
    return {
      category: 'authentication-required',
      message: 'Google Places rejected the API key or permissions for the search request.',
    };
  }
  if (status === 400) {
    return {
      category: 'provider-rejected',
      message: 'Google Places rejected the search request.',
    };
  }
  if (status === 429) {
    return {
      category: 'rate-limited',
      message: 'Google Places rate-limited the search request.',
    };
  }
  if (status >= 500 || status === 404) {
    return {
      category: 'provider-unavailable',
      message: 'Google Places could not complete the search request.',
    };
  }
  return { category: 'provider-rejected', message: fallbackMessage };
}

async function runGooglePlacesTransportSafely(
  transport: GooglePlacesTransport,
  request: GooglePlacesTransportRequest
): Promise<
  | { ok: true; response: GooglePlacesTransportResponse }
  | { ok: false; error: ProviderSafeError }
> {
  try {
    const response = await transport(request);
    return { ok: true, response };
  } catch {
    return {
      ok: false,
      error: {
        category: 'network-error',
        message: 'Google Places could not be reached.',
      },
    };
  }
}

/**
 * Runs one read-only Google Places Nearby Search for a validated query via the
 * injected transport, returning a bounded success/failure. Nothing here books,
 * pays, verifies, or persists; no key ever appears in the outcome.
 */
export async function runGooglePlacesNearbySearch(
  config: GooglePlacesDiscoveryConfig,
  transport: GooglePlacesTransport,
  query: GooglePlacesNearbyQuery
): Promise<GooglePlacesNearbySearchResult> {
  const request = buildGooglePlacesNearbySearchRequest(config, query);
  if (request === null) {
    return {
      ok: false,
      error: {
        category: 'credentials-missing',
        message: 'Google Places credentials are not configured.',
      },
    };
  }

  const run = await runGooglePlacesTransportSafely(transport, request);
  if (!run.ok) return { ok: false, error: run.error };
  if (run.response.status !== 200) {
    return {
      ok: false,
      error: googlePlacesTransportStatusToError(
        run.response.status,
        'Google Places rejected the nearby search request.'
      ),
    };
  }

  const body = await parseGooglePlacesResponseBodySafely(run.response);
  if (!body.ok) return { ok: false, error: body.error };
  const parsed = parseGooglePlacesNearbyResponse(body.value);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return { ok: true, payload: parsed.payload };
}

/** Outcome of an entire Place Details run (STEP 45). */
export type GooglePlacesPlaceDetailsResult = GooglePlacesNearbySearchResult;

/**
 * Runs one read-only Google Places Place Details (STEP 45) retrieval for a
 * validated Place ID via the injected transport. The Place ID is bounded and
 * request-safe, the request shape is fixed (GET, fixed mask, fixed endpoint),
 * and statuses map through the same safe vocabulary as discovery (a 404 falls
 * back to `provider-unavailable`). No key ever appears in the outcome.
 */
export async function runGooglePlacesPlaceDetails(
  config: GooglePlacesDiscoveryConfig,
  transport: GooglePlacesTransport,
  placeId: string
): Promise<GooglePlacesPlaceDetailsResult> {
  if (normalizeGooglePlacesPlaceId(placeId) === null) {
    return {
      ok: false,
      error: {
        category: 'invalid-input',
        message: 'The Google Places place id is not valid.',
      },
    };
  }

  const request = buildGooglePlacesPlaceDetailsRequest(config, placeId);
  if (request === null) {
    return {
      ok: false,
      error: {
        category: 'credentials-missing',
        message: 'Google Places credentials are not configured.',
      },
    };
  }

  const run = await runGooglePlacesTransportSafely(transport, request);
  if (!run.ok) return { ok: false, error: run.error };
  if (run.response.status !== 200) {
    return {
      ok: false,
      error: googlePlacesTransportStatusToError(
        run.response.status,
        'Google Places rejected the place detail request.'
      ),
    };
  }

  const body = await parseGooglePlacesResponseBodySafely(run.response);
  if (!body.ok) return { ok: false, error: body.error };
  const parsed = parseGooglePlacesNearbyResponse(body.value);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return { ok: true, payload: parsed.payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bodies that throw while parsing become a bounded `malformed-response`. */
async function parseGooglePlacesResponseBodySafely(
  response: GooglePlacesTransportResponse
): Promise<{ ok: true; value: unknown } | { ok: false; error: ProviderSafeError }> {
  try {
    const value = await response.json();
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: {
        category: 'malformed-response',
        message: 'Google Places returned an unreadable response body.',
      },
    };
  }
}