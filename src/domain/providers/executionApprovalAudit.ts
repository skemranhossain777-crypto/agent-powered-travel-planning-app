/**
 * Pure, provider-independent execution approval and audit boundary (STEP 20).
 *
 * This module declares the approval vocabulary and audit-event vocabulary a
 * future execution workflow must respect, without implementing any execution,
 * approval flow, or audit persistence. It is deliberately side-effect free
 * and dependency-free: no React, Firebase, Router, Zustand, network, clock,
 * `any`, or generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. Read-only operations (`search`, `verify`, `retrieve-booking-status`) may
 *    run without user approval. Mutating operations (`prepare-booking`,
 *    `submit-booking`, `cancel-booking`) require the approval state to be
 *    `approved`; an expired or rejected approval always blocks them.
 * 2. Every action a future execution layer takes is recorded as an audit
 *    event. Audit events carry a bounded `safeSummary` only — never
 *    credentials, payment details, passport/identity data, tokens, or raw
 *    provider payloads. This module defines the event vocabulary; it does not
 *    persist anything.
 * 3. No automatic execution exists: no audit event or approval state ever
 *    triggers an operation by itself. A `success` state is always the result
 *    of an explicit, approved, user-invoked action.
 *
 * Nothing in the application performs approvals or writes audit events today;
 * the vocabulary is produced only inside this module and its tests.
 */

import type { ProviderOperationKind } from './executionOperations';
import { providerOperationIsReadOnly } from './executionOperations';

/** The recognized states of an execution approval. */
export type ExecutionApprovalState =
  'not-requested' | 'requested' | 'approved' | 'rejected' | 'expired';

/** The recognized audit event types for execution operations. */
export type ExecutionAuditEventType =
  | 'operation-requested'
  | 'operation-approved'
  | 'operation-rejected'
  | 'operation-started'
  | 'operation-succeeded'
  | 'operation-failed'
  | 'provider-response-received'
  | 'user-cancellation-requested'
  | 'provider-cancellation-confirmed';

export const EXECUTION_APPROVAL_STATES: ReadonlyArray<ExecutionApprovalState> = [
  'not-requested',
  'requested',
  'approved',
  'rejected',
  'expired',
];

export const EXECUTION_AUDIT_EVENT_TYPES: ReadonlyArray<ExecutionAuditEventType> = [
  'operation-requested',
  'operation-approved',
  'operation-rejected',
  'operation-started',
  'operation-succeeded',
  'operation-failed',
  'provider-response-received',
  'user-cancellation-requested',
  'provider-cancellation-confirmed',
];

/** Upper bounds enforced at the normalization boundary. */
export const MAX_AUDIT_SUMMARY_LENGTH = 200;

export interface ExecutionAuditEvent {
  /** The operation kind this audit event refers to (required). */
  operation: ProviderOperationKind;
  /** The event type (required). */
  type: ExecutionAuditEventType;
  /** ISO date-time the event happened (required). */
  performedAt: string;
  /** Bounded, safe plain-text summary — never sensitive data. */
  safeSummary?: string;
  /** Whether the event came from the user, the provider, or the system. */
  actor: 'user' | 'provider' | 'system';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isExecutionApprovalState(value: unknown): value is ExecutionApprovalState {
  return (
    typeof value === 'string' &&
    (EXECUTION_APPROVAL_STATES as ReadonlyArray<string>).includes(value)
  );
}

export function isExecutionAuditEventType(value: unknown): value is ExecutionAuditEventType {
  return (
    typeof value === 'string' &&
    (EXECUTION_AUDIT_EVENT_TYPES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * True when an approval state allows an executable operation to proceed.
 * Only `approved` does. `rejected` and `expired` always block.
 */
export function canExecutionProceedOnApprovalState(approvalState: ExecutionApprovalState): boolean {
  return approvalState === 'approved';
}

/**
 * Whether a given operation requires explicit user approval before it may run.
 * Read-only operations never require approval; mutations always do.
 */
export function providerOperationRequiresApproval(kind: ProviderOperationKind): boolean {
  return !providerOperationIsReadOnly(kind);
}

/** Human-readable, read-only label for an approval state. */
export function getExecutionApprovalStateLabel(state: ExecutionApprovalState): string {
  switch (state) {
    case 'not-requested':
      return 'Not requested';
    case 'requested':
      return 'Requested';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'expired':
      return 'Expired';
  }
}

/** Human-readable, read-only label for an audit event type. */
export function getExecutionAuditEventTypeLabel(type: ExecutionAuditEventType): string {
  switch (type) {
    case 'operation-requested':
      return 'Operation requested';
    case 'operation-approved':
      return 'Operation approved';
    case 'operation-rejected':
      return 'Operation rejected';
    case 'operation-started':
      return 'Operation started';
    case 'operation-succeeded':
      return 'Operation succeeded';
    case 'operation-failed':
      return 'Operation failed';
    case 'provider-response-received':
      return 'Provider response received';
    case 'user-cancellation-requested':
      return 'User cancellation requested';
    case 'provider-cancellation-confirmed':
      return 'Provider cancellation confirmed';
  }
}

/** True when `value` is a well-formed audit event. */
export function isExecutionAuditEvent(value: unknown): value is ExecutionAuditEvent {
  return normalizeExecutionAuditEvent(value) !== null;
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

function isProviderOperationKind(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (
      [
        'search',
        'verify',
        'prepare-booking',
        'submit-booking',
        'retrieve-booking-status',
        'cancel-booking',
      ] as ReadonlyArray<string>
    ).includes(value)
  );
}

function requireString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Normalizes an untrusted audit event, or returns `null` when the shape
 * cannot be repaired. `type` and `actor` must be recognized values; the
 * `safeSummary` is trimmed, bounded, and dropped when empty. Never throws.
 */
export function normalizeExecutionAuditEvent(value: unknown): ExecutionAuditEvent | null {
  if (!isRecord(value)) return null;

  if (!isProviderOperationKind(value.operation)) return null;
  if (!isExecutionAuditEventType(value.type)) return null;

  const actor = value.actor;
  if (actor !== 'user' && actor !== 'provider' && actor !== 'system') return null;

  const performedAt = requireString(value.performedAt, 60);
  if (performedAt === null || !isIsoDateTime(performedAt)) return null;

  const safeSummary = optionalString(value.safeSummary, MAX_AUDIT_SUMMARY_LENGTH);
  if (safeSummary === null) return null;

  const event: ExecutionAuditEvent = {
    operation: value.operation as ProviderOperationKind,
    type: value.type as ExecutionAuditEventType,
    actor: value.actor as ExecutionAuditEvent['actor'],
    performedAt,
  };
  if (safeSummary !== undefined) event.safeSummary = safeSummary;
  return event;
}
