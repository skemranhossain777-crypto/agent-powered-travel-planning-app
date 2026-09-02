import { Place } from '../types/travel';

const WIKI_API =
  'https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json' +
  '&generator=search&gsrnamespace=0&gsrlimit=5';

const COMMONS_API =
  'https://commons.wikimedia.org/w/api.php?action=query&origin=*&format=json' +
  '&generator=search&gsrnamespace=6&gsrlimit=8' +
  '&prop=imageinfo&iiprop=url|mime&iiurlwidth=720';

const cache = new Map<string, string>();

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function placeKey(name: string, city: string, country: string): string {
  return `${name.trim().toLowerCase()}|${city.trim().toLowerCase()}|${(country || '').trim().toLowerCase()}`;
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

function normalized(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Builds progressively simpler name variants so marketing-style seed names
 * like "Colosseum & Ancient Forum" or "Aman Tokyo Sanctuary & Spa" can be
 * resolved against their canonical Wikipedia article ("Colosseum",
 * "Aman Tokyo", "Ce La Vi", ...).
 */
function nameVariants(name: string): string[] {
  const set = new Set<string>();
  const cleaned = (name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned) {
    set.add(cleaned);
  }
  const head = cleaned.split(/\s+[&–—-]\s+|\s+&\s+/)[0].trim();
  if (head) {
    set.add(head);
  }
  const words = cleaned.split(' ').filter(Boolean);
  for (let n = words.length - 1; n >= 2; n--) {
    set.add(words.slice(0, n).join(' '));
  }
  return [...set].filter(Boolean);
}

/**
 * Scores a Wikipedia search hit against the place we are looking for.
 * Higher is better; a result is only used when score >= 2 and it has a
 * thumbnail. Short/generic names (fewer than 8 normalized letters) must also
 * carry an explicit city/country proof so "Pergola" or "Luna Park" can never
 * attach a wrong-but-similar picture.
 */
function matchScore(
  page: any,
  name: string,
  city: string,
  country: string
): number {
  const title = (page?.title || '').toLowerCase();
  const nameLower = name.trim().toLowerCase();
  const nameNorm = normalized(nameLower);
  const titleNorm = normalized(title);
  const snippet = (page?.extract || '').toLowerCase();
  const tokens = nameLower.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const targets = [city, country]
    .map((s) => s?.trim().toLowerCase())
    .filter((s): s is string => !!s && s.length > 2);

  const geoInTitle = targets.some((t) => title.includes(t));
  const geoInSnippet = targets.some((t) => snippet.includes(t));
  const isShortName = nameNorm.length > 0 && nameNorm.length < 8;

  const exact = title === nameLower || title.startsWith(`${nameLower} (`);

  // Exact title wins outright (and is safe even without a geo proof).
  if (exact) {
    return isShortName && !geoInTitle ? 2 : 5;
  }

  // For any non-exact title match, the city or country must appear in the
  // article title — otherwise we can attach a wrong-but-similar result
  // (e.g. a biography named exactly like a short landmark).
  if (geoInTitle) {
    if (nameNorm.length > 2 && titleNorm.includes(nameNorm)) {
      return isShortName ? 4 : 5;
    }
    const matchedTokens = tokens.filter((t) => title.includes(t)).length;
    const longestToken = tokens
      .slice()
      .sort((a, b) => b.length - a.length)[0];
    if (matchedTokens >= 2) {
      return geoInSnippet ? 4 : 3;
    }
    if (
      matchedTokens === 1 &&
      (tokens.length === 1 || (longestToken && title.includes(longestToken)))
    ) {
      return geoInSnippet ? 3 : 2;
    }
  } else if (nameNorm.length > 2 && titleNorm.includes(nameNorm) && geoInSnippet) {
    return 3;
  }

  return 0;
}

async function lookupWikipedia(
  name: string,
  city: string,
  country: string
): Promise<string | null> {
  let best = '';
  let bestScore = 0;
  for (const variant of nameVariants(name)) {
    const query = `${variant} ${city} ${country}`.trim().slice(0, 120);
    const data = await fetchJson(
      `${WIKI_API}&gsrsearch=${encodeURIComponent(query)}` +
        `&prop=pageimages|extracts&piprop=thumbnail&pithumbsize=720&explaintext=&exsentences=2`
    );
    const pages = data?.query?.pages;
    if (!pages) {
      continue;
    }
    const candidates = Object.values(pages) as any[];
    candidates.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
    for (const page of candidates) {
      const thumb = page?.thumbnail?.source;
      if (!thumb) {
        continue;
      }
      const score = matchScore(page, variant, city, country);
      if (score >= 3 && score > bestScore) {
        best = thumb;
        bestScore = score;
      }
    }
  }
  return best || null;
}

// A Commons file ("File:La Pergola terrace Rome.jpg") is only accepted when the
// file name literally names the place AND an unambiguous geographic anchor is
// present. A generic pool file like "Restaurant interior.jpg" never names the
// place, so it is always rejected.
function fileMatches(
  title: string,
  name: string,
  city: string,
  country: string
): boolean {
  const stem = (title || '')
    .toLowerCase()
    .replace(/^file:/, '')
    .replace(/\.(jpe?g|png|gif|webp|svg|tiff?)$/i, '');
  const nameNorm = normalized(name);
  const stemNorm = normalized(stem);
  if (!nameNorm || !stemNorm) {
    return false;
  }

  const containsName =
    stemNorm.includes(nameNorm) ||
    nameNorm.split(' ').every((token) => token.length > 2 && stemNorm.includes(token));

  const hasGeoAnchor = Boolean(
    (city && stem.includes(city.toLowerCase())) ||
      (country && stem.includes(country.toLowerCase()))
  );

  if (nameNorm.length >= 8) {
    return containsName;
  }
  return containsName && hasGeoAnchor;
}

async function lookupCommons(
  name: string,
  city: string,
  country: string
): Promise<string | null> {
  let best = '';
  let bestScore = 0;
  for (const variant of nameVariants(name)) {
    const query = `${variant} ${city} ${country}`.trim().slice(0, 160);
    const data = await fetchJson(`${COMMONS_API}&gsrsearch=${encodeURIComponent(query)}`);
    const pages = data?.query?.pages;
    if (!pages) {
      continue;
    }
    const candidates = Object.values(pages) as any[];
    candidates.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
    for (const page of candidates) {
      const info = page?.imageinfo?.[0];
      const thumb = info?.thumburl || info?.url;
      if (!thumb) {
        continue;
      }
      let score = fileMatches(page?.title || '', variant, city, country) ? 2 : 0;
      const file = stem(page.title);
      if (city && file.includes(city.toLowerCase())) score += 1;
      if (country && file.includes(country.toLowerCase())) score += 1;
      if (score > 0 && score > bestScore) {
        best = thumb;
        bestScore = score;
      }
    }
  }
  return best || null;
}

function stem(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/^file:/, '')
    .replace(/\.(jpe?g|png|gif|webp|svg|tiff?)$/i, '');
}

/**
 * Verifies a wiki URL (upload.wikimedia.org thumb or direct file) the AI may
 * have provided, returning a fresh 720px thumb URL only if the file actually
 * exists on the corresponding wiki. Any URL that is not from Wikimedia, or any
 * missing file, is rejected so an invented URL can never reach the UI.
 */
function isWikimediaUpload(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'upload.wikimedia.org' ||
      /(^|\.)wikimedia\.org$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

function filenameFromPath(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    let file = '';
    for (let i = segs.length - 1; i >= 0; i--) {
      if (/^[0-9]+px-/.test(segs[i])) {
        file = segs[i].replace(/^[0-9]+px-/, '');
        break;
      }
    }
    if (!file) {
      file = segs[segs.length - 1] || '';
    }
    try {
      file = decodeURIComponent(file);
    } catch {
      // keep raw
    }
    return file;
  } catch {
    return '';
  }
}

function wikiApiForUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith('en.wikipedia.org') || u.pathname.startsWith('/wikipedia/en/')) {
      return 'https://en.wikipedia.org/w/api.php';
    }
  } catch {
    // fall through
  }
  return 'https://commons.wikimedia.org/w/api.php';
}

