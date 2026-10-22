/**
 * Pure, provider-independent capability contract (STEP 20).
 *
 * This module declares what a future travel-provider adapter *can do* without
 * naming, importing, or calling any provider. It is deliberately side-effect
 * free and dependency-free: no React, Firebase, Router, Zustand, network,
 * clock, `any`, or generic `Record<string, any>` escape hatches, and no
 * provider SDK, credential, or API key anywhere.
 *
 * A capability is an *architecture contract*, not an integration:
 *
 * 1. Seven capability ids cover the vocabularies a future adapter needs —
 *    transport search/detail, accommodation search/detail, reference
 *    verification, and booking-status / cancellation-information retrieval.
 *    Every id is a stable string so adapters and read-only UI can agree on a
 *    vocabulary without any provider concept leaking into the application.
 * 2. Six statuses make the current state of each capability explicit. A status
 *    is never guessed: unknown statuses are rejected, and the default for an
 *    undeclared capability is `unsupported`. A capability counts as operational
 *    only when it is `available`.
 * 3. Nothing here books, pays, verifies, retrieves, or executes anything. The
 *    contracts simply make the surface that a future producer/execution layer
 *    will implement discoverable and testable in advance.
 *
 * No provider exists today: every adapter, capability declaration, and status
 * is produced only inside this module and its tests.
 */

/** The only recognized provider capability ids (unknown values are rejected). */
export type ProviderCapabilityId =
  | 'search-transport'
  | 'retrieve-transport-details'
  | 'search-accommodation'
  | 'retrieve-accommodation-details'
  | 'verify-reference'
  | 'retrieve-booking-status'
  | 'retrieve-cancellation-information';

/** The recognized capability statuses, documenting current availability. */
export type ProviderCapabilityStatus =
  | 'unsupported'
  | 'available'
  | 'requires-authentication'
  | 'requires-user-approval'
  | 'unavailable-missing-credentials'
  | 'temporarily-unavailable';

/** One capability declaration: what an adapter can do and its current status. */
export interface ProviderCapabilityDeclaration {
  /** The capability id (required). */
  capability: ProviderCapabilityId;
  /** Current status of this capability (required). */
  status: ProviderCapabilityStatus;
  /** Optional plain-text note (max 200 characters). */
  note?: string;
}

export const PROVIDER_CAPABILITY_IDS: ReadonlyArray<ProviderCapabilityId> = [
  'search-transport',
  'retrieve-transport-details',
  'search-accommodation',
  'retrieve-accommodation-details',
  'verify-reference',
  'retrieve-booking-status',
  'retrieve-cancellation-information',
];

export const PROVIDER_CAPABILITY_STATUSES: ReadonlyArray<ProviderCapabilityStatus> = [
  'unsupported',
  'available',
  'requires-authentication',
  'requires-user-approval',
  'unavailable-missing-credentials',
  'temporarily-unavailable',
];

/** Upper bound enforced at the normalization boundary (never silently truncated). */
export const MAX_CAPABILITY_NOTE_LENGTH = 200;

/** The status every capability keeps until an adapter explicitly declares otherwise. */
export const DEFAULT_CAPABILITY_STATUS: ProviderCapabilityStatus = 'unsupported';

/** True when `value` is one of the recognized capability ids. */
export function isProviderCapabilityId(value: unknown): value is ProviderCapabilityId {
  return (
    typeof value === 'string' && (PROVIDER_CAPABILITY_IDS as ReadonlyArray<string>).includes(value)
  );
}

/** True when `value` is one of the recognized capability statuses. */
export function isProviderCapabilityStatus(value: unknown): value is ProviderCapabilityStatus {
  return (
    typeof value === 'string' &&
    (PROVIDER_CAPABILITY_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

/** True when `value` is a well-formed capability declaration. */
export function isProviderCapabilityDeclaration(
  value: unknown
): value is ProviderCapabilityDeclaration {
  return normalizeProviderCapabilityDeclaration(value) !== null;
}

/**
 * Normalizes an untrusted capability declaration, or returns `null` when the
 * shape cannot be repaired. The `capability` and `status` must be recognized
 * values (unknown values reject the whole record — never guessed); the optional
 * `note` is trimmed and dropped when empty. Never throws.
 */
export function normalizeProviderCapabilityDeclaration(
  value: unknown
): ProviderCapabilityDeclaration | null {
  if (!isRecord(value)) return null;
  const { capability, status, note } = value;
  if (!isProviderCapabilityId(capability)) return null;
  if (!isProviderCapabilityStatus(status)) return null;
  const declaration: ProviderCapabilityDeclaration = { capability, status };
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') return null;
    const trimmed = note.trim();
    if (trimmed.length === 0) return declaration;
    if (trimmed.length > MAX_CAPABILITY_NOTE_LENGTH) return null;
    declaration.note = trimmed;
  }
  return declaration;
}

/**
 * True only for `available` — the single status under which a future adapter
 * may actually execute the capability. Every other status (unsupported,
 * authentication/approval required, missing credentials, temporarily
 * unavailable) blocks execution. A capability with an unknown status would
 * also fail here, so nothing can ever run against a wrongly-declared
 * capability.
 */
export function providerCapabilityIsOperational(status: ProviderCapabilityStatus): boolean {
  return status === 'available';
}

/**
 * Human-readable, read-only label for a capability id (e.g. for a status list).
 * The labels never imply a live integration: they only describe the vocabulary
 * a future adapter may support.
 */
export function getProviderCapabilityLabel(id: ProviderCapabilityId): string {
  switch (id) {
    case 'search-transport':
      return 'Search transport options';
    case 'retrieve-transport-details':
      return 'Retrieve transport details';
    case 'search-accommodation':
      return 'Search accommodation options';
    case 'retrieve-accommodation-details':
      return 'Retrieve accommodation details';
    case 'verify-reference':
      return 'Verify a reference';
    case 'retrieve-booking-status':
      return 'Retrieve booking status';
    case 'retrieve-cancellation-information':
      return 'Retrieve cancellation information';
  }
}

/** Human-readable, read-only label for a capability status. */
export function getProviderCapabilityStatusLabel(status: ProviderCapabilityStatus): string {
  switch (status) {
    case 'unsupported':
      return 'Unsupported';
    case 'available':
      return 'Available';
    case 'requires-authentication':
      return 'Requires authentication';
    case 'requires-user-approval':
      return 'Requires user approval';
    case 'unavailable-missing-credentials':
      return 'Unavailable (credentials missing)';
    case 'temporarily-unavailable':
      return 'Temporarily unavailable';
  }
}

/**
 * Plain-text explanation of why a non-`available` status blocks execution, for
 * read-only presentation and documentation. A capability that is not
 * operational always describes itself — it is never presented as silent or
 * guessed.
 */
export function getProviderCapabilityUnavailabilityReason(
  status: ProviderCapabilityStatus
): string {
  switch (status) {
    case 'unsupported':
      return 'This capability is not supported.';
    case 'requires-authentication':
      return 'Provider authentication is required before this capability can run.';
    case 'requires-user-approval':
      return 'User approval is required before this capability can run.';
    case 'unavailable-missing-credentials':
      return 'This capability is unavailable because provider credentials are missing.';
    case 'temporarily-unavailable':
      return 'This capability is temporarily unavailable; no execution should retry automatically.';
    case 'available':
      return 'This capability is available.';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
