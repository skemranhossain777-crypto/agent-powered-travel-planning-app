/**
 * Google Places discovery configuration gate (STEP 44).
 *
 * Google Places is introduced as a real-world **read-only place/destination
 * discovery provider** (Google Places API (New) `places:searchNearby`). This
 * module is the single, pure, browser-safe way to decide whether a Google
 * Places attempt may be composed at all:
 *
 * 1. **Default off.** The factory default is `attemptEnabled: false`. Nothing
 *    in the app flips this on, so a Google Places attempt can never become the
 *    default UI path. A caller (in practice a later server-side execution
 *    layer) must explicitly opt in with a fully-formed config.
 * 2. **Secrets never live in this module and never come from the client
 *    bundle.** The API key is injected as a config value (`apiKey`). This
 *    module performs no environment access in code — it reads no client- or
 *    runtime-provided environment; the only env-shaped reader exported here
 *    (`loadGooglePlacesConfigFromEnv`) takes a plain string map so a *server*
 *    can wire a real key in later, off the bundle path. Browser builds only
 *    ever see `{ attemptEnabled: false, credentials: null }`.
 * 3. **Missing config is a first-class bounded state, never a crash or a
 *    silent empty.** The gate resolves to exactly `disabled` (attempt off),
 *    `credentials-missing` (on but not fully keyed), or `ready`. The service
 *    layer maps these to bounded outcomes with the existing STEP 20 safe-error
 *    categories.
 * 4. **Read-only.** Google Places provides place discovery only; nothing
 *    books, reserves, pays, or mutates. There is no second key surface and no
 *    Google-specific proxy.
 *
 * Deliberately side-effect free: no network, clock, SDK, `any`, generic
 * `Record<string, any>`, Firebase, Router, Zustand, or React. The key appears
 * only as an injected string and is never logged, echoed, or shipped.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';

/** The server-side credential for Google Places API (New). */
export interface GooglePlacesDiscoveryCredentials {
  /** Google Places API key (server-side secret; never a VITE_ value). */
  apiKey: string;
}

/** The complete injected config a Google Places attempt runs with. */
export interface GooglePlacesDiscoveryConfig {
  /** Master switch. When false (the always-off browser default) no attempt runs. */
  attemptEnabled: boolean;
  /** Present and valid only when a server supplied a real API key. */
  credentials: GooglePlacesDiscoveryCredentials | null;
}

/** The three deterministic gate states a Google Places attempt can be in. */
export type GooglePlacesAttemptGate = 'disabled' | 'credentials-missing' | 'ready';

/** The always-off default for every browser build: nothing is enabled, no keys. */
export const DEFAULT_GOOGLE_PLACES_CONFIG: Readonly<GooglePlacesDiscoveryConfig> = Object.freeze({
  attemptEnabled: false,
  credentials: null,
});

/** Documented default for the attempt switch, so off-ness is explicit. */
export const GOOGLE_PLACES_ENABLED_DEFAULT = false;

/** Stable application-facing provider identity for the Google Places adapter. */
export const GOOGLE_PLACES_PROVIDER_ID = 'google-places';
export const GOOGLE_PLACES_PROVIDER_NAME = 'Google Places';

/** Upper bound on an injected API key length (never silently truncated). */
export const MAX_GOOGLE_PLACES_API_KEY_LENGTH = 500;

/** Stable message used when a Google Places config gates to credentials-missing. */
export const GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE =
  'Google Places credentials are not configured for this build.';

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
export function normalizeGooglePlacesCredentials(
  value: unknown
): GooglePlacesDiscoveryCredentials | null {
  if (!isRecord(value)) return null;
  const apiKey = requireString(value.apiKey, MAX_GOOGLE_PLACES_API_KEY_LENGTH);
  if (apiKey === null) return null;
  return { apiKey };
}

/**
 * Normalizes an untrusted config payload, or returns `null` when it cannot be
 * repaired. `attemptEnabled` must be a boolean (rejects everything else so a
 * truthy string cannot silently turn a provider on); `credentials` must be an
 * object, `null`, or absent. Never throws.
 */
export function normalizeGooglePlacesConfig(value: unknown): GooglePlacesDiscoveryConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.attemptEnabled !== 'boolean') return null;

  let credentials: GooglePlacesDiscoveryCredentials | null = null;
  if (value.credentials !== undefined && value.credentials !== null) {
    const normalized = normalizeGooglePlacesCredentials(value.credentials);
    if (normalized === null) return null;
    credentials = normalized;
  }

  return { attemptEnabled: value.attemptEnabled, credentials };
}

/**
 * Resolves the deterministic gate for a config. `disabled` whenever the attempt
 * switch is not explicitly on (the default), `credentials-missing` when it is
 * on but no valid API key exists, and `ready` only when both are true. A Google
 * Places attempt is executed only from `ready`.
 */
export function getGooglePlacesAttemptGate(config: GooglePlacesDiscoveryConfig): GooglePlacesAttemptGate {
  if (config.attemptEnabled !== true) return 'disabled';
  if (config.credentials === null) return 'credentials-missing';
  return 'ready';
}

/** True only in the `ready` gate state (a Google Places network call may run). */
export function isGooglePlacesReady(config: GooglePlacesDiscoveryConfig): boolean {
  return getGooglePlacesAttemptGate(config) === 'ready';
}

/**
 * Builds config from an injected string map. This is the ONLY env-shaped reader
 * in the Google Places scope and it takes a plain record so it can run
 * server-side (or in tests) without any direct environment access in code.
 * Recognized keys:
 *
 * - `GOOGLE_PLACES_ENABLED` — `true`/`1` enables (non-secret switch).
 * - `GOOGLE_PLACES_API_KEY` — server-side secret; never a `VITE_` value.
 *
 * Missing or malformed secrets leave `credentials` null — a first-class
 * `credentials-missing` gate, never a throw. The browser default (no env map)
 * is always `disabled`.
 */
export function loadGooglePlacesConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>
): GooglePlacesDiscoveryConfig {
  const attemptEnabled =
    env['GOOGLE_PLACES_ENABLED'] === 'true' || env['GOOGLE_PLACES_ENABLED'] === '1';

  const apiKey = requireString(env['GOOGLE_PLACES_API_KEY'], MAX_GOOGLE_PLACES_API_KEY_LENGTH);
  const credentials: GooglePlacesDiscoveryCredentials | null =
    apiKey === null ? null : { apiKey };

  return { attemptEnabled, credentials };
}

/** Convenience safe error for the credentials-missing gate (units with STEP 20). */
export function googlePlacesCredentialsMissingError(): ProviderSafeError {
  return { category: 'credentials-missing', message: GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE };
}