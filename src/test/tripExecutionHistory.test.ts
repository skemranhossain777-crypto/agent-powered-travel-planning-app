import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistory,
  isTripExecutionHistory,
} from '../services/tripExecution/tripExecutionHistory';
import {
  TRIP_EXECUTION_RECORD_ID_PREFIX,
  type TripExecutionRecord,
} from '../services/tripExecution/tripExecutionRecord';
import type { TripExecutionAuthorizedExecutionResult } from '../services/tripExecution/tripExecutionAuthorizedExecution';
import type { TripExecutionProviderResultStatus } from '../services/tripExecution/tripExecutionProvider';

const REQUEST_ID = 'trip-execution-provider-request:dispatch-001';
const RECEIPT_PREFIX = 'trip-execution-outcome-receipt:';
const RECORD_KIND = 'trip-execution-record';
const AMADEUS = 'amadeus';
const BETA = 'beta-execution';

type ProviderStatus = TripExecutionProviderResultStatus;

/**
 * A canonical STEP 59 provider result as produced by the execution chain: it
 * carries exactly `providerId`, `requestId`, and `status` and no invented field.
 */
function acceptedEntry(providerId: string): TripExecutionAuthorizedExecutionResult {
  return {
    executed: true,
    result: { providerId, requestId: REQUEST_ID, status: 'accepted' },
    requestId: REQUEST_ID,
    providerId,
    reason: 'executed',
  };
}

function statusEntry(
  providerId: string,
  status: ProviderStatus
): TripExecutionAuthorizedExecutionResult {
  return {
    executed: true,
    result: { providerId, requestId: REQUEST_ID, status },
    requestId: REQUEST_ID,
    providerId,
    reason: 'executed',
  };
}

/** A provider-level failure: executed was attempted, but no result was returned. */
function unansweredEntry(providerId: string): TripExecutionAuthorizedExecutionResult {
  return {
    executed: true,
    result: null,
    requestId: REQUEST_ID,
    providerId,
    reason: 'provider-execution-failed',
  };
}

interface RecordOptions {
  tripId?: string;
  receiptId?: string;
  providerIds?: string[];
  results?: TripExecutionAuthorizedExecutionResult[];
  executed?: boolean;
  status?: ProviderStatus | null;
  kind?: string;
}

/**
 * Builds a structurally valid STEP 78 record as accepted by the STEP 78
 * `isTripExecutionRecord` validator: the deterministic id derives from the trip
 * and receipt, provider ids align with the result entries, and `executed`
 * agrees with whether any provider answered.
 */
function makeRecord(options: RecordOptions = {}): TripExecutionRecord {
  const tripId = options.tripId ?? 'trip-001';
  const receiptId = options.receiptId ?? `${RECEIPT_PREFIX}receipt-001`;
  const providerIds = options.providerIds ?? [AMADEUS];
  const results = options.results ?? [acceptedEntry(AMADEUS)];
  const executed = options.executed ?? results.length > 0;
  const status = options.status === undefined ? 'accepted' : options.status;
  return {
    id: `${TRIP_EXECUTION_RECORD_ID_PREFIX}${tripId}:${receiptId}`,
    kind: options.kind ?? RECORD_KIND,
    tripId,
    receiptId,
    requestId: REQUEST_ID,
    providerIds,
    results,
    executed,
    status,
  } as unknown as TripExecutionRecord;
}

function asRecord(value: Record<string, unknown>): TripExecutionRecord {
  return value as unknown as TripExecutionRecord;
}

/**
 * A structurally valid STEP 85 history item, so a regression test can flip one
 * field and assert the guard rejects exactly that deviation.
 */
function makeHistoryItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'trip-execution-history-item',
    id: 'trip-execution-record:trip-001:trip-execution-outcome-receipt:r',
    tripId: 'trip-001',
    receiptId: `${RECEIPT_PREFIX}r`,
    requestId: REQUEST_ID,
    providerIds: [AMADEUS],
    results: [acceptedEntry(AMADEUS)],
    executed: true,
    status: 'accepted',
    ...overrides,
  };
}

