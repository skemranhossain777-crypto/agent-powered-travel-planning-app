import { getGenerativeModel, Schema, GenerativeModel } from 'firebase/ai';
import { getAIService } from './firebase';
import {
  AiPlannerParams,
  Itinerary,
  ChatMessage,
  DayPlan,
  UserLocation,
  Place,
  Category,
  User
} from '../types/travel';
import { describeLocation, getCurrencyCode, currencySymbol } from './geolocation';
import { dataConnect } from './dataConnectService';
import { enrichPlacesWithImages } from './placeImages';

/**
 * Gemini text model aliases to try in order. gemini-3.6-flash is the current
 * stable flash model on the Gemini Developer API (no billing required) — the
 * platform itself recommends migrating to it. The others are kept as automatic
 * fallbacks for transient "high demand" / quota / retired-model errors.
 * See https://firebase.google.com/docs/ai-logic/models for the latest list.
 */
const TEXT_MODEL_ALIASES = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];

const plannerModels: Record<string, GenerativeModel> = {};
const conciergeModels: Record<string, GenerativeModel> = {};
const discoverModels: Record<string, GenerativeModel> = {};

/**
 * Lazily builds models. getGenerativeModel itself does not hit the network.
 */
function getPlannerModel(alias: string): GenerativeModel {
  if (!plannerModels[alias]) {
    const ai = getAIService();
    plannerModels[alias] = getGenerativeModel(ai, {
      model: alias,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: ITINERARY_SCHEMA
      }
    });
  }
  return plannerModels[alias];
}

function conciergeLocationContext(location: UserLocation | null): string {
  if (!location) {
    return [
      'The user has not shared their location (permission denied or unavailable).',
      'Never assume a city or "near me" location. If they ask for anything local ("near me", "from here", "my city"), ask which city they are in or invite them to enable location sharing.'
    ].join(' ');
  }
  const cur = getCurrencyCode(location.countryCode);
  const curSym = currencySymbol(cur);
  return `The user's current location is ${describeLocation(location)}. Treat this as their origin and home base. Use it to ground local recommendations, day trips, and "near me" answers, and to estimate transit/flights from home. If the coordinates cannot be mapped to a recognizable place, say so and work from the coordinates as a general origin. Quote ALL prices in the user's local currency ${cur} (${curSym}) — never USD.`;
}

/**
 * Builds a personalization block describing who the signed-in user is — their
 * name, stated travel preferences, bookmarks, saved trips and reviews — so the
 * agent can tailor suggestions to THEIR history rather than generic advice.
 */
function buildUserContext(user: User | null, includeActivity = true): string {
  if (!user) {
    return [
      'The traveler is currently browsing anonymously (not signed in).',
      'Do not invent any personal identity, name, interests, or history for them. Tailor advice only to what they say in this conversation.'
    ].join(' ');
  }

  const p = user.profile;
  const lines: string[] = [];
  lines.push(`You are helping ${p.displayName || user.username} (email: ${user.email || 'unknown'}${user.provider === 'google' ? ', signed in with Google' : user.provider === 'email' ? ', signed in with email/password' : ''}).`);

  if (p.homeCity) lines.push(`Home base (from profile): ${p.homeCity}.`);
  if (p.bio) lines.push(`About them: ${p.bio}`);

  const prefs: string[] = [];
  if (p.interests && p.interests.length) prefs.push(`Preferred travel interests: ${p.interests.join(', ')}`);
  if (p.travelStyles && p.travelStyles.length) prefs.push(`Travelling style: ${p.travelStyles.join(', ')}`);
  if (p.budgetPreference) prefs.push(`Preferred budget: ${p.budgetPreference}`);
  if (prefs.length) lines.push(prefs.join(' | '));

  if (!includeActivity) {
    return lines.join('\n');
  }

  const activity = dataConnect.getActivity(user.id);
  if (activity.length) {
    const bookmarks = activity.filter((a) => a.type === 'bookmark').slice(0, 10);
    const itins = activity.filter((a) => a.type === 'itinerary').slice(0, 6);
    const reviews = activity.filter((a) => a.type === 'review').slice(0, 5);

    if (bookmarks.length) {
      lines.push(`Places they have saved/bookmarked: ${[...new Set(bookmarks.map((b) => `${b.placeName}${b.city ? ' (' + b.city + ', ' + b.country + ')' : ''}`))].join('; ')}.`);
    }
    if (reviews.length) {
      lines.push(`Places they have reviewed: ${[...new Set(reviews.map((r) => r.placeName))].join('; ')}.`);
    }
    if (itins.length) {
      lines.push(`Trips they have planned before: ${itins.map((i) => `${i.placeName} (${i.detail || 'trip'})`).join('; ')}.`);
    }
  }

  lines.push(
    'Use this history to proactively suggest the kinds of places, cuisines, and activities this traveler has already shown interest in, while still introducing some new but complementary options. Do not claim to know details about them beyond what is listed.'
  );

  return lines.join('\n');
}

