import {
  signInWithPopup,
  GoogleAuthProvider,
  AuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';
import { getAuthInstance } from './firebase';
import { User } from '../types/travel';
import { dataConnect } from './dataConnectService';
import { firestoreService } from './firestoreService';

function usernameFromEmail(email: string): string {
  const base = email.split('@')[0] || 'Traveler';
  return base
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/[._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Traveler';
}

function mapFirebaseUser(fbUser: FirebaseUser): User {
  const profile = dataConnect.getUserProfile(fbUser.uid);
  dataConnect.ensureUserProfile(fbUser.uid, {
    displayName: fbUser.displayName || usernameFromEmail(fbUser.email || ''),
    email: fbUser.email || undefined,
    avatarUrl: fbUser.photoURL || undefined
  });
  const provider =
    fbUser.providerData.find((p) => p.providerId === 'google.com') ? 'google'
      : fbUser.providerData.find((p) => p.providerId === 'password') ? 'email'
        : 'anonymous';

  return {
    id: fbUser.uid,
    username: fbUser.displayName || usernameFromEmail(fbUser.email || ''),
    email: fbUser.email || '',
    joinDate: fbUser.metadata?.creationTime || new Date().toISOString(),
    avatarUrl: fbUser.photoURL || undefined,
    provider,
    emailVerified: fbUser.emailVerified,
    profile: {
      displayName: fbUser.displayName || usernameFromEmail(fbUser.email || ''),
      email: fbUser.email || '',
      avatarUrl: fbUser.photoURL || undefined,
      ...profile,
      interests: profile?.interests || ['Culture & Heritage', 'Gourmet Dining'],
      travelStyles: profile?.travelStyles || ['Couples']
    }
  };
}

function handleAuthError(error: unknown): Error {
  const e = error as { code?: string; message?: string };
  const code = e.code || '';
  const fallback = e.message || 'Authentication failed. Please try again.';

  const friendly: Record<string, string> = {
    'auth/popup-closed-by-user': 'Sign-in popup was closed before completing. Please try again.',
    'auth/popup-blocked': 'The sign-in popup was blocked. Please allow popups for this site and try again.',
    'auth/account-exists-with-different-credential': 'This email is already used with a different sign-in method. Try signing in with that method instead.',
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-not-found': 'No account found with this email. Create a new account.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Incorrect email or password. Please try again.',
    'auth/too-many-requests': 'Too many sign-in attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };

  return new Error(friendly[code] || fallback);
}

class AuthService {
  private auth = getAuthInstance();
  private listeners = new Set<(user: User | null) => void>();
  private currentUser: User | null = null;

  constructor() {
    onAuthStateChanged(this.auth, (fbUser) => {
      if (fbUser) {
        dataConnect.setActiveUser(fbUser.uid);
        const mapped = mapFirebaseUser(fbUser);
        this.currentUser = mapped;
        // Persist login time + session to Firestore for the admin dashboard.
        firestoreService
          .recordUserLogin({
            uid: fbUser.uid,
            email: fbUser.email || '',
            username: fbUser.displayName || usernameFromEmail(fbUser.email || ''),
            displayName: fbUser.displayName || undefined,
            avatarUrl: fbUser.photoURL || undefined,
            provider: mapped.provider
          })
          .then((res) => {
            if (this.currentUser && this.currentUser.id === fbUser.uid) {
              this.currentUser = { ...this.currentUser, lastLoginAt: res.lastLoginAt };
            }
          })
          .catch((err) => void err);
      } else {
        dataConnect.clearActiveUser();
        this.currentUser = null;
      }
      this.listeners.forEach((cb) => cb(this.currentUser));
    });
  }

  get user(): User | null {
    return this.currentUser;
  }

  subscribe(cb: (user: User | null) => void): () => void {
    this.listeners.add(cb);
    cb(this.currentUser);
    return () => this.listeners.delete(cb);
  }

  async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return this.runPopup(provider);
  }

  async signInWithEmail(email: string, password: string): Promise<User> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, password);
      dataConnect.setActiveUser(cred.user.uid);
      this.currentUser = mapFirebaseUser(cred.user);
      this.emit();
      return this.currentUser;
    } catch (err) {
      throw handleAuthError(err);
    }
  }

  async signUpWithEmail(email: string, password: string, displayName: string): Promise<User> {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, password);
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      dataConnect.setActiveUser(cred.user.uid);
      dataConnect.ensureUserProfile(cred.user.uid, {
        displayName: displayName.trim(),
        interests: ['Culture & Heritage', 'Gourmet Dining'],
        travelStyles: ['Couples']
      });
      this.currentUser = mapFirebaseUser(cred.user);
      this.emit();
      return this.currentUser;
    } catch (err) {
      throw handleAuthError(err);
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (err) {
      throw handleAuthError(err);
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  private async runPopup(provider: AuthProvider): Promise<User> {
    try {
      const cred = await signInWithPopup(this.auth, provider);
      dataConnect.setActiveUser(cred.user.uid);
      dataConnect.ensureUserProfile(cred.user.uid, {
        displayName: cred.user.displayName || usernameFromEmail(cred.user.email || ''),
        interests: ['Culture & Heritage', 'Gourmet Dining'],
        travelStyles: ['Couples']
      });
      this.currentUser = mapFirebaseUser(cred.user);
      this.emit();
      return this.currentUser;
    } catch (err) {
      throw handleAuthError(err);
    }
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb(this.currentUser));
  }
}

export const authService = new AuthService();