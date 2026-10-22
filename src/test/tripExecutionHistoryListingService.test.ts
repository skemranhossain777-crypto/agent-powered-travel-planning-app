import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistoryListingService,
  type TripExecutionHistoryListingService,
} from '../services/tripExecution/tripExecutionHistoryListingService';
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

type ProviderStatus = TripExecutionProviderResultStatus;

/** A canonical STEP 59 provider result as produced by the execution chain. */
function entry(providerId: string, status: ProviderStatus): TripExecutionAuthorizedExecutionResult {
  return {
    executed: true,
    result: { providerId, requestId: REQUEST_ID, status },
    requestId: REQUEST_ID,
    providerId,
    reason: 'executed',
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

/**
 * Builds a structurally valid STEP 78 record accepted by `isTripExecutionRecord`:
 * the deterministic id derives from the trip and receipt, provider ids align
 * with the results, and `executed` agrees with whether any provider answered.
 */
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

const SERVICE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionHistoryListingService.ts'
);
const SOURCE = readFileSync(SERVICE_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 86 - Trip Execution History Listing Service', () => {
  let listByTripId: ReturnType<typeof vi.fn>;
  let repository: TripExecutionRecordRepository;
  let service: TripExecutionHistoryListingService;

  beforeEach(() => {
    listByTripId = vi.fn().mockResolvedValue([]);
    repository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId,
    };
  });

  // --- Construction and repository contract -------------------------------
  it('1. creates the service with a valid repository', () => {
    service = createTripExecutionHistoryListingService(repository);
    expect(service).toBeDefined();
  });

  it('2. exposes a listExecutionHistory function', () => {
    service = createTripExecutionHistoryListingService(repository);
    expect(typeof service.listExecutionHistory).toBe('function');
  });

  it('3. accepts a repository that exposes only listByTripId', () => {
    const partial = { listByTripId } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryListingService(partial)).not.toThrow();
  });

  it('4. rejects a null repository', () => {
    expect(() =>
      createTripExecutionHistoryListingService(
        null as unknown as TripExecutionRecordRepository
      )
    ).toThrow(TypeError);
  });

  it('5. rejects a non-object repository', () => {
    expect(() =>
      createTripExecutionHistoryListingService(
        'repository' as unknown as TripExecutionRecordRepository
      )
    ).toThrow(TypeError);
  });

  it('6. rejects a repository missing listByTripId', () => {
    const bad = { save: vi.fn(), getById: vi.fn() } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryListingService(bad)).toThrow(TypeError);
  });

  it('7. rejects a repository whose listByTripId is not a function', () => {
    const bad = { listByTripId: 'nope' } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryListingService(bad)).toThrow(TypeError);
  });

  it('8. construction does not invoke the repository', () => {
    createTripExecutionHistoryListingService(repository);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  // --- Input validation ---------------------------------------------------
  it('9. a valid trip id resolves to a history', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.kind).toBe('trip-execution-history');
    expect(history.tripId).toBe(TRIP_ID);
  });

  it('10. rejects a null input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory(null)).rejects.toThrow(TypeError);
  });

  it('11. rejects a string input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory('trip-001')).rejects.toThrow(TypeError);
  });

  it('12. rejects a non-array primitive input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory(42)).rejects.toThrow(TypeError);
  });

  it('13. rejects an array input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory([TRIP_ID])).rejects.toThrow(TypeError);
  });

  it('14. rejects input missing tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({})).rejects.toThrow(TypeError);
  });

  it('15. rejects a non-string tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: 123 })).rejects.toThrow(TypeError);
  });

  it('16. rejects an empty tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: '' })).rejects.toThrow(TypeError);
  });

  it('17. rejects a padded tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: ` ${TRIP_ID} ` })).rejects.toThrow(
      TypeError
    );
  });

  it('18. rejects a "." tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: '.' })).rejects.toThrow(TypeError);
  });

  it('19. rejects a ".." tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: '..' })).rejects.toThrow(TypeError);
  });

  it('20. rejects a tripId containing a slash', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: 'trip/001' })).rejects.toThrow(TypeError);
  });

  it('21. rejects an overlong tripId', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: 'a'.repeat(1501) })).rejects.toThrow(
      TypeError
    );
  });

  it('22. no repository call is made for any invalid input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    const invalid = [null, 'x', 42, [], {}, { tripId: 1 }, { tripId: '' }, { tripId: '.' }];
    for (const input of invalid) {
      await expect(service.listExecutionHistory(input)).rejects.toThrow(TypeError);
    }
    expect(listByTripId).not.toHaveBeenCalled();
  });

  // --- Repository invocation ---------------------------------------------
  it('23. calls listByTripId with the requested trip id', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(listByTripId).toHaveBeenCalledWith(TRIP_ID);
  });

  it('24. calls listByTripId exactly once', async () => {
    service = createTripExecutionHistoryListingService(repository);
    await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(listByTripId).toHaveBeenCalledTimes(1);
  });

  it('25. forwards a different trip id unchanged', async () => {
    listByTripId.mockResolvedValue([makeRecord({ tripId: OTHER_TRIP_ID })]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: OTHER_TRIP_ID });
    expect(listByTripId).toHaveBeenCalledWith(OTHER_TRIP_ID);
    expect(history.tripId).toBe(OTHER_TRIP_ID);
  });

  // --- Empty, single and multi-record histories ---------------------------
  it('26. an empty repository result yields an empty history', async () => {
    listByTripId.mockResolvedValue([]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.kind).toBe('trip-execution-history');
    expect(history.tripId).toBeNull();
    expect(history.items).toEqual([]);
  });

  it('27. one record yields exactly one item', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items).toHaveLength(1);
  });

  it('28. the item carries the projected record fields', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    const item = history.items[0];
    expect(item.kind).toBe('trip-execution-history-item');
    expect(item.id).toBe(record.id);
    expect(item.tripId).toBe(record.tripId);
    expect(item.receiptId).toBe(record.receiptId);
    expect(item.requestId).toBe(record.requestId);
    expect(item.providerIds).toEqual(record.providerIds);
    expect(item.results).toEqual(record.results);
    expect(item.executed).toBe(record.executed);
    expect(item.status).toBe(record.status);
  });

  it('29. two records yield two items', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
    ]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items).toHaveLength(2);
  });

  it('30. three records yield three items', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r3` }),
    ]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items).toHaveLength(3);
  });

  // --- Order preservation -------------------------------------------------
  it('31. preserves the repository order exactly', async () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}b` });
    const third = makeRecord({ receiptId: `${RECEIPT_PREFIX}c` });
    listByTripId.mockResolvedValue([first, second, third]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  it('32. does not sort by receipt id', async () => {
    const later = makeRecord({ receiptId: `${RECEIPT_PREFIX}z` });
    const earlier = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    listByTripId.mockResolvedValue([later, earlier]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items.map((item) => item.id)).toEqual([later.id, earlier.id]);
  });

  it('33. does not reverse the repository order', async () => {
    const records = [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r3` }),
    ];
    listByTripId.mockResolvedValue(records);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items[0].id).toBe(records[0].id);
    expect(history.items[2].id).toBe(records[2].id);
  });

  it('34. does not deduplicate identical records', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record, record]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items).toHaveLength(2);
    expect(history.items[0].id).toBe(history.items[1].id);
  });

  it('35. does not group records that share a request id', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}one` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}two` }),
    ]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.items).toHaveLength(2);
    expect(history.items[0].requestId).toBe(history.items[1].requestId);
  });

  // --- Same-trip enforcement ---------------------------------------------
  it('36. accepts multiple records that share one trip', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
    ]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history.tripId).toBe(TRIP_ID);
  });

  it('37. rejects mixed-trip records returned by the repository', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ tripId: OTHER_TRIP_ID, receiptId: `${RECEIPT_PREFIX}r2` }),
    ]);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('38. rejects records that belong to a different trip than requested', async () => {
    listByTripId.mockResolvedValue([makeRecord({ tripId: OTHER_TRIP_ID })]);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  // --- Malformed repository results --------------------------------------
  it('39. rejects a non-array repository result', async () => {
    listByTripId.mockResolvedValue({});
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('40. rejects a null repository result', async () => {
    listByTripId.mockResolvedValue(null);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('41. rejects an array containing a malformed record', async () => {
    listByTripId.mockResolvedValue([{ bad: true }]);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('42. rejects an array containing a non-object element', async () => {
    listByTripId.mockResolvedValue(['not-a-record']);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('43. rejects an array containing a wrong-kind record', async () => {
    const bad = { ...makeRecord(), kind: 'other-kind' };
    listByTripId.mockResolvedValue([bad]);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  // --- Error propagation --------------------------------------------------
  it('44. propagates a repository rejection without wrapping it', async () => {
    const err = new Error('repository-failure');
    listByTripId.mockRejectedValueOnce(err);
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(err);
  });

  it('45. a repository rejection never resolves to an empty history', async () => {
    listByTripId.mockRejectedValueOnce(new Error('repository-failure'));
    service = createTripExecutionHistoryListingService(repository);
    await expect(service.listExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(
      'repository-failure'
    );
  });

  // --- Immutability -------------------------------------------------------
  it('46. does not mutate the input', async () => {
    service = createTripExecutionHistoryListingService(repository);
    const input = { tripId: TRIP_ID };
    const copy = { ...input };
    await service.listExecutionHistory(input);
    expect(input).toEqual(copy);
  });

  it('47. the returned history does not alias the repository array', async () => {
    const records = [makeRecord()];
    listByTripId.mockResolvedValue(records);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(history).not.toBe(records);
    expect(history.items).not.toBe(records);
  });

  it('48. mutating returned provider ids does not affect the record', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    history.items[0].providerIds.push('intruder');
    expect(record.providerIds).toEqual([AMADEUS]);
  });

  it('49. mutating a returned result entry does not affect the record', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    history.items[0].results[0].executed = false;
    expect(record.results[0].executed).toBe(true);
  });

  it('50. mutating the record after listing does not affect the history', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    service = createTripExecutionHistoryListingService(repository);
    const history = await service.listExecutionHistory({ tripId: TRIP_ID });
    record.results.pop();
    record.providerIds.push('later');
    expect(history.items[0].results).toHaveLength(1);
    expect(history.items[0].providerIds).toEqual([AMADEUS]);
  });

  // --- Determinism --------------------------------------------------------
  it('51. produces deterministic output for identical input', async () => {
    const build = () => [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
    ];
    listByTripId.mockImplementation(async () => build());
    service = createTripExecutionHistoryListingService(repository);
    const first = await service.listExecutionHistory({ tripId: TRIP_ID });
    const second = await service.listExecutionHistory({ tripId: TRIP_ID });
    expect(second).toEqual(first);
  });

  // --- Dependency boundaries ---------------------------------------------
  it('52. has no Firebase or Firestore dependency', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('53. has no network dependency', () => {
    expect(CODE).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });

  it('54. has no UI, state, or router dependency', () => {
    expect(CODE).not.toMatch(/from\s+['"]react|react-router|\bzustand\b|useState|createStore/);
  });

  it('55. has no provider execution or orchestration dependency', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(|executeTripExecution|mockTripExecutionProvider|orchestrat/i);
  });

  it('56. has no browser storage dependency', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('57. imports only the storage validator, the history factory, and the repository contract', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual([
      '../../services/tripSerialization',
      './tripExecutionHistory',
      './tripExecutionRecordRepository',
    ]);
  });

  it('58. has no environment access', () => {
    expect(CODE).not.toMatch(/process\.env|import\.meta\.env|Deno\.env/);
  });

  it('59. has no caching, retry, or timing primitives', () => {
    expect(CODE).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|retry|\.cache\b|\bMap\(|\bSet\(/);
  });

  it('60. the fixture passes the STEP 78 record validator', () => {
    expect(isTripExecutionRecord(makeRecord())).toBe(true);
    expect(isTripExecutionRecord(makeRecord({ tripId: OTHER_TRIP_ID }))).toBe(true);
  });
});
