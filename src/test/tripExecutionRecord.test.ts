import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import { createTripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import type { TripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import { createTripExecutionProviderRequest, type TripExecutionProviderRequest } from '../services/tripExecution/tripExecutionProvider';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { createTripExecutionQualifiedAuthorization } from '../services/tripExecution/tripExecutionQualifiedAuthorization';
import { createTripExecutionAuthorizedRequest } from '../services/tripExecution/tripExecutionAuthorizedRequest';
import { orchestrateTripExecutionAuthorizedRequest, type TripExecutionAuthorizedOrchestrationResult } from '../services/tripExecution/tripExecutionAuthorizedOrchestrator';
import { createTripExecutionOutcomeReceipt, type TripExecutionOutcomeReceipt } from '../services/tripExecution/tripExecutionOutcomeReceipt';
import { createTripExecutionRecord, isTripExecutionRecord, TRIP_EXECUTION_RECORD_ID_PREFIX, TRIP_EXECUTION_RECORD_KIND } from '../services/tripExecution/tripExecutionRecord';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';
const ALPHA = 'alpha-execution';
const BETA = 'beta-execution';
const GAMMA = 'gamma-execution';

const RECORD_PATH = join(process.cwd(), 'src/services/tripExecution/tripExecutionRecord.ts');
const SOURCE = readFileSync(RECORD_PATH, 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function placeReference(overrides: Record<string, unknown> = {}): TripPlanningReference {
  return { id: 'place:alpha', title: 'Alpha Place', kind: 'activity', provider: 'Test Provider', providerId: 'alpha-1', ...overrides } as TripPlanningReference;
}
function requireValue<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} missing`);
  return value;
}
function validStep56Request(tripId = 'trip-plan'): TripPlanningExecutionRequest {
  const composition = requireValue(createTripPlanningComposition({ origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }), destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }) }), 'composition');
  const approved = requireValue(approveTripPlanningCompositionProposal(requireValue(createTripPlanningCompositionProposal(composition), 'proposal')), 'approved');
  const application = requireValue(createTripPlanningApplication(approved), 'application');
  const target = requireValue(createTripPlanningApplicationTarget({ scope: 'trip', tripId }), 'target');
  const binding = requireValue(createTripPlanningApplicationBinding(application, target), 'binding');
  const intent = requireValue(createTripPlanningExecutionIntent(binding), 'intent');
  return requireValue(createTripPlanningExecutionRequest(intent), 'step56 request');
}
function providerRequestFor(tripId = 'trip-plan'): TripExecutionProviderRequest {
  const authorization = requireValue(createTripPlanningExecutionAuthorization(validStep56Request(tripId)), 'authorization');
  const dispatch = requireValue(createTripExecutionDispatchInstruction(authorization), 'dispatch');
  return requireValue(createTripExecutionProviderRequest(dispatch), 'provider request');
}
function statusProvider(providerId: string, status: 'accepted' | 'rejected' | 'unsupported' | 'failed') {
  const calls: TripExecutionProviderRequest[] = [];
  return { calls, name: providerId, provider: { providerId, async execute(request: TripExecutionProviderRequest): Promise<unknown> { calls.push(request); return { providerId, requestId: request.id, status }; } } };
}
function throwingProvider(providerId: string) {
  return { calls: [] as TripExecutionProviderRequest[], name: providerId, provider: { providerId, execute(): unknown { throw new Error('secret'); } } };
}
function rejectingProvider(providerId: string) {
  return { calls: [] as TripExecutionProviderRequest[], name: providerId, provider: { providerId, async execute(): Promise<unknown> { throw new Error('secret'); } } };
}
function objects(...fakes: Array<{ provider: Record<string, unknown> }>): unknown[] { return fakes.map((fake) => fake.provider); }
function authorizedRequest(providerIds: ReadonlyArray<string> = [ALPHA]): Record<string, unknown> {
  const plan = requireValue(createTripExecutionPlan(providerRequestFor('trip-plan'), providerIds.map((id) => ({ providerId: id, async execute() { return Promise.resolve({ providerId: id, requestId: 'unused', status: 'accepted' as const }); } }))), 'plan');
  const request = validStep56Request('trip-plan');
  const qualification = evaluateTripExecutionPlanQualification({ plan, eligibility: { eligible: true, requestId: request.id, requiredCapabilityId: CAPABILITY, providerIds: [...plan.providerIds], capabilityIds: [CAPABILITY], reason: 'eligible' } });
  if (!qualification.qualified) throw new Error('fixture not qualified');
  const qualified = createTripExecutionQualifiedDispatch({ qualification });
  if (!qualified.dispatched) throw new Error('fixture not dispatched');
  const authorized = createTripExecutionQualifiedAuthorization({ dispatch: qualified as never });
  if (!authorized.authorized) throw new Error('fixture not authorized');
  const authReq = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (!authReq.accepted) throw new Error('fixture not accepted');
  return authReq as unknown as Record<string, unknown>;
}
async function orchestrate(fakes: Array<{ provider: Record<string, unknown> }>, providerIds: ReadonlyArray<string> = [ALPHA], request: unknown = authorizedRequest(providerIds)): Promise<TripExecutionAuthorizedOrchestrationResult> {
  return orchestrateTripExecutionAuthorizedRequest({ request, providers: objects(...fakes) });
}
async function step76For(statuses: ReadonlyArray<'accepted' | 'rejected' | 'unsupported' | 'failed' | 'throw' | 'reject'>, providerIds: ReadonlyArray<string> = [ALPHA, BETA, GAMMA].slice(0, statuses.length)): Promise<TripExecutionAuthorizedOrchestrationResult> {
  const fakes = statuses.map((status, index) => { const providerId = providerIds[index]; if (status === 'throw') return throwingProvider(providerId); if (status === 'reject') return rejectingProvider(providerId); return statusProvider(providerId, status); });
  return orchestrate(fakes, providerIds);
}
function step76Like(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rid = providerRequestFor().id;
  return { executed: true, requestId: rid, providerIds: [ALPHA], results: [{ executed: true, result: { providerId: ALPHA, requestId: rid, status: 'accepted' }, requestId: rid, providerId: ALPHA, reason: 'executed' }], status: 'accepted', reason: 'orchestrated', ...overrides };
}
async function validReceipt(): Promise<TripExecutionOutcomeReceipt> {
  const result = await orchestrate([statusProvider(ALPHA, 'accepted')], [ALPHA], authorizedRequest([ALPHA]));
  const receipt = createTripExecutionOutcomeReceipt(result);
  if (!receipt) throw new Error('valid receipt fixture missing');
  return receipt;
}
function expectRefused(input: unknown, label?: string): void {
  if (label !== undefined) {
    expect(createTripExecutionRecord(input), label).toBeNull();
  } else {
    expect(createTripExecutionRecord(input)).toBeNull();
  }
}

describe('STEP 78 trip execution record', () => {
  it('1. valid trip + valid receipt', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt });
    expect(record).not.toBeNull();
    if (!record) return;
    expect(record.tripId).toBe('trip-plan');
    expect(record.receiptId).toBe(receipt.id);
    expect(record.requestId).toBe(receipt.requestId);
    expect(record.providerIds).toEqual(receipt.providerIds);
    expect(record.executed).toBe(receipt.executed);
    expect(record.status).toBe(receipt.status);
    expect(record.kind).toBe(TRIP_EXECUTION_RECORD_KIND);
    expect(isTripExecutionRecord(record)).toBe(true);
  });
  it('2. accepted receipt', async () => {
    const receipt = await orchestrate([statusProvider(ALPHA, 'accepted')]);
    const rec = createTripExecutionOutcomeReceipt(receipt);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.status).toBe('accepted');
  });
  it('3. rejected receipt', async () => {
    const receipt = await orchestrate([statusProvider(ALPHA, 'rejected')]);
    const rec = createTripExecutionOutcomeReceipt(receipt);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.status).toBe('rejected');
  });
  it('4. unsupported receipt', async () => {
    const receipt = await orchestrate([statusProvider(ALPHA, 'unsupported')]);
    const rec = createTripExecutionOutcomeReceipt(receipt);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.status).toBe('unsupported');
  });
  it('5. failed receipt', async () => {
    const receipt = await orchestrate([statusProvider(ALPHA, 'failed')]);
    const rec = createTripExecutionOutcomeReceipt(receipt);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.status).toBe('failed');
  });
  it('6. null-status receipt', async () => {
    const result = await step76For(['throw']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.status).toBeNull();
  });
  it('7. non-executed receipt', async () => {
    const result = await orchestrate([statusProvider(BETA, 'accepted'), statusProvider(ALPHA, 'accepted')], [ALPHA, BETA], authorizedRequest([ALPHA, BETA]));
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.executed).toBe(false);
  });
  it('8. executed receipt with provider-level failures', async () => {
    const result = await step76For(['throw', 'failed']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt: rec });
    expect(record?.executed).toBe(true);
  });
  it('9. valid trip ID', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 'trip-plan-123', receipt });
    expect(record?.tripId).toBe('trip-plan-123');
  });
  it('10. invalid trip ID', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: '', receipt });
    expectRefused({ tripId: '.', receipt });
    expectRefused({ tripId: '..', receipt });
    expectRefused({ tripId: 'a/b', receipt });
  });
  it('11. empty trip ID', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: '', receipt });
  });
  it('12. padded trip ID', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: ' trip-plan', receipt });
  });
  it('13. case-variant trip ID', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 'Trip-Plan', receipt });
    expect(record?.tripId).toBe('Trip-Plan');
  });
  it('14. deterministic record ID', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 'trip-plan', receipt });
    const expected = `${TRIP_EXECUTION_RECORD_ID_PREFIX}trip-plan:${receipt.id}`;
    expect(record?.id).toBe(expected);
  });
  it('15. same trip + same receipt → same ID', async () => {
    const receipt = await validReceipt();
    const r1 = createTripExecutionRecord({ tripId: 'trip-plan', receipt });
    const r2 = createTripExecutionRecord({ tripId: 'trip-plan', receipt });
    expect(r1?.id).toBe(r2?.id);
  });
  it('16. missing receipt', () => {
    expectRefused({ tripId: 'trip-plan' });
  });
  it('17. malformed receipt', () => {
    expectRefused({ tripId: 'trip-plan', receipt: {} });
  });
  it('18. invalid receipt ID', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: 'trip-plan', receipt: { ...receipt, id: 'bad' } });
  });
  it('19. invalid request ID', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: 'trip-plan', receipt: { ...receipt, requestId: 'bad' } });
  });
  it('20. invalid provider IDs', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: 'trip-plan', receipt: { ...receipt, providerIds: [''] } });
  });
  it('21. malformed provider result', async () => {
    const receipt = await validReceipt();
    expectRefused({ tripId: 'trip-plan', receipt: { ...receipt, results: [{}] } });
  });
  it('22. contradictory receipt state', () => {
    const bad = step76Like({ executed: true, results: [] as unknown[] });
    expect(createTripExecutionOutcomeReceipt(bad)).toBeNull();
    expectRefused({ tripId: 'trip-plan', receipt: bad });
  });
  it('23. trip ID preserved', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(record?.tripId).toBe('t-1');
  });
  it('24. receipt ID preserved', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(record?.receiptId).toBe(receipt.id);
  });
  it('25. request ID preserved', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(record?.requestId).toBe(receipt.requestId);
  });
  it('26. provider IDs preserved', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(record?.providerIds).toEqual(receipt.providerIds);
  });
  it('27. provider result order preserved', async () => {
    const result = await step76For(['accepted', 'rejected']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't-1', receipt: rec });
    expect(record?.results[0].providerId).toBe(ALPHA);
    expect(record?.results[1].providerId).toBe(BETA);
  });
  it('28. receipt status preserved', async () => {
    const result = await step76For(['failed', 'rejected']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't-1', receipt: rec });
    expect(record?.status).toBe(rec.status);
  });
  it('29. receipt executed state preserved', async () => {
    const receipt = await validReceipt();
    const record = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(record?.executed).toBe(receipt.executed);
  });
  it('30. input mutation does not alter record', async () => {
    const receipt = await validReceipt();
    const input = { tripId: 't-1', receipt } as unknown as { tripId: string; receipt: TripExecutionOutcomeReceipt };
    const record = createTripExecutionRecord(input);
    (input as { tripId: string }).tripId = 't-2';
    ((input as { receipt: TripExecutionOutcomeReceipt }).receipt as { id: string }).id = 'changed';
    expect(record?.tripId).toBe('t-1');
  });
  it('31. record providerIds mutation does not alter receipt', async () => {
    const result = await step76For(['accepted']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't-1', receipt: rec });
    if (record) record.providerIds.push('x');
    expect(rec.providerIds).not.toContain('x');
  });
  it('32. record results mutation does not alter receipt', async () => {
    const result = await step76For(['accepted']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't-1', receipt: rec });
    if (record?.results[0].result) {
      (record.results[0].result as { status: string }).status = 'failed';
    }
    expect(rec.results[0].result?.status).toBe('accepted');
  });
  it('33. repeated construction deterministic', async () => {
    const receipt = await validReceipt();
    const r1 = createTripExecutionRecord({ tripId: 't-1', receipt });
    const r2 = createTripExecutionRecord({ tripId: 't-1', receipt });
    expect(r2).toEqual(r1);
  });
  it('34. rejected provider remains rejected', async () => {
    const result = await step76For(['rejected']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.results[0].result?.status).toBe('rejected');
  });
  it('35. failed provider remains failed', async () => {
    const result = await step76For(['failed']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.results[0].result?.status).toBe('failed');
  });
  it('36. unsupported provider remains unsupported', async () => {
    const result = await step76For(['unsupported']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.results[0].result?.status).toBe('unsupported');
  });
  it('37. null remains null', async () => {
    const result = await step76For(['throw']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.status).toBeNull();
  });
  it('38. executed remains true despite provider-level failure', async () => {
    const result = await step76For(['throw']);
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.executed).toBe(true);
  });
  it('39. non-executed remains non-executed', async () => {
    const result = await orchestrate([statusProvider(BETA, 'accepted'), statusProvider(ALPHA, 'accepted')], [ALPHA, BETA], authorizedRequest([ALPHA, BETA]));
    const rec = createTripExecutionOutcomeReceipt(result);
    if (!rec) throw new Error('receipt');
    const record = createTripExecutionRecord({ tripId: 't', receipt: rec });
    expect(record?.executed).toBe(false);
  });
  it('40. no provider execution', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
  });
  it('41. no network', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/fetch\(/);
  });
  it('42. no persistence', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firestore/i);
  });
  it('43. no Firebase', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firebase/i);
  });
  it('44. no React/Router/Zustand', () => {
    for (const ui of ['react', 'react-router', 'zustand']) {
      expect(CODE_WITH_LITERALS).not.toMatch(new RegExp(ui));
    }
  });
  it('45. no environment', () => {
    expect(CODE).not.toMatch(/process\.env|import\.meta\.env/);
  });
  it('46. no clock/randomness', () => {
    expect(CODE).not.toMatch(/Date\(|Math\.random|randomUUID/);
  });
  it('47. no booking/payment/reservation semantics', () => {
    for (const w of ['booking', 'payment', 'reservation', 'booked', 'purchase', 'ticket', 'invoice', 'transaction']) {
      expect(CODE).not.toMatch(new RegExp(w, 'i'));
    }
  });
  it('48. no provider selection', () => {
    expect(CODE).not.toContain('provider selection');
  });
  it('49. no capability evaluation', () => {
    expect(CODE).not.toMatch(/capability.*evaluate/i);
  });
  it('50. no trip mutation', () => {
    expect(CODE).not.toMatch(/updateTrip|mutat.*trip|itinerary.*mutat/);
  });

  it('51. reuses Step 77 isTripExecutionOutcomeReceipt validator', () => {
    expect(CODE_WITH_LITERALS).toContain('isTripExecutionOutcomeReceipt');
    expect(CODE_WITH_LITERALS).toMatch(/isTripExecutionOutcomeReceipt\s*\(/);
  });

  it('52. reuses existing trip/storage identity validator', () => {
    expect(CODE_WITH_LITERALS).toContain('isValidStorageId');
    expect(CODE_WITH_LITERALS).toMatch(/isValidStorageId\s*\(/);
    expect(CODE_WITH_LITERALS).not.toMatch(/export\s+function\s+isValidTripId\s*\(/);
    expect(CODE_WITH_LITERALS).not.toMatch(/const\s+isValidTripId\s*=/);
  });

  it('53. contains no provider object input', () => {
    expect(CODE_WITH_LITERALS).toContain('input: unknown');
    expect(CODE_WITH_LITERALS).not.toMatch(/provider.*Provider\b/);
  });

  it('54. performs no provider execution', () => {
    expect(CODE).not.toMatch(/\.execute\s*\(/);
    expect(CODE).not.toMatch(/executeTripExecution/);
  });

  it('55. performs no network access', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/fetch\(|XMLHttpRequest|axios|http(s)?:\/\//);
  });

  it('56. performs no persistence', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firestore|addDoc|setDoc|updateDoc|deleteDoc|localStorage|indexedDB|sessionStorage/);
  });

  it('57. has no Firebase/Firestore dependency', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/firebase/i);
    expect(CODE_WITH_LITERALS).not.toMatch(/firestore/i);
  });

  it('58. has no React/Router/Zustand dependency', () => {
    expect(CODE_WITH_LITERALS).not.toMatch(/from ['"]react|react-router|zustand/);
  });

  it('59. has no environment access', () => {
    expect(CODE).not.toMatch(/process\.env|import\.meta\.env|Deno\.env/);
  });

  it('60. has no clock/randomness', () => {
    expect(CODE).not.toMatch(/Date\(|Math\.random|randomUUID|performance\./);
    expect(CODE).not.toMatch(/setTimeout|setInterval/);
  });

  it('61. contains no booking/payment/reservation/commerce execution semantics', () => {
    const commerce = ['booking', 'booked', 'payment', 'purchase', 'reservation', 'reserve', 'ticket', 'invoice', 'refund', 'cancellation', 'transaction', 'charge'];
    for (const w of commerce) {
      expect(CODE).not.toMatch(new RegExp(w, 'i'));
    }
  });

  it('62. does not perform trip mutation', () => {
    expect(CODE).not.toMatch(/updateTrip|mutat.*trip|itinerary.*mutat/);
  });

  it('63. does not duplicate Step 77 receipt validation/status semantics', () => {
    expect(CODE_WITH_LITERALS).toContain('isTripExecutionOutcomeReceipt');
    expect(CODE_WITH_LITERALS).not.toMatch(/TRIP_EXECUTION_OUTCOME_RECEIPT_REASONS\s*=\s*\[/);
    expect(CODE_WITH_LITERALS).not.toContain('getTripExecutionAggregateStatus');
  });
});
