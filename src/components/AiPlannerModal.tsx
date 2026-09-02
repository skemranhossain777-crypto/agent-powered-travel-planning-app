import React, { useState } from 'react';
import { Sparkles, X, Calendar, DollarSign, Users, Heart, ArrowRight, Loader2, CheckCircle2, MapPin, Navigation } from 'lucide-react';
import { AiPlannerParams, Itinerary, UserLocation, User } from '../types/travel';
import { aiAgent } from '../services/aiTravelAgent';
import { getCurrentLocation, reverseGeocode } from '../services/geolocation';

interface AiPlannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItineraryGenerated: (itinerary: Itinerary) => void;
  currentUser: User | null;
  onRequireAuth: () => void;
}

export const AiPlannerModal: React.FC<AiPlannerModalProps> = ({
  isOpen,
  onClose,
  onItineraryGenerated,
  currentUser,
  onRequireAuth
}) => {
  const [destination, setDestination] = useState('');
  const [durationDays, setDurationDays] = useState(3);
  const [budgetLevel, setBudgetLevel] = useState<'Budget' | 'Moderate' | 'Luxury'>('Moderate');
  const [travelStyle, setTravelStyle] = useState<'Solo' | 'Couples' | 'Family' | 'Friends' | 'Backpacker'>('Couples');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(['Culture & Heritage', 'Gourmet Dining']);
  const [notes, setNotes] = useState('');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocating, setIsLocating] = useState(false);
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

  const handleUseMyLocation = async () => {
    if (isLocating) return;
    setIsLocating(true);
    setErrorMsg('');
    const loc = await getCurrentLocation();
    if (loc) {
      setUserLocation(await reverseGeocode(loc));
    } else {
      setErrorMsg('Could not access your location. Check your browser permission and try again.');
    }
    setIsLocating(false);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setErrorMsg('Please sign in first — your AI itinerary and preferences will be saved to your profile.');
      onRequireAuth();
      return;
    }
    const dest = destination.trim();
    if (!dest && !userLocation) {
      setErrorMsg('Enter a destination city/region or tap "Use my location" so the AI knows where to plan from.');
      return;
    }
    setErrorMsg('');
    setIsLoading(true);

    // Always ground the itinerary in the user's real location so prices use
    // their local currency (not USD) and origin-aware details are correct —
    // even if they typed a destination without tapping "Use my location".
    let effectiveLocation = userLocation;
    if (!effectiveLocation) {
      try {
        const autoLoc = await getCurrentLocation();
        if (autoLoc) effectiveLocation = await reverseGeocode(autoLoc);
      } catch {
        // non-fatal: fall back to USD/no origin
      }
    }

    try {
      const params: AiPlannerParams = {
        destination: dest,
        durationDays,
        budgetLevel,
        travelStyle,
        interests: selectedInterests,
        location: effectiveLocation || undefined,
        notes: notes.trim() || undefined
      };
      const itinerary = await aiAgent.generateItinerary(params, currentUser);
      onItineraryGenerated(itinerary);
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.');
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
              <span style={{ fontWeight: 500, color: '#64748b', fontSize: '0.72rem', marginLeft: '0.5rem' }}>
                (leave blank to let the AI choose from your location & interests)
              </span>
            </label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Kyoto, Rome, Paris, Tokyo, Bali..."
              className="form-input"
            />
          </div>

          {/* Current Location */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin className="w-4 h-4 text-orange-400" />
              Start From My Location
            </label>
            {userLocation ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.65rem 1rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  background: 'rgba(0, 242, 254, 0.1)',
                  color: '#00f2fe',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Navigation className="w-4 h-4" />
                  {userLocation.label
                    ? userLocation.label
                    : `${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`}
                </span>
                <button
                  type="button"
                  onClick={() => setUserLocation(null)}
                  className="btn-icon"
                  style={{ width: '26px', height: '26px' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={isLocating}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '12px',
                  border: '1px dashed rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#cbd5e1',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: '100%'
                }}
              >
                {isLocating ? <Loader2 className="w-4 h-4 animate-spin text-orange-400" /> : <Navigation className="w-4 h-4 text-orange-400" />}
                {isLocating ? 'Detecting your location…' : 'Use my current location'}
              </button>
            )}
          </div>

          {/* Duration (Days) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 0 }}>
                <Calendar className="w-4 h-4 text-cyan-400" />
                Trip Duration: <span style={{ color: '#00f2fe', fontWeight: 800 }}>{durationDays} Days</span>
              </label>
            </div>
            <div className="duration-row">
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
                    border: durationDays === num ? 'none' : '1px solid rgba(255,255,255,0.1)'
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
            <div className="option-grid-3">
              {(['Budget', 'Moderate', 'Luxury'] as const).map((b) => (
                <button
                  type="button"
                  key={b}
                  onClick={() => setBudgetLevel(b)}
                  className={`option-card ${budgetLevel === b ? 'selected' : ''}`}
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

          {/* Intention / Extra Requirements */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Tell the AI your intention (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Anniversary trip, avoid tourist crowds, want ocean views, must try local street food, prefer walking over taxis…"
              className="form-input"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* Generate Submit Button */}
          <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <button
              type="submit"
              disabled={isLoading}
              className={`btn-primary ${isLoading ? 'btn-loading' : ''}`}
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
