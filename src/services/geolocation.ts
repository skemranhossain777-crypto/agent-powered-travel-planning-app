import { UserLocation } from '../types/travel';

/**
 * Resolves the user's current location through the browser Geolocation API.
 * Resolves to `null` when permission is denied, the API is unavailable, or the
 * lookup times out — never hardcodes a fallback position.
 */
export function getCurrentLocation(): Promise<UserLocation | null> {
  if (typeof window === 'undefined' || !('geolocation' in window.navigator)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: UserLocation | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };

    const timer = window.setTimeout(() => finish(null), 8000);

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        finish({
          latitude,
          longitude,
          accuracy: accuracy != null ? accuracy : undefined,
          timestamp: position.timestamp || Date.now()
        });
      },
      () => finish(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 600000 }
    );
  });
}

export function describeLocation(location: UserLocation): string {
  const coords = `approximately ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  const accuracy =
    location.accuracy != null ? ` (accuracy ±${Math.round(location.accuracy)}m)` : '';
  return location.label ? `${location.label} — ${coords}${accuracy}` : coords + accuracy;
}