function getConciergeModel(location: UserLocation | null, alias: string, user?: User | null): GenerativeModel {
  const key = `${alias}|${location ? JSON.stringify(location) : 'none'}|${user?.id || 'anon'}`;
  if (!conciergeModels[key]) {
    const ai = getAIService();
    conciergeModels[key] = getGenerativeModel(ai, {
      model: alias,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048
      },
      systemInstruction: [
        `You are "AI Travel Concierge", a friendly, upbeat travel expert inside the VoyageAI app.`,
        `You help users discover destinations worldwide, recommend hidden gems, packing lists, optimal travel seasons, budget breakdowns, and create real, specific travel advice.`,
`Be warm, generous, and genuinely helpful, not terse or rushed. Give complete, specific, practical answers. Only ask one clarifying question if a detail is genuinely needed; otherwise answer fully using the user's profile. If you are unsure about a specific current fact (opening hours, prices, seasons), give reasonable guidance and suggest verifying it.`,
`Never invent dangerous or misleading safety info. Provide a rich but well-organized answer using clean GitHub-flavored markdown so it renders beautifully in the chat — aim for detail and value (typically 250–450 words for a real plan/answer): use bold headings for sections, hyphen or numbered bullet lists for options/destinations, and pipe tables whenever comparing data (e.g. destination features, budget, pros/cons, costs, seasons). Structure replace-then-condense: never just one-liners; flesh out options, why they fit, and practical next steps.`,
        conciergeLocationContext(location),
        buildUserContext(user || null)
      ].join('\n')
    });
  }
  return conciergeModels[key];
}

function getDiscoverModel(alias: string): GenerativeModel {
  if (!discoverModels[alias]) {
    const ai = getAIService();
    discoverModels[alias] = getGenerativeModel(ai, {
      model: alias,
      generationConfig: {
        temperature: 0.8,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: PLACE_SCHEMA
      }
    });
  }
  return discoverModels[alias];
}

// ---------------------------------------------------------------------------
// Itinerary generation with structured (JSON) output
// ---------------------------------------------------------------------------

const ITINERARY_SCHEMA = Schema.object({
  description: 'A structured day-by-day travel itinerary',
  properties: {
    destination: Schema.string(),
    country: Schema.string(),
    durationDays: Schema.integer(),
    budgetLevel: Schema.string(),
    travelStyle: Schema.string(),
    interests: Schema.array({ items: Schema.string() }),
    summary: Schema.string(),
    estimatedTotalCost: Schema.string(),
    bestTimeToVisit: Schema.string(),
    sightseeingCost: Schema.string(),
    transport: Schema.array({
      items: Schema.object({
        properties: {
          mode: Schema.string(),
          route: Schema.string(),
          estimatedCost: Schema.string()
        }
      })
    }),
    hotels: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          area: Schema.string(),
          ratePerNight: Schema.string(),
          estimatedCost: Schema.string()
        }
      })
    }),
    dayPlans: Schema.array({
      items: Schema.object({
        properties: {
          dayNumber: Schema.integer(),
          title: Schema.string(),
          theme: Schema.string(),
          activities: Schema.array({
            items: Schema.object({
              properties: {
                time: Schema.string(),
                title: Schema.string(),
                description: Schema.string(),
                locationName: Schema.string(),
                category: Schema.string(),
                estimatedCost: Schema.string()
              }
            })
          })
        }
      })
    })
  }
});

