import React, { useEffect, useState } from 'react';
import { AdminUserSummary, UserSession } from '../types/travel';
import { firestoreService } from '../services/firestoreService';
import { authService } from '../services/authService';
import { Search, Users, Clock, ShieldCheck, Bookmark, Map, Star, Activity, ChevronDown, ChevronUp } from 'lucide-react';

interface AdminUserRow extends AdminUserSummary {}

export const AdminDashboard: React.FC = () => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    const current = authService.user;
    setAdmin(!!current && current.email === 'skemranhossain777@gmail.com');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const users = await firestoreService.adminListUsers();
        const detailed: AdminUserRow[] = [];
        for (const u of users) {
          let counts: { bookmarks: number; itineraries: number; reviews: number; activity: number } = {
            bookmarks: 0, itineraries: 0, reviews: 0, activity: 0
          };
          let lastSessions: UserSession[] = [];
          try {
            counts = await firestoreService.adminCountUser(u.uid);
            lastSessions = await firestoreService.adminGetSessions(u.uid, 5);
          } catch {
            // permission or rules error — skip per-user detail
          }
          detailed.push({
            ...u,
            bookmarksCount: counts.bookmarks,
            itinerariesCount: counts.itineraries,
            reviewsCount: counts.reviews,
            activityCount: counts.activity,
            sessionsCount: lastSessions.length,
            lastSessions
          });
        }
        setRows(detailed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load admin data.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = rows.filter(
    (r) =>
      r.email.toLowerCase().includes(search.toLowerCase()) ||
      r.username.toLowerCase().includes(search.toLowerCase()) ||
      `${r.displayName || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  if (!admin) {
    return (
      <div className="section-container">
        <div className="state-panel">
          <div className="state-panel-icon"><ShieldCheck className="w-7 h-7" /></div>
          <h3>Admin access only</h3>
          <p>This dashboard is restricted to the site administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-container">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div className="brand-icon" style={{ width: '38px', height: '38px' }}><Users className="w-5 h-5" /></div>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontWeight: 800 }}>User Administration</h3>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Every registered user's public data — accounts, login times, saves, trips, reviews.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', maxWidth: '420px' }}>
          <Search className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="form-input"
            style={{ borderRadius: 'var(--radius-full)', padding: '0.55rem 1rem' }}
          />
        </div>
      </div>

      {loading && <div className="ai-spinner" style={{ width: '40px', height: '40px' }} />}
      {!loading && error && <div className="toast toast-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.length === 0 && (
            <div className="state-panel">
              <p>No users found.</p>
            </div>
          )}
          {filtered.map((u) => {
            const isOpen = !!expanded[u.uid];
            return (
              <div key={u.uid} className="admin-user-card">
                <div className="admin-user-head">
                  <div className="admin-user-avatar">
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    ) : (
                      (u.displayName || u.username).charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="admin-user-main">
                    <div className="admin-user-name">
                      {u.displayName || u.username}
                      <span className="admin-badge">
                        {u.provider === 'google' ? 'Google' : u.provider === 'email' ? 'Email' : 'n/a'}
                      </span>
                    </div>
                    <div className="admin-user-email">{u.email || '—'}</div>
                  </div>

                  <div className="admin-user-stats">
                    <span className="admin-stat" title="Saved places">
                      <Bookmark className="w-3.5 h-3.5" /> {u.bookmarksCount}
                    </span>
                    <span className="admin-stat" title="Saved trips">
                      <Map className="w-3.5 h-3.5" /> {u.itinerariesCount}
                    </span>
                    <span className="admin-stat" title="Reviews">
                      <Star className="w-3.5 h-3.5" /> {u.reviewsCount}
                    </span>
                    <span className="admin-stat" title="Activity events">
                      <Activity className="w-3.5 h-3.5" /> {u.activityCount}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setExpanded((p) => ({ ...p, [u.uid]: !isOpen }))}
                    aria-label="Toggle details"
                  >
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                <div className="admin-user-meta">
                  <span><Clock className="w-3.5 h-3.5" /> Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</span>
                  <span>Joined: {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</span>
                  <span>Logins recorded: {u.sessionsCount}</span>
                </div>

                {isOpen && (
                  <div className="admin-user-detail">
                    {u.lastSessions && u.lastSessions.length > 0 && (
                      <div className="admin-session-list">
                        <div className="admin-detail-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Clock className="w-4 h-4" /> Recent sign-in history
                        </div>
                        {u.lastSessions.map((s) => (
                          <div key={s.id} className="admin-session-row">
                            <span className="admin-session-time">{new Date(s.loginAt).toLocaleString()}</span>
                            <span className="admin-session-provider">{s.provider}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};