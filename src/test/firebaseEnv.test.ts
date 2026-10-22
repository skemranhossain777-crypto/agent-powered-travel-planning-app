import { describe, expect, it } from 'vitest';
import {
  REQUIRED_FIREBASE_ENV_VARS,
  OPTIONAL_FIREBASE_ENV_VARS,
  findMissingFirebaseEnvVars,
  formatMissingFirebaseEnvVarsMessage,
} from '../config/firebaseEnv';

const COMPLETE_ENV = {
  VITE_FIREBASE_API_KEY: 'sentinel-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'sentinel-auth.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'sentinel-project',
  VITE_FIREBASE_APP_ID: 'sentinel-app-id',
};

describe('production Firebase config validation', () => {
  it('requires exactly the four core Firebase web values', () => {
    expect([...REQUIRED_FIREBASE_ENV_VARS]).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
    ]);
  });

  it('never treats optional Firebase values as required', () => {
    expect(findMissingFirebaseEnvVars(COMPLETE_ENV)).toEqual([]);
    for (const name of OPTIONAL_FIREBASE_ENV_VARS) {
      expect(REQUIRED_FIREBASE_ENV_VARS as readonly string[]).not.toContain(name);
    }
  });

  it('reports every missing required name', () => {
    expect(findMissingFirebaseEnvVars({})).toEqual([...REQUIRED_FIREBASE_ENV_VARS]);
    expect(findMissingFirebaseEnvVars({ VITE_FIREBASE_PROJECT_ID: 'example' })).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_APP_ID',
    ]);
  });

  it('treats blank and whitespace-only values as missing', () => {
    expect(
      findMissingFirebaseEnvVars({
        ...COMPLETE_ENV,
        VITE_FIREBASE_API_KEY: '',
        VITE_FIREBASE_APP_ID: '   ',
      })
    ).toEqual(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']);
  });

  it('names the missing variables without ever echoing their values', () => {
    const message = formatMissingFirebaseEnvVarsMessage(['VITE_FIREBASE_API_KEY']);
    expect(message).toContain('VITE_FIREBASE_API_KEY');
    expect(message).toContain('See .env.example');
    for (const value of Object.values(COMPLETE_ENV)) {
      expect(message).not.toContain(value);
    }
  });
});
