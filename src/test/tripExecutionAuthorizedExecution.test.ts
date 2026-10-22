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
  type TripExecutionProviderResult,
} from '../services/tripExecution/tripExecutionProvider';
import { evaluateTripExecutionPlanQualification } from '../services/tripExecution/tripExecutionPlanQualification';
import { createTripExecutionQualifiedDispatch } from '../services/tripExecution/tripExecutionQualifiedDispatch';
import { createTripExecutionQualifiedAuthorization } from '../services/tripExecution/tripExecutionQualifiedAuthorization';
import { createTripExecutionAuthorizedRequest } from '../services/tripExecution/tripExecutionAuthorizedRequest';
import {
  executeTripExecutionAuthorizedRequest,
  TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS,
  type TripExecutionAuthorizedExecutionResult,
} from '../services/tripExecution/tripExecutionAuthorizedExecution';
import { MAX_PROVIDER_ID_LENGTH } from '../domain/providers/providerResults';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };
const CAPABILITY = 'search-transport';
/** A provider identity that is this test's own invention, never a real provider. */
const PROVIDER_ID = 'test-execution';
const OTHER_PROVIDER_ID = 'other-execution';

const SOURCE_PATH = join(
  process.cwd(),
  'src/services/tripExecution/tripExecutionAuthorizedExecution.ts'
);
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
// Comments and string literals removed, so an assertion about *code* cannot be
// satisfied by a doc comment or by a bare token.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''");
// The same source with comments removed but string literals intact, so import
// *paths* can be enumerated. A comment could describe an import, so the block
// and line comments still have to go.
const CODE_WITH_LITERALS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** A secret the provider "leaks" when it fails, to prove nothing escapes. */
const SECRET = 'amadeus-live-key-9f2c://internal-provider-stack-frame';

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

/** A real STEP 63 plan, built by the genuine factory. */
function validPlan(providerIds: ReadonlyArray<string> = [PROVIDER_ID], tripId = 'trip-plan') {
  const providers = providerIds.map((providerId) => ({
    providerId,
    async execute() {
      return Promise.resolve({ providerId, requestId: 'unused', status: 'accepted' as const });
    },
  }));
  return requireValue(
    createTripExecutionPlan(
      requireValue(
        (() => {
          const step56 = validStep56Request(tripId);
          const authorization = requireValue(
            createTripPlanningExecutionAuthorization(step56),
            'authorization'
          );
          const dispatch = requireValue(
            createTripExecutionDispatchInstruction(authorization),
            'dispatch'
          );
          return createTripExecutionProviderRequest(dispatch);
        })(),
        'provider request'
      ),
      providers
    ),
    'plan'
  );
}

/** A genuine STEP 72 qualified dispatch, from the real STEP 71 and STEP 72 evaluators. */
function validDispatch(
  providerIds: ReadonlyArray<string> = [PROVIDER_ID],
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
 * A genuine STEP 74 authorized-request result, produced by the real STEP 74
 * boundary from a genuine STEP 73 authorization of a genuine STEP 72 dispatch.
 * Deep-copied so mutation tests have a real object to prove against.
 */
function authorizedRequest(
  providerIds: ReadonlyArray<string> = [PROVIDER_ID]
): Record<string, unknown> {
  const authorized = createTripExecutionQualifiedAuthorization({
    dispatch: validDispatch(providerIds),
  });
  if (!authorized.authorized) throw new Error(`test setup: fixture not authorized (${authorized.reason})`);

  const request = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (!request.accepted) throw new Error(`test setup: fixture not accepted (${request.reason})`);

  return {
    ...request,
    providerRequest: { ...(request.providerRequest as TripExecutionProviderRequest) },
    providerIds: [...request.providerIds],
  } as unknown as Record<string, unknown>;
}

/** A genuine STEP 74 negative result: a well-formed, unaccepted handoff. */
function unacceptedRequest(): Record<string, unknown> {
  const authorized = createTripExecutionQualifiedAuthorization({ dispatch: negativeDispatch() });
  if (authorized.authorized) throw new Error('test setup: fixture unexpectedly authorized');
  const request = createTripExecutionAuthorizedRequest({ authorization: authorized });
  if (request.accepted) throw new Error('test setup: negative fixture unexpectedly accepted');
  return { ...request, providerIds: [...request.providerIds] } as Record<string, unknown>;
}

/** A genuine STEP 74 result, then one field replaced, for a specific fault. */
function requestWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...authorizedRequest(), ...overrides };
}

/**
 * A deterministic recording fake implementing the STEP 59 provider contract.
 * The only things this test's provider can do are record its calls and return or
 * raise exactly what it was told to. It reaches no network, holds no credential,
 * and makes no booking, payment, or reservation decision.
 */
function fakeProvider(options: {
  providerId?: string;
  respond?: (request: TripExecutionProviderRequest) => unknown;
}): { provider: Record<string, unknown>; calls: TripExecutionProviderRequest[] } {
  // A key-presence check, not `??` and not a bare `undefined` test: a test that
  // supplies `null` or `undefined` as a provider identity must reach the boundary
  // as that exact value, not be quietly replaced by the default id. Omitting the
  // key entirely is what selects the default.
  const providerId = 'providerId' in options ? (options.providerId as string) : PROVIDER_ID;
  const respond = options.respond ?? ((request: TripExecutionProviderRequest) => ({
    providerId,
    requestId: request.id,
    status: 'accepted' as const,
  }));
  const calls: TripExecutionProviderRequest[] = [];
  return {
    calls,
    provider: {
      providerId,
      async execute(request: TripExecutionProviderRequest): Promise<unknown> {
        calls.push(request);
        return await respond(request);
      },
    },
  };
}

/** A fake that satisfies the contract and accepts whatever request it is given. */
function acceptingFake(providerId: string = PROVIDER_ID) {
  return fakeProvider({ providerId });
}

function run(
  request: unknown,
  provider: unknown
): Promise<TripExecutionAuthorizedExecutionResult> {
  return executeTripExecutionAuthorizedRequest({ request, provider });
}

