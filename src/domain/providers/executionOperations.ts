/**
 * Pure, provider-independent execution-operation envelope contract (STEP 20).
 *
 * A future provider adapter returns one of these normalized result envelopes
 * for every operation it performs. Deliberately side-effect free and
 * dependency-free: no React, Firebase, Router, Zustand, network, clock, `any`,
 * or generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. An envelope names the operation it belongs to (`ProviderOperationKind`),
 *    who it came from (`providerId`/`providerName`), when it happened
 *    (`performedAt`), and whether it can be retried (`retryability`). Unknown
 *    operation/status/category values are rejected — never guessed.
 * 2. Successful payloads live in `data` and must be **normalized app-contract
 *    values** (e.g. `TripProviderResult`, validated planning records), never a
 *    raw provider payload. Failed results carry only a bounded, safe error
 *    category and message — no credentials, payment details, tokens, or
 *    provider internals.
 * 3. `requiresUserAction` marks an op the user must approve/finish; the
 *    envelope itself never performs that action. Nothing here books, pays,
 *    verifies, retries, or schedules work.
 *
 * No provider exists today: envelopes are produced only inside this module and
 * its tests.
 */

/** The recognized execution operations a future adapter may bound. */
export type ProviderOperationKind =
  | 'search'
  | 'verify'
  | 'prepare-booking'
  | 'submit-booking'
  | 'retrieve-booking-status'
  | 'cancel-booking';

/** Result envelope status: what happened, never what *will* happen. */
export type ProviderOperationStatus = 'success' | 'failure' | 'requires-user-action';

/**
 * Whether the operation may be retried automatically. `review-required` means a
 * human must look first; failures are never auto-retried by the domain.
 */
export type ProviderRetryability = 'retryable' | 'not-retryable' | 'manual-review-required';

/** Bounded, safe error categories — never raw provider messages or internals. */
export type ProviderSafeErrorCategory =
  | 'invalid-input'
  | 'authentication-required'
  | 'approval-required'
  | 'credentials-missing'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'rate-limited'
  | 'network-error'
  | 'timeout'
  | 'malformed-response'
  | 'not-implemented'
  | 'unknown';

export const PROVIDER_OPERATION_KINDS: ReadonlyArray<ProviderOperationKind> = [
  'search',
  'verify',
  'prepare-booking',
  'submit-booking',
  'retrieve-booking-status',
  'cancel-booking',
];

export const PROVIDER_OPERATION_STATUSES: ReadonlyArray<ProviderOperationStatus> = [
  'success',
  'failure',
  'requires-user-action',
];

export const PROVIDER_RETRYABILITY_VALUES: ReadonlyArray<ProviderRetryability> = [
  'retryable',
  'not-retryable',
  'manual-review-required',
];

export const PROVIDER_SAFE_ERROR_CATEGORIES: ReadonlyArray<ProviderSafeErrorCategory> = [
  'invalid-input',
  'authentication-required',
  'approval-required',
  'credentials-missing',
  'provider-unavailable',
  'provider-rejected',
  'rate-limited',
  'network-error',
  'timeout',
  'malformed-response',
  'not-implemented',
  'unknown',
];

/** Upper bounds enforced at the normalization boundary. */
export const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500;
export const MAX_PROVIDER_EXECUTION_NOTE_LENGTH = 200;

/** A bounded safe error attached to a failed (or pending) envelope. */
export interface ProviderSafeError {
  category: ProviderSafeErrorCategory;
  message: string;
}

/** The normalized envelope every operation returns, generic over its payload. */
export interface ProviderExecutionResult<T> {
  /** Operation this envelope belongs to (required). */
  operation: ProviderOperationKind;
  /** Outcome of the operation (required). */
  status: ProviderOperationStatus;
  /** Provider key used by the adapter layer (required, bounded). */
  providerId: string;
  /** Human-readable provider label (required, bounded). */
  providerName: string;
  /** ISO date-time the operation was performed (required). */
  performedAt: string;
  /** Whether and how the operation may be retried (required). */
  retryability: ProviderRetryability;
  /** Normalized app-contract payload on success (never a raw provider payload). */
  data?: T;
  /** True when the user must approve/finish before the operation can proceed. */
  requiresUserAction?: boolean;
  /** Bounded safe error for failure, or when user action is blocked. */
  error?: ProviderSafeError;
  /** Optional user-facing limitations (each trimmed and bounded). */
  limitations?: string[];
  /** Optional user-facing warnings (each trimmed and bounded). */
  warnings?: string[];
}

/** The provider identity every envelope carries. */
export interface ProviderExecutionSource {
  id: string;
  name: string;
}

