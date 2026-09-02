import React from 'react';
import { Compass, Sparkles, Bookmark, Map, User as UserIcon, LogIn } from 'lucide-react';
import { User } from '../types/travel';

interface NavbarProps {
  activeTab: 'explore' | 'bookmarks' | 'itineraries' | 'profile';
  setActiveTab: (tab: 'explore' | 'bookmarks' | 'itineraries' | 'profile') => void;
  onOpenAiPlanner: () => void;
  onOpenAuth: () => void;
  bookmarkCount: number;
  savedItineraryCount: number;
  currentUser: User | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenAiPlanner,
  onOpenAuth,
  bookmarkCount,
  savedItineraryCount,
  currentUser
}) => {
  return (
    <>
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
              <div className="brand-name">Voyage<span>AI</span></div>
              <p className="brand-tagline">Agent-Powered Travel</p>
            </div>
          </div>

          {/* Navigation Tabs (desktop/tablet) */}
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

            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            >
              <UserIcon className="w-4 h-4" />
              {currentUser ? 'My Profile' : 'Profile'}
            </button>
          </nav>

          {/* Right Action CTAs */}
          <div className="navbar-actions">
            <button
              type="button"
              onClick={onOpenAiPlanner}
              className="btn-primary navbar-cta"
            >
              <Sparkles className="w-4 h-4" />
              <span className="navbar-cta-label">AI Trip Planner</span>
            </button>

            {currentUser ? (
              <button
                type="button"
                className="navbar-user"
                onClick={() => setActiveTab('profile')}
                title="Open my profile"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative' }}
              >
                <img
                  src={currentUser.avatarUrl || ''}
                  alt={currentUser.username}
                  className="navbar-avatar"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                    const fb = (e.currentTarget as HTMLImageElement).parentElement?.querySelector('.navbar-avatar-fallback');
                    if (fb) ((fb as HTMLElement).style.display = 'flex');
                  }}
                />
                <span className="navbar-avatar-fallback" style={{ display: currentUser.avatarUrl ? 'none' : 'flex' }}>
                  {currentUser.username.charAt(0).toUpperCase()}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="btn-secondary navbar-login"
              >
                <LogIn className="w-4 h-4" />
                <span className="navbar-cta-label">Sign In</span>
              </button>
            )}
          </div>

        </div>
      </header>

      {/* Mobile / Tablet bottom tab bar */}
      <nav className="mobile-tabbar" aria-label="Primary navigation">
        <button
          type="button"
          onClick={() => setActiveTab('explore')}
          className={`mobile-tab-btn ${activeTab === 'explore' ? 'active' : ''}`}
        >
          <Compass />
          <span className="tab-label">Explore</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bookmarks')}
          className={`mobile-tab-btn ${activeTab === 'bookmarks' ? 'active' : ''}`}
        >
          <Bookmark />
          <span className="tab-label">Saved</span>
          {bookmarkCount > 0 && (
            <span className="mobile-tab-count">{bookmarkCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenAiPlanner}
          className="mobile-tab-btn ai"
        >
          <Sparkles />
          <span className="tab-label">Plan</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('itineraries')}
          className={`mobile-tab-btn ${activeTab === 'itineraries' ? 'active' : ''}`}
        >
          <Map />
          <span className="tab-label">Trips</span>
          {savedItineraryCount > 0 && (
            <span className="mobile-tab-count" style={{ background: '#7000ff', color: '#fff' }}>{savedItineraryCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`mobile-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
        >
          <UserIcon />
          <span className="tab-label">Profile</span>
        </button>
      </nav>
    </>
  );
};