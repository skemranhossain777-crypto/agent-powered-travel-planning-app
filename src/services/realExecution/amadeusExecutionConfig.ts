/**
 * Amadeus EXECUTION configuration gate (STEP 66).
 *
 * The configuration boundary for the FIRST real-provider implementation of the
 * STEP 59 `TripExecutionProvider` contract. It follows the security philosophy
 * already established by the STEP 41 Amadeus *discovery* configuration
 * (`services/realDiscovery/amadeusConfig.ts`) exactly, with one addition that
 * the execution domain forces: this switch additionally governs operations that
 * would eventually be irreversible, so it is **off by default and can never be
 * turned on implicitly**.
 *
 * 1. **Default off, always.** The factory default is `attemptEnabled: false`
 *    with no credentials. Nothing in the app flips it on, so a real-provider
 *    execution attempt can never become a default path. A future server-side
 *    layer must opt in explicitly with a fully-formed config.
 * 2. **Secrets never live in this module and never come from the client
 *    bundle.** Credentials are an injected config value. The only env-shaped
 *    reader (`loadAmadeusExecutionConfigFromEnv`) takes a plain string map so a
 *    *server* can wire real secrets in later, off the bundle path. A browser
 *    build only ever sees `{ attemptEnabled: false, credentials: null }`.
 * 3. **Browser-prefixed secrets are refused by design.** The recognized keys are
 *    exactly the four server-side names below. A `VITE_`-prefixed Amadeus key
 *    is never read (Vite inlines `VITE_*` into the client bundle, which would
 *    ship the credential to every visitor), so
 *    `isAmadeusExecutionBrowserExposedEnvKey` names those keys purely so tests
 *    and reviewers can assert they stay unhonored.
 * 4. **Missing config is a first-class bounded state, never a crash or a silent
 *    empty.** The gate resolves to exactly `disabled` (attempt off),
 *    `credentials-missing` (on but not fully keyed), or `ready`.
 * 5. **This config alone authorizes nothing.** A `ready` gate means "a server may
 *    attempt an implemented operation"; it is not permission to book. No Amadeus
 *    execution operation is implemented in this step, so a ready gate still
 *    produces `unsupported` at the adapter.
 *
 * Deliberately side-effect free: no network, clock, SDK, `any`, generic
 * `Record<string, any>`, Firebase, Router, Zustand, or React. Secrets appear
 * only as injected strings and are never logged, echoed, serialized into a
 * result, or shipped to a client.
 */

import type { ProviderCapabilityStatus } from '../../domain/providers/providerCapabilities';

/** The Amadeus Self-Service environment an execution config targets (test is the default). */
export type AmadeusExecutionEnvironment = 'test' | 'production';

/** The server-side credential pair an Amadeus EXECUTION attempt would run with. */
export interface AmadeusExecutionCredentials {
  /** OAuth2 client id (server-side secret; never a VITE_ value). */
  clientId: string;
  /** OAuth2 client secret (server-side secret; never a VITE_ value). */
  clientSecret: string;
  /** Which base host an operation would target (`test` is the sandbox host). */
  environment: AmadeusExecutionEnvironment;
}

/** The complete injected config a real-provider execution attempt runs with. */
export interface AmadeusExecutionConfig {
  /** Master switch. When false (the always-off browser default) no attempt runs. */
  attemptEnabled: boolean;
  /** Present and valid only when a server supplied real credentials. */
  credentials: AmadeusExecutionCredentials | null;
}

/** The three deterministic gate states a real-provider execution attempt can be in. */
export type AmadeusExecutionAttemptGate = 'disabled' | 'credentials-missing' | 'ready';

/** The always-off default for every browser build: nothing is enabled, no keys. */
export const DEFAULT_AMADEUS_EXECUTION_CONFIG: Readonly<AmadeusExecutionConfig> = Object.freeze({
  attemptEnabled: false,
  credentials: null,
});

/** Documented default for the execution switch, so off-ness is explicit. */
export const AMADEUS_EXECUTION_ATTEMPT_ENABLED_DEFAULT = false;

/** Stable provider identity for the Amadeus execution provider. */
export const AMADEUS_EXECUTION_PROVIDER_ID = 'amadeus-execution';
export const AMADEUS_EXECUTION_PROVIDER_NAME = 'Amadeus Execution';

/** Upper bound on injected credential field lengths (never silently truncated). */
export const MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH = 500;

/** Bounded, credential-free message for the `credentials-missing` gate. */
export const AMADEUS_EXECUTION_CREDENTIALS_MISSING_MESSAGE =
  'Amadeus execution credentials are not configured for this build.';

/** Bounded, credential-free message for the `disabled` gate. */
export const AMADEUS_EXECUTION_DISABLED_MESSAGE =
  'Amadeus execution is not enabled in this build.';

/**
 * The exact, server-side-only env keys this boundary honors. Deliberately free
 * of any `VITE_` prefix: a client bundle must never receive these names.
 */
export const AMADEUS_EXECUTION_SERVER_ENV_KEYS: ReadonlyArray<string> = Object.freeze([
  'AMADEUS_EXECUTION_ENABLED',
  'AMADEUS_CLIENT_ID',
  'AMADEUS_CLIENT_SECRET',
  'AMADEUS_ENVIRONMENT',
]);

/**
 * The Amadeus secret names that must NEVER be honored, because a `VITE_` prefix
 * makes Vite inline them into the client bundle. This module never reads a key
 * outside `AMADEUS_EXECUTION_SERVER_ENV_KEYS`; this list exists so tests and
 * reviewers can assert that the browser-exposed variants stay inert.
 */
