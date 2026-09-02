import { Place } from '../types/travel';

const WIKI_API =
  'https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json' +
  '&generator=search&gsrnamespace=0&gsrlimit=5';

const cache = new Map<string, string | null>();

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function placeKey(name: string, city: string): string {
  return `${name.trim().toLowerCase()}|${city.trim().toLowerCase()}`;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<Record<string, any> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as Record<string, any>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function matchesPlace(
  page: any,
  name: string,
  city: string,
  country: string
): boolean {
  const title = (page?.title || '').toLowerCase();
  const nameLower = name.trim().toLowerCase();
  const snippet = (page?.extract || '').toLowerCase();

  // Exact title, or a disambiguation page for the same name ("X (restaurant)").
  if (title === nameLower || title.startsWith(`${nameLower} (`)) {
    return true;
  }

  // Otherwise the article must at least mention the city or the country.
  const targets = [city, country]
    .map((s) => s?.trim().toLowerCase())
    .filter((s): s is string => !!s && s.length > 2);
  return targets.some((t) => snippet.includes(t));
}

async function lookupWikipedia(
  name: string,
  city: string,
  country: string
): Promise<string | null> {
  const query = `${name} ${city} ${country}`.trim().slice(0, 120);
  const data = await fetchJson(
    `${WIKI_API}&gsrsearch=${encodeURIComponent(query)}` +
      `&prop=pageimages|extracts&piprop=thumbnail&pithumbsize=720&explaintext=&exsentences=2`
  );
  const pages = data?.query?.pages;
  if (!pages) {
    return null;
  }
  const candidates = Object.values(pages) as any[];
  candidates.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  for (const page of candidates) {
    if (!matchesPlace(page, name, city, country)) {
      continue;
    }
    const thumb = page?.thumbnail?.source;
    if (thumb) {
      return thumb;
    }
  }
  return null;
}

export async function resolvePlaceImageUrl(
  name: string,
  city: string,
  country: string
): Promise<string | null> {
  const key = placeKey(name, city);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let url = await lookupWikipedia(name, city, country);

  cache.set(key, url);
  setTimeout(() => cache.delete(key), CACHE_TTL_MS);
  return url;
}

export async function enrichPlacesWithImages(places: Place[]): Promise<Place[]> {
  await Promise.allSettled(
    places.map(async (place) => {
      if (!place.name || !place.city) {
        return;
      }
      const real = await resolvePlaceImageUrl(place.name, place.city, place.country);
      if (real) {
        place.imageUrl = real;
      }
    })
  );
  return places;
}