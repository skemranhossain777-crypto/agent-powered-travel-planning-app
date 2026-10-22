import { describe, expect, it } from 'vitest';
import { isTripPlanningReference } from '../domain/trips/tripPlanning';
import { normalizeTripPlanningUpdate } from '../domain/trips/tripPlanningEdit';
import type { TripPlanningReference } from '../types/trip';
import { GOOGLE_PLACES_PROVIDER_NAME } from '../services/googleDiscovery/googlePlacesConfig';
import type { GooglePlacesPlaceDetail } from '../services/googleDiscovery/googlePlacesMapping';
import {
  GOOGLE_PLACES_REFERENCE_ID_PREFIX,
  adaptGooglePlacesDetailToPlanningReference,
  getGooglePlacesReferenceId,
  getGooglePlacesReferenceKind,
} from '../services/googleDiscovery/googlePlacesPlanningAdapter';

const NOW = '2026-09-13T08:00:00.000Z';

const VALID_PLACE_ID = 'ChIJj61dQgK6j4AR4GeTYWZsKWw';

function detail(overrides: Partial<GooglePlacesPlaceDetail> = {}): GooglePlacesPlaceDetail {
  return {
    providerId: 'google-places',
    providerName: 'Google Places',
    placeId: VALID_PLACE_ID,
    displayName: 'Rijksmuseum',
    formattedAddress: 'Museumstraat 1, 1071 XX Amsterdam, Netherlands',
    location: { latitude: 52.36, longitude: 4.885 },
    primaryType: 'museum',
    types: ['museum', 'tourist_attraction', 'point_of_interest', 'establishment'],
    googleMapsUri: 'https://maps.google.com/?cid=1234',
    retrievedAt: NOW,
    expiresAt: '2026-09-13T09:00:00.000Z',
    limitations: ['Live provider place result - read-only discovery reference; not a booking.'],
    ...overrides,
  } as GooglePlacesPlaceDetail;
}

function adapted(overrides: Partial<GooglePlacesPlaceDetail> = {}): TripPlanningReference | null {
  return adaptGooglePlacesDetailToPlanningReference(detail(overrides));
}

