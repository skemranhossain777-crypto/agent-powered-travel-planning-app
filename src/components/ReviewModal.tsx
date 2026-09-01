import React, { useState } from 'react';
import { Place } from '../types/travel';
import { X, Star, MessageSquare, Send } from 'lucide-react';

interface ReviewModalProps {
  place: Place | null;
  onClose: () => void;
  onSubmitReview: (placeId: string, rating: number, comment: string) => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  place,
  onClose,
  onSubmitReview
}) => {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!place) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;

    setIsSubmitting(true);
    onSubmitReview(place.id, rating, comment.trim());
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-dialog" style={{ maxWidth: '500px' }}>
        
        <button type="button" onClick={onClose} className="btn-icon" style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(112, 0, 255, 0.2)', border: '1px solid rgba(112, 0, 255, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquare className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', margin: 0 }}>Write a Review</h2>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>{place.name}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Star Rating selector */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Your Rating</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {[1, 2, 3, 4, 5].map((star) => {
                const activeStar = hoverRating ? star <= hoverRating : star <= rating;
                return (
                  <button
                    type="button"
                    key={star}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem' }}
                  >
                    <Star
                      className={`w-7 h-7 ${
                        activeStar ? 'fill-amber-400 text-amber-400' : 'text-slate-700'
                      }`}
                    />
                  </button>
                );
              })}
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f59e0b', marginLeft: '0.5rem' }}>
                {rating}.0 / 5.0
              </span>
            </div>
          </div>

          {/* Comment text */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Review Comment</label>
            <textarea
              required
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience, tip, or favorite highlight about this place..."
              className="form-input"
              style={{ fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ width: '100%', padding: '0.85rem' }}
            >
              <Send className="w-4 h-4" />
              <span>Submit Review</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