describe('STEP 75 authorized execution: request and provider validity (1-8)', () => {
  it('1. a valid request and a valid provider execute exactly once', async () => {
    const request = authorizedRequest();
    const { provider, calls } = acceptingFake();
    const result = await run(request, provider);

    expect(result.executed).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.result).toEqual({
      providerId: PROVIDER_ID,
      requestId: request.requestId,
      status: 'accepted',
    });
    expect(result.requestId).toBe(request.requestId);
    expect(result.providerId).toBe(PROVIDER_ID);
    expect(calls).toHaveLength(1);
  });

  it('2. a missing request is rejected without invoking the provider', async () => {
    const { provider, calls } = acceptingFake();
    for (const missing of [undefined, null, {}, 'request', 7, [], true]) {
      const result = await run(missing, provider);
      expect(result.executed, String(missing)).toBe(false);
      expect(result.reason, String(missing)).toBe('request-invalid');
      expect(result.result).toBeNull();
      expect(result.requestId).toBeNull();
      expect(result.providerId).toBeNull();
    }
    // A non-object input is refused before any field is read.
    for (const bad of [undefined, null, 'request', 7, [], true]) {
      const result = await executeTripExecutionAuthorizedRequest(bad as never);
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('request-invalid');
      expect(result.result).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it('3. a malformed request is rejected without invoking the provider', async () => {
    const { provider, calls } = acceptingFake();
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
        providerIds: 'test-execution',
      },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: null, providerIds: [7] },
      {
        accepted: true,
        reason: 'accepted',
        providerRequest: null,
        requestId: null,
        providerIds: [' padded '],
      },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: null, providerIds: [''] },
      { accepted: true, reason: 'accepted', providerRequest: 'request', requestId: null, providerIds: [] },
      { accepted: true, reason: 'accepted', providerRequest: null, requestId: 7, providerIds: [] },
    ];
    for (const value of malformed) {
      const result = await run(value, provider);
      expect(result.executed, JSON.stringify(value)).toBe(false);
      expect(result.reason, JSON.stringify(value)).toBe('request-invalid');
      expect(result.result).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it('4. a request that is not accepted is rejected and never executed', async () => {
    const { provider, calls } = acceptingFake();
    const negative = unacceptedRequest();
    const result = await run(negative, provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('request-not-accepted');
    expect(result.result).toBeNull();
    expect(result.requestId).toBeNull();
    expect(result.providerId).toBeNull();

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
      const flipped = requestWith({ accepted: false, reason, providerRequest: null, requestId: null, providerIds: [] });
      const outcome = await run(flipped, provider);
      expect(outcome.executed, reason).toBe(false);
      expect(outcome.reason, reason).toBe('request-not-accepted');
    }

    // A positive verdict carrying a negative reason token contradicts itself, so
    // the shape is refused rather than believed.
    const contradictory = requestWith({ accepted: true, reason: 'not-authorized' });
    const contradiction = await run(contradictory, provider);
    expect(contradiction.executed).toBe(false);
    expect(contradiction.reason).toBe('request-invalid');

    expect(calls).toHaveLength(0);
  });

  it('5. a missing provider is rejected without invoking anything', async () => {
    const request = authorizedRequest();
    for (const missing of [undefined, null, {}, 7, 'test-execution', [], true]) {
      const result = await run(request, missing);
      expect(result.executed, String(missing)).toBe(false);
      expect(result.reason, String(missing)).toBe('provider-invalid');
      expect(result.result).toBeNull();
      // A provider id without a provider object is not a provider.
      expect(result.providerId, String(missing)).toBeNull();
    }
  });

  it('6. a malformed provider is rejected without invoking it', async () => {
    const request = authorizedRequest();
    const malformed: ReadonlyArray<unknown> = [
      // A bare callback is not the provider contract.
      () => Promise.resolve({ providerId: PROVIDER_ID, requestId: 'x', status: 'accepted' }),
      // A function with no identity.
      Object.assign(() => Promise.resolve(null), { execute: () => Promise.resolve(null) }),
      // A class instance whose only method is something else.
      { providerId: PROVIDER_ID, call: () => Promise.resolve(null) },
      { providerId: PROVIDER_ID, execute: 'not-a-function' },
      { providerId: PROVIDER_ID, execute: null },
      { providerId: PROVIDER_ID },
      { execute: () => Promise.resolve(null) },
      // A well-formed value that is not a provider at all.
      { url: 'https://api.example.test', credential: SECRET },
      { firebase: true },
    ];
    for (const value of malformed) {
      const result = await run(request, value);
      expect(result.executed, JSON.stringify(value)).toBe(false);
      expect(result.reason, JSON.stringify(value)).toBe('provider-invalid');
      expect(result.result).toBeNull();
    }

    // A value that *is* structurally a provider is executed, even when it also
    // carries unrelated fields: the boundary reads the two fields the STEP 59
    // contract declares and does not invent a stricter schema of its own. What
    // it then does with the answer is judged on the answer.
    const noisy = {
      firebase: true,
      providerId: PROVIDER_ID,
      async execute(target: TripExecutionProviderRequest) {
        return { providerId: PROVIDER_ID, requestId: target.id, status: 'accepted' as const };
      },
    };
    const executed = await run(request, noisy);
    expect(executed.executed).toBe(true);
    expect(executed.result?.status).toBe('accepted');
  });

  it('7. an invalid provider identity is rejected by the provider gate', async () => {
    const request = authorizedRequest();
    // A provider id that is not a well-formed identity at all never reaches the
    // membership gate: the value is simply not a provider. Note that a
    // case-variant such as 'Test-Execution' is *not* in this list - it is a
    // perfectly well-formed identity, just not a qualified one, so it is
    // refused one gate later.
    const invalid: ReadonlyArray<unknown> = [
      '',
      ' padded ',
      ' leading',
      'trailing ',
      'x'.repeat(MAX_PROVIDER_ID_LENGTH + 1),
      7,
      null,
      undefined,
    ];
    for (const providerId of invalid) {
      const { provider, calls } = fakeProvider({ providerId: providerId as string });
      const result = await run(request, provider);
      expect(result.executed, String(providerId)).toBe(false);
      expect(result.reason, String(providerId)).toBe('provider-invalid');
      expect(result.result).toBeNull();
      expect(calls).toHaveLength(0);
    }
    // The exact bound is inclusive: the maximum length is a legal identity.
    const atLimit = 'x'.repeat(MAX_PROVIDER_ID_LENGTH);
    const boundary = await run(
      requestWith({ providerIds: [atLimit] }),
      fakeProvider({ providerId: atLimit }).provider
    );
    expect(boundary.executed).toBe(true);
  });

  it('8. a well-formed provider outside the qualified set is refused', async () => {
    // A valid STEP 59 provider the chain did not qualify: the membership gate
    // can only refuse, never choose.
    const { provider, calls } = fakeProvider({ providerId: OTHER_PROVIDER_ID });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-identity-mismatch');
    expect(result.result).toBeNull();
    expect(result.requestId).toBeNull();
    // The refused identity is reported so a caller can see which one was refused.
    expect(result.providerId).toBe(OTHER_PROVIDER_ID);
    expect(calls).toHaveLength(0);

    // No case folding, no aliasing, no near-miss acceptance: the comparison is
    // exact bytes. Each identity here is well formed, so each is refused by the
    // membership gate rather than the provider gate.
    for (const substituted of ['Test-Execution', 'test-execution-2', 'test', 'a']) {
      const decoy = fakeProvider({ providerId: substituted });
      const refused = await run(authorizedRequest(), decoy.provider);
      expect(refused.executed, substituted).toBe(false);
      expect(refused.reason, substituted).toBe('provider-identity-mismatch');
      expect(refused.result).toBeNull();
      expect(decoy.calls).toHaveLength(0);
    }

    // A padded near-miss never becomes a membership question: it is not an
    // identity at all, so the provider gate refuses it one step earlier. The
    // point of both cases is the same - the qualified id is never matched.
    for (const padded of [' test-execution', 'test-execution ', 'test-execution\n']) {
      const padded_decoy = fakeProvider({ providerId: padded });
      const refused = await run(authorizedRequest(), padded_decoy.provider);
      expect(refused.executed, JSON.stringify(padded)).toBe(false);
      expect(refused.reason, JSON.stringify(padded)).toBe('provider-invalid');
      expect(padded_decoy.calls).toHaveLength(0);
    }

    // An empty qualified set matches nobody.
    const empty = await run(requestWith({ providerIds: [] }), acceptingFake().provider);
    expect(empty.executed).toBe(false);
    expect(empty.reason).toBe('provider-identity-mismatch');
  });

  it('9. a result whose own requestId disagrees with its provider request is refused', async () => {
    const { provider, calls } = acceptingFake();
    const embedded = authorizedRequest().providerRequest as TripExecutionProviderRequest;
    // A well-formed request id that simply is not this request's id, and an
    // absent or empty one. The shape gate passes these because the field is
    // either a string or nullish; the identity gate owns the verdict.
    for (const requestId of [
      undefined,
      null,
      '',
      'trip-execution-provider-request:',
      'not-a-request-id',
      'trip-execution-provider-request:trip-execution-dispatch:trip-planning-execution-authorization:other',
    ]) {
      const result = await run(requestWith({ requestId, providerRequest: embedded }), provider);
      expect(result.executed, String(requestId)).toBe(false);
      expect(result.reason, String(requestId)).toBe('request-identity-invalid');
      expect(result.result).toBeNull();
      expect(result.requestId).toBeNull();
      expect(calls).toHaveLength(0);
    }
    // A request id of the wrong *type* is a shape fault, reported by the gate
    // that owns the field's type rather than by the identity gate.
    for (const requestId of [7, true, {}, []]) {
      const result = await run(requestWith({ requestId, providerRequest: embedded }), provider);
      expect(result.executed, String(requestId)).toBe(false);
      expect(result.reason, String(requestId)).toBe('request-invalid');
      expect(result.result).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it('10. a result whose embedded provider request is not a STEP 59 request is refused', async () => {
    const { provider, calls } = acceptingFake();
    const notARequest: ReadonlyArray<unknown> = [
      null,
      undefined,
      {},
      'request',
      7,
      { id: 'trip-execution-provider-request:other', kind: 'trip-execution-provider-request', dispatchId: 'trip-execution-dispatch:x' },
      { kind: 'wrong-kind', id: 'trip-execution-provider-request:x', dispatchId: 'trip-execution-dispatch:x' },
      { id: 'trip-execution-provider-request:x', dispatchId: 'not-a-dispatch-id' },
    ];
    for (const providerRequest of notARequest) {
      const result = await run(requestWith({ providerRequest }), provider);
      expect(result.executed, JSON.stringify(providerRequest)).toBe(false);
      expect(result.reason, JSON.stringify(providerRequest)).toBe('request-invalid');
      expect(result.result).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });
});

describe('STEP 75 authorized execution: pre-execution safety (11-13)', () => {
  it('11. no failed pre-execution gate ever invokes a provider', async () => {
    // Each case names the reason it must produce, and supplies a *recording*
    // provider, so "zero invocations" is measured on the very value handed in.
    const wrongTypeRequest = {
      accepted: true,
      reason: 'nonsense',
      providerRequest: null,
      requestId: null,
      providerIds: [],
    };
    const cases: ReadonlyArray<
      [string, unknown, () => { provider: unknown; calls: TripExecutionProviderRequest[] }]
    > = [
      ['request-invalid', undefined, () => acceptingFake()],
      ['request-invalid', wrongTypeRequest, () => acceptingFake()],
      ['request-not-accepted', unacceptedRequest(), () => acceptingFake()],
      ['request-invalid', requestWith({ providerRequest: null }), () => acceptingFake()],
      ['request-identity-invalid', requestWith({ requestId: 'trip-execution-provider-request:other' }), () => acceptingFake()],
      ['provider-invalid', authorizedRequest(), () => ({ provider: 'test-execution', calls: [] })],
      ['provider-invalid', authorizedRequest(), () => ({ provider: { providerId: PROVIDER_ID }, calls: [] })],
      ['provider-identity-mismatch', authorizedRequest(), () => acceptingFake(OTHER_PROVIDER_ID)],
    ];
    for (const [expectedReason, request, buildProvider] of cases) {
      const { provider, calls } = buildProvider();
      const result = await run(request, provider);
      expect(result.executed, expectedReason).toBe(false);
      expect(result.reason, expectedReason).toBe(expectedReason);
      expect(result.result, expectedReason).toBeNull();
      // The core safety property: a refused execution never reached a provider.
      expect(calls, expectedReason).toHaveLength(0);
    }
  });

  it('12. the exact validated request is what reaches the provider', async () => {
    const request = authorizedRequest();
    const embedded = request.providerRequest as TripExecutionProviderRequest;
    const { provider, calls } = acceptingFake();

    const result = await run(request, provider);

    expect(calls).toHaveLength(1);
    // The very object the result carries, unmodified and un-copied into a
    // different shape: the provider receives the validated value itself.
    expect(calls[0]).toBe(embedded);
    expect(Object.keys(calls[0]).sort()).toEqual(Object.keys(embedded).sort());
    expect(calls[0]).toEqual({
      id: embedded.id,
      kind: embedded.kind,
      dispatchId: embedded.dispatchId,
    });
    expect(result.requestId).toBe(embedded.id);
  });

  it('13. the boundary does not mutate the request, the provider, or the identity', async () => {
    const request = authorizedRequest();
    const provider = acceptingFake();
    const before = JSON.stringify(request);
    const providerBefore = JSON.stringify(provider.provider);
    const requestIdBefore = request.requestId;
    const providerIdsBefore = JSON.stringify(request.providerIds);
    const dispatchIdBefore = (request.providerRequest as TripExecutionProviderRequest).dispatchId;

    const result = await run(request, provider.provider);

    expect(result.executed).toBe(true);
    // Every field, the request id, and the provider identity are byte-identical.
    expect(JSON.stringify(request)).toBe(before);
    expect(JSON.stringify(provider.provider)).toBe(providerBefore);
    expect(request.requestId).toBe(requestIdBefore);
    expect(JSON.stringify(request.providerIds)).toBe(providerIdsBefore);
    expect((request.providerRequest as TripExecutionProviderRequest).dispatchId).toBe(
      dispatchIdBefore
    );
    expect((request.providerRequest as TripExecutionProviderRequest).id).toBe(result.requestId);
    expect(provider.provider.providerId).toBe(PROVIDER_ID);
  });
});

describe('STEP 75 authorized execution: successful execution (14-19)', () => {
  it('14. an accepted provider result is returned as success', async () => {
    const request = authorizedRequest();
    const { provider, calls } = fakeProvider({
      respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status: 'accepted' as const }),
    });
    const result = await run(request, provider);
    expect(result.executed).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.result?.status).toBe('accepted');
    expect(calls).toHaveLength(1);
  });

  it('15. a rejected provider result is a successful boundary execution', async () => {
    const request = authorizedRequest();
    const { provider } = fakeProvider({
      respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status: 'rejected' as const }),
    });
    const result = await run(request, provider);
    // The provider ran and answered. The provider saying "no" is not a boundary
    // failure, and the boundary does not second-guess it.
    expect(result.executed).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.result?.status).toBe('rejected');
  });

  it('16. an unsupported provider result is a successful boundary execution', async () => {
    const request = authorizedRequest();
    const { provider } = fakeProvider({
      respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status: 'unsupported' as const }),
    });
    const result = await run(request, provider);
    expect(result.executed).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.result?.status).toBe('unsupported');
  });

  it('17. a failed provider result is a successful boundary execution', async () => {
    const request = authorizedRequest();
    const { provider } = fakeProvider({
      respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status: 'failed' as const }),
    });
    const result = await run(request, provider);
    expect(result.executed).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.result?.status).toBe('failed');
  });

  it('18. every valid status is preserved exactly, with no translation', async () => {
    const request = authorizedRequest();
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed'] as const) {
      const providerResult: TripExecutionProviderResult = {
        providerId: PROVIDER_ID,
        requestId: request.requestId as string,
        status,
      };
      const { provider } = fakeProvider({ respond: () => providerResult });
      const result = await run(request, provider);
      expect(result.executed, status).toBe(true);
      // The provider's own object, returned as-is: no upgrade, no downgrade, no
      // rewriting of any field.
      expect(result.result, status).toBe(providerResult);
      expect(result.result?.status, status).toBe(status);
      expect(Object.keys(result.result as object).sort(), status).toEqual([
        'providerId',
        'requestId',
        'status',
      ]);
    }
  });

  it('19. a valid request and provider invoke execute exactly once', async () => {
    const request = authorizedRequest();
    const embedded = request.providerRequest as TripExecutionProviderRequest;
    const { provider, calls } = acceptingFake();
    const result = await run(request, provider);
    expect(result.executed).toBe(true);
    expect(calls).toHaveLength(1);
    // A single call, not a call and a verification call, not two.
    expect(calls).toEqual([embedded]);
  });
});

