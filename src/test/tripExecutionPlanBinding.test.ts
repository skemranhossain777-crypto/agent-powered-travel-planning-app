import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX,
  TRIP_EXECUTION_PLAN_BINDING_KIND,
  createTripExecutionPlanBinding,
  getTripExecutionPlanBindingId,
  isTripExecutionPlanBinding,
  resolveTripExecutionPlanProviders,
  type TripExecutionPlanBinding,
} from '../services/tripExecution/tripExecutionPlanBinding';
import {
  TRIP_EXECUTION_PLAN_ID_PREFIX,
  createTripExecutionPlan,
  getTripExecutionPlanId,
  type TripExecutionPlan,
} from '../services/tripExecution/tripExecutionPlan';
import { mockTripExecutionProvider } from '../services/tripExecution/mockTripExecutionProvider';
import { type TripExecutionCapabilityProvider } from '../services/tripExecution/tripExecutionCapability';
import {
  createTripExecutionDispatchInstruction,
  type TripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProvider,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
} from '../services/tripExecution/tripExecutionProvider';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripPlanningExecutionRequest } from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };

function placeReference(overrides: Record<string, unknown> = {}): TripPlanningReference {
  return {
    id: 'place:alpha',
    title: 'Alpha Place',
    kind: 'activity',
    provider: 'Test Provider',
    providerId: 'alpha-1',
    ...overrides,
  } as TripPlanningReference;
}

