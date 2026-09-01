import { Place, Category, Review, Bookmark, User, Itinerary } from '../types/travel';

// Initial Seed Data mirroring dataconnect/seed_data.gql & expanded with rich visual destinations
const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'cat-rest',
    name: 'Restaurants & Dining',
    iconUrl: 'Utensils',
    description: 'Michelin star fine dining, authentic street food, and cozy local cafes.',
    color: '#ff5e62'
  },
  {
    id: 'cat-hist',
    name: 'Historical Sites',
    iconUrl: 'Landmark',
    description: 'Ancient monuments, UNESCO heritage sites, and historical landmarks.',
    color: '#ff9966'
  },
  {
    id: 'cat-out',
    name: 'Outdoor & Nature',
    iconUrl: 'Trees',
    description: 'Breathtaking hiking trails, pristine beaches, and national parks.',
    color: '#00b09b'
  },
  {
    id: 'cat-night',
    name: 'Nightlife & Bars',
    iconUrl: 'Wine',
    description: 'Rooftop cocktail lounges, vibrant dance clubs, and acoustic venues.',
    color: '#96c93d'
  },
  {
    id: 'cat-shop',
    name: 'Shopping & Bazaars',
    iconUrl: 'ShoppingBag',
    description: 'Luxury boutiques, vintage flea markets, and bustling local bazaars.',
    color: '#7000ff'
  },
  {
    id: 'cat-hotel',
    name: 'Hotels & Resorts',
    iconUrl: 'Hotel',
    description: 'Boutique staycation spots, luxury resorts, and eco-lodges.',
    color: '#00f2fe'
  }
];

const INITIAL_PLACES: Place[] = [
  {
    id: 'place-1',
    name: 'La Pergola & Skyline Lounge',
    categoryId: 'cat-rest',
    category: INITIAL_CATEGORIES[0],
    location: [41.9028, 12.4964],
    city: 'Rome',
    country: 'Italy',
    address: 'Via Cadlolo 101, 00136 Roma RM',
    description: 'Panoramic 3-star Michelin dining overlooking the Eternal City with rare vintage pairings and artisanal pasta.',
    websiteUrl: 'https://lapergolarome.it',
    imageUrl: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.9,
    reviewCount: 342,
    priceLevel: '$$$$',
    tags: ['Michelin Star', 'Panoramic View', 'Romantic', 'Wine Pairing']
  },
  {
    id: 'place-2',
    name: 'Colosseum & Ancient Forum',
    categoryId: 'cat-hist',
    category: INITIAL_CATEGORIES[1],
    location: [41.8902, 12.4922],
    city: 'Rome',
    country: 'Italy',
    address: 'Piazza del Colosseo, 1, 00184 Roma RM',
    description: 'Iconic 1st-century amphitheater built under Vespasian. Skip-the-line underground arena access available.',
    websiteUrl: 'https://parcocolosseo.it',
    imageUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.8,
    reviewCount: 12400,
    priceLevel: '$$',
    tags: ['UNESCO', 'Ancient History', 'Architecture', 'Must See']
  },
  {
    id: 'place-3',
    name: 'Arashiyama Bamboo Grove',
    categoryId: 'cat-out',
    category: INITIAL_CATEGORIES[2],
    location: [35.017, 135.6713],
    city: 'Kyoto',
    country: 'Japan',
    address: 'Ukyo Ward, Kyoto, 616-8394',
    description: 'Enchanting soaring bamboo forest paths with ethereal sunbeams, Tenryu-ji Temple garden, and monkey park.',
    websiteUrl: 'https://kyoto.travel/en/arashiyama',
    imageUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.9,
    reviewCount: 8900,
    priceLevel: '$',
    tags: ['Nature', 'Zen', 'Photography', 'Peaceful']
  },
  {
    id: 'place-4',
    name: 'Ce La Vi Rooftop Lounge',
    categoryId: 'cat-night',
    category: INITIAL_CATEGORIES[3],
    location: [1.2834, 103.8607],
    city: 'Singapore',
    country: 'Singapore',
    address: '1 Bayfront Ave, Hotel Tower 3, Marina Bay Sands',
    description: 'Iconic rooftop cocktail sanctuary 57 levels high above Marina Bay Sands Infinity Pool with live DJ sets.',
    websiteUrl: 'https://celavi.com/singapore',
    imageUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.7,
    reviewCount: 2150,
    priceLevel: '$$$$',
    tags: ['Rooftop Bar', 'Skyline View', 'Cocktails', 'Nightlife']
  },
  {
    id: 'place-5',
    name: 'Grand Bazaar (Kapalıçarşı)',
    categoryId: 'cat-shop',
    category: INITIAL_CATEGORIES[4],
    location: [41.0107, 28.968],
    city: 'Istanbul',
    country: 'Turkey',
    address: 'Beyazıt, Kalpakçılar Cd. No:22, 34126 Fatih/İstanbul',
    description: 'One of the world’s oldest covered markets featuring 4,000+ shops with handwoven carpets, spices, and ceramics.',
    websiteUrl: 'https://kapalicarsi.com.tr',
    imageUrl: 'https://images.unsplash.com/photo-1527838832700-54595d1b4596?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.6,
    reviewCount: 9400,
    priceLevel: '$$',
    tags: ['Bazaar', 'Spices & Antiques', 'Shopping', 'Cultural']
  },
  {
    id: 'place-6',
    name: 'Aman Tokyo Sanctuary & Spa',
    categoryId: 'cat-hotel',
    category: INITIAL_CATEGORIES[5],
    location: [35.6868, 139.7645],
    city: 'Tokyo',
    country: 'Japan',
    address: 'The Otemachi Tower, 1-5-6 Otemachi, Chiyoda-ku, Tokyo',
    description: 'Urban sanctuary blending minimalist Japanese ryokan aesthetics with towering Mount Fuji horizon views.',
    websiteUrl: 'https://aman.com/tokyo',
    imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80',
    averageRating: 4.95,
    reviewCount: 530,
    priceLevel: '$$$$',
    tags: ['Luxury Stay', 'Spa', 'Mt Fuji View', 'Wellness']
  }
];

