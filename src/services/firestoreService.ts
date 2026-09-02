import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData
} from 'firebase/firestore';
import { getFirestoreInstance } from './firebase';
import {
  UserProfile,
  UserActivityEvent,
  UserSession,
  Review,
  Itinerary,
  Place,
  Bookmark
} from '../types/travel';

/**
 * Real cloud persistence layer backed by Cloud Firestore.
 *
 * Collections:
 *   users/{uid}              -> { uid, email, username, displayName, avatarUrl,
 *                                 provider, createdAt, lastLoginAt, lastLoginProvider }
 *   profiles/{uid}           -> UserProfile
 *   sessions/{uid}/{sid}     -> UserSession (one document per sign-in occurrence)
 *   bookmarks/{uid}/{placeId}-> { placeId, createdAt }
 *   itineraries/{uid}/{id}   -> Itinerary (+uid)
 *   bookmarksMeta/{placeId}  -> denormalized { count } for popular bookmarks
 *   reviews/{reviewId}       -> Review (+uid, placeId indexed)
 *   activity/{uid}/{eventId} -> UserActivityEvent (+uid)
 *
 * Server security rules (firestore.rules) gate: users may read/write ONLY their
 * own documents, and admins may read all (used by the admin dashboard).
 */
class FirestoreService {
  private usersCol = () => collection(getFirestoreInstance(), 'users');
  private profilesCol = () => collection(getFirestoreInstance(), 'profiles');
  private sessionsCol = (uid: string) => collection(getFirestoreInstance(), 'sessions', uid, 'logins');
  private bookmarksCol = (uid: string) => collection(getFirestoreInstance(), 'bookmarks', uid, 'items');
  private itinerariesCol = (uid: string) => collection(getFirestoreInstance(), 'itineraries', uid, 'items');
  private reviewsCol = () => collection(getFirestoreInstance(), 'reviews');
  private activityCol = (uid: string) => collection(getFirestoreInstance(), 'activity', uid, 'events');

  // ---- helpers ----
  private ts(value: unknown): string {
    if (value instanceof Timestamp) {
      return value.toDate().toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    return new Date().toISOString();
  }

  // =====================================================================
  //  User + login-time tracking
  // =====================================================================

  /**
   * Called on every onAuthStateChanged fire. Upserts the user document and
   * records a login session (login time). We only record a new session when a
   * real auth token is present.
   */
  async recordUserLogin(params: {
    uid: string;
    email: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    provider: 'google' | 'email' | 'anonymous';
  }): Promise<{ lastLoginAt: string }> {
    const now = new Date().toISOString();
    const db = getFirestoreInstance();
    const userRef = doc(this.usersCol(), params.uid);

    const existing = await getDoc(userRef);
    const isNew = !existing.exists();

    await setDoc(
      userRef,
      {
        uid: params.uid,
        email: params.email,
        username: params.username,
        displayName: params.displayName || params.username,
        avatarUrl: params.avatarUrl || '',
        provider: params.provider,
        lastLoginAt: now,
        lastLoginProvider: params.provider === 'google' ? 'google' : 'email',
        ...(isNew ? { createdAt: now } : {})
      },
      { merge: true }
    );

    if (params.provider !== 'anonymous') {
      // Record a login occurrence for the admin "login time" view.
      const session: Omit<UserSession, 'id'> = {
        uid: params.uid,
        email: params.email,
        loginAt: now,
        provider: params.provider === 'google' ? 'google' : 'email'
      };
      await addDoc(this.sessionsCol(params.uid), { ...session, _ts: serverTimestamp() });
    }

    void db;
    return { lastLoginAt: now };
  }

  async updateUserProfile(uid: string, partial: UserProfile): Promise<void> {
    await setDoc(doc(this.profilesCol(), uid), partial, { merge: true });
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(this.profilesCol(), uid));
    if (!snap.exists()) {
      return null;
    }
    return snap.data() as UserProfile;
  }

  // =====================================================================
  //  Bookmarks
  // =====================================================================

