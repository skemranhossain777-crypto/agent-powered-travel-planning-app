import { getGenerativeModel, Schema, GenerativeModel } from 'firebase/ai';
import { getAIService } from './firebase';
import { AiPlannerParams, Itinerary, ChatMessage, DayPlan, Activity } from '../types/travel';

/**
 * The current stable Gemini model for text/structured output on the
 * Gemini Developer API (no billing required). See
 * https://firebase.google.com/docs/ai-logic/models for the latest list.
 */
const TEXT_MODEL = 'gemini-3.7-flash';

let plannerModel: GenerativeModel | null = null;
let conciergeModel: GenerativeModel | null = null;

/**
 * Lazily builds models. Returns null until the AI SDK can be initialized.
 * getGenerativeModel itself does not hit the network, so this is safe.
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

function getConciergeModel(): GenerativeModel {
  if (!conciergeModel) {
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
        `Never invent dangerous or misleading safety info. Keep answers under ~200 words and use simple markdown (bold headings and dashes) that renders well in a chat.`
      ].join('\n')
    });
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

function buildItinerary(raw: RawItinerary, params: AiPlannerParams): Itinerary {
  const destination = raw.destination || params.destination || 'Worldwide';
  const durationDays = raw.durationDays ?? params.durationDays;
  const dayPlans: DayPlan[] = (raw.dayPlans || []).slice(0, durationDays).map((d, i) => ({
    dayNumber: d.dayNumber ?? i + 1,
    title: d.title || `Day ${i + 1}`,
    theme: d.theme || 'Adventure',
    activities: (d.activities || []).map((a) => ({
      time: a.time || 'TBD',
      title: a.title || 'Activity',
      description: a.description || '',
      locationName: a.locationName || '',
      category: a.category || 'Sightseeing',
      estimatedCost: a.estimatedCost || 'Varies'
    }))
  }));

  return {
    id: `itin-${Date.now()}`,
    destination,
    country: raw.country || `Global Destination`,
    durationDays,
    budgetLevel: normalizeBudget(raw.budgetLevel || params.budgetLevel),
    travelStyle: raw.travelStyle || params.travelStyle,
    interests: (raw.interests && raw.interests.length ? raw.interests : params.interests),
    summary: raw.summary || `Personalized ${durationDays}-day journey through ${destination}.`,
    estimatedTotalCost: raw.estimatedTotalCost || 'Varies by season',
    bestTimeToVisit: raw.bestTimeToVisit || 'Check local climate for your travel dates',
    dayPlans,
    createdAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Public API (kept identical to the previous mock for drop-in compatibility)
// ---------------------------------------------------------------------------

export class AiTravelAgentService {
  /**
   * Generates a fully detailed travel itinerary using Gemini with structured output.
   * Falls back to a deterministic local generator if the AI service is unavailable
   * (e.g. AI Logic has not been provisioned yet).
   */
  async generateItinerary(params: AiPlannerParams): Promise<Itinerary> {
    const prompt = [
      `Create a realistic, personalized travel itinerary.`,
      `Destination: ${params.destination.trim() || 'A top global destination'}`,
      `Duration: ${params.durationDays} days`,
      `Budget: ${params.budgetLevel}`,
      `Travel style: ${params.travelStyle}`,
      `Interests: ${params.interests.join(', ') || 'General sightseeing'}`,
      ``,
      `Return only valid JSON that matches the requested schema.`,
      `Make the itinerary specific and realistic (real neighborhoods, real landmark names, real cuisine) rather than generic placeholder text.`,
      `Estimate costs in USD per activity. bestTimeToVisit should mention the ideal months for that destination.`
    ].join('\n');

    try {
      const model = getPlannerModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const raw = JSON.parse(text) as RawItinerary;
      const itinerary = buildItinerary(raw, params);
      // Guard: if the model returned no usable day plans, fall back to local.
      if (itinerary.dayPlans.length === 0) {
        return this.generateLocalItinerary(params);
      }
      return itinerary;
    } catch (err) {
      console.warn('[AiTravelAgent] Gemini itinerary failed, using local fallback:', err);
      return this.generateLocalItinerary(params);
    }
  }

  /**
   * Responds to user chat messages using a Gemini multi-turn chat session.
   * Falls back to the deterministic concierge if the AI service is unavailable.
   */
  async processChatMessage(
    userPrompt: string,
    history?: Array<{ role: 'user' | 'model'; text: string }>
  ): Promise<ChatMessage> {
    try {
      const model = getConciergeModel();
      const chat = model.startChat({
        history: (history || []).slice(-20).map((m) => ({
          role: m.role,
          parts: [{ text: m.text }]
        }))
      });
      const result = await chat.sendMessage(userPrompt);
      const text = result.response.text();
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const hasMarkdown = /\*\*|^[-*] |^#/.test(text);
      const suggestions: string[] | undefined = this.suggestFollowUps(userPrompt);
      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        text,
        timestamp: time,
        suggestions: suggestions && suggestions.length ? suggestions : undefined
      };
    } catch (err) {
      console.warn('[AiTravelAgent] Gemini chat failed, using local fallback:', err);
      return this.processLocalChatMessage(userPrompt);
    }
  }

  private suggestFollowUps(prompt: string): string[] | undefined {
    const p = prompt.toLowerCase();
    if (p.includes('restaurant') || p.includes('food') || p.includes('dining')) {
      return ['Best budget food cities', 'Top fine-dining spots', 'Hidden street food gems'];
    }
    if (p.includes('pack') || p.includes('bring')) {
      return ['Packing for cold weather', 'Packing for beach trip', 'Travel gadget essentials'];
    }
    if (p.includes('budget') || p.includes('cheap') || p.includes('cost')) {
      return ['Low-cost destinations', 'Save on flights', 'Budget daily breakdown'];
    }
    if (p.includes('season') || p.includes('best time') || p.includes('weather')) {
      return ['Dry-season destinations', 'Ski season tips', 'Monsoon-safe travel'];
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Local (offline) fallback generators — deterministic, no network required.
  // -------------------------------------------------------------------------

  private generateLocalItinerary(params: AiPlannerParams): Itinerary {
    const dest = params.destination.trim() || 'Kyoto';
    const country = this.localCountry(dest);
    const duration = Math.min(Math.max(params.durationDays, 1), 7);
    const budget = params.budgetLevel;
    const style = params.travelStyle;

    const dayPlans: DayPlan[] = Array.from({ length: duration }).map((_, index) => {
      const dayNum = index + 1;
      return {
        dayNumber: dayNum,
        title: this.localDayTitle(dayNum),
        theme: this.localTheme(dayNum),
        activities: this.localActivities(dayNum, budget)
      };
    });

    const totalEst =
      budget === 'Budget' ? `$${duration * 65} - $${duration * 100}` :
        budget === 'Moderate' ? `$${duration * 170} - $${duration * 250}` :
          `$${duration * 420} - $${duration * 700}`;

    return {
      id: `itin-${Date.now()}`,
      destination: dest,
      country,
      durationDays: duration,
      budgetLevel: budget,
      travelStyle: style,
      interests: params.interests,
      summary: `Custom ${duration}-day ${style.toLowerCase()} journey through ${dest} focusing on ${params.interests.join(', ') || 'culture'}.`,
      estimatedTotalCost: totalEst,
      bestTimeToVisit: 'Spring (April-May) or Autumn (September-November)',
      dayPlans,
      createdAt: new Date().toISOString()
    };
  }

  private localCountry(dest: string): string {
    const d = dest.toLowerCase();
    if (d.includes('rome') || d.includes('florence') || d.includes('venice')) return 'Italy';
    if (d.includes('kyoto') || d.includes('tokyo') || d.includes('osaka')) return 'Japan';
    if (d.includes('paris') || d.includes('nice')) return 'France';
    if (d.includes('singapore')) return 'Singapore';
    if (d.includes('istanbul')) return 'Turkey';
    if (d.includes('bali')) return 'Indonesia';
    if (d.includes('new york') || d.includes('miami')) return 'USA';
    return 'Global Destination';
  }

  private localDayTitle(day: number): string {
    const t = [
      'Arrival, Historic Quarter & Welcome Feast',
      'Iconic UNESCO Sights & Traditional Art',
      'Hidden Backstreets, Local Crafts & Sunset Views',
      'Nature Reserve Day Trip & Scenic Trails',
      'Culinary Tasting Tour & Night Bazaars',
      'Modern Architecture & Boutique Shopping',
      'Farewell Skyline Cocktail & Golden Hour'
    ];
    return t[(day - 1) % t.length];
  }

  private localTheme(day: number): string {
    const t = [
      'Orientation & Welcome',
      'Historic Heritage',
      'Local Life & Backstreets',
      'Nature & Excursions',
      'Culinary Discovery',
      'Shopping & Leisure',
      'Golden Hour Sunset'
    ];
    return t[(day - 1) % t.length];
  }

  private localActivities(day: number, budget: string): Activity[] {
    const b = budget;
    const costS = b === 'Budget' ? '$10' : b === 'Moderate' ? '$25' : '$60';
    const costM = b === 'Budget' ? '$18' : b === 'Moderate' ? '$45' : '$110';
    const costL = b === 'Budget' ? '$25' : b === 'Moderate' ? '$75' : '$190';

    if (day === 1) {
      return [
        { time: '09:00 AM', title: 'Arrival & Specialty Coffee in Old Town', description: 'Check in, stretch your legs, and enjoy artisanal breakfast at a historic bakery.', locationName: 'Central Plaza', category: 'Dining', estimatedCost: costS },
        { time: '11:00 AM', title: 'Orientation Walk through Landmark Square', description: 'Stroll through the iconic central square taking in monuments and street performers.', locationName: 'Landmark Square', category: 'Culture', estimatedCost: 'Free' },
        { time: '01:30 PM', title: 'Traditional Regional Lunch', description: 'Savor signature regional specialties and local wine or tea pairings.', locationName: 'Bistro Quarter', category: 'Dining', estimatedCost: costM },
        { time: '04:00 PM', title: 'Panorama Lookout & Photo Spot', description: 'Ascend to the highest scenic viewpoint for sweeping city views during golden hour.', locationName: 'Hilltop Outlook', category: 'Outdoor', estimatedCost: costS },
        { time: '07:30 PM', title: 'Welcome Dinner & Ambient Lounge', description: 'A memorable multi-course dinner featuring seasonal local ingredients.', locationName: 'Sunset Grill', category: 'Nightlife', estimatedCost: costL }
      ];
    } else if (day === 2) {
      return [
        { time: '08:30 AM', title: 'Early Morning Access to Heritage Site', description: 'Beat the crowds with early skip-the-line entrance to the most famous historical treasure.', locationName: 'Grand National Heritage Site', category: 'Culture', estimatedCost: costM },
        { time: '11:30 AM', title: 'Artisanal Craft Workshop & Studio Visit', description: 'Meet local craftsmen preserving centuries of regional handcraft traditions.', locationName: 'Artisan Village Quarter', category: 'Culture', estimatedCost: costS },
        { time: '01:00 PM', title: 'Courtyard Garden Lunch', description: 'Dine in a tranquil shaded courtyard garden with wood-fired flatbreads and salads.', locationName: 'Garden Terrace Cafe', category: 'Dining', estimatedCost: costM },
        { time: '03:30 PM', title: 'Historic Canal or Promenade Stroll', description: 'Enjoy a relaxing afternoon walk along the waterfront promenade.', locationName: 'Waterfront Promenade', category: 'Outdoor', estimatedCost: 'Free' },
        { time: '08:00 PM', title: 'Acoustic Music & Cocktail Lounge', description: 'Unwind at a cozy speakeasy featuring live acoustic jazz.', locationName: 'Velvet Lounge Bar', category: 'Nightlife', estimatedCost: costL }
      ];
    } else if (day === 3) {
      return [
        { time: '09:00 AM', title: 'Bustling Morning Farmers & Spice Market', description: 'Explore sensory aisles filled with fresh exotic fruits, rare spices, and local delicacies.', locationName: 'Grand Spice Market', category: 'Shopping', estimatedCost: costS },
        { time: '11:30 AM', title: 'Guided Food & Street Tasting Tour', description: 'Sample 6 iconic local bites with an expert culinary historian guide.', locationName: 'Old Bazaar Street', category: 'Dining', estimatedCost: costM },
        { time: '02:30 PM', title: 'Modern Art & Sculpture Gallery', description: 'Visit cutting-edge contemporary art installations and rooftop sculpture gardens.', locationName: 'Contemporary Art Hub', category: 'Culture', estimatedCost: costS },
        { time: '05:00 PM', title: 'Tea / Wine Masterclass Experience', description: 'Participate in a guided tasting session led by a certified sommelier.', locationName: 'Heritage Tasting Cellar', category: 'Dining', estimatedCost: costM },
        { time: '07:30 PM', title: 'Rooftop Skyline Dinner', description: 'Dine under twinkling lights with panoramic 360-degree night views.', locationName: 'Skyline Rooftop Restaurant', category: 'Nightlife', estimatedCost: costL }
      ];
    } else {
      return [
        { time: '09:00 AM', title: 'Excursion: Scenic Botanical Gardens', description: 'Travel slightly outside the city to explore sprawling conservatory glasshouses.', locationName: 'Royal Botanical Sanctuary', category: 'Outdoor', estimatedCost: costS },
        { time: '12:30 PM', title: 'Lakeside Pavilion Lunch', description: 'Enjoy fresh seafood or farm-to-table cuisine overlooking quiet water reflections.', locationName: 'Pavilion Lakeside Grill', category: 'Dining', estimatedCost: costM },
        { time: '03:00 PM', title: 'Boutique Shopping & Vintage Flea Markets', description: 'Find unique travel souvenirs, antique jewelry, and local designer apparel.', locationName: 'Design District Alley', category: 'Shopping', estimatedCost: costM },
        { time: '07:00 PM', title: 'Farewell Feast & Celebration Night', description: 'Cap off your journey with a memorable multi-course celebration feast.', locationName: 'Imperial Dining Hall', category: 'Dining', estimatedCost: costL }
      ];
    }
  }

  private processLocalChatMessage(userPrompt: string): ChatMessage {
    const p = userPrompt.toLowerCase();
    let text = `I'm your AI Travel Concierge! Ask me for packing tips, local hidden gems, optimal travel seasons, or budget breakdowns for any city.`;
    let suggestions: string[] | undefined = ['Best 3-day Kyoto itinerary', 'Top budget travel hacks', 'What to pack for Europe?'];

    if (p.includes('tokyo') && p.includes('restaurant')) {
      text = `🍱 **Top Tokyo Dining**:\n1. **Sukiyabashi Jiro** (Ginza) - Iconic Michelin 3-star sushi.\n2. **Ichiran Ramen** (Shibuya) - Famous solo booth tonkotsu ramen.\n3. **Omoide Yokocho** (Shinjuku) - Retro yakitori alleyways under lanterns.`;
      suggestions = ['How to book Tokyo sushi', 'Show Kyoto restaurants', '3-day Tokyo itinerary'];
    } else if (p.includes('japan') || p.includes('tokyo') || p.includes('kyoto')) {
      text = `🇯🇵 **Japan Travel Guide**: Cherry blossom season (late March–April) and autumn foliage (November) are ideal. Purchase a Suica/Pasmo transit card for easy subway taps, and book Shinkansen bullet trains 30 days in advance!`;
      suggestions = ['Show Kyoto restaurants', '3-day Tokyo itinerary', 'Best Japan souvenirs'];
    } else if (p.includes('budget') || p.includes('cheap') || p.includes('save')) {
      text = `💡 **Smart Budget Hacks**:\n1. Fly during shoulder months (May or September) for ~35% lower fares.\n2. Eat your largest meal at lunchtime when top restaurants offer fixed lunch sets.\n3. Use local metro caps instead of taxis.`;
      suggestions = ['Create a budget itinerary', 'Filter places by price', 'Top free activities'];
    } else if (p.includes('pack') || p.includes('bring')) {
      text = `🧳 **Essential Packing List**:\n• Multi-port universal power adapter\n• Lightweight packable rain jacket\n• Comfortable broken-in walking shoes\n• Copies of passport & travel insurance saved offline.`;
      suggestions = ['Best travel backpacks', 'Offline map guide', 'Europe trip packing'];
    } else if (p.includes('rome') || p.includes('italy')) {
      text = `🇮🇹 **Rome Insider Tip**: Reserve Colosseum underground and Vatican Museum tickets 60 days ahead online. Enjoy your morning espresso standing at the bar ("al banco") for €1.20 instead of €4+ at tourist tables!`;
      suggestions = ['Find Rome restaurants', 'Colosseum booking tips', 'Rome 3-day itinerary'];
    }

    return {
      id: `msg-${Date.now()}`,
      sender: 'assistant',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestions
    };
  }
}

export const aiAgent = new AiTravelAgentService();