const INITIAL_REVIEWS: Review[] = [
  {
    id: 'rev-1',
    placeId: 'place-1',
    userId: 'usr-1',
    user: { id: 'usr-1', username: 'Elena_Traveler', email: 'elena@voyage.ai', avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80' },
    rating: 5,
    comment: 'The sunset view over St. Peter’s Basilica combined with the truffle tasting menu was unforgettable!',
    createdAt: '2026-07-28T14:32:00Z'
  },
  {
    id: 'rev-2',
    placeId: 'place-3',
    userId: 'usr-2',
    user: { id: 'usr-2', username: 'Marco_Polo', email: 'marco@voyage.ai', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80' },
    rating: 5,
    comment: 'Pro tip: Arrive at 6:30 AM before crowds gather! The wind rustling through the bamboo stalks is magical.',
    createdAt: '2026-07-30T09:15:00Z'
  }
];

class DataConnectService {
  private places: Place[];
  private categories: Category[];
  private reviews: Review[];
  private bookmarks: Bookmark[];
  private currentUser: User;
  private savedItineraries: Itinerary[];

  constructor() {
    this.categories = JSON.parse(localStorage.getItem('voyage_categories') || JSON.stringify(INITIAL_CATEGORIES));
    this.places = JSON.parse(localStorage.getItem('voyage_places') || JSON.stringify(INITIAL_PLACES));
    this.reviews = JSON.parse(localStorage.getItem('voyage_reviews') || JSON.stringify(INITIAL_REVIEWS));
    this.bookmarks = JSON.parse(localStorage.getItem('voyage_bookmarks') || '[]');
    this.savedItineraries = JSON.parse(localStorage.getItem('voyage_itineraries') || '[]');

    this.currentUser = {
      id: 'usr-demo-1',
      username: 'Alex_Explorer',
      email: 'alex.explorer@voyage.ai',
      joinDate: '2026-01-15T00:00:00Z',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
    };
  }

  private persist() {
    localStorage.setItem('voyage_categories', JSON.stringify(this.categories));
    localStorage.setItem('voyage_places', JSON.stringify(this.places));
    localStorage.setItem('voyage_reviews', JSON.stringify(this.reviews));
    localStorage.setItem('voyage_bookmarks', JSON.stringify(this.bookmarks));
    localStorage.setItem('voyage_itineraries', JSON.stringify(this.savedItineraries));
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return this.categories;
  }

  // Places
  async getPlaces(categoryId?: string, searchQuery?: string): Promise<Place[]> {
    let result = [...this.places];
    if (categoryId && categoryId !== 'all') {
      result = result.filter(p => p.categoryId === categoryId);
    }
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }

  async getPlaceById(id: string): Promise<Place | undefined> {
    return this.places.find(p => p.id === id);
  }

  async createPlace(placeData: Omit<Place, 'id' | 'averageRating' | 'reviewCount'>): Promise<Place> {
    const newPlace: Place = {
      ...placeData,
      id: `place-${Date.now()}`,
      averageRating: 5.0,
      reviewCount: 1,
      category: this.categories.find(c => c.id === placeData.categoryId) || this.categories[0]
    };
    this.places.unshift(newPlace);
    this.persist();
    return newPlace;
  }

  // Reviews
  async getReviewsForPlace(placeId: string): Promise<Review[]> {
    return this.reviews.filter(r => r.placeId === placeId);
  }

  async createReview(placeId: string, rating: number, comment: string): Promise<Review> {
    const newReview: Review = {
      id: `rev-${Date.now()}`,
      placeId,
      userId: this.currentUser.id,
      user: this.currentUser,
      rating,
      comment,
      createdAt: new Date().toISOString()
    };
    this.reviews.unshift(newReview);

    // Recalculate rating
    const placeReviews = this.reviews.filter(r => r.placeId === placeId);
    const targetPlace = this.places.find(p => p.id === placeId);
    if (targetPlace) {
      const avg = placeReviews.reduce((sum, r) => sum + r.rating, 0) / placeReviews.length;
      targetPlace.averageRating = Number(avg.toFixed(1));
      targetPlace.reviewCount = placeReviews.length;
    }

    this.persist();
    return newReview;
  }

  // Bookmarks
  async getMyBookmarks(): Promise<Place[]> {
    const bookmarkedIds = this.bookmarks.map(b => b.placeId);
    return this.places.filter(p => bookmarkedIds.includes(p.id));
  }

  async isBookmarked(placeId: string): Promise<boolean> {
    return this.bookmarks.some(b => b.placeId === placeId && b.userId === this.currentUser.id);
  }

  async toggleBookmark(placeId: string): Promise<boolean> {
    const index = this.bookmarks.findIndex(b => b.placeId === placeId && b.userId === this.currentUser.id);
    let isSaved = false;
    if (index >= 0) {
      this.bookmarks.splice(index, 1);
      isSaved = false;
    } else {
      this.bookmarks.push({
        id: `bm-${Date.now()}`,
        userId: this.currentUser.id,
        placeId,
        createdAt: new Date().toISOString(),
        place: this.places.find(p => p.id === placeId)
      });
      isSaved = true;
    }
    this.persist();
    return isSaved;
  }

  // Saved Itineraries
  async getSavedItineraries(): Promise<Itinerary[]> {
    return this.savedItineraries;
  }

  async saveItinerary(itinerary: Itinerary): Promise<void> {
    const existingIndex = this.savedItineraries.findIndex(i => i.id === itinerary.id);
    if (existingIndex >= 0) {
      this.savedItineraries[existingIndex] = { ...itinerary, saved: true };
    } else {
      this.savedItineraries.unshift({ ...itinerary, saved: true });
    }
    this.persist();
  }

  async deleteItinerary(id: string): Promise<void> {
    this.savedItineraries = this.savedItineraries.filter(i => i.id !== id);
    this.persist();
  }

  // Profile
  async getCurrentUser(): Promise<User> {
    return this.currentUser;
  }
}

export const dataConnect = new DataConnectService();
