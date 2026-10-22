import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistoryComposition,
} from '../services/tripExecution/tripExecutionHistoryComposition';
import type { TripExecutionHistoryConsumer } from '../services/tripExecution/tripExecutionHistoryConsumer';
import { createTripExecutionHistoryConsumer } from '../services/tripExecution/tripExecutionHistoryConsumer';
import { isTripExecutionHistoryPresentation } from '../services/tripExecution/tripExecutionHistoryPresentation';
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

const MODULE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionHistoryComposition.ts'
);
const SOURCE = readFileSync(MODULE_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 91 - Trip Execution History Composition Factory', () => {
  let listByTripId: ReturnType<typeof vi.fn>;
  let repository: TripExecutionRecordRepository;
  let consumer: TripExecutionHistoryConsumer;

  beforeEach(() => {
    listByTripId = vi.fn().mockResolvedValue([]);
    repository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId,
    };
  });

  // --- Construction and public API shape ---------------------------------
  it('1. creates a consumer from a valid repository', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    expect(consumer).toBeDefined();
  });

  it('2. exposes a single getExecutionHistory function', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    expect(typeof consumer.getExecutionHistory).toBe('function');
    expect(Object.keys(consumer).length).toBe(1);
  });

  it('3. satisfies the TripExecutionHistoryConsumer contract', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    // Wrapping in the Step 90 factory must succeed without throwing and the
    // wrapped result must still serve the same history operation.
    const wrapped = createTripExecutionHistoryConsumer(consumer);
    expect(typeof wrapped.getExecutionHistory).toBe('function');
    expect(typeof consumer.getExecutionHistory).toBe('function');
  });

  it('4. does not expose internal pipeline stages (listing/query/access)', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    const keys = Object.keys(consumer);
    expect(keys).toEqual(['getExecutionHistory']);
    // Check for no internal service properties
    expect('listingService' in consumer).toBe(false);
    expect('queryService' in consumer).toBe(false);
    expect('access' in consumer).toBe(false);
    expect('repository' in consumer).toBe(false);
  });

  // --- No repository reads during construction ----------------------------
  it('5. does not call repository.listByTripId during construction', () => {
    createTripExecutionHistoryComposition(repository);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('6. does not call repository.save during construction', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const repo: TripExecutionRecordRepository = {
      save,
      getById: vi.fn().mockResolvedValue(null),
      listByTripId: vi.fn().mockResolvedValue([]),
    };
    createTripExecutionHistoryComposition(repo);
    expect(save).not.toHaveBeenCalled();
  });

  it('7. does not call repository.getById during construction', () => {
    const getById = vi.fn().mockResolvedValue(null);
    const repo: TripExecutionRecordRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById,
      listByTripId: vi.fn().mockResolvedValue([]),
    };
    createTripExecutionHistoryComposition(repo);
    expect(getById).not.toHaveBeenCalled();
  });

  // --- Dependency construction and invalid dependencies -------------------
  it('8. rejects null repository', () => {
    expect(() => createTripExecutionHistoryComposition(null as never)).toThrow(TypeError);
  });

  it('9. rejects undefined repository', () => {
    expect(() => createTripExecutionHistoryComposition(undefined as never)).toThrow(TypeError);
  });

  it('10. rejects repository missing listByTripId', () => {
    const badRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
    } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryComposition(badRepo)).toThrow(TypeError);
  });

  it('11. accepts a repository without save (history read path only needs listByTripId)', () => {
    // Step 86's validation checks only listByTripId, which is the sole method
    // the execution-history read path uses. Preserve that existing behavior.
    const repo = {
      getById: vi.fn().mockResolvedValue(null),
      listByTripId: vi.fn().mockResolvedValue([]),
    } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryComposition(repo)).not.toThrow();
  });

  it('12. accepts a repository without getById (history read path only needs listByTripId)', () => {
    const repo = {
      save: vi.fn().mockResolvedValue(undefined),
      listByTripId: vi.fn().mockResolvedValue([]),
    } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryComposition(repo)).not.toThrow();
  });

  it('13. rejects non-object repository', () => {
    expect(() => createTripExecutionHistoryComposition('bad' as never)).toThrow(TypeError);
    expect(() => createTripExecutionHistoryComposition(123 as never)).toThrow(TypeError);
    expect(() => createTripExecutionHistoryComposition(true as never)).toThrow(TypeError);
  });

  it('14. accepts repository with extra properties', () => {
    const repo = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId: vi.fn().mockResolvedValue([]),
      extra: () => {},
    } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionHistoryComposition(repo)).not.toThrow();
  });

  // --- Valid history requests ---------------------------------------------
  it('15. returns empty history when repository returns empty array', async () => {
    listByTripId.mockResolvedValue([]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(isTripExecutionHistoryPresentation(result)).toBe(true);
    expect(result.tripId).toBeNull();
    expect(result.items).toEqual([]);
    expect(listByTripId).toHaveBeenCalledTimes(1);
    expect(listByTripId).toHaveBeenCalledWith(TRIP_ID);
  });

  it('16. makes exactly one repository listing call for valid request', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(listByTripId).toHaveBeenCalledTimes(1);
    expect(listByTripId).toHaveBeenCalledWith(TRIP_ID);
  });

  it('17. preserves single record and its values', async () => {
    const record = makeRecord({ status: 'accepted', receiptId: `${RECEIPT_PREFIX}receipt-001` });
    expect(isTripExecutionRecord(record)).toBe(true);
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(isTripExecutionHistoryPresentation(result)).toBe(true);
    expect(result.tripId).toBe(TRIP_ID);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(record.id);
    expect(result.items[0].receiptId).toBe(record.receiptId);
    expect(result.items[0].requestId).toBe(record.requestId);
    expect(result.items[0].providerIds).toEqual(record.providerIds);
    expect(result.items[0].executed).toBe(record.executed);
    expect(result.items[0].status).toBe(record.status);
  });

  it('18. preserves multiple records in repository order', async () => {
    const r1 = makeRecord({ receiptId: `${RECEIPT_PREFIX}receipt-001`, providerIds: [AMADEUS], results: [entry(AMADEUS, 'accepted')], status: 'accepted' });
    const r2 = makeRecord({ receiptId: `${RECEIPT_PREFIX}receipt-002`, providerIds: [BETA], results: [entry(BETA, 'rejected')], status: 'rejected' });
    const r3 = makeRecord({ receiptId: `${RECEIPT_PREFIX}receipt-003`, providerIds: [AMADEUS, BETA], results: [entry(AMADEUS, 'accepted'), entry(BETA, 'unsupported')], status: 'unsupported' });
    listByTripId.mockResolvedValue([r1, r2, r3]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items).toHaveLength(3);
    expect(result.items[0].receiptId).toBe(r1.receiptId);
    expect(result.items[1].receiptId).toBe(r2.receiptId);
    expect(result.items[2].receiptId).toBe(r3.receiptId);
    expect(result.items[0].status).toBe('accepted');
    expect(result.items[1].status).toBe('rejected');
    expect(result.items[2].status).toBe('unsupported');
  });

  it('19. preserves status null when no provider answered', async () => {
    const record = makeRecord({
      providerIds: [AMADEUS],
      results: [unanswered(AMADEUS)],
      executed: true,
      status: null,
    });
    expect(isTripExecutionRecord(record)).toBe(true);
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items[0].status).toBeNull();
    expect(result.items[0].executed).toBe(true);
    expect(result.items[0].statusLabel).toBe('No provider response');
    expect(result.items[0].executionLabel).toBe('Execution attempted');
  });

  it('20. preserves executed=false records with empty results', async () => {
    const record = makeRecord({
      providerIds: [],
      results: [],
      executed: false,
      status: null,
    });
    expect(isTripExecutionRecord(record)).toBe(true);
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items[0].executed).toBe(false);
    expect(result.items[0].status).toBeNull();
    expect(result.items[0].executionLabel).toBe('Not executed');
  });

  it('21. preserves all status values and their labels', async () => {
    const statuses: ProviderStatus[] = ['accepted', 'rejected', 'unsupported', 'failed'];
    const expectedLabels: Record<string, string> = {
      accepted: 'Accepted (provider response)',
      rejected: 'Rejected (provider response)',
      unsupported: 'Unsupported (provider response)',
      failed: 'Failed (provider response)',
    };
    const records = statuses.map((status, index) =>
      makeRecord({
        receiptId: `${RECEIPT_PREFIX}receipt-${String(index)}`,
        providerIds: [AMADEUS],
        results: [entry(AMADEUS, status)],
        status,
      })
    );
    listByTripId.mockResolvedValue(records);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items).toHaveLength(4);
    for (let i = 0; i < statuses.length; i++) {
      expect(result.items[i].status).toBe(statuses[i]);
      expect(result.items[i].statusLabel).toBe(expectedLabels[statuses[i]]);
    }
  });

  it('22. preserves provider ids and provider results verbatim', async () => {
    const results = [entry(AMADEUS, 'accepted'), entry(BETA, 'rejected')];
    const record = makeRecord({ providerIds: [AMADEUS, BETA], results, status: 'accepted' });
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items[0].providerIds).toEqual([AMADEUS, BETA]);
    expect(result.items[0].results).toEqual(results);
    expect(result.items[0].results[0].result).toEqual({
      providerId: AMADEUS,
      requestId: REQUEST_ID,
      status: 'accepted',
    });
    expect(result.items[0].results[1].result).toEqual({
      providerId: BETA,
      requestId: REQUEST_ID,
      status: 'rejected',
    });
  });

  it('23. preserves mixed answered and unanswered provider results', async () => {
    const results = [entry(AMADEUS, 'accepted'), unanswered(BETA)];
    const record = makeRecord({ providerIds: [AMADEUS, BETA], results, status: 'accepted' });
    expect(isTripExecutionRecord(record)).toBe(true);
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(result.items[0].results[0].result).not.toBeNull();
    expect(result.items[0].results[1].result).toBeNull();
    expect(result.items[0].results[1].reason).toBe('provider-execution-failed');
  });

  it('24. returns defensive copies: mutating the result does not affect a later request', async () => {
    const record = makeRecord({ providerIds: [AMADEUS], results: [entry(AMADEUS, 'accepted')] });
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    const first = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    first.items[0].providerIds.push('mutated-provider');
    (first.items[0].results[0] as { reason: string }).reason = 'mutated';
    const second = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(second.items[0].providerIds).toEqual([AMADEUS]);
    expect(second.items[0].results[0].reason).toBe('executed');
  });

  // --- Invalid trip IDs and invalid inputs --------------------------------
  it('25. rejects an empty trip id', async () => {
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: '' })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('26. rejects a whitespace-padded trip id', async () => {
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: ` ${TRIP_ID} ` })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('27. rejects a non-string trip id', async () => {
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: 42 })).rejects.toThrow(TypeError);
    await expect(consumer.getExecutionHistory({ tripId: null })).rejects.toThrow(TypeError);
    await expect(consumer.getExecutionHistory({ tripId: { id: TRIP_ID } })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('28. rejects a missing trip id', async () => {
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({})).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('29. rejects non-object input', async () => {
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory(null)).rejects.toThrow(TypeError);
    await expect(consumer.getExecutionHistory(undefined)).rejects.toThrow(TypeError);
    await expect(consumer.getExecutionHistory('trip-001')).rejects.toThrow(TypeError);
    await expect(consumer.getExecutionHistory([])).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  // --- Malformed records and mixed-trip records ---------------------------
  it('30. rejects malformed records from the repository', async () => {
    listByTripId.mockResolvedValue([{ not: 'a record' }]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('31. rejects records with a wrong deterministic id', async () => {
    const record = { ...makeRecord(), id: 'trip-execution-record:wrong:receipt' };
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('32. rejects records with a wrong kind', async () => {
    const record = { ...makeRecord(), kind: 'wrong-kind' } as unknown as TripExecutionRecord;
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('33. rejects mixed-trip records', async () => {
    const r1 = makeRecord({ tripId: TRIP_ID, receiptId: `${RECEIPT_PREFIX}receipt-001` });
    const r2 = makeRecord({ tripId: OTHER_TRIP_ID, receiptId: `${RECEIPT_PREFIX}receipt-002` });
    listByTripId.mockResolvedValue([r1, r2]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('34. rejects repository records for a different trip than requested', async () => {
    const record = makeRecord({ tripId: OTHER_TRIP_ID });
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(
      /trip mismatch/
    );
  });

  it('35. rejects records with an unknown status value', async () => {
    const record = {
      ...makeRecord(),
      status: 'completed',
    } as unknown as TripExecutionRecord;
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('36. rejects records where providerIds and results are misaligned', async () => {
    const record = {
      ...makeRecord(),
      providerIds: [AMADEUS, BETA],
      results: [entry(AMADEUS, 'accepted')],
      executed: true,
    } as unknown as TripExecutionRecord;
    listByTripId.mockResolvedValue([record]);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  // --- Repository rejection and error propagation -------------------------
  it('37. propagates a repository rejection as-is', async () => {
    const failure = new Error('repository unavailable');
    listByTripId.mockRejectedValue(failure);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(failure);
  });

  it('38. propagates a repository TypeError as-is', async () => {
    const failure = new TypeError('persistence failure');
    listByTripId.mockRejectedValue(failure);
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(failure);
  });

  it('39. does not convert a repository failure into an empty history', async () => {
    listByTripId.mockRejectedValue(new Error('boom'));
    consumer = createTripExecutionHistoryComposition(repository);
    const result = await consumer.getExecutionHistory({ tripId: TRIP_ID }).catch(() => null);
    expect(result).toBeNull();
  });

  // --- Repeated independent requests --------------------------------------
  it('40. repeated requests each hit the repository independently', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    consumer = createTripExecutionHistoryComposition(repository);
    await consumer.getExecutionHistory({ tripId: TRIP_ID });
    await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(listByTripId).toHaveBeenCalledTimes(2);
  });

  it('41. repeated requests return independent presentations', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    consumer = createTripExecutionHistoryComposition(repository);
    const a = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    const b = await consumer.getExecutionHistory({ tripId: TRIP_ID });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.items[0]).not.toBe(b.items[0]);
  });

  it('42. independent consumers over separate repositories do not share state', async () => {
    const repoA: TripExecutionRecordRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId: vi.fn().mockResolvedValue([makeRecord({ receiptId: `${RECEIPT_PREFIX}receipt-a` })]),
    };
    const repoB: TripExecutionRecordRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId: vi
        .fn()
        .mockResolvedValue([makeRecord({ receiptId: `${RECEIPT_PREFIX}receipt-b` })]),
    };
    const consumerA = createTripExecutionHistoryComposition(repoA);
    const consumerB = createTripExecutionHistoryComposition(repoB);
    const resultA = await consumerA.getExecutionHistory({ tripId: TRIP_ID });
    const resultB = await consumerB.getExecutionHistory({ tripId: TRIP_ID });
    expect(resultA.items[0].receiptId).toBe(`${RECEIPT_PREFIX}receipt-a`);
    expect(resultB.items[0].receiptId).toBe(`${RECEIPT_PREFIX}receipt-b`);
  });

  // --- Public API isolation ------------------------------------------------
  it('43. does not expose listExecutionHistory, save, or getById operations', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    expect('listExecutionHistory' in consumer).toBe(false);
    expect('save' in consumer).toBe(false);
    expect('getById' in consumer).toBe(false);
    expect('listByTripId' in consumer).toBe(false);
  });

  it('44. getExecutionHistory is the only own enumerable property', () => {
    consumer = createTripExecutionHistoryComposition(repository);
    const descriptors = Object.getOwnPropertyDescriptors(consumer);
    expect(Object.keys(descriptors)).toEqual(['getExecutionHistory']);
  });

  // --- Determinism and side-effect freedom at construction -----------------
  it('45. source does not import Firebase or Firestore', () => {
    expect(CODE).not.toMatch(/firebase/i);
    expect(CODE).not.toMatch(/firestore/i);
  });

  it('46. source wires the four factories in the documented order', () => {
    const listingIndex = CODE.indexOf('createTripExecutionHistoryListingService');
    const queryIndex = CODE.indexOf('createTripExecutionHistoryQueryService');
    const accessIndex = CODE.indexOf('createTripExecutionHistoryAccess');
    const consumerIndex = CODE.indexOf('createTripExecutionHistoryConsumer');
    expect(listingIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(listingIndex);
    expect(accessIndex).toBeGreaterThan(queryIndex);
    expect(consumerIndex).toBeGreaterThan(accessIndex);
  });

  it('47. composition is deterministic: two constructions behave identically', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    const c1 = createTripExecutionHistoryComposition(repository);
    const c2 = createTripExecutionHistoryComposition(repository);
    const r1 = await c1.getExecutionHistory({ tripId: TRIP_ID });
    const r2 = await c2.getExecutionHistory({ tripId: TRIP_ID });
    expect(r1).toEqual(r2);
    expect(isTripExecutionHistoryPresentation(r1)).toBe(true);
  });

  it('48. does not retry a failed repository call', async () => {
    listByTripId.mockRejectedValue(new Error('boom'));
    consumer = createTripExecutionHistoryComposition(repository);
    await expect(consumer.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow('boom');
    expect(listByTripId).toHaveBeenCalledTimes(1);
  });
});
