import { AiPlannerParams, Itinerary, ChatMessage } from '../types/travel';

export class AiTravelAgentService {
  /**
   * Generates a fully detailed travel itinerary based on parameters.
   */
  async generateItinerary(params: AiPlannerParams): Promise<Itinerary> {
    await new Promise(resolve => setTimeout(resolve, 1200));

    const dest = params.destination.trim() || 'Kyoto';
    const country = this.getCountryForDestination(dest);
    const duration = Math.min(Math.max(params.durationDays, 1), 7);
    const budget = params.budgetLevel || 'Moderate';
    const style = params.travelStyle || 'Couples';
    const interestsStr = params.interests.length > 0 ? params.interests.join(', ') : 'Culture, Gourmet Dining';

    // Generate distinct daily schedules for each day
    const dayPlans = Array.from({ length: duration }).map((_, index) => {
      const dayNum = index + 1;
      return {
        dayNumber: dayNum,
        title: this.getDayTitle(dest, dayNum),
        theme: this.getDayTheme(dayNum),
        activities: this.getActivitiesForDay(dest, dayNum, budget)
      };
    });

    const totalEst = budget === 'Budget' ? `$${duration * 65} - $${duration * 100}` :
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
      summary: `Custom ${duration}-day ${style.toLowerCase()} journey through ${dest} focusing on ${interestsStr} with curated ${budget.toLowerCase()} experiences.`,
      estimatedTotalCost: totalEst,
      bestTimeToVisit: 'Spring (April-May) or Autumn (September-November)',
      dayPlans,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Responds to user chat messages as the AI Travel Concierge.
   */
  async processChatMessage(userPrompt: string): Promise<ChatMessage> {
    await new Promise(resolve => setTimeout(resolve, 600));

    const p = userPrompt.toLowerCase();
    let text = `I'm your AI Travel Concierge! You can ask me for packing tips, local hidden gems, optimal travel seasons, or budget breakdowns for any city.`;
    let suggestions: string[] = ['Best 3-day Kyoto itinerary', 'Top budget travel hacks', 'What to pack for Europe?'];

    if (p.includes('tokyo') && p.includes('restaurant')) {
      text = `🍱 **Top Tokyo Dining Recommendations**:\n1. **Sukiyabashi Jiro** (Ginza) - Iconic Michelin 3-star sushi.\n2. **Ichiran Ramen** (Shibuya) - World-famous solo booth tonkotsu ramen.\n3. **Omoide Yokocho** (Shinjuku) - Atmospheric retro yakitori alleyways under lanterns.`;
      suggestions = ['How to book Tokyo sushi', 'Show Kyoto restaurants', '3-day Tokyo itinerary'];
    } else if (p.includes('japan') || p.includes('tokyo') || p.includes('kyoto')) {
      text = `🇯🇵 **Japan Travel Guide**: Cherry blossom season (late March–April) and autumn foliage (November) are ideal. Purchase a Suica/Pasmo transit card on your phone for easy subway taps, and book Shinkansen bullet trains 30 days in advance!`;
      suggestions = ['Show Kyoto restaurants', '3-day Tokyo itinerary', 'Best Japan souvenirs'];
    } else if (p.includes('budget') || p.includes('cheap') || p.includes('save')) {
      text = `💡 **Smart Budget Hacks**:\n1. Fly during shoulder months (May or September) for ~35% lower fares.\n2. Eat your largest meal at lunchtime when top restaurants offer fixed lunch sets at 50% off dinner prices.\n3. Use local metro caps instead of taxis.`;
      suggestions = ['Create a budget itinerary', 'Filter places by price', 'Top free activities'];
    } else if (p.includes('pack') || p.includes('bring')) {
      text = `🧳 **Essential Packing List**:\n• Multi-port universal power adapter\n• Lightweight packable rain jacket\n• Comfortable broken-in walking shoes (aim for 12,000 steps/day)\n• Copies of passport & travel insurance saved offline.`;
      suggestions = ['Best travel backpacks', 'Offline map guide', 'Europe trip packing'];
    } else if (p.includes('rome') || p.includes('italy')) {
      text = `🇮🇹 **Rome Insider Tip**: Reserve Colosseum underground and Vatican Museum tickets 60 days ahead online. Also, enjoy your morning espresso standing at the bar ("al banco") for €1.20 instead of paying €4+ at tourist outdoor tables!`;
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

  private getCountryForDestination(dest: string): string {
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

  private getDayTitle(dest: string, day: number): string {
    const titles = [
      `Arrival, Historic Quarter & Welcome Feast`,
      `Iconic UNESCO Sights & Traditional Art`,
      `Hidden Backstreets, Local Crafts & Sunset Views`,
      `Nature Reserve Day Trip & Scenic Trails`,
      `Culinary Tasting Tour & Night Bazaars`,
      `Modern Architecture & Boutique Shopping`,
      `Farewell Skyline Cocktail & Golden Hour`
    ];
    return titles[(day - 1) % titles.length];
  }

  private getDayTheme(day: number): string {
    const themes = [
      'Orientation & Welcome',
      'Historic Heritage',
      'Local Life & Backstreets',
      'Nature & Excursions',
      'Culinary Discovery',
      'Shopping & Leisure',
      'Golden Hour Sunset'
    ];
    return themes[(day - 1) % themes.length];
  }

  private getActivitiesForDay(dest: string, day: number, budget: string) {
    const b = budget;
    const costS = b === 'Budget' ? '$10' : b === 'Moderate' ? '$25' : '$60';
    const costM = b === 'Budget' ? '$18' : b === 'Moderate' ? '$45' : '$110';
    const costL = b === 'Budget' ? '$25' : b === 'Moderate' ? '$75' : '$190';

    if (day === 1) {
      return [
        {
          time: '09:00 AM',
          title: `Arrival & Specialty Coffee at ${dest} Old Town`,
          description: `Check into your accommodation, stretch your legs, and enjoy artisanal breakfast and fresh pastries at a historic bakery.`,
          locationName: `${dest} Central Plaza`,
          category: 'Dining',
          estimatedCost: costS
        },
        {
          time: '11:00 AM',
          title: `Orientation Walk through Landmark Square`,
          description: `Stroll through the iconic central square of ${dest}, taking in historic monuments and vibrant street performers.`,
          locationName: `Landmark Square`,
          category: 'Culture',
          estimatedCost: 'Free'
        },
        {
          time: '01:30 PM',
          title: `Traditional Regional Lunch`,
          description: `Savor signature regional specialties and local wine or tea pairings at a top-rated traditional bistro.`,
          locationName: `${dest} Bistro Quarter`,
          category: 'Dining',
          estimatedCost: costM
        },
        {
          time: '04:00 PM',
          title: `Panorama Lookout & Photo Spot`,
          description: `Ascend to the highest scenic viewpoint in ${dest} for sweeping city horizon views during golden hour.`,
          locationName: `${dest} Hilltop Outlook`,
          category: 'Outdoor',
          estimatedCost: costS
        },
        {
          time: '07:30 PM',
          title: `Welcome Dinner & Ambient Lounge`,
          description: `Relax with a memorable multi-course dinner featuring seasonal local ingredients and handcrafted beverages.`,
          locationName: `${dest} Sunset Grill`,
          category: 'Nightlife',
          estimatedCost: costL
        }
      ];
    } else if (day === 2) {
      return [
        {
          time: '08:30 AM',
          title: `Early Morning Access to Heritage Temple / Museum`,
          description: `Beat the tourist crowds with early skip-the-line entrance to ${dest}'s most famous historical architectural treasure.`,
          locationName: `Grand National Heritage Site`,
          category: 'Culture',
          estimatedCost: costM
        },
        {
          time: '11:30 AM',
          title: `Artisanal Craft Workshop & Studio Visit`,
          description: `Meet local craftsmen and master artisans preserving centuries of regional handcraft traditions.`,
          locationName: `Artisan Village Quarter`,
          category: 'Culture',
          estimatedCost: costS
        },
        {
          time: '01:00 PM',
          title: `Courtyard Garden Lunch`,
          description: `Dine in a tranquil shaded courtyard garden serving wood-fired flatbreads and fresh garden salads.`,
          locationName: `Garden Terrace Cafe`,
          category: 'Dining',
          estimatedCost: costM
        },
        {
          time: '03:30 PM',
          title: `Historic Canal or Promenade Stroll`,
          description: `Enjoy a relaxing afternoon walk along the historic waterfront promenade lined with vintage bookshops and coffee stalls.`,
          locationName: `Waterfront Promenade`,
          category: 'Outdoor',
          estimatedCost: 'Free'
        },
        {
          time: '08:00 PM',
          title: `Acoustic Music & Cocktail Lounge`,
          description: `Unwind at a cozy speakeasy featuring live acoustic jazz and custom botanical cocktails.`,
          locationName: `Velvet Lounge Bar`,
          category: 'Nightlife',
          estimatedCost: costL
        }
      ];
    } else if (day === 3) {
      return [
        {
          time: '09:00 AM',
          title: `Bustling Morning Farmers & Spice Market`,
          description: `Explore sensory aisles filled with fresh exotic fruits, rare spices, artisanal cheeses, and local delicacies.`,
          locationName: `${dest} Grand Spice Market`,
          category: 'Shopping',
          estimatedCost: costS
        },
        {
          time: '11:30 AM',
          title: `Guided Food & Street Tasting Tour`,
          description: `Sample 6 iconic local bites accompanied by an expert culinary historian guide.`,
          locationName: `Old Bazaar Street`,
          category: 'Dining',
          estimatedCost: costM
        },
        {
          time: '02:30 PM',
          title: `Modern Art & Sculpture Gallery`,
          description: `Visit cutting-edge contemporary art installations and rooftop sculpture gardens.`,
          locationName: `Contemporary Art Hub`,
          category: 'Culture',
          estimatedCost: costS
        },
        {
          time: '05:00 PM',
          title: `Tea / Wine Masterclass Experience`,
          description: `Participate in a guided tasting session led by a certified sommelier or master tea maker.`,
          locationName: `Heritage Tasting Cellar`,
          category: 'Dining',
          estimatedCost: costM
        },
        {
          time: '07:30 PM',
          title: `Rooftop Skyline Dinner`,
          description: `Dine under twinkling festoon lights with panoramic 360-degree night views over ${dest}.`,
          locationName: `Skyline Rooftop Restaurant`,
          category: 'Nightlife',
          estimatedCost: costL
        }
      ];
    } else {
      return [
        {
          time: '09:00 AM',
          title: `Excursion Day: Scenic Botanical Gardens`,
          description: `Travel slightly outside the city center to explore sprawling conservatory glasshouses and serene lakes.`,
          locationName: `Royal Botanical Sanctuary`,
          category: 'Outdoor',
          estimatedCost: costS
        },
        {
          time: '12:30 PM',
          title: `Lakeside Pavilion Lunch`,
          description: `Enjoy fresh seafood or farm-to-table cuisine overlooking quiet water reflections.`,
          locationName: `Pavilion Lakeside Grill`,
          category: 'Dining',
          estimatedCost: costM
        },
        {
          time: '03:00 PM',
          title: `Boutique Shopping & Vintage Flea Markets`,
          description: `Find unique travel souvenirs, antique jewelry, and local designer apparel.`,
          locationName: `Design District Alley`,
          category: 'Shopping',
          estimatedCost: costM
        },
        {
          time: '07:00 PM',
          title: `Farewell Feast & Celebration Night`,
          description: `Cap off your journey with a memorable multi-course celebration feast and signature dessert tasting.`,
          locationName: `Imperial Dining Hall`,
          category: 'Dining',
          estimatedCost: costL
        }
      ];
    }
  }
}

export const aiAgent = new AiTravelAgentService();
