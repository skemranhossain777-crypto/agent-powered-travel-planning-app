/**
 * Pure, provider-independent normalized route contract (STEP 47).
 *
 * A Google Routes (or any future routing provider) result must map into this
 * single neutral `NormalizedRoute` shape before it can be consumed anywhere —
 * the app never speaks a provider's raw route vocabulary. Deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. **A computed route is factual, transient provider output.** It is never a
 *    booking, a navigation instruction, a reservation, or a purchase. Nothing
 *    here saves routes, mutates itinerary items, modifies planning references,
 *    assigns primary references, or initiates navigation.
 * 2. **Provider-neutral.** The travel mode is a fixed neutral vocabulary
 *    (`drive` | `walk` | `bicycle` | `transit`); a provider maps its own
 *    allowlisted mode strings into this vocabulary and never passes arbitrary
 *    provider enum strings through.
 * 3. **Authoritative numbers only.** `distanceMeters` and `durationSeconds`
 *    are preserved as deterministic, machine-safe values derived from the
 *    provider's own numeric fields (the strict protobuf-style duration string
 *    is parsed, never fabricated or guessed by an LLM). Localized display text
 *    is a presentation-layer concern and is never created here.
 * 4. **Bounded and rebuilt.** Every string is trimmed and bounded; coordinates
 *    are finite and geographic; distance/duration are bounded; the polyline is
 *    a provider-owned bounded string and is never decoded or reconstructed
 *    here. Normalization rebuilds the object from an allowlist of keys, so a
 *    provider's raw payload (including any credentials) can never leak through.
 * 5. **Explicit optionality.** `encodedPolyline` and `providerRouteId` are
 *    present only when the provider returned them and they passed validation.
 *
 * This family lives in its own `domain/routes/` file so the
 * `domain/providers/` inventory stays untouched. The Google Routes service
 * scope owns `googleRoutesMapping.ts`, which imports and enforces this
 * contract.
 */

/** The fixed, provider-neutral route travel-mode vocabulary. */
export type NormalizedRouteTravelMode = 'drive' | 'walk' | 'bicycle' | 'transit';

export const NORMALIZED_ROUTE_TRAVEL_MODES: ReadonlyArray<NormalizedRouteTravelMode> = [
  'drive',
  'walk',
  'bicycle',
  'transit',
];

/** A bounded geographic coordinate pair (both finite and in range). */
export interface NormalizedRouteLocation {
  latitude: number;
  longitude: number;
}

/** Application-owned bounds for a normalized route (independent of provider caps). */
export const NORMALIZED_ROUTE_MIN_LATITUDE = -90;
export const NORMALIZED_ROUTE_MAX_LATITUDE = 90;
export const NORMALIZED_ROUTE_MIN_LONGITUDE = -180;
export const NORMALIZED_ROUTE_MAX_LONGITUDE = 180;
/** Upper bound on the authoritative distance in meters (100,000 km). */
export const MAX_NORMALIZED_ROUTE_DISTANCE_METERS = 100_000_000;
/** Upper bound on the authoritative duration in seconds (10 days). */
export const MAX_NORMALIZED_ROUTE_DURATION_SECONDS = 864_000;
/** Upper bound on an encoded polyline string (never persisted unsized). */
export const MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH = 30_000;
/** Upper bound on a provider route reference identifier. */
export const MAX_NORMALIZED_ROUTE_PROVIDER_REFERENCE_LENGTH = 200;
/** Per-note bound for limitations/warnings, aligned with STEP 20. */
export const MAX_NORMALIZED_ROUTE_NOTE_LENGTH = 200;

/**
 * The single normalized shape a routing provider result maps into. Optional
 * fields are present only when the provider returned them and they passed
 * validation. A route is a transient planning estimate, never a booking.
 */
