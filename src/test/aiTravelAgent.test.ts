import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiPlannerParams, Category, User } from '../types/travel';
import { aiAgent } from '../services/aiTravelAgent';
import { dataConnect } from '../services/dataConnectService';

const h = vi.hoisted(() => {
  const behaviors: Record<string, () => string> = {};
  const callCount: Record<string, number> = {};
  const categories: Category[] = [];
  return { behaviors, callCount, categories };
});

vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...actual,
    getGenerativeModel: vi.fn((_ai: unknown, config: { model?: string }) => ({
      model: config?.model,
      generateContent: vi.fn(async () => {
        const alias = config?.model || '';
        h.callCount[alias] = (h.callCount[alias] || 0) + 1;
        return { response: { text: () => (h.behaviors[alias] || (() => '{}'))() } };
      }),
      startChat: vi.fn(() => ({
        sendMessage: vi.fn(async () => {
          const alias = config?.model || '';
          h.callCount[alias] = (h.callCount[alias] || 0) + 1;
          return { response: { text: () => (h.behaviors[alias] || (() => '{}'))() } };
        }),
      })),
    })),
  };
});

vi.mock('../services/firebase', () => ({
  getAIService: vi.fn(() => ({})),
}));

vi.mock('../services/dataConnectService', () => ({
  dataConnect: {
    getCategories: vi.fn(async () => h.categories),
    getActivity: vi.fn(() => []),
    recordActivityFromService: vi.fn(),
  },
}));

vi.mock('../services/placeImages', () => ({
  enrichPlacesWithImages: vi.fn(async (places: import('../types/travel').Place[]) => places),
}));

const params: AiPlannerParams = {
  destination: 'Bali',
  durationDays: 3,
  budgetLevel: 'Moderate',
  travelStyle: 'Couples',
  interests: ['Beaches'],
};

