import { describe, expect, it } from 'vitest';
import {
  NORMALIZED_ROUTE_TRAVEL_MODES,
  isNormalizedRoute,
  isNormalizedRouteTravelMode,
  isValidNormalizedRouteLocation,
  normalizeNormalizedRoute,
  normalizeNormalizedRouteLocation,
  type NormalizedRoute,
} from '../domain/routes/providerRoutes';

function validRoute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId: 'provider-x',
    providerName: 'Provider X',
    origin: { latitude: 52.3676, longitude: 4.9041 },
    destination: { latitude: 48.8566, longitude: 2.3522 },
    travelMode: 'drive',
    distanceMeters: 223300,
    durationSeconds: 7560,
    limitations: ['read-only'],
    ...overrides,
  };
}

describe('STEP 47 provider-neutral route contract', () => {
  it('is a fixed neutral vocabulary with no provider-specific strings', () => {
    expect(NORMALIZED_ROUTE_TRAVEL_MODES).toEqual(['drive', 'walk', 'bicycle', 'transit']);
    expect(isNormalizedRouteTravelMode('drive')).toBe(true);
    expect(isNormalizedRouteTravelMode('DRIVE')).toBe(false);
    expect(isNormalizedRouteTravelMode('flight')).toBe(false);
  });

  it('validates locations as finite, geographic coordinate pairs', () => {
    expect(isValidNormalizedRouteLocation({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isValidNormalizedRouteLocation({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isValidNormalizedRouteLocation({ latitude: 90.0001, longitude: 0 })).toBe(false);
    expect(isValidNormalizedRouteLocation({ latitude: 0, longitude: -180.0001 })).toBe(false);
    expect(isValidNormalizedRouteLocation({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isValidNormalizedRouteLocation({ latitude: 0, longitude: Number.POSITIVE_INFINITY })).toBe(false);
    expect(normalizeNormalizedRouteLocation({ latitude: 1.23456789, longitude: 2.1 })).toEqual({
      latitude: 1.23456789,
      longitude: 2.1,
    });
  });

  it('normalizes a fully valid route and preserves optional fields', () => {
    const route = normalizeNormalizedRoute(
      validRoute({
        encodedPolyline: 'abc',
        providerRouteId: 'ref-1',
        warnings: ['beta'],
      })
    );
    expect(route).not.toBeNull();
    expect(isNormalizedRoute(route)).toBe(true);
    expect((route as NormalizedRoute).encodedPolyline).toBe('abc');
    expect((route as NormalizedRoute).providerRouteId).toBe('ref-1');
    expect((route as NormalizedRoute).warnings).toEqual(['beta']);
  });

  it('rebuilds the object and strips unknown provider fields', () => {
    const normalized = normalizeNormalizedRoute(
      validRoute({ apiKey: 'AIzaFAKE', raw: { a: 1 }, googleMapsUri: 'x' })
    );
    expect(normalized).not.toBeNull();
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain('AIzaFAKE');
    expect(serialized).not.toContain('googleMapsUri');
    expect(isNormalizedRoute(normalized)).toBe(true);
  });

  it('rejects invalid required fields honestly (never guesses)', () => {
    expect(normalizeNormalizedRoute(validRoute({ providerId: '' }))).toBeNull();
    expect(normalizeNormalizedRoute(validRoute({ travelMode: 'jetpack' }))).toBeNull();
    expect(normalizeNormalizedRoute(validRoute({ distanceMeters: -1 }))).toBeNull();
    expect(normalizeNormalizedRoute(validRoute({ distanceMeters: 1.5 }))).toBeNull();
    expect(normalizeNormalizedRoute(validRoute({ durationSeconds: Number.NaN }))).toBeNull();
    expect(
      normalizeNormalizedRoute(validRoute({ origin: { latitude: 91, longitude: 0 } }))
    ).toBeNull();
    expect(NORMALIZED_ROUTE_TRAVEL_MODES.length).toBe(4);
  });

  it('enforces the application-owned bounds on distance, duration, and polyline', () => {
    expect(normalizeNormalizedRoute(validRoute({ durationSeconds: 864001 }))).toBeNull();
    expect(normalizeNormalizedRoute(validRoute({ distanceMeters: 100000001 }))).toBeNull();
    // An oversized optional polyline can never survive: it is dropped (the optional
    // field is bounded, and only bounded values are preserved).
    const dropped = normalizeNormalizedRoute(validRoute({ encodedPolyline: 'x'.repeat(30001) }));
    expect(dropped).not.toBeNull();
    const asRoute = dropped as NormalizedRoute;
    expect(asRoute.encodedPolyline).toBeUndefined();
  });
});