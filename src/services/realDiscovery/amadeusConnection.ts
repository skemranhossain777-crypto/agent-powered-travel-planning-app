/**
 * Amadeus Self-Service connection seam (STEP 41).
 *
 * The only module that knows the real Amadeus Hotel Offers wire protocol (OAuth
 * client-credentials token exchange + the read-only `GET /v3/shopping/hotel
 * -offers` search). Everything here is explicitly deterministic and unit-
 * testable offline: all HTTP is performed through an injected `AmadeusTransport`
 * function, so tests hand the connection a fake transport and no network call
 * ever happens in the suite.
 *
 * Contract rules:
 *
 * 1. **Mockable transport only.** No literal `fetch(` call exists in this
 *    module. `createAmadeusFetchTransport` adapts a `fetch` implementation into
 *    the seam for a server/runtime; the seam itself (`runAmadeusHotelSearch`)
 *    only ever calls the injected transport. All async failures are captured
 *    into bounded STEP 20 safe error categories — network errors, timeouts, and
 *    HTTP-level provider rejections never surface as raw payloads or stack
 *    traces.
 * 2. **Secrets never leak.** The token request body is built when the search
 *    runs and carries client id/secret only inside the request envelope; the
 *    access token stays local to the run and is never part of any result.
 *    Nothing here reads environment variables or the client bundle.
 * 3. **Bounded failures.** A non-2xx status maps to a distinct safe category
 *    (`authentication-required`, `rate-limited`, `provider-unavailable`,
 *    `provider-rejected`, ...); an unparseable body is `malformed-response`.
 *    A failed run is a first-class bounded outcome, never a throw.
 * 4. **Read-only.** Only OAuth token + hotel search run; nothing books, pays,
 *    verifies, retrieves a booking, or cancels.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { AmadeusDiscoveryConfig } from './amadeusConfig';

/** Base hosts per environment (sandbox/test is the safe default). */
export const AMADEUS_TEST_BASE_URL = 'https://test.api.amadeus.com';
export const AMADEUS_PRODUCTION_BASE_URL = 'https://api.amadeus.com';
export const AMADEUS_TOKEN_PATH = '/v1/security/oauth2/token';
export const AMADEUS_HOTEL_OFFERS_PATH = '/v3/shopping/hotel-offers';

/** A fully-resolved HTTP request the transport executes. */
export interface AmadeusTransportRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Readonly<Record<string, string>>;
  body?: string;
}

/** A minimal HTTP response the transport resolves with. */
export interface AmadeusTransportResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** The injected network seam: the only place real I/O can happen. */
export type AmadeusTransport = (
  request: AmadeusTransportRequest
) => Promise<AmadeusTransportResponse>;

/** Builds a transport from a `fetch`-shaped implementation (server/runtime use). */
export function createAmadeusFetchTransport(fetchImpl: typeof fetch): AmadeusTransport {
  return async (request: AmadeusTransportRequest): Promise<AmadeusTransportResponse> => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return { status: response.status, json: () => response.json() };
  };
}

/** The base URL a config resolves to (test host on any non-production env). */
export function getAmadeusBaseUrl(config: AmadeusDiscoveryConfig): string {
  return config.credentials?.environment === 'production'
    ? AMADEUS_PRODUCTION_BASE_URL
    : AMADEUS_TEST_BASE_URL;
}

/** Resolves the title-case validator-friendly HTTP method types. */

/**
 * Builds the OAuth2 client-credentials token request for a config. The client
 * id and secret travel only inside the returned request envelope; they are
 * never part of a search outcome. Returns `null` when credentials are missing.
 */
export function buildAmadeusTokenRequest(
  config: AmadeusDiscoveryConfig
): AmadeusTransportRequest | null {
  const credentials = config.credentials;
  if (credentials === null) return null;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  }).toString();
  return {
    url: `${getAmadeusBaseUrl(config)}${AMADEUS_TOKEN_PATH}`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  };
}

/**
 * Builds the read-only hotel-offers search request for a normalized discovery
 * query. Only fields the provider supports are passed; the result limit is
 * honored as an upper bound on what the adapter returns.
 */
export function buildAmadeusHotelSearchRequest(
  config: AmadeusDiscoveryConfig,
  accessToken: string,
  query: TripDiscoveryQuery
): AmadeusTransportRequest {
  const params = new URLSearchParams();
  params.set('cityCode', query.destination);
  if (query.startDate !== undefined) params.set('checkInDate', query.startDate);
  if (query.endDate !== undefined) params.set('checkOutDate', query.endDate);
  if (query.travelerCount !== undefined) params.set('adults', String(query.travelerCount));
  if (query.currency !== undefined) params.set('currency', query.currency);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return {
    url: `${getAmadeusBaseUrl(config)}${AMADEUS_HOTEL_OFFERS_PATH}?${params.toString()}`,
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  };
}

/** Outcome of parsing a token exchange response. */
export type AmadeusTokenParseResult =
  { ok: true; accessToken: string } | { ok: false; error: ProviderSafeError };

