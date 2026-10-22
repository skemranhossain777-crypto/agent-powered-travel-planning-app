import { describe, expect, it } from 'vitest';
import {
  buildProviderExecutionFailure,
  buildProviderExecutionRequiresUserAction,
  buildProviderExecutionSuccess,
  getProviderOperationKindLabel,
  getProviderSafeErrorCategoryLabel,
  isProviderExecutionFailure,
  isProviderExecutionRequiresUserAction,
  isProviderExecutionSuccess,
  isProviderOperationKind,
  isProviderOperationStatus,
  isProviderRetryability,
  isProviderSafeErrorCategory,
  PROVIDER_OPERATION_KINDS,
  PROVIDER_OPERATION_STATUSES,
  PROVIDER_RETRYABILITY_VALUES,
  PROVIDER_SAFE_ERROR_CATEGORIES,
  providerOperationIsReadOnly,
} from '../domain/providers/executionOperations';
import type {
  ProviderExecutionResult,
  ProviderOperationKind,
  ProviderRetryability,
  ProviderSafeErrorCategory,
} from '../domain/providers/executionOperations';

const source = { id: 'provider-a', name: 'Provider A' };

describe('STEP 20 execution operation vocabularies', () => {
  it('recognizes exactly the six operation kinds and rejects junk', () => {
    expect(PROVIDER_OPERATION_KINDS).toEqual([
      'search',
      'verify',
      'prepare-booking',
      'submit-booking',
      'retrieve-booking-status',
      'cancel-booking',
    ]);
    for (const kind of PROVIDER_OPERATION_KINDS) {
      expect(isProviderOperationKind(kind)).toBe(true);
    }
    for (const junk of ['book', 'pay', 'booking', 1, null, {}]) {
      expect(isProviderOperationKind(junk)).toBe(false);
    }
  });

  it('recognizes statuses, retryability values, and safe error categories', () => {
    expect(PROVIDER_OPERATION_STATUSES).toEqual(['success', 'failure', 'requires-user-action']);
    expect(PROVIDER_RETRYABILITY_VALUES).toEqual([
      'retryable',
      'not-retryable',
      'manual-review-required',
    ]);
    expect(PROVIDER_SAFE_ERROR_CATEGORIES.length).toBe(12);
    for (const status of PROVIDER_OPERATION_STATUSES) {
      expect(isProviderOperationStatus(status)).toBe(true);
    }
    for (const r of PROVIDER_RETRYABILITY_VALUES) {
      expect(isProviderRetryability(r)).toBe(true);
    }
    for (const c of PROVIDER_SAFE_ERROR_CATEGORIES) {
      expect(isProviderSafeErrorCategory(c)).toBe(true);
    }
    expect(isProviderSafeErrorCategory('boom')).toBe(false);
  });

  it('read-only operations are the only ones allowed without approval', () => {
    expect(providerOperationIsReadOnly('search')).toBe(true);
    expect(providerOperationIsReadOnly('verify')).toBe(true);
    expect(providerOperationIsReadOnly('retrieve-booking-status')).toBe(true);
    expect(providerOperationIsReadOnly('prepare-booking')).toBe(false);
    expect(providerOperationIsReadOnly('submit-booking')).toBe(false);
    expect(providerOperationIsReadOnly('cancel-booking')).toBe(false);
  });

  it('labels every operation kind and error category distinctly', () => {
    const kindLabels = PROVIDER_OPERATION_KINDS.map(getProviderOperationKindLabel);
    expect(new Set(kindLabels).size).toBe(kindLabels.length);
    const catLabels = PROVIDER_SAFE_ERROR_CATEGORIES.map(getProviderSafeErrorCategoryLabel);
    expect(new Set(catLabels).size).toBe(catLabels.length);
  });

  it('recognizes timeout and malformed-response as safe error categories (STEP 39)', () => {
    expect(PROVIDER_SAFE_ERROR_CATEGORIES).toContain('timeout');
    expect(PROVIDER_SAFE_ERROR_CATEGORIES).toContain('malformed-response');
    expect(isProviderSafeErrorCategory('timeout')).toBe(true);
    expect(isProviderSafeErrorCategory('malformed-response')).toBe(true);
    expect(getProviderSafeErrorCategoryLabel('timeout')).toBe('Timed out');
    expect(getProviderSafeErrorCategoryLabel('malformed-response')).toBe(
      'Malformed provider response'
    );
    const envelope = buildProviderExecutionFailure(
      'search',
      source,
      'timeout',
      'Search timed out.',
      '2026-09-01T09:00:00Z',
      'not-retryable'
    );
    expect(envelope).not.toBeNull();
    expect(envelope!.error?.category).toBe('timeout');
  });
});

