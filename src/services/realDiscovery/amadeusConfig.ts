/**
 * Real external-provider discovery configuration gate (STEP 41).
 *
 * The FIRST real external discovery provider in the app is the read-only
 * **Amadeus Self-Service API — Hotel Offers Search** (accommodation quotes only;
 * no booking, no payment). This module is the single, pure, browser-safe way to
 * decide whether a real-provider attempt may be composed at all:
 *
 * 1. **Default off.** The factory default is `attemptEnabled: false`. Nothing
 *    in the app ever flips this on, so a real-provider attempt can never become
 *    the default UI path. A caller (in practice a later server-side execution
 *    layer) must explicitly opt in with a fully-formed config.
 * 2. **Secrets never live in this module and never come from the client
 *    bundle.** Credentials are injected as a config value (`clientId` +
 *    `clientSecret`). This module performs no environment access in code — it
 *    reads no client- or runtime-provided environment; the only env-shaped
 *    reader exported here (`loadAmadeusConfigFromEnv`) takes a plain string
 *    map so a *server* can wire real secrets in later, off the bundle path.
 *    Browser builds only ever see `{ attemptEnabled: false, credentials: null }`.
 * 3. **Missing config is a first-class bounded state, never a crash or a
 *    silent empty.** The gate resolves to exactly `disabled` (attempt off),
 *    `credentials-missing` (on but not fully keyed), or `ready`. The service
 *    layer maps these to bounded outcomes with safe STEP 20 categories.
 * 4. **Capability is derived from the gate.** When not ready, the adapter
 *    declares `search-accommodation` as `unavailable-missing-credentials`, so
 *    the STEP 39/40 orchestrator gates it off and never calls a real endpoint.
 *
 * Deliberately side-effect free: no network, clock, SDK, `any`, generic
 * `Record<string, any>`, Firebase, Router, Zustand, or React. Secrets appear
 * only as injected strings and are never logged, echoed, or shipped.
 */

import type { ProviderCapabilityStatus } from '../../domain/providers/providerCapabilities';

/** The Amadeus Self-Service environment a config targets (test is the default). */
export type AmadeusEnvironment = 'test' | 'production';

/** The server-side credential pair for the Amadeus Self-Service API. */
export interface AmadeusDiscoveryCredentials {
  /** OAuth2 client id (server-side secret; never a VITE_ value). */
  clientId: string;
  /** OAuth2 client secret (server-side secret; never a VITE_ value). */
  clientSecret: string;
  /** Which base host to call (`test` defaults to the sandbox host). */
  environment: AmadeusEnvironment;
}

/** The complete injected config a real-provider attempt runs with. */
export interface AmadeusDiscoveryConfig {
  /** Master switch. When false (the always-off browser default) no attempt runs. */
  attemptEnabled: boolean;
  /** Present and valid only when a server supplied real credentials. */
  credentials: AmadeusDiscoveryCredentials | null;
}

/** The three deterministic gate states a real-provider attempt can be in. */
export type RealDiscoveryAttemptGate = 'disabled' | 'credentials-missing' | 'ready';

/** The always-off default for every browser build: nothing is enabled, no keys. */
export const DEFAULT_REAL_DISCOVERY_CONFIG: Readonly<AmadeusDiscoveryConfig> = Object.freeze({
  attemptEnabled: false,
  credentials: null,
});

/** Documented default for the attempt switch, so off-ness is explicit. */
export const REAL_DISCOVERY_ATTEMPT_ENABLED_DEFAULT = false;

/** Stable application-facing provider identity for the Amadeus adapter. */
export const AMADEUS_PROVIDER_ID = 'amadeus-self-service';
export const AMADEUS_PROVIDER_NAME = 'Amadeus Self-Service';

/** Upper bound on injected credential field lengths (never silently truncated). */
export const MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH = 500;

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

/** True when `value` is one of the recognized Amadeus environments. */
export function isAmadeusEnvironment(value: unknown): value is AmadeusEnvironment {
  return value === 'test' || value === 'production';
}

/**
 * Normalizes an untrusted credential payload, or returns `null` when it cannot
 * be repaired. Both `clientId` and `clientSecret` must be present, non-empty
 * after trimming, and bounded; `environment` defaults to `test` when absent and
 * rejects unknown values. Never throws; never touches env vars; secrets are
 * never logged.
 */
