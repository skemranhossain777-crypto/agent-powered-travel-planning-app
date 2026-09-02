import React from 'react';
import { Category, Place } from '../types/travel';
import { Star, MapPin, Bookmark, ExternalLink, MessageSquare, Utensils, Landmark, Trees, Wine, ShoppingBag, Hotel, Search } from 'lucide-react';

interface PlaceExplorerProps {
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
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
            Discover Top Destinations
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
            {places.length} Places Available
          </span>
        </div>

        <div className="category-scroll-row">
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

      {/* Grid of Places */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px' }}>
          <div className="ai-spinner" />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>AI is discovering places worldwide…</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '420px', margin: '0 auto' }}>
            Searching for real destinations that match your keyword across the globe.
          </p>
        </div>
      ) : places.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px' }}>
          <Search className="w-12 h-12 text-slate-600" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>No Destinations Found</h3>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
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
                  <img src={place.imageUrl} alt={place.name} className="place-card-img" />
                  <div className="place-card-overlay" />

                  {/* Location & Bookmark Badges */}
                  <div style={{ position: 'absolute', top: '0.75rem', left: '0.75rem', right: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ padding: '0.3rem 0.75rem', borderRadius: '9999px', background: 'rgba(4,7,14,0.75)', border: '1px solid rgba(255,255,255,0.12)', color: '#00f2fe', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <MapPin className="w-3 h-3 text-cyan-400" />
                      {place.city}, {place.country}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBookmark(place.id);
                      }}
                      style={{
                        padding: '0.45rem',
                        borderRadius: '50%',
                        border: isBookmarked ? 'none' : '1px solid rgba(255,255,255,0.2)',
                        background: isBookmarked ? '#00f2fe' : 'rgba(4,7,14,0.7)',
                        color: isBookmarked ? '#040812' : '#fff',
                        cursor: 'pointer'
                      }}
                      title={isBookmarked ? 'Remove Bookmark' : 'Save Place'}
                    >
                      <Bookmark className="w-4 h-4 fill-current" />
                    </button>
                  </div>

                  {/* Rating & Price */}
                  <div style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                    <span style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#6ee7b7', fontSize: '0.75rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Star className="w-3.5 h-3.5 fill-emerald-400" />
                      {place.averageRating} ({place.reviewCount})
                    </span>

                    {place.priceLevel && (
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#fcd34d', fontSize: '0.75rem', fontWeight: 800 }}>
                        {place.priceLevel}
                      </span>
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

                    {/* Tags */}
                    {place.tags && place.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '1rem' }}>
                        {place.tags.slice(0, 3).map((tag, idx) => (
                          <span
                            key={idx}
                            style={{ padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: '0.7rem', fontWeight: 500 }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      type="button"
                      onClick={() => onSelectPlace(place)}
                      style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span>View Details</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenReviewModal(place)}
                      style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
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