  async getBookmarkIds(uid: string): Promise<string[]> {
    const q = query(this.bookmarksCol(uid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().placeId as string);
  }

  async setBookmark(uid: string, placeId: string): Promise<void> {
    await setDoc(doc(this.bookmarksCol(uid), placeId), {
      placeId,
      createdAt: new Date().toISOString(),
      _ts: serverTimestamp()
    });
  }

  async removeBookmark(uid: string, placeId: string): Promise<void> {
    await deleteDoc(doc(this.bookmarksCol(uid), placeId));
  }

  // =====================================================================
  //  Itineraries
  // =====================================================================

  async saveItinerary(uid: string, itinerary: Itinerary): Promise<void> {
    const payload: DocumentData = { ...itinerary, uid, _ts: serverTimestamp() };
    delete payload.saved;
    await setDoc(doc(this.itinerariesCol(uid), itinerary.id), payload);
  }

  async getItineraries(uid: string): Promise<Itinerary[]> {
    const q = query(this.itinerariesCol(uid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as DocumentData), id: d.id }) as Itinerary);
  }

  async deleteItinerary(uid: string, id: string): Promise<void> {
    await deleteDoc(doc(this.itinerariesCol(uid), id));
  }

  // =====================================================================
  //  Reviews
  // =====================================================================

  async getReviewsForPlace(placeId: string): Promise<Review[]> {
    const q = query(this.reviewsCol(), where('placeId', '==', placeId), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapReview(d));
  }

  async getReviewsByUser(uid: string): Promise<Review[]> {
    const q = query(this.reviewsCol(), where('uid', '==', uid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapReview(d));
  }

  async createReview(uid: string, placeId: string, rating: number, comment: string, place?: Place | null): Promise<Review> {
    const review: Review = {
      id: '',
      placeId,
      userId: uid,
      rating,
      comment,
      createdAt: new Date().toISOString()
    };
    const ref = await addDoc(this.reviewsCol(), {
      placeId,
      uid,
      placeName: place?.name || '',
      placeCity: place?.city || '',
      rating,
      comment,
      createdAt: review.createdAt,
      _ts: serverTimestamp()
    });
    review.id = ref.id;
    return review;
  }

  // =====================================================================
  //  Activity events
  // =====================================================================

  async recordActivity(
    uid: string,
    type: 'bookmark' | 'itinerary' | 'review' | 'discover' | 'chat',
    event: Omit<UserActivityEvent, 'id' | 'type' | 'createdAt'>
  ): Promise<void> {
    const id = `evt-${Date.now()}`;
    const payload: DocumentData = {
      ...event,
      type,
      uid,
      createdAt: new Date().toISOString(),
      _ts: serverTimestamp()
    };
    await setDoc(doc(this.activityCol(uid), id), payload);
  }

  async getActivity(uid: string): Promise<UserActivityEvent[]> {
    const q = query(this.activityCol(uid), orderBy('createdAt', 'desc'), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as DocumentData), id: d.id }) as UserActivityEvent);
  }

  // =====================================================================
  //  Admin dashboard data (reads ALL users — requires admin rules)
  // =====================================================================

  async adminListUsers(): Promise<Array<{
    uid: string;
    email: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    provider?: string;
    createdAt?: string;
    lastLoginAt?: string;
    lastLoginProvider?: string;
  }>> {
    const snap = await getDocs(query(this.usersCol(), orderBy('lastLoginAt', 'desc')));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        email: data.email || '',
        username: data.username || d.id,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
        provider: data.provider,
        createdAt: this.ts(data.createdAt),
        lastLoginAt: this.ts(data.lastLoginAt),
        lastLoginProvider: data.lastLoginProvider
      };
    });
  }

  async adminGetSessions(uid: string, take = 10): Promise<UserSession[]> {
    const q = query(this.sessionsCol(uid), orderBy('loginAt', 'desc'), limit(take));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      ...(d.data() as DocumentData),
      id: d.id,
      loginAt: this.ts((d.data() as DocumentData).loginAt)
    }) as UserSession);
  }

  async adminCountUser(uid: string): Promise<{ bookmarks: number; itineraries: number; reviews: number; activity: number }> {
    const bm = await getDocs(this.bookmarksCol(uid));
    const it = await getDocs(this.itinerariesCol(uid));
    const rvQ = query(this.reviewsCol(), where('uid', '==', uid));
    const rv = await getDocs(rvQ);
    const ac = await getDocs(this.activityCol(uid));
    return {
      bookmarks: bm.size,
      itineraries: it.size,
      reviews: rv.size,
      activity: ac.size
    };
  }
}

function mapReview(d: QueryDocumentSnapshot<DocumentData>): Review {
  const data = d.data();
  return {
    id: d.id,
    placeId: data.placeId,
    userId: data.uid,
    rating: data.rating,
    comment: data.comment,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString()
  };
}

export const firestoreService = new FirestoreService();
export type { FirestoreService };