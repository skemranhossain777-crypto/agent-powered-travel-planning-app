import React from 'react';
import { Category, Place } from '../types/travel';
import { Star, MapPin, Bookmark, ExternalLink, MessageSquare, Utensils, Landmark, Trees, Wine, ShoppingBag, Hotel, Search } from 'lucide-react';
import { PlaceImage } from './PlaceImage';

interface PlaceExplorerProps {
  heading?: string;
  places: Place[];
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (catId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  bookmarkedPlaceIds: string[];
  onToggleBookmark: (placeId: string) => void;
  onSelectPlace: (place: Place) => void;
  onOpenReviewModal: (place: Place) => void;
  isLoading?: boolean;
}

export const PlaceExplorer: React.FC<PlaceExplorerProps> = ({
  heading = 'Discover Top Destinations',
  places,
  categories,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  bookmarkedPlaceIds,
  onToggleBookmark,
  onSelectPlace,
  onOpenReviewModal,
  isLoading = false
}) => {
  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'cat-rest': return <Utensils className="w-4 h-4" />;
      case 'cat-hist': return <Landmark className="w-4 h-4" />;
      case 'cat-out': return <Trees className="w-4 h-4" />;
      case 'cat-night': return <Wine className="w-4 h-4" />;
      case 'cat-shop': return <ShoppingBag className="w-4 h-4" />;
      case 'cat-hotel': return <Hotel className="w-4 h-4" />;
      default: return <MapPin className="w-4 h-4" />;
    }
  };

  return (
    <section className="section-container">

      {/* Category Filter Bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="section-heading">
          <h2 className="section-title">{heading}</h2>
          <span className="section-count">{places.length} Places Available</span>
        </div>

        <div className="category-scroll-row no-scrollbar">
          <button
            type="button"
            onClick={() => onSelectCategory('all')}
            className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
          >
            All Categories ({places.length})
          </button>

          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`category-btn ${isSelected ? 'active' : ''}`}
              >
                {getCategoryIcon(cat.id)}
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Radar Loading State */}
      {isLoading ? (
        <div className="state-panel">
          <div className="ai-radar">
            <div className="ai-radar-ring" />
            <div className="ai-radar-pulse" />
            <div className="ai-radar-core" />
          </div>
          <h3 className="ai-shimmer">AI is scanning the globe…</h3>
          <p>
            Discovering verified real-world places that match your keyword across every country.
          </p>
          <div className="loading-bar" style={{ maxWidth: '220px', margin: '0 auto' }} />
        </div>
      ) : places.length === 0 ? (
        <div className="state-panel">
          <div className="state-panel-icon">
            <Search className="w-7 h-7" />
          </div>
          <h3>No Destinations Found</h3>
          <p>
            {searchQuery
              ? "We couldn't discover any places for that keyword right now. Try a broader search."
              : "We couldn't find any places matching your current filters. Try clearing your filters."}
          </p>
          <button
            type="button"
            onClick={() => { onSearchChange(''); onSelectCategory('all'); }}
            className="btn-secondary"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="places-grid">
          {places.map((place) => {
            const isBookmarked = bookmarkedPlaceIds.includes(place.id);
            return (
              <div key={place.id} className="place-card">

                {/* Image Wrap */}
                <div className="place-card-image-wrap">
                  <PlaceImage src={place.imageUrl} alt={place.name} className="place-card-img" />
                  <div className="place-card-overlay" />

                  <div className="card-top-row">
                    <span className="card-location">
                      <MapPin className="w-3 h-3" />
                      {place.city}, {place.country}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBookmark(place.id);
                      }}
                      className={`bookmark-btn ${isBookmarked ? 'saved' : ''}`}
                      title={isBookmarked ? 'Remove Bookmark' : 'Save Place'}
                    >
                      <Bookmark className="fill-current" />
                    </button>
                  </div>

                  <div className="card-bottom-row">
                    <span className="card-badge rating">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      {place.averageRating} ({place.reviewCount})
                    </span>

                    {place.priceLevel && (
                      <span className="card-badge price">{place.priceLevel}</span>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="place-card-body">
                  <div>
                    <h3 onClick={() => onSelectPlace(place)} className="place-card-title">
                      {place.name}
                    </h3>
                    <p className="place-card-desc">
                      {place.description}
                    </p>

                    {place.tags && place.tags.length > 0 && (
                      <div className="tag-row">
                        {place.tags.slice(0, 3).map((tag, idx) => (
                          <span key={idx} className="tag-pill">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="card-footer">
                    <button
                      type="button"
                      onClick={() => onSelectPlace(place)}
                      className="text-link"
                    >
                      <span>View Details</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenReviewModal(place)}
                      className="text-link subtle"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Review</span>
                    </button>
                  </div>

                </div>

              </div>
            );
          })}
        </div>
      )}

    </section>
  );
};