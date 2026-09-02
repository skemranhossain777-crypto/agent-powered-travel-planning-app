import React, { useState, useEffect } from 'react';
import { Place, Category, User, Itinerary } from './types/travel';
import { dataConnect } from './services/dataConnectService';
import { aiAgent } from './services/aiTravelAgent';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PlaceExplorer } from './components/PlaceExplorer';
import { PlaceDetailsModal } from './components/PlaceDetailsModal';
import { AiPlannerModal } from './components/AiPlannerModal';
import { ItineraryView } from './components/ItineraryView';
import { BookmarksView } from './components/BookmarksView';
import { ReviewModal } from './components/ReviewModal';
import { AiChatDrawer } from './components/AiChatDrawer';
import { NotificationToast, ToastMessage } from './components/NotificationToast';
import { Compass, Sparkles, Map, Heart, ShieldCheck } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'explore' | 'bookmarks' | 'itineraries'>('explore');
  const [places, setPlaces] = useState<Place[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarkedPlaces, setBookmarkedPlaces] = useState<Place[]>([]);
  const [savedItineraries, setSavedItineraries] = useState<Itinerary[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExploring, setIsExploring] = useState(false);

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reviewingPlace, setReviewingPlace] = useState<Place | null>(null);
  const [activeItinerary, setActiveItinerary] = useState<Itinerary | null>(null);

  const [isAiPlannerOpen, setIsAiPlannerOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      const cats = await dataConnect.getCategories();
      setCategories(cats);

      const user = await dataConnect.getCurrentUser();
      setCurrentUser(user);

      const bms = await dataConnect.getMyBookmarks();
      setBookmarkedPlaces(bms);

      const itins = await dataConnect.getSavedItineraries();
      setSavedItineraries(itins);

      fetchPlaces('all', '');
    };

    loadData();
  }, []);

  const fetchPlaces = async (catId: string, query: string) => {
    const trimmed = (query || '').trim();
    const local = await dataConnect.getPlaces(catId, trimmed);

    // No keyword: plain local/category browsing.
    if (!trimmed) {
      setPlaces(local);
      return;
    }

    // Keyword search: let the AI discover real places worldwide that match,
    // even when nothing in the local seed data does.
    setIsExploring(true);
    try {
      const aiPlaces = await aiAgent.discoverPlaces(trimmed, null);
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
    const isSaved = await dataConnect.toggleBookmark(placeId);
    const updatedBms = await dataConnect.getMyBookmarks();
    setBookmarkedPlaces(updatedBms);

    const place = places.find(p => p.id === placeId) || selectedPlace;
    if (isSaved) {
      addToast('success', `Saved "${place?.name || 'Place'}" to your bookmarks!`);
    } else {
      addToast('info', `Removed "${place?.name || 'Place'}" from bookmarks.`);
    }
  };

  const handleSubmitReview = async (placeId: string, rating: number, comment: string) => {
    await dataConnect.createReview(placeId, rating, comment);
    addToast('success', 'Thank you! Your review has been submitted successfully.');
    fetchPlaces(selectedCategory, searchQuery);
    if (selectedPlace && selectedPlace.id === placeId) {
      const updated = await dataConnect.getPlaceById(placeId);
      if (updated) setSelectedPlace(updated);
    }
  };

  const handleItineraryGenerated = (itinerary: Itinerary) => {
    setActiveItinerary(itinerary);
    setActiveTab('itineraries');
    addToast('success', `✨ AI generated ${itinerary.durationDays}-day trip to ${itinerary.destination}!`);
  };

  const handleSaveItinerary = async (itinerary: Itinerary) => {
    await dataConnect.saveItinerary(itinerary);
    const updatedItins = await dataConnect.getSavedItineraries();
    setSavedItineraries(updatedItins);
    addToast('success', `Saved trip to ${itinerary.destination}!`);
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
    <div className="min-h-screen bg-[#090d16] text-white flex flex-col font-body">
      
      {/* Global Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAiPlanner={() => setIsAiPlannerOpen(true)}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        bookmarkCount={bookmarkedPlaces.length}
        savedItineraryCount={savedItineraries.length}
        currentUser={currentUser}
      />

      {/* Main View Router */}
      <main className="flex-1 pb-16">
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
            <div className="max-w-4xl mx-auto px-4 py-20 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-400 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-cyan-500/20">
                <Sparkles className="w-8 h-8 text-slate-950" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">No Active AI Trip Yet</h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto mb-8">
                Let our autonomous AI travel agent generate a personalized multi-day itinerary for any destination worldwide.
              </p>
              <button
                onClick={() => setIsAiPlannerOpen(true)}
                className="btn-primary py-3.5 px-8 text-base font-extrabold"
              >
                <Sparkles className="w-5 h-5 text-slate-950" />
                Launch AI Planner Now
              </button>
            </div>
          )
        )}
      </main>

      {/* Modals & Drawers */}
      <AiPlannerModal
        isOpen={isAiPlannerOpen}
        onClose={() => setIsAiPlannerOpen(false)}
        onItineraryGenerated={handleItineraryGenerated}
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
      />

      {/* Notification Toast Stream */}
      <NotificationToast
        toasts={toasts}
        onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
      />

      {/* Footer */}
      <footer className="border-t border-[rgba(255,255,255,0.08)] py-8 px-4 text-center text-xs text-slate-500 bg-[#060911]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-300">VoyageAI</span>
            <span>• Powered by Firebase Data Connect & Gemini AI</span>
          </div>

          <p>© 2026 VoyageAI. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
