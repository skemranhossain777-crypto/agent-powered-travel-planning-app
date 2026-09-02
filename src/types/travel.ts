export interface UserProfile {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  homeCity?: string;
  travelStyles: string[];
  interests: string[];
  budgetPreference?: 'Budget' | 'Moderate' | 'Luxury';
}

export interface User {
  id: string;
  username: string;
  email: string;
  joinDate?: string;
  avatarUrl?: string;
  provider: 'google' | 'email' | 'anonymous';
  emailVerified?: boolean;
  profile: UserProfile;
  /** ISO timestamp of the most recent sign-in (mirrors sessions collection). */
  lastLoginAt?: string;
}

/** A single sign-in occurrence, written to Firestore `sessions/{uid}/{sessionId}`. */
export interface UserSession {
  id: string;
  uid: string;
  email: string;
  loginAt: string;
  provider: 'google' | 'email';
}

/** Admin view — aggregate of a user's public data for the admin dashboard. */
export interface AdminUserSummary {
  uid: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  provider?: string;
  createdAt?: string;
  lastLoginAt?: string;
  lastLoginProvider?: string;
  bookmarksCount: number;
  itinerariesCount: number;
  reviewsCount: number;
  activityCount: number;
  sessionsCount: number;
  lastSessions: UserSession[];
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

export interface UserActivityEvent {
  id: string;
  type: 'bookmark' | 'itinerary' | 'review' | 'discover' | 'chat';
  placeId?: string;
  placeName?: string;
  city?: string;
  country?: string;
  categoryId?: string;
  detail?: string;
  createdAt: string;
}

export interface TransportOption {
  mode: string;
  route: string;
  estimatedCost: string;
}

export interface HotelOption {
  name: string;
  area: string;
  ratePerNight: string;
  estimatedCost: string;
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
  transport?: TransportOption[];
  hotels?: HotelOption[];
  sightseeingCost?: string;
  dayPlans: DayPlan[];
  createdAt: string;
  saved?: boolean;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  label?: string;
  countryCode?: string;
  timestamp: number;
}

export interface AiPlannerParams {
  destination: string;
  durationDays: number;
  budgetLevel: 'Budget' | 'Moderate' | 'Luxury';
  travelStyle: 'Solo' | 'Couples' | 'Family' | 'Friends' | 'Backpacker';
  interests: string[];
  location?: UserLocation;
  notes?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestions?: string[];
}