describe('STEP 20 execution result envelopes', () => {
  it('builds a normalized success envelope with generic normalized data', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    const payload = { some: 'normalized-app-contract' };
    const result = buildProviderExecutionSuccess('search', source, payload, performedAt)!;
    expect(result).toEqual({
      operation: 'search',
      status: 'success',
      providerId: 'provider-a',
      providerName: 'Provider A',
      performedAt,
      retryability: 'retryable',
      data: payload,
    });
    expect(isProviderExecutionSuccess(result)).toBe(true);
    expect(isProviderExecutionFailure(result)).toBe(false);
  });

  it('rejects a success envelope with invalid operation, source, or timestamp', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    expect(
      buildProviderExecutionSuccess('pay' as ProviderOperationKind, source, {}, performedAt)
    ).toBeNull();
    expect(
      buildProviderExecutionSuccess('search', { id: '', name: 'X' }, {}, performedAt)
    ).toBeNull();
    expect(buildProviderExecutionSuccess('search', source, {}, 'whenever')).toBeNull();
  });

  it('builds a failure envelope with only a bounded safe error', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    const result = buildProviderExecutionFailure(
      'verify',
      source,
      'credentials-missing',
      'Provider credentials are not set up yet.',
      performedAt,
      'not-retryable'
    )!;
    expect(result).toEqual({
      operation: 'verify',
      status: 'failure',
      providerId: 'provider-a',
      providerName: 'Provider A',
      performedAt,
      retryability: 'not-retryable',
      error: {
        category: 'credentials-missing',
        message: 'Provider credentials are not set up yet.',
      },
    });
    expect(isProviderExecutionFailure(result)).toBe(true);
    expect(isProviderExecutionSuccess(result)).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('requires-user-action envelopes carry the safe approval-needed error and no data', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    const result = buildProviderExecutionRequiresUserAction(
      'submit-booking',
      source,
      'Please review the itinerary before submitting.',
      performedAt
    )!;
    expect(result.status).toBe('requires-user-action');
    expect(result.requiresUserAction).toBe(true);
    expect(result.retryability).toBe('manual-review-required');
    expect(result.error?.category).toBe('approval-required');
    expect(isProviderExecutionRequiresUserAction(result)).toBe(true);
    expect(isProviderExecutionSuccess(result)).toBe(false);
  });

  it('failure builds reject invalid categories, empty messages, and unsafe retryability', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    expect(
      buildProviderExecutionFailure(
        'verify',
        source,
        'boom' as ProviderSafeErrorCategory,
        'message',
        performedAt,
        'not-retryable'
      )
    ).toBeNull();
    expect(
      buildProviderExecutionFailure(
        'verify',
        source,
        'network-error',
        ' ',
        performedAt,
        'not-retryable'
      )
    ).toBeNull();
    expect(
      buildProviderExecutionFailure(
        'verify',
        source,
        'network-error',
        'ok',
        performedAt,
        'hmm' as ProviderRetryability
      )
    ).toBeNull();
  });

  it('warnings and limitations are normalized and bounded', () => {
    const performedAt = '2026-09-01T09:00:00Z';
    const result = buildProviderExecutionSuccess('search', source, {}, performedAt, {
      warnings: ['  Non-guaranteed pricing  '],
      limitations: ['  Live availability not shown  '],
    })!;
    expect((result as ProviderExecutionResult<unknown>).warnings).toEqual([
      'Non-guaranteed pricing',
    ]);
    expect((result as ProviderExecutionResult<unknown>).limitations).toEqual([
      'Live availability not shown',
    ]);

    expect(
      buildProviderExecutionSuccess('search', source, {}, performedAt, {
        warnings: ['x'.repeat(201)],
      })
    ).toBeNull();
  });
});
