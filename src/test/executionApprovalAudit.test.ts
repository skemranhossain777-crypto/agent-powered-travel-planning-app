import { describe, expect, it } from 'vitest';
import {
  canExecutionProceedOnApprovalState,
  EXECUTION_APPROVAL_STATES,
  EXECUTION_AUDIT_EVENT_TYPES,
  getExecutionApprovalStateLabel,
  getExecutionAuditEventTypeLabel,
  isExecutionApprovalState,
  isExecutionAuditEvent,
  isExecutionAuditEventType,
  normalizeExecutionAuditEvent,
  providerOperationRequiresApproval,
} from '../domain/providers/executionApprovalAudit';

describe('STEP 20 execution approval boundaries', () => {
  it('recognizes exactly the five approval states and rejects junk', () => {
    expect(EXECUTION_APPROVAL_STATES).toEqual([
      'not-requested',
      'requested',
      'approved',
      'rejected',
      'expired',
    ]);
    for (const state of EXECUTION_APPROVAL_STATES) {
      expect(isExecutionApprovalState(state)).toBe(true);
    }
    for (const junk of ['ok', 'denied-forever', 1, null, {}]) {
      expect(isExecutionApprovalState(junk)).toBe(false);
    }
  });

  it('only an approved approval state lets an operation proceed', () => {
    expect(canExecutionProceedOnApprovalState('approved')).toBe(true);
    for (const state of ['not-requested', 'requested', 'rejected', 'expired'] as const) {
      expect(canExecutionProceedOnApprovalState(state)).toBe(false);
    }
  });

  it('mutating operations require approval; read-only operations do not', () => {
    expect(providerOperationRequiresApproval('prepare-booking')).toBe(true);
    expect(providerOperationRequiresApproval('submit-booking')).toBe(true);
    expect(providerOperationRequiresApproval('cancel-booking')).toBe(true);
    expect(providerOperationRequiresApproval('search')).toBe(false);
    expect(providerOperationRequiresApproval('verify')).toBe(false);
    expect(providerOperationRequiresApproval('retrieve-booking-status')).toBe(false);
  });

  it('labels every approval state distinctly', () => {
    const labels = EXECUTION_APPROVAL_STATES.map(getExecutionApprovalStateLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('STEP 20 execution audit vocabulary', () => {
  it('recognizes exactly the nine audit event types and rejects junk', () => {
    expect(EXECUTION_AUDIT_EVENT_TYPES).toEqual([
      'operation-requested',
      'operation-approved',
      'operation-rejected',
      'operation-started',
      'operation-succeeded',
      'operation-failed',
      'provider-response-received',
      'user-cancellation-requested',
      'provider-cancellation-confirmed',
    ]);
    for (const type of EXECUTION_AUDIT_EVENT_TYPES) {
      expect(isExecutionAuditEventType(type)).toBe(true);
    }
    for (const junk of ['booked', 'paid', 1, null, {}]) {
      expect(isExecutionAuditEventType(junk)).toBe(false);
    }
  });

  it('labels every audit event type distinctly and read-only', () => {
    const labels = EXECUTION_AUDIT_EVENT_TYPES.map(getExecutionAuditEventTypeLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('normalizes a well-formed audit event with a bounded safe summary', () => {
    const event = normalizeExecutionAuditEvent({
      operation: 'submit-booking',
      type: 'operation-approved',
      performedAt: '2026-09-01T09:00:00Z',
      actor: 'user',
      safeSummary: '  Approved submission  ',
    });
    expect(event).toEqual({
      operation: 'submit-booking',
      type: 'operation-approved',
      performedAt: '2026-09-01T09:00:00Z',
      actor: 'user',
      safeSummary: 'Approved submission',
    });
    expect(isExecutionAuditEvent(event)).toBe(true);
  });

  it('rejects audit events with unknown operations, types, actors, or timestamps', () => {
    expect(
      normalizeExecutionAuditEvent({
        operation: 'pay',
        type: 'operation-started',
        performedAt: '2026-09-01T09:00:00Z',
        actor: 'user',
      })
    ).toBeNull();
    expect(
      normalizeExecutionAuditEvent({
        operation: 'search',
        type: 'started',
        performedAt: '2026-09-01T09:00:00Z',
        actor: 'user',
      })
    ).toBeNull();
    expect(
      normalizeExecutionAuditEvent({
        operation: 'search',
        type: 'operation-started',
        performedAt: 'today',
        actor: 'user',
      })
    ).toBeNull();
    expect(
      normalizeExecutionAuditEvent({
        operation: 'search',
        type: 'operation-started',
        performedAt: '2026-09-01T09:00:00Z',
        actor: 'admin',
      })
    ).toBeNull();
  });

  it('drops an empty safeSummary rather than persisting empty text', () => {
    const event = normalizeExecutionAuditEvent({
      operation: 'verify',
      type: 'provider-response-received',
      performedAt: '2026-09-01T09:00:00Z',
      actor: 'provider',
      safeSummary: '   ',
    });
    expect(event?.safeSummary).toBeUndefined();
    expect(event?.actor).toBe('provider');
  });
});
