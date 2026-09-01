import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAI, GoogleAIBackend, AI } from 'firebase/ai';

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

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
  }
  return firebaseApp;
}

/**
 * Returns the Firebase AI Logic instance backed by the Gemini Developer API.
 * Note: AI Logic must be provisioned via `npx firebase init ailogic`
 * (or the Firebase console: AI Services > AI Logic) before calls succeed.
 */
export function getAIService(): AI {
  if (!aiInstance) {
    aiInstance = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}