describe('STEP 46 Google Place -> planning-reference adapter', () => {
  it('adapts a valid museum detail into a provider-neutral planning reference', () => {
    const reference = adapted();
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(reference.id).toBe(`${GOOGLE_PLACES_REFERENCE_ID_PREFIX}${VALID_PLACE_ID}`);
    expect(reference.title).toBe('Rijksmuseum');
    expect(reference.kind).toBe('activity');
    expect(reference.provider).toBe(GOOGLE_PLACES_PROVIDER_NAME);
    expect(reference.providerId).toBe(VALID_PLACE_ID);
    expect(reference.url).toBe('https://maps.google.com/?cid=1234');
    expect(reference.location).toEqual({ latitude: 52.36, longitude: 4.885 });
    expect(reference.address).toBe('Museumstraat 1, 1071 XX Amsterdam, Netherlands');
    expect(reference.category).toBe('museum');
  });

  it('produces a reference the existing domain contract accepts', () => {
    const reference = adapted();
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(isTripPlanningReference(reference)).toBe(true);
    expect(normalizeTripPlanningUpdate({ references: [reference] })).toEqual({
      references: [reference],
    });
  });

  it('is deterministic: the same place always yields the same id (dedup-safe)', () => {
    const first = adapted();
    const second = adapted();
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(`${GOOGLE_PLACES_REFERENCE_ID_PREFIX}${VALID_PLACE_ID}`);
    expect(getGooglePlacesReferenceId(`  ${VALID_PLACE_ID}  `)).toBe(
      getGooglePlacesReferenceId(VALID_PLACE_ID)
    );
  });

  it('rejects a blank place id and a blank display name', () => {
    expect(getGooglePlacesReferenceId('   ')).toBeNull();
    expect(adapted({ placeId: '' })).toBeNull();
    expect(adapted({ displayName: '   ' })).toBeNull();
  });

  it('rejects a missing or geographically invalid location, never guessing', () => {
    expect(adapted({ location: undefined })).toBeNull();
    expect(adapted({ location: { latitude: 95, longitude: 4.885 } })).toBeNull();
    expect(adapted({ location: { latitude: -95, longitude: 4.885 } })).toBeNull();
    expect(adapted({ location: { latitude: 52.36, longitude: -200 } })).toBeNull();
    expect(adapted({ location: { latitude: 52.36, longitude: 200 } })).toBeNull();
    expect(adapted({ location: { latitude: Number.NaN, longitude: 4.885 } })).toBeNull();
    expect(adapted({ location: { latitude: Number.POSITIVE_INFINITY, longitude: 4.885 } })).toBeNull();
  });

  it('maps lodging types to accommodation and never fabricates resort status', () => {
    const hotel = adapted({
      displayName: 'Padi Hotel',
      primaryType: 'hotel',
      types: ['hotel', 'lodging', 'point_of_interest'],
    });
    expect(hotel?.kind).toBe('accommodation');
    expect(hotel?.category).toBe('hotel');

    const resort = adapted({
      displayName: 'Nusa Resort',
      primaryType: 'resort_hotel',
      types: ['resort_hotel', 'lodging'],
    });
    expect(resort?.kind).toBe('accommodation');
    expect(resort?.category).toBe('resort_hotel');
  });

  it('maps transport infrastructure to transport and everything else to activity', () => {
    expect(
      adapted({ displayName: 'Schiphol', primaryType: 'airport', types: ['airport'] })?.kind
    ).toBe('transport');
    expect(adapted({ displayName: 'Metro', types: ['subway_station'] })?.kind).toBe('transport');
    expect(adapted({ displayName: 'Cafe', primaryType: 'cafe', types: ['cafe'] })?.kind).toBe(
      'activity'
    );
    expect(adapted({ displayName: 'Park', types: ['park'] })?.kind).toBe('activity');
  });

  it('omits optional fields honestly when Google did not provide them', () => {
    const reference = adapted({
      googleMapsUri: undefined,
      formattedAddress: undefined,
      types: undefined,
      primaryType: undefined,
    });
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(reference.url).toBeUndefined();
    expect(reference.address).toBeUndefined();
    expect(reference.category).toBeUndefined();
    expect(reference.kind).toBe('activity');
  });

  it('never carries an unsafe URL, an API key, or provider-internal payload fields', () => {
    const reference = adapted({
      googleMapsUri: 'javascript:alert(1)',
    });
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(reference.url).toBeUndefined();

    const persisted = JSON.stringify(reference);
    expect(persisted).not.toContain('AIza');
    expect(persisted).not.toContain('retrievedAt');
    expect(persisted).not.toContain('expiresAt');
    expect(persisted).not.toContain('limitations');
    expect(persisted).not.toContain('photos');
    expect(persisted.length).toBeLessThan(1500);
  });

  it('never assigns a day number and never touches planning-lifecycle fields', () => {
    const reference = adapted();
    expect(reference).not.toBeNull();
    if (reference === null) return;
    const keys = Object.keys(reference);
    expect(keys).not.toContain('dayNumber');
    expect(keys).not.toContain('checkInDate');
    expect(keys).not.toContain('checkOutDate');
    expect(keys).not.toContain('mode');
    expect(keys).not.toContain('estimatedCost');
    expect(keys).not.toContain('lifecycleState');
  });

  it('exposes a stable closed kind vocabulary', () => {
    expect(getGooglePlacesReferenceKind(undefined)).toBe('activity');
    expect(getGooglePlacesReferenceKind([])).toBe('activity');
    expect(getGooglePlacesReferenceKind(['restaurant', 'point_of_interest'])).toBe('activity');
    expect(getGooglePlacesReferenceKind(['lodging', 'hotel'])).toBe('accommodation');
  });
});