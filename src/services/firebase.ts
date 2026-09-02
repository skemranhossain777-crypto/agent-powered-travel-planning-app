import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAI, GoogleAIBackend, AI } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, Auth, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, Firestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBuKBkPIRh-ARdun4uWpnLdP2mh0SYTur8',
  authDomain: 'my-first-project-55f9a.firebaseapp.com',
  projectId: 'my-first-project-55f9a',
  storageBucket: 'my-first-project-55f9a.firebasestorage.app',
  messagingSenderId: '190696717811',
  appId: '1:190696717811:web:58bba217e5f588ebb3a686',
  measurementId: 'G-SVYBME5M48'
};

let firebaseApp: FirebaseApp | null = null;
let aiInstance: AI | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let appCheckInitialized = false;

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
  }
  return firebaseApp;
}

export function getAuthInstance(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
    void browserLocalPersistence;
  }
  return authInstance;
}

/**
 * Returns the Firestore instance used for real user-authored persistence
 * (profiles, bookmarks, itineraries, reviews, activity, sessions).
 * Uses multi-tab persistent cache so data survives reloads across tabs.
 */
export function getFirestoreInstance(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = initializeFirestore(getFirebaseApp(), {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
    });
  }
  return firestoreInstance;
}

/**
 * Firebase AI Logic (Gemini Developer API) enforces Firebase App Check
 * (mandatory since July 2026), so calls only succeed with a valid App Check
 * token. This wires up App Check:
 *  - Development: enable debug mode using `VITE_APPCHECK_DEBUG_TOKEN`
 *    (see `.env.local`, which is gitignored). No reCAPTCHA is loaded.
 *  - Production: provide a real reCAPTCHA Enterprise (SCORE) site key via
 *    `VITE_RECAPTCHA_SITE_KEY` and enforce it in the Firebase console.
 */
function initAppCheck(): void {
  if (appCheckInitialized) {
    return;
  }
  appCheckInitialized = true;

  const app = getFirebaseApp();

  const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

  if (!debugToken && !recaptchaSiteKey) {
    console.warn(
      '[Firebase] App Check is not configured. AI Logic requests will be rejected until ' +
        'a debug token (VITE_APPCHECK_DEBUG_TOKEN) or reCAPTCHA site key (VITE_RECAPTCHA_SITE_KEY) is provided.'
    );
    return;
  }

  if (debugToken) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }

  // In debug mode the provider isn't consulted; the placeholder key is unused.
  const provider = new ReCaptchaEnterpriseProvider(recaptchaSiteKey || 'unused-in-debug-mode');
  initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true
  });
}

/**
 * Returns the Firebase AI Logic instance backed by the Gemini Developer API.
 * Requires AI Logic to be provisioned (`firebase ailogic:providers:enable
 * gemini-developer-api`) and App Check to be satisfied.
 */
export function getAIService(): AI {
  initAppCheck();
  if (!aiInstance) {
    aiInstance = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}