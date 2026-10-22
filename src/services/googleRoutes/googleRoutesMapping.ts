/**
 * Google Routes travel-mode vocabulary, bounded input, and normalization
 * mapping (STEP 47).
 *
 * This module owns the only bridge between the application's approved routing
 * input (`origin`, `destination`, `travelMode`) and the Google Routes API
 * `computeRoutes` wire vocabulary, plus the pure, offline-testable translation
 * of a Compute Routes payload into the shared provider-neutral `NormalizedRoute`
 * contract.
 *
 * Rules:
 *
 * 1. **The application-owned input is the source of truth.** A route request
 *    is exactly `{ origin, destination, travelMode }` with exactly one origin
 *    and one destination; unknown keys reject (no provider parameter smuggling);
 *    coordinates are finite and geographic; the travel mode is allowlisted to
 *    `DRIVE | WALK | BICYCLE | TRANSIT` and nothing else.
 * 2. **Hard drop, never fabrication.** A structurally unusable response maps to
 *    `null` — the caller reports a bounded failure. Distance and duration are
 *    preserved from the provider's own numeric fields; nothing is estimated or
 *    rewritten by an LLM.
 * 3. **Beta-mode honesty.** Google documents that walking, bicycling, and
 *    two-wheel routes are Beta and that applications displaying them must show
 *    the applicable warning. The mapping attaches the documented warning
 *    whenever a WALK or BICYCLE route is produced, and the presentation layer
 *    is required to surface it.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import type {
  NormalizedRoute,
  NormalizedRouteLocation,
  NormalizedRouteTravelMode,
} from '../../domain/routes/providerRoutes';
import {
  MAX_NORMALIZED_ROUTE_DISTANCE_METERS,
  MAX_NORMALIZED_ROUTE_DURATION_SECONDS,
  MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH,
  MAX_NORMALIZED_ROUTE_PROVIDER_REFERENCE_LENGTH,
  NORMALIZED_ROUTE_MAX_LATITUDE,
  NORMALIZED_ROUTE_MAX_LONGITUDE,
  NORMALIZED_ROUTE_MIN_LATITUDE,
  NORMALIZED_ROUTE_MIN_LONGITUDE,
  normalizeNormalizedRoute,
} from '../../domain/routes/providerRoutes';
import { GOOGLE_ROUTES_PROVIDER_ID, GOOGLE_ROUTES_PROVIDER_NAME } from './googleRoutesConfig';

/**
 * The application-owned, allowlisted Google travel modes for Compute Routes.
 * Exactly these four are supported; arbitrary provider enum strings never pass.
 */
export type GoogleRoutesTravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT';

export const GOOGLE_ROUTES_TRAVEL_MODES: ReadonlyArray<GoogleRoutesTravelMode> = [
  'DRIVE',
  'WALK',
  'BICYCLE',
  'TRANSIT',
];

export function isGoogleRoutesTravelMode(value: unknown): value is GoogleRoutesTravelMode {
  return (
    typeof value === 'string' &&
    (GOOGLE_ROUTES_TRAVEL_MODES as ReadonlyArray<string>).includes(value)
  );
}

/** Travel mode → provider-neutral vocabulary (fixed table). */
export const GOOGLE_ROUTES_TRAVEL_MODE_TO_NEUTRAL: Readonly<
  Record<GoogleRoutesTravelMode, NormalizedRouteTravelMode>
> = Object.freeze({
  DRIVE: 'drive',
  WALK: 'walk',
  BICYCLE: 'bicycle',
  TRANSIT: 'transit',
});

/** Maps an allowlisted Google travel mode into the neutral route vocabulary. */
export function mapGoogleRoutesTravelMode(
  mode: GoogleRoutesTravelMode
): NormalizedRouteTravelMode {
  return GOOGLE_ROUTES_TRAVEL_MODE_TO_NEUTRAL[mode];
}

/**
 * The bounded, validated read-only route input the provider accepts.
 * `origin`/`destination` reuse the provider-neutral location contract.
 */
export interface GoogleRoutesRouteRequest {
  origin: NormalizedRouteLocation;
  destination: NormalizedRouteLocation;
  travelMode: GoogleRoutesTravelMode;
}

/** The recognized validation problems a Google Routes request can report. */
export type GoogleRoutesRouteRequestProblemCode =
  | 'not-an-object'
  | 'unknown-key'
  | 'invalid-origin'
  | 'origin-latitude-out-of-range'
  | 'origin-longitude-out-of-range'
  | 'invalid-destination'
  | 'destination-latitude-out-of-range'
  | 'destination-longitude-out-of-range'
  | 'invalid-travel-mode';

/** A bounded, user-facing description of one validation problem. */
export interface GoogleRoutesRouteRequestProblem {
  code: GoogleRoutesRouteRequestProblemCode;
  message: string;
  /** Present only for `unknown-key`: the offending key. */
  key?: string;
}