describe('STEP 75 authorized execution: provider-result validation (20-29)', () => {
  it('20. a null provider result is refused', async () => {
    const { provider, calls } = fakeProvider({ respond: () => null });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-result-invalid');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('21. an undefined provider result is refused', async () => {
    const { provider, calls } = fakeProvider({ respond: () => undefined });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-result-invalid');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('22. a primitive provider result is refused', async () => {
    for (const primitive of ['accepted', '', 42, 0, true, false, 7n, Symbol('x')]) {
      const { provider } = fakeProvider({ respond: () => primitive });
      const result = await run(authorizedRequest(), provider);
      expect(result.executed, String(primitive)).toBe(false);
      expect(result.reason, String(primitive)).toBe('provider-result-invalid');
      expect(result.result).toBeNull();
    }
  });

  it('23. a malformed provider result object is refused', async () => {
    const request = authorizedRequest();
    const requestId = request.requestId as string;
    const malformed: ReadonlyArray<unknown> = [
      [],
      [{ providerId: PROVIDER_ID, requestId, status: 'accepted' }],
      'a string',
      new Date(0),
      {},
      { providerId: PROVIDER_ID, requestId },
      { providerId: PROVIDER_ID, status: 'accepted' },
      { requestId, status: 'accepted' },
      { providerId: PROVIDER_ID, requestId, status: 'accepted', extra: 'leak' },
    ];
    for (const value of malformed) {
      const { provider } = fakeProvider({ respond: () => value });
      const result = await run(request, provider);
      // The last one is a valid result carrying an extra field; the real STEP 59
      // validator accepts it, and the boundary adds no schema of its own.
      const expected = value === malformed[malformed.length - 1];
      expect(result.executed, JSON.stringify(value) ?? 'symbol').toBe(expected);
      if (!expected) {
        expect(result.reason).toBe('provider-result-invalid');
        expect(result.result).toBeNull();
      }
    }
  });

  it('24. an invalid provider-result status is refused, not invented', async () => {
    const request = authorizedRequest();
    for (const status of [
      'pending',
      'confirmed',
      'booked',
      'succeeded',
      'ACCEPTED',
      '',
      7,
      null,
      undefined,
      true,
    ]) {
      const { provider } = fakeProvider({
        respond: () => ({ providerId: PROVIDER_ID, requestId: request.requestId, status }),
      });
      const result = await run(request, provider);
      expect(result.executed, String(status)).toBe(false);
      expect(result.reason, String(status)).toBe('provider-result-invalid');
      expect(result.result).toBeNull();
    }
  });

  it('25. an invalid provider-result provider id is refused', async () => {
    const request = authorizedRequest();
    for (const providerId of [
      '',
      ' padded ',
      'x'.repeat(MAX_PROVIDER_ID_LENGTH + 1),
      7,
      null,
      undefined,
    ]) {
      const { provider } = fakeProvider({
        respond: (r) => ({ providerId, requestId: r.id, status: 'accepted' as const }),
      });
      const result = await run(request, provider);
      expect(result.executed, String(providerId)).toBe(false);
      expect(result.reason, String(providerId)).toBe('provider-result-invalid');
      expect(result.result).toBeNull();
    }
  });

  it('26. an invalid provider-result request id is refused', async () => {
    const request = authorizedRequest();
    for (const requestId of [
      '',
      'trip-execution-provider-request:',
      'not-a-request-id',
      'x'.repeat(4000),
      7,
      null,
      undefined,
    ]) {
      const { provider } = fakeProvider({
        respond: () => ({ providerId: PROVIDER_ID, requestId, status: 'accepted' as const }),
      });
      const result = await run(request, provider);
      expect(result.executed, String(requestId)).toBe(false);
      expect(result.reason, String(requestId)).toBe('provider-result-invalid');
      expect(result.result).toBeNull();
    }
  });

  it('27. a provider-result providerId that is not the provider is refused', async () => {
    const { provider, calls } = fakeProvider({
      respond: (r) => ({ providerId: OTHER_PROVIDER_ID, requestId: r.id, status: 'accepted' as const }),
    });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-result-provider-mismatch');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);

    // A well-formed identity that is simply not the one that ran. A padded
    // variant never gets this far: it is refused by the result validator as
    // `provider-result-invalid` before the comparison, which test 25 covers.
    for (const substituted of ['Test-Execution', 'TEST-EXECUTION', 'test-execution-x']) {
      const decoy = fakeProvider({
        respond: (r) => ({ providerId: substituted, requestId: r.id, status: 'accepted' as const }),
      });
      const refused = await run(authorizedRequest(), decoy.provider);
      expect(refused.executed, substituted).toBe(false);
      expect(refused.reason, substituted).toBe('provider-result-provider-mismatch');
      expect(refused.result).toBeNull();
    }
  });

  it('28. a provider-result requestId that is not the request is refused', async () => {
    const { provider, calls } = fakeProvider({
      respond: () => ({
        providerId: PROVIDER_ID,
        requestId: 'trip-execution-provider-request:trip-execution-dispatch:trip-planning-execution-authorization:other',
        status: 'accepted' as const,
      }),
    });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-result-request-mismatch');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('29. a malformed provider result never leaks as success', async () => {
    const request = authorizedRequest();
    const everyBadAnswer: ReadonlyArray<unknown> = [
      null,
      undefined,
      'accepted',
      42,
      {},
      { providerId: PROVIDER_ID },
      { providerId: PROVIDER_ID, requestId: request.requestId, status: 'confirmed' },
      { providerId: ' padded ', requestId: request.requestId, status: 'accepted' },
      { providerId: PROVIDER_ID, requestId: 'bogus', status: 'accepted' },
      { providerId: OTHER_PROVIDER_ID, requestId: request.requestId, status: 'accepted' },
      { providerId: PROVIDER_ID, requestId: 'trip-execution-provider-request:other', status: 'accepted' },
    ];
    for (const answer of everyBadAnswer) {
      const { provider } = fakeProvider({ respond: () => answer });
      const result = await run(request, provider);
      expect(result.executed, JSON.stringify(answer) ?? 'symbol').toBe(false);
      // Whatever the answer, a failed boundary verdict never carries a result.
      expect(result.result, JSON.stringify(answer) ?? 'symbol').toBeNull();
      expect(TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS).toContain(result.reason);
      expect(result.reason).not.toBe('executed');
    }
  });
});

