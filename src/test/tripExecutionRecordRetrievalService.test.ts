import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTripExecutionRecordRetrievalService, type TripExecutionRecordRetrievalService } from '../services/tripExecution/tripExecutionRecordRetrievalService';
import type { TripExecutionRecordRepository } from '../services/tripExecution/tripExecutionRecordRepository';
import { createTripExecutionRecord, type TripExecutionRecord } from '../services/tripExecution/tripExecutionRecord';
import { createTripExecutionOutcomeReceipt } from '../services/tripExecution/tripExecutionOutcomeReceipt';
import type { TripExecutionAuthorizedOrchestrationResult } from '../services/tripExecution/tripExecutionAuthorizedOrchestrator';

function createValidReceipt() {
  const orchResult: TripExecutionAuthorizedOrchestrationResult = {
    executed: true,
    requestId: 'trip-execution-provider-request:trip123:mockprovider',
    providerIds: ['mockprovider'],
    results: [
      {
        executed: true,
        providerId: 'mockprovider',
        requestId: 'trip-execution-provider-request:trip123:mockprovider',
        result: { providerId: 'mockprovider', requestId: 'trip-execution-provider-request:trip123:mockprovider', status: 'accepted' as const },
        reason: 'executed',
      },
    ],
    status: 'accepted' as const,
    reason: 'orchestrated',
  };
  const receipt = createTripExecutionOutcomeReceipt(orchResult);
  if (!receipt || receipt.reason !== 'recorded') {
    throw new Error('failed to create valid receipt');
  }
  return receipt;
}

function createRecord(): TripExecutionRecord {
  const receipt = createValidReceipt();
  const record = createTripExecutionRecord({ tripId: 'trip123', receipt });
  if (record === null) throw new Error('failed to create record');
  return record;
}

describe('STEP 83 Trip Execution Record Retrieval Service', () => {
  let repository: TripExecutionRecordRepository;
  let service: TripExecutionRecordRetrievalService;
  let saveSpy: ReturnType<typeof vi.fn>;
  let getByIdSpy: ReturnType<typeof vi.fn>;
  let record: TripExecutionRecord;

  beforeEach(() => {
    record = createRecord();
    saveSpy = vi.fn().mockResolvedValue(undefined);
    getByIdSpy = vi.fn().mockResolvedValue(record);
    repository = {
      save: saveSpy,
      getById: getByIdSpy,
      listByTripId: vi.fn().mockResolvedValue([]),
    };
  });

  it('1. creates service with valid repository', () => {
    service = createTripExecutionRecordRetrievalService(repository);
    expect(service).toBeDefined();
  });

  it('2. rejects invalid repository (null)', () => {
    expect(() => createTripExecutionRecordRetrievalService(null as unknown as TripExecutionRecordRepository)).toThrow();
  });

  it('3. rejects invalid repository (missing save)', () => {
    const bad = { getById: async () => null } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionRecordRetrievalService(bad)).toThrow();
  });

  it('4. rejects invalid repository (missing getById)', () => {
    const bad = { save: async () => {} } as unknown as TripExecutionRecordRepository;
    expect(() => createTripExecutionRecordRetrievalService(bad)).toThrow();
  });

  it('5. valid retrieval returns record', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const result = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(result).toEqual(record);
  });

  it('6. null when not found', async () => {
    getByIdSpy.mockResolvedValueOnce(null);
    service = createTripExecutionRecordRetrievalService(repository);
    const result = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(result).toBeNull();
  });

  it('7. passes tripId and recordId', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(getByIdSpy).toHaveBeenCalledWith('trip123', record.id);
  });

  it('8. exactly one call', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(getByIdSpy).toHaveBeenCalledTimes(1);
  });

  it('9. no call for invalid input (null)', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord(null as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('10. no call for invalid input (string)', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord('bad' as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('11. missing tripId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('12. missing recordId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123' } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('13. non-string tripId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 123, recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('14. non-string recordId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: 123 } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('15. empty tripId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: '', recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('16. empty recordId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: '' } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('17. padded tripId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: ' trip123 ', recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('18. padded recordId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: ' ' + record.id + ' ' } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('19. overlong tripId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const long = 'a'.repeat(1505);
    await expect(service.getExecutionRecord({ tripId: long, recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('20. overlong recordId rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const long = 'a'.repeat(1505);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: long } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('21. invalid storage ID (slash) rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip/123', recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('22. invalid storage ID (dot) rejected', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: '.', recordId: record.id } as unknown as Parameters<TripExecutionRecordRetrievalService['getExecutionRecord']>[0])).rejects.toThrow();
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('23. repository rejection propagates', async () => {
    const err = new Error('repo-fail');
    getByIdSpy.mockRejectedValueOnce(err);
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: record.id })).rejects.toBe(err);
  });

  it('24. malformed returned object rejected', async () => {
    getByIdSpy.mockResolvedValueOnce({ bad: true });
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: record.id })).rejects.toThrow();
  });

  it('25. wrong kind rejected', async () => {
    const bad = { ...record, kind: 'other' as TripExecutionRecord['kind'] };
    getByIdSpy.mockResolvedValueOnce(bad);
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: record.id })).rejects.toThrow();
  });

  it('26. wrong recordId rejected', async () => {
    const bad = { ...record, id: 'bad-id' };
    getByIdSpy.mockResolvedValueOnce(bad);
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: record.id })).rejects.toThrow();
  });

  it('27. wrong tripId rejected', async () => {
    const bad = { ...record, tripId: 'othertrip' };
    getByIdSpy.mockResolvedValueOnce(bad);
    service = createTripExecutionRecordRetrievalService(repository);
    await expect(service.getExecutionRecord({ tripId: 'trip123', recordId: record.id })).rejects.toThrow();
  });

  it('28. null result remains null', async () => {
    getByIdSpy.mockResolvedValueOnce(null);
    service = createTripExecutionRecordRetrievalService(repository);
    const res = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(res).toBeNull();
  });

  it('29. preserves status', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const res = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(res?.status).toBe(record.status);
  });

  it('30. preserves executed flag', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const res = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(res?.executed).toBe(record.executed);
  });

  it('31. preserves providerIds and results', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const res = await service.getExecutionRecord({ tripId: 'trip123', recordId: record.id });
    expect(res?.providerIds).toEqual(record.providerIds);
    expect(res?.results).toEqual(record.results);
  });

  it('32. input not mutated', async () => {
    service = createTripExecutionRecordRetrievalService(repository);
    const input = { tripId: 'trip123', recordId: record.id };
    const copy = { ...input };
    await service.getExecutionRecord(input);
    expect(input).toEqual(copy);
  });
});
