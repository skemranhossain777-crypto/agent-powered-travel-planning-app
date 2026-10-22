import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistoryPresentation,
  isTripExecutionHistoryPresentation,
  type TripExecutionHistoryPresentation,
} from '../services/tripExecution/tripExecutionHistoryPresentation';
import { createTripExecutionHistory } from '../services/tripExecution/tripExecutionHistory';
import {
  TRIP_EXECUTION_RECORD_ID_PREFIX,
  isTripExecutionRecord,
  type TripExecutionRecord,
} from '../services/tripExecution/tripExecutionRecord';
import type { TripExecutionAuthorizedExecutionResult } from '../services/tripExecution/tripExecutionAuthorizedExecution';
import type { TripExecutionProviderResultStatus } from '../services/tripExecution/tripExecutionProvider';

const TRIP_ID = 'trip-001';
const OTHER_TRIP_ID = 'trip-002';
const REQUEST_ID = 'trip-execution-provider-request:dispatch-001';
const RECEIPT_PREFIX = 'trip-execution-outcome-receipt:';
const AMADEUS = 'amadeus';
const BETA = 'beta-execution';

type ProviderStatus = TripExecutionProviderResultStatus;

function entry(providerId: string, status: ProviderStatus): TripExecutionAuthorizedExecutionResult {
  return {
    executed: true,
    result: { providerId, requestId: REQUEST_ID, status },
    requestId: REQUEST_ID,
    providerId,
    reason: 'executed',
  };
}

/** A provider-level failure: execution was attempted, but no result came back. */
function unanswered(providerId: string): TripExecutionAuthorizedExecutionResult {
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
}

/** A structurally valid STEP 78 record accepted by `isTripExecutionRecord`. */
function makeRecord(options: RecordOptions = {}): TripExecutionRecord {
  const tripId = options.tripId ?? TRIP_ID;
  const receiptId = options.receiptId ?? `${RECEIPT_PREFIX}receipt-001`;
  const providerIds = options.providerIds ?? [AMADEUS];
  const results = options.results ?? [entry(AMADEUS, 'accepted')];
  const executed = options.executed ?? results.length > 0;
  const status = options.status === undefined ? 'accepted' : options.status;
  return {
    id: `${TRIP_EXECUTION_RECORD_ID_PREFIX}${tripId}:${receiptId}`,
    kind: 'trip-execution-record',
    tripId,
    receiptId,
    requestId: REQUEST_ID,
    providerIds,
    results,
    executed,
    status,
  };
}

function makeHistory(records: TripExecutionRecord[]) {
  return createTripExecutionHistory(records);
}

