/**
 * Pure, provider-independent adapter boundary contract (STEP 20).
 *
 * A future provider adapter is the only boundary at which provider-specific
 * shapes are translated into the normalized app contracts. Deliberately
 * side-effect free and dependency-free: no React, Firebase, Router, Zustand,
 * network, clock, `any`, or generic `Record<string, any>` escape hatches, and
 * no provider SDK, credential, or API key anywhere.
 *
 * Contract rules:
 *
 * 1. An adapter declares capabilities via `ProviderCapabilityDeclaration` and
 *    delegates to the operational guards in `providerCapabilities.ts` before
 *    executing anything. A capability counts as operational only when
 *    `providerCapabilityIsOperational(declaration.status)` is true.
 * 2. An adapter never stores raw provider payloads: results are passed into
 *    the normalized envelope helpers (`buildProviderExecutionSuccess`, etc.)
 *    that strip unknown keys and produce safe error categories. The app never
 *    speaks a provider's raw vocabulary.
 * 3. An adapter is the only place where provider-specific authentication,
 *    SDK, network, and configuration lives. This module declares the *boundary*
 *    (what an adapter must look like) but never implements it.
 * 4. (STEP 39) The narrow read-only discovery operation is `search`: it takes a
 *    normalized `TripDiscoveryQuery` and a caller-supplied `now`, and returns a
 *    normalized execution envelope holding `TripProviderResult[]` on success or
 *    a safe error category otherwise. Discovery on this boundary never books,
 *    pays, verifies, or persists anything.
 *
 * No real provider exists today: this interface (including the read-only
 * `search` operation it declares) is produced only inside the app and its
 * tests. The in-app mock adapters implement it; nothing in the application
 * imports or calls a real adapter.
 */

import type { TripDiscoveryQuery } from './discoveryInput';
import type { ProviderExecutionResult } from './executionOperations';
import type { TripProviderResult } from './providerResults';
import type { ProviderCapabilityDeclaration, ProviderCapabilityId } from './providerCapabilities';
import {
  normalizeProviderCapabilityDeclaration,
  providerCapabilityIsOperational,
} from './providerCapabilities';

/**
 * The normalized profile an adapter presents — its id, human-readable name,
 * and declared capabilities. This is the application-facing identity of a
 * provider, not the provider's own opaque id.
 */
export interface ProviderAdapterProfile {
  /** Stable, application-facing adapter key (required, bounded). */
  id: string;
  /** Human-readable label (required, bounded). */
  name: string;
  /** Capability declarations in an arbitrary order. */
  capabilities: ProviderCapabilityDeclaration[];
}

/** The service interface a real adapter implements. Nothing calls this today. */
export interface ProviderAdapter {
  readonly profile: ProviderAdapterProfile;
  /** Whether a capability is currently operational. */
  isOperational(capability: ProviderCapabilityId): boolean;
  /** The identity of this adapter for the application. */
  id(): string;
  /** The human-readable name of this adapter. */
  name(): string;
  /**
   * The single narrow read-only discovery operation (STEP 39): runs a
   * normalized, bounded `TripDiscoveryQuery` and returns a normalized execution
   * envelope holding `TripProviderResult[]` on success or a safe error category
   * otherwise (e.g. `timeout`, `malformed-response`, `rate-limited`). `now` is a
   * caller-supplied ISO date/date-time so the method stays pure and
   * deterministic. Nothing here books, pays, verifies, persists, or schedules
   * work; the request limit is honored as an upper bound on returned results.
   */
  search(
    query: TripDiscoveryQuery,
    now: string
  ): ProviderExecutionResult<TripProviderResult[]> | null;
}

export const MAX_ADAPTER_ID_LENGTH = 100;
export const MAX_ADAPTER_NAME_LENGTH = 100;

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

/** True when `value` is a well-formed adapter profile. */
export function isProviderAdapterProfile(value: unknown): value is ProviderAdapterProfile {
  return normalizeProviderAdapterProfile(value) !== null;
}

/**
 * Normalizes an untrusted adapter-profile payload, or returns `null` when
 * the shape cannot be repaired. Unknown capability declarations are dropped;
 * duplicate capability ids are kept last-wins. Never throws.
 */
export function normalizeProviderAdapterProfile(value: unknown): ProviderAdapterProfile | null {
  if (!isRecord(value)) return null;
  const id = requireString(value.id, MAX_ADAPTER_ID_LENGTH);
  if (id === null) return null;
  const name = requireString(value.name, MAX_ADAPTER_NAME_LENGTH);
  if (name === null) return null;

  if (!Array.isArray(value.capabilities)) return null;

  const capMap = new Map<string, ProviderCapabilityDeclaration>();
  for (const raw of value.capabilities) {
    const decl = normalizeProviderCapabilityDeclaration(raw);
    if (decl === null) return null;
    capMap.set(decl.capability, decl);
  }

  const profile: ProviderAdapterProfile = {
    id,
    name,
    capabilities: [...capMap.values()],
  };
  return profile;
}

/**
 * True when an adapter profile declares a specific capability as operational.
 * A capability counts as operational only when it exists and its status is
 * `available`; absent capabilities or non-operational statuses return false.
 */
export function isAdapterCapabilityAvailable(
  profile: ProviderAdapterProfile,
  capability: ProviderCapabilityId
): boolean {
  const decl = profile.capabilities.find((c) => c.capability === capability);
  if (decl === undefined) return false;
  return providerCapabilityIsOperational(decl.status);
}

/**
 * The capability ids an adapter profile currently reports as operational.
 * Deterministic: always returned in `PROVIDER_CAPABILITY_IDS` order so callers
 * can rely on a stable presentation order.
 */
export function getAdapterOperationalCapabilityIds(profile: ProviderAdapterProfile): string[] {
  const available = new Set(
    profile.capabilities
      .filter((decl) => providerCapabilityIsOperational(decl.status))
      .map((decl) => decl.capability)
  );
  const out: string[] = [];
  for (const id of [
    'search-transport',
    'retrieve-transport-details',
    'search-accommodation',
    'retrieve-accommodation-details',
    'verify-reference',
    'retrieve-booking-status',
    'retrieve-cancellation-information',
  ] as const) {
    if (available.has(id)) out.push(id);
  }
  return out;
}
