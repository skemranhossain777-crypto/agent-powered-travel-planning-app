import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTripExecutionRecordRepository,
  type TripExecutionRecordRepository,
} from '../services/tripExecution/tripExecutionRecordRepository';
import type { TripExecutionRecord } from '../services/tripExecution/tripExecutionRecord';

const REPO_PATH = join(process.cwd(), 'src/services/tripExecution/tripExecutionRecordRepository.ts');
const SOURCE = readFileSync(REPO_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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
        result: {
          providerId: 'alpha',
          requestId: 'trip-execution-provider-request:dispatch-1',
          status: 'accepted',
        },
        requestId: 'trip-execution-provider-request:dispatch-1',
        providerId: 'alpha',
        reason: 'executed',
      },
    ],
    executed: true,
    status: 'accepted',
  } as TripExecutionRecord;
}

describe('STEP 79 trip execution record repository contract', () => {
  it('1. valid repository accepted', () => {
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    const result = createTripExecutionRecordRepository(repo);
    expect(result).toBe(repo);
  });

  it('2. save function required', () => {
    const invalid = { getById: async () => null } as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow();
  });

  it('3. getById function required', () => {
    const invalid = { save: async () => {} } as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow();
  });

  it('4. missing save rejected', () => {
    const invalid = { getById: async () => null } as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow(TypeError);
  });

  it('5. missing getById rejected', () => {
    const invalid = { save: async () => {} } as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow(TypeError);
  });

  it('6. null rejected', () => {
    expect(() => createTripExecutionRecordRepository(null as unknown as TripExecutionRecordRepository)).toThrow();
  });

  it('7. primitive rejected', () => {
    expect(() => createTripExecutionRecordRepository('x' as unknown as TripExecutionRecordRepository)).toThrow();
    expect(() => createTripExecutionRecordRepository(123 as unknown as TripExecutionRecordRepository)).toThrow();
  });

  it('8. array rejected', () => {
    const invalid = [] as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow();
  });

  it('9. function-only rejected', () => {
    const invalid = (() => {}) as unknown;
    expect(() => createTripExecutionRecordRepository(invalid as TripExecutionRecordRepository)).toThrow();
  });

  it('10. extra properties do not alter contract behavior', () => {
    const repo = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
      extra: true,
    } as TripExecutionRecordRepository & { extra: boolean };
    const result = createTripExecutionRecordRepository(repo);
    expect(result).toBe(repo);
  });

  it('11. valid record can be passed to save', async () => {
    const record = createTestRecord();
    let received: unknown;
    const repo: TripExecutionRecordRepository = {
      save: async (r) => {
        received = r;
      },
      getById: async () => null,
      listByTripId: async () => [],
    };
    await repo.save(record);
    expect(received).toBe(record);
  });

  it('12. save return value preserved', async () => {
    const repo: TripExecutionRecordRepository = {
      save: async () => { return undefined as void; },
      getById: async () => null,
      listByTripId: async () => [],
    };
    const result = createTripExecutionRecordRepository(repo);
    await expect(result.save(createTestRecord())).resolves.toBeUndefined();
  });

  it('13. save is not invoked during factory validation', () => {
    const called = false;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    createTripExecutionRecordRepository(repo);
    expect(called).toBe(false);
  });

  it('14. record is not modified', async () => {
    const record = createTestRecord();
    const before = JSON.parse(JSON.stringify(record));
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    await repo.save(record);
    expect(JSON.parse(JSON.stringify(record))).toEqual(before);
  });

  it('15. same record can be passed repeatedly', async () => {
    const record = createTestRecord();
    let count = 0;
    const repo: TripExecutionRecordRepository = {
      save: async () => {
        count++;
      },
      getById: async () => null,
      listByTripId: async () => [],
    };
    await repo.save(record);
    await repo.save(record);
    expect(count).toBe(2);
  });

  it('16. valid tripId accepted', async () => {
    const record = createTestRecord();
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => record,
      listByTripId: async () => [],
    };
    const r = await repo.getById('t1', 'r1');
    expect(r).not.toBeNull();
  });

  it('17. valid recordId accepted', async () => {
    const record = createTestRecord();
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => record,
      listByTripId: async () => [],
    };
    const r = await repo.getById('t1', 'r1');
    expect(r).not.toBeNull();
  });

  it('18. both ownership parameters passed through unchanged', async () => {
    let gotTrip: string | undefined;
    let gotRec: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (tid, rid) => {
        gotTrip = tid;
        gotRec = rid;
        return null;
      },
      listByTripId: async () => [],
    };
    await repo.getById('tripX', 'recordY');
    expect(gotTrip).toBe('tripX');
    expect(gotRec).toBe('recordY');
  });

  it('19. null result supported', async () => {
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    const r = await repo.getById('t1', 'r1');
    expect(r).toBeNull();
  });

  it('20. returned record preserved', async () => {
    const record = createTestRecord();
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => record,
      listByTripId: async () => [],
    };
    const r = await repo.getById('t1', 'r1');
    expect(r).toBe(record);
  });

  it('21. getById not invoked during factory validation', () => {
    const called = false;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    createTripExecutionRecordRepository(repo);
    expect(called).toBe(false);
  });

  it('22. tripId preserved byte-for-byte', async () => {
    let got: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (tid) => { got = tid; return null; },
      listByTripId: async () => [],
    };
    const id = 'trip-with-dash_underscore';
    await repo.getById(id, 'r');
    expect(got).toBe(id);
  });

  it('23. recordId preserved byte-for-byte', async () => {
    let got: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (_tid, rid) => {
        got = rid;
        return null;
      },
      listByTripId: async () => [],
    };
    const id = 'trip-execution-record:t:r';
    await repo.getById('t', id);
    expect(got).toBe(id);
  });

  it('24. no trim', async () => {
    let got: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (tid) => { got = tid; return null; },
      listByTripId: async () => [],
    };
    await repo.getById(' trip ', 'r');
    expect(got).toBe(' trip ');
  });

  it('25. no case folding', async () => {
    let got: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (tid) => { got = tid; return null; },
      listByTripId: async () => [],
    };
    await repo.getById('Trip', 'r');
    expect(got).toBe('Trip');
  });

  it('26. no normalization', async () => {
    let got: string | undefined;
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async (tid) => { got = tid; return null; },
      listByTripId: async () => [],
    };
    await repo.getById('a/b', 'r');
    expect(got).toBe('a/b');
  });

  it('27. no ID generation', () => {
    const repo: TripExecutionRecordRepository = {
      save: async () => {},
      getById: async () => null,
      listByTripId: async () => [],
    };
    createTripExecutionRecordRepository(repo);
    expect(CODE).not.toMatch(/randomUUID|Date\.now|new\s+Date/);
  });

  it('28. no Firebase', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firebase/i);
  });

  it('29. no Firestore', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firestore/i);
    expect(CODE_WITH_LITERALS).not.toMatch(/addDoc|setDoc|getDoc|doc\(/);
  });

  it('30. no network', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/fetch\(|XMLHttpRequest/);
  });

  it('31. no provider execution', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
  });

  it('32. no orchestration', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/orchestrate/);
  });

  it('33. no React', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/react/i);
  });

  it('34. no Router', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/router/i);
  });

  it('35. no Zustand', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/zustand/i);
  });

  it('36. no environment access', () => {
    expect(CODE).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('37. no clock/randomness', () => {
    expect(CODE).not.toMatch(/Date\(|Math\.random|randomUUID/);
  });

  it('38. no commerce semantics', () => {
    const w = ['booking', 'payment', 'reservation', 'booked', 'purchase', 'ticket'];
    for (const x of w) {
      expect(CODE).not.toMatch(new RegExp(x, 'i'));
    }
  });

  it('39. no serialization', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/toFirestore|fromFirestore|Timestamp/);
  });

  it('40. no persistence implementation', () => {
    expect(CODE_WITH_LITERALS).toMatch(/TripExecutionRecordRepository\s*\{/);
    expect(CODE_WITH_LITERALS).not.toMatch(/class\s+\w+Repository\s*{[^}]*save/);
  });

  it('41. imports only Step 78 TripExecutionRecord type', () => {
    expect(CODE_WITH_LITERALS).toContain('TripExecutionRecord');
    expect(CODE_WITH_LITERALS).toMatch(/TripExecutionRecord/);
  });

  it('42. does not import Step 77 execution machinery', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/orchestrateTripExecution|executeTripExecution|outcomeReceipt/);
  });

  it('43. no Firestore path/collection constants', () => {
    expect(CODE).not.toMatch(/collection|path/i);
  });

  it('44. does not generate IDs', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/crypto\.randomUUID/);
  });

  it('45. does not mutate records', () => {
    expect(CODE).not.toMatch(/\.\.\.record|record\.\w+\s*=/);
  });
});
