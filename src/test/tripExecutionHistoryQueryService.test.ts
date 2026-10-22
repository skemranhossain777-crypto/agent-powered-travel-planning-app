import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionHistoryQueryService,
  type TripExecutionHistoryQueryService,
} from '../services/tripExecution/tripExecutionHistoryQueryService';
import {
  createTripExecutionHistoryListingService,
  type TripExecutionHistoryListingService,
} from '../services/tripExecution/tripExecutionHistoryListingService';
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
  'src/services/tripExecution/tripExecutionHistoryQueryService.ts'
);
const SOURCE = readFileSync(MODULE_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('STEP 88 - Read-Only Execution History Query Service', () => {
  let listByTripId: ReturnType<typeof vi.fn>;
  let repository: TripExecutionRecordRepository;
  let innerListing: TripExecutionHistoryListingService;
  let listingSpy: ReturnType<typeof vi.fn>;
  let listing: TripExecutionHistoryListingService;
  let service: TripExecutionHistoryQueryService;

  beforeEach(() => {
    listByTripId = vi.fn().mockResolvedValue([]);
    repository = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      listByTripId,
    };
    // A real STEP 86 listing service wrapped in a spy, so delegation and the
    // listing's own trip-id validation are exercised end to end.
    innerListing = createTripExecutionHistoryListingService(repository);
    listingSpy = vi.fn((input: unknown) => innerListing.listExecutionHistory(input));
    listing = { listExecutionHistory: listingSpy };
    service = createTripExecutionHistoryQueryService(listing);
  });

  // --- Construction and dependency contract -------------------------------
  it('1. creates the service with a valid listing service', () => {
    expect(service).toBeDefined();
  });

  it('2. exposes a getExecutionHistory function', () => {
    expect(typeof service.getExecutionHistory).toBe('function');
  });

  it('3. rejects a null listing service', () => {
    expect(() =>
      createTripExecutionHistoryQueryService(
        null as unknown as TripExecutionHistoryListingService
      )
    ).toThrow(TypeError);
  });

  it('4. rejects a non-object listing service', () => {
    expect(() =>
      createTripExecutionHistoryQueryService(
        'listing' as unknown as TripExecutionHistoryListingService
      )
    ).toThrow(TypeError);
  });

  it('5. rejects a listing service missing listExecutionHistory', () => {
    expect(() =>
      createTripExecutionHistoryQueryService({} as unknown as TripExecutionHistoryListingService)
    ).toThrow(TypeError);
  });

  it('6. rejects a listing service whose listExecutionHistory is not a function', () => {
    expect(() =>
      createTripExecutionHistoryQueryService({
        listExecutionHistory: 'nope',
      } as unknown as TripExecutionHistoryListingService)
    ).toThrow(TypeError);
  });

  it('7. construction does not invoke the listing service', () => {
    expect(listingSpy).not.toHaveBeenCalled();
  });

  // --- Valid invocation and delegation ------------------------------------
  it('8. a valid call returns a presentation', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.kind).toBe('trip-execution-history-presentation');
    expect(isTripExecutionHistoryPresentation(presentation)).toBe(true);
  });

  it('9. the listing service is called exactly once', async () => {
    await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(listingSpy).toHaveBeenCalledTimes(1);
  });

  it('10. the listing service is called with the requested trip id', async () => {
    await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(listingSpy).toHaveBeenCalledWith({ tripId: TRIP_ID });
  });

  it('11. the repository is consulted exactly once with the trip id', async () => {
    await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(listByTripId).toHaveBeenCalledTimes(1);
    expect(listByTripId).toHaveBeenCalledWith(TRIP_ID);
  });

  it('12. a different trip id is forwarded unchanged', async () => {
    listByTripId.mockResolvedValue([makeRecord({ tripId: OTHER_TRIP_ID })]);
    const presentation = await service.getExecutionHistory({ tripId: OTHER_TRIP_ID });
    expect(listingSpy).toHaveBeenCalledWith({ tripId: OTHER_TRIP_ID });
    expect(presentation.tripId).toBe(OTHER_TRIP_ID);
  });

  // --- Input validation ---------------------------------------------------
  it('13. rejects a null input without consulting the listing service', async () => {
    await expect(service.getExecutionHistory(null)).rejects.toThrow(TypeError);
    expect(listingSpy).not.toHaveBeenCalled();
  });

  it('14. rejects a string input without consulting the listing service', async () => {
    await expect(service.getExecutionHistory('trip-001')).rejects.toThrow(TypeError);
    expect(listingSpy).not.toHaveBeenCalled();
  });

  it('15. rejects a number input without consulting the listing service', async () => {
    await expect(service.getExecutionHistory(42)).rejects.toThrow(TypeError);
    expect(listingSpy).not.toHaveBeenCalled();
  });

  it('16. rejects an array input without consulting the listing service', async () => {
    await expect(service.getExecutionHistory([TRIP_ID])).rejects.toThrow(TypeError);
    expect(listingSpy).not.toHaveBeenCalled();
  });

  it('17. a missing tripId is rejected by the delegated listing service', async () => {
    await expect(service.getExecutionHistory({})).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('18. a non-string tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: 123 })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('19. an empty tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: '' })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('20. a padded tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: ` ${TRIP_ID} ` })).rejects.toThrow(
      TypeError
    );
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('21. a "." tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: '.' })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('22. a slash-bearing tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: 'trip/001' })).rejects.toThrow(TypeError);
    expect(listByTripId).not.toHaveBeenCalled();
  });

  it('23. an overlong tripId is rejected', async () => {
    await expect(service.getExecutionHistory({ tripId: 'a'.repeat(1501) })).rejects.toThrow(
      TypeError
    );
    expect(listByTripId).not.toHaveBeenCalled();
  });

  // --- Empty history ------------------------------------------------------
  it('24. an empty history yields a valid empty presentation', async () => {
    listByTripId.mockResolvedValue([]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.kind).toBe('trip-execution-history-presentation');
    expect(presentation.tripId).toBeNull();
    expect(presentation.items).toEqual([]);
  });

  it('25. the empty presentation passes the presentation guard', async () => {
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(isTripExecutionHistoryPresentation(presentation)).toBe(true);
  });

  // --- One and multiple records -------------------------------------------
  it('26. one record yields one presentation item', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.items).toHaveLength(1);
  });

  it('27. multiple records yield one item each', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r2` }),
    ]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.items).toHaveLength(2);
  });

  it('28. the original item order is preserved', async () => {
    const first = makeRecord({ receiptId: `${RECEIPT_PREFIX}a` });
    const second = makeRecord({ receiptId: `${RECEIPT_PREFIX}b` });
    const third = makeRecord({ receiptId: `${RECEIPT_PREFIX}c` });
    listByTripId.mockResolvedValue([first, second, third]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  it('29. record, receipt, and request identities are preserved', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.id).toBe(record.id);
    expect(item.receiptId).toBe(record.receiptId);
    expect(item.requestId).toBe(record.requestId);
  });

  it('30. provider attribution and results are preserved', async () => {
    const record = makeRecord({
      providerIds: [AMADEUS, BETA],
      results: [entry(AMADEUS, 'accepted'), entry(BETA, 'failed')],
      status: 'accepted',
    });
    listByTripId.mockResolvedValue([record]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.providerIds).toEqual([AMADEUS, BETA]);
    expect(item.results).toEqual(record.results);
  });

  it('31. a null provider result is preserved', async () => {
    listByTripId.mockResolvedValue([makeRecord({ results: [unanswered(AMADEUS)], status: null })]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.results[0].result).toBeNull();
  });

  // --- Aggregate status and labels ----------------------------------------
  it('32. an accepted status yields its label', async () => {
    listByTripId.mockResolvedValue([makeRecord({ status: 'accepted' })]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('accepted');
    expect(item.statusLabel).toBe('Accepted (provider response)');
  });

  it('33. a rejected status yields its label', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ results: [entry(AMADEUS, 'rejected')], status: 'rejected' }),
    ]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('rejected');
    expect(item.statusLabel).toBe('Rejected (provider response)');
  });

  it('34. an unsupported status yields its label', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ results: [entry(AMADEUS, 'unsupported')], status: 'unsupported' }),
    ]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('unsupported');
    expect(item.statusLabel).toBe('Unsupported (provider response)');
  });

  it('35. a failed status yields its label', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ results: [entry(AMADEUS, 'failed')], status: 'failed' }),
    ]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBe('failed');
    expect(item.statusLabel).toBe('Failed (provider response)');
  });

  it('36. a null aggregate status is preserved and labelled neutrally', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ results: [], providerIds: [], executed: false, status: null }),
    ]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.status).toBeNull();
    expect(item.statusLabel).toBe('No provider response');
  });

  it('37. executed true yields the attempted label', async () => {
    listByTripId.mockResolvedValue([makeRecord()]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executed).toBe(true);
    expect(item.executionLabel).toBe('Execution attempted');
  });

  it('38. executed false yields the not-executed label', async () => {
    listByTripId.mockResolvedValue([
      makeRecord({ results: [], providerIds: [], executed: false, status: null }),
    ]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executed).toBe(false);
    expect(item.executionLabel).toBe('Not executed');
  });

  it('39. executed true with no provider answer keeps both labels honest', async () => {
    listByTripId.mockResolvedValue([makeRecord({ results: [unanswered(AMADEUS)], status: null })]);
    const item = (await service.getExecutionHistory({ tripId: TRIP_ID })).items[0];
    expect(item.executed).toBe(true);
    expect(item.executionLabel).toBe('Execution attempted');
    expect(item.statusLabel).toBe('No provider response');
  });

  // --- Error propagation --------------------------------------------------
  it('40. a repository failure propagates and is not an empty history', async () => {
    const err = new Error('repository-failure');
    listByTripId.mockRejectedValueOnce(err);
    await expect(service.getExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(err);
  });

  it('41. a listing-service rejection propagates unchanged', async () => {
    const err = new Error('listing-failure');
    const rejecting = { listExecutionHistory: vi.fn().mockRejectedValue(err) };
    const rejectingService = createTripExecutionHistoryQueryService(rejecting);
    await expect(rejectingService.getExecutionHistory({ tripId: TRIP_ID })).rejects.toBe(err);
  });

  it('42. a malformed history returned by the listing service is rejected', async () => {
    const badListing = {
      listExecutionHistory: vi.fn().mockResolvedValue({
        kind: 'trip-execution-history',
        tripId: TRIP_ID,
        items: [{ bad: true }],
      }),
    };
    const badService = createTripExecutionHistoryQueryService(badListing);
    await expect(badService.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  it('43. a non-history value returned by the listing service is rejected', async () => {
    const badListing = { listExecutionHistory: vi.fn().mockResolvedValue(null) };
    const badService = createTripExecutionHistoryQueryService(badListing);
    await expect(badService.getExecutionHistory({ tripId: TRIP_ID })).rejects.toThrow(TypeError);
  });

  // --- Immutability -------------------------------------------------------
  it('44. the input is not mutated', async () => {
    const input = { tripId: TRIP_ID };
    const snapshot = { ...input };
    await service.getExecutionHistory(input);
    expect(input).toEqual(snapshot);
  });

  it('45. the presentation does not alias the repository records', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(presentation.items[0]).not.toBe(record);
    expect(presentation.items[0].results).not.toBe(record.results);
  });

  it('46. mutating the presentation does not affect the repository record', async () => {
    const record = makeRecord();
    listByTripId.mockResolvedValue([record]);
    const presentation = await service.getExecutionHistory({ tripId: TRIP_ID });
    presentation.items[0].providerIds.push('intruder');
    presentation.items[0].results.pop();
    expect(record.providerIds).toEqual([AMADEUS]);
    expect(record.results).toHaveLength(1);
  });

  // --- Determinism --------------------------------------------------------
  it('47. identical valid inputs produce equivalent presentations', async () => {
    const build = () => [
      makeRecord({ receiptId: `${RECEIPT_PREFIX}r1` }),
      makeRecord({ results: [entry(AMADEUS, 'failed')], status: 'failed' }),
    ];
    listByTripId.mockImplementation(async () => build());
    const first = await service.getExecutionHistory({ tripId: TRIP_ID });
    const second = await service.getExecutionHistory({ tripId: TRIP_ID });
    expect(second).toEqual(first);
  });

  // --- Dependency boundaries ---------------------------------------------
  it('48. has no Firebase or Firestore dependency', () => {
    expect(CODE).not.toMatch(/firebase|firestore/i);
  });

  it('49. has no direct repository access', () => {
    expect(CODE).not.toMatch(/listByTripId|\.getById\b|\.save\b|repository/i);
  });

  it('50. has no network dependency', () => {
    expect(CODE).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });

  it('51. has no UI, state, or router dependency', () => {
    expect(CODE).not.toMatch(/from\s+['"]react|react-router|\bzustand\b|useState|createStore/);
  });

  it('52. has no provider execution or orchestration dependency', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(|executeTripExecution|mockTripExecutionProvider|orchestrat/i);
  });

  it('53. has no browser storage dependency', () => {
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('54. has no clock, timing, randomness, or environment access', () => {
    expect(CODE).not.toMatch(
      /\bDate\b|Date\.now\(|new Date\(|Math\.random|randomUUID|performance\.|process\.env|import\.meta\.env|Deno\.env|setTimeout|setInterval/
    );
  });

  it('55. imports only the listing service contract and the presentation factory', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual([
      './tripExecutionHistoryListingService',
      './tripExecutionHistoryPresentation',
    ]);
  });

  it('56. adds no sorting, filtering, caching, logging, or other side effects', () => {
    expect(CODE).not.toMatch(
      /\.sort\(|\.filter\(|\.reverse\(|\.reduce\(|\bcache\b|retry|console\.|\.push\(\s*console/
    );
  });

  it('57. the fixtures pass the STEP 78 record validator', () => {
    expect(isTripExecutionRecord(makeRecord())).toBe(true);
  });
});