const MODULE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionHistoryPresentation.ts'
);
const SOURCE = readFileSync(MODULE_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 87 - Trip Execution History Presentation Contract', () => {
  // --- Valid construction -------------------------------------------------
  it('1. an empty history yields an empty presentation', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([]));
    expect(presentation.kind).toBe('trip-execution-history-presentation');
    expect(presentation.tripId).toBeNull();
    expect(presentation.items).toEqual([]);
  });

  it('2. an empty presentation passes the guard', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([]));
    expect(isTripExecutionHistoryPresentation(presentation)).toBe(true);
  });

  it('3. one record yields one presentation item', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    expect(presentation.items).toHaveLength(1);
  });

  it('4. multiple records yield one item each', () => {
    const presentation = createTripExecutionHistoryPresentation(
      makeHistory([
        makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
        makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
      ])
    );
    expect(presentation.items).toHaveLength(2);
  });

  it('5. a non-empty presentation passes the guard', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    expect(isTripExecutionHistoryPresentation(presentation)).toBe(true);
  });

  it('6. every presentation item carries the item kind', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    expect(presentation.items[0].kind).toBe('trip-execution-history-presentation-item');
  });

  // --- Trip identity ------------------------------------------------------
  it('7. the trip identity is preserved at the top level', () => {
    const presentation = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    expect(presentation.tripId).toBe(TRIP_ID);
  });

  it('8. a different trip identity is preserved unchanged', () => {
    const presentation = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ tripId: OTHER_TRIP_ID })])
    );
    expect(presentation.tripId).toBe(OTHER_TRIP_ID);
  });

  it('9. the trip identity stays null for an empty history', () => {
    expect(createTripExecutionHistoryPresentation(makeHistory([])).tripId).toBeNull();
  });

  // --- Record, receipt, and request identities ----------------------------
  it('10. the execution record identity is preserved', () => {
    const record = makeRecord();
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.id).toBe(record.id);
  });

  it('11. the receipt identity is preserved', () => {
    const record = makeRecord();
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.receiptId).toBe(record.receiptId);
  });

  it('12. the request identity is preserved', () => {
    const record = makeRecord();
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.requestId).toBe(record.requestId);
  });

  // --- Provider attribution and results -----------------------------------
  it('13. provider ids are preserved', () => {
    const item = createTripExecutionHistoryPresentation(makeHistory([makeRecord()])).items[0];
    expect(item.providerIds).toEqual([AMADEUS]);
  });

  it('14. provider results are preserved', () => {
    const record = makeRecord();
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.results).toEqual(record.results);
  });

  it('15. multiple providers are preserved in order', () => {
    const record = makeRecord({
      providerIds: [AMADEUS, BETA],
      results: [entry(AMADEUS, 'accepted'), entry(BETA, 'rejected')],
      status: 'accepted',
    });
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.providerIds).toEqual([AMADEUS, BETA]);
    expect(item.results.map((r) => r.providerId)).toEqual([AMADEUS, BETA]);
  });

  it('16. a null provider result is preserved', () => {
    const record = makeRecord({ results: [unanswered(AMADEUS)], status: null });
    const item = createTripExecutionHistoryPresentation(makeHistory([record])).items[0];
    expect(item.results[0].result).toBeNull();
  });

  // --- Ordering -----------------------------------------------------------
  it('17. the original item order is preserved', () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}b` });
    const third = makeRecord({ receiptId: `${RECEIPT_PREFIX}c` });
    const presentation = createTripExecutionHistoryPresentation(
      makeHistory([first, second, third])
    );
    expect(presentation.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  // --- Aggregate status and labels ----------------------------------------
  it('18. an accepted status yields its deterministic label', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ status: 'accepted' })])
    ).items[0];
    expect(item.status).toBe('accepted');
    expect(item.statusLabel).toBe('Accepted (provider response)');
  });

  it('19. a rejected status yields its deterministic label', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([
        makeRecord({ results: [entry(AMADEUS, 'rejected')], status: 'rejected' }),
      ])
    ).items[0];
    expect(item.status).toBe('rejected');
    expect(item.statusLabel).toBe('Rejected (provider response)');
  });

  it('20. an unsupported status yields its deterministic label', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([
        makeRecord({ results: [entry(AMADEUS, 'unsupported')], status: 'unsupported' }),
      ])
    ).items[0];
    expect(item.status).toBe('unsupported');
    expect(item.statusLabel).toBe('Unsupported (provider response)');
  });

  it('21. a failed status yields its deterministic label', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ results: [entry(AMADEUS, 'failed')], status: 'failed' })])
    ).items[0];
    expect(item.status).toBe('failed');
    expect(item.statusLabel).toBe('Failed (provider response)');
  });

  it('22. a null aggregate status is preserved and labelled neutrally', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ results: [], providerIds: [], executed: false, status: null })])
    ).items[0];
    expect(item.status).toBeNull();
    expect(item.statusLabel).toBe('No provider response');
  });

  it('23. every supported status produces a distinct label', () => {
    const statuses: ProviderStatus[] = ['accepted', 'rejected', 'unsupported', 'failed'];
    const labels = statuses.map(
      (status) =>
        createTripExecutionHistoryPresentation(
          makeHistory([makeRecord({ results: [entry(AMADEUS, status)], status })])
        ).items[0].statusLabel
    );
    labels.push(
      createTripExecutionHistoryPresentation(
        makeHistory([makeRecord({ results: [], providerIds: [], executed: false, status: null })])
      ).items[0].statusLabel
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  // --- Execution state and labels -----------------------------------------
  it('24. executed true yields the attempted label', () => {
    const item = createTripExecutionHistoryPresentation(makeHistory([makeRecord()])).items[0];
    expect(item.executed).toBe(true);
    expect(item.executionLabel).toBe('Execution attempted');
  });

  it('25. executed false yields the not-executed label', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ results: [], providerIds: [], executed: false, status: null })])
    ).items[0];
    expect(item.executed).toBe(false);
    expect(item.executionLabel).toBe('Not executed');
  });

  it('26. executed true with no provider answer keeps both labels honest', () => {
    const item = createTripExecutionHistoryPresentation(
      makeHistory([makeRecord({ results: [unanswered(AMADEUS)], status: null })])
    ).items[0];
    expect(item.executed).toBe(true);
    expect(item.executionLabel).toBe('Execution attempted');
    expect(item.status).toBeNull();
    expect(item.statusLabel).toBe('No provider response');
  });

  it('27. labels are deterministic across independent constructions', () => {
    const first = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    const second = createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
    expect(second.items[0].statusLabel).toBe(first.items[0].statusLabel);
    expect(second.items[0].executionLabel).toBe(first.items[0].executionLabel);
  });

  // --- Malformed history rejection ----------------------------------------
  it('28. rejects a null history', () => {
    expect(() => createTripExecutionHistoryPresentation(null)).toThrow(TypeError);
  });

  it('29. rejects a non-object history (string)', () => {
    expect(() => createTripExecutionHistoryPresentation('history')).toThrow(TypeError);
  });

  it('30. rejects an array in place of a history', () => {
    expect(() => createTripExecutionHistoryPresentation([makeRecord()])).toThrow(TypeError);
  });

  it('31. rejects a history with the wrong kind', () => {
    const bad = { ...makeHistory([makeRecord()]), kind: 'other' };
    expect(() => createTripExecutionHistoryPresentation(bad)).toThrow(TypeError);
  });

  it('32. rejects a history missing its items array', () => {
    expect(() =>
      createTripExecutionHistoryPresentation({ kind: 'trip-execution-history', tripId: null })
    ).toThrow(TypeError);
  });

  it('33. rejects a history with a malformed item', () => {
    expect(() =>
      createTripExecutionHistoryPresentation({
        kind: 'trip-execution-history',
        tripId: TRIP_ID,
        items: [{ bad: true }],
      })
    ).toThrow(TypeError);
  });

  it('34. rejects a mixed-trip history', () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ tripId: OTHER_TRIP_ID, receiptId: `${RECEIPT_PREFIX}r2` }),
    ];
    expect(() => createTripExecutionHistoryPresentation(makeHistory(records))).toThrow(TypeError);
  });

  // --- Malformed presentation rejection (guard) ---------------------------
  function presentation(): TripExecutionHistoryPresentation {
    return createTripExecutionHistoryPresentation(makeHistory([makeRecord()]));
  }

  it('35. the guard rejects null', () => {
    expect(isTripExecutionHistoryPresentation(null)).toBe(false);
  });

  it('36. the guard rejects a non-object', () => {
    expect(isTripExecutionHistoryPresentation('presentation')).toBe(false);
  });

  it('37. the guard rejects a wrong top-level kind', () => {
    expect(isTripExecutionHistoryPresentation({ ...presentation(), kind: 'other' })).toBe(false);
  });

  it('38. the guard rejects a non-array items field', () => {
    expect(
      isTripExecutionHistoryPresentation({
        kind: 'trip-execution-history-presentation',
        tripId: null,
        items: {},
      })
    ).toBe(false);
  });

  it('39. the guard rejects a non-string, non-null tripId', () => {
    expect(isTripExecutionHistoryPresentation({ ...presentation(), tripId: 7 })).toBe(false);
  });

  it('40. the guard rejects an item with the wrong kind', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], kind: 'other' }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('41. the guard rejects a non-object item', () => {
    expect(
      isTripExecutionHistoryPresentation({
        kind: 'trip-execution-history-presentation',
        tripId: TRIP_ID,
        items: ['nope'],
      })
    ).toBe(false);
  });

  it('42. the guard rejects an invalid aggregate status', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], status: 'ok' }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('43. the guard rejects a status label that disagrees with the status', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], statusLabel: 'Something else' }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('44. the guard rejects an execution label that disagrees with the state', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], executionLabel: 'Not executed' }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('45. the guard rejects an executed flag that contradicts the results', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], executed: false }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('46. the guard rejects misaligned provider ids and results', () => {
    const p = presentation();
    const tampered = { ...p, items: [{ ...p.items[0], providerIds: [BETA] }] };
    expect(isTripExecutionHistoryPresentation(tampered)).toBe(false);
  });

  it('47. the guard rejects a provider result missing its status', () => {
    const p = presentation();
    const item = p.items[0];
    const broken = {
      ...item,
      results: [
        { ...item.results[0], result: { providerId: AMADEUS, requestId: REQUEST_ID } },
      ],
    };
    expect(isTripExecutionHistoryPresentation({ ...p, items: [broken] })).toBe(false);
  });

  // --- Defensive copying and immutability ---------------------------------
  it('48. mutating presentation provider ids does not affect the history', () => {
    const history = makeHistory([makeRecord()]);
    const presentationResult = createTripExecutionHistoryPresentation(history);
    presentationResult.items[0].providerIds.push('intruder');
    expect(history.items[0].providerIds).toEqual([AMADEUS]);
  });

  it('49. mutating a nested presentation result does not affect the history', () => {
    const history = makeHistory([makeRecord()]);
    const presentationResult = createTripExecutionHistoryPresentation(history);
    const result = presentationResult.items[0].results[0].result;
    if (result !== null) result.status = 'failed';
    expect(history.items[0].results[0].result?.status).toBe('accepted');
  });

  it('50. mutating the presentation results array does not affect the history', () => {
    const history = makeHistory([makeRecord()]);
    const presentationResult = createTripExecutionHistoryPresentation(history);
    presentationResult.items[0].results.pop();
    expect(history.items[0].results).toHaveLength(1);
  });

  it('51. the input history is not mutated', () => {
    const history = makeHistory([makeRecord()]);
    const snapshot = JSON.parse(JSON.stringify(history));
    createTripExecutionHistoryPresentation(history);
    expect(history).toEqual(snapshot);
  });

  // --- Determinism --------------------------------------------------------
  it('52. identical valid inputs produce equivalent outputs', () => {
    const build = () =>
      makeHistory([
        makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
        makeRecord({
          receiptId: `${RECEIPT_PREFIX}r2`,
          results: [entry(AMADEUS, 'failed')],
          status: 'failed',
        }),
      ]);
    const first = createTripExecutionHistoryPresentation(build());
    const second = createTripExecutionHistoryPresentation(build());
    expect(second).toEqual(first);
  });

  // --- Dependency boundaries ---------------------------------------------
  it('53. has no Firebase or Firestore dependency', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('54. has no repository or listing-service dependency', () => {
    expect(CODE).not.toMatch(/repository|listingService/i);
  });

  it('55. has no network dependency', () => {
    expect(CODE).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });

  it('56. has no UI, state, or router dependency', () => {
    expect(CODE).not.toMatch(/from\s+['"]react|react-router|\bzustand\b|useState|createStore/);
  });

  it('57. has no provider execution or orchestration dependency', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(|executeTripExecution|mockTripExecutionProvider|orchestrat/i);
  });

  it('58. has no browser storage dependency', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('59. has no clock, timing, randomness, or environment access', () => {
    expect(CODE).not.toMatch(
      /\bDate\b|Date\.now\(|new Date\(|Math\.random|randomUUID|performance\.|process\.env|import\.meta\.env|Deno\.env|setTimeout|setInterval/
    );
  });

  it('60. imports only the history contract and the provider-status vocabulary', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual(['./tripExecutionHistory', './tripExecutionProvider']);
  });

  it('61. the fixtures pass the STEP 78 record validator', () => {
    expect(isTripExecutionRecord(makeRecord())).toBe(true);
  });
});