const ALLOWED_GOOGLE_ROUTES_REQUEST_KEYS: ReadonlyArray<string> = [
  'origin',
  'destination',
  'travelMode',
];

interface GoogleRoutesRouteRequestAnalysis {
  request: GoogleRoutesRouteRequest | null;
  problem: GoogleRoutesRouteRequestProblem | null;
}

type GoogleRoutesLocationResult =
  | { ok: true; location: NormalizedRouteLocation }
  | { ok: false; problem: GoogleRoutesRouteRequestProblem };

function normalizeLocationFromGoogle(value: unknown): GoogleRoutesLocationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      problem: { code: 'invalid-origin', message: 'The origin must be a location object.' },
    };
  }

  const latitude = requireFiniteNumber(value.latitude);
  if (latitude === null) {
    return {
      ok: false,
      problem: { code: 'invalid-origin', message: 'The origin latitude must be a finite number.' },
    };
  }
  if (latitude < NORMALIZED_ROUTE_MIN_LATITUDE || latitude > NORMALIZED_ROUTE_MAX_LATITUDE) {
    return {
      ok: false,
      problem: {
        code: 'origin-latitude-out-of-range',
        message: `The origin latitude must be between ${NORMALIZED_ROUTE_MIN_LATITUDE} and ${NORMALIZED_ROUTE_MAX_LATITUDE}.`,
      },
    };
  }

  const longitude = requireFiniteNumber(value.longitude);
  if (longitude === null) {
    return {
      ok: false,
      problem: {
        code: 'invalid-origin',
        message: 'The origin longitude must be a finite number.',
      },
    };
  }
  if (longitude < NORMALIZED_ROUTE_MIN_LONGITUDE || longitude > NORMALIZED_ROUTE_MAX_LONGITUDE) {
    return {
      ok: false,
      problem: {
        code: 'origin-longitude-out-of-range',
        message: `The origin longitude must be between ${NORMALIZED_ROUTE_MIN_LONGITUDE} and ${NORMALIZED_ROUTE_MAX_LONGITUDE}.`,
      },
    };
  }

  return { ok: true, location: { latitude, longitude } };
}

function analyzeGoogleRoutesRouteRequest(value: unknown): GoogleRoutesRouteRequestAnalysis {
  if (!isRecord(value)) {
    return {
      request: null,
      problem: {
        code: 'not-an-object',
        message: 'A Google Routes route request must be an object.',
      },
    };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_GOOGLE_ROUTES_REQUEST_KEYS.includes(key)) {
      return {
        request: null,
        problem: {
          code: 'unknown-key',
          key,
          message: `Google Routes route requests do not accept the field "${key}".`,
        },
      };
    }
  }

  const originResult = normalizeLocationFromGoogle(value.origin);
  if (!originResult.ok) return { request: null, problem: originResult.problem };
  const origin = originResult.location;

  const invalidDestinationProblem = (code: GoogleRoutesRouteRequestProblemCode, message: string) =>
    ({ code, message }) as GoogleRoutesRouteRequestProblem;

  if (!isRecord(value.destination)) {
    return {
      request: null,
      problem: invalidDestinationProblem('invalid-destination', 'The destination must be a location object.'),
    };
  }
  const destinationLatitude = requireFiniteNumber(value.destination.latitude);
  if (destinationLatitude === null) {
    return {
      request: null,
      problem: invalidDestinationProblem('invalid-destination', 'The destination latitude must be a finite number.'),
    };
  }
  if (
    destinationLatitude < NORMALIZED_ROUTE_MIN_LATITUDE ||
    destinationLatitude > NORMALIZED_ROUTE_MAX_LATITUDE
  ) {
    return {
      request: null,
      problem: invalidDestinationProblem(
        'destination-latitude-out-of-range',
        `The destination latitude must be between ${NORMALIZED_ROUTE_MIN_LATITUDE} and ${NORMALIZED_ROUTE_MAX_LATITUDE}.`
      ),
    };
  }
  const destinationLongitude = requireFiniteNumber(value.destination.longitude);
  if (destinationLongitude === null) {
    return {
      request: null,
      problem: invalidDestinationProblem(
        'invalid-destination',
        'The destination longitude must be a finite number.'
      ),
    };
  }
  if (
    destinationLongitude < NORMALIZED_ROUTE_MIN_LONGITUDE ||
    destinationLongitude > NORMALIZED_ROUTE_MAX_LONGITUDE
  ) {
    return {
      request: null,
      problem: invalidDestinationProblem(
        'destination-longitude-out-of-range',
        `The destination longitude must be between ${NORMALIZED_ROUTE_MIN_LONGITUDE} and ${NORMALIZED_ROUTE_MAX_LONGITUDE}.`
      ),
    };
  }
  const destination: NormalizedRouteLocation = {
    latitude: destinationLatitude,
    longitude: destinationLongitude,
  };

  const travelMode = value.travelMode;
  if (!isGoogleRoutesTravelMode(travelMode)) {
    return {
      request: null,
      problem: {
        code: 'invalid-travel-mode',
        message: 'The travel mode is not an approved Google Routes mode.',
      },
    };
  }

  return {
    request: { origin, destination, travelMode },
    problem: null,
  };
}