export const AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS: ReadonlyArray<string> = Object.freeze([
  'VITE_AMADEUS_CLIENT_ID',
  'VITE_AMADEUS_CLIENT_SECRET',
  'VITE_AMADEUS_EXECUTION_ENABLED',
  'VITE_AMADEUS_ENVIRONMENT',
]);

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
export function isAmadeusExecutionEnvironment(value: unknown): value is AmadeusExecutionEnvironment {
  return value === 'test' || value === 'production';
}

/**
 * True when `key` is a browser-exposed (client-bundled) Amadeus key. Such a key
 * is never read by this boundary; the check exists so the refusal is explicit
 * and testable rather than incidental.
 */
export function isAmadeusExecutionBrowserExposedEnvKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  return AMADEUS_EXECUTION_BROWSER_FORBIDDEN_ENV_KEYS.includes(key);
}

/**
 * Normalizes an untrusted execution credential payload, or returns `null` when
 * it cannot be repaired. `clientId` and `clientSecret` must both be present,
 * non-empty after trimming, and bounded; `environment` defaults to `test` and
 * rejects unknown values. Never throws; never reads a real environment; secrets
 * are never logged or echoed.
 */
export function normalizeAmadeusExecutionCredentials(
  value: unknown
): AmadeusExecutionCredentials | null {
  if (!isRecord(value)) return null;
  const clientId = requireString(value.clientId, MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH);
  if (clientId === null) return null;
  const clientSecret = requireString(
    value.clientSecret,
    MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH
  );
  if (clientSecret === null) return null;

  let environment: AmadeusExecutionEnvironment = 'test';
  if (value.environment !== undefined && value.environment !== null) {
    if (!isAmadeusExecutionEnvironment(value.environment)) return null;
    environment = value.environment;
  }
  return { clientId, clientSecret, environment };
}

/**
 * Normalizes an untrusted execution config payload, or returns `null` when it
 * cannot be repaired. `attemptEnabled` must be a real boolean, so a truthy
 * string can never silently enable a real provider; `credentials` must be an
 * object, `null`, or absent. Never throws.
 */
export function normalizeAmadeusExecutionConfig(value: unknown): AmadeusExecutionConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.attemptEnabled !== 'boolean') return null;

  let credentials: AmadeusExecutionCredentials | null = null;
  if (value.credentials !== undefined && value.credentials !== null) {
    const normalized = normalizeAmadeusExecutionCredentials(value.credentials);
    if (normalized === null) return null;
    credentials = normalized;
  }

  return { attemptEnabled: value.attemptEnabled, credentials };
}

/**
 * Resolves the deterministic gate for a config: `disabled` whenever the switch
 * is not explicitly on (the default), `credentials-missing` when it is on but no
 * valid credential pair exists, and `ready` only when both hold. A real-provider
 * execution attempt is composed only from `ready` - and even then only for an
 * operation this build actually implements (none do).
 */
export function getAmadeusExecutionAttemptGate(
  config: AmadeusExecutionConfig
): AmadeusExecutionAttemptGate {
  if (config.attemptEnabled !== true) return 'disabled';
  if (config.credentials === null) return 'credentials-missing';
  return 'ready';
}

/** True only in the `ready` gate state (a configured server may attempt an implemented operation). */
export function isAmadeusExecutionReady(config: AmadeusExecutionConfig): boolean {
  return getAmadeusExecutionAttemptGate(config) === 'ready';
}

/**
 * The capability status an Amadeus execution provider declares for anything it
 * is asked to do. No execution capability is implemented, so this is never
 * `available`: a not-ready gate reports `unavailable-missing-credentials` and a
 * ready gate still reports `unsupported`, because being configured is not the
 * same as being able to execute.
 */
export function getAmadeusExecutionCapabilityStatus(
  config: AmadeusExecutionConfig
): Extract<ProviderCapabilityStatus, 'unsupported' | 'unavailable-missing-credentials'> {
  return getAmadeusExecutionAttemptGate(config) === 'ready'
    ? 'unsupported'
    : 'unavailable-missing-credentials';
}

/**
 * Builds an execution config from an injected string map. This is the ONLY
 * env-shaped reader in the Amadeus execution scope and it takes a plain record
 * so it can run server-side (or in tests) without any direct environment access
 * in code. Recognized keys (and nothing else):
 *
 * - `AMADEUS_EXECUTION_ENABLED` - `true`/`1` enables (non-secret switch; default
 *   off). It is independent of the STEP 41 discovery switch, so execution can be
 *   gated separately from read-only discovery.
 * - `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` - server-side secrets; missing
 *   or malformed values leave `credentials` null.
 * - `AMADEUS_ENVIRONMENT` - `test` (default) or `production`.
 *
 * A browser-exposed `VITE_`-prefixed key is never consulted, so a value placed
 * there cannot enable execution or supply a credential. Missing or malformed
 * secrets leave `credentials` null - a first-class `credentials-missing` gate,
 * never a throw.
 */
export function loadAmadeusExecutionConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>
): AmadeusExecutionConfig {
  const attemptEnabled =
    env['AMADEUS_EXECUTION_ENABLED'] === 'true' || env['AMADEUS_EXECUTION_ENABLED'] === '1';

  const clientId = requireString(env['AMADEUS_CLIENT_ID'], MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH);
  const clientSecret = requireString(
    env['AMADEUS_CLIENT_SECRET'],
    MAX_AMADEUS_EXECUTION_CREDENTIAL_FIELD_LENGTH
  );

  let credentials: AmadeusExecutionCredentials | null = null;
  if (clientId !== null && clientSecret !== null) {
    const environmentValue = env['AMADEUS_ENVIRONMENT'];
    credentials = {
      clientId,
      clientSecret,
      environment: isAmadeusExecutionEnvironment(environmentValue) ? environmentValue : 'test',
    };
  }

  return { attemptEnabled, credentials };
}
