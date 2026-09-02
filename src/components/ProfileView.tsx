import React, { useState } from 'react';
import { User, UserActivityEvent } from '../types/travel';
import { authService } from '../services/authService';
import { dataConnect } from '../services/dataConnectService';
import { LogOut, Heart, Briefcase, MapPin, History, Bookmark, Map, Star, Sparkles, ChevronRight, CheckCircle2 } from 'lucide-react';

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
const ALL_STYLES = ['Solo', 'Couples', 'Family', 'Friends', 'Backpacker'];
const ALL_BUDGETS = ['Budget', 'Moderate', 'Luxury'] as const;

interface ProfileViewProps {
  user: User;
  bookmarksCount: number;
  itinerariesCount: number;
  activities: UserActivityEvent[];
  onNavigate: (tab: 'explore' | 'bookmarks' | 'itineraries') => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  bookmarksCount,
  itinerariesCount,
  activities,
  onNavigate
}) => {
  const [interests, setInterests] = useState<string[]>(user.profile?.interests || []);
  const [styles, setStyles] = useState<string[]>(user.profile?.travelStyles || []);
  const [budget, setBudget] = useState<User['profile']['budgetPreference']>(user.profile?.budgetPreference);
  const [homeCity, setHomeCity] = useState<string>(user.profile?.homeCity || '');
  const [saved, setSaved] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter(i => i !== value) : [...list, value]);
  };

  const isDirty =
    JSON.stringify([...interests].sort()) !== JSON.stringify([...(user.profile?.interests || [])].sort()) ||
    JSON.stringify([...styles].sort()) !== JSON.stringify([...(user.profile?.travelStyles || [])].sort()) ||
    budget !== user.profile?.budgetPreference ||
    homeCity !== (user.profile?.homeCity || '');

  const handleSave = () => {
    dataConnect.updateUserProfile({ interests, travelStyles: styles, budgetPreference: budget, homeCity: homeCity.trim() || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const summary: { label: string; value: number; icon: React.ReactNode; tab: 'bookmarks' | 'itineraries'; color: string }[] = [
    { label: 'Saved Places', value: bookmarksCount, icon: <Bookmark className="w-4 h-4" />, tab: 'bookmarks', color: '#00f2fe' },
    { label: 'Planned Trips', value: itinerariesCount, icon: <Map className="w-4 h-4" />, tab: 'itineraries', color: '#a78bfa' }
  ];

  const activityLabel: Record<UserActivityEvent['type'], string> = {
    bookmark: 'Saved a place',
    itinerary: 'Planned a trip',
    review: 'Left a review',
    discover: 'Explored',
    chat: 'Chatted with AI'
  };

  return (
    <div className="profile-view section-container">
      {/* Header */}
      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.username} className="profile-avatar" />
          ) : (
            <div className="profile-avatar-fallback">{user.username.charAt(0).toUpperCase()}</div>
          )}
        </div>
        <div className="profile-info">
          <h1 className="profile-name">{user.username}</h1>
          <p className="profile-email">{user.email}</p>
          <span className="profile-provider-badge">
            {user.provider === 'google' ? 'Google Account' : user.provider === 'email' ? 'Email Account' : 'Guest'}
          </span>
        </div>
        <button type="button" className="btn-secondary profile-signout" onClick={() => authService.signOut()}>
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>

      {/* Stats */}
      <div className="profile-stats">
        {summary.map((s) => (
          <button
            type="button"
            key={s.label}
            className="profile-stat"
            onClick={() => onNavigate(s.tab)}
            style={{ '--acc': s.color } as React.CSSProperties}
          >
            <span className="profile-stat-icon">{s.icon}</span>
            <span className="profile-stat-value">{s.value}</span>
            <span className="profile-stat-label">{s.label}</span>
            <ChevronRight className="w-4 h-4 profile-stat-chev" />
          </button>
        ))}
      </div>

      {/* Preferences */}
      <div className="profile-section">
        <div className="profile-section-title">
          <Heart className="w-4 h-4" />
          Travel Preferences
          <span>(used by your AI agent)</span>
        </div>

        <div className="profile-field">
          <label className="form-label"><MapPin className="w-4 h-4" /> Home Base (City)</label>
          <input
            type="text"
            value={homeCity}
            onChange={(e) => setHomeCity(e.target.value)}
            placeholder="e.g. New York, London, Dhaka..."
            className="form-input"
          />
        </div>

        <div className="profile-field">
          <label className="form-label"><Heart className="w-4 h-4" /> Interests</label>
          <div className="pref-chip-row">
            {ALL_INTERESTS.map((i) => (
              <button
                type="button"
                key={i}
                onClick={() => toggle(interests, setInterests, i)}
                className={`pref-chip ${interests.includes(i) ? 'active' : ''}`}
              >
                {interests.includes(i) && <CheckCircle2 className="w-3.5 h-3.5" />}
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-field">
          <label className="form-label"><Briefcase className="w-4 h-4" /> Travel Style</label>
          <div className="pref-chip-row">
            {ALL_STYLES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => toggle(styles, setStyles, s)}
                className={`pref-chip ${styles.includes(s) ? 'active' : ''}`}
              >
                {styles.includes(s) && <CheckCircle2 className="w-3.5 h-3.5" />}
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-field">
          <label className="form-label"><MapPin className="w-4 h-4" /> Budget Preference</label>
          <div className="option-grid-3">
            {ALL_BUDGETS.map((b) => (
              <button
                type="button"
                key={b}
                onClick={() => setBudget(b)}
                className={`option-card ${budget === b ? 'selected' : ''}`}
              >
                {b === 'Budget' ? '💲 Budget' : b === 'Moderate' ? '💳 Moderate' : '💎 Luxury'}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-save-row">
          {saved && <span className="profile-saved-note">Saved! Your AI agent will use these preferences.</span>}
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!isDirty && !saved}>
            <CheckCircle2 className="w-4 h-4 text-slate-950" />
            Save Preferences
          </button>
        </div>
      </div>

      {/* Activity */}
      <div className="profile-section">
        <div className="profile-section-title">
          <History className="w-4 h-4" />
          Your Activity
        </div>
        {activities.length === 0 ? (
          <div className="state-panel" style={{ padding: '2rem' }}>
            <div className="state-panel-icon"><Sparkles className="w-6 h-6" /></div>
            <p style={{ color: 'var(--text-muted)' }}>No activity yet. Save places, plan trips, and chat with the AI agent to build a profile.</p>
            <button type="button" className="btn-primary" onClick={() => onNavigate('explore')}>
              <Sparkles className="w-4 h-4 text-slate-950" />
              Start Exploring
            </button>
          </div>
        ) : (
          <div className="activity-list">
            {activities.slice(0, 20).map((a) => (
              <div key={a.id} className="activity-item">
                <span className={`activity-dot ${a.type}`} />
                <div className="activity-body">
                  <div className="activity-title">
                    <span>{activityLabel[a.type] || a.type}</span>
                    {a.placeName && <b>{a.placeName}</b>}
                    {a.city && <em>{a.city}, {a.country}</em>}
                  </div>
                  {a.detail && <p className="activity-detail">{a.detail}</p>}
                </div>
                <span className="activity-time">
                  {new Date(a.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};