function historyWith(item: unknown): Record<string, unknown> {
  return { kind: 'trip-execution-history', tripId: 'trip-001', items: [item] };
}

const HISTORY_PATH = join(process.cwd(), 'src/services/tripExecution/tripExecutionHistory.ts');
const SOURCE = readFileSync(HISTORY_PATH, 'utf8');
// Comments and string literals removed, so the boundary scans below cannot be
// satisfied or defeated by prose in the module header.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 85 - Trip Execution History Read Model', () => {
  // --- Valid construction -------------------------------------------------
  it('1. empty array is accepted and yields an empty history', () => {
    const history = createTripExecutionHistory([]);
    expect(history.kind).toBe('trip-execution-history');
    expect(history.tripId).toBeNull();
    expect(history.items).toEqual([]);
    expect(isTripExecutionHistory(history)).toBe(true);
  });

  it('2. one valid record produces exactly one item', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    expect(history.items).toHaveLength(1);
    expect(history.items[0].id).toBe(record.id);
  });

  it('3. multiple valid records produce one item each', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.items).toHaveLength(2);
  });

  it('4. trip ID is preserved at the history level', () => {
    const record = makeRecord({ tripId: 'trip-abc' });
    const history = createTripExecutionHistory([record]);
    expect(history.tripId).toBe('trip-abc');
  });

  it('5. record IDs are preserved in order', () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}b` });
    const history = createTripExecutionHistory([first, second]);
    expect(history.items.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it('6. receipt IDs are preserved', () => {
    const record = makeRecord({ receiptId: `${RECEIPT_PREFIX}xyz` });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].receiptId).toBe(record.receiptId);
  });

  it('7. request IDs are preserved', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].requestId).toBe(record.requestId);
  });

  it('8. provider IDs are preserved including order across multiple providers', () => {
    const record = makeRecord({
      providerIds: [AMADEUS, BETA],
      results: [acceptedEntry(AMADEUS), statusEntry(BETA, 'rejected')],
      status: 'rejected',
    });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].providerIds).toEqual([AMADEUS, BETA]);
  });

  it('9. provider results are preserved with canonical STEP 59 shape', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].results).toEqual(record.results);
    expect(history.items[0].results[0].result).toEqual({
      providerId: AMADEUS,
      requestId: REQUEST_ID,
      status: 'accepted',
    });
  });

  it('10. executed state is preserved', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].executed).toBe(record.executed);
  });

  it('11. aggregate status is preserved', () => {
    const record = makeRecord({ status: 'failed', results: [statusEntry(AMADEUS, 'failed')] });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].status).toBe('failed');
  });

  // --- Ordering -----------------------------------------------------------
  it('12. input order is preserved across three records', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}n1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}n2` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}n3` }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.items.map((item) => item.receiptId)).toEqual([
      `${RECEIPT_PREFIX}n1`,
      `${RECEIPT_PREFIX}n2`,
      `${RECEIPT_PREFIX}n3`,
    ]);
  });

  it('13. records are not sorted (reverse-lexical ids survive unchanged)', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}z-last` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}a-first` }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.items.map((item) => item.receiptId)).toEqual([
      `${RECEIPT_PREFIX}z-last`,
      `${RECEIPT_PREFIX}a-first`,
    ]);
  });

  it('14. records are not reversed', () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}first` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}second` });
    const history = createTripExecutionHistory([first, second]);
    expect(history.items[0].id).toBe(first.id);
    expect(history.items[1].id).toBe(second.id);
  });

  it('15. duplicate records are not deduplicated', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record, record]);
    expect(history.items).toHaveLength(2);
  });

  it('16. records are not grouped by provider (interleaved providers stay interleaved)', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}p1`, providerIds: [AMADEUS], results: [acceptedEntry(AMADEUS)] }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}p2`, providerIds: [BETA], results: [acceptedEntry(BETA)] }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}p3`, providerIds: [AMADEUS], results: [acceptedEntry(AMADEUS)] }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.items.map((item) => item.providerIds[0])).toEqual([AMADEUS, BETA, AMADEUS]);
  });

  it('17. records are not grouped by status (mixed statuses keep input order)', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}s1`, results: [statusEntry(AMADEUS, 'failed')], status: 'failed' }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}s2` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}s3`, results: [statusEntry(AMADEUS, 'failed')], status: 'failed' }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.items.map((item) => item.status)).toEqual(['failed', 'accepted', 'failed']);
  });

  // --- Trip consistency ---------------------------------------------------
  it('18. the first record establishes the trip identity', () => {
    const first = makeRecord({ tripId: 'trip-first', receiptId: `${RECEIPT_PREFIX}f1` });
    const second = makeRecord({ tripId: 'trip-first', receiptId: `${RECEIPT_PREFIX}f2` });
    const history = createTripExecutionHistory([first, second]);
    expect(history.tripId).toBe('trip-first');
  });

  it('19. same-trip records are accepted', () => {
    const records = [
      makeRecord({ tripId: 'trip-same', receiptId: `${RECEIPT_PREFIX}g1` }),
      makeRecord({ tripId: 'trip-same', receiptId: `${RECEIPT_PREFIX}g2` }),
    ];
    const history = createTripExecutionHistory(records);
    expect(history.tripId).toBe('trip-same');
    expect(history.items).toHaveLength(2);
  });

  it('20. mixed-trip records are rejected', () => {
    const records = [
      makeRecord({ tripId: 'trip-one', receiptId: `${RECEIPT_PREFIX}h1` }),
      makeRecord({ tripId: 'trip-two', receiptId: `${RECEIPT_PREFIX}h2` }),
    ];
    expect(() => createTripExecutionHistory(records)).toThrow(TypeError);
  });

  it('21. mixed-trip input does not produce a partial history', () => {
    const records = [
      makeRecord({ tripId: 'trip-one', receiptId: `${RECEIPT_PREFIX}i1` }),
      makeRecord({ tripId: 'trip-one', receiptId: `${RECEIPT_PREFIX}i2` }),
      makeRecord({ tripId: 'trip-two', receiptId: `${RECEIPT_PREFIX}i3` }),
    ];
    // The inconsistency is detected even after valid leading records, and the
    // function throws rather than returning the two items it had accumulated.
    expect(() => createTripExecutionHistory(records)).toThrow(/mixed trip/);
  });

  // --- Execution semantics ------------------------------------------------
  it('22. status: null is preserved', () => {
    const record = makeRecord({ results: [unansweredEntry(AMADEUS)], status: null });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].status).toBeNull();
  });

  it('23. executed: false is preserved', () => {
    const record = makeRecord({ providerIds: [], results: [], executed: false, status: null });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].executed).toBe(false);
    expect(history.items[0].results).toEqual([]);
  });

  it('24. executed: true is preserved', () => {
    const record = makeRecord({ results: [unansweredEntry(AMADEUS)], status: null });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].executed).toBe(true);
  });

  it('25. provider-level rejected is preserved', () => {
    const record = makeRecord({
      results: [statusEntry(AMADEUS, 'rejected')],
      status: 'rejected',
    });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].results[0].result?.status).toBe('rejected');
  });

  it('26. provider-level failed is preserved', () => {
    const record = makeRecord({ results: [statusEntry(AMADEUS, 'failed')], status: 'failed' });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].results[0].result?.status).toBe('failed');
  });

  it('27. provider-level unsupported is preserved', () => {
    const record = makeRecord({
      results: [statusEntry(AMADEUS, 'unsupported')],
      status: 'unsupported',
    });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].results[0].result?.status).toBe('unsupported');
  });

  it('28. the read model introduces no status vocabulary of its own', () => {
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed']) {
      expect(CODE_WITH_LITERALS).not.toMatch(new RegExp(`'${status}'`));
    }
    // It reuses the shared STEP 59 status-vocabulary guard rather than
    // re-declaring or translating provider statuses.
    expect(CODE_WITH_LITERALS).toContain('isTripExecutionProviderResultStatus');
  });

  it('29. status is not recalculated from the provider entries', () => {
    const record = makeRecord({
      providerIds: [AMADEUS, BETA],
      results: [statusEntry(AMADEUS, 'rejected'), statusEntry(BETA, 'failed')],
      status: 'failed',
    });
    const history = createTripExecutionHistory([record]);
    // The aggregate is preserved as-is, not derived from the first or last entry.
    expect(history.items[0].status).toBe('failed');
    expect(history.items[0].results.map((entry) => entry.result?.status)).toEqual([
      'rejected',
      'failed',
    ]);
  });

  // --- Validation ---------------------------------------------------------
  it('30. a non-array input is rejected', () => {
    expect(() => createTripExecutionHistory({})).toThrow(TypeError);
    expect(() => createTripExecutionHistory('records')).toThrow(TypeError);
  });

  it('31. null is rejected', () => {
    expect(() => createTripExecutionHistory(null)).toThrow(TypeError);
  });

  it('32. a malformed (non-record) element is rejected', () => {
    expect(() => createTripExecutionHistory([{}])).toThrow(TypeError);
    expect(() => createTripExecutionHistory([null])).toThrow(TypeError);
  });

  it('33. a record with the wrong kind is rejected', () => {
    const record = makeRecord({ kind: 'not-a-trip-execution-record' });
    expect(() => createTripExecutionHistory([record])).toThrow(TypeError);
  });

  it('34. a record missing a required field is rejected', () => {
    const base = makeRecord();
    const missingReceipt = asRecord({ ...base, receiptId: undefined });
    const missingResults = asRecord({ ...base, results: undefined });
    expect(() => createTripExecutionHistory([missingReceipt])).toThrow(TypeError);
    expect(() => createTripExecutionHistory([missingResults])).toThrow(TypeError);
  });

  it('35. an invalid trip identity is rejected', () => {
    for (const tripId of ['', '.', '..', 'a/b', ' trip-001']) {
      const record = makeRecord({ tripId });
      expect(() => createTripExecutionHistory([record]), tripId).toThrow(TypeError);
    }
  });

  it('36. a malformed provider result is rejected', () => {
    const base = makeRecord();
    const nonObject = asRecord({
      ...base,
      results: [{ ...acceptedEntry(AMADEUS), result: 'nope' }],
    });
    const missingStatus = asRecord({
      ...base,
      results: [{ ...acceptedEntry(AMADEUS), result: { providerId: AMADEUS } }],
    });
    expect(() => createTripExecutionHistory([nonObject])).toThrow(TypeError);
    expect(() => createTripExecutionHistory([missingStatus])).toThrow(TypeError);
  });

  it('37. a malformed provider identity is rejected', () => {
    const base = makeRecord();
    const mismatch = asRecord({ ...base, providerIds: [BETA] });
    const nonString = asRecord({ ...base, providerIds: [123] });
    expect(() => createTripExecutionHistory([mismatch])).toThrow(TypeError);
    expect(() => createTripExecutionHistory([nonString])).toThrow(TypeError);
  });

  // --- Immutability -------------------------------------------------------
  it('38. the input array is not mutated', () => {
    const records = [makeRecord(), makeRecord({ receiptId: `${RECEIPT_PREFIX}mut` })];
    const snapshot = JSON.parse(JSON.stringify(records));
    createTripExecutionHistory(records);
    expect(records).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(records))).toEqual(snapshot);
  });

  it('39. the input record is not mutated when the history is later modified', () => {
    const record = makeRecord();
    const snapshot = JSON.parse(JSON.stringify(record));
    const history = createTripExecutionHistory([record]);
    history.items[0].providerIds.push('tampered');
    history.items[0].results.push(acceptedEntry('tampered'));
    if (history.items[0].results[0].result !== null) {
      history.items[0].results[0].result.status = 'failed';
    }
    expect(JSON.parse(JSON.stringify(record))).toEqual(snapshot);
  });

  it('40. provider ID arrays are defensively copied', () => {
    const record = makeRecord({ providerIds: [AMADEUS], results: [acceptedEntry(AMADEUS)] });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].providerIds).not.toBe(record.providerIds);
    expect(history.items[0].providerIds).toEqual([AMADEUS]);
  });

  it('41. nested result structures are defensively copied', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].results).not.toBe(record.results);
    expect(history.items[0].results[0]).not.toBe(record.results[0]);
    expect(history.items[0].results[0].result).not.toBe(record.results[0].result);
    expect(history.items[0].results[0].result).toEqual(record.results[0].result);
  });

  // --- Dependency boundaries ---------------------------------------------
  it('42. no Firebase/Firestore dependency', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('43. no repository dependency', () => {
    expect(CODE).not.toMatch(/repository/i);
  });

  it('44. no network dependency', () => {
    expect(CODE).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });

  it('45. no provider execution', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(|executeTripExecution|mockTripExecutionProvider/);
  });

  it('46. no UI/store/router dependency', () => {
    expect(CODE).not.toMatch(/from\s+['"]react|react-router|\bzustand\b|useState|createStore/);
  });

  it('47. output is deterministic for identical ordered input', () => {
    const build = () => [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}d1` }),
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}d2`,
        providerIds: [AMADEUS, BETA],
        results: [statusEntry(AMADEUS, 'rejected'), statusEntry(BETA, 'failed')],
        status: 'failed',
      }),
    ];
    const first = createTripExecutionHistory(build());
    const second = createTripExecutionHistory(build());
    expect(second).toEqual(first);
  });

  // --- Additional read-only identity and guard behaviour ------------------
  it('48. the history carries the documented kind', () => {
    const history = createTripExecutionHistory([makeRecord()]);
    expect(history.kind).toBe('trip-execution-history');
  });

  it('49. each item carries the documented item kind', () => {
    const history = createTripExecutionHistory([makeRecord()]);
    expect(history.items[0].kind).toBe('trip-execution-history-item');
  });

  it('50. the results array itself is defensively copied', () => {
    const record = makeRecord();
    const history = createTripExecutionHistory([record]);
    history.items[0].results.pop();
    expect(record.results).toHaveLength(1);
  });

  it('51. the type guard rejects null and non-objects', () => {
    expect(isTripExecutionHistory(null)).toBe(false);
    expect(isTripExecutionHistory(undefined)).toBe(false);
    expect(isTripExecutionHistory('history')).toBe(false);
    expect(isTripExecutionHistory([])).toBe(false);
  });

  it('52. the type guard rejects a wrong top-level kind', () => {
    expect(
      isTripExecutionHistory({ kind: 'something-else', tripId: null, items: [] })
    ).toBe(false);
  });

  it('53. the type guard rejects a non-string tripId', () => {
    expect(
      isTripExecutionHistory({ kind: 'trip-execution-history', tripId: 7, items: [] })
    ).toBe(false);
  });

  it('54. the type guard rejects an item with an unknown kind', () => {
    expect(
      isTripExecutionHistory({ kind: 'trip-execution-history', tripId: null, items: [{}] })
    ).toBe(false);
  });

  it('55. the type guard rejects an item missing a required field', () => {
    expect(
      isTripExecutionHistory({
        kind: 'trip-execution-history',
        tripId: 'trip-001',
        items: [
          {
            kind: 'trip-execution-history-item',
            tripId: 'trip-001',
            receiptId: `${RECEIPT_PREFIX}r`,
            requestId: REQUEST_ID,
            providerIds: [],
            results: [],
            executed: false,
            status: null,
          },
        ],
      })
    ).toBe(false);
  });

  it('56. the module imports only the STEP 78 record module and the STEP 59 status guard', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual(['./tripExecutionProvider', './tripExecutionRecord']);
  });

  it('57. the module has no clock or randomness', () => {
    expect(CODE).not.toMatch(/\bDate\.now\(|new Date\(|Math\.random|randomUUID|performance\./);
  });

  it('58. the module has no environment access', () => {
    expect(CODE).not.toMatch(/process\.env|import\.meta\.env|Deno\.env/);
  });

  // --- Type-guard regression: valid histories pass -------------------------
  it('59. a valid history with non-null provider results passes the guard', () => {
    const history = createTripExecutionHistory([makeRecord()]);
    expect(history.items[0].results[0].result).not.toBeNull();
    expect(isTripExecutionHistory(history)).toBe(true);
  });

  it('60. a valid history with an empty results array passes the guard', () => {
    const record = makeRecord({ providerIds: [], results: [], executed: false, status: null });
    const history = createTripExecutionHistory([record]);
    expect(isTripExecutionHistory(history)).toBe(true);
  });

  it('61. a valid history with a nullable aggregate status passes the guard', () => {
    const record = makeRecord({ results: [unansweredEntry(AMADEUS)], status: null });
    const history = createTripExecutionHistory([record]);
    expect(history.items[0].status).toBeNull();
    expect(isTripExecutionHistory(history)).toBe(true);
  });

  it('62. the guard accepts createTripExecutionHistory output for a mixed-status history', () => {
    const records = [
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}ok`,
        results: [acceptedEntry(AMADEUS)],
        status: 'accepted',
      }),
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}rej`,
        results: [statusEntry(AMADEUS, 'rejected')],
        status: 'rejected',
      }),
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}fail`,
        results: [statusEntry(AMADEUS, 'failed')],
        status: 'failed',
      }),
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}uns`,
        results: [statusEntry(AMADEUS, 'unsupported')],
        status: 'unsupported',
      }),
    ];
    const history = createTripExecutionHistory(records);
    expect(isTripExecutionHistory(history)).toBe(true);
  });

  it('63. a hand-built history with canonical provider results passes the guard', () => {
    expect(isTripExecutionHistory(historyWith(makeHistoryItem()))).toBe(true);
  });

  // --- Type-guard regression: malformed results fail -----------------------
  it('64. a provider result missing its status fails the guard', () => {
    const item = makeHistoryItem({
      results: [
        { ...acceptedEntry(AMADEUS), result: { providerId: AMADEUS, requestId: REQUEST_ID } },
      ],
    });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('65. a non-object provider result fails the guard', () => {
    const item = makeHistoryItem({
      results: [{ ...acceptedEntry(AMADEUS), result: 'nope' }],
    });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('66. an invalid provider status fails the guard', () => {
    const item = makeHistoryItem({
      results: [
        {
          ...acceptedEntry(AMADEUS),
          result: { providerId: AMADEUS, requestId: REQUEST_ID, status: 'ok' },
        },
      ],
    });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('67. an invalid aggregate status fails the guard', () => {
    expect(isTripExecutionHistory(historyWith(makeHistoryItem({ status: 'completed' })))).toBe(
      false
    );
  });

  it('68. a providerIds/results length mismatch fails the guard', () => {
    const item = makeHistoryItem({ providerIds: [AMADEUS], results: [] });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('69. misaligned providerIds and result provider ids fail the guard', () => {
    const item = makeHistoryItem({
      providerIds: [AMADEUS],
      results: [statusEntry(BETA, 'accepted')],
    });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('70. an executed/result-count contradiction fails the guard', () => {
    const item = makeHistoryItem({ executed: true, results: [] });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });

  it('71. a result entry missing its reason string fails the guard', () => {
    const entry = { ...acceptedEntry(AMADEUS) } as Record<string, unknown>;
    delete entry.reason;
    const item = makeHistoryItem({ results: [entry] });
    expect(isTripExecutionHistory(historyWith(item))).toBe(false);
  });
});