describe('STEP 75 authorized execution: provider failure (30-35)', () => {
  it('30. a synchronous throw from execute becomes a bounded failure', async () => {
    const calls: TripExecutionProviderRequest[] = [];
    const provider = {
      providerId: PROVIDER_ID,
      execute(request: TripExecutionProviderRequest): unknown {
        calls.push(request);
        throw new Error(SECRET);
      },
    };
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-execution-failed');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('31. a rejected execute promise becomes a bounded failure', async () => {
    const { provider, calls } = fakeProvider({
      respond: () => Promise.reject(new Error(SECRET)),
    });
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-execution-failed');
    expect(result.result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('32. a thrown exception is never exposed', async () => {
    const provider = {
      providerId: PROVIDER_ID,
      execute(): unknown {
        throw new Error(SECRET);
      },
    };
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-execution-failed');
    // Nothing from the exception reaches the result, in any field.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('amadeus-live-key');
    expect(serialized).not.toContain('internal-provider');
    expect(serialized).not.toContain('Error');
    expect(serialized).not.toContain('at ');
    expect(Object.keys(result).sort()).toEqual([
      'executed',
      'providerId',
      'reason',
      'requestId',
      'result',
    ]);
  });

  it('33. a rejected exception is never exposed, and a non-Error throw is contained', async () => {
    for (const thrown of [
      new Error(SECRET),
      SECRET,
      { credential: SECRET, url: 'https://api.example.test' },
      null,
      undefined,
      7,
    ]) {
      const provider = {
        providerId: PROVIDER_ID,
        execute(): unknown {
          return Promise.reject(thrown);
        },
      };
      const result = await run(authorizedRequest(), provider);
      expect(result.executed, String(thrown)).toBe(false);
      expect(result.reason, String(thrown)).toBe('provider-execution-failed');
      expect(result.result, String(thrown)).toBeNull();
      expect(JSON.stringify(result), String(thrown)).not.toContain('amadeus-live-key');
      expect(JSON.stringify(result), String(thrown)).not.toContain('api.example.test');
    }
  });

  it('34. a failure is not retried', async () => {
    let attempts = 0;
    const provider = {
      providerId: PROVIDER_ID,
      execute(): unknown {
        attempts += 1;
        throw new Error(SECRET);
      },
    };
    const result = await run(authorizedRequest(), provider);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('provider-execution-failed');
    // Exactly one attempt: no retry loop, no backoff, no second call.
    expect(attempts).toBe(1);

    // A rejection is equally unretried.
    let rejects = 0;
    const rejecting = fakeProvider({
      respond: () => {
        rejects += 1;
        return Promise.reject(new Error(SECRET));
      },
    });
    await run(authorizedRequest(), rejecting.provider);
    expect(rejects).toBe(1);
    expect(rejecting.calls).toHaveLength(1);
  });

  it('35. no fallback provider is invoked on failure', async () => {
    const decoy = acceptingFake(OTHER_PROVIDER_ID);
    const provider = {
      providerId: PROVIDER_ID,
      execute(): unknown {
        throw new Error(SECRET);
      },
    };
    const result = await run(authorizedRequest(), provider);
    expect(result.reason).toBe('provider-execution-failed');
    // The qualified decoy, sitting in the same qualified set, is never touched.
    expect(decoy.calls).toHaveLength(0);
    // And there is exactly one call site in the module: no second execute call
    // could serve as a fallback even if one were wanted.
    expect(CODE.split('provider.execute(').length - 1).toBe(1);
  });
});

describe('STEP 75 authorized execution: output integrity (36-40)', () => {
  it('36. a successful result carries the actual STEP 59 provider result', async () => {
    const providerResult: TripExecutionProviderResult = {
      providerId: PROVIDER_ID,
      requestId: 'trip-execution-provider-request:trip-execution-dispatch:real',
      status: 'rejected',
    };
    const { provider } = fakeProvider({ respond: () => providerResult });
    const result = await run(requestWith({ requestId: providerResult.requestId, providerRequest: { id: providerResult.requestId, kind: 'trip-execution-provider-request', dispatchId: 'trip-execution-dispatch:real' } }), provider);

    expect(result.executed).toBe(true);
    // Object identity: the provider's own value, not a copy or a reconstruction.
    expect(result.result).toBe(providerResult);
    expect(result.result).toEqual({
      providerId: PROVIDER_ID,
      requestId: providerResult.requestId,
      status: 'rejected',
    });
  });

  it('37. the request id is preserved from request to result', async () => {
    const request = authorizedRequest();
    const { provider } = acceptingFake();
    const result = await run(request, provider);
    expect(result.requestId).toBe(request.requestId);
    expect(result.requestId).toBe(
      (request.providerRequest as TripExecutionProviderRequest).id
    );
    expect(typeof result.requestId).toBe('string');

    // Preserved on a provider-side failure too, where the request is still known.
    const throwing = {
      providerId: PROVIDER_ID,
      execute(): unknown {
        throw new Error(SECRET);
      },
    };
    const failed = await run(request, throwing);
    expect(failed.requestId).toBe(request.requestId);
    expect(failed.providerId).toBe(PROVIDER_ID);
  });

  it('38. the provider id is preserved from provider to result', async () => {
    const provider = acceptingFake();
    const result = await run(authorizedRequest(), provider.provider);
    expect(result.providerId).toBe(provider.provider.providerId);
    expect(result.providerId).toBe(PROVIDER_ID);
    expect(result.result?.providerId).toBe(PROVIDER_ID);
  });

  it('39. every failure has result === null', async () => {
    const request = authorizedRequest();
    const failing: ReadonlyArray<[string, unknown, unknown]> = [
      ['request-invalid', undefined, acceptingFake().provider],
      ['request-not-accepted', unacceptedRequest(), acceptingFake().provider],
      ['request-identity-invalid', requestWith({ requestId: 'bogus' }), acceptingFake().provider],
      ['provider-invalid', request, 'test-execution'],
      ['provider-identity-mismatch', request, acceptingFake(OTHER_PROVIDER_ID).provider],
      ['provider-result-invalid', request, fakeProvider({ respond: () => null }).provider],
      ['provider-result-provider-mismatch', request, fakeProvider({ respond: (r) => ({ providerId: OTHER_PROVIDER_ID, requestId: r.id, status: 'accepted' as const }) }).provider],
      ['provider-result-request-mismatch', request, fakeProvider({ respond: () => ({ providerId: PROVIDER_ID, requestId: 'trip-execution-provider-request:other', status: 'accepted' as const }) }).provider],
      ['provider-execution-failed', request, { providerId: PROVIDER_ID, execute(): unknown { throw new Error(SECRET); } }],
    ];
    const seen = new Set<string>();
    for (const [reason, req, prov] of failing) {
      const result = await run(req, prov);
      expect(result.executed, reason).toBe(false);
      expect(result.reason, reason).toBe(reason);
      expect(result.result, reason).toBeNull();
      seen.add(result.reason);
    }
    // Every non-affirmative token in the closed vocabulary is actually reachable.
    expect([...seen].sort()).toEqual(
      TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS.filter((r) => r !== 'executed').sort()
    );
  });

  it('40. every failure has executed === false and a vocabulary reason', async () => {
    const inputs: ReadonlyArray<unknown> = [
      undefined,
      null,
      'x',
      7,
      [],
      {},
      { accepted: true },
      { accepted: false, reason: 'not-authorized', providerRequest: null, requestId: null, providerIds: [] },
      unacceptedRequest(),
      authorizedRequest(),
      requestWith({ providerRequest: null }),
      requestWith({ requestId: 'bogus' }),
    ];
    for (const request of inputs) {
      for (const provider of [undefined, null, 'x', {}, { providerId: PROVIDER_ID }, acceptingFake().provider]) {
        const result = await run(request, provider);
        const label = `${JSON.stringify(request) ?? 'x'}/${JSON.stringify(provider) ?? 'x'}`;
        if (result.executed) {
          expect(result.reason, label).toBe('executed');
          expect(result.result, label).not.toBeNull();
        } else {
          expect(result.executed, label).toBe(false);
          expect(result.result, label).toBeNull();
          expect(TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS, label).toContain(result.reason);
        }
        expect(Object.keys(result).sort(), label).toEqual([
          'executed',
          'providerId',
          'reason',
          'requestId',
          'result',
        ]);
      }
    }
  });
});

describe('STEP 75 authorized execution: safety properties (41-46)', () => {
  it('41. repeated valid execution invokes the provider once per call', async () => {
    const { provider, calls } = acceptingFake();
    const request = authorizedRequest();
    for (let i = 1; i <= 5; i += 1) {
      const result = await run(request, provider);
      expect(result.executed, `call ${i}`).toBe(true);
      expect(calls, `call ${i}`).toHaveLength(i);
    }
    // No tally, no cache, no deduplication: each call is one more invocation.
    expect(calls.every((c) => c.id === request.requestId)).toBe(true);
  });

  it('42. no request mutation across many executions and statuses', async () => {
    const request = authorizedRequest();
    const before = JSON.stringify(request);
    for (const status of ['accepted', 'rejected', 'unsupported', 'failed'] as const) {
      const { provider } = fakeProvider({
        respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status }),
      });
      const result = await run(request, provider);
      expect(result.executed, status).toBe(true);
      expect(JSON.stringify(request), status).toBe(before);
    }
    // A provider that mutates the request is the provider's doing, not this
    // boundary's; the boundary neither performs nor repairs such a change.
    const mutating = {
      providerId: PROVIDER_ID,
      execute(target: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
        target.dispatchId = 'tampered';
        return Promise.resolve({ providerId: PROVIDER_ID, requestId: target.id, status: 'accepted' as const });
      },
    };
    const mutable = authorizedRequest();
    const outcome = await run(mutable, mutating);
    expect(outcome.executed).toBe(true);
    // The mutation is not silently undone: the request is left as the provider
    // left it, and the boundary reports only what it can honestly report.
    expect((mutable.providerRequest as TripExecutionProviderRequest).dispatchId).toBe('tampered');
    expect(outcome.requestId).toBe(mutable.requestId);
  });

  it('43. boundary behavior is deterministic apart from the provider answer', async () => {
    const request = authorizedRequest();
    const runs: TripExecutionAuthorizedExecutionResult[] = [];
    for (let i = 0; i < 4; i += 1) {
      runs.push(await run(request, acceptingFake().provider));
    }
    // Same input, same provider, same output: no clock, no randomness, no tally,
    // no running state.
    for (const result of runs) {
      expect(result).toEqual(runs[0]);
    }
    // The same holds for a failure, including one caused by a throw.
    const throwing = {
      providerId: PROVIDER_ID,
      execute(): unknown {
        throw new Error(SECRET);
      },
    };
    const failures = [await run(request, throwing), await run(request, throwing)];
    expect(failures[0]).toEqual(failures[1]);
    expect(failures[0].reason).toBe('provider-execution-failed');
  });

  it('44. no sorting, ranking, or scoring of providers', async () => {
    // Three qualified providers in a deliberately unsorted order. The gate is a
    // membership test, so any of them may run, and which one was chosen was
    // decided upstream.
    const qualified = ['zeta-execution', 'alpha-execution', 'middle-execution'];
    const request = authorizedRequest(qualified);
    expect(request.providerIds).toEqual(qualified);

    for (const providerId of qualified) {
      const { provider } = acceptingFake(providerId);
      const result = await run(request, provider);
      expect(result.executed, providerId).toBe(true);
      expect(result.providerId, providerId).toBe(providerId);
    }

    // A fourth qualified provider would work identically: no preference, no
    // score, no best-of selection.
    const fourth = acceptingFake('another-execution');
    expect(fourth.calls).toHaveLength(0);

    // The order on the request is not re-ordered on the way through.
    const after = await run(request, acceptingFake('alpha-execution').provider);
    expect(after.executed).toBe(true);
    expect((request as Record<string, unknown>).providerIds).toEqual(qualified);
  });

  it('45. no capability is invented, inferred, or re-checked', async () => {
    const result = await run(authorizedRequest(), acceptingFake().provider);
    expect(result.executed).toBe(true);
    // The boundary reports no capability of its own: the provider's answer is the
    // only thing said about support.
    expect('capabilityId' in result).toBe(false);
    expect('requiredCapabilityId' in result).toBe(false);
    expect('capabilityIds' in result).toBe(false);
    for (const reason of TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS) {
      expect(reason).not.toContain('capability');
    }
    // It does not call a provider's supports() either, and a provider that
    // declares no support at all is still executed.
    const withoutSupport = {
      providerId: PROVIDER_ID,
      execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
        return Promise.resolve({ providerId: PROVIDER_ID, requestId: request.id, status: 'unsupported' as const });
      },
    };
    const executed = await run(authorizedRequest(), withoutSupport);
    expect(executed.executed).toBe(true);
    expect(executed.result?.status).toBe('unsupported');
    expect(CODE).not.toContain('.supports');
  });

  it('46. no booking, payment, or reservation semantics are added', async () => {
    // The closed vocabulary says nothing about commerce.
    for (const token of [
      'booking',
      'booked',
      'payment',
      'paid',
      'reservation',
      'reserve',
      'ticket',
      'invoice',
      'charge',
      'refund',
      'money',
    ]) {
      for (const reason of TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS) {
        expect(reason, `${token} in ${reason}`).not.toContain(token);
      }
    }

    // `accepted` is returned with no extra field claiming anything happened.
    const request = authorizedRequest();
    const { provider } = fakeProvider({
      respond: (r) => ({ providerId: PROVIDER_ID, requestId: r.id, status: 'accepted' as const }),
    });
    const result = await run(request, provider);
    expect(result.executed).toBe(true);
    expect(result.result).toEqual({
      providerId: PROVIDER_ID,
      requestId: request.requestId,
      status: 'accepted',
    });
    // No confirmation, booking reference, price, or currency anywhere.
    for (const token of ['confirmation', 'confirmationNumber', 'price', 'currency', 'total']) {
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});

describe('STEP 75 authorized execution: architectural regression (47-55)', () => {
  it('47. no orchestrator is imported or called', () => {
    expect(CODE).not.toContain('orchestrator');
    expect(CODE).not.toContain('Orchestrator');
    expect(CODE).not.toContain('tripExecutionOrchestrator');
    // And no plan or pipeline stage is re-entered.
    expect(CODE).not.toContain('createTripExecutionPlan');
    expect(CODE).not.toContain('evaluateTripExecutionPlanQualification');
  });

  it('48. no execution pipeline is imported or driven', () => {
    expect(CODE).not.toContain('Pipeline');
    expect(CODE).not.toContain('pipeline');
    expect(CODE).not.toContain('runTripExecution');
    // The complete import list, enumerated from the real module specifiers. This
    // is the whole dependency surface: STEP 59's contract, STEP 74's reason
    // vocabulary, and the shared provider-identity bound that STEP 59 itself
    // uses. No orchestrator, pipeline, plan, qualification, dispatch, provider
    // implementation, or layer below.
    const imports = [...CODE_WITH_LITERALS.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.slice().sort()).toEqual([
      '../../domain/providers/providerResults',
      './tripExecutionAuthorizedRequest',
      './tripExecutionProvider',
    ]);
    // Nothing else is even referenced, let alone imported.
    for (const token of [
      'tripExecutionOrchestrator',
      'tripExecutionPipeline',
      'tripExecutionPlan',
      'tripExecutionPlanQualification',
      'tripExecutionQualifiedDispatch',
      'tripExecutionQualifiedAuthorization',
      'mockTripExecutionProvider',
      'aiPlanningService',
      'tripService',
    ]) {
      expect(CODE_WITH_LITERALS, token).not.toContain(token);
    }
  });

  it('49. no concrete provider implementation is imported or created', () => {
    for (const token of [
      'mockTripExecutionProvider',
      'MOCK_TRIP_EXECUTION_PROVIDER_ID',
      'amadeus',
      'Amadeus',
      'google',
      'Google',
      'createTripExecutionProvider',
      'new ',
      'discover',
      'Discover',
      'select',
      'Select',
      'rank',
      'Rank',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    // The provider is only ever read from the input.
    expect(CODE).toContain('provider.execute(providerRequest)');
  });

  it('50. no network or fetch logic exists', () => {
    for (const token of [
      'fetch(',
      'XMLHttpRequest',
      'axios',
      'https',
      'http:',
      'request(',
      'Authorization',
      'Bearer',
      'apiKey',
      'process.env',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    // The single await is the provider's own execute call and nothing else.
    expect([...CODE.matchAll(/await/g)].length).toBe(1);
  });

  it('51. no Firebase dependency', () => {
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
    ]) {
      expect(CODE, token).not.toContain(token);
    }
  });

  it('52. no React, Router, or Zustand dependency', () => {
    for (const token of [
      'react',
      'useState',
      'useEffect',
      'useNavigate',
      'useParams',
      'react-router',
      'Router',
      'zustand',
      'useStore',
      'create(',
      'JSX',
      'tsx',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
  });

  it('53. no persistence is performed', () => {
    for (const token of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'persist',
      'save',
      'write',
      'insert',
      'upsert',
      'setItem',
      'emit',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
  });

  it('54. no retry loop and no timer exists', () => {
    for (const token of [
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'sleep',
      'retry',
      'Retry',
      'backoff',
      'attempt',
      'while (',
      'for (',
      'Promise.all',
      'Promise.race',
      '.catch(',
      'catch {',
    ]) {
      // The one allowed catch is the guarded call into the provider, and it is
      // asserted separately below; no other catch form may appear.
      if (token === 'catch {') {
        expect([...CODE.matchAll(/catch\s*\{/g)].length).toBe(1);
        continue;
      }
      expect(CODE, token).not.toContain(token);
    }
    // A bare `catch (` (a parameterised catch binding) would be a second form.
    expect(CODE).not.toContain('catch (');
  });

  it('55. no environment, clock, or global mutable state is read', () => {
    for (const token of [
      'import.meta',
      'process.env',
      'Deno.env',
      'window',
      'document',
      'globalThis',
      'Date',
      'Date.now',
      'performance',
      'Math.random',
      'crypto',
      'localStorage',
    ]) {
      expect(CODE, token).not.toContain(token);
    }
    // No module-level mutable binding. The only `let` in the file is the single
    // function-local that receives the provider's answer, so there is no state
    // that could survive between calls.
    const lets = [...CODE.matchAll(/\blet\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(lets).toEqual(['raw']);
    expect(CODE).not.toContain('var ');
  });
});

describe('STEP 75 authorized execution: boundary scope', () => {
  it('55b. the reason vocabulary is closed, bounded, and provider-neutral', () => {
    expect([...TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS]).toEqual([
      'executed',
      'request-invalid',
      'request-not-accepted',
      'request-identity-invalid',
      'provider-invalid',
      'provider-identity-mismatch',
      'provider-execution-failed',
      'provider-result-invalid',
      'provider-result-provider-mismatch',
      'provider-result-request-mismatch',
    ]);
    // Every token is lowercase, hyphenated, and free of provider internals.
    for (const reason of TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z-]*$/);
      expect(reason).not.toContain('http');
      expect(reason).not.toContain(' ');
    }
    // Exactly one affirmative token.
    const affirmative = TRIP_EXECUTION_AUTHORIZED_EXECUTION_REASONS.filter(
      (r) => !r.endsWith('-invalid') && !r.endsWith('-failed') && !r.endsWith('-mismatch') && r !== 'request-not-accepted'
    );
    expect(affirmative).toEqual(['executed']);
  });

  it('55c. the input accepts only a request and a provider', async () => {
    // No other accepted key: the boundary cannot be handed a URL, credential,
    // client, or selection list through a documented field.
    const result = await run(authorizedRequest(), acceptingFake().provider);
    expect(Object.keys(result).sort()).toEqual([
      'executed',
      'providerId',
      'reason',
      'requestId',
      'result',
    ]);
    // A provider array is not a provider.
    const list = [acceptingFake().provider, acceptingFake(OTHER_PROVIDER_ID).provider];
    const refused = await run(authorizedRequest(), list);
    expect(refused.executed).toBe(false);
    expect(refused.reason).toBe('provider-invalid');
    expect(refused.result).toBeNull();
  });
});
