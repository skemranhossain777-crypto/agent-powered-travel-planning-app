import React, { useEffect, useState } from 'react';
import { Place, Review } from '../types/travel';
import { dataConnect } from '../services/dataConnectService';
import { X, Star, MapPin, Globe, Bookmark, MessageSquare } from 'lucide-react';
import { PlaceImage } from './PlaceImage';

interface PlaceDetailsModalProps {
  place: Place | null;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: (placeId: string) => void;
  onOpenReviewModal: (place: Place) => void;
}

export const PlaceDetailsModal: React.FC<PlaceDetailsModalProps> = ({
  place,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onOpenReviewModal
}) => {
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (place) {
      dataConnect.getReviewsForPlace(place.id).then(setReviews);
    }
  }, [place]);

  if (!place) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-dialog" style={{ maxWidth: '750px', padding: 0, overflow: 'hidden' }}>
        
        {/* Header Image Hero */}
        <div style={{ position: 'relative', height: '260px', width: '100%' }}>
          <PlaceImage
            src={place.imageUrl}
            alt={place.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 20%, #0d1322 100%)' }} />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="btn-icon"
            style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {/* Bookmark Button */}
          <button
            onClick={() => onToggleBookmark(place.id)}
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              padding: '0.6rem',
              borderRadius: '9999px',
              border: isBookmarked ? 'none' : '1px solid rgba(255,255,255,0.2)',
              background: isBookmarked ? '#00f2fe' : 'rgba(0,0,0,0.6)',
              color: isBookmarked ? '#040812' : '#fff',
              cursor: 'pointer'
            }}
          >
            <Bookmark className="w-5 h-5 fill-current" />
          </button>

          {/* Title & Location Overlay */}
          <div style={{ position: 'absolute', bottom: '1rem', left: '1.5rem', right: '1.5rem' }}>
            <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', background: 'rgba(0, 242, 254, 0.2)', border: '1px solid rgba(0, 242, 254, 0.4)', color: '#00f2fe', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', display: 'inline-block', marginBottom: '0.5rem' }}>
              {place.category?.name || 'Destination'}
            </span>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: '0 0 0.25rem 0' }}>
              {place.name}
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500 }}>
              <MapPin className="w-4 h-4 text-cyan-400" />
              {place.address ? place.address : `${place.city}, ${place.country}`}
            </p>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div style={{ padding: '1.5rem 1.75rem', maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Metadata Grid */}
          <div className="details-meta-grid">
            <div>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8' }}>Rating</p>
              <p style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem' }}>
                <Star className="w-4 h-4 fill-emerald-400" />
                {place.averageRating} <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({place.reviewCount})</span>
              </p>
            </div>

            <div>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8' }}>Price Tier</p>
              <p style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f59e0b', marginTop: '0.2rem' }}>
                {place.priceLevel || '$$'}
              </p>
            </div>

            <div>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8' }}>GPS Vector</p>
              <p style={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700, color: '#cbd5e1', marginTop: '0.3rem' }}>
                {place.location[0].toFixed(2)}°, {place.location[1].toFixed(2)}°
              </p>
            </div>

            <div>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8' }}>Official Web</p>
              {place.websiteUrl ? (
                <a
                  href={place.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.75rem', fontWeight: 700, color: '#00f2fe', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', marginTop: '0.3rem' }}
                >
                  Visit Site <Globe className="w-3.5 h-3.5" />
                </a>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.3rem', display: 'inline-block' }}>N/A</span>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.5rem' }}>
              About this destination
            </h3>
            <p style={{ color: '#e2e8f0', fontSize: '0.9rem', lineHeight: 1.6 }}>
              {place.description}
            </p>
          </div>

          {/* Tags */}
          {place.tags && place.tags.length > 0 && (
            <div>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.5rem' }}>
                Highlights & Features
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {place.tags.map((tag, i) => (
                  <span
                    key={i}
                    style={{ padding: '0.3rem 0.75rem', borderRadius: '9999px', background: 'rgba(0, 242, 254, 0.1)', border: '1px solid rgba(0, 242, 254, 0.3)', color: '#00f2fe', fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Reviews Section */}
          <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <MessageSquare className="w-4 h-4 text-purple-400" />
                Traveler Reviews ({reviews.length})
              </h3>

              <button
                onClick={() => onOpenReviewModal(place)}
                className="btn-secondary"
                style={{ padding: '0.4rem 0.85rem', fontSize: '0.75rem' }}
              >
                + Add Review
              </button>
            </div>

            {reviews.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No reviews yet. Be the first traveler to review!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    style={{ padding: '0.85rem 1rem', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <img
                          src={rev.user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'}
                          alt={rev.user?.username || 'User'}
                          style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f1f5f9' }}>
                          {rev.user?.username || 'Traveler'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-3.5 h-3.5 ${
                              i < rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-700'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <p style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                      "{rev.comment}"
                    </p>
                  </div>
                ))}
              </div>
            )}

          </div>

        </div>

      </div>
    </div>
  );
};
