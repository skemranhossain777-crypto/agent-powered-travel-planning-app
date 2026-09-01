import React, { useState } from 'react';
import { Sparkles, X, Calendar, DollarSign, Users, Heart, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { AiPlannerParams, Itinerary } from '../types/travel';
import { aiAgent } from '../services/aiTravelAgent';

interface AiPlannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItineraryGenerated: (itinerary: Itinerary) => void;
}

export const AiPlannerModal: React.FC<AiPlannerModalProps> = ({
  isOpen,
  onClose,
  onItineraryGenerated
}) => {
  const [destination, setDestination] = useState('Kyoto');
  const [durationDays, setDurationDays] = useState(3);
  const [budgetLevel, setBudgetLevel] = useState<'Budget' | 'Moderate' | 'Luxury'>('Moderate');
  const [travelStyle, setTravelStyle] = useState<'Solo' | 'Couples' | 'Family' | 'Friends' | 'Backpacker'>('Couples');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(['Culture & Heritage', 'Gourmet Dining']);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const ALL_INTERESTS = [
    'Culture & Heritage',
    'Gourmet Dining',
    'Nature & Outdoor',
    'Nightlife & Bars',
    'Shopping & Flea Markets',
    'Wellness & Spas',
    'Photography Spots',
    'Hidden Gems'
  ];

  const toggleInterest = (interest: string) => {
    setSelectedInterests(prev => 
      prev.includes(interest) 
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    );
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      setErrorMsg('Please enter a destination city or region.');
      return;
    }
    setErrorMsg('');
    setIsLoading(true);

    try {
      const params: AiPlannerParams = {
        destination: destination.trim(),
        durationDays,
        budgetLevel,
        travelStyle,
        interests: selectedInterests
      };
      const itinerary = await aiAgent.generateItinerary(params);
      onItineraryGenerated(itinerary);
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to generate itinerary. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-dialog">
        
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="btn-icon"
          style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div className="brand-icon">
            <Sparkles className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>AI Trip Planner</h2>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Generate a custom day-by-day travel itinerary in seconds</p>
          </div>
        </div>

        {errorMsg && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5', fontSize: '0.8rem', marginBottom: '1rem', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Destination */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">
              Destination City or Region
            </label>
            <input
              type="text"
              required
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Kyoto, Rome, Paris, Tokyo, Bali..."
              className="form-input"
            />
          </div>

          {/* Duration (Days) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 0 }}>
                <Calendar className="w-4 h-4 text-cyan-400" />
                Trip Duration: <span style={{ color: '#00f2fe', fontWeight: 800 }}>{durationDays} Days</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {[1, 2, 3, 4, 5, 6, 7].map(num => (
                <button
                  type="button"
                  key={num}
                  onClick={() => setDurationDays(num)}
                  className={`btn-chip ${durationDays === num ? 'active' : ''}`}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0',
                    textAlign: 'center',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    border: durationDays === num ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    background: durationDays === num ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.05)',
                    color: durationDays === num ? '#040812' : '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  {num}d
                </button>
              ))}
            </div>
          </div>

          {/* Budget Level */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <DollarSign className="w-4 h-4 text-emerald-400" />
              Budget Preference
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {(['Budget', 'Moderate', 'Luxury'] as const).map((b) => (
                <button
                  type="button"
                  key={b}
                  onClick={() => setBudgetLevel(b)}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '14px',
                    border: budgetLevel === b ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                    background: budgetLevel === b ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)',
                    color: budgetLevel === b ? '#6ee7b7' : '#94a3b8',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {b === 'Budget' ? '💲 Budget' : b === 'Moderate' ? '💳 Moderate' : '💎 Luxury'}
                </button>
              ))}
            </div>
          </div>

          {/* Travel Companion Style */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Users className="w-4 h-4 text-purple-400" />
              Who are you traveling with?
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(['Solo', 'Couples', 'Family', 'Friends', 'Backpacker'] as const).map((style) => (
                <button
                  type="button"
                  key={style}
                  onClick={() => setTravelStyle(style)}
                  style={{
                    padding: '0.4rem 1rem',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: travelStyle === style ? '#7000ff' : 'rgba(255,255,255,0.05)',
                    color: travelStyle === style ? '#fff' : '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          {/* Travel Interests */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Heart className="w-4 h-4 text-pink-400" />
              Travel Interests & Themes
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {ALL_INTERESTS.map((interest) => {
                const isSelected = selectedInterests.includes(interest);
                return (
                  <button
                    type="button"
                    key={interest}
                    onClick={() => toggleInterest(interest)}
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      border: isSelected ? '1px solid #00f2fe' : '1px solid rgba(255,255,255,0.08)',
                      background: isSelected ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255,255,255,0.04)',
                      color: isSelected ? '#00f2fe' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />}
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate Submit Button */}
          <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary"
              style={{ width: '100%', padding: '0.9rem', fontSize: '1rem' }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                  <span>Designing Itinerary for {destination}...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-slate-950" />
                  <span>Generate {durationDays}-Day Itinerary Now</span>
                  <ArrowRight className="w-5 h-5 text-slate-950" />
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
