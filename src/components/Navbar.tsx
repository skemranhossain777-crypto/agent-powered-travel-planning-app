import React from 'react';
import { Compass, Sparkles, Bookmark, Map, MessageSquare } from 'lucide-react';
import { User } from '../types/travel';

interface NavbarProps {
  activeTab: 'explore' | 'bookmarks' | 'itineraries';
  setActiveTab: (tab: 'explore' | 'bookmarks' | 'itineraries') => void;
  onOpenAiPlanner: () => void;
  onToggleChat: () => void;
  bookmarkCount: number;
  savedItineraryCount: number;
  currentUser: User | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenAiPlanner,
  onToggleChat,
  bookmarkCount,
  savedItineraryCount,
  currentUser
}) => {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        
        {/* Brand Logo */}
        <div 
          className="brand-logo"
          onClick={() => setActiveTab('explore')}
        >
          <div className="brand-icon">
            <Compass className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Voyage</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 800 }} className="gradient-text">AI</span>
            </div>
            <p style={{ fontSize: '0.6rem', textTransform: 'uppercase', tracking: '0.1em', color: '#94a3b8', fontWeight: 700, margin: 0 }}>
              Agent-Powered Travel
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('explore')}
            className={`nav-tab-btn ${activeTab === 'explore' ? 'active' : ''}`}
          >
            <Compass className="w-4 h-4" />
            Explore Places
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('bookmarks')}
            className={`nav-tab-btn ${activeTab === 'bookmarks' ? 'active' : ''}`}
          >
            <Bookmark className="w-4 h-4" />
            Saved Places
            {bookmarkCount > 0 && (
              <span className="badge-count">{bookmarkCount}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('itineraries')}
            className={`nav-tab-btn ${activeTab === 'itineraries' ? 'active' : ''}`}
          >
            <Map className="w-4 h-4" />
            My Trips
            {savedItineraryCount > 0 && (
              <span className="badge-count" style={{ background: '#7000ff', color: '#fff' }}>{savedItineraryCount}</span>
            )}
          </button>
        </nav>

        {/* Right Action CTAs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button 
            type="button"
            onClick={onOpenAiPlanner}
            className="btn-primary"
            style={{ padding: '0.55rem 1.15rem', fontSize: '0.82rem' }}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI Trip Planner</span>
          </button>

          <button
            type="button"
            onClick={onToggleChat}
            className="btn-icon"
            style={{ position: 'relative' }}
            title="Open AI Concierge Chat"
          >
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            <span style={{ position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', background: '#10b981', borderRadius: '50%' }} />
          </button>

          {currentUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
              <img 
                src={currentUser.avatarUrl} 
                alt={currentUser.username}
                style={{ width: '32px', height: '32px', borderRadius: '50%', border: '2px solid rgba(0,242,254,0.5)', objectFit: 'cover' }} 
              />
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
