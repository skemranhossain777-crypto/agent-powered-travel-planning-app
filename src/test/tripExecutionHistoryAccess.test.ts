import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistoryAccess,
  type TripExecutionHistoryAccess,
} from '../services/tripExecution/tripExecutionHistoryAccess';
import {
  createTripExecutionHistoryQueryService,
  type TripExecutionHistoryQueryService,
} from '../services/tripExecution/tripExecutionHistoryQueryService';
import { createTripExecutionHistoryListingService } from '../services/tripExecution/tripExecutionHistoryListingService';
import {
  createTripExecutionHistoryPresentation,
  isTripExecutionHistoryPresentation,
  type TripExecutionHistoryPresentation,
} from '../services/tripExecution/tripExecutionHistoryPresentation';
import { createTripExecutionHistory } from '../services/tripExecution/tripExecutionHistory';
import type { TripExecutionRecordRepository } from '../services/tripExecution/tripExecutionRecordRepository';
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

function presentationFor(records: TripExecutionRecord[]): TripExecutionHistoryPresentation {
  return createTripExecutionHistoryPresentation(createTripExecutionHistory(records));
}

const MODULE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionHistoryAccess.ts'
);
const SOURCE = readFileSync(MODULE_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 89 - Execution History Consumer Access Contract', () => {
  let querySpy: ReturnType<typeof vi.fn>;
  let queryService: TripExecutionHistoryQueryService;
  let access: TripExecutionHistoryAccess;

  beforeEach(() => {
    querySpy = vi.fn().mockResolvedValue(presentationFor([]));
    queryService = { getExecutionHistory: querySpy };
    access = createTripExecutionHistoryAccess(queryService);
  });

  // --- Construction and dependency contract -------------------------------
  it('1. creates the access boundary with a valid query service', () => {
    expect(access).toBeDefined();
  });

  it('2. exposes a getExecutionHistory function', () => {
    expect(typeof access.getExecutionHistory).toBe('function');
  });

  it('3. getExecutionHistory returns a promise', async () => {
    const result = access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('4. rejects a null query service', () => {
    expect(() =>
      createTripExecutionHistoryAccess(null as unknown as TripExecutionHistoryQueryService)
    ).toThrow(TypeError);
  });

  it('5. rejects a non-object query service', () => {
    expect(() =>
      createTripExecutionHistoryAccess(
        'query' as unknown as TripExecutionHistoryQueryService
      )
    ).toThrow(TypeError);
  });

  it('6. rejects a query service missing getExecutionHistory', () => {
    expect(() =>
      createTripExecutionHistoryAccess({} as unknown as TripExecutionHistoryQueryService)
    ).toThrow(TypeError);
  });

  it('7. rejects a query service whose getExecutionHistory is not a function', () => {
    expect(() =>
      createTripExecutionHistoryAccess({
        getExecutionHistory: 'nope',
      } as unknown as TripExecutionHistoryQueryService)
    ).toThrow(TypeError);
  });

  it('8. construction does not invoke the query service', () => {
    expect(querySpy).not.toHaveBeenCalled();
  });

  // --- Exact delegation ---------------------------------------------------
  it('9. delegates each request exactly once', async () => {
    await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('10. forwards the input object unchanged (same reference)', async () => {
    const input = { tripId: TRIP_ID };
    await access.getExecutionHistory(input);
    expect(querySpy.mock.calls[0][0]).toBe(input);
  });

  it('11. forwards the requested trip id value', async () => {
    await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(querySpy).toHaveBeenCalledWith({ tripId: TRIP_ID });
  });

  it('12. forwards a different trip id unchanged', async () => {
    await access.getExecutionHistory({ tripId: OTHER_TRIP_ID });
    expect(querySpy).toHaveBeenCalledWith({ tripId: OTHER_TRIP_ID });
  });

  it('13. delegates every call independently', async () => {
    await access.getExecutionHistory({ tripId: TRIP_ID });
    await access.getExecutionHistory({ tripId: OTHER_TRIP_ID });
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy).toHaveBeenNthCalledWith(1, { tripId: TRIP_ID });
    expect(querySpy).toHaveBeenNthCalledWith(2, { tripId: OTHER_TRIP_ID });
  });

  it('14. returns exactly the query service result (identity preserved)', async () => {
    const presentation = presentationFor([makeRecord()]);
    querySpy.mockResolvedValue(presentation);
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result).toBe(presentation);
  });

  // --- Empty and non-empty results ----------------------------------------
  it('15. an empty query result passes through as an empty presentation', async () => {
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.tripId).toBeNull();
    expect(result.items).toEqual([]);
  });

  it('16. the empty presentation remains valid', async () => {
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(isTripExecutionHistoryPresentation(result)).toBe(true);
  });

  it('17. a one-record presentation passes through', async () => {
    querySpy.mockResolvedValue(presentationFor([makeRecord()]));
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items).toHaveLength(1);
  });

  it('18. a multi-record presentation passes through', async () => {
    querySpy.mockResolvedValue(
      presentationFor([
        makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
        makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
      ])
    );
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items).toHaveLength(2);
  });

  // --- Identity and ordering ----------------------------------------------
  it('19. the trip identity is preserved', async () => {
    querySpy.mockResolvedValue(presentationFor([makeRecord()]));
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.tripId).toBe(TRIP_ID);
  });

  it('20. the presentation item order is preserved', async () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}b` });
    const third = makeRecord({ receiptId: `${RECEIPT_PREFIX}c` });
    querySpy.mockResolvedValue(presentationFor([first, second, third]));
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  it('21. record, receipt, and request identities are preserved', async () => {
    const record = makeRecord();
    querySpy.mockResolvedValue(presentationFor([record]));
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.id).toBe(record.id);
    expect(item.receiptId).toBe(record.receiptId);
    expect(item.requestId).toBe(record.requestId);
  });

  // --- Provider attribution and results -----------------------------------
  it('22. provider attribution is preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([
        makeRecord({
          providerIds: [AMADEUS, BETA],
          results: [entry(AMADEUS, 'accepted'), entry(BETA, 'failed')],
          status: 'accepted',
        }),
      ])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.providerIds).toEqual([AMADEUS, BETA]);
  });

  it('23. provider results are preserved', async () => {
    const record = makeRecord({
      providerIds: [AMADEUS, BETA],
      results: [entry(AMADEUS, 'accepted'), entry(BETA, 'failed')],
      status: 'accepted',
    });
    querySpy.mockResolvedValue(presentationFor([record]));
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.results).toEqual(record.results);
  });

  it('24. a null provider result is preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [unanswered(AMADEUS)], status: null })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.results[0].result).toBeNull();
  });

  // --- Statuses and labels ------------------------------------------------
  it('25. an accepted status and label are preserved', async () => {
    querySpy.mockResolvedValue(presentationFor([makeRecord({ status: 'accepted' })]));
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('accepted');
    expect(item.statusLabel).toBe('Accepted (provider response)');
  });

  it('26. a rejected status and label are preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [entry(AMADEUS, 'rejected')], status: 'rejected' })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('rejected');
    expect(item.statusLabel).toBe('Rejected (provider response)');
  });

  it('27. an unsupported status and label are preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([
        makeRecord({ results: [entry(AMADEUS, 'unsupported')], status: 'unsupported' }),
      ])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('unsupported');
    expect(item.statusLabel).toBe('Unsupported (provider response)');
  });

  it('28. a failed status and label are preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [entry(AMADEUS, 'failed')], status: 'failed' })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('failed');
    expect(item.statusLabel).toBe('Failed (provider response)');
  });

  it('29. a null aggregate status and neutral label are preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [], providerIds: [], executed: false, status: null })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBeNull();
    expect(item.statusLabel).toBe('No provider response');
  });

  it('30. executed true and its label are preserved', async () => {
    querySpy.mockResolvedValue(presentationFor([makeRecord()]));
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executed).toBe(true);
    expect(item.executionLabel).toBe('Execution attempted');
  });

  it('31. executed false and its label are preserved', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [], providerIds: [], executed: false, status: null })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executed).toBe(false);
    expect(item.executionLabel).toBe('Not executed');
  });

  it('32. an attempted execution with no provider answer preserves both labels', async () => {
    querySpy.mockResolvedValue(
      presentationFor([makeRecord({ results: [unanswered(AMADEUS)], status: null })])
    );
    const item = (await access.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executionLabel).toBe('Execution attempted');
    expect(item.statusLabel).toBe('No provider response');
  });

  // --- Error propagation --------------------------------------------------
  it('33. a query rejection propagates unchanged', async () => {
    const err = new Error('query-failure');
    querySpy.mockRejectedValueOnce(err);
    await expect(access.getExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(err);
  });

  it('34. a validation rejection from the real query service propagates', async () => {
    const listByTripId = vi.fn().mockResolvedValue([]);
    const repository: TripExecutionRecordRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId,
    };
    const realQuery = createTripExecutionHistoryQueryService(
      createTripExecutionHistoryListingService(repository)
    );
    const realAccess = createTripExecutionHistoryAccess(realQuery);
    await expect(realAccess.getExecutionHistory({ tripId: '' })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('35. a real query service end-to-end result passes through', async () => {
    const listByTripId = vi.fn().mockResolvedValue([makeRecord()]);
    const repository: TripExecutionRecordRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId,
    };
    const realAccess = createTripExecutionHistoryAccess(
      createTripExecutionHistoryQueryService(
        createTripExecutionHistoryListingService(repository)
      )
    );
    const result = await realAccess.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.tripId).toBe(TRIP_ID);
    expect(result.items).toHaveLength(1);
    expect(listByTripId).toHaveBeenCalledTimes(1);
  });

  // --- Immutability and determinism ---------------------------------------
  it('36. the input is not mutated', async () => {
    const input = { tripId: TRIP_ID };
    const snapshot = { ...input };
    await access.getExecutionHistory(input);
    expect(input).toEqual(snapshot);
  });

  it('37. the access boundary does not alter the returned presentation', async () => {
    const presentation = presentationFor([makeRecord()]);
    const snapshot = JSON.parse(JSON.stringify(presentation));
    querySpy.mockResolvedValue(presentation);
    const result = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(result).toEqual(snapshot);
  });

  it('38. repeated identical requests return the query result each time', async () => {
    const presentation = presentationFor([makeRecord()]);
    querySpy.mockResolvedValue(presentation);
    const first = await access.getExecutionHistory({ tripId: TRIP_ID });
    const second = await access.getExecutionHistory({ tripId: TRIP_ID });
    expect(first).toBe(presentation);
    expect(second).toBe(presentation);
    expect(querySpy).toHaveBeenCalledTimes(2);
  });

  it('39. two independent accesses delegate deterministically', async () => {
    const presentation = presentationFor([makeRecord()]);
    querySpy.mockResolvedValue(presentation);
    const first = await access.getExecutionHistory({ tripId: TRIP_ID });
    const second = await createTripExecutionHistoryAccess(queryService).getExecutionHistory({
      tripId: TRIP_ID,
    });
    expect(second).toEqual(first);
  });

  // --- Dependency boundaries ---------------------------------------------
  it('40. has no Firebase or Firestore dependency', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('41. has no repository or listing-service dependency', () => {
    expect(CODE).not.toMatch(
      /repository|listing|listByTripId|\.getById\b|\.save\b|tripExecutionRecordRepository|tripExecutionHistoryListingService/i
    );
  });

  it('42. has no network dependency', () => {
    expect(CODE).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });

  it('43. has no UI, state, or router dependency', () => {
    expect(CODE).not.toMatch(/from\s+['"]react|react-router|\bzustand\b|useState|createStore/);
  });

  it('44. has no provider execution or orchestration dependency', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(|executeTripExecution|mockTripExecutionProvider|orchestrat/i);
  });

  it('45. has no browser storage dependency', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('46. has no clock, timing, randomness, or environment access', () => {
    expect(CODE).not.toMatch(
      /\bDate\b|Date\.now\(|new Date\(|Math\.random|randomUUID|performance\.|process\.env|import\.meta\.env|Deno\.env|setTimeout|setInterval/
    );
  });

  it('47. imports only the query-service contract and the presentation type', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual([
      './tripExecutionHistoryPresentation',
      './tripExecutionHistoryQueryService',
    ]);
  });

  it('48. adds no sorting, filtering, caching, retries, logging, or side effects', () => {
    expect(CODE).not.toMatch(
      /\.sort\(|\.filter\(|\.reverse\(|\.reduce\(|\bcache\b|retry|console\./
    );
  });

  it('49. the fixtures pass the STEP 78 record validator', () => {
    expect(isTripExecutionRecord(makeRecord())).toBe(true);
  });
});
