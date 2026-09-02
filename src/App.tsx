import React, { useState, useEffect } from 'react';
import { Place, Category, User, Itinerary, UserActivityEvent } from './types/travel';
import { dataConnect } from './services/dataConnectService';
import { aiAgent } from './services/aiTravelAgent';
import { authService } from './services/authService';
import { enrichPlacesWithImages } from './services/placeImages';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PlaceExplorer } from './components/PlaceExplorer';
import { PlaceDetailsModal } from './components/PlaceDetailsModal';
import { AiPlannerModal } from './components/AiPlannerModal';
import { ItineraryView } from './components/ItineraryView';
import { BookmarksView } from './components/BookmarksView';
import { ReviewModal } from './components/ReviewModal';
import { AiChatDrawer } from './components/AiChatDrawer';
import { AuthModal } from './components/AuthModal';
import { ProfileView } from './components/ProfileView';
import { AdminDashboard } from './components/AdminDashboard';
import { NotificationToast, ToastMessage } from './components/NotificationToast';
import { Compass, Sparkles } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'explore' | 'bookmarks' | 'itineraries' | 'profile'>('explore');
  const [places, setPlaces] = useState<Place[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarkedPlaces, setBookmarkedPlaces] = useState<Place[]>([]);
  const [savedItineraries, setSavedItineraries] = useState<Itinerary[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activities, setActivities] = useState<UserActivityEvent[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExploring, setIsExploring] = useState(false);

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviewingPlace, setReviewingPlace] = useState<Place | null>(null);
  const [activeItinerary, setActiveItinerary] = useState<Itinerary | null>(null);

  const [isAiPlannerOpen, setIsAiPlannerOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'signin' | 'signup'>('signin');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsub = authService.subscribe((user) => {
      setCurrentUser(user);
      if (user) {
        setActivities(dataConnect.getActivity(user.id));
      } else {
        setActivities([]);
        setActiveTab('explore');
      }
    });
    return unsub;
  }, []);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      const cats = await dataConnect.getCategories();
      setCategories(cats);
      fetchPlaces('all', '');
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserData = async (user: User) => {
    const bms = await dataConnect.getMyBookmarks();
    await enrichPlacesWithImages(bms);
    setBookmarkedPlaces(bms);
    const itins = await dataConnect.getSavedItineraries();
    setSavedItineraries(itins);
    setActivities(dataConnect.getActivity(user.id));
  };

  useEffect(() => {
    if (currentUser) {
      loadUserData(currentUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const fetchPlaces = async (catId: string, query: string) => {
    const trimmed = (query || '').trim();
    const local = await dataConnect.getPlaces(catId, trimmed);
    await enrichPlacesWithImages(local);

    // No keyword: plain local/category browsing.
    if (!trimmed) {
      setPlaces(local);
      return;
    }

    // Keyword search: let the AI discover real places worldwide that match,
    // even when nothing in the local seed data does.
    setIsExploring(true);
    try {
      const aiPlaces = await aiAgent.discoverPlaces(trimmed, null, 8, currentUser);
      if (!aiPlaces.length) {
        setPlaces(local);
        addToast('info', `AI couldn't find verified places for "${trimmed}". Try a broader keyword.`);
        return;
      }
      const seen = new Set(local.map((p) => p.name.toLowerCase()));
      const extras = aiPlaces.filter((p) => !seen.has(p.name.toLowerCase()));
      setPlaces([...local, ...extras]);
    } catch (err) {
      console.error('[App] AI place discovery failed:', err);
      setPlaces(local);
      const detail = err instanceof Error ? err.message : String(err);
      addToast('error', `${detail}${local.length ? ' Showing local matches instead.' : ''}`);
    } finally {
      setIsExploring(false);
    }
  };

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    fetchPlaces(catId, searchQuery);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    fetchPlaces(selectedCategory, query);
  };

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const handleToggleBookmark = async (placeId: string) => {
    if (!currentUser) {
      setAuthInitialMode('signin');
      setIsAuthOpen(true);
      addToast('info', 'Sign in to save places to your profile.');
      return;
    }
    try {
      const isSaved = await dataConnect.toggleBookmark(placeId);
      const updatedBms = await dataConnect.getMyBookmarks();
      await enrichPlacesWithImages(updatedBms);
      setBookmarkedPlaces(updatedBms);
      setActivities(dataConnect.getActivity(currentUser.id));

      const place = places.find(p => p.id === placeId) || selectedPlace;
      if (isSaved) {
        addToast('success', `Saved "${place?.name || 'Place'}" to your bookmarks!`);
      } else {
        addToast('info', `Removed "${place?.name || 'Place'}" from bookmarks.`);
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Could not update bookmark.');
    }
  };

  const handleSubmitReview = async (placeId: string, rating: number, comment: string) => {
    if (!currentUser) {
      setAuthInitialMode('signin');
      setIsAuthOpen(true);
      addToast('info', 'Sign in to leave a review.');
      return;
    }
    try {
      await dataConnect.createReview(placeId, rating, comment);
      addToast('success', 'Thank you! Your review has been submitted successfully.');
      fetchPlaces(selectedCategory, searchQuery);
      setActivities(dataConnect.getActivity(currentUser.id));
      if (selectedPlace && selectedPlace.id === placeId) {
        const updated = await dataConnect.getPlaceById(placeId);
        if (updated) setSelectedPlace(updated);
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Could not submit review.');
    }
  };

  const handleItineraryGenerated = async (itinerary: Itinerary) => {
    setActiveItinerary(itinerary);
    setActiveTab('itineraries');
    addToast('success', `✨ AI generated ${itinerary.durationDays}-day trip to ${itinerary.destination}!`);
    if (currentUser) {
      setActivities(dataConnect.getActivity(currentUser.id));
    }
  };

  const handleSaveItinerary = async (itinerary: Itinerary) => {
    if (!currentUser) {
      setAuthInitialMode('signin');
      setIsAuthOpen(true);
      addToast('info', 'Sign in to save trips to your profile.');
      return;
    }
    try {
      await dataConnect.saveItinerary(itinerary);
      const updatedItins = await dataConnect.getSavedItineraries();
      setSavedItineraries(updatedItins);
      setActivities(dataConnect.getActivity(currentUser.id));
      addToast('success', `Saved trip to ${itinerary.destination}!`);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Could not save itinerary.');
    }
  };

  const handleDeleteItinerary = async (id: string) => {
    await dataConnect.deleteItinerary(id);
    const updatedItins = await dataConnect.getSavedItineraries();
    setSavedItineraries(updatedItins);
    if (activeItinerary?.id === id) {
      setActiveItinerary(updatedItins.length > 0 ? updatedItins[0] : null);
    }
    addToast('info', 'Itinerary deleted from saved trips.');
  };

  const bookmarkedIds = bookmarkedPlaces.map(p => p.id);

  return (
    <div className="app-shell">

      {/* Global Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAiPlanner={() => setIsAiPlannerOpen(true)}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onOpenAuth={() => setIsAuthOpen(true)}
        bookmarkCount={bookmarkedPlaces.length}
        savedItineraryCount={savedItineraries.length}
        currentUser={currentUser}
      />

      {/* Main View Router */}
      <main className="main-content">
        {activeTab === 'explore' && (
          <>
            <Hero
              onSearch={handleSearchChange}
              onOpenAiPlanner={() => setIsAiPlannerOpen(true)}
            />

            <PlaceExplorer
              places={places}
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={handleCategoryChange}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              bookmarkedPlaceIds={bookmarkedIds}
              onToggleBookmark={handleToggleBookmark}
              onSelectPlace={(place) => setSelectedPlace(place)}
              onOpenReviewModal={(place) => setReviewingPlace(place)}
              isLoading={isExploring}
            />
          </>
        )}

        {activeTab === 'bookmarks' && (
          !currentUser ? (
            <div className="section-container">
              <div className="state-panel">
                <div className="state-panel-icon">
                  <Compass className="w-7 h-7" />
                </div>
                <h3>Sign in to see your saved places</h3>
                <p>Bookmarks and saved trips are stored on your profile. Create an account with Google or email to keep your travel plans.</p>
                <button onClick={() => setIsAuthOpen(true)} className="btn-primary py-3.5 px-8" style={{ padding: '0.9rem 2rem' }}>
                  Sign In / Create Account
                </button>
              </div>
            </div>
          ) : (
            <BookmarksView
              savedPlaces={bookmarkedPlaces}
              savedItineraries={savedItineraries}
              onRemoveBookmark={handleToggleBookmark}
              onSelectPlace={(place) => setSelectedPlace(place)}
              onSelectItinerary={(itin) => {
                setActiveItinerary(itin);
                setActiveTab('itineraries');
              }}
              onDeleteItinerary={handleDeleteItinerary}
            />
          )
        )}

        {activeTab === 'itineraries' && (
          activeItinerary ? (
            <ItineraryView
              itinerary={activeItinerary}
              onSaveItinerary={handleSaveItinerary}
              onDeleteItinerary={handleDeleteItinerary}
              isSaved={savedItineraries.some(i => i.id === activeItinerary.id)}
            />
          ) : (
            <div className="section-container">
              <div className="state-panel">
                <div className="state-panel-icon">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3>No Active AI Trip Yet</h3>
                <p>
                  Let our autonomous AI travel agent generate a personalized multi-day itinerary for any destination worldwide.
                </p>
                <button
                  onClick={() => setIsAiPlannerOpen(true)}
                  className="btn-primary py-3.5 px-8 text-base font-extrabold"
                  style={{ padding: '0.9rem 2rem', fontSize: '1rem' }}
                >
                  <Sparkles className="w-5 h-5 text-slate-950" />
                  Launch AI Planner Now
                </button>
              </div>
            </div>
          )
        )}

        {activeTab === 'profile' && (
          !currentUser ? (
            <div className="section-container">
              <div className="state-panel">
                <div className="state-panel-icon">
                  <Compass className="w-7 h-7" />
                </div>
                <h3>Create your VoyageAI profile</h3>
                <p>Your AI travel agent personalizes recommendations based on your profile, saved places, planned trips, and reviews. Sign in with your real Google account or email to get started.</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button onClick={() => { setAuthInitialMode('signin'); setIsAuthOpen(true); }} className="btn-primary py-3.5 px-8" style={{ padding: '0.9rem 2rem' }}>
                    Sign In
                  </button>
                  <button onClick={() => { setAuthInitialMode('signup'); setIsAuthOpen(true); }} className="btn-secondary py-3.5 px-8" style={{ padding: '0.9rem 2rem' }}>
                    Create Account
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <ProfileView
                user={currentUser}
                bookmarksCount={bookmarkedPlaces.length}
                itinerariesCount={savedItineraries.length}
                activities={activities}
                onNavigate={(tab) => setActiveTab(tab)}
              />
              <AdminDashboard />
            </>
          )
        )}
      </main>

      {/* Modals & Drawers */}
      <AiPlannerModal
        isOpen={isAiPlannerOpen}
        onClose={() => setIsAiPlannerOpen(false)}
        onItineraryGenerated={handleItineraryGenerated}
        currentUser={currentUser}
        onRequireAuth={() => setIsAuthOpen(true)}
      />

      <PlaceDetailsModal
        place={selectedPlace}
        onClose={() => setSelectedPlace(null)}
        isBookmarked={selectedPlace ? bookmarkedIds.includes(selectedPlace.id) : false}
        onToggleBookmark={handleToggleBookmark}
        onOpenReviewModal={(place) => {
          setSelectedPlace(null);
          setReviewingPlace(place);
        }}
      />

      <ReviewModal
        place={reviewingPlace}
        onClose={() => setReviewingPlace(null)}
        onSubmitReview={handleSubmitReview}
      />

      <AiChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        currentUser={currentUser}
        onRequireAuth={() => setIsAuthOpen(true)}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthenticated={() => {
          const u = authService.user;
          if (u) loadUserData(u);
        }}
        initialMode={authInitialMode}
      />

      {/* Notification Toast Stream */}
      <NotificationToast
        toasts={toasts}
        onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
      />

      {/* Footer */}
      <footer className="app-footer">
        <div className="app-footer-inner">
          <div className="app-footer-brand">
            <Compass className="w-4 h-4" />
            <span>VoyageAI</span>
            <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>• Powered by Firebase Data Connect & Gemini AI</span>
          </div>

          <p>© 2026 VoyageAI. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