/** The first validation problem for `value`, or `null` when it is well-formed. */
export function getGoogleRoutesRouteRequestProblem(
  value: unknown
): GoogleRoutesRouteRequestProblem | null {
  return analyzeGoogleRoutesRouteRequest(value).problem;
}

/** Normalizes an untrusted route input into the bounded request, or `null`. */
export function normalizeGoogleRoutesRouteRequest(
  value: unknown
): GoogleRoutesRouteRequest | null {
  return analyzeGoogleRoutesRouteRequest(value).request;
}

/** True only when `value` is a fully valid route request. */
export function isGoogleRoutesRouteRequest(value: unknown): value is GoogleRoutesRouteRequest {
  return normalizeGoogleRoutesRouteRequest(value) !== null;
}

/** Read-only disclaimer stamped on every computed route. */
export const GOOGLE_ROUTES_RESULT_DISCLAIMER =
  'Live provider route calculation - read-only planning estimate; not a booking, reservation, or transport purchase.';

/**
 * The Google-documented Beta warning for walking/bicycling/two-wheel routes.
 * Applications that display WALK or BICYCLE routes must show this warning;
 * these modes must never be presented as equivalent to established driving
 * routes.
 */
export const GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING =
  'Walking, bicycling, and two-wheel routes are in Beta. Treat this route as a planning estimate and verify it before relying on it for navigation.';

/** The Beta warning for active modes, present only for WALK and BICYCLE. */
export function getGoogleRoutesModeWarnings(mode: GoogleRoutesTravelMode): string[] {
  if (mode === 'WALK' || mode === 'BICYCLE') return [GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING];
  return [];
}

/**
 * Parses a Google protobuf-duration style string (`2334s`, `2334.5s`) into
 * machine-safe seconds, or returns `null` when the value is not strictly in
 * that bounded form. Never guesses, never fabricates display text.
 */
export function readGoogleRoutesDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?s$/.test(value)) return null;
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds > MAX_NORMALIZED_ROUTE_DURATION_SECONDS) return null;
  return seconds;
}

/**
 * Maps a raw Google Routes `computeRoutes` response into the provider-neutral
 * `NormalizedRoute`, or returns `null` when the payload cannot be a usable
 * single route (missing `routes`, missing/invalid distance or duration).
 * The validated request supplies the neutral origin, destination, and travel
 * mode (the provider payload never echoes them back). `encodedPolyline` and
 * `routeToken` are preserved only when present and valid; nothing is
 * fabricated. Unknown provider fields never survive the normalization rebuild.
 */
export function mapGoogleRoutesComputeRoutesResponse(
  payload: unknown,
  request: GoogleRoutesRouteRequest
): NormalizedRoute | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload['routes']) || payload['routes'].length === 0) return null;
  const route = payload['routes'][0];
  if (!isRecord(route)) return null;

  const distanceMeters = requireFiniteNumber(route['distanceMeters']);
  if (distanceMeters === null) return null;
  if (
    !Number.isInteger(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > MAX_NORMALIZED_ROUTE_DISTANCE_METERS
  ) {
    return null;
  }

  const durationSeconds = readGoogleRoutesDurationSeconds(route['duration']);
  if (durationSeconds === null) return null;

  const candidate: Record<string, unknown> = {
    providerId: GOOGLE_ROUTES_PROVIDER_ID,
    providerName: GOOGLE_ROUTES_PROVIDER_NAME,
    origin: request.origin,
    destination: request.destination,
    travelMode: mapGoogleRoutesTravelMode(request.travelMode),
    distanceMeters,
    durationSeconds,
    limitations: [GOOGLE_ROUTES_RESULT_DISCLAIMER],
  };

  const polylineContainer = isRecord(route['polyline']) ? route['polyline'] : undefined;
  const encodedPolyline = readString(
    polylineContainer?.['encodedPolyline'],
    MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH
  );
  if (encodedPolyline !== undefined) candidate['encodedPolyline'] = encodedPolyline;

  const providerRouteId = readString(route['routeToken'], MAX_NORMALIZED_ROUTE_PROVIDER_REFERENCE_LENGTH);
  if (providerRouteId !== undefined) candidate['providerRouteId'] = providerRouteId;

  return normalizeNormalizedRoute(candidate);
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