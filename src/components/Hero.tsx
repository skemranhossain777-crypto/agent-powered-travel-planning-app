import React, { useState } from 'react';
import { Sparkles, Search, MapPin, Zap } from 'lucide-react';

interface HeroProps {
  onSearch: (query: string) => void;
  onOpenAiPlanner: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onSearch, onOpenAiPlanner }) => {
  const [query, setQuery] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  const handleChipClick = (city: string) => {
    setQuery(city);
    onSearch(city);
  };

  return (
    <div className="hero-section">
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        
        {/* Badge */}
        <div className="hero-badge">
          <Zap className="w-3.5 h-3.5" />
          <span>Firebase Data Connect & Gemini AI Engine Active</span>
        </div>

        {/* Title */}
        <h1 className="hero-title">
          Plan Unforgettable Trips with <br />
          <span className="gradient-text">Autonomous AI Intelligence</span>
        </h1>

        {/* Subtitle */}
        <p className="hero-subtitle">
          Discover handpicked global destinations, craft custom day-by-day itineraries, and sync places seamlessly with our intelligent travel assistant.
        </p>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="search-input-wrapper">
            <Search className="w-5 h-5 text-cyan-400" style={{ marginRight: '0.5rem', shrink: 0 }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search destination, city, or category (e.g. Kyoto, Rome restaurants, Nature)..."
              className="search-input"
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.65rem 1.4rem', fontSize: '0.85rem', shrink: 0 }}
            >
              Explore
            </button>
          </div>
        </form>

        {/* Popular Destination Chips */}
        <div className="chips-row">
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.25rem', marginRight: '0.25rem' }}>
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            Popular:
          </span>
          {['Kyoto', 'Rome', 'Tokyo', 'Singapore', 'Istanbul', 'Bali'].map((city) => (
            <button
              type="button"
              key={city}
              onClick={() => handleChipClick(city)}
              className="chip-btn"
            >
              {city}
            </button>
          ))}
        </div>

        {/* Action Button Strip */}
        <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onOpenAiPlanner}
            className="btn-primary"
            style={{ padding: '0.9rem 2rem', fontSize: '1rem' }}
          >
            <Sparkles className="w-5 h-5" />
            Generate Custom Itinerary with AI
          </button>
        </div>

      </div>
    </div>
  );
};
