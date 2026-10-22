import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currencySymbol,
  describeLocation,
  getCurrencyCode,
  getCurrentLocation,
  reverseGeocode,
} from '../services/geolocation';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as unknown as Response;
}

function removeGeolocation(): void {
  Reflect.deleteProperty(window.navigator, 'geolocation');
}

describe('getCurrencyCode', () => {
  it('maps known country codes to their currency', () => {
    expect(getCurrencyCode('US')).toBe('USD');
    expect(getCurrencyCode('BD')).toBe('BDT');
    expect(getCurrencyCode('TL')).toBe('USD');
  });

  it('falls back to USD for unknown or missing codes', () => {
    expect(getCurrencyCode('XX')).toBe('USD');
    expect(getCurrencyCode()).toBe('USD');
  });
});

describe('currencySymbol', () => {
  it('maps known codes to symbols', () => {
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('JPY')).toBe('¥');
  });

  it('returns the code itself for unknown currencies', () => {
    expect(currencySymbol('XPT')).toBe('XPT');
  });
});

describe('describeLocation', () => {
  it('uses the label when present', () => {
    const location = { latitude: 41.9, longitude: 12.5, label: 'Rome, Italy', timestamp: 0 };
    expect(describeLocation(location)).toBe('Rome, Italy');
  });

  it('falls back to rounded coordinates', () => {
    const location = { latitude: 41.90278, longitude: 12.49636, timestamp: 0 };
    expect(describeLocation(location)).toBe('approximately 41.9028, 12.4964');
  });

  it('includes accuracy when provided', () => {
    const location = { latitude: 41.9, longitude: 12.5, accuracy: 12.3, timestamp: 0 };
    expect(describeLocation(location)).toBe('approximately 41.9000, 12.5000 (accuracy ±12m)');
  });
});

describe('getCurrentLocation', () => {
  afterEach(() => {
    removeGeolocation();
    vi.useRealTimers();
  });

  it('resolves null when the Geolocation API is unavailable', async () => {
    removeGeolocation();
    await expect(getCurrentLocation()).resolves.toBeNull();
  });

  it('resolves the position from the browser API on success', async () => {
    const position = {
      coords: { latitude: 40.73061, longitude: -73.935242, accuracy: 5 },
      timestamp: 1234567890,
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (onSuccess: PositionCallback) =>
          onSuccess(position as GeolocationPosition),
      },
      configurable: true,
    });
    const result = await getCurrentLocation();
    expect(result).toMatchObject({
      latitude: 40.73061,
      longitude: -73.935242,
      accuracy: 5,
      timestamp: 1234567890,
    });
  });

  it('resolves null when the user denies geolocation', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_onSuccess: PositionCallback, onError: PositionErrorCallback) =>
          onError({
            code: 1,
            message: 'denied',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
      },
      configurable: true,
    });
    await expect(getCurrentLocation()).resolves.toBeNull();
  });

  it('resolves null when the location lookup times out', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'geolocation', {
      value: {
        getCurrentPosition: () => {
          // The browser never responds → the 8s timeout must resolve null.
        },
      },
      configurable: true,
    });
    const pending = getCurrentLocation();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('reverseGeocode', () => {
  it('returns the location unchanged when it already has a label', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const location = { latitude: 1, longitude: 2, label: 'Singapore', timestamp: 0 };
    const result = await reverseGeocode(location);
    expect(result).toBe(location);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('attaches a label and country code from Nominatim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          address: {
            city: 'Kyoto',
            state: 'Kyoto Prefecture',
            country: 'Japan',
            country_code: 'jp',
          },
        })
      )
    );
    const base = { latitude: 35.0116, longitude: 135.7681, timestamp: 0 };
    const result = await reverseGeocode(base);
    expect(result.label).toContain('Kyoto');
    expect(result.countryCode).toBe('JP');
    expect(result.latitude).toBe(base.latitude);
  });

  it('returns the original location on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, false))
    );
    const base = { latitude: 10, longitude: 20, timestamp: 0 };
    await expect(reverseGeocode(base)).resolves.toBe(base);
  });

  it('returns the original location when the network call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const base = { latitude: 10, longitude: 20, timestamp: 0 };
    await expect(reverseGeocode(base)).resolves.toBe(base);
  });

  it('returns the original location when no label or country code is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ address: {} }))
    );
    const base = { latitude: 10, longitude: 20, timestamp: 0 };
    await expect(reverseGeocode(base)).resolves.toBe(base);
  });
});