async function verifyWikimediaFile(url: string): Promise<string | null> {
  if (!isWikimediaUpload(url)) {
    return null;
  }
  const file = filenameFromPath(url);
  if (!/\.(jpe?g|png|gif|webp)$/i.test(file)) {
    return null;
  }
  const api = wikiApiForUrl(url);
  const data = await fetchJson(
    `${api}?action=query&origin=*&format=json` +
      `&titles=${encodeURIComponent(`File:${file}`)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=720`
  );
  const info = (Object.values(data?.query?.pages || {})[0] as any)?.imageinfo?.[0];
  return info?.thumburl || info?.url || null;
}

/**
 * Resolves a real, verified photo for a place. Resolution order:
 *   1. A Wikimedia URL supplied by the AI (verified against the wiki's API).
 *   2. The lead image of the place's Wikipedia article (verified match).
 *   3. A Wikimedia Commons file that literally names the place + city/country.
 * Returns '' when no authentic picture can be found. It never returns a
 * generic "category pool" image — every non-empty result is a photo of this
 * specific place.
 */
export async function resolvePlaceImageUrl(
  name: string,
  city: string,
  country: string,
  candidateUrl = ''
): Promise<string> {
  const key = placeKey(name, city, country);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let url = '';
  if (candidateUrl.trim()) {
    url = (await verifyWikimediaFile(candidateUrl.trim())) || '';
  }
  if (!url) {
    url = (await lookupWikipedia(name, city, country)) || '';
  }
  if (!url) {
    url = (await lookupCommons(name, city, country)) || '';
  }

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
      const real = await resolvePlaceImageUrl(
        place.name,
        place.city,
        place.country,
        place.imageUrl
      );
      if (real) {
        place.imageUrl = real;
      } else if (!isWikimediaUpload(place.imageUrl || '')) {
        // No verified original exists yet — never leave a generic stock photo
        // pretending to be the place. The UI shows a branded placeholder.
        place.imageUrl = '';
      }
    })
  );
  return places;
}