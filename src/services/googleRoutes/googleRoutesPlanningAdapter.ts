/**
 * STEP 48 - Google Routes -> planning-reference adapter.
 *
 * This module is the ONLY bridge between the STEP 47 provider-neutral
 * `NormalizedRoute` contract and the existing provider-neutral
 * `TripPlanningReference` contract. It transforms one normalized route into a
 * deterministic, planning-safe `TripTransportReference` candidate that
 * participates in the existing explicit save/review lifecycle exactly like any
 * other reference. There is intentionally no second route domain model: the
 * neutral route contract (`domain/routes/providerRoutes.ts`) remains the single
 * route shape, and this adapter maps it onto the planning contract.
 *
 * Rules:
 *
 * 1. **Pure and explicit.** The adapter never persists, never assigns a
 *    primary, never inserts into an itinerary, never creates a trip, and never
 *    touches a workspace. It produces a candidate; the explicit save path owned
 *    by the editor decides whether it is stored. No autosave, no hidden
 *    persistence, no implicit side effects.
 * 2. **Deterministic identity.** The reference id is derived only from the
 *    validated route inputs (origin, destination, travel mode) as
 *    `google-routes:<originLat>,<originLng>:<destinationLat>,<destinationLng>:<mode>`.
 *    No timestamps, no randomness, no browser state, no location APIs. The same
 *    route always yields the same reference; a different route yields a
 *    different id.
 * 3. **Provenance preserved, not erased.** `provider` is 'Google Routes', and
 *    `providerId` is carried only when the STEP 47 neutral contract actually
 *    supplied a safe provider route reference. Nothing is invented.
 * 4. **A route is not a place.** The reference kind is `transport`; it carries
 *    `routeOrigin` / `routeDestination`, neutral `mode`, `distanceMeters`,
 *    `durationSeconds`, an optional bounded polyline and optional advisory
 *    warnings. No attraction/hotel/resort category, no destination metadata, no
 *    road/transit-line/provider descriptions, no traffic or travel advisories,
 *    and no fabricated navigation suitability claims.
 * 5. **Honest rejection and secrecy.** Malformed input, missing
 *    origin/destination, unsupported travel modes, invalid/non-finite
 *    coordinates, negative distance, and malformed duration all map to `null`
 *    through the existing `normalizeNormalizedRoute` validator (no duplicated
 *    validation). No arbitrary URL, no raw provider payload, no API key, no
 *    Authorization header, and no raw HTTP response ever cross this boundary.
 *
 * No React, Firebase, Router, Zustand, network, clock, environment access,
 * `any`, or generic `Record<string, any>` escape hatches.
 */

import { GOOGLE_ROUTES_PROVIDER_NAME } from './googleRoutesConfig';
import type { NormalizedRoute } from '../../domain/routes/providerRoutes';
import { normalizeNormalizedRoute } from '../../domain/routes/providerRoutes';
import { isTripPlanningReference } from '../../domain/trips/tripPlanning';
import type { TripPlanningReference } from '../../types/trip';

/**
 * The deterministic, provider-scoped prefix for route-derived reference ids.
 * Keeps Google Routes ids distinct from places (`google-places:`) and from
 * user-created editorial ids while remaining a plain, stable string.
 */
export const GOOGLE_ROUTES_REFERENCE_ID_PREFIX = 'google-routes:';

/**
 * Renders a validated route coordinate deterministically. The input is always a
 * finite number from a normalized route, so `String` is exact and stable; the
 * same coordinate always produces the same id segment. Never raises.
 */
function formatGoogleRoutesCoordinate(value: number): string {
  return String(value);
}

/**
 * The deterministic reference identity for a normalized route, derived only from
 * the validated route inputs. Same inputs -> same id; different origin,
 * destination, or travel mode -> different id. Using only inputs (never
 * timestamps, distance, provider tokens, or randomness) keeps the identity
 * stable across providers and recomputes.
 */
export function getGoogleRoutesReferenceId(
  route: Pick<NormalizedRoute, 'origin' | 'destination'> & { travelMode: string }
): string {
  const segments = [
    formatGoogleRoutesCoordinate(route.origin.latitude),
    formatGoogleRoutesCoordinate(route.origin.longitude),
    formatGoogleRoutesCoordinate(route.destination.latitude),
    formatGoogleRoutesCoordinate(route.destination.longitude),
    route.travelMode,
  ];
  return `${GOOGLE_ROUTES_REFERENCE_ID_PREFIX}${segments.join(':')}`;
}

/**
 * Transforms one STEP 47 provider-neutral route into the existing
 * provider-neutral `TripTransportReference` contract, or returns `null` when the
 * value cannot be a safe planning reference. Validates through the shared
 * `normalizeNormalizedRoute` (no duplicated validation) and confirms the result
 * through the existing `isTripPlanningReference` domain validator before
 * returning it. Never throws, never guesses, never mutates, never persists.
 */
export function adaptNormalizedRouteToPlanningReference(
  value: unknown
): TripPlanningReference | null {
  const route = normalizeNormalizedRoute(value);
  if (route === null) return null;

  const reference: TripPlanningReference = {
    id: getGoogleRoutesReferenceId(route),
    title: `Google Routes ${route.travelMode} route`,
    provider: GOOGLE_ROUTES_PROVIDER_NAME,
    kind: 'transport',
    mode: route.travelMode,
    routeOrigin: route.origin,
    routeDestination: route.destination,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
  };

  if (route.providerRouteId !== undefined) {
    reference.providerId = route.providerRouteId;
  }
  if (route.encodedPolyline !== undefined) {
    reference.encodedPolyline = route.encodedPolyline;
  }
  if (route.warnings !== undefined && route.warnings.length > 0) {
    reference.routeWarnings = [...route.warnings];
  }

  return isTripPlanningReference(reference) ? reference : null;
}