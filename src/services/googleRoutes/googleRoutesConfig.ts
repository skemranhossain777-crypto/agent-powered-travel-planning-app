/**
 * Google Routes configuration gate (STEP 47).
 *
 * Google Routes is introduced as a read-only **origin → destination →
 * normalized route** capability (Routes API `computeRoutes`). This module is
 * the single, pure, browser-safe way to decide whether a Google Routes attempt
 * may be composed at all:
 *
 * 1. **Default off, independent of Places.** The factory default is
 *    `attemptEnabled: false` and Routes reads its own environment keys
 *    (`GOOGLE_ROUTES_ENABLED` / `GOOGLE_ROUTES_API_KEY`), never the Places
 *    flag. The application can disable Routes independently of every other
 *    provider.
 * 2. **Secrets never live in this module and never come from the client
 *    bundle.** The API key is an injected config value; `loadGoogleRoutesConfigFromEnv`
 *    takes a plain string map so a *server* can wire a real key in later, off
 *    the bundle path. Browser builds only ever see
 *    `{ attemptEnabled: false, credentials: null }`.
 * 3. **Missing config is a first-class bounded state.** The gate resolves to
 *    exactly `disabled`, `credentials-missing`, or `ready`. The service layer
 *    maps these to bounded outcomes with the existing STEP 20 safe-error
 *    categories.
 * 4. **Read-only.** A computed route is transient provider output; nothing
 *    books, reserves, pays, navigates, or mutates.
 *
 * Deliberately side-effect free: no network, clock, SDK, `any`, generic
 * `Record<string, any>`, Firebase, Router, Zustand, or React.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';

/** The server-side credential for Google Routes API. */
export interface GoogleRoutesCredentials {
  /** Google Routes API key (server-side secret; never a VITE_ value). */
  apiKey: string;
}

/** The complete injected config a Google Routes attempt runs with. */
export interface GoogleRoutesConfig {
  /** Master switch. When false (the always-off browser default) no attempt runs. */
  attemptEnabled: boolean;
  /** Present and valid only when a server supplied a real API key. */
  credentials: GoogleRoutesCredentials | null;
}

/** The three deterministic gate states a Google Routes attempt can be in. */
export type GoogleRoutesAttemptGate = 'disabled' | 'credentials-missing' | 'ready';

/** The always-off default for every browser build: nothing is enabled, no keys. */
export const DEFAULT_GOOGLE_ROUTES_CONFIG: Readonly<GoogleRoutesConfig> = Object.freeze({
  attemptEnabled: false,
  credentials: null,
});

/** Documented default for the attempt switch, so off-ness is explicit. */
export const GOOGLE_ROUTES_ENABLED_DEFAULT = false;

/** Stable application-facing provider identity for the Google Routes adapter. */
export const GOOGLE_ROUTES_PROVIDER_ID = 'google-routes';
export const GOOGLE_ROUTES_PROVIDER_NAME = 'Google Routes';

/** Upper bound on an injected API key length (never silently truncated). */
export const MAX_GOOGLE_ROUTES_API_KEY_LENGTH = 500;

/** Stable message used when a Google Routes config gates to credentials-missing. */
export const GOOGLE_ROUTES_CREDENTIALS_MISSING_MESSAGE =
  'Google Routes credentials are not configured for this build.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Normalizes an untrusted credential payload, or returns `null` when it cannot
 * be repaired. The `apiKey` must be present, non-empty after trimming, and
 * bounded. Never throws; never touches env vars; the key is never logged.
 */
export function normalizeGoogleRoutesCredentials(value: unknown): GoogleRoutesCredentials | null {
  if (!isRecord(value)) return null;
  const apiKey = requireString(value.apiKey, MAX_GOOGLE_ROUTES_API_KEY_LENGTH);
  if (apiKey === null) return null;
  return { apiKey };
}

/**
 * Normalizes an untrusted config payload, or returns `null` when it cannot be
 * repaired. `attemptEnabled` must be a boolean; `credentials` must be an
 * object, `null`, or absent. Never throws.
 */
export function normalizeGoogleRoutesConfig(value: unknown): GoogleRoutesConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.attemptEnabled !== 'boolean') return null;

  let credentials: GoogleRoutesCredentials | null = null;
  if (value.credentials !== undefined && value.credentials !== null) {
    const normalized = normalizeGoogleRoutesCredentials(value.credentials);
    if (normalized === null) return null;
    credentials = normalized;
  }

  return { attemptEnabled: value.attemptEnabled, credentials };
}

/**
 * Resolves the deterministic gate for a config. `disabled` whenever the attempt
 * switch is not explicitly on (the default), `credentials-missing` when it is
 * on but no valid API key exists, and `ready` only when both are true. A Google
 * Routes attempt is executed only from `ready`.
 */
export function getGoogleRoutesAttemptGate(config: GoogleRoutesConfig): GoogleRoutesAttemptGate {
  if (config.attemptEnabled !== true) return 'disabled';
  if (config.credentials === null) return 'credentials-missing';
  return 'ready';
}

/** True only in the `ready` gate state (a Google Routes network call may run). */
export function isGoogleRoutesReady(config: GoogleRoutesConfig): boolean {
  return getGoogleRoutesAttemptGate(config) === 'ready';
}

/**
 * Builds config from an injected string map. This is the ONLY env-shaped reader
 * in the Google Routes scope and it takes a plain record so it can run
 * server-side (or in tests) without any direct environment access in code.
 * Recognized keys:
 *
 * - `GOOGLE_ROUTES_ENABLED` — `true`/`1` enables (non-secret switch; never
 *   reused from the Places flag).
 * - `GOOGLE_ROUTES_API_KEY` — server-side secret; never a `VITE_` value.
 *
 * Missing or malformed secrets leave `credentials` null — a first-class
 * `credentials-missing` gate, never a throw. The browser default (no env map)
 * is always `disabled`.
 */
export function loadGoogleRoutesConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>
): GoogleRoutesConfig {
  const attemptEnabled =
    env['GOOGLE_ROUTES_ENABLED'] === 'true' || env['GOOGLE_ROUTES_ENABLED'] === '1';

  const apiKey = requireString(env['GOOGLE_ROUTES_API_KEY'], MAX_GOOGLE_ROUTES_API_KEY_LENGTH);
  const credentials: GoogleRoutesCredentials | null =
    apiKey === null ? null : { apiKey };

  return { attemptEnabled, credentials };
}

/** Convenience safe error for the credentials-missing gate (units with STEP 20). */
export function googleRoutesCredentialsMissingError(): ProviderSafeError {
  return { category: 'credentials-missing', message: GOOGLE_ROUTES_CREDENTIALS_MISSING_MESSAGE };
}