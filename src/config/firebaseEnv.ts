export const REQUIRED_FIREBASE_ENV_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export const OPTIONAL_FIREBASE_ENV_VARS = [
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
] as const;

export type RequiredFirebaseEnvVar = (typeof REQUIRED_FIREBASE_ENV_VARS)[number];

export function findMissingFirebaseEnvVars(
  env: Readonly<Record<string, string | undefined>>
): RequiredFirebaseEnvVar[] {
  return REQUIRED_FIREBASE_ENV_VARS.filter((name) => {
    const value = env[name];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

export function formatMissingFirebaseEnvVarsMessage(missing: readonly string[]): string {
  return (
    'Missing required Firebase configuration for a production build: ' +
    `${missing.join(', ')}. ` +
    'Set these VITE_FIREBASE_* values in the build environment before deploying. ' +
    'See .env.example for the full list of names. Values are never logged.'
  );
}