describe('aiTravelAgent.discoverPlaces', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.behaviors = {};
    h.callCount = {};
    h.categories = [];
  });

  it('maps a valid JSON response into normalized places', async () => {
    h.categories = [
      { id: 'cat-rest', name: 'Restaurants & Dining', iconUrl: 'Utensils', description: 'Dining' },
    ];
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [
          {
            name: 'Trattoria da Enzo',
            city: 'Rome',
            country: 'Italy',
            category: 'Restaurant',
            description: 'Classic Roman trattoria',
            tags: ['pasta', 'wine'],
            priceLevel: '$$$',
            averageRating: 8.2,
            reviewCount: 120,
            latitude: 41.9,
            longitude: 12.49,
            websiteUrl: 'https://example.com',
          },
        ],
      });

    const places = await aiAgent.discoverPlaces('best pasta in Rome');
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      name: 'Trattoria da Enzo',
      categoryId: 'cat-rest',
      priceLevel: '$$$',
      averageRating: 5,
      reviewCount: 120,
      location: [41.9, 12.49],
    });
    expect(places[0].category?.id).toBe('cat-rest');
  });

  it('rejects with a friendly wrapper when the model returns invalid JSON', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => 'not json {';
    await expect(aiAgent.discoverPlaces('anything')).rejects.toThrow(/AI couldn't discover places/);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '[AiTravelAgent] Place discovery failed:',
      expect.objectContaining({ message: expect.stringContaining('invalid JSON') })
    );
  });

  it('skips places missing required fields', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [
          { name: 'Full Place', city: 'Paris', country: 'France' },
          { name: 'No City', country: 'France' },
          { name: '', city: 'Paris', country: 'France' },
          { city: 'Paris', country: 'France' },
        ],
      });

    const places = await aiAgent.discoverPlaces('unique three', null, 8);
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('Full Place');
  });

  it('dedupes identical name/city/country entries', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [
          { name: 'Luna Park', city: 'Sydney', country: 'Australia' },
          { name: 'Luna Park', city: 'Sydney', country: 'Australia' },
        ],
      });

    const places = await aiAgent.discoverPlaces('unique four', null, 8);
    expect(places).toHaveLength(1);
  });

  it('clamps rating and coerces invalid field types', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [
          {
            name: 'Museum',
            city: 'Kyoto',
            country: 'Japan',
            category: 'Museum',
            averageRating: '-6',
            reviewCount: '-3',
            priceLevel: '¥¥',
            latitude: 'nan',
            longitude: 'nan',
          },
        ],
      });

    const [place] = await aiAgent.discoverPlaces('unique five', null, 8);
    expect(place.averageRating).toBe(4.5);
    expect(place.reviewCount).toBe(1);
    expect(place.priceLevel).toBe('$$');
    expect(place.location).toEqual([0, 0]);
  });

  it('falls back to the next model alias on retriable errors', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('429 RESOURCE_EXHAUSTED: quota exceeded');
    };
    h.behaviors['gemini-3.6-flash'] = () =>
      JSON.stringify({ places: [{ name: 'Retry Place', city: 'Oslo', country: 'Norway' }] });

    const places = await aiAgent.discoverPlaces('unique six');
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('Retry Place');
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
    expect(h.callCount['gemini-3.6-flash']).toBe(1);
  });

  it('does not retry on a non-retriable model error', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('network disconnected');
    };

    await expect(aiAgent.discoverPlaces('unique seven')).rejects.toThrow(
      /AI couldn't discover places/
    );
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
    expect(h.callCount['gemini-3.6-flash']).toBeUndefined();
  });

  it('reuses a recent result from the discover cache without calling the model again', async () => {
    const fn = vi.fn(() =>
      JSON.stringify({ places: [{ name: 'Cached Place', city: 'Lyon', country: 'France' }] })
    );
    h.behaviors['gemini-3.5-flash-lite'] = fn;

    const first = await aiAgent.discoverPlaces('cache me please', null, 8);
    const second = await aiAgent.discoverPlaces('cache me please', null, 8);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('records discovery activity for signed-in users', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [
          { name: 'Anken', city: 'Zurich', country: 'Switzerland' },
          { name: 'Second Place', city: 'Zurich', country: 'Switzerland' },
        ],
      });

    const user = { id: 'u1' } as User;
    await aiAgent.discoverPlaces('unique nine', null, 8, user);
    expect(vi.mocked(dataConnect.recordActivityFromService)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(dataConnect.recordActivityFromService)).toHaveBeenCalledWith(
      'discover',
      expect.objectContaining({ detail: 'unique nine' }),
      'u1'
    );
  });

  it('throws a friendly error when the model returns no usable places', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => JSON.stringify({ places: [] });

    await expect(aiAgent.discoverPlaces('unique ten')).rejects.toThrow(
      /AI couldn't discover places/
    );
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '[AiTravelAgent] Place discovery failed:',
      expect.objectContaining({ message: expect.stringContaining('no usable places') })
    );
  });

  it('skips non-object entries in the places array', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        places: [null, 'text entry', 42, { name: 'Valid Spot', city: 'Oslo', country: 'Norway' }],
      });

    const places = await aiAgent.discoverPlaces('unique eleven', null, 8);
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('Valid Spot');
  });
});

