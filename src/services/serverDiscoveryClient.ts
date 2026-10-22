/**
 * Typed browser client for the secure server-side discovery boundary (STEP 42).
 *
 * This is the browser's typed entry point for REAL external-provider discovery.
 * It replaces the STEP 41 fail-closed execution path: when the server capability
 * is actually configured and enabled the browser calls the Firebase Functions
 * v2 host; when it is not enabled the browser returns the exact STEP 41
 * `not-configured` outcome without making any network request.
 *
 * The browser never learns provider details:
 *
 * - It sends only the normalized discovery query (the same shape the mock path
 *   already uses) plus its own Firebase ID token in the Authorization header.
 * - It never sends or receives Amadeus endpoints, OAuth flow details, client
 *   secrets, provider credentials, raw provider payloads, or token formats.
 * - It consumes exactly the existing normalized discovery contract
 *   (`RealDiscoveryOutcome`), so the UI stays provider-neutral.
 *
 * The transport is injected (`fetchImpl`) so every test is deterministic and
 * offline; no literal fetch call exists in this module.
 *
 * Determinism: no clock, timestamp, randomness, Firebase SDK, React, Router,
 * Zustand, `any`, or generic `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../domain/providers/executionOperations';
import type {
  RealDiscoveryOutcome,
  RealDiscoveryStatus,
} from './realDiscovery/realDiscoveryService';

/** Default state of the server capability flag: off unless explicitly enabled. */
export const SERVER_DISCOVERY_CLIENT_ENABLED_DEFAULT = false;

/** Default Functions host path behind the Firebase Hosting rewrite. */
export const SERVER_DISCOVERY_DEFAULT_ENDPOINT = '/api/real-discovery';

/** A minimal fetch-shaped response the injected transport must produce. */
export interface ServerDiscoveryClientFetchResponse {
  status: number;
  json: () => Promise<unknown>;
}

/** The injected HTTP transport seam (browser/production wires `window.fetch`). */
export type ServerDiscoveryClientFetch = (
  url: string,
  init: { method: string; headers: Readonly<Record<string, string>>; body: string }
) => Promise<ServerDiscoveryClientFetchResponse>;

/** Everything the typed client service needs (all injected, all non-secret). */
export interface ServerDiscoveryClientOptions {
  /** The server-boundary endpoint (e.g. `/api/real-discovery`). Non-secret. */
  endpoint: string;
  /** Non-secret capability flag: only true when the server capability is enabled. */
  enabled: boolean;
  /** Supplies the signed-in user's Firebase ID token for the Authorization header. */
  tokenProvider: () => Promise<string>;
  /** Injected HTTP transport (deterministic/offline in tests). */
  fetchImpl: ServerDiscoveryClientFetch;
}

const VALID_OUTCOME_STATUSES: ReadonlyArray<RealDiscoveryStatus> = [
  'success',
  'partial',
  'empty',
  'unsupported',
  'provider-failure',
  'invalid-input',
  'not-configured',
  'unexpected-failure',
];

/**
 * Runs a read-only real-provider discovery search through the server boundary.
 * Never books, pays, verifies, persists, or auto-assigns a primary. When the
 * capability is disabled it returns the STEP 41 `not-configured` outcome and
 * never touches the network.
 */
export async function discoverRealOptionsViaServer(
  raw: unknown,
  options: ServerDiscoveryClientOptions
): Promise<RealDiscoveryOutcome> {
  if (options.enabled !== true) {
    return {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: {
        category: 'not-implemented',
        message: 'Real-provider discovery is not enabled in this build.',
      },
      providerOutcomes: [],
    };
  }

  let idToken: string;
  try {
    idToken = await options.tokenProvider();
  } catch {
    return {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: {
        category: 'authentication-required',
        message: 'You must be signed in to run real-provider discovery.',
      },
      providerOutcomes: [],
    };
  }

  let response: ServerDiscoveryClientFetchResponse;
  try {
    response = await options.fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(raw),
    });
  } catch {
    return {
      status: 'provider-failure',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: {
        category: 'network-error',
        message: 'The discovery server could not be reached.',
      },
      providerOutcomes: [],
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failedOutcome(
      'malformed-response',
      'The discovery server returned an unreadable response.'
    );
  }

  const outcome = serverDiscoveryBodyToOutcome(body);
  if (outcome === null) {
    return failedOutcome(
      'malformed-response',
      'The discovery server returned an unexpected response shape.'
    );
  }
  return outcome;
}

