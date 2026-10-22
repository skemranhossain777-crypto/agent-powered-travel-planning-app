/**
 * Google Routes API Compute Routes connection seam (STEP 47).
 *
 * The only module that knows the real Google Routes wire protocol: the fixed
 * read-only `POST /directions/v2:computeRoutes` call against
 * routes.googleapis.com. Everything here is explicitly deterministic and
 * unit-testable offline: all HTTP is performed through an injected
 * `GoogleRoutesTransport` function, so tests hand the connection a fake
 * transport and no network call ever happens in the suite.
 *
 * Contract rules:
 *
 * 1. **Mockable transport only.** No literal `fetch(` call exists in this
 *    module. `createGoogleRoutesFetchTransport` adapts a `fetch` implementation
 *    into the seam for a server/runtime; the seam itself
 *    (`runGoogleRoutesComputeRoutes`) only ever calls the injected transport.
 *    All async failures are captured into the existing STEP 20 safe error
 *    categories — network errors and HTTP-level provider rejections never
 *    surface as raw payloads or stack traces.
 * 2. **Fixed endpoint, method, and field mask.** Every request URL is exactly
 *    `GOOGLE_ROUTES_BASE_URL` plus the fixed computeRoutes path, the method is
 *    always `POST`, and the field mask is a fixed application-owned constant a
 *    client can never supply. A client can never choose a URL, an HTTP method,
 *    or a field mask. There is no Route Matrix, no batch routing, and no
 *    intermediate waypoint fan-out.
 * 3. **Bounded request body.** The validated request carries exactly one
 *    origin and one destination; the serialized body is length-capped so an
 *    oversized payload is refused before any network access.
 * 4. **Secrets never leak.** The API key travels only inside the request
 *    `x-goog-api-key` header envelope and is never part of a result. Nothing
 *    here reads environment variables or the client bundle.
 * 5. **Bounded failures.** A non-2xx status maps to a distinct STEP 20 safe
 *    category (`authentication-required`, `provider-rejected`, `rate-limited`,
 *    `provider-unavailable`); an unparseable body is `malformed-response`.
 *
 * No React, Firebase, Router, Zustand, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { GoogleRoutesConfig } from './googleRoutesConfig';
import type { GoogleRoutesRouteRequest } from './googleRoutesMapping';

/** Fixed base host for the Google Routes API. */
export const GOOGLE_ROUTES_BASE_URL = 'https://routes.googleapis.com';
/** Fixed read-only Compute Routes path (POST only). */
export const GOOGLE_ROUTES_COMPUTE_ROUTES_PATH = '/directions/v2:computeRoutes';

/**
 * The explicit response field mask. Only the fields the application-owned
 * normalized route contract can hold are requested: machine duration and
 * authoritative distance, plus the optional encoded polyline (for a future
 * presentation layer) and the optional provider route token (when Google
 * returns one). The mask is a fixed constant — never client-supplied and never
 * the wildcard `*`.
 */
export const GOOGLE_ROUTES_FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeToken';

/** Upper bound on the serialized request body (defense in depth before I/O). */
export const GOOGLE_ROUTES_MAX_REQUEST_BODY_LENGTH = 4096;

/** A fully-resolved HTTP request the transport executes (read-only POST only). */
export interface GoogleRoutesTransportRequest {
  url: string;
  method: 'POST';
  headers: Readonly<Record<string, string>>;
  body: string;
}

/** A minimal HTTP response the transport resolves with. */
export interface GoogleRoutesTransportResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** The injected network seam: the only place real I/O can happen. */
export type GoogleRoutesTransport = (
  request: GoogleRoutesTransportRequest
) => Promise<GoogleRoutesTransportResponse>;

/** Builds a transport from a `fetch`-shaped implementation (server/runtime use). */
export function createGoogleRoutesFetchTransport(fetchImpl: typeof fetch): GoogleRoutesTransport {
  return async (request: GoogleRoutesTransportRequest): Promise<GoogleRoutesTransportResponse> => {
    const init: RequestInit = { method: request.method, headers: request.headers, body: request.body };
    const response = await fetchImpl(request.url, init);
    return { status: response.status, json: () => response.json() };
  };
}

