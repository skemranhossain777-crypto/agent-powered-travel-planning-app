export interface User {
  id: string;
  username: string;
  email: string;
  joinDate?: string;
  avatarUrl?: string;
}

export interface Category {
  id: string;
  name: string;
  iconUrl: string;
  description: string;
  color?: string;
}

export interface Place {
  id: string;
  name: string;
  categoryId: string;
  category?: Category;
  location: [number, number]; // [lat, lng]
  address?: string;
  city: string;
  country: string;
  description: string;
  websiteUrl?: string;
  imageUrl: string;
  averageRating: number;
  reviewCount: number;
  priceLevel?: '$$' | '$$$' | '$$$$' | '$';
  tags?: string[];
}

export interface Review {
  id: string;
  placeId: string;
  place?: Place;
  userId: string;
  user?: User;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  placeId: string;
  place?: Place;
  createdAt: string;
}

export interface Activity {
  time: string;
  title: string;
  description: string;
  locationName: string;
  category: string;
  estimatedCost: string;
  coordinates?: [number, number];
}

export interface DayPlan {
  dayNumber: number;
  title: string;
  theme: string;
  activities: Activity[];
}

export interface Itinerary {
  id: string;
  destination: string;
  country: string;
  durationDays: number;
  budgetLevel: 'Budget' | 'Moderate' | 'Luxury';
  travelStyle: string;
  interests: string[];
  summary: string;
  estimatedTotalCost: string;
  bestTimeToVisit: string;
  dayPlans: DayPlan[];
  createdAt: string;
  saved?: boolean;
}

export interface AiPlannerParams {
  destination: string;
  durationDays: number;
  budgetLevel: 'Budget' | 'Moderate' | 'Luxury';
  travelStyle: 'Solo' | 'Couples' | 'Family' | 'Friends' | 'Backpacker';
  interests: string[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestions?: string[];
}
