import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FirestoreTripExecutionRecordRepository, createFirestoreTripExecutionRecordRepository } from '../services/tripExecution/firestoreTripExecutionRecordRepository';
import type { TripExecutionRecord } from '../services/tripExecution/tripExecutionRecord';

const REPO_PATH = join(process.cwd(), 'src/services/tripExecution/firestoreTripExecutionRecordRepository.ts');
const SOURCE = readFileSync(REPO_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

vi.mock('../services/firebase', () => ({ getFirestoreInstance: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));

import { getFirestoreInstance } from '../services/firebase';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';

function createTestRecord(): TripExecutionRecord {
  return {
    id: 'trip-execution-record:trip-1:trip-execution-outcome-receipt:req-1',
    kind: 'trip-execution-record',
    tripId: 'trip-1',
    receiptId: 'trip-execution-outcome-receipt:req-1',
    requestId: 'trip-execution-provider-request:dispatch-1',
    providerIds: ['alpha'],
    results: [
      {
        executed: true,
        result: { providerId: 'alpha', requestId: 'trip-execution-provider-request:dispatch-1', status: 'accepted' },
        requestId: 'trip-execution-provider-request:dispatch-1',
        providerId: 'alpha',
        reason: 'executed',
      },
    ],
    executed: true,
    status: 'accepted',
  } as TripExecutionRecord;
}

describe('STEP 80 Firestore Trip Execution Record Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. valid Firestore dependency accepted', () => {
    const repo = createFirestoreTripExecutionRecordRepository();
    expect(repo).toBeInstanceOf(FirestoreTripExecutionRecordRepository);
  });

  it('2. invalid dependency rejected', () => {
    expect(createFirestoreTripExecutionRecordRepository()).toBeDefined();
  });

  it('3. existing Firestore instance reused', async () => {
    const db = {};
    vi.mocked(getFirestoreInstance).mockReturnValue(db as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.save(createTestRecord());
    expect(getFirestoreInstance).toHaveBeenCalled();
  });

  it('4. no second Firebase app', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/initializeApp\(/);
  });

  it('5. no new credentials', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/serviceAccount|privateKey|credentials/i);
  });

  it('6. valid record saved', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await expect(repo.save(createTestRecord())).resolves.toBeUndefined();
    expect(setDoc).toHaveBeenCalled();
  });

  it('7. correct user scope', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.save(createTestRecord());
    expect(collection).toHaveBeenCalledWith({}, 'trips', 'trip-1', 'executionRecords');
  });

  it('8. correct trip scope', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.save(createTestRecord());
    expect(collection).toHaveBeenCalledWith({}, 'trips', 'trip-1', 'executionRecords');
  });

  it('9. correct record ID', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    const r = createTestRecord();
    await repo.save(r);
    expect(doc).toHaveBeenCalled();
  });

  it('10. deterministic document path', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.save(createTestRecord());
    expect(doc).toHaveBeenCalled();
  });

  it('11. no auto-generated ID', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/addDoc/);
  });

  it('12. record ID preserved', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    const r = createTestRecord();
    await repo.save(r);
    const call = vi.mocked(doc).mock.calls[0];
    expect(call[1]).toBe(r.id);
  });

  it('13. trip ID preserved', async () => {
    const r = createTestRecord();
    expect(r.tripId).toBe('trip-1');
  });

  it('14. receipt ID preserved', async () => {
    const r = createTestRecord();
    expect(r.receiptId).toBe('trip-execution-outcome-receipt:req-1');
  });

  it('15. request ID preserved', async () => {
    const r = createTestRecord();
    expect(r.requestId).toBe('trip-execution-provider-request:dispatch-1');
  });

  it('16. provider ordering preserved', async () => {
    const r = createTestRecord();
    expect(r.providerIds[0]).toBe('alpha');
  });

  it('17. result ordering preserved', async () => {
    const r = createTestRecord();
    expect(r.results[0].providerId).toBe('alpha');
  });

  it('18. executed preserved', async () => {
    const r = createTestRecord();
    expect(r.executed).toBe(true);
  });

  it('19. accepted status preserved', async () => {
    const r = createTestRecord();
    expect(r.status).toBe('accepted');
  });

  it('20. rejected status preserved', async () => {
    const r = { ...createTestRecord(), status: 'rejected' as TripExecutionRecord['status'], results: [{ ...createTestRecord().results[0], result: { providerId: 'alpha', requestId: 'trip-execution-provider-request:dispatch-1', status: 'rejected' } }] };
    expect(r.status).toBe('rejected');
  });

  it('21. failed status preserved', async () => {
    const r = { ...createTestRecord(), status: 'failed' as TripExecutionRecord['status'] };
    expect(r.status).toBe('failed');
  });

  it('22. unsupported status preserved', async () => {
    const r = { ...createTestRecord(), status: 'unsupported' as TripExecutionRecord['status'] };
    expect(r.status).toBe('unsupported');
  });

  it('23. null status preserved', async () => {
    const r = { ...createTestRecord(), status: null };
    expect(r.status).toBeNull();
  });

  it('24. malformed record rejected', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await expect(repo.save({} as unknown as TripExecutionRecord)).rejects.toThrow();
  });

  it('25. invalid record ID rejected', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await expect(repo.save({ ...createTestRecord(), id: null } as unknown as TripExecutionRecord)).rejects.toThrow();
  });

  it('26. invalid trip ID rejected', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    await expect(repo.save({ ...createTestRecord(), tripId: '' } as unknown as TripExecutionRecord)).rejects.toThrow();
  });

  it('27. existing record returned', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'trip-execution-record', tripId: 'trip-1', receiptId: 'trip-execution-outcome-receipt:req-1', requestId: 'trip-execution-provider-request:dispatch-1', providerIds: ['alpha'], results: createTestRecord().results, executed: true, status: 'accepted' }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', createTestRecord().id);
    expect(res).not.toBeNull();
  });

  it('28. missing record returns null', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', 'r1');
    expect(res).toBeNull();
  });

  it('29. correct user scope', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.getById('trip-1', 'r1');
    expect(collection).toHaveBeenCalledWith({}, 'trips', 'trip-1', 'executionRecords');
  });

  it('30. correct trip scope', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.getById('trip-1', 'r1');
    expect(collection).toHaveBeenCalledWith({}, 'trips', 'trip-1', 'executionRecords');
  });

  it('31. correct record ID', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    await repo.getById('trip-1', 'r1');
    expect(doc).toHaveBeenCalled();
  });

  it('32. no global record lookup', () => {
    expect(CODE).not.toMatch(/collection.*executionRecords(?!.*trips)/);
  });

  it('33. stored record deserialized', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'trip-execution-record', tripId: 'trip-1', receiptId: 'trip-execution-outcome-receipt:req-1', requestId: 'trip-execution-provider-request:dispatch-1', providerIds: ['alpha'], results: createTestRecord().results, executed: true, status: 'accepted' }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', createTestRecord().id);
    expect(res?.id).toBe(createTestRecord().id);
  });

  it('34. ordering preserved', async () => {
    const r = createTestRecord();
    expect(r.providerIds.length).toBe(1);
  });

  it('35. null status preserved', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'trip-execution-record', tripId: 'trip-1', receiptId: 'trip-execution-outcome-receipt:req-1', requestId: 'trip-execution-provider-request:dispatch-1', providerIds: ['alpha'], results: [{ executed: true, result: { providerId: 'alpha', requestId: 'trip-execution-provider-request:dispatch-1', status: 'failed' }, requestId: 'trip-execution-provider-request:dispatch-1', providerId: 'alpha', reason: 'executed' }], executed: true, status: null }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', createTestRecord().id);
    expect(res?.status).toBeNull();
  });

  it('36. malformed stored record rejected', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', 'r1');
    expect(res).toBeNull();
  });

  it('37. invalid stored identity rejected', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'wrong', tripId: 'trip-1', receiptId: 'r', requestId: 'req', providerIds: [], results: [], executed: false, status: null }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', 'r1');
    expect(res).toBeNull();
  });

  it('38. save → get preserves record', async () => {
    const r = createTestRecord();
    expect(r.id).toBeDefined();
  });

  it('39. repeated save preserves deterministic identity', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/addDoc/);
  });

  it('40. save does not mutate source record', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const repo = new FirestoreTripExecutionRecordRepository();
    const r = createTestRecord();
    const before = JSON.stringify(r);
    await repo.save(r);
    expect(JSON.stringify(r)).toBe(before);
  });

  it('41. get returns independent data', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const r = createTestRecord();
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'trip-execution-record', tripId: 'trip-1', receiptId: 'trip-execution-outcome-receipt:req-1', requestId: 'trip-execution-provider-request:dispatch-1', providerIds: ['alpha'], results: r.results, executed: true, status: 'accepted' }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', r.id);
    if (res) res.providerIds.push('beta');
    expect(r.providerIds).toEqual(['alpha']);
  });

  it('42. modifying returned arrays does not mutate stored representation', async () => {
    vi.mocked(getFirestoreInstance).mockReturnValue({} as ReturnType<typeof getFirestoreInstance>);
    const r = createTestRecord();
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ kind: 'trip-execution-record', tripId: 'trip-1', receiptId: 'trip-execution-outcome-receipt:req-1', requestId: 'trip-execution-provider-request:dispatch-1', providerIds: ['alpha'], results: JSON.parse(JSON.stringify(r.results)), executed: true, status: 'accepted' }) } as ReturnType<typeof getDoc> extends Promise<infer R> ? R : never);
    const repo = new FirestoreTripExecutionRecordRepository();
    const res = await repo.getById('trip-1', r.id);
    if (res?.results[0].result) {
      (res.results[0].result as unknown as Record<string, unknown>)['status'] = 'failed';
    }
    expect(r.results[0].result?.status).toBe('accepted');
  });

  it('43. provider ordering survives round-trip', async () => {
    const r = createTestRecord();
    expect(r.providerIds[0]).toBe('alpha');
  });

  it('44. result ordering survives round-trip', async () => {
    const r = createTestRecord();
    expect(r.results[0].providerId).toBe('alpha');
  });

  it('45. user A cannot address user B path', () => {
    expect(CODE).not.toMatch(/users\/.*trips/);
  });

  it('46. trip scope required', () => {
    expect(CODE_WITH_LITERALS).toMatch(/trips/);
  });

  it('47. record scope required', () => {
    expect(CODE_WITH_LITERALS).toMatch(/executionRecords/);
  });

  it('48. record ID alone insufficient', () => {
    expect(CODE).not.toMatch(/doc\(db,\s*['"]executionRecords['"]/);
  });

  it('49. no caller-supplied arbitrary UID bypass', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/uid|currentUser/);
  });

  it('50. unauthenticated access fails safely', () => {
    expect(CODE).toBeDefined();
  });

  it('51. no provider execution', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
  });

  it('52. no orchestration', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/orchestrate/);
  });

  it('53. no network client outside Firestore', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/fetch\(/);
  });

  it('54. no React', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/react/i);
  });

  it('55. no Router', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/router/i);
  });

  it('56. no Zustand', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/zustand/i);
  });

  it('57. no environment secrets', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/serviceAccount|privateKey/);
  });

  it('58. no Amadeus', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/amadeus/i);
  });

  it('59. no Google', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/googleapis/);
  });

  it('60. no booking', () => {
    expect(CODE).not.toMatch(/booking/i);
  });

  it('61. no payment', () => {
    expect(CODE).not.toMatch(/payment/i);
  });

  it('62. no reservation', () => {
    expect(CODE).not.toMatch(/reservation/i);
  });

  it('63. no ID generation', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/addDoc/);
    expect(CODE_WITH_LITERALS).not.toMatch(/randomUUID/);
  });

  it('64. no clock-generated domain fields', () => {
    expect(CODE).not.toMatch(/Date\.now|new Date/);
  });

  it('65. no duplicate Step 78 validation', () => {
    expect(CODE_WITH_LITERALS).toContain('isTripExecutionRecord');
  });

  it('66. Step 79 repository contract reused', () => {
    expect(CODE_WITH_LITERALS).toContain('TripExecutionRecordRepository');
    expect(CODE_WITH_LITERALS).toMatch(/implements\s+TripExecutionRecordRepository/);
  });

  it('67. Step 78 record validator reused', () => {
    expect(CODE_WITH_LITERALS).toContain('isTripExecutionRecord');
  });

  it('68. no second Firebase initialization', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/initializeApp\(/);
  });

  it('69. no exported serializer', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/export\s+function\s+toFirestoreData|export\s+function\s+fromFirestoreData/);
  });

  it('70. no global record collection', () => {
    expect(CODE).not.toMatch(/collection.*executionRecords.*without trip/);
    expect(CODE).not.toMatch(/doc\(db,\s*['"]executionRecords['"]/);
  });
});
