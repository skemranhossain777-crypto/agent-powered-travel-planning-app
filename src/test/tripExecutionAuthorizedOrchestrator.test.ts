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
import {
  createTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import { createTripPlanningExecutionAuthorization } from '../domain/trips/tripPlanningExecutionAuthorization';
import { createTripExecutionPlan } from '../services/tripExecution/tripExecutionPlan';
import { createTripExecutionDispatchInstruction } from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripExecutionProviderRequest,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { createTripExecutionQualifiedAuthorization } from '../services/tripExecution/tripExecutionQualifiedAuthorization';
import { createTripExecutionAuthorizedRequest } from '../services/tripExecution/tripExecutionAuthorizedRequest';
import {
  orchestrateTripExecutionAuthorizedRequest,
  TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS,
  type TripExecutionAuthorizedOrchestrationResult,
} from '../services/tripExecution/tripExecutionAuthorizedOrchestrator';
import { TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS } from '../services/tripExecution/tripExecutionAuthorizedExecution';
import { MAX_PROVIDER_ID_LENGTH } from '../domain/providers/providerResults';
import { getTripExecutionAggregateStatus } from '../services/tripExecution/tripExecutionOrchestrator';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';
/** Test-owned provider identities. Never a real provider. */
const ALPHA = 'alpha-execution';
const BETA = 'beta-execution';
const GAMMA = 'gamma-execution';
const UNAPPROVED = 'unapproved-execution';
/** A secret the fake providers "leak" on failure, to prove nothing escapes. */
const SECRET = 'amadeus-live-key-9f2c://internal-provider-stack-frame';

const ORCHESTRATOR_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionAuthorizedOrchestrator.ts'
);
const STEP75_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionAuthorizedExecution.ts'
);
const SOURCE = readFileSync(ORCHESTRATOR_PATH, 'utf8');
const STEP75_SOURCE = readFileSync(STEP75_PATH, 'utf8');
/** Comments and string literals removed, so a code assertion cannot be fooled by prose. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
/** Comments removed, literals intact, so import paths can be enumerated. */
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