/**
 * One path segment of a safe same-origin endpoint. Only unreserved URI path
 * characters are accepted, so percent-encoding, sub-delimiters, backslashes,
 * query, and fragment markers can never appear inside a segment.
 */
const SAFE_ENDPOINT_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * True only for a same-origin, rooted API path such as `/api/real-discovery` or
 * `/api/real-discovery/custom`. Fail-closed by construction.
 *
 * This is deliberately stricter than a `startsWith('/')` check, which would
 * still accept a protocol-relative `//host` value. The endpoint must start with
 * exactly one `/`; may not contain a backslash (browsers normalize `\` to `/`,
 * so `/\host` would escape origin), a scheme or authority, a query, a fragment,
 * a control character, percent-encoding, an empty segment, or a `.`/`..`
 * traversal segment.
 */
export function isSafeServerDiscoveryEndpoint(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (candidate[0] !== '/') return false;
  if (candidate.startsWith('//')) return false;
  if (candidate.includes('\\')) return false;
  if (candidate.includes('?') || candidate.includes('#')) return false;
  if (/\s/.test(candidate)) return false;
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }

  const segments = candidate.slice(1).split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      SAFE_ENDPOINT_SEGMENT.test(segment)
  );
}

/**
 * Reads the non-secret browser capability flags from an injected string map.
 * `VITE_REAL_DISCOVERY_SERVER_ENABLED` (`true`/`1`) and
 * `VITE_REAL_DISCOVERY_SERVER_ENDPOINT` (default `/api/real-discovery`). These
 * are PUBLIC capability values, never secrets; secrets can never pass through
 * here. The `VITE_` prefix is required so Vite inlines them into the client
 * bundle (Vite only exposes `VITE_`-prefixed keys to the app); the caller
 * injects that map.
 *
 * A blank endpoint keeps the existing same-origin default. A non-blank endpoint
 * is accepted only when it is a safe same-origin API path (see
 * `isSafeServerDiscoveryEndpoint`); any other value fails closed — the
 * capability is forced off and the safe default path is returned, so a
 * misconfigured endpoint can never send the user's Firebase ID token off-origin.
 */
export function loadServerDiscoveryClientOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>
): { enabled: boolean; endpoint: string } {
  const rawEnabled = env['VITE_REAL_DISCOVERY_SERVER_ENABLED'];
  const enabled = rawEnabled === 'true' || rawEnabled === '1';
  const rawEndpoint = env['VITE_REAL_DISCOVERY_SERVER_ENDPOINT'];
  const configured = typeof rawEndpoint === 'string' ? rawEndpoint.trim() : '';

  if (configured.length === 0) {
    return { enabled, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT };
  }
  if (isSafeServerDiscoveryEndpoint(configured)) {
    return { enabled, endpoint: configured };
  }
  return { enabled: false, endpoint: SERVER_DISCOVERY_DEFAULT_ENDPOINT };
}

function serverDiscoveryBodyToOutcome(value: unknown): RealDiscoveryOutcome | null {
  if (!isRecord(value)) return null;

  const kind = value['kind'];
  const status = value['status'];
  if (
    typeof status !== 'string' ||
    !VALID_OUTCOME_STATUSES.includes(status as RealDiscoveryStatus)
  ) {
    if (
      kind === 'server-discovery-auth-error' ||
      status === 'unauthenticated' ||
      status === 'invalid-token'
    ) {
      const message = value['message'];
      if (typeof message !== 'string') return null;
      return failedOutcome('authentication-required', message);
    }
    return null;
  }

  return {
    status: status as RealDiscoveryStatus,
    adaptersConsulted: Array.isArray(value['adaptersConsulted']) ? value['adaptersConsulted'] : [],
    results: Array.isArray(value['results']) ? value['results'] : [],
    query: value['query'] ?? null,
    problem: value['problem'] ?? null,
    error: value['error'] ?? null,
    providerOutcomes: Array.isArray(value['providerOutcomes']) ? value['providerOutcomes'] : [],
  } as RealDiscoveryOutcome;
}

function failedOutcome(
  category: ProviderSafeError['category'],
  message: string
): RealDiscoveryOutcome {
  return {
    status: 'provider-failure',
    adaptersConsulted: [],
    results: [],
    query: null,
    problem: null,
    error: { category, message },
    providerOutcomes: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
