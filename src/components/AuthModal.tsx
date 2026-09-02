import React, { useState } from 'react';
import { X, Mail, Lock, User as UserIcon, Chrome, KeyRound, Loader2 } from 'lucide-react';
import { authService } from '../services/authService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
  initialMode?: 'signin' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthenticated, initialMode = 'signin' }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  if (!isOpen) return null;

  const resetForm = () => {
    setError('');
    setInfo('');
    setPassword('');
    setForgotOpen(false);
    setResetEmail('');
  };

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m);
    resetForm();
  };

  const handleGoogle = async () => {
    setIsLoading(true);
    setError('');
    try {
      await authService.signInWithGoogle();
      onAuthenticated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setIsLoading(true);
    try {
      if (mode === 'signup') {
        await authService.signUpWithEmail(email.trim(), password, displayName.trim());
      } else {
        await authService.signInWithEmail(email.trim(), password);
      }
      onAuthenticated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setIsLoading(true);
    try {
      await authService.sendPasswordReset(resetEmail.trim());
      setInfo('Password reset email sent. Check your inbox.');
      setTimeout(() => setForgotOpen(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-dialog auth-dialog">
        <button type="button" onClick={onClose} className="btn-icon" style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <div className="auth-head">
          <div className="brand-icon">
            <KeyRound className="w-6 h-6 text-slate-950" />
          </div>
          <h2>{forgotOpen ? 'Reset Password' : mode === 'signup' ? 'Create Your Account' : 'Welcome Back'}</h2>
          <p>
            {forgotOpen
              ? 'Enter your email and we\'ll send you a reset link.'
              : mode === 'signup'
                ? 'Sign up to save trips and get personalized AI recommendations.'
                : 'Sign in to access your saved trips and personalized AI travel agent.'}
          </p>
        </div>

        {error && (
          <div className="auth-alert auth-alert-error">{error}</div>
        )}
        {info && (
          <div className="auth-alert auth-alert-info">{info}</div>
        )}

        {forgotOpen ? (
          <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Email Address</label>
              <div className="auth-field">
                <Mail className="w-4 h-4" />
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="auth-input"
                />
              </div>
            </div>
            <button type="submit" disabled={isLoading} className="btn-primary auth-submit">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> : <KeyRound className="w-4 h-4 text-slate-950" />}
              Send Reset Link
            </button>
            <button type="button" className="auth-link-btn" onClick={() => { setForgotOpen(false); setError(''); setInfo(''); }}>
              Back to sign in
            </button>
          </form>
        ) : (
          <>
            {/* Google Sign-In */}
            <button type="button" onClick={handleGoogle} disabled={isLoading} className="auth-google-btn">
              <Chrome className="w-5 h-5" />
              Continue with Google
            </button>

            <div className="auth-divider"><span>or with email</span></div>

            {/* Email/Password form */}
            <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {mode === 'signup' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Your Name</label>
                  <div className="auth-field">
                    <UserIcon className="w-4 h-4" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Alex Journey"
                      className="auth-input"
                    />
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Email Address</label>
                <div className="auth-field">
                  <Mail className="w-4 h-4" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="auth-input"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Password</label>
                <div className="auth-field">
                  <Lock className="w-4 h-4" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                    className="auth-input"
                  />
                </div>
                {mode === 'signin' && (
                  <button type="button" className="auth-link-btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setForgotOpen(true); setError(''); setInfo(''); }}>
                    Forgot password?
                  </button>
                )}
              </div>

              <button type="submit" disabled={isLoading} className="btn-primary auth-submit">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> : mode === 'signup' ? <UserIcon className="w-4 h-4 text-slate-950" /> : <Lock className="w-4 h-4 text-slate-950" />}
                {mode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <div className="auth-switch">
              {mode === 'signin' ? (
                <span>New here? <button type="button" onClick={() => switchMode('signup')} className="auth-link-btn">Create an account</button></span>
              ) : (
                <span>Already have an account? <button type="button" onClick={() => switchMode('signin')} className="auth-link-btn">Sign in</button></span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};