/**
 * Builds the read-only Compute Routes request for a validated route request.
 * The API key travels only inside the `x-goog-api-key` header; the field mask
 * and method are fixed constants; the URL is fixed; the body holds exactly the
 * validated origin/destination/travelMode (never arbitrary provider JSON).
 * Returns `null` when credentials are missing or the bounded body is oversized.
 * `maxBodyLength` is application-owned cost protection (default
 * `GOOGLE_ROUTES_MAX_REQUEST_BODY_LENGTH`) and is parameterized only so tests
 * can exercise the bound deterministically.
 */
export function buildGoogleRoutesComputeRoutesRequest(
  config: GoogleRoutesConfig,
  request: GoogleRoutesRouteRequest,
  maxBodyLength: number = GOOGLE_ROUTES_MAX_REQUEST_BODY_LENGTH
): GoogleRoutesTransportRequest | null {
  const apiKey = config.credentials?.apiKey;
  if (apiKey === undefined || apiKey === null) return null;

  const bodyText = JSON.stringify({
    origin: {
      location: {
        latLng: { latitude: request.origin.latitude, longitude: request.origin.longitude },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: request.destination.latitude,
          longitude: request.destination.longitude,
        },
      },
    },
    travelMode: request.travelMode,
  });
  if (bodyText.length > maxBodyLength) return null;

  return {
    url: `${GOOGLE_ROUTES_BASE_URL}${GOOGLE_ROUTES_COMPUTE_ROUTES_PATH}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': GOOGLE_ROUTES_FIELD_MASK,
    },
    body: bodyText,
  };
}

/** Outcome of an entire Compute Routes run. */
export type GoogleRoutesComputeResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: ProviderSafeError };

/**
 * Maps a transport HTTP status to a bounded STEP 20 safe error. 401/403 are
 * credential/authentication problems, 400 a provider rejection of the request,
 * 429 a rate limit, 404/5xx an unavailable endpoint/service; anything else
 * falls back to a provider rejection. Never throws.
 */
export function googleRoutesTransportStatusToError(
  status: number,
  fallbackMessage: string
): ProviderSafeError {
  if (status === 401 || status === 403) {
    return {
      category: 'authentication-required',
      message: 'Google Routes rejected the API key or permissions for the route request.',
    };
  }
  if (status === 400) {
    return {
      category: 'provider-rejected',
      message: 'Google Routes rejected the route request.',
    };
  }
  if (status === 429) {
    return {
      category: 'rate-limited',
      message: 'Google Routes rate-limited the route request.',
    };
  }
  if (status >= 500 || status === 404) {
    return {
      category: 'provider-unavailable',
      message: 'Google Routes could not complete the route request.',
    };
  }
  return { category: 'provider-rejected', message: fallbackMessage };
}

async function runGoogleRoutesTransportSafely(
  transport: GoogleRoutesTransport,
  request: GoogleRoutesTransportRequest
): Promise<
  | { ok: true; response: GoogleRoutesTransportResponse }
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
        message: 'Google Routes could not be reached.',
      },
    };
  }
}

async function parseGoogleRoutesResponseBodySafely(
  response: GoogleRoutesTransportResponse
): Promise<{ ok: true; value: unknown } | { ok: false; error: ProviderSafeError }> {
  try {
    const value = await response.json();
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      error: {
        category: 'malformed-response',
        message: 'Google Routes returned an unreadable response body.',
      },
    };
  }
}

/**
 * Runs one read-only Google Routes Compute Routes call for a validated route
 * request via the injected transport, returning a bounded success/failure.
 * Nothing here books, pays, navigates, or persists; no key ever appears in the
 * outcome and the raw provider payload is returned as `unknown` under the
 * `ok: true` branch (the mapping layer normalizes it, never the client).
 */
export async function runGoogleRoutesComputeRoutes(
  config: GoogleRoutesConfig,
  transport: GoogleRoutesTransport,
  request: GoogleRoutesRouteRequest
): Promise<GoogleRoutesComputeResult> {
  const built = buildGoogleRoutesComputeRoutesRequest(config, request);
  if (built === null) {
    return {
      ok: false,
      error: {
        category: 'credentials-missing',
        message: 'Google Routes credentials are not configured.',
      },
    };
  }

  const run = await runGoogleRoutesTransportSafely(transport, built);
  if (!run.ok) return { ok: false, error: run.error };
  if (run.response.status !== 200) {
    return {
      ok: false,
      error: googleRoutesTransportStatusToError(
        run.response.status,
        'Google Routes rejected the route request.'
      ),
    };
  }

  const body = await parseGoogleRoutesResponseBodySafely(run.response);
  if (!body.ok) return { ok: false, error: body.error };

  return { ok: true, payload: body.value };
}