describe('aiTravelAgent.generateItinerary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.behaviors = {};
    h.callCount = {};
  });

  it('builds a normalized itinerary from a valid JSON response', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        destination: 'Bali',
        country: 'Indonesia',
        durationDays: 3,
        budgetLevel: 'Luxury',
        travelStyle: 'Couples',
        interests: ['Beaches'],
        dayPlans: [
          { dayNumber: 1, title: 'Beach Day', activities: [{ title: 'Snorkel', time: '09:00' }] },
          { dayNumber: 2, title: 'Temple', activities: [] },
          { dayNumber: 3, title: 'Sunset', activities: [] },
          { dayNumber: 4, title: 'Ignored', activities: [] },
        ],
      });

    const itinerary = await aiAgent.generateItinerary(params);
    expect(itinerary.dayPlans).toHaveLength(3);
    expect(itinerary.destination).toBe('Bali');
    expect(itinerary.budgetLevel).toBe('Luxury');
    expect(itinerary.dayPlans[0].activities[0]).toMatchObject({ title: 'Snorkel', time: '09:00' });
    expect(itinerary.hotels).toEqual([]);
    expect(itinerary.createdAt).toEqual(expect.any(String));
  });

  it('rejects when the itinerary has no daily plans', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => JSON.stringify({ destination: 'X', dayPlans: [] });
    await expect(aiAgent.generateItinerary(params)).rejects.toThrow(/no daily plans/);
  });

  it('rejects on malformed itinerary JSON', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => 'not-json';
    await expect(aiAgent.generateItinerary(params)).rejects.toThrow(
      /AI planner couldn't create a real itinerary/
    );
  });

  it('falls back to the next alias when generating an itinerary', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('quota exceeded');
    };
    h.behaviors['gemini-3.6-flash'] = () =>
      JSON.stringify({ destination: 'Retry', dayPlans: [{ dayNumber: 1, activities: [] }] });

    const itinerary = await aiAgent.generateItinerary(params);
    expect(itinerary.destination).toBe('Retry');
    expect(h.callCount['gemini-3.6-flash']).toBe(1);
  });

  it('coerces a string duration and drops malformed day-plan entries', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        destination: 'Kyoto',
        durationDays: '3',
        dayPlans: [
          { dayNumber: '1', title: 'First', activities: [{ title: 'Temple', time: '09:00' }] },
          'garbage',
          null,
          { dayNumber: 3, title: 'Third' },
        ],
      });

    const itinerary = await aiAgent.generateItinerary(params);
    expect(itinerary.durationDays).toBe(3);
    expect(itinerary.dayPlans).toHaveLength(2);
    expect(itinerary.dayPlans[0].dayNumber).toBe(1);
    expect(itinerary.dayPlans[0].activities[0]).toMatchObject({
      title: 'Temple',
      time: '09:00',
    });
    expect(itinerary.dayPlans[1]).toMatchObject({ dayNumber: 3, title: 'Third' });
  });

  it('coerces numeric string and number values for nested fields', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        destination: 'Paris',
        durationDays: 2,
        budgetLevel: 'luxury',
        transport: [{ mode: 'train', route: 'London → Paris', estimatedCost: 40 }],
        hotels: [{ name: 'Grand Paris', area: 'Le Marais', ratePerNight: 200 }],
        dayPlans: [{ dayNumber: '1', activities: [{ title: 'Louvre', estimatedCost: '17' }] }],
      });

    const itinerary = await aiAgent.generateItinerary(params);
    expect(itinerary.budgetLevel).toBe('Luxury');
    expect(itinerary.dayPlans).toHaveLength(1);
    expect(itinerary.transport).toEqual([
      { mode: 'train', route: 'London → Paris', estimatedCost: '40' },
    ]);
    expect(itinerary.hotels?.[0]).toMatchObject({ name: 'Grand Paris', ratePerNight: '200' });
    expect(itinerary.dayPlans[0].activities[0]).toMatchObject({
      title: 'Louvre',
      estimatedCost: '17',
    });
  });

  it('treats a non-object JSON response as empty and reports no daily plans', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => '"just a string"';
    await expect(aiAgent.generateItinerary(params)).rejects.toThrow(/no daily plans/);
  });
});

describe('aiTravelAgent.processChatMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.behaviors = {};
    h.callCount = {};
  });

  it('returns an assistant chat message', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => '**Hello!** Here are some tips.';

    const msg = await aiAgent.processChatMessage('Hi');
    expect(msg.sender).toBe('assistant');
    expect(msg.text).toBe('**Hello!** Here are some tips.');
    expect(msg.timestamp).toEqual(expect.any(String));
  });

  it('wraps chat model failures in a friendly error', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('network disconnected');
    };

    await expect(aiAgent.processChatMessage('Where should I go?')).rejects.toThrow(
      /couldn't respond/
    );
  });
});
