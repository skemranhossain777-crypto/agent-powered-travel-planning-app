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
      <div className="hero-orb hero-orb-a" />
      <div className="hero-orb hero-orb-b" />

      <div className="hero-inner">

        {/* Badge */}
        <div className="hero-badge hero-anim-1">
          <Zap className="w-3.5 h-3.5" />
          <span>Plan anything, anywhere, instantly</span>
        </div>

        {/* Title */}
        <h1 className="hero-title hero-anim-2">
          Plan Unforgettable Trips with <br />
          <span className="gradient-text">Autonomous AI Intelligence</span>
        </h1>

        {/* Subtitle */}
        <p className="hero-subtitle hero-anim-3">
          Discover handpicked global destinations, craft custom day-by-day itineraries, and sync places seamlessly with our intelligent travel assistant.
        </p>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="search-form hero-anim-4">
          <div className="search-input-wrapper">
            <Search className="search-icon" />
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
              style={{ padding: '0.7rem 1.35rem', fontSize: '0.85rem', flexShrink: 0 }}
            >
              Explore
            </button>
          </div>
        </form>

        {/* Popular Destination Chips */}
        <div className="chips-row hero-anim-5">
          <span className="chips-label">
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
        <div className="hero-actions hero-anim-5">
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