/** Parses an OAuth2 token response; a missing/odd token is `malformed-response`. */
export function parseAmadeusTokenResponse(value: unknown): AmadeusTokenParseResult {
  if (isRecord(value)) {
    const accessToken = value.access_token;
    if (typeof accessToken === 'string' && accessToken.trim().length > 0) {
      return { ok: true, accessToken: accessToken.trim() };
    }
  }
  return {
    ok: false,
    error: {
      category: 'malformed-response',
      message: 'The Amadeus token response could not be parsed.',
    },
  };
}

/** Outcome of parsing a hotel-offers search response. */
export type AmadeusHotelSearchParseResult =
  { ok: true; payload: unknown } | { ok: false; error: ProviderSafeError };

/** Parses a hotel-offers response; an unusable body is `malformed-response`. */
export function parseAmadeusHotelSearchResponse(value: unknown): AmadeusHotelSearchParseResult {
  if (isRecord(value) && Array.isArray(value['data'])) {
    return { ok: true, payload: value };
  }
  return {
    ok: false,
    error: {
      category: 'malformed-response',
      message: 'The Amadeus hotel search response could not be parsed.',
    },
  };
}

/** Outcome of an entire token + search run. */
export type AmadeusHotelSearchResult =
  { ok: true; payload: unknown } | { ok: false; error: ProviderSafeError };

/**
 * Maps a transport HTTP status to a bounded safe error. 401/403 are
 * authentication problems, 400 a provider rejection of the request, 429 a rate
 * limit, 404/5xx an unavailable endpoint/service; anything else falls back to a
 * provider rejection. Never throws.
 */
export function transportStatusToError(status: number, fallbackMessage: string): ProviderSafeError {
  if (status === 401 || status === 403) {
    return {
      category: 'authentication-required',
      message: 'The provider could not authenticate the search request.',
    };
  }
  if (status === 400) {
    return {
      category: 'provider-rejected',
      message: 'The provider rejected the search request.',
    };
  }
  if (status === 429) {
    return {
      category: 'rate-limited',
      message: 'The provider rate-limited the search request.',
    };
  }
  if (status >= 500 || status === 404) {
    return {
      category: 'provider-unavailable',
      message: 'The provider could not complete the search request.',
    };
  }
  return { category: 'provider-rejected', message: fallbackMessage };
}

async function runTransportSafely(
  transport: AmadeusTransport,
  request: AmadeusTransportRequest
): Promise<
  { ok: true; response: AmadeusTransportResponse } | { ok: false; error: ProviderSafeError }
> {
  try {
    const response = await transport(request);
    return { ok: true, response };
  } catch {
    return {
      ok: false,
      error: {
        category: 'network-error',
        message: 'The provider could not be reached.',
      },
    };
  }
}

/**
 * Runs the full read-only Amadeus discovery search: token exchange, then the
 * hotel-offers query, returning a bounded success/failure. Nothing here books,
 * pays, verifies, or persists; no secrets ever appear in the outcome.
 */
export async function runAmadeusHotelSearch(
  config: AmadeusDiscoveryConfig,
  transport: AmadeusTransport,
  query: TripDiscoveryQuery
): Promise<AmadeusHotelSearchResult> {
  const tokenRequest = buildAmadeusTokenRequest(config);
  if (tokenRequest === null) {
    return {
      ok: false,
      error: {
        category: 'credentials-missing',
        message: 'Amadeus credentials are not configured.',
      },
    };
  }

  const tokenRun = await runTransportSafely(transport, tokenRequest);
  if (!tokenRun.ok) return { ok: false, error: tokenRun.error };
  if (tokenRun.response.status !== 200) {
    return {
      ok: false,
      error: transportStatusToError(
        tokenRun.response.status,
        'The provider rejected the credential exchange.'
      ),
    };
  }
  const tokenBody = await parseResponseBodySafely(tokenRun.response);
  if (!tokenBody.ok) return { ok: false, error: tokenBody.error };
  const token = parseAmadeusTokenResponse(tokenBody.value);
  if (!token.ok) return { ok: false, error: token.error };

  const searchRequest = buildAmadeusHotelSearchRequest(config, token.accessToken, query);
  const searchRun = await runTransportSafely(transport, searchRequest);
  if (!searchRun.ok) return { ok: false, error: searchRun.error };
  if (searchRun.response.status !== 200) {
    return {
      ok: false,
      error: transportStatusToError(
        searchRun.response.status,
        'The provider rejected the hotel search request.'
      ),
    };
  }
  const searchBody = await parseResponseBodySafely(searchRun.response);
  if (!searchBody.ok) return { ok: false, error: searchBody.error };
  const parsed = parseAmadeusHotelSearchResponse(searchBody.value);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return { ok: true, payload: parsed.payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bodies that throw while parsing become a bounded `malformed-response`. */
async function parseResponseBodySafely(
  response: AmadeusTransportResponse
): Promise<{ ok: true; value: unknown } | { ok: false; error: ProviderSafeError }> {
  try {
    const value = await response.json();
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: {
        category: 'malformed-response',
        message: 'The provider returned an unreadable response body.',
      },
    };
  }
}
