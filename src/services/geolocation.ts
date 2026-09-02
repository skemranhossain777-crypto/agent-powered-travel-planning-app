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
    if (!label && !data.address?.country_code) return location;
    const countryCode = (data.address?.country_code || '').toUpperCase();
    return { ...location, label: label || undefined, countryCode: countryCode || undefined };
  } catch {
    return location;
  }
}

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', EU: 'EUR', DE: 'EUR',
  FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR',
  FI: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  CY: 'EUR', MT: 'EUR', HR: 'EUR', CH: 'CHF', JP: 'JPY', CN: 'CNY', HK: 'HKD', KR: 'KRW',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', MV: 'MVR', BT: 'BTN', AF: 'AFN',
  ID: 'IDR', MY: 'MYR', SG: 'SGD', TH: 'THB', VN: 'VND', PH: 'PHP', MM: 'MMK', KH: 'KHR',
  LA: 'LAK', BN: 'BND', TL: 'USD', AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD',
  OM: 'OMR', JO: 'JOD', LB: 'LBP', IL: 'ILS', TR: 'TRY', EG: 'EGP', NG: 'NGN', ZA: 'ZAR',
  KE: 'KES', GH: 'GHS', TZ: 'TZS', ET: 'ETB', MA: 'MAD', DZ: 'DZD', TN: 'TND', CM: 'XAF',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', VE: 'VES', UY: 'UYU',
  RU: 'RUB', UA: 'UAH', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', SE: 'SEK',
  NO: 'NOK', DK: 'DKK', IS: 'ISK'
};

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩', INR: '₹', PKR: '₨',
  BDT: '৳', THB: '฿', VND: '₫', BRL: 'R$', MXN: '$', AED: 'د.إ', ILS: '₪', TRY: '₺',
  PLN: 'zł', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'Fr', CAD: 'C$', AUD: 'A$', NZD: 'NZ$'
};

export function getCurrencyCode(countryCode?: string): string {
  if (countryCode && COUNTRY_CURRENCY[countryCode]) return COUNTRY_CURRENCY[countryCode];
  return 'USD';
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOL[code] || code;
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