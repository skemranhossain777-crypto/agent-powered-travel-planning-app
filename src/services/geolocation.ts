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

export async function reverseGeocode(location: UserLocation): Promise<UserLocation> {
  if (location.label) return location;
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.latitude}&lon=${location.longitude}&zoom=14&addressdetails=1`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    window.clearTimeout(timer);
    if (!res.ok) return location;
    const data = await res.json();
    const label = formatPlaceName(data.address);
    if (!label) return location;
    return { ...location, label };
  } catch {
    return location;
  }
}

function formatPlaceName(addr?: Record<string, string>): string {
  if (!addr) return '';
  const parts: string[] = [];
  if (addr.city) parts.push(addr.city);
  if (addr.town) parts.push(addr.town);
  if (addr.village) parts.push(addr.village);
  if (addr.municipality) parts.push(addr.municipality);
  if (addr.state) parts.push(addr.state);
  if (addr.country) parts.push(addr.country);
  // De-duplicate and cap length
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.slice(0, 3).join(', ');
}

export function describeLocation(location: UserLocation): string {
  if (location.label) return location.label;
  const coords = `approximately ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  const accuracy =
    location.accuracy != null ? ` (accuracy ±${Math.round(location.accuracy)}m)` : '';
  return coords + accuracy;
}