const PLACE_SCHEMA = Schema.object({
  description: 'A list of real places discovered around the world',
  properties: {
    places: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          city: Schema.string(),
          country: Schema.string(),
          category: Schema.string(),
          description: Schema.string(),
          tags: Schema.array({ items: Schema.string() }),
          priceLevel: Schema.string(),
          averageRating: Schema.number(),
          reviewCount: Schema.integer(),
          latitude: Schema.number(),
          longitude: Schema.number(),
          address: Schema.string(),
          websiteUrl: Schema.string(),
          imageUrl: Schema.string()
        }
      })
    })
  }
});

interface RawDiscoveredPlace {
  name?: string;
  city?: string;
  country?: string;
  category?: string;
  description?: string;
  tags?: string[];
  priceLevel?: string;
  averageRating?: number;
  reviewCount?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  websiteUrl?: string;
  imageUrl?: string;
}

const CATEGORY_LABEL_TO_ID: Record<string, string> = {
  restaurant: 'cat-rest',
  food: 'cat-rest',
  dining: 'cat-rest',
  cafe: 'cat-rest',
  historical: 'cat-hist',
  museum: 'cat-hist',
  monument: 'cat-hist',
  landmark: 'cat-hist',
  castle: 'cat-hist',
  temple: 'cat-hist',
  nature: 'cat-out',
  outdoor: 'cat-out',
  park: 'cat-out',
  beach: 'cat-out',
  hiking: 'cat-out',
  nightlife: 'cat-night',
  club: 'cat-night',
  bar: 'cat-night',
  shopping: 'cat-shop',
  market: 'cat-shop',
  bazaar: 'cat-shop',
  mall: 'cat-shop',
  hotel: 'cat-hotel',
  resort: 'cat-hotel',
  lodge: 'cat-hotel',
  stay: 'cat-hotel'
};

const VALID_PRICE_LEVELS = ['$', '$$', '$$$', '$$$$'];

interface RawItinerary {
  destination?: string;
  country?: string;
  durationDays?: number;
  budgetLevel?: string;
  travelStyle?: string;
  interests?: string[];
  summary?: string;
  estimatedTotalCost?: string;
  bestTimeToVisit?: string;
  sightseeingCost?: string;
  transport?: Array<{
    mode?: string;
    route?: string;
    estimatedCost?: string;
  }>;
  hotels?: Array<{
    name?: string;
    area?: string;
    ratePerNight?: string;
    estimatedCost?: string;
  }>;
  dayPlans?: Array<{
    dayNumber?: number;
    title?: string;
    theme?: string;
    activities?: Array<{
      time?: string;
      title?: string;
      description?: string;
      locationName?: string;
      category?: string;
      estimatedCost?: string;
    }>;
  }>;
}

function normalizeBudget(value: string): 'Budget' | 'Moderate' | 'Luxury' {
  const v = (value || '').toLowerCase();
  if (v.includes('lux')) return 'Luxury';
  if (v.includes('bud')) return 'Budget';
  return 'Moderate';
}

function fallbackDestination(params: AiPlannerParams): string {
  if (params.destination && params.destination.trim()) return params.destination.trim();
  if (params.location) return 'A trip from the user’s current location';
  return params.notes && params.notes.trim() ? 'Your chosen adventure' : 'Your selected adventure';
}

