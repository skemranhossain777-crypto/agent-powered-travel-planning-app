import { getGenerativeModel, Schema, GenerativeModel } from 'firebase/ai';
import { getAIService } from './firebase';
import {
  AiPlannerParams,
  Itinerary,
  ChatMessage,
  DayPlan,
  UserLocation
} from '../types/travel';
import { describeLocation } from './geolocation';

/**
 * The current stable Gemini model for text/structured output on the
 * Gemini Developer API (no billing required). See
 * https://firebase.google.com/docs/ai-logic/models for the latest list.
 */
const TEXT_MODEL = 'gemini-3.7-flash';

let plannerModel: GenerativeModel | null = null;
let conciergeModel: GenerativeModel | null = null;
let conciergeContextKey: string | null = null;

/**
 * Lazily builds models. getGenerativeModel itself does not hit the network.
 */
function getPlannerModel(): GenerativeModel {
  if (!plannerModel) {
    const ai = getAIService();
    plannerModel = getGenerativeModel(ai, {
      model: TEXT_MODEL,
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
  return plannerModel;
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

function getConciergeModel(location: UserLocation | null): GenerativeModel {
  const contextKey = location ? JSON.stringify(location) : 'none';
  if (!conciergeModel || conciergeContextKey !== contextKey) {
    const ai = getAIService();
    conciergeModel = getGenerativeModel(ai, {
      model: TEXT_MODEL,
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
    conciergeContextKey = contextKey;
  }
  return conciergeModel;
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

export class AiTravelAgentService {
  /**
   * Generates a fully generative travel itinerary from Gemini using the user's
   * destination/intent and (when available) their current location.
   * Throws if generation or JSON parsing fails — it never silently returns
   * pre-saved or hardcoded content.
   */
  async generateItinerary(params: AiPlannerParams): Promise<Itinerary> {
    try {
      const model = getPlannerModel();
      const result = await model.generateContent(buildItineraryPrompt(params));
      const text = result.response.text();
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
          `If this is the first run, make sure Firebase AI Logic is provisioned (` +
          `run "npx firebase init ailogic" or enable AI Logic for the Gemini Developer API in the Firebase console) and retry.`
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
      const model = getConciergeModel(location || null);
      const chat = model.startChat({
        history: (history || []).slice(-20).map((m) => ({
          role: m.role,
          parts: [{ text: m.text }]
        }))
      });
      const result = await chat.sendMessage(userPrompt);
      const text = result.response.text();
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
          `If this is the first run, make sure Firebase AI Logic is provisioned (` +
          `run "npx firebase init ailogic" or enable AI Logic for the Gemini Developer API in the Firebase console) and retry.`
      );
    }
  }
}

export const aiAgent = new AiTravelAgentService();