export function normalizeAmadeusCredentials(value: unknown): AmadeusDiscoveryCredentials | null {
  if (!isRecord(value)) return null;
  const clientId = requireString(value.clientId, MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH);
  if (clientId === null) return null;
  const clientSecret = requireString(value.clientSecret, MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH);
  if (clientSecret === null) return null;

  let environment: AmadeusEnvironment = 'test';
  if (value.environment !== undefined && value.environment !== null) {
    if (!isAmadeusEnvironment(value.environment)) return null;
    environment = value.environment;
  }
  return { clientId, clientSecret, environment };
}

/**
 * Normalizes an untrusted config payload, or returns `null` when it cannot be
 * repaired. `attemptEnabled` must be a boolean (rejects everything else so a
 * truthy string cannot silently turn a provider on); `credentials` must be an
 * object, `null`, or absent. Never throws.
 */
export function normalizeRealDiscoveryConfig(value: unknown): AmadeusDiscoveryConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.attemptEnabled !== 'boolean') return null;

  let credentials: AmadeusDiscoveryCredentials | null = null;
  if (value.credentials !== undefined && value.credentials !== null) {
    const normalized = normalizeAmadeusCredentials(value.credentials);
    if (normalized === null) return null;
    credentials = normalized;
  }

  return { attemptEnabled: value.attemptEnabled, credentials };
}

/**
 * Resolves the deterministic gate for a config. `disabled` whenever the attempt
 * switch is not explicitly on (the default), `credentials-missing` when it is
 * on but no valid credential pair exists, and `ready` only when both are true.
 * A real provider attempt is executed only from `ready`.
 */
export function getRealDiscoveryAttemptGate(
  config: AmadeusDiscoveryConfig
): RealDiscoveryAttemptGate {
  if (config.attemptEnabled !== true) return 'disabled';
  if (config.credentials === null) return 'credentials-missing';
  return 'ready';
}

/**
 * The capability status an adapter should declare for `search-accommodation`,
 * derived entirely from the gate. The app-wide capability vocabulary already
 * documents `unavailable-missing-credentials`, so a real provider that is not
 * ready never claims availability and is gated off by the STEP 20/39 guards.
 */
export function getRealProviderCapabilityStatus(
  config: AmadeusDiscoveryConfig
): Extract<ProviderCapabilityStatus, 'available' | 'unavailable-missing-credentials'> {
  return getRealDiscoveryAttemptGate(config) === 'ready'
    ? 'available'
    : 'unavailable-missing-credentials';
}

/**
 * Builds a config from an injected string map. This is the ONLY env-shaped
 * reader in the real-provider scope and it takes a plain record so it can run
 * server-side (or in tests) without any direct environment access in code.
 * Recognized keys:
 *
 * - `REAL_DISCOVERY_ATTEMPT_ENABLED` — `true`/`1` enables (non-secret switch).
 * - `AMADEUS_CLIENT_ID` — server-side secret; ignored when missing on a browser.
 * - `AMADEUS_CLIENT_SECRET` — server-side secret; ignored when missing.
 * - `AMADEUS_ENVIRONMENT` — `test` (default) or `production`.
 *
 * Missing or malformed secrets leave `credentials` null — a first-class
 * `credentials-missing` gate, never a throw.
 */
export function loadAmadeusConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>
): AmadeusDiscoveryConfig {
  const attemptEnabled =
    env['REAL_DISCOVERY_ATTEMPT_ENABLED'] === 'true' ||
    env['REAL_DISCOVERY_ATTEMPT_ENABLED'] === '1';

  const clientId = env['AMADEUS_CLIENT_ID'];
  const clientSecret = env['AMADEUS_CLIENT_SECRET'];
  const environmentValue = env['AMADEUS_ENVIRONMENT'];

  let credentials: AmadeusDiscoveryCredentials | null = null;
  const normalizedClientId = requireString(clientId, MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH);
  const normalizedClientSecret = requireString(clientSecret, MAX_AMADEUS_CREDENTIAL_FIELD_LENGTH);
  if (normalizedClientId !== null && normalizedClientSecret !== null) {
    credentials = {
      clientId: normalizedClientId,
      clientSecret: normalizedClientSecret,
      environment: isAmadeusEnvironment(environmentValue) ? environmentValue : 'test',
    };
  }

  return { attemptEnabled, credentials };
}