function requireValue<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} missing`);
  return value;
}

/** The real STEP 56 request, built through the real domain chain. */
function validStep56Request(tripId = 'trip-plan'): TripPlanningExecutionRequest {
  const composition = requireValue(
    createTripPlanningComposition({
      origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
      destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
    }),
    'composition'
  );
  const approved = requireValue(
    approveTripPlanningCompositionProposal(
      requireValue(createTripPlanningCompositionProposal(composition), 'proposal')
    ),
    'approved'
  );
  const application = requireValue(createTripPlanningApplication(approved), 'application');
  const target = requireValue(
    createTripPlanningApplicationTarget({ scope: 'trip', tripId }),
    'target'
  );
  const binding = requireValue(createTripPlanningApplicationBinding(application, target), 'binding');
  const intent = requireValue(createTripPlanningExecutionIntent(binding), 'intent');
  return requireValue(createTripPlanningExecutionRequest(intent), 'step56 request');
}

/** The real STEP 59 provider request, through the real STEP 57 and STEP 58 factories. */
function providerRequestFor(tripId = 'trip-plan'): TripExecutionProviderRequest {
  const authorization = requireValue(
    createTripPlanningExecutionAuthorization(validStep56Request(tripId)),
    'authorization'
  );
  const dispatch = requireValue(createTripExecutionDispatchInstruction(authorization), 'dispatch');
  return requireValue(createTripExecutionProviderRequest(dispatch), 'provider request');
}

/** A real STEP 63 plan, built by the genuine factory. */
function validPlan(providerIds: ReadonlyArray<string> = [ALPHA], tripId = 'trip-plan') {
  const providers = providerIds.map((providerId) => ({
    providerId,
    async execute() {
      return Promise.resolve({ providerId, requestId: 'unused', status: 'accepted' as const });
    },
  }));
  return requireValue(
    createTripExecutionPlan(providerRequestFor(tripId), providers),
    'plan'
  );
}

/** A genuine STEP 72 qualified dispatch, from the real STEP 71 and STEP 72 evaluators. */
function validDispatch(
  providerIds: ReadonlyArray<string> = [ALPHA],
  tripId = 'trip-plan'
): Record<string, unknown> {
  const request = validStep56Request(tripId);
  const plan = validPlan(providerIds, tripId);
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: {
      eligible: true,
      requestId: request.id,
      requiredCapabilityId: CAPABILITY,
      providerIds: [...plan.providerIds],
      capabilityIds: [CAPABILITY],
      reason: 'eligible',
    },
  });
  if (!qualification.qualified) throw new Error('test setup: fixture did not qualify');

  const qualified = createTripExecutionQualifiedDispatch({ qualification });
  if (!qualified.dispatched) {
    throw new Error(`test setup: fixture did not dispatch (${qualified.reason})`);
  }
  return {
    ...qualified,
    dispatch: { ...qualified.dispatch },
    providerIds: [...qualified.providerIds],
  } as Record<string, unknown>;
}

/** A real STEP 72 negative result, straight from the evaluator. */
function negativeDispatch(): Record<string, unknown> {
  const request = validStep56Request();
  const plan = validPlan();
  const qualification = evaluateTripExecutionPlanQualification({
    plan,
    eligibility: {
      eligible: false,
      requestId: request.id,
      requiredCapabilityId: null,
      providerIds: [],
      capabilityIds: [],
      reason: 'no-eligible-provider',
    },
  });
  return { ...createTripExecutionQualifiedDispatch({ qualification }) } as Record<string, unknown>;
}

/**
 * A genuine STEP 74 authorized-request result, from the real STEP 74 boundary over
 * a genuine STEP 73 authorization of a genuine STEP 72 dispatch. Deep-copied so
 * mutation tests have a real object to prove against.
 */
function authorizedRequest(providerIds: ReadonlyArray<string> = [ALPHA]): Record<string, unknown> {
  const authorized = createTripExecutionQualifiedAuthorization({
    dispatch: validDispatch(providerIds),
  });
  if (!authorized.authorized) {
    throw new Error(`test setup: fixture not authorized (${authorized.reason})`);
  }
  const request = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (!request.accepted) throw new Error(`test setup: fixture not accepted (${request.reason})`);
  return {
    ...request,
    providerRequest: { ...(request.providerRequest as TripExecutionProviderRequest) },
    providerIds: [...request.providerIds],
  } as unknown as Record<string, unknown>;
}

/** A genuine STEP 74 negative result: well-formed, unaccepted. */
function unacceptedRequest(): Record<string, unknown> {
  const authorized = createTripExecutionQualifiedAuthorization({ dispatch: negativeDispatch() });
  if (authorized.authorized) throw new Error('test setup: fixture unexpectedly authorized');
  const request = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (request.accepted) throw new Error('test setup: negative fixture unexpectedly accepted');
  return { ...request, providerIds: [...request.providerIds] } as Record<string, unknown>;
}

/** A genuine STEP 74 result with one field replaced, to isolate a specific fault. */
function requestWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...authorizedRequest(), ...overrides };
}

type Respond = (request: TripExecutionProviderRequest) => unknown;

/**
 * A deterministic recording fake implementing the STEP 59 provider contract, plus
 * a shared trace so multi-provider order is observable. The only things it can do
 * are record its calls and return or raise what it was told to. It reaches no
 * network, holds no credential, and books, pays, and reserves nothing.
 */
function fakeProvider(providerId: string, respond?: Respond, trace?: string[]): {
  provider: Record<string, unknown>;
  calls: TripExecutionProviderRequest[];
  name: string;
} {
  const calls: TripExecutionProviderRequest[] = [];
  return {
    calls,
    name: providerId,
    provider: {
      providerId,
      async execute(request: TripExecutionProviderRequest): Promise<unknown> {
        calls.push(request);
        trace?.push(providerId);
        if (respond) return respond(request);
        return { providerId, requestId: request.id, status: 'accepted' as const };
      },
    },
  };
}

/** A fake answering with a specific STEP 59 status. */
function statusProvider(providerId: string, status: 'accepted' | 'rejected' | 'unsupported' | 'failed', trace?: string[]) {
  return fakeProvider(providerId, (r) => ({ providerId, requestId: r.id, status }), trace);
}

/** A fake whose execute throws synchronously. */
function throwingProvider(providerId: string, trace?: string[]) {
  return {
    calls: [] as TripExecutionProviderRequest[],
    name: providerId,
    provider: {
      providerId,
      execute(): unknown {
        trace?.push(providerId);
        throw new Error(SECRET);
      },
    },
  };
}

/** A fake whose execute returns a rejected promise. */
function rejectingProvider(providerId: string, trace?: string[]) {
  return fakeProvider(providerId, () => Promise.reject(new Error(SECRET)), trace);
}

function run(request: unknown, providers: unknown): Promise<TripExecutionAuthorizedOrchestrationResult> {
  return orchestrateTripExecutionAuthorizedRequest({ request, providers });
}

/** The provider objects of a fake set, in the same order. */
function objects(...fakes: Array<{ provider: Record<string, unknown> }>): unknown[] {
  return fakes.map((fake) => fake.provider);
}

/** Asserts the three facts that together mean "no provider was invoked". */
function expectZeroExecution(
  result: TripExecutionAuthorizedOrchestrationResult,
  label: string
): void {
  expect(result.executed, label).toBe(false);
  expect(result.results, label).toEqual([]);
  expect(result.providerIds, label).toEqual([]);
  expect(result.status, label).toBeNull();
}

describe('STEP 76 orchestration: preflight validation (1-15)', () => {
  it('1. a valid single-provider authorization orchestrates one provider', async () => {
    const request = authorizedRequest([ALPHA]);
    const alpha = fakeProvider(ALPHA);
    const result = await run(request, [alpha.provider]);

    expect(result.executed).toBe(true);
    expect(result.reason).toBe('orchestrated');
    expect(result.requestId).toBe(request.requestId);
    expect(result.providerIds).toEqual([ALPHA]);
    expect(result.results).toHaveLength(1);
    expect(result.status).toBe('accepted');
    expect(alpha.calls).toHaveLength(1);
  });

  it('2. a valid multi-provider authorization orchestrates every qualified provider', async () => {
    const request = authorizedRequest([ALPHA, BETA, GAMMA]);
    expect(request.providerIds).toEqual([ALPHA, BETA, GAMMA]);
    const trace: string[] = [];
    const alpha = fakeProvider(ALPHA, undefined, trace);
    const beta = fakeProvider(BETA, undefined, trace);
    const gamma = fakeProvider(GAMMA, undefined, trace);

    const result = await run(request, objects(alpha, beta, gamma));

    expect(result.executed).toBe(true);
    expect(result.reason).toBe('orchestrated');
    expect(result.requestId).toBe(request.requestId);
    expect(result.providerIds).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.results).toHaveLength(3);
    // The authorized order is the execution order.
    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.results.map((r) => r.providerId)).toEqual([ALPHA, BETA, GAMMA]);
  });

  it('3. a missing request is refused with zero invocations', async () => {
    const alpha = fakeProvider(ALPHA);
    for (const missing of [undefined, null, {}, 'request', 7, [], true]) {
      const result = await run(missing, [alpha.provider]);
      expect(result.executed, String(missing)).toBe(false);
      expect(result.reason, String(missing)).toBe('request-invalid');
      expectZeroExecution(result, String(missing));
      expect(result.requestId).toBeNull();
    }
    // A non-object input is refused before any field is read.
    for (const bad of [undefined, null, 'request', 7, [], true]) {
      const result = await orchestrateTripExecutionAuthorizedRequest(bad as never);
      expectZeroExecution(result, String(bad));
      expect(result.reason).toBe('request-invalid');
    }
    expect(alpha.calls).toHaveLength(0);
  });

  it('4. a malformed request is refused with zero invocations', async () => {
    const alpha = fakeProvider(ALPHA);
    const malformed: ReadonlyArray<unknown> = [
      'authorized-request',
      42,
      true,
      [],
      { accepted: 'yes', reason: 'accepted', providerRequest: null, requestId: null, providerIds: [] },
      { accepted: true },
      { accepted: true, reason: 'accepted' },
      { accepted: true, reason: 'looks-accepted', providerRequest: null, requestId: null, providerIds: [] },
      {
        accepted: true,
        reason: 'accepted',
        providerRequest: null,
        requestId: null,
        providerIds: ALPHA,
      },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: null, providerIds: [7] },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: null, providerIds: [' padded '] },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: 7, providerIds: [] },
      { accepted: true, reason: 'accepted', providerRequest: 'request', requestId: null, providerIds: [] },
    ];
    for (const value of malformed) {
      const result = await run(value, [alpha.provider]);
      expect(result.executed, JSON.stringify(value)).toBe(false);
      expect(result.reason, JSON.stringify(value)).toBe('request-invalid');
      expectZeroExecution(result, JSON.stringify(value));
    }
    // An affirmative verdict whose embedded value is not a real STEP 59 request.
    const embedded = authorizedRequest([ALPHA]).providerRequest as TripExecutionProviderRequest;
    for (const providerRequest of [null, undefined, {}, 'request', 7, { ...embedded, kind: 'wrong' }]) {
      const result = await run(requestWith({ providerRequest }), [alpha.provider]);
      expect(result.executed, JSON.stringify(providerRequest)).toBe(false);
      expect(result.reason, JSON.stringify(providerRequest)).toBe('request-invalid');
      expectZeroExecution(result, JSON.stringify(providerRequest));
    }
    // And a result whose own requestId disagrees with the embedded request.
    for (const requestId of [undefined, null, '', 'bogus', 'trip-execution-provider-request:']) {
      const result = await run(requestWith({ requestId, providerRequest: embedded }), [alpha.provider]);
      expect(result.executed, String(requestId)).toBe(false);
      expect(result.reason, String(requestId)).toBe('request-identity-invalid');
      expectZeroExecution(result, String(requestId));
    }
    // A request id of the wrong type is a shape fault, reported by the gate that
    // owns the field's type rather than by the identity gate.
    for (const requestId of [7, true, {}, []]) {
      const result = await run(requestWith({ requestId, providerRequest: embedded }), [alpha.provider]);
      expect(result.executed, JSON.stringify(requestId)).toBe(false);
      expect(result.reason, JSON.stringify(requestId)).toBe('request-invalid');
      expectZeroExecution(result, JSON.stringify(requestId));
    }
    expect(alpha.calls).toHaveLength(0);
  });

  it('5. a non-affirmative authorization is refused with zero invocations', async () => {
    const alpha = fakeProvider(ALPHA);
    const negative = unacceptedRequest();
    const result = await run(negative, [alpha.provider]);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('request-not-accepted');
    expectZeroExecution(result, 'negative step 74');
    expect(result.requestId).toBeNull();

    // Every STEP 74 negative verdict is refused at the same gate.
    for (const reason of [
      'authorization-result-invalid',
      'not-authorized',
      'authorization-missing',
      'authorization-id-invalid',
      'authorization-invalid',
      'dispatch-id-invalid',
      'dispatch-invalid',
      'request-id-invalid',
      'plan-id-invalid',
      'identity-inconsistent',
      'capability-invalid',
      'provider-identity-invalid',
      'provider-identity-duplicate',
      'provider-set-empty',
      'provider-request-invalid',
    ]) {
      const flipped = requestWith({
        accepted: false,
        reason,
        providerRequest: null,
        requestId: null,
        providerIds: [],
      });
      const outcome = await run(flipped, [alpha.provider]);
      expect(outcome.executed, reason).toBe(false);
      expect(outcome.reason, reason).toBe('request-not-accepted');
      expectZeroExecution(outcome, reason);
    }
    // An affirmative verdict carrying a negative token contradicts itself.
    const contradictory = await run(requestWith({ accepted: true, reason: 'not-authorized' }), [
      alpha.provider,
    ]);
    expect(contradictory.executed).toBe(false);
    expect(contradictory.reason).toBe('request-invalid');
    expect(alpha.calls).toHaveLength(0);
  });

  it('6. a malformed provider collection is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA]);
    const alpha = fakeProvider(ALPHA);
    for (const collection of [
      undefined,
      null,
      {},
      ALPHA,
      'alpha-execution',
      7,
      true,
      { 0: alpha.provider, length: 1 },
    ]) {
      const result = await run(request, collection);
      expect(result.executed, JSON.stringify(collection) ?? 'x').toBe(false);
      expect(result.reason, JSON.stringify(collection) ?? 'x').toBe('provider-collection-invalid');
      expectZeroExecution(result, JSON.stringify(collection) ?? 'x');
    }
    // An array whose elements are not providers: a bare id, a callback, a nested
    // array, a null, and an object with a legal identity but no `execute`. Each
    // label is explicit rather than JSON, because JSON.stringify silently drops a
    // function property and would label several of these the same.
    const notProviders: ReadonlyArray<[string, unknown]> = [
      ['a bare provider id', ALPHA],
      ['a number', 7],
      ['null', null],
      ['a nested array', []],
      ['an array holding the provider', [alpha.provider]],
      ['an object with no execute', { providerId: ALPHA }],
      ['a bare callback', () => Promise.resolve(null)],
    ];
    for (const [label, element] of notProviders) {
      const result = await run(request, [element]);
      expect(result.executed, label).toBe(false);
      expect(result.reason, label).toBe('provider-collection-invalid');
      expectZeroExecution(result, label);
    }
    // An element that is an object but whose providerId is not a legal identity:
    // the identity gate owns that fault, so it is reported one step earlier. This
    // includes an element with no identity at all, which cannot be judged as a
    // provider until it has one.
    const badIdentities: ReadonlyArray<[string, unknown]> = [
      ['a number', 7],
      ['a boolean', true],
      ['an object', {}],
      ['an array', []],
      ['null', null],
      ['empty', ''],
      ['padded', ' padded '],
    ];
    for (const [label, providerId] of badIdentities) {
      const result = await run(request, [{ providerId, execute: () => Promise.resolve(null) }]);
      expect(result.executed, label).toBe(false);
      expect(result.reason, label).toBe('provider-identity-invalid');
      expectZeroExecution(result, label);
    }
    // A structurally valid provider carrying extra unrelated fields is still a
    // provider - the boundary reads the two fields the STEP 59 contract declares
    // and invents no stricter schema of its own.
    const noisy = { firebase: true, url: 'https://api.example.test', ...alpha.provider };
    const executed = await run(request, [noisy]);
    expect(executed.executed).toBe(true);
    expect(executed.reason).toBe('orchestrated');
    expect(executed.providerIds).toEqual([ALPHA]);
    expect(alpha.calls).toHaveLength(1);
  });

  it('7. an empty provider collection is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA]);
    const result = await run(request, []);
    expect(result.executed).toBe(false);
    // The authorized set is non-empty, so an empty collection is missing a
    // provider - reported as a collection fault, not a successful empty run.
    expect(result.reason).toBe('provider-collection-invalid');
    expectZeroExecution(result, 'empty collection');
    expect(result.requestId).toBe(request.requestId);
  });

  it('7b. an affirmative result with no authorized providers is never a success', async () => {
    const alpha = fakeProvider(ALPHA);
    // STEP 74 itself refuses an empty qualified set, so this value can only be
    // hand-built. It is a contradiction, never a successful empty execution.
    const result = await run(requestWith({ providerIds: [] }), [alpha.provider]);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-set-empty');
    expectZeroExecution(result, 'empty authorized set');
    expect(alpha.calls).toHaveLength(0);

    // With no providers supplied either, the authorized set is still the first
    // fault found, and it is still not a success.
    const bare = await run(requestWith({ providerIds: [] }), []);
    expect(bare.executed).toBe(false);
    expect(bare.reason).toBe('provider-set-empty');
    expectZeroExecution(bare, 'empty both');
  });

  it('8. a missing authorized provider is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    // Only one of two authorized providers supplied. Nothing runs: a partial run
    // would already have caused effects that cannot be undone.
    const result = await run(request, [alpha.provider]);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-missing');
    expectZeroExecution(result, 'missing beta');
    expect(result.requestId).toBe(request.requestId);
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);

    // The mirror case, reported by the same gate.
    const mirrored = await run(request, [beta.provider]);
    expect(mirrored.reason).toBe('provider-missing');
    expect(beta.calls).toHaveLength(0);
  });

  it('9. an extra provider is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA]);
    const alpha = fakeProvider(ALPHA);
    const stranger = fakeProvider(UNAPPROVED);
    const result = await run(request, objects(alpha, stranger));
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-identity-mismatch');
    expectZeroExecution(result, 'extra provider');
    expect(alpha.calls).toHaveLength(0);
    // The unauthorized provider is never invoked either.
    expect(stranger.calls).toHaveLength(0);
  });

  it('10. a duplicate provider is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const first = fakeProvider(ALPHA);
    const duplicate = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const result = await run(request, objects(first, duplicate, beta));
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-duplicate');
    expectZeroExecution(result, 'duplicate alpha');
    // A duplicate is never silently deduplicated, and never resolved by picking one.
    expect(first.calls).toHaveLength(0);
    expect(duplicate.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);

    // Three copies of a single authorized provider fails the same way.
    const tripled = await run(authorizedRequest([ALPHA]), objects(
      fakeProvider(ALPHA),
      fakeProvider(ALPHA),
      fakeProvider(ALPHA)
    ));
    expect(tripled.executed).toBe(false);
    expect(tripled.reason).toBe('provider-duplicate');
    expectZeroExecution(tripled, 'tripled');
  });

  it('11. an invalid provider identity is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA]);
    for (const providerId of [
      '',
      ' padded ',
      ' leading',
      'trailing ',
      'x'.repeat(MAX_PROVIDER_ID_LENGTH + 1),
    ]) {
      const bad = fakeProvider(providerId);
      const result = await run(request, [bad.provider]);
      expect(result.executed, JSON.stringify(providerId)).toBe(false);
      // Not a legal identity at all, so it is refused before any set comparison.
      expect(result.reason, JSON.stringify(providerId)).toBe('provider-identity-invalid');
      expectZeroExecution(result, JSON.stringify(providerId));
      expect(bad.calls).toHaveLength(0);
    }
    // The bound is inclusive: a maximum-length identity is legal, and simply not
    // authorized.
    const atLimit = 'x'.repeat(MAX_PROVIDER_ID_LENGTH);
    const legal = await run(request, [fakeProvider(atLimit).provider]);
    expect(legal.executed).toBe(false);
    expect(legal.reason).toBe('provider-identity-mismatch');
  });

  it('12. a case-variant provider identity is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA]);
    for (const variant of ['Alpha-Execution', 'ALPHA-EXECUTION', 'alpha-Execution', 'alpha-execution ']) {
      const fake = fakeProvider(variant.trim() === variant ? variant : variant);
      const result = await run(request, [fake.provider]);
      expect(result.executed, variant).toBe(false);
      // No case folding, ever.
      expect(result.reason, variant).toBe(
        variant.trim() === variant ? 'provider-identity-mismatch' : 'provider-identity-invalid'
      );
      expectZeroExecution(result, variant);
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('13. a whitespace-variant provider identity is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    for (const variant of [` ${ALPHA}`, `${ALPHA} `, `\t${ALPHA}`, `${ALPHA}\n`, ` ${BETA}`]) {
      const fake = fakeProvider(variant);
      const partner = fakeProvider(BETA);
      const result = await run(request, objects(fake, partner));
      expect(result.executed, JSON.stringify(variant)).toBe(false);
      // A padded identity is not an identity, so it never becomes a set question.
      expect(result.reason, JSON.stringify(variant)).toBe('provider-identity-invalid');
      expectZeroExecution(result, JSON.stringify(variant));
      expect(fake.calls).toHaveLength(0);
      expect(partner.calls).toHaveLength(0);
    }
  });

  it('14. a substituted provider is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    // B authorized, C supplied in its place: the classic substitution.
    const alpha = fakeProvider(ALPHA);
    const imposter = fakeProvider(GAMMA);
    const result = await run(request, objects(alpha, imposter));
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-identity-mismatch');
    expectZeroExecution(result, 'substitution');
    expect(alpha.calls).toHaveLength(0);
    expect(imposter.calls).toHaveLength(0);

    // A substituted object claiming the authorized identity is a different fault
    // and cannot be detected from the value alone - but the object that runs is
    // still the one supplied, which is what test 25 pins down.
    const lookalike = fakeProvider(BETA);
    const accepted = await run(request, objects(alpha, lookalike));
    expect(accepted.executed).toBe(true);
    expect(accepted.providerIds).toEqual([ALPHA, BETA]);
  });

  it('15. a provider order mismatch is refused with zero invocations', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    // The same set, supplied out of order. Refused rather than repaired: quietly
    // reordering would hide that the collection did not arrive as authorized.
    const result = await run(request, objects(beta, alpha));
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-order-mismatch');
    expectZeroExecution(result, 'reversed order');
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);

    // A rotated order of three fails the same way.
    const three = authorizedRequest([ALPHA, BETA, GAMMA]);
    const rotated = await run(three, objects(
      fakeProvider(BETA),
      fakeProvider(GAMMA),
      fakeProvider(ALPHA)
    ));
    expect(rotated.executed).toBe(false);
    expect(rotated.reason).toBe('provider-order-mismatch');
    expectZeroExecution(rotated, 'rotated');

    // An unsorted-looking but *authorized* order is honoured, never re-sorted.
    const unsorted = authorizedRequest([GAMMA, ALPHA, BETA]);
    const trace: string[] = [];
    const honored = await run(unsorted, objects(
      fakeProvider(GAMMA, undefined, trace),
      fakeProvider(ALPHA, undefined, trace),
      fakeProvider(BETA, undefined, trace)
    ));
    expect(honored.executed).toBe(true);
    expect(trace).toEqual([GAMMA, ALPHA, BETA]);
  });
});

describe('STEP 76 orchestration: zero-execution guarantee (16-21)', () => {
  it('16. a malformed request invokes zero providers', async () => {
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const cases: ReadonlyArray<[string, unknown]> = [
      ['request-invalid', undefined],
      ['request-invalid', {}],
      ['request-invalid', { accepted: true, reason: 'nonsense', providerRequest: null, requestId: null, providerIds: [] }],
      ['request-not-accepted', unacceptedRequest()],
      ['request-invalid', requestWith({ providerRequest: null })],
      ['request-identity-invalid', requestWith({ requestId: 'bogus' })],
      ['provider-set-empty', requestWith({ providerIds: [] })],
    ];
    for (const [reason, badRequest] of cases) {
      const result = await run(badRequest, objects(alpha, beta));
      expect(result.executed, reason).toBe(false);
      expect(result.reason, reason).toBe(reason);
      expectZeroExecution(result, reason);
      expect(alpha.calls, reason).toHaveLength(0);
      expect(beta.calls, reason).toHaveLength(0);
    }
  });

  it('17. a missing provider invokes zero providers', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const result = await run(request, [alpha.provider]);
    expect(result.reason).toBe('provider-missing');
    // The provider that *was* supplied is not run either. No partial execution.
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);
  });

  it('18. an extra provider invokes zero providers', async () => {
    const request = authorizedRequest([ALPHA]);
    const alpha = fakeProvider(ALPHA);
    const stranger = fakeProvider(UNAPPROVED);
    const result = await run(request, objects(alpha, stranger));
    expect(result.reason).toBe('provider-identity-mismatch');
    expect(alpha.calls).toHaveLength(0);
    expect(stranger.calls).toHaveLength(0);
  });

  it('19. a duplicate provider invokes zero providers', async () => {
    const request = authorizedRequest([ALPHA]);
    const first = fakeProvider(ALPHA);
    const second = fakeProvider(ALPHA);
    const result = await run(request, objects(first, second));
    expect(result.reason).toBe('provider-duplicate');
    expect(first.calls).toHaveLength(0);
    expect(second.calls).toHaveLength(0);
  });

  it('20. a provider-set mismatch invokes zero providers', async () => {
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const gamma = fakeProvider(GAMMA);
    // Wrong membership in both directions, and a foreign id.
    const cases: ReadonlyArray<[string, ReadonlyArray<string>, unknown[]]> = [
      ['provider-missing', [ALPHA, BETA, GAMMA], [alpha.provider, beta.provider]],
      ['provider-identity-mismatch', [ALPHA], objects(alpha, beta)],
      ['provider-order-mismatch', [ALPHA, BETA], [beta.provider, alpha.provider]],
      ['provider-duplicate', [ALPHA, BETA], objects(alpha, alpha, beta)],
    ];
    for (const [reason, authorized, supplied] of cases) {
      const result = await run(authorizedRequest(authorized), supplied);
      expect(result.executed, reason).toBe(false);
      expect(result.reason, reason).toBe(reason);
      expectZeroExecution(result, reason);
    }
    for (const fake of [alpha, beta, gamma]) {
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('21. an invalid identity invokes zero providers', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const padded = fakeProvider(' padded ');
    const overlong = fakeProvider('x'.repeat(MAX_PROVIDER_ID_LENGTH + 1));
    const good = fakeProvider(BETA);
    for (const bad of [padded, overlong]) {
      const result = await run(request, objects(bad, good));
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('provider-identity-invalid');
      expectZeroExecution(result, 'invalid identity');
    }
    // A malformed identity is refused even when every other provider is perfect.
    expect(padded.calls).toHaveLength(0);
    expect(overlong.calls).toHaveLength(0);
    expect(good.calls).toHaveLength(0);
  });
});

describe('STEP 76 orchestration: ordered execution (22-27)', () => {
  it('22. one provider executes exactly once', async () => {
    const alpha = fakeProvider(ALPHA);
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(alpha.calls).toHaveLength(1);
    // Not twice: no verification call, no re-run.
    expect(result.results[0].executed).toBe(true);
  });

  it('23. two providers execute in order', async () => {
    const trace: string[] = [];
    const alpha = fakeProvider(ALPHA, undefined, trace);
    const beta = fakeProvider(BETA, undefined, trace);
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(alpha, beta));
    expect(result.executed).toBe(true);
    expect(trace).toEqual([ALPHA, BETA]);
    expect(result.results.map((r) => r.providerId)).toEqual([ALPHA, BETA]);
  });

  it('24. three providers execute in order', async () => {
    const trace: string[] = [];
    const fakes = [ALPHA, BETA, GAMMA].map((id) => fakeProvider(id, undefined, trace));
    const result = await run(authorizedRequest([ALPHA, BETA, GAMMA]), objects(...fakes));
    expect(result.executed).toBe(true);
    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.results).toHaveLength(3);
    for (const fake of fakes) {
      expect(fake.calls).toHaveLength(1);
    }
  });

  it('25. the supplied provider object reaches STEP 75 unchanged', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const before = [JSON.stringify(alpha.provider), JSON.stringify(beta.provider)];

    const result = await run(request, objects(alpha, beta));

    // Each provider received the very object that was supplied: no clone, no
    // wrapper, no substitute, and the identity is unchanged after the run.
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(1);
    expect(JSON.stringify(alpha.provider)).toBe(before[0]);
    expect(JSON.stringify(beta.provider)).toBe(before[1]);
    expect((alpha.provider as { providerId: string }).providerId).toBe(ALPHA);
    expect((beta.provider as { providerId: string }).providerId).toBe(BETA);
    // And each provider received the identical embedded provider request.
    const embedded = request.providerRequest as TripExecutionProviderRequest;
    expect(alpha.calls[0]).toBe(embedded);
    expect(beta.calls[0]).toBe(embedded);
    expect(result.requestId).toBe(embedded.id);
  });

  it('26. the exact authorized order is preserved in results and providerIds', async () => {
    for (const order of [
      [ALPHA],
      [ALPHA, BETA],
      [GAMMA, ALPHA],
      [GAMMA, BETA, ALPHA],
      [BETA, ALPHA, GAMMA],
    ]) {
      const fakes = order.map((id) => fakeProvider(id));
      const result = await run(authorizedRequest(order), objects(...fakes));
      expect(result.executed, order.join(',')).toBe(true);
      expect(result.providerIds, order.join(',')).toEqual(order);
      expect(result.results.map((r) => r.providerId), order.join(',')).toEqual(order);
      // Each fake ran, so the mapping is per provider and not positional luck.
      for (const fake of fakes) {
        expect(fake.calls, fake.name).toHaveLength(1);
      }
    }
  });

  it('27. no sorting occurs: an unsorted authorized order runs unsorted', async () => {
    // Deliberately reverse-alphabetical, so any sort would be obvious.
    const order = [GAMMA, BETA, ALPHA];
    expect([...order].sort()).toEqual([ALPHA, BETA, GAMMA]);
    const trace: string[] = [];
    const fakes = order.map((id) => fakeProvider(id, undefined, trace));
    const result = await run(authorizedRequest(order), objects(...fakes));
    expect(result.executed).toBe(true);
    // Not alphabetised: the authorized order stands.
    expect(trace).toEqual([GAMMA, BETA, ALPHA]);
    expect(result.providerIds).toEqual(order);

    // And nothing in the module can sort.
    expect(CODE).not.toMatch(/\.sort\s*\(|\.reverse\s*\(/);
    expect(CODE).not.toMatch(/\b(rank|score|preferred|best|top)\w*/i);
  });
});

describe('STEP 76 orchestration: provider outcomes (28-36)', () => {
  it('28. an accepted provider is reported as accepted', async () => {
    const alpha = statusProvider(ALPHA, 'accepted');
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    expect(result.status).toBe('accepted');
    expect(result.results[0].result?.status).toBe('accepted');
    expect(result.results[0].executed).toBe(true);
  });

  it('29. a rejected provider is reported as rejected', async () => {
    const alpha = statusProvider(ALPHA, 'rejected');
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    // The provider ran and answered. Saying "no" is not an orchestration failure.
    expect(result.executed).toBe(true);
    expect(result.status).toBe('rejected');
    expect(result.results[0].result?.status).toBe('rejected');
  });

  it('30. an unsupported provider is reported as unsupported', async () => {
    const alpha = statusProvider(ALPHA, 'unsupported');
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    expect(result.status).toBe('unsupported');
    expect(result.results[0].result?.status).toBe('unsupported');
  });

  it('31. a failed provider is reported as failed', async () => {
    const alpha = statusProvider(ALPHA, 'failed');
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.results[0].result?.status).toBe('failed');
  });

  it('32. a first-provider failure does not stop the second', async () => {
    const trace: string[] = [];
    const alpha = throwingProvider(ALPHA, trace);
    const beta = statusProvider(BETA, 'rejected', trace);
    const gamma = statusProvider(GAMMA, 'accepted', trace);
    const result = await run(authorizedRequest([ALPHA, BETA, GAMMA]), objects(alpha, beta, gamma));

    // All three attempted, in order, despite the first throwing.
    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.executed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results[0].reason).toBe('provider-execution-failed');
    expect(result.results[0].executed).toBe(false);
    expect(result.results[1].result?.status).toBe('rejected');
    expect(result.results[2].result?.status).toBe('accepted');
  });

  it('33. a middle-provider failure does not stop the third', async () => {
    const trace: string[] = [];
    const alpha = statusProvider(ALPHA, 'accepted', trace);
    const beta = throwingProvider(BETA, trace);
    const gamma = statusProvider(GAMMA, 'rejected', trace);
    const result = await run(authorizedRequest([ALPHA, BETA, GAMMA]), objects(alpha, beta, gamma));

    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.executed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results[0].result?.status).toBe('accepted');
    expect(result.results[1].reason).toBe('provider-execution-failed');
    expect(result.results[2].result?.status).toBe('rejected');
  });

  it('34. all providers execute exactly once despite failures', async () => {
    const trace: string[] = [];
    const alpha = statusProvider(ALPHA, 'accepted', trace);
    const beta = throwingProvider(BETA, trace);
    const gamma = rejectingProvider(GAMMA, trace);
    const result = await run(authorizedRequest([ALPHA, BETA, GAMMA]), objects(alpha, beta, gamma));

    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    expect(result.results).toHaveLength(3);
    // One invocation each, and no retry of either failing provider.
    expect(alpha.calls).toHaveLength(1);
    expect(gamma.calls).toHaveLength(1);
    // Both failures are recorded honestly, and neither is escalated or hidden.
    expect(result.results[1].reason).toBe('provider-execution-failed');
    expect(result.results[1].result).toBeNull();
    expect(result.results[2].reason).toBe('provider-execution-failed');
    expect(result.results[2].result).toBeNull();
    // The aggregate reflects the one status that genuinely exists.
    expect(result.status).toBe('accepted');
  });

  it('35. a provider throw is contained by STEP 75 and leaks nothing', async () => {
    const alpha = throwingProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(alpha, beta));

    expect(result.results[0].executed).toBe(false);
    expect(result.results[0].reason).toBe('provider-execution-failed');
    expect(result.results[0].result).toBeNull();
    // The exception's message, key, and stack frame appear nowhere.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('amadeus-live-key');
    expect(serialized).not.toContain('internal-provider');
    expect(serialized).not.toContain('Error');
    // STEP 75 still reports the identity it knew, for diagnosis.
    expect(result.results[0].providerId).toBe(ALPHA);
    expect(result.results[0].requestId).toBe(result.requestId);
  });

  it('36. a provider rejection is contained by STEP 75 and leaks nothing', async () => {
    const alpha = rejectingProvider(ALPHA);
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    expect(result.results[0].reason).toBe('provider-execution-failed');
    expect(result.results[0].result).toBeNull();
    expect(JSON.stringify(result)).not.toContain('amadeus-live-key');
    // A rejected provider contributes no status, so no aggregate is invented.
    expect(result.status).toBeNull();
  });
});

describe('STEP 76 orchestration: result integrity (37-44)', () => {
  it('37. results preserve the authorized provider order exactly', async () => {
    const order = [GAMMA, ALPHA, BETA];
    const fakes = order.map((id) => fakeProvider(id));
    const result = await run(authorizedRequest(order), objects(...fakes));
    expect(result.results).toHaveLength(order.length);
    for (let index = 0; index < order.length; index += 1) {
      expect(result.results[index].providerId, String(index)).toBe(order[index]);
      expect(fakes[index].name, String(index)).toBe(order[index]);
    }
    // The order on the input is untouched.
    expect((result.providerIds as string[]).slice().sort()).toEqual(order.slice().sort());
  });

  it('38. results preserve the STEP 75 result objects by reference', async () => {
    // The exact object the fake returned is the object inside `results`.
    const providerResults: Record<string, { providerId: string; requestId: string; status: 'accepted' | 'rejected' }> = {};
    const fakes = [ALPHA, BETA].map((id) => {
      const answer = { providerId: id, requestId: '', status: 'accepted' as const };
      providerResults[id] = answer;
      return fakeProvider(id, (r) => {
        answer.requestId = r.id;
        return answer;
      });
    });
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(...fakes));
    // Each STEP 75 result is the same object in both the inner and outer list.
    expect(result.results[0].result).toBe(providerResults[ALPHA]);
    expect(result.results[1].result).toBe(providerResults[BETA]);
    // Not a copy, not a re-serialisation.
    expect(result.results[0].result).not.toEqual(expect.objectContaining({ status: 'changed' }));
  });

  it('39. no result is fabricated for a provider that did not answer', async () => {
    const alpha = throwingProvider(ALPHA);
    const beta = statusProvider(BETA, 'rejected');
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(alpha, beta));
    expect(result.results).toHaveLength(2);
    // The failed provider contributes no provider result, and none is invented.
    expect(result.results[0].result).toBeNull();
    expect(result.results[0].executed).toBe(false);
    expect(result.results[1].result).not.toBeNull();
    // Every result has exactly the STEP 75 shape: no extra field is added.
    for (const entry of result.results) {
      expect(Object.keys(entry).sort()).toEqual([
        'executed',
        'providerId',
        'reason',
        'requestId',
        'result',
      ]);
    }
  });

  it('40. no status is translated, upgraded, or downgraded', async () => {
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed'] as const) {
      const alpha = statusProvider(ALPHA, status);
      const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
      expect(result.executed, status).toBe(true);
      expect(result.results[0].result?.status, status).toBe(status);
      expect(result.status, status).toBe(status);
    }
    // A provider answering `rejected` is never rewritten to `failed`, and never
    // upgraded to `accepted`.
    const mixed = await run(
      authorizedRequest([ALPHA, BETA]),
      objects(statusProvider(ALPHA, 'rejected'), throwingProvider(BETA))
    );
    expect(mixed.results[0].result?.status).toBe('rejected');
    expect(mixed.results[1].result).toBeNull();
    // A rejected answer and a thrown provider: STEP 61's own precedence applies
    // unchanged (accepted > rejected > failed), so the aggregate is `rejected`
    // and the thrown provider does not overwrite it. The per-provider results
    // keep their own shapes: one carries STEP 59's rejected result, the other a
    // null with STEP 75's own reason.
    expect(mixed.status).toBe('rejected');
    // Each per-provider result is a STEP 75 result, carrying STEP 75's own
    // vocabulary untouched. STEP 75's `executed` means "a valid STEP 59 result
    // came back", so the answered provider is `executed: true` with reason
    // `executed`, while the throwing one is `executed: false` with reason
    // `provider-execution-failed` and a null result.
    expect(mixed.results[0].reason).toBe('executed');
    expect(mixed.results[0].executed).toBe(true);
    expect(mixed.results[1].reason).toBe('provider-execution-failed');
    expect(mixed.results[1].executed).toBe(false);
    expect(mixed.results[1].result).toBeNull();
    // The two levels of `executed` are deliberately different questions. STEP 76
    // reports `executed: true` because preflight passed and every authorized
    // provider was attempted - not because every provider answered.
    expect(mixed.executed).toBe(true);
    // No reason is invented: every per-provider reason is one STEP 75 defines.
    for (const entry of mixed.results) {
      expect(TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS, String(entry.reason)).toContain(
        entry.reason
      );
    }
    // And this boundary's own reason list is a closed set of single words.
    for (const reason of TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS) {
      expect(reason).not.toMatch(/\s/);
    }
  });

  it('41. the request id is preserved end to end', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const fakes = [fakeProvider(ALPHA), fakeProvider(BETA)];
    const result = await run(request, objects(...fakes));
    const embedded = request.providerRequest as TripExecutionProviderRequest;
    expect(result.requestId).toBe(request.requestId);
    expect(result.requestId).toBe(embedded.id);
    for (const entry of result.results) {
      expect(entry.requestId).toBe(embedded.id);
    }
    // And on a provider failure, where STEP 75 still knows the identity.
    const failed = await run(authorizedRequest([ALPHA]), [throwingProvider(ALPHA).provider]);
    expect(failed.requestId).toBe(embedded.id);
    expect(failed.results[0].requestId).toBe(embedded.id);
  });

  it('42. provider ids are preserved end to end', async () => {
    const request = authorizedRequest([ALPHA, BETA, GAMMA]);
    const fakes = [ALPHA, BETA, GAMMA].map((id) => fakeProvider(id));
    const result = await run(request, objects(...fakes));
    expect(result.providerIds).toEqual([ALPHA, BETA, GAMMA]);
    for (const entry of result.results) {
      expect(result.providerIds).toContain(entry.providerId as string);
    }
    for (const fake of fakes) {
      expect((fake.provider as { providerId: string }).providerId).toBe(fake.name);
    }
  });

  it('43. a failed provider result remains a failed STEP 75 boundary result', async () => {
    const alpha = throwingProvider(ALPHA);
    const beta = throwingProvider(BETA);
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(alpha, beta));
    expect(result.executed).toBe(true);
    for (const entry of result.results) {
      expect(entry.executed).toBe(false);
      expect(entry.reason).toBe('provider-execution-failed');
      expect(entry.result).toBeNull();
    }
    // No provider answered, so no aggregate exists: `null`, not a fifth status.
    expect(result.status).toBeNull();
  });

  it('44. a successful provider result remains its original object', async () => {
    const answer = {
      providerId: ALPHA,
      requestId: '',
      status: 'accepted' as const,
    };
    const alpha = fakeProvider(ALPHA, (r) => {
      answer.requestId = r.id;
      return answer;
    });
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    // Byte-for-byte the provider's own value, with exactly its three fields.
    expect(result.results[0].result).toBe(answer);
    expect(Object.keys(result.results[0].result as object).sort()).toEqual([
      'providerId',
      'requestId',
      'status',
    ]);
    // And no commerce claim is attached to `accepted`.
    for (const token of ['confirmation', 'booking', 'payment', 'price', 'ticket']) {
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});

describe('STEP 76 orchestration: no fallback and no selection (45-50)', () => {
  it('45. a failed provider does not trigger an unapproved provider', async () => {
    // The unauthorized provider is present in the room but not in the set: if it
    // were invoked, preflight would already have refused the run.
    const alpha = throwingProvider(ALPHA);
    const authorized = fakeProvider(BETA);
    const unapproved = fakeProvider(UNAPPROVED);
    const result = await run(authorizedRequest([ALPHA, BETA]), objects(alpha, authorized));

    expect(result.executed).toBe(true);
    expect(result.results.map((r) => r.providerId)).toEqual([ALPHA, BETA]);
    // The unapproved provider is never reached, and never searched for.
    expect(unapproved.calls).toHaveLength(0);
    expect(result.providerIds).not.toContain(UNAPPROVED);
    expect(CODE).not.toMatch(/UNAPPROVED|fallback|searchFor|replacement/i);

    // A failed provider is not replaced: the next authorized provider runs and no
    // other is considered.
    expect(authorized.calls).toHaveLength(1);
  });

  it('46. no provider is discovered, instantiated, or resolved from a registry', async () => {
    for (const token of [
      'discover',
      'Discover',
      'registry',
      'Registry',
      'REGISTRY',
      'providerList',
      'getProvider',
      'resolveProvider',
      'lookup',
      'new ',
      'mockTripExecutionProvider',
      'MOCK_TRIP_EXECUTION_PROVIDER_ID',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    // The only provider reference is the input's own collection.
    expect(CODE).toContain('providers');
    expect(CODE).not.toMatch(/import[\s\S]{0,200}mockTripExecutionProvider/);
  });

  it('47. no provider is ranked, scored, or preferred', async () => {
    for (const token of [
      'rank',
      'Rank',
      'score',
      'Score',
      'prefer',
      'best',
      'top',
      'priority',
      'weight',
      'compare',
      'recommend',
    ]) {
      expect(CODE, token).not.toMatch(new RegExp(`\\b${token}`, 'i'));
    }
    // No reordering primitive at all, and no selection primitive.
    expect(CODE).not.toMatch(/\.sort\s*\(|\.reverse\s*\(|\.find\s*\(|\.findIndex\s*\(/);
    expect(CODE).not.toMatch(/\.flat\s*\(|\.slice\s*\(/);
  });

  it('48. no provider is selected out of a larger set', async () => {
    // The collection is not narrowed: its length must equal the authorized count
    // for the run to proceed, which the missing/extra gates enforce.
    const request = authorizedRequest([ALPHA, BETA]);
    const alpha = fakeProvider(ALPHA);
    const beta = fakeProvider(BETA);
    const gamma = fakeProvider(GAMMA);
    const unapproved = fakeProvider(UNAPPROVED);

    // All four supplied: refused, because the set is not the authorized set.
    const refused = await run(request, objects(alpha, beta, gamma, unapproved));
    expect(refused.reason).toBe('provider-identity-mismatch');
    for (const fake of [alpha, beta, gamma, unapproved]) {
      expect(fake.calls).toHaveLength(0);
    }

    // Exactly the two authorized, both of which run. Neither is chosen over the
    // other: both are attempted.
    const executed = await run(request, objects(alpha, beta));
    expect(executed.results).toHaveLength(2);
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(1);
  });

  it('49. no capability is evaluated or invented', async () => {
    const alpha = fakeProvider(ALPHA);
    const result = await run(authorizedRequest([ALPHA]), [alpha.provider]);
    expect(result.executed).toBe(true);
    // The aggregate says nothing about support beyond the providers' own answers.
    expect('capabilityId' in result).toBe(false);
    expect('capabilityIds' in result).toBe(false);
    for (const reason of TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS) {
      expect(reason).not.toContain('capability');
    }
    // No supports() call, and no capability vocabulary anywhere.
    expect(CODE).not.toContain('.supports');
    expect(CODE).not.toMatch(/providerCapabilities|PROVIDER_CAPABILITY_IDS/);
    expect(CODE).not.toMatch(/requiredCapabilityId|capabilityIds/);
    // A provider with no declared support is still executed, and the provider's
    // own `unsupported` answer stands.
    const bare = {
      providerId: ALPHA,
      execute(request: TripExecutionProviderRequest) {
        return Promise.resolve({ providerId: ALPHA, requestId: request.id, status: 'unsupported' as const });
      },
    };
    const answer = await run(authorizedRequest([ALPHA]), [bare]);
    expect(answer.executed).toBe(true);
    expect(answer.results[0].result?.status).toBe('unsupported');
  });

  it('50. no provider is substituted for a failing one', async () => {
    const order = [ALPHA, BETA, GAMMA];
    const trace: string[] = [];
    // Every provider fails in a different way; none is replaced.
    const fakes = [
      throwingProvider(ALPHA, trace),
      rejectingProvider(BETA, trace),
      statusProvider(GAMMA, 'failed', trace),
    ];
    const replacements = [UNAPPROVED, 'alpha-execution ', 'Alpha-Execution'].map((id) =>
      fakeProvider(id, undefined, trace)
    );
    const result = await run(authorizedRequest(order), objects(...fakes));

    // Exactly the authorized three, in order, once each. No replacement ran.
    expect(trace).toEqual([ALPHA, BETA, GAMMA]);
    for (const replacement of replacements) {
      expect(replacement.calls).toHaveLength(0);
    }
    expect(result.results).toHaveLength(3);
    expect(result.results[0].reason).toBe('provider-execution-failed');
    expect(result.results[1].reason).toBe('provider-execution-failed');
    expect(result.results[2].result?.status).toBe('failed');
    // The one status that exists is aggregated; the two absences are not invented.
    expect(result.status).toBe('failed');
  });
});

describe('STEP 76 orchestration: boundary tests (51-60)', () => {
  it('51. STEP 76 contains no direct provider.execute( call', () => {
    // The critical architectural requirement: there is no second execution path.
    // Asserted against the comment-stripped code, so the topology diagram in the
    // doc comment - which necessarily names `provider.execute()` to explain where
    // the call lives - cannot satisfy or break the check.
    expect(CODE).not.toMatch(/\.execute\s*\(/);
    expect(CODE).not.toMatch(/execute\s*\(/);
    expect(CODE).not.toMatch(/provider\s*\.\s*execute/);
    // And the call exists exactly once in the whole chain, in STEP 75.
    const step75Code = STEP75_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect([...step75Code.matchAll(/\.execute\s*\(/g)].length).toBe(1);
    expect(step75Code).toContain('provider.execute(providerRequest)');
  });

  it('52. STEP 75 is the only execution dependency', () => {
    const imports = [...CODE_WITH_LITERALS.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.slice().sort()).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionAuthorizedExecution',
      './tripExecutionAuthorizedRequest',
      './tripExecutionOrchestrator',
      './tripExecutionProvider',
    ]);
    // The execution function is imported from STEP 75 and called by name.
    expect(CODE_WITH_LITERALS).toContain('executeTripExecutionAuthorizedRequest');
    expect(CODE).toContain('await executeTripExecutionAuthorizedRequest(');
    // Nothing else that could execute is imported.
    expect(CODE).not.toMatch(/orchestrateTripExecution\s*\(/);
    expect(CODE).not.toMatch(/Promise\.(all|race|allSettled|any)/);
  });

  it('53. no STEP 61 execution bypass', () => {
    // STEP 61's pure aggregate helper is reused; its execution path is not.
    expect(CODE_WITH_LITERALS).toContain('getTripExecutionAggregateStatus');
    // Word-bounded, so this module's own name - which legitimately begins with
    // the same words - is not mistaken for a call to STEP 61's executor.
    expect(CODE).not.toMatch(/\borchestrateTripExecution\s*\(/);
    expect(CODE).not.toMatch(/\bexecuteProviderSafely\b|\bisExecutionProvider\b/);
    // STEP 61's execution function would bypass STEP 75 entirely.
    const step61 = readFileSync(
      join(process.cwd(), 'src/services/tripExecution/tripExecutionOrchestrator.ts'),
      'utf8'
    );
    expect(step61).toMatch(/export async function orchestrateTripExecution/);
    // And nothing in this module re-implements it.
    expect(CODE).not.toMatch(/TripExecutionProviderAggregate|providerResults\s*:/);
  });

  it('54. no STEP 65 pipeline bypass', () => {
    expect(SOURCE).not.toMatch(/tripExecutionPipeline/);
    expect(CODE).not.toMatch(/pipeline|Pipeline/);
    expect(CODE).not.toMatch(/runTripExecutionPipeline|executeTripExecutionPipeline/);
    // The pipeline would be a second, unauthorized route to a provider.
    expect(CODE_WITH_LITERALS).not.toContain('tripExecutionPipeline');
  });

  it('55. no network, HTTP client, or URL', () => {
    for (const token of [
      'fetch(',
      'XMLHttpRequest',
      'axios',
      'https',
      'http:',
      'httpsCallable',
      'getFunctions',
      'Headers',
      'Authorization',
      'Bearer',
      'apiKey',
      'endpoint',
      'url',
      'baseUrl',
    ]) {
      expect(CODE, token).not.toMatch(new RegExp(token.replace(/[()]/g, '\\$&'), 'i'));
    }
  });

  it('56. no Firebase dependency', () => {
    for (const token of [
      'firebase',
      'Firestore',
      'getFirestore',
      'getFirebase',
      'doc(',
      'collection(',
      'writeBatch',
      'setDoc',
      'addDoc',
      'updateDoc',
      'serverBoundary',
      'serverDiscoveryClient',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
  });

  it('57. no persistence', () => {
    for (const token of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'persist',
      'save',
      'write',
      'insert',
      'upsert',
      'setItem',
      'emit',
      'dispatchEvent',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
  });

  it('58. no React, Router, or Zustand dependency', () => {
    for (const token of [
      'react',
      'useState',
      'useEffect',
      'useMemo',
      'useCallback',
      'useNavigate',
      'useParams',
      'react-router',
      'Router',
      'zustand',
      'useStore',
      'create(',
      'JSX',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    expect(CODE).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./);
  });

  it('59. no credential or environment access', () => {
    for (const token of [
      'process.env',
      'import.meta.env',
      'Deno.env',
      'process.',
      'API_KEY',
      'SECRET',
      'TOKEN',
      'credential',
      'apiKey',
      'clientId',
      'clientSecret',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    // No environment lookup of any kind.
    expect(CODE).not.toMatch(/env\b/);
  });

  it('60. no retry, timer, or concurrency mechanism', () => {
    for (const token of [
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'sleep',
      'retry',
      'Retry',
      'backoff',
      'attempt',
      'Promise.all',
      'Promise.race',
      'Promise.allSettled',
      'queueMicrotask',
    ]) {
      expect(CODE, token).not.toMatch(new RegExp(token, 'i'));
    }
    // Execution is a plain sequential await in a for-of loop: no concurrency, and
    // no loop that could drive a retry.
    expect(CODE).not.toMatch(/\bwhile\s*\(/);
    // Seven fixed-shape loops exist, and only the last one awaits: the candidate
    // scan, the duplicate scan, the membership scan, the missing scan, the
    // element-wise order comparison, the status collection, and the execution.
    // None of the first six can repeat anything.
    expect([...CODE.matchAll(/\bfor\s*\(/g)].length).toBe(7);
    expect([...CODE.matchAll(/\bfor\s*\(\s*const\b/g)].length).toBe(6);
    expect([...CODE.matchAll(/for\s*\(\s*let\s+index\b/g)].length).toBe(1);
    expect(CODE).toMatch(/for\s*\(const\s+\w+\s+of\s+supplied\)/);
    // Exactly one await exists, and no loop opens after it - so the execution loop
    // has no inner loop that could retry a provider.
    expect([...CODE.matchAll(/\bawait\b/g)].length).toBe(1);
    expect(CODE.slice(CODE.indexOf('await '))).not.toMatch(/\bfor\s*\(/);
    // And no early exit from the execution loop, so no provider is skipped.
    expect(CODE).not.toMatch(/\bbreak\b|\bcontinue\b/);
  });
});

describe('STEP 76 orchestration: boundary scope', () => {
  it('60b. the reason vocabulary is closed, bounded, and provider-neutral', () => {
    expect([...TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS]).toEqual([
      'orchestrated',
      'request-invalid',
      'request-not-accepted',
      'request-identity-invalid',
      'provider-set-empty',
      'provider-collection-invalid',
      'provider-identity-invalid',
      'provider-duplicate',
      'provider-identity-mismatch',
      'provider-missing',
      'provider-order-mismatch',
    ]);
    for (const reason of TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z-]*$/);
      expect(reason).not.toContain(' ');
      expect(reason).not.toContain('http');
    }
    // Exactly one affirmative token.
    const affirmative = TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS.filter(
      (r) =>
        r !== 'request-not-accepted' &&
        !r.endsWith('-invalid') &&
        !r.endsWith('-mismatch') &&
        !r.endsWith('-missing') &&
        !r.endsWith('-empty') &&
        !r.endsWith('-duplicate')
    );
    expect(affirmative).toEqual(['orchestrated']);
  });

  it('60c. every non-affirmative reason is reachable and fail-closed', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const embedded = request.providerRequest as TripExecutionProviderRequest;
    const cases: ReadonlyArray<[string, unknown, unknown]> = [
      ['request-invalid', undefined, [fakeProvider(ALPHA).provider]],
      ['request-invalid', { accepted: true, reason: 'accepted', providerRequest: null, requestId: null, providerIds: [] }, []],
      ['request-not-accepted', unacceptedRequest(), [fakeProvider(ALPHA).provider]],
      ['request-identity-invalid', requestWith({ requestId: 'bogus', providerRequest: embedded }), [fakeProvider(ALPHA).provider]],
      ['provider-set-empty', requestWith({ providerIds: [] }), [fakeProvider(ALPHA).provider]],
      ['provider-collection-invalid', request, []],
      ['provider-identity-invalid', request, [fakeProvider(' padded ').provider]],
      ['provider-duplicate', request, [fakeProvider(ALPHA), fakeProvider(ALPHA)].map((f) => f.provider)],
      ['provider-identity-mismatch', authorizedRequest([ALPHA]), [fakeProvider(BETA).provider]],
      ['provider-missing', request, [fakeProvider(ALPHA).provider]],
      ['provider-order-mismatch', request, [fakeProvider(BETA).provider, fakeProvider(ALPHA).provider]],
    ];
    const seen = new Set<string>();
    for (const [reason, req, providers] of cases) {
      const result = await run(req, providers);
      expect(result.executed, reason).toBe(false);
      expect(result.reason, reason).toBe(reason);
      expectZeroExecution(result, reason);
      seen.add(result.reason);
    }
    // Every non-affirmative token in the closed vocabulary is actually reachable.
    expect([...seen].sort()).toEqual(
      TRIP_EXECUTION_AUTHORIZED_ORCHESTRATION_REASONS.filter((r) => r !== 'orchestrated').sort()
    );
  });

  it('60d. the aggregate status follows the existing STEP 61 semantics', async () => {
    // Imported for the expectation only: the same pure helper Step 76 uses, so
    // the test asserts reuse rather than restating the rule.
    const aggregateOf = (statuses: ReadonlyArray<'accepted' | 'rejected' | 'unsupported' | 'failed'>) =>
      getTripExecutionAggregateStatus(
        statuses.map((status, index) => ({
          providerId: `p${index}`,
          requestId: 'trip-execution-provider-request:trip-execution-dispatch:x',
          status,
        }))
      );

    // One provider, each status: the aggregate is that status.
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed'] as const) {
      const result = await run(authorizedRequest([ALPHA]), [statusProvider(ALPHA, status).provider]);
      expect(result.status, status).toBe(aggregateOf([status]));
    }
    // Any accepted wins, whatever else happened.
    const mixed = await run(
      authorizedRequest([ALPHA, BETA, GAMMA]),
      objects(
        statusProvider(ALPHA, 'rejected'),
        statusProvider(BETA, 'accepted'),
        statusProvider(GAMMA, 'failed')
      )
    );
    expect(mixed.status).toBe(aggregateOf(['rejected', 'accepted', 'failed']));
    // Otherwise a rejection outranks a failure.
    const noAccepted = await run(
      authorizedRequest([ALPHA, BETA]),
      objects(statusProvider(ALPHA, 'failed'), statusProvider(BETA, 'rejected'))
    );
    expect(noAccepted.status).toBe(aggregateOf(['failed', 'rejected']));
    // Nothing answered: no aggregate, not a fifth status.
    const silent = await run(authorizedRequest([ALPHA]), [throwingProvider(ALPHA).provider]);
    expect(silent.status).toBeNull();
    expect(aggregateOf([])).toBe('unsupported');
    expect(silent.status).not.toBe(aggregateOf([]));
  });

  it('60e. repeated orchestration is deterministic and non-cumulative', async () => {
    const request = authorizedRequest([ALPHA, BETA]);
    const fakes = [fakeProvider(ALPHA), fakeProvider(BETA)];
    const first = await run(request, objects(...fakes));
    const second = await run(request, objects(...fakes));
    // Same input, same output: no tally, no cache, no running state.
    expect(second).toEqual(first);
    // Two calls, two invocations each: nothing is accumulated between them.
    expect(fakes[0].calls).toHaveLength(2);
    expect(fakes[1].calls).toHaveLength(2);
    expect(first.results).toHaveLength(2);
    expect(second.results).toHaveLength(2);
    // And the request is unchanged by either run.
    expect(request.providerIds).toEqual([ALPHA, BETA]);
    expect((request.providerRequest as TripExecutionProviderRequest).id).toBe(first.requestId);
  });
});