export function isProviderOperationKind(value: unknown): value is ProviderOperationKind {
  return (
    typeof value === 'string' && (PROVIDER_OPERATION_KINDS as ReadonlyArray<string>).includes(value)
  );
}

export function isProviderOperationStatus(value: unknown): value is ProviderOperationStatus {
  return (
    typeof value === 'string' &&
    (PROVIDER_OPERATION_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

export function isProviderRetryability(value: unknown): value is ProviderRetryability {
  return (
    typeof value === 'string' &&
    (PROVIDER_RETRYABILITY_VALUES as ReadonlyArray<string>).includes(value)
  );
}

export function isProviderSafeErrorCategory(value: unknown): value is ProviderSafeErrorCategory {
  return (
    typeof value === 'string' &&
    (PROVIDER_SAFE_ERROR_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when a normalized envelope reports success. A success never carries an
 * error, always carries `data`, and never needs user action.
 */
export function isProviderExecutionSuccess<T>(result: ProviderExecutionResult<T>): boolean {
  return result.status === 'success';
}

/** True when a normalized envelope reports failure. */
export function isProviderExecutionFailure<T>(result: ProviderExecutionResult<T>): boolean {
  return result.status === 'failure';
}

/** True when a normalized envelope requires explicit user action before the operation can continue. */
export function isProviderExecutionRequiresUserAction<T>(
  result: ProviderExecutionResult<T>
): boolean {
  return result.status === 'requires-user-action';
}

/**
 * True when an operation kind is read-only — it observes, searches, or checks
 * without ever creating, modifying, or cancelling anything. Read-only operations
 * are the only ones a future adapter may run without user approval.
 */
export function providerOperationIsReadOnly(kind: ProviderOperationKind): boolean {
  return kind === 'search' || kind === 'verify' || kind === 'retrieve-booking-status';
}

/** Human-readable, read-only label for an operation kind. */
export function getProviderOperationKindLabel(kind: ProviderOperationKind): string {
  switch (kind) {
    case 'search':
      return 'Search';
    case 'verify':
      return 'Verify reference';
    case 'prepare-booking':
      return 'Prepare booking';
    case 'submit-booking':
      return 'Submit booking';
    case 'retrieve-booking-status':
      return 'Retrieve booking status';
    case 'cancel-booking':
      return 'Cancel booking';
  }
}

/** Human-readable, read-only label for a safe error category. */
export function getProviderSafeErrorCategoryLabel(category: ProviderSafeErrorCategory): string {
  switch (category) {
    case 'invalid-input':
      return 'Invalid input';
    case 'authentication-required':
      return 'Authentication required';
    case 'approval-required':
      return 'Approval required';
    case 'credentials-missing':
      return 'Credentials missing';
    case 'provider-unavailable':
      return 'Provider unavailable';
    case 'provider-rejected':
      return 'Provider rejected the request';
    case 'rate-limited':
      return 'Rate limited';
    case 'network-error':
      return 'Network error';
    case 'timeout':
      return 'Timed out';
    case 'malformed-response':
      return 'Malformed provider response';
    case 'not-implemented':
      return 'Not implemented';
    case 'unknown':
      return 'Unknown error';
  }
}

/** Normalizes optional warning/limitation arrays (returns [] when absent, null on malformed). */
function optionalStringArray(value: unknown, maxLength: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > maxLength) return null;
    out.push(trimmed);
  }
  return out;
}

const ISO_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

function isRealIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: string): boolean {
  if (!ISO_DATE_TIME_RE.test(value)) return false;
  const match = ISO_DATE_TIME_RE.exec(value)!;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  return isRealIsoDate(match[1]) && Number.isFinite(Date.parse(value));
}

function requiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function requiredTimestamp(value: unknown): string | 'INVALID' {
  if (typeof value !== 'string') return 'INVALID';
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'INVALID';
  if (isIsoDateTime(trimmed)) return trimmed;
  return 'INVALID';
}

interface ProviderExecutionOutput<T> {
  operation: ProviderOperationKind;
  status: ProviderOperationStatus;
  providerId: string;
  providerName: string;
  performedAt: string;
  retryability: ProviderRetryability;
  data?: T;
  requiresUserAction?: boolean;
  error?: ProviderSafeError;
  limitations?: string[];
  warnings?: string[];
}

/**
 * Builds a normalized success envelope. `data` is required on success and
 * should hold a validated app-contract value, never a raw provider payload.
 * `retryability` stays `retryable` by default (a success needs no retry, but
 * the field is explicit for the caller). Never throws.
 */
export function buildProviderExecutionSuccess<T>(
  operation: ProviderOperationKind,
  source: ProviderExecutionSource,
  data: T,
  performedAt: string,
  options?: { retryability?: ProviderRetryability; limitations?: string[]; warnings?: string[] }
): ProviderExecutionResult<T> | null {
  const providerId = requiredString(source.id, 100);
  const providerName = requiredString(source.name, 100);
  const timestamp = requiredTimestamp(performedAt);
  if (providerId === null || providerName === null || timestamp === 'INVALID') return null;
  if (!isProviderOperationKind(operation)) return null;

  const limitations = options?.limitations
    ? optionalStringArray(options.limitations, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (limitations === null) return null;
  const warnings = options?.warnings
    ? optionalStringArray(options.warnings, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (warnings === null) return null;

  const out: ProviderExecutionOutput<T> = {
    operation,
    status: 'success',
    providerId,
    providerName,
    performedAt: timestamp,
    retryability: options?.retryability ?? 'retryable',
    data,
  };
  if (limitations.length > 0) out.limitations = limitations;
  if (warnings.length > 0) out.warnings = warnings;
  return out as ProviderExecutionResult<T>;
}

/**
 * Builds a normalized failure envelope with only a bounded safe error. A
 * failure never carries `data`, never auto-retries (`retryable` must be chosen
 * explicitly), and its message holds no credentials, payment details, tokens,
 * or raw provider internals. Never throws.
 */
export function buildProviderExecutionFailure(
  operation: ProviderOperationKind,
  source: ProviderExecutionSource,
  category: ProviderSafeErrorCategory,
  message: string,
  performedAt: string,
  retryability: ProviderRetryability = 'not-retryable',
  options?: { limitations?: string[]; warnings?: string[] }
): ProviderExecutionResult<never> | null {
  const providerId = requiredString(source.id, 100);
  const providerName = requiredString(source.name, 100);
  const timestamp = requiredTimestamp(performedAt);
  if (
    providerId === null ||
    providerName === null ||
    timestamp === 'INVALID' ||
    !isProviderOperationKind(operation) ||
    !isProviderSafeErrorCategory(category)
  ) {
    return null;
  }
  const safeMessage = requiredString(message, MAX_PROVIDER_ERROR_MESSAGE_LENGTH);
  if (safeMessage === null) return null;
  if (!isProviderRetryability(retryability)) return null;

  const limitations = options?.limitations
    ? optionalStringArray(options.limitations, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (limitations === null) return null;
  const warnings = options?.warnings
    ? optionalStringArray(options.warnings, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (warnings === null) return null;

  const out: ProviderExecutionOutput<never> = {
    operation,
    status: 'failure',
    providerId,
    providerName,
    performedAt: timestamp,
    retryability,
    error: { category, message: safeMessage },
  };
  if (limitations.length > 0) out.limitations = limitations;
  if (warnings.length > 0) out.warnings = warnings;
  return out;
}

/**
 * Marks that the user must approve or complete something before the operation
 * can proceed. Status is `requires-user-action`; a bounded safe message should
 * describe exactly what the user must do. Never throws.
 */
export function buildProviderExecutionRequiresUserAction(
  operation: ProviderOperationKind,
  source: ProviderExecutionSource,
  message: string,
  performedAt: string,
  options?: { limitations?: string[]; warnings?: string[] }
): ProviderExecutionResult<never> | null {
  const providerId = requiredString(source.id, 100);
  const providerName = requiredString(source.name, 100);
  const timestamp = requiredTimestamp(performedAt);
  if (
    providerId === null ||
    providerName === null ||
    timestamp === 'INVALID' ||
    !isProviderOperationKind(operation)
  ) {
    return null;
  }
  const safeMessage = requiredString(message, MAX_PROVIDER_ERROR_MESSAGE_LENGTH);
  if (safeMessage === null) return null;

  const limitations = options?.limitations
    ? optionalStringArray(options.limitations, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (limitations === null) return null;
  const warnings = options?.warnings
    ? optionalStringArray(options.warnings, MAX_PROVIDER_EXECUTION_NOTE_LENGTH)
    : [];
  if (warnings === null) return null;

  const out: ProviderExecutionOutput<never> = {
    operation,
    status: 'requires-user-action',
    providerId,
    providerName,
    performedAt: timestamp,
    retryability: 'manual-review-required',
    requiresUserAction: true,
    error: { category: 'approval-required', message: safeMessage },
  };
  if (limitations.length > 0) out.limitations = limitations;
  if (warnings.length > 0) out.warnings = warnings;
  return out;
}

export const MAX_PROVIDER_EXECUTION_SOURCE_LENGTH = 100;