function buildItinerary(raw: RawItinerary, params: AiPlannerParams): Itinerary {
  const destination = raw.destination || fallbackDestination(params);
  const durationDays = raw.durationDays ?? params.durationDays;
  const dayPlans: DayPlan[] = (raw.dayPlans || []).slice(0, durationDays).map((d, i) => ({
    dayNumber: d.dayNumber ?? i + 1,
    title: d.title || `Day ${i + 1}`,
    theme: d.theme || 'Curated Experience',
    activities: (d.activities || []).map((a) => ({
      time: a.time || 'Flexible timing',
      title: a.title || 'Exploration',
      description: a.description || '',
      locationName: a.locationName || '',
      category: a.category || 'Experience',
      estimatedCost: a.estimatedCost || 'Varies'
    }))
  }));

  return {
    id: `itin-${Date.now()}`,
    destination,
    country: raw.country || 'International',
    durationDays,
    budgetLevel: normalizeBudget(raw.budgetLevel || params.budgetLevel),
    travelStyle: raw.travelStyle || params.travelStyle,
    interests: raw.interests && raw.interests.length ? raw.interests : params.interests,
    summary:
      raw.summary ||
      `A personalized ${durationDays}-day ${params.travelStyle.toLowerCase()} itinerary built around your interests.`,
    estimatedTotalCost: raw.estimatedTotalCost || 'Varies by season',
    bestTimeToVisit: raw.bestTimeToVisit || 'Check local climate closer to your travel dates',
    sightseeingCost: raw.sightseeingCost || '',
    transport: (raw.transport || []).map((t) => ({
      mode: t.mode || 'Transport',
      route: t.route || '',
      estimatedCost: t.estimatedCost || 'Varies'
    })),
    hotels: (raw.hotels || []).map((h) => ({
      name: h.name || 'Accommodation',
      area: h.area || '',
      ratePerNight: h.ratePerNight || '',
      estimatedCost: h.estimatedCost || 'Varies'
    })),
    dayPlans,
    createdAt: new Date().toISOString()
  };
}

function destinationSpec(params: AiPlannerParams): string {
  if (params.destination && params.destination.trim()) {
    return `Plan exactly ${params.durationDays} day(s) in and around ${params.destination.trim()}. If that place is not obviously a city/region, interpret it as the traveler intends.`;
  }
  if (params.location) {
    return [
      'No explicit destination was given, so pick the destination yourself.',
      `The traveler is starting from ${describeLocation(params.location)}.`,
      'Choose a destination that fits their interests and notes — a hidden-gem region, a nearby country, or a well-known trip from where they are. State the choice in the `destination` and `country` fields and justify it in `summary`.'
    ].join(' ');
  }
  return `Pick a destination that best fits the traveler's interests and notes, and state it in the response.`;
}

function buildItineraryPrompt(params: AiPlannerParams, user?: User | null): string {
  const cur = getCurrencyCode(params.location?.countryCode);
  const curSym = currencySymbol(cur);
  const curLine = `Currency: show ALL prices in the traveler's local currency ${cur} (${curSym}) — not USD.`;
  const lines: string[] = [
    'You are a travel-planning agent. Create a realistic, specific, day-by-day itinerary. Never use generic placeholder phrasing.',
    '',
    curLine,
    `Destination: ${params.destination && params.destination.trim() ? params.destination.trim() : '(not specified — pick it from context)'}`,
    `Duration: ${params.durationDays} day(s)`,
    `Budget level: ${params.budgetLevel}`,
    `Travel style: ${params.travelStyle}`,
    `Interests & themes: ${params.interests.join(', ') || 'Open to everything worth seeing'}`,
    `Traveler's origin: ${params.location ? describeLocation(params.location) : 'not provided'}`
  ];
  if (params.notes && params.notes.trim()) {
    lines.push(`Traveler's intention / extra requirements: ${params.notes.trim()}`);
  }
  lines.push(
    '',
    buildUserContext(user || null, false),
    '',
    destinationSpec(params),
    '',
    'Make every activity concrete and authentic: real neighborhoods, real landmark names, real local cuisine, and realistic prices in the traveler\'s local currency.',
    'Research-aware guidance: mention obvious practical considerations (e.g., cluster activities by area, avoid unrealistic transit hops, suggest the best transport between zones).',
    '',
    'Include transport and stay every time, with realistic prices in the traveler\'s local currency:',
    `- \`transport\`: ALL realistic ways to get from the traveler's home base to the destination and around — e.g. flight (with a realistic one-way price), train, bus, rental car, and local metro/taxi within the destination. Give each option's \`mode\`, \`route\` (e.g. "Dhaka → Bali", "local metro within inner city"), and \`estimatedCost\` in ${cur} (${curSym}).`,
    `- \`hotels\`: 2–3 specific, realistic accommodation options matched to the traveler's budget level, with \`name\`, \`area\`/neighborhood, \`ratePerNight\` (${cur} per night), and \`estimatedCost\` (${cur} total for the stay).`,
    `- \`sightseeingCost\`: a realistic per-destination estimate (${cur}) of entry fees / sightseeing for the whole trip.`,
    'Base every choice on this specific traveler\'s profile above (name, home city, interests, travel style, budget) and call them out where it matters — never answer as a generic anonymous plan.',
    `Return exactly ${params.durationDays} day plan(s).`,
    `Use \`bestTimeToVisit\` for the ideal months for that destination, and \`estimatedTotalCost\` as a realistic overall spend in ${cur} (${curSym}).`,
    'Return only valid JSON matching the requested schema.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API — fully generative. No hardcoded fallback content.
// ---------------------------------------------------------------------------

function isRetriableModelError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /quota|rate limit|resource exhausted|high demand|busy|too many|no longer available|not found|429|500|503/.test(m)
  );
}