function createProviderRequest(dispatch: TripExecutionDispatchInstruction): TripExecutionProviderRequest {
  return {
    id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`,
    kind: 'trip-execution-provider-request',
    dispatchId: dispatch.id,
  } as TripExecutionProviderRequest;
}

function validRequest(tripId = 'trip-binding'): TripExecutionProviderRequest {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  const proposal = createTripPlanningCompositionProposal(composition);
  if (proposal === null) throw new Error('test setup: proposal missing');
  const approved = approveTripPlanningCompositionProposal(proposal);
  const application = createTripPlanningApplication(approved as never);
  if (application === null) throw new Error('test setup: application missing');
  const target = createTripPlanningApplicationTarget({ scope: 'trip', tripId });
  if (target === null) throw new Error('test setup: target missing');
  const bind = createTripPlanningApplicationBinding(application, target);
  if (bind === null) throw new Error('test setup: binding missing');
  const intent = createTripPlanningExecutionIntent(bind);
  if (intent === null) throw new Error('test setup: intent missing');
  const executionRequest = createTripPlanningExecutionRequest(intent);
  if (executionRequest === null) throw new Error('test setup: execution request missing');
  const authorization = createTripPlanningExecutionAuthorization(executionRequest);
  if (authorization === null) throw new Error('test setup: authorization missing');
  const dispatch = createTripExecutionDispatchInstruction(authorization);
  if (dispatch === null) throw new Error('test setup: dispatch missing');
  return createProviderRequest(dispatch);
}

function executionOnlyProvider(providerId: string, log: string[] = []): TripExecutionProvider {
  return {
    providerId,
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  };
}

function capabilityAwareProvider(
  providerId: string,
  verdict: boolean,
  log: string[] = []
): TripExecutionCapabilityProvider {
  return {
    providerId,
    supports(request: TripExecutionProviderRequest): boolean {
      void request;
      log.push(`supports:${providerId}`);
      return verdict;
    },
    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      log.push(`execute:${providerId}`);
      return Promise.resolve({ providerId, requestId: request.id, status: 'accepted' });
    },
  };
}

function makePlan(providers: TripExecutionProvider[], tripId = 'trip-binding'): TripExecutionPlan {
  const plan = createTripExecutionPlan(validRequest(tripId), providers);
  if (plan === null) throw new Error('test setup: plan missing');
  return plan;
}

function rawPlanOverrides(overrides: Record<string, unknown>): TripExecutionPlan {
  const plan = makePlan([mockTripExecutionProvider]);
  return { ...plan, ...overrides } as unknown as TripExecutionPlan;
}

function buildBinding(
  plan = makePlan([mockTripExecutionProvider]),
  providers: TripExecutionProvider[] = [mockTripExecutionProvider]
): TripExecutionPlanBinding {
  const binding = createTripExecutionPlanBinding(plan, providers);
  if (binding === null) throw new Error('test setup: binding missing');
  return binding;
}

describe('STEP 64 binding: contract', () => {
  it('1. valid single-provider binding', () => {
    const binding = buildBinding();
    expect(binding).not.toBeNull();
    expect(binding.kind).toBe(TRIP_EXECUTION_PLAN_BINDING_KIND);
    expect(binding.providerIds).toEqual(['mock-execution']);
  });

  it('2. valid multi-provider binding', () => {
    const providers = [mockTripExecutionProvider, executionOnlyProvider('provider-only')];
    const binding = buildBinding(makePlan(providers), providers);
    expect(binding.providerIds).toEqual(['mock-execution', 'provider-only']);
  });

  it('3. exact provider ordering preserved', () => {
    const providers = [
      executionOnlyProvider('provider-z'),
      mockTripExecutionProvider,
      executionOnlyProvider('provider-a'),
    ];
    const binding = buildBinding(makePlan(providers), providers);
    expect(binding.providerIds).toEqual(['provider-z', 'mock-execution', 'provider-a']);
  });

  it('4. exact plan provider IDs preserved', () => {
    const plan = makePlan([mockTripExecutionProvider, executionOnlyProvider('provider-only')]);
    const binding = buildBinding(plan, [mockTripExecutionProvider, executionOnlyProvider('provider-only')]);
    expect(binding.providerIds).toEqual(plan.providerIds);
  });

  it('5. deterministic binding ID', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const binding = buildBinding(plan);
    expect(binding.id).toBe(getTripExecutionPlanBindingId(plan.id));
    expect(binding.id).toBe(`${TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX}${plan.id}`);
  });

  it('6. request ID preserved', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const binding = buildBinding(plan);
    expect(binding.requestId).toBe(plan.requestId);
  });

  it('37. repeated creation is deterministic', () => {
    const plan = makePlan([mockTripExecutionProvider, executionOnlyProvider('provider-only')]);
    const providers = [mockTripExecutionProvider, executionOnlyProvider('provider-only')];
    const first = createTripExecutionPlanBinding(plan, providers);
    const again = createTripExecutionPlanBinding(plan, providers);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('38. JSON round-trip preserves semantics', () => {
    const binding = buildBinding();
    const restored = JSON.parse(JSON.stringify(binding)) as TripExecutionPlanBinding;
    expect(JSON.stringify(restored)).toBe(JSON.stringify(binding));
    expect(isTripExecutionPlanBinding(restored)).toBe(true);
  });

  it('empty eligible plan yields an empty binding', () => {
    const plan = makePlan([capabilityAwareProvider('provider-no', false)]);
    const binding = buildBinding(plan, []);
    expect(binding.providerIds).toEqual([]);
    expect(isTripExecutionPlanBinding(binding)).toBe(true);
  });

  it('binding carries only the five contract fields', () => {
    const binding = buildBinding();
    expect(Object.keys(binding).sort()).toEqual([
      'id',
      'kind',
      'planId',
      'providerIds',
      'requestId',
    ]);
  });
});

describe('STEP 64 binding: validator', () => {
  it('7. valid binding validator', () => {
    expect(isTripExecutionPlanBinding(buildBinding())).toBe(true);
  });

  it('8. malformed binding rejected', () => {
    for (const value of [null, undefined, 'string', 42, [], {}]) {
      expect(isTripExecutionPlanBinding(value)).toBe(false);
    }
  });

  it('9. wrong binding kind rejected', () => {
    const binding = { ...buildBinding(), kind: 'trip-execution-plan' } as unknown;
    expect(isTripExecutionPlanBinding(binding)).toBe(false);
  });

  it('10. incorrect binding ID rejected', () => {
    const wrongId = { ...buildBinding(), id: 'trip-execution-plan-binding:stray' } as unknown;
    const foreignPrefix = { ...buildBinding(), id: 'trip-execution-plan:xyz' } as unknown;
    const barePrefix = { ...buildBinding(), id: TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX } as unknown;
    expect(isTripExecutionPlanBinding(wrongId)).toBe(false);
    expect(isTripExecutionPlanBinding(foreignPrefix)).toBe(false);
    expect(isTripExecutionPlanBinding(barePrefix)).toBe(false);
  });

  it('11. mismatched plan ID rejected', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const other = makePlan([executionOnlyProvider('provider-only')], 'trip-other');
    const idOnlyMismatch = {
      ...buildBinding(plan),
      planId: other.id,
      id: getTripExecutionPlanBindingId(other.id),
    } as unknown;
    expect(isTripExecutionPlanBinding(idOnlyMismatch)).toBe(false);
    const nonPlan = { ...buildBinding(plan), planId: 'trip-execution-dispatcher:x' } as unknown;
    expect(isTripExecutionPlanBinding(nonPlan)).toBe(false);
  });

  it('12. mismatched request ID rejected', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const other = makePlan([mockTripExecutionProvider], 'trip-other');
    const mismatched = { ...buildBinding(plan), requestId: other.requestId } as unknown;
    expect(isTripExecutionPlanBinding(mismatched)).toBe(false);
  });

  it('validator rejects an invalid/malformed request ID', () => {
    const nonRequest = { ...buildBinding(), requestId: 'not-a-request-id' } as unknown;
    const barePrefix = {
      ...buildBinding(),
      requestId: TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
    } as unknown;
    const nonString = { ...buildBinding(), requestId: 42 } as unknown;
    expect(isTripExecutionPlanBinding(nonRequest)).toBe(false);
    expect(isTripExecutionPlanBinding(barePrefix)).toBe(false);
    expect(isTripExecutionPlanBinding(nonString)).toBe(false);
  });

  it('13. invalid provider ID rejected', () => {
    expect(isTripExecutionPlanBinding({ ...buildBinding(), providerIds: [' spaced'] } as unknown)).toBe(false);
    expect(isTripExecutionPlanBinding({ ...buildBinding(), providerIds: [''] } as unknown)).toBe(false);
    expect(isTripExecutionPlanBinding({ ...buildBinding(), providerIds: ['a'.repeat(120)] } as unknown)).toBe(false);
    expect(isTripExecutionPlanBinding({ ...buildBinding(), providerIds: [42] } as unknown)).toBe(false);
    expect(isTripExecutionPlanBinding({ ...buildBinding(), providerIds: 'mock-execution' } as unknown)).toBe(false);
  });

  it('binding identity is deterministic: requestId derives planId, planId derives binding id', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const binding = buildBinding(plan);
    expect(getTripExecutionPlanId(binding.requestId)).toBe(binding.planId);
    expect(getTripExecutionPlanBindingId(binding.planId)).toBe(binding.id);
  });

  it('validator accepts validator-shaped binding with duplicate ids (structural only)', () => {
    const binding = { ...buildBinding(), providerIds: ['mock-execution', 'mock-execution'] } as unknown;
    expect(isTripExecutionPlanBinding(binding)).toBe(true);
  });
});

describe('STEP 64 binding: exact identity matching', () => {
  it('14. missing provider rejected', () => {
    const plan = makePlan([mockTripExecutionProvider, executionOnlyProvider('provider-only')]);
    const result = createTripExecutionPlanBinding(plan, [mockTripExecutionProvider]);
    expect(result).toBeNull();
  });

  it('15. extra provider rejected', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const result = createTripExecutionPlanBinding(plan, [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-extra'),
    ]);
    expect(result).toBeNull();
  });

  it('16. duplicate provider identity rejected', () => {
    const plan = dataPlanWithDuplicates();
    const result = createTripExecutionPlanBinding(plan, [mockTripExecutionProvider]);
    expect(result).toBeNull();
    const duplicateSupplied = createTripExecutionPlanBinding(makePlan([mockTripExecutionProvider]), [
      mockTripExecutionProvider,
      mockTripExecutionProvider,
    ]);
    expect(duplicateSupplied).toBeNull();
  });

  it('duplicate plan identity rejected even with a matching-size provider set', () => {
    const plan = rawPlanOverrides({ providerIds: ['provider-a', 'provider-a'] });
    const result = createTripExecutionPlanBinding(plan, [
      executionOnlyProvider('provider-a'),
      executionOnlyProvider('provider-other'),
    ]);
    expect(result).toBeNull();
  });

  it('missing identity rejected even when provider set size matches', () => {
    const plan = makePlan([executionOnlyProvider('provider-a'), executionOnlyProvider('provider-b')]);
    const result = createTripExecutionPlanBinding(plan, [
      executionOnlyProvider('provider-a'),
      executionOnlyProvider('provider-c'),
    ]);
    expect(result).toBeNull();
  });

  it('defensive: non-array provider list rejected', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    expect(createTripExecutionPlanBinding(plan, null as never)).toBeNull();
    const binding = buildBinding(plan);
    expect(resolveTripExecutionPlanProviders(binding, null as never)).toBeNull();
  });

  it('defensive: malformed plan rejected', () => {
    expect(createTripExecutionPlanBinding(null, [mockTripExecutionProvider])).toBeNull();
    expect(createTripExecutionPlanBinding('string', [mockTripExecutionProvider])).toBeNull();
    expect(createTripExecutionPlanBinding({ id: 'x', kind: 'other' }, [mockTripExecutionProvider])).toBeNull();
    expect(createTripExecutionPlanBinding(42, [mockTripExecutionProvider])).toBeNull();
  });

  it('17. provider identity matching is exact', () => {
    const providers = [
      executionOnlyProvider('provider-a'),
      capabilityAwareProvider('provider-b', true),
    ];
    const plan = makePlan(providers);
    const binding = buildBinding(plan, providers);
    expect(binding.providerIds).toEqual(['provider-a', 'provider-b']);
  });

  it('18. case variation does not match', () => {
    const plan = makePlan([executionOnlyProvider('provider-a')]);
    const result = createTripExecutionPlanBinding(plan, [executionOnlyProvider('Provider-A')]);
    expect(result).toBeNull();
  });

  it('19. whitespace variation does not match', () => {
    const plan = makePlan([executionOnlyProvider('provider-a')]);
    const result = createTripExecutionPlanBinding(plan, [executionOnlyProvider('provider-a ')]);
    expect(result).toBeNull();
  });

  it('20. no provider substitution', () => {
    const a = executionOnlyProvider('provider-a');
    const b = executionOnlyProvider('provider-b');
    const plan = makePlan([a, b]);
    const binding = buildBinding(plan, [a, b]);
    const resolved = resolveTripExecutionPlanProviders(binding, [a, b]);
    expect(resolved![0]).toBe(a);
    expect(resolved![1]).toBe(b);
  });

  it('21. no provider aliasing', () => {
    const plan = makePlan([executionOnlyProvider('provider-a')]);
    const alias = executionOnlyProvider('provider-alias');
    const result = createTripExecutionPlanBinding(plan, [alias]);
    expect(result).toBeNull();
  });

  it('22. no automatic provider discovery', () => {
    const plan = makePlan([mockTripExecutionProvider, executionOnlyProvider('provider-only')]);
    const result = createTripExecutionPlanBinding(plan, [mockTripExecutionProvider]);
    expect(result).toBeNull();
  });

  it('23. no provider creation', () => {
    const plan = makePlan([executionOnlyProvider('provider-a')]);
    const result = createTripExecutionPlanBinding(plan, []);
    expect(result).toBeNull();
  });

  it('24. no provider removal', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const result = createTripExecutionPlanBinding(plan, [
      mockTripExecutionProvider,
      executionOnlyProvider('provider-extra'),
    ]);
    expect(result).toBeNull();
  });

  it('25. no provider sorting', () => {
    const providers = [
      executionOnlyProvider('provider-z'),
      executionOnlyProvider('provider-a'),
      executionOnlyProvider('provider-m'),
    ];
    const plan = makePlan(providers);
    const binding = buildBinding(plan, providers);
    expect(binding.providerIds).toEqual(['provider-z', 'provider-a', 'provider-m']);
  });

  it('26. plan order overrides supplied provider-array order', () => {
    const a = executionOnlyProvider('provider-a');
    const b = executionOnlyProvider('provider-b');
    const plan = makePlan([a, b]);
    const binding = buildBinding(plan, [b, a]);
    expect(binding.providerIds).toEqual(['provider-a', 'provider-b']);
    const resolved = resolveTripExecutionPlanProviders(binding, [b, a]);
    expect(resolved!.map((provider) => provider.providerId)).toEqual(['provider-a', 'provider-b']);
  });

  it('malformed provider object rejected (not fatal)', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const result = createTripExecutionPlanBinding(plan, [null as never]);
    expect(result).toBeNull();
    const noExecute = createTripExecutionPlanBinding(plan, [{ providerId: 'mock-execution' } as never]);
    expect(noExecute).toBeNull();
  });
});

describe('STEP 64 binding: resolve helper', () => {
  it('27. resolve helper returns exact ordered providers', () => {
    const a = executionOnlyProvider('provider-a');
    const b = capabilityAwareProvider('provider-b', true);
    const plan = makePlan([a, b]);
    const binding = buildBinding(plan, [a, b]);
    const resolved = resolveTripExecutionPlanProviders(binding, [a, b]);
    expect(resolved!.map((provider) => provider.providerId)).toEqual(['provider-a', 'provider-b']);
  });

  it('28. resolve helper rejects invalid binding', () => {
    const a = executionOnlyProvider('provider-a');
    for (const value of [null, 'string', { id: 'x', kind: 'y' }]) {
      expect(resolveTripExecutionPlanProviders(value, [a])).toBeNull();
    }
  });

  it('29. resolve helper rejects missing provider', () => {
    const a = executionOnlyProvider('provider-a');
    const b = executionOnlyProvider('provider-b');
    const binding = buildBinding(makePlan([a, b]), [a, b]);
    expect(resolveTripExecutionPlanProviders(binding, [a])).toBeNull();
  });

  it('30. resolve helper rejects extra provider', () => {
    const a = executionOnlyProvider('provider-a');
    const binding = buildBinding(makePlan([a]), [a]);
    expect(resolveTripExecutionPlanProviders(binding, [a, executionOnlyProvider('provider-extra')])).toBeNull();
  });

  it('31. resolve helper rejects identity mismatch', () => {
    const a = executionOnlyProvider('provider-a');
    const binding = buildBinding(makePlan([a]), [a]);
    expect(resolveTripExecutionPlanProviders(binding, [executionOnlyProvider('Provider-A')])).toBeNull();
  });

  it('resolve helper accepts an empty binding', () => {
    const plan = makePlan([capabilityAwareProvider('provider-no', false)]);
    const binding = buildBinding(plan, []);
    expect(resolveTripExecutionPlanProviders(binding, [])).toEqual([]);
  });

  it('resolve helper does not mutate input', () => {
    const a = executionOnlyProvider('provider-a');
    const b = executionOnlyProvider('provider-b');
    const binding = buildBinding(makePlan([a, b]), [a, b]);
    const snapshot = JSON.stringify(binding);
    expect(resolveTripExecutionPlanProviders(binding, [a, b])).not.toBeNull();
    expect(JSON.stringify(binding)).toBe(snapshot);
  });
});

describe('STEP 64 binding: purity and no-execution', () => {
  it('32. resolve helper does not call execute', () => {
    const log: string[] = [];
    const a = executionOnlyProvider('provider-a', log);
    const plan = makePlan([a]);
    const binding = buildBinding(plan, [a]);
    const resolved = resolveTripExecutionPlanProviders(binding, [a]);
    expect(resolved).not.toBeNull();
    expect(log).toEqual([]);
  });

  it('33. binding creation does not call execute', () => {
    const log: string[] = [];
    const a = executionOnlyProvider('provider-a', log);
    const plan = makePlan([a]);
    const binding = createTripExecutionPlanBinding(plan, [a]);
    expect(binding).not.toBeNull();
    expect(log).toEqual([]);
  });

  it('34. binding creation does not call orchestrator', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionPlanBinding.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/orchestrateTripExecution/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*tripExecutionOrchestrator/i);
  });

  it('35. provider array not mutated', () => {
    const a = executionOnlyProvider('provider-a');
    const b = executionOnlyProvider('provider-b');
    const providers = [a, b];
    const snapshot = JSON.stringify(providers);
    const plan = makePlan(providers);
    createTripExecutionPlanBinding(plan, providers);
    expect(JSON.stringify(providers)).toBe(snapshot);
  });

  it('36. provider objects not mutated', () => {
    const a = executionOnlyProvider('provider-a');
    const snapshot = JSON.stringify(a);
    const plan = makePlan([a]);
    createTripExecutionPlanBinding(plan, [a]);
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('binding creation does not mutate the plan', () => {
    const plan = makePlan([mockTripExecutionProvider]);
    const snapshot = JSON.stringify(plan);
    createTripExecutionPlanBinding(plan, [mockTripExecutionProvider]);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe('STEP 64 binding: ID-space distinctness', () => {
  it('39. binding ID space distinct from plan ID', () => {
    expect(TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX).toBe('trip-execution-plan-binding:');
    expect(TRIP_EXECUTION_PLAN_BINDING_ID_PREFIX).not.toBe(TRIP_EXECUTION_PLAN_ID_PREFIX);
    const plan = makePlan([mockTripExecutionProvider]);
    const binding = buildBinding(plan);
    expect(binding.id).not.toBe(plan.id);
    expect(getTripExecutionPlanBindingId(plan.id)).not.toBe(getTripExecutionPlanId(plan.requestId));
    expect(binding.id.startsWith(TRIP_EXECUTION_PLAN_ID_PREFIX)).toBe(false);
  });

  it('40. binding ID space distinct from provider IDs', () => {
    const a = executionOnlyProvider('provider-a');
    const plan = makePlan([a]);
    const binding = buildBinding(plan, [a]);
    for (const providerId of binding.providerIds) {
      expect(binding.id).not.toBe(providerId);
      expect(binding.id.startsWith(providerId)).toBe(false);
    }
    expect(binding.id.startsWith('trip-execution-provider-request:')).toBe(false);
  });
});

describe('STEP 64 binding: module boundary scans', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionPlanBinding.ts'),
    'utf8'
  );

  it('imports only execution/domain contracts', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionPlan',
      './tripExecutionProvider',
    ]);
  });

  it('41. no booking data', () => {
    expect(source).not.toMatch(/createBooking|bookingRef|reservationId|ticketNumber|confirmationCode/i);
    expect(source).not.toMatch(/inventoryCount|stockLevel|priceList|seatClass/i);
  });

  it('42. no payment data', () => {
    expect(source).not.toMatch(/charge|payment-intent|checkout|paymentMethod|\bstripe\b|refund|invoice/i);
  });

  it('43. no credentials', () => {
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|Bearer\s|x-goog-api-key/i);
    expect(source).not.toMatch(/providerUrl|externalRef|authorizationHeader/i);
  });

  it('44. no network', () => {
    expect(source).not.toMatch(/fetch\s*\(|axios|new\s+WebSocket|XMLHttpRequest/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiKey/i);
  });

  it('45. no Firebase and 54. no persistence', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction|getFirestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/i);
  });

  it('46. no Google Places and 47. no Google Routes', () => {
    expect(source).not.toMatch(/googlePlaces|googlePlacesService|googlePlacesAdapter/i);
    expect(source).not.toMatch(/googleRoutes|googleRoutesService|googleRoutesAdapter/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(googleRoutes|googlePlaces)/i);
  });

  it('48. no Amadeus', () => {
    expect(source).not.toMatch(/amadeus|realDiscovery/i);
  });

  it('49. no AI', () => {
    expect(source).not.toMatch(/gemini|aiPlanningService|generativeLanguage|aiTravelAgent/i);
  });

  it('50. no environment dependency', () => {
    expect(source).not.toMatch(/process\.env|import\.meta\.env|\benv\s*\(/i);
  });

  it('51. no clock', () => {
    expect(source).not.toMatch(/\bDate\.now\(|new\s+Date\(/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime|setTimeout|setInterval/i);
  });

  it('52. no randomness', () => {
    expect(source).not.toMatch(/Math\.random|crypto\.randomUUID|\buuid\b/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\.|globalThis/i);
  });

  it('53. no global mutable state', () => {
    expect(source).not.toMatch(/let\s+\w+\s*=\s*0|var\s+\w+\s*=\s*0/i);
    expect(source).not.toMatch(/useState\(|setState\(|moduleScope|increment\(|\+\+/i);
  });

  it('55. no trip mutation and 56. no itinerary mutation', () => {
    expect(source).not.toMatch(/updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/i);
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/i);
  });

  it('57. no lifecycle mutation', () => {
    expect(source).not.toMatch(/executing|pending-execution|completed|cancelled|refunded/i);
    expect(source).not.toMatch(/\bbooked\b|\bexecuted\b|executionStatus|markApply/i);
    expect(source).not.toMatch(/updateTripStatus\(/);
  });

  it('58. no execution side effects', () => {
    expect(source).not.toMatch(/\.execute\(/);
    expect(source).not.toMatch(/provider\.execute|await\s+\w+\.execute/i);
    expect(source).not.toMatch(/supports\(/);
  });

  it('no orchestration, registration, registry, retry, rollback, or compensation', () => {
    expect(source).not.toMatch(/orchestrateTripExecution|registerProvider|providerRegistry/i);
    expect(source).not.toMatch(/retry|backoff|deadLetter|rollback|compensa/i);
  });

  it('no React, Router, or Zustand', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.?[\\/](components|pages)/i);
  });
});

function dataPlanWithDuplicates(): TripExecutionPlan {
  return rawPlanOverrides({ providerIds: ['mock-execution', 'mock-execution'] });
}