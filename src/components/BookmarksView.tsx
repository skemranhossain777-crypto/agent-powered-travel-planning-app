import React, { useState } from 'react';
import { Place, Itinerary } from '../types/travel';
import { Bookmark, Map, Star, MapPin, ExternalLink, Trash2, Sparkles } from 'lucide-react';

interface BookmarksViewProps {
  savedPlaces: Place[];
  savedItineraries: Itinerary[];
  onRemoveBookmark: (placeId: string) => void;
  onSelectPlace: (place: Place) => void;
  onSelectItinerary: (itinerary: Itinerary) => void;
  onDeleteItinerary: (id: string) => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  savedPlaces,
  savedItineraries,
  onRemoveBookmark,
  onSelectPlace,
  onSelectItinerary,
  onDeleteItinerary
}) => {
  const [subTab, setSubTab] = useState<'places' | 'itineraries'>('places');

  return (
    <div className="section-container animate-fade-in">
      
      {/* Sub-navigation selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.75rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="page-heading">
          <h1>Your Saved Collection</h1>
          <p>Access bookmarked locations and custom AI travel plans</p>
        </div>

        <div className="nav-tabs" style={{ marginLeft: 'auto', display: 'flex' }}>
          <button
            type="button"
            onClick={() => setSubTab('places')}
            className={`nav-tab-btn ${subTab === 'places' ? 'active' : ''}`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            Places ({savedPlaces.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('itineraries')}
            className={`nav-tab-btn ${subTab === 'itineraries' ? 'active' : ''}`}
          >
            <Map className="w-3.5 h-3.5" />
            AI Trips ({savedItineraries.length})
          </button>
        </div>
      </div>

      {/* Content Body */}
      {subTab === 'places' ? (
        savedPlaces.length === 0 ? (
          <div className="state-panel">
            <div className="state-panel-icon">
              <Bookmark className="w-7 h-7" />
            </div>
            <h3>No Saved Places Yet</h3>
            <p>
              Explore places on the home feed and click the bookmark icon to save them for your trip.
            </p>
          </div>
        ) : (
          <div className="places-grid">
            {savedPlaces.map((place) => (
              <div key={place.id} className="place-card">
                <div className="place-card-image-wrap">
                  <img src={place.imageUrl} alt={place.name} className="place-card-img" />
                  <div className="place-card-overlay" />

                  <button
                    type="button"
                    onClick={() => onRemoveBookmark(place.id)}
                    style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', padding: '0.45rem', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5', cursor: 'pointer' }}
                    title="Remove Bookmark"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem' }}>
                    <span style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', fontSize: '0.75rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Star className="w-3.5 h-3.5 fill-emerald-400" />
                      {place.averageRating}
                    </span>
                  </div>
                </div>

                <div className="place-card-body">
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>{place.name}</h3>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.5rem' }}>
                      <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                      {place.city}, {place.country}
                    </p>
                    <p className="place-card-desc">{place.description}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectPlace(place)}
                    style={{ marginTop: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <span>View Destination</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

              </div>
            ))}
          </div>
        )
      ) : (
        savedItineraries.length === 0 ? (
          <div className="state-panel">
            <div className="state-panel-icon">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3>No Saved Itineraries</h3>
            <p>
              Use the AI Travel Planner to generate a custom itinerary and save it to your trip portfolio.
            </p>
          </div>
        ) : (
          <div className="itin-grid">
            {savedItineraries.map((itin) => (
              <div key={itin.id} className="itin-card">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ padding: '0.25rem 0.65rem', borderRadius: '9999px', background: 'rgba(0, 242, 254, 0.15)', color: '#00f2fe', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                      {itin.durationDays} Days • {itin.destination}
                    </span>

                    <button
                      type="button"
                      onClick={() => onDeleteItinerary(itin.id)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
                      title="Delete Itinerary"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>{itin.destination} Explorer</h3>
                  <p style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '1rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{itin.summary}</p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '1.25rem' }}>
                    <span>Est: <strong style={{ color: '#10b981' }}>{itin.estimatedTotalCost}</strong></span>
                    <span>Style: <strong style={{ color: '#d8b4fe' }}>{itin.travelStyle}</strong></span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectItinerary(itin)}
                  className="btn-primary"
                  style={{ padding: '0.65rem', fontSize: '0.85rem', width: '100%', justifyContent: 'center' }}
                >
                  Open Full Itinerary
                </button>
              </div>
            ))}
          </div>
        )
      )}

    </div>
  );
};
