import { getGenerativeModel, Schema, GenerativeModel } from 'firebase/ai';
import { getAIService } from './firebase';
import {
  AiPlannerParams,
  Itinerary,
  ChatMessage,
  DayPlan,
  UserLocation,
  Place,
  Category
} from '../types/travel';
import { describeLocation } from './geolocation';
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
  return `The user's current location is ${describeLocation(location)}. Treat this as their origin and home base. Use it to ground local recommendations, day trips, and "near me" answers, and to estimate transit/flights from home. If the coordinates cannot be mapped to a recognizable place, say so and work from the coordinates as a general origin.`;
}

function getConciergeModel(location: UserLocation | null, alias: string): GenerativeModel {
  const key = `${alias}|${location ? JSON.stringify(location) : 'none'}`;
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
        `Be concise, structured (use short bullet lists), and practical. If you are unsure about a specific current fact (opening hours, prices, seasons), give reasonable guidance and suggest verifying it.`,
        `Never invent dangerous or misleading safety info. Keep answers under ~200 words and use simple markdown (bold headings and dashes) that renders well in a chat.`,
        conciergeLocationContext(location)
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
          websiteUrl: Schema.string()
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

const AI_IMAGE_POOL: Record<string, string[]> = {
  'cat-rest': [
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1000&q=80'
  ],
  'cat-hist': [
    'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1000&q=80'
  ],
  'cat-out': [
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1000&q=80'
  ],
  'cat-night': [
    'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80'
  ],
  'cat-shop': [
    'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=1000&q=80'
  ],
  'cat-hotel': [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1000&q=80'
  ]
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

function buildItineraryPrompt(params: AiPlannerParams): string {
  const lines: string[] = [
    'You are a travel-planning agent. Create a realistic, specific, day-by-day itinerary. Never use generic placeholder phrasing.',
    '',
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
    destinationSpec(params),
    '',
    'Make every activity concrete and authentic: real neighborhoods, real landmark names, real local cuisine, and realistic prices in USD.',
    'Research-aware guidance: mention obvious practical considerations (e.g., cluster activities by area, avoid unrealistic transit hops, suggest the best transport between zones).',
    `Return exactly ${params.durationDays} day plan(s).`,
    'Use `bestTimeToVisit` for the ideal months for that destination, and `estimatedTotalCost` as a realistic overall spend in USD.',
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
  const originHint = location
    ? `The traveler is currently near ${describeLocation(location)}; when sensible, prefer places that are easy for a traveler starting from there to visit.`
    : 'The traveler has not shared their location; choose places from anywhere in the world that best match the request.';
  return [
    'You are a worldwide travel-discovery agent.',
    `Find ${count} real, specific, notable places around the world that best match this search: "${query}".`,
    originHint,
    'Only include real, well-known places with confident details — famous landmarks, acclaimed restaurants, iconic hotels, distinctive neighborhoods, natural wonders, markets, and nightlife spots.',
    'Each place needs: exact name; city; country; a vivid 1-2 sentence description; 3-4 short tags; a realistic average rating between 3.8 and 5.0; a plausible review count; a price level that is exactly one of $, $$, $$$, $$$$; an approximate latitude/longitude; and a website URL if you know one.',
    'Use the place\'s common English name exactly as it appears in travel guides and Wikipedia, alongside its real city — the picture is matched by looking up that name and city in a public encyclopedia, so the name must be precise and searchable.',
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
    const pool = AI_IMAGE_POOL[categoryId] || AI_IMAGE_POOL['cat-hist'];
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
      imageUrl: pool[places.length % pool.length],
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

export class AiTravelAgentService {
  /**
   * Discovers real, specific places worldwide that match a free-form keyword
   * query (e.g. "Paris rooftop restaurants" or "safari lodges in Kenya").
   * Fully generative — results come straight from Gemini, never from a cache.
   */
  async discoverPlaces(query: string, location: UserLocation | null = null, count = 8): Promise<Place[]> {
    try {
      const text = await runWithModelFallback(
        (alias) => getDiscoverModel(alias),
        async (model) =>
          (await model.generateContent(buildDiscoverPrompt(query, location, count))).response.text()
      );
      const cats = await dataConnect.getCategories();
      const places = mapDiscoveredPlaces(text, count, cats);
      const enriched = await enrichPlacesWithImages(places);
      if (enriched.length) {
        return enriched;
      }
      if (places.length) {
        return places;
      }
      throw new Error('The model returned no usable places for that search.');
    } catch (err) {
      console.error('[AiTravelAgent] Place discovery failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `AI couldn't discover places for that search right now. ${detail} ` +
          `This is usually temporary — the Gemini model may be busy (high demand) or the ` +
          `free-tier request limit for the day may be exhausted. Wait a moment and retry.`
      );
    }
  }

  /**
   * Generates a fully generative travel itinerary from Gemini using the user's
   * destination/intent and (when available) their current location.
   * Throws if generation or JSON parsing fails — it never silently returns
   * pre-saved or hardcoded content.
   */
  async generateItinerary(params: AiPlannerParams): Promise<Itinerary> {
    try {
      const text = await runWithModelFallback(
        (alias) => getPlannerModel(alias),
        async (model) => (await model.generateContent(buildItineraryPrompt(params))).response.text()
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
    location?: UserLocation | null
  ): Promise<ChatMessage> {
    try {
      const text = await runWithModelFallback(
        (alias) => getConciergeModel(location || null, alias),
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