/**
 * Runs `invoke` against a freshly built model for each alias in
 * TEXT_MODEL_ALIASES until one succeeds. Transient errors (high demand,
 * free-tier quota, retired-model 404s) cause a retry on the next alias.
 */
async function runWithModelFallback(
  build: (alias: string) => GenerativeModel,
  invoke: (model: GenerativeModel) => Promise<string>
): Promise<string> {
  let lastError: unknown = null;
  for (const alias of TEXT_MODEL_ALIASES) {
    try {
      return await invoke(build(alias));
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      if (!isRetriableModelError(detail)) {
        throw err;
      }
      console.warn(`[AiTravelAgent] model ${alias} unavailable (${detail.slice(0, 140)}); trying fallback alias.`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildDiscoverPrompt(query: string, location: UserLocation | null, count: number): string {
  const scope = location
    ? `The traveler is currently near ${describeLocation(location)}. REQUIRE every place you return to be a real, existing place located NEAR this location — in the same city or its immediate surroundings. Do NOT list places that are far away (no other countries, no famous-but-unrelated landmarks elsewhere) unless the search explicitly names that distant place.`
    : 'The traveler has not shared their location; choose places from anywhere in the world that best match the request.';
  return [
    'You are a location-aware travel-discovery agent.',
    `Find ${count} real, specific, notable places that best match this search: "${query}".`,
    scope,
    'Only include real, well-known places with confident details — famous landmarks, acclaimed restaurants, iconic hotels, distinctive neighborhoods, natural wonders, markets, and nightlife spots.',
    "Each place needs: exact name; city; country; a vivid 1-2 sentence description; 3-4 short tags; a realistic average rating between 3.8 and 5.0; a plausible review count; a price level that is exactly one of $, $$, $$$, $$$$; an approximate latitude/longitude; and a website URL if you know one.",
    "imageUrl: provide the direct address of a real photo of this exact place hosted on Wikipedia/Wikimedia Commons (upload.wikimedia.org) ONLY if you are genuinely confident it is that place's own photo. Otherwise leave imageUrl empty — it will be matched automatically.",
    "Use the place's common English name exactly as it appears in travel guides and Wikipedia, alongside its real city — the picture is matched by looking up that name and city in a public encyclopedia, so the name must be precise and searchable.",
    'Set category to exactly one of: Restaurant, Historical, Nature, Nightlife, Shopping, Hotel.',
    `Return only valid JSON: an object with a "places" array of 1 to ${count} items using the requested schema.`,
    'Never fabricate a place. If you cannot confidently identify enough real matches, return fewer higher-confidence ones.'
  ].join('\n');
}

function resolveCategoryId(raw: RawDiscoveredPlace): string {
  const combined = [raw.category, raw.name, raw.description, ...(raw.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const [label, id] of Object.entries(CATEGORY_LABEL_TO_ID)) {
    if (combined.includes(label)) {
      return id;
    }
  }
  return 'cat-hist';
}

function mapDiscoveredPlaces(text: string, count: number, categories: Category[] = []): Place[] {
  let parsed: { places?: RawDiscoveredPlace[] } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model returned invalid JSON for place discovery.');
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const places: Place[] = [];
  const stamp = Date.now();

  for (const raw of parsed.places || []) {
    const name = (raw.name || '').trim();
    const city = (raw.city || '').trim();
    const country = (raw.country || '').trim();
    if (!name || !city || !country) {
      continue;
    }

    const dedupeKey = `${name.toLowerCase()}|${city.toLowerCase()}|${country.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const categoryId = resolveCategoryId(raw);
    const priceLevelRaw = (raw.priceLevel || '').trim();
    const priceLevel = (VALID_PRICE_LEVELS.includes(priceLevelRaw) ? priceLevelRaw : '$$') as Place['priceLevel'];

    const rating = Math.max(0, Math.min(5, Number(raw.averageRating) || 0));
    const reviewCount = Math.max(0, Math.floor(Number(raw.reviewCount) || 0));
    const lat = Number(raw.latitude);
    const lng = Number(raw.longitude);

    places.push({
      id: `ai-${stamp}-${places.length}`,
      name,
      categoryId,
      category: catById.get(categoryId),
      location: [
        Number.isFinite(lat) ? lat : 0,
        Number.isFinite(lng) ? lng : 0
      ],
      address: (raw.address || '').trim() || undefined,
      city,
      country,
      description: (raw.description || '').trim() || `A standout ${categoryId.replace('cat-', '')} experience.`,
      websiteUrl: (raw.websiteUrl || '').trim() || undefined,
      imageUrl: (raw.imageUrl || '').trim(),
      averageRating: rating || 4.5,
      reviewCount: reviewCount || 1,
      priceLevel,
      tags: (raw.tags || []).slice(0, 4).filter((t) => typeof t === 'string')
    });

    if (places.length >= count) {
      break;
    }
  }

  return places;
}

// Small client-side cache for AI place discovery. Re-using a recent result
// avoids burning a free-tier Gemini request on every category tap or Explore
// reload. Fresh entries return instantly; stale ones fall through to Gemini.
const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const discoverCache = {
  memory: new Map<string, { expires: number; places: Place[] }>(),
  key(query: string, location: UserLocation | null, count: number): string {
    return `${query}::${location?.label || 'anywhere'}::${count}`;
  },
  get(query: string, location: UserLocation | null, count: number): Place[] | null {
    const k = this.key(query, location, count);
    const hit = this.memory.get(k);
    if (hit && hit.expires > Date.now()) {
      return hit.places;
    }
    try {
      const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('reveao_discover_' + k) : null;
      if (raw) {
        const saved = JSON.parse(raw) as { expires: number; places: Place[] };
        if (saved.expires > Date.now()) {
          this.memory.set(k, saved);
          return saved.places;
        }
      }
    } catch {
      // cache is best-effort
    }
    return null;
  },
  set(query: string, location: UserLocation | null, count: number, places: Place[]): void {
    const k = this.key(query, location, count);
    const entry = { expires: Date.now() + DISCOVER_CACHE_TTL_MS, places };
    this.memory.set(k, entry);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('reveao_discover_' + k, JSON.stringify(entry));
      }
    } catch {
      // best-effort
    }
  }
};

export class AiTravelAgentService {
  /**
   * Discovers real, specific places worldwide that match a free-form keyword
   * query (e.g. "Paris rooftop restaurants" or "safari lodges in Kenya").
   * Fully generative — results come straight from Gemini, never from a cache.
   */
  async discoverPlaces(query: string, location: UserLocation | null = null, count = 8, user?: User | null): Promise<Place[]> {
    // Reuse recent results for the same query+location instead of spending
    // another free-tier Gemini request on every tap/reload.
    const cached = discoverCache.get(query, location, count);
    if (cached) {
      return cached;
    }
    try {
      const text = await runWithModelFallback(
        (alias) => getDiscoverModel(alias),
        async (model) =>
          (await model.generateContent(buildDiscoverPrompt(query, location, count))).response.text()
      );
      const cats = await dataConnect.getCategories();
      const places = mapDiscoveredPlaces(text, count, cats);
      const enriched = await enrichPlacesWithImages(places);
      if (user) {
        places.slice(0, 2).forEach((p) => {
          dataConnect.recordActivityFromService?.('discover', {
            placeName: p.name, city: p.city, country: p.country, categoryId: p.categoryId, detail: query
          }, user.id);
        });
      }
      const result = enriched.length ? enriched : places;
      if (!result.length) {
        throw new Error('The model returned no usable places for that search.');
      }
      discoverCache.set(query, location, count, result);
      return result;
    } catch (err) {
      console.error('[AiTravelAgent] Place discovery failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      const isQuota = /429|quota|rate limit|exhausted|RESOURCE_EXHAUSTED/i.test(detail);
      const hint = isQuota
        ? `You've hit the free-tier Gemini limit for today. It resets automatically around midnight UTC — retry a bit later, or revisit a category you already saw (those are cached and won't hit the limit).`
        : `This is usually temporary — the Gemini model may be busy (high demand) or the free-tier request limit for the day may be exhausted. Wait a moment and retry.`;
      throw new Error(`AI couldn't discover places for that search right now. ${hint}`);
    }
  }

  /**
   * Generates a fully generative travel itinerary from Gemini using the user's
   * destination/intent and (when available) their current location.
   * Throws if generation or JSON parsing fails — it never silently returns
   * pre-saved or hardcoded content.
   */
  async generateItinerary(params: AiPlannerParams, user?: User | null): Promise<Itinerary> {
    try {
      const text = await runWithModelFallback(
        (alias) => getPlannerModel(alias),
        async (model) => (await model.generateContent(buildItineraryPrompt(params, user))).response.text()
      );
      const raw = JSON.parse(text) as RawItinerary;
      const itinerary = buildItinerary(raw, params);
      if (!itinerary.dayPlans.length) {
        throw new Error('The model returned an itinerary with no daily plans.');
      }
      return itinerary;
    } catch (err) {
      console.error('[AiTravelAgent] Itinerary generation failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `AI planner couldn't create a real itinerary right now. ${detail} ` +
          `This is usually temporary — the Gemini model may be busy (high demand) or the ` +
          `free-tier request limit for the day may be exhausted. Wait a moment and retry.`
      );
    }
  }

  /**
   * Responds to user chat messages with a Gemini multi-turn chat session,
   * grounded in the user's current location when provided. Fully generative —
   * no canned or pre-saved answers. Throws when the model is unavailable.
   */
  async processChatMessage(
    userPrompt: string,
    history?: Array<{ role: 'user' | 'model'; text: string }>,
    location?: UserLocation | null,
    user?: User | null
  ): Promise<ChatMessage> {
    try {
      const text = await runWithModelFallback(
        (alias) => getConciergeModel(location || null, alias, user),
        async (model) => {
          const chat = model.startChat({
            history: (history || []).slice(-20).map((m) => ({
              role: m.role,
              parts: [{ text: m.text }]
            }))
          });
          return (await chat.sendMessage(userPrompt)).response.text();
        }
      );
      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    } catch (err) {
      console.error('[AiTravelAgent] Chat failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `The concierge couldn't respond right now. ${detail} ` +
          `This is usually temporary — the Gemini model may be busy (high demand) or the ` +
          `free-tier request limit for the day may be exhausted. Wait a moment and retry.`
      );
    }
  }
}

export const aiAgent = new AiTravelAgentService();