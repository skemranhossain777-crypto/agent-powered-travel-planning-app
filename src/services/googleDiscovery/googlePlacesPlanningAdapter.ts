/**
 * STEP 46 - grounded Google Place -> planning-reference adapter.
 *
 * This module is the ONLY bridge between the STEP 45 normalized Place Detail
 * object and the existing provider-neutral planning-reference contract
 * (`TripPlanningReference`). It transforms one `GooglePlacesPlaceDetail` into a
 * deterministic, planning-safe reference candidate that participates in the
 * existing explicit save/review lifecycle exactly like any other reference.
 *
 * Rules:
 *
 * 1. **Pure and explicit.** The adapter never persists, never assigns a
 *    primary, never inserts into an itinerary, and never touches a workspace.
 *    It produces a candidate; the explicit save path (`updateTripReferences`)
 *    owned by the editor decides whether it is stored. No autosave, no hidden
 *    persistence, no implicit side effects.
 * 2. **Deterministic identity.** The reference id is derived from the Google
 *    Place ID (`google-places:<placeId>`), so adapting the same place twice
 *    always yields the same id and a repeat explicit add cannot silently create
 *    a duplicate reference.
 * 3. **Provenance preserved, not erased.** `provider` is the Google Places
 *    display name and `providerId` is the Google Place ID, so the planning
 *    layer can always distinguish a Google-derived reference from an Amadeus,
 *    mock, or manual/user-created one. Display name, safe source URL, location,
 *    address, and a normalized category/type are carried through only when
 *    Google actually provided them.
 * 4. **No fabrication, no secrets, no raw payload.** Only the fields the
 *    planning contract supports are carried. No API key, no `retrievedAt` /
 *    `expiresAt` freshness window, no rating/photo metadata, no arbitrary
 *    provider JSON, and no Google-only vocabulary leak into the domain. A
 *    resort is never labeled unless Google classified it as one.
 * 5. **Honest rejection.** A detail without a usable place id, display name, or
 *    geographically valid location (both coordinates finite and in range) maps
 *    to `null` — nothing is guessed, defaulted, or repaired.
 *
 * Category semantics: Google place types map onto the existing three planning
 * kinds only where the domain supports them. Lodging types become
 * `accommodation` (a planning reference label only — never a booking, never an
 * automatic assignment); transport infrastructure becomes `transport`;
 * everything else is an `activity`.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import { isSafeHttpUrl } from '../../domain/trips/tripPlanning';
import type { TripPlanningReference } from '../../types/trip';
import { GOOGLE_PLACES_PROVIDER_NAME } from './googlePlacesConfig';
import type { GooglePlacesPlaceDetail } from './googlePlacesMapping';

/**
 * The deterministic, provider-scoped prefix used to derive a reference id from a
 * Google Place ID. The prefix keeps Google-derived ids distinct from
 * user-created editorial ids while remaining a plain, stable string.
 */
export const GOOGLE_PLACES_REFERENCE_ID_PREFIX = 'google-places:';

/** The bounded length of a normalized reference category/type label. */
export const GOOGLE_PLACES_REFERENCE_CATEGORY_MAX_LENGTH = 100;

/** Google place types that resolve to an accommodation-kind planning reference. */
const GOOGLE_PLACES_ACCOMMODATION_TYPES: ReadonlySet<string> = new Set([
  'hotel',
  'resort_hotel',
  'lodging',
  'motel',
  'hostel',
  'bed_and_breakfast',
  'guest_house',
  'campground',
  'rv_park',
]);

/** Google place types that resolve to a transport-kind planning reference. */
const GOOGLE_PLACES_TRANSPORT_TYPES: ReadonlySet<string> = new Set([
  'airport',
  'train_station',
  'bus_station',
  'subway_station',
  'light_rail_station',
  'transit_station',
  'ferry_terminal',
  'taxi_stand',
]);

/**
 * Maps the Google place types into the existing planning-reference kind.
 * `accommodation` is used only for lodging types; `transport` only for transport
 * infrastructure; every other type (including restaurants, museums, parks,
 * landmarks, stores) is an `activity`. A property is never labeled a resort
 * unless Google actually classified it as `resort_hotel`.
 */
export function getGooglePlacesReferenceKind(
  types: ReadonlyArray<string> | undefined
): 'activity' | 'transport' | 'accommodation' {
  if (types === undefined || types.length === 0) {
    return 'activity';
  }
  for (const type of types) {
    if (GOOGLE_PLACES_ACCOMMODATION_TYPES.has(type)) return 'accommodation';
  }
  for (const type of types) {
    if (GOOGLE_PLACES_TRANSPORT_TYPES.has(type)) return 'transport';
  }
  return 'activity';
}

/**
 * The deterministic provider-scoped id for a Google Place ID. Returns `null`
 * for a blank value; a present value is trimmed before prefixing so repeated
 * adaptations of the same place always agree.
 */
export function getGooglePlacesReferenceId(placeId: string): string | null {
  const trimmed = placeId.trim();
  if (trimmed.length === 0) return null;
  return `${GOOGLE_PLACES_REFERENCE_ID_PREFIX}${trimmed}`;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The normalized category/type label carried on the reference, derived from the
 * provider's own primary type (falling back to the first listed type). Bound to
 * `GOOGLE_PLACES_REFERENCE_CATEGORY_MAX_LENGTH`; absent when Google provided no
 * usable type.
 */
function selectGooglePlacesReferenceCategory(
  detail: GooglePlacesPlaceDetail
): string | undefined {
  const candidate = detail.primaryType ?? detail.types?.[0];
  if (candidate === undefined) return undefined;
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, GOOGLE_PLACES_REFERENCE_CATEGORY_MAX_LENGTH);
}

/**
 * Transforms one STEP 45 normalized Place Detail into the existing
 * provider-neutral `TripPlanningReference` contract, or returns `null` when the
 * detail cannot be a safe planning reference (missing identity, missing or
 * geographically invalid location, unsafe Source URL). Never throws, never
 * guesses, never mutates, never persists.
 */
export function adaptGooglePlacesDetailToPlanningReference(
  detail: GooglePlacesPlaceDetail
): TripPlanningReference | null {
  const id = getGooglePlacesReferenceId(detail.placeId);
  if (id === null) return null;

  const title = detail.displayName.trim();
  if (title.length === 0) return null;

  const location = detail.location;
  if (
    location === undefined ||
    !isFiniteCoordinate(location.latitude) ||
    !isFiniteCoordinate(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return null;
  }

  const kind = getGooglePlacesReferenceKind(detail.types);
  const base = {
    id,
    title,
    provider: GOOGLE_PLACES_PROVIDER_NAME,
    providerId: detail.placeId.trim(),
    location: { latitude: location.latitude, longitude: location.longitude },
  };

  const reference: TripPlanningReference =
    kind === 'accommodation'
      ? { ...base, kind: 'accommodation' }
      : kind === 'transport'
        ? { ...base, kind: 'transport' }
        : { ...base, kind: 'activity' };

  if (detail.googleMapsUri !== undefined && isSafeHttpUrl(detail.googleMapsUri)) {
    reference.url = detail.googleMapsUri;
  }

  if (typeof detail.formattedAddress === 'string') {
    const address = detail.formattedAddress.trim();
    if (address.length > 0) reference.address = address;
  }

  const category = selectGooglePlacesReferenceCategory(detail);
  if (category !== undefined) reference.category = category;

  return reference;
}