export interface NormalizedRoute {
  /** Provider key used by the adapter layer (bounded). */
  providerId: string;
  /** Human-readable provider label for display only (bounded). */
  providerName: string;
  /** The validated origin coordinate pair. */
  origin: NormalizedRouteLocation;
  /** The validated destination coordinate pair. */
  destination: NormalizedRouteLocation;
  /** The provider-neutral, allowlisted travel mode. */
  travelMode: NormalizedRouteTravelMode;
  /** Authoritative numeric distance in meters, preserved from the provider. */
  distanceMeters: number;
  /** Authoritative numeric duration in seconds, derived strictly from the provider. */
  durationSeconds: number;
  /** Optional provider-owned encoded polyline (bounded; never decoded here). */
  encodedPolyline?: string;
  /** Optional provider route reference when the provider returns a safe one. */
  providerRouteId?: string;
  /** Optional user-facing limitations (each trimmed and bounded). */
  limitations: string[];
  /** Optional user-facing warnings (each trimmed and bounded). */
  warnings?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/** True when `value` is a usable fixed-size neutral travel mode. */
export function isNormalizedRouteTravelMode(value: unknown): value is NormalizedRouteTravelMode {
  return (
    typeof value === 'string' &&
    (NORMALIZED_ROUTE_TRAVEL_MODES as ReadonlyArray<string>).includes(value)
  );
}

function normalizeLocation(value: unknown): NormalizedRouteLocation | null {
  if (!isRecord(value)) return null;
  const latitude = requireFiniteNumber(value.latitude);
  if (latitude === null) return null;
  if (latitude < NORMALIZED_ROUTE_MIN_LATITUDE || latitude > NORMALIZED_ROUTE_MAX_LATITUDE) {
    return null;
  }
  const longitude = requireFiniteNumber(value.longitude);
  if (longitude === null) return null;
  if (longitude < NORMALIZED_ROUTE_MIN_LONGITUDE || longitude > NORMALIZED_ROUTE_MAX_LONGITUDE) {
    return null;
  }
  return { latitude, longitude };
}

/** Validates an untrusted location against the bounded geographic contract. */
export function isValidNormalizedRouteLocation(value: unknown): value is NormalizedRouteLocation {
  return normalizeLocation(value) !== null;
}

/** Normalizes an untrusted location, or returns `null` when it is not usable. */
export function normalizeNormalizedRouteLocation(
  value: unknown
): NormalizedRouteLocation | null {
  return normalizeLocation(value);
}

function optionalStringArray(value: unknown, maxLength: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > maxLength) return null;
    out.push(trimmed);
  }
  return out;
}

/**
 * Normalizes an untrusted value into the bounded, provider-neutral
 * `NormalizedRoute`, or returns `null` when the shape cannot be honored. The
 * object is rebuilt from an allowlist of keys so unknown/extra fields (raw
 * provider data, credentials) never survive. Required fields must all be valid;
 * invalid optional fields are dropped. Never throws.
 */
export function normalizeNormalizedRoute(value: unknown): NormalizedRoute | null {
  if (!isRecord(value)) return null;

  const providerId = requireString(value.providerId, 100);
  const providerName = requireString(value.providerName, 100);
  if (providerId === null || providerName === null) return null;

  const origin = normalizeLocation(value.origin);
  if (origin === null) return null;
  const destination = normalizeLocation(value.destination);
  if (destination === null) return null;

  if (!isNormalizedRouteTravelMode(value.travelMode)) return null;

  const distanceMeters = requireFiniteNumber(value.distanceMeters);
  if (distanceMeters === null) return null;
  if (
    !Number.isInteger(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > MAX_NORMALIZED_ROUTE_DISTANCE_METERS
  ) {
    return null;
  }

  const durationSeconds = requireFiniteNumber(value.durationSeconds);
  if (durationSeconds === null) return null;
  if (durationSeconds < 0 || durationSeconds > MAX_NORMALIZED_ROUTE_DURATION_SECONDS) {
    return null;
  }

  const limitations = optionalStringArray(value.limitations, MAX_NORMALIZED_ROUTE_NOTE_LENGTH);
  if (limitations === null) return null;
  const warnings = optionalStringArray(value.warnings, MAX_NORMALIZED_ROUTE_NOTE_LENGTH);
  if (warnings === null) return null;

  const route: NormalizedRoute = {
    providerId,
    providerName,
    origin,
    destination,
    travelMode: value.travelMode as NormalizedRouteTravelMode,
    distanceMeters,
    durationSeconds,
    limitations,
  };
  if (warnings.length > 0) route.warnings = warnings;

  const encodedPolyline = requireString(
    value.encodedPolyline,
    MAX_NORMALIZED_ROUTE_POLYLINE_LENGTH
  );
  if (encodedPolyline !== null) route.encodedPolyline = encodedPolyline;

  const providerRouteId = requireString(
    value.providerRouteId,
    MAX_NORMALIZED_ROUTE_PROVIDER_REFERENCE_LENGTH
  );
  if (providerRouteId !== null) route.providerRouteId = providerRouteId;

  return route;
}

/** True only when `value` is a fully valid normalized route. */
export function isNormalizedRoute(value: unknown): value is NormalizedRoute {
  return normalizeNormalizedRoute(value) !== null;
}