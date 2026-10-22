import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTripPlanningApplication } from '../domain/trips/tripPlanningApplication';
import { createTripPlanningApplicationTarget } from '../domain/trips/tripPlanningApplicationTarget';
import { createTripPlanningApplicationBinding } from '../domain/trips/tripPlanningApplicationBinding';
import { createTripPlanningExecutionIntent } from '../domain/trips/tripPlanningExecutionIntent';
import {
  createTripPlanningExecutionRequest,
  getTripPlanningExecutionRequestId,
  TRIP_PLANNING_EXECUTION_REQUEST_KIND,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import { createTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposal';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import type { TripPlanningReference } from '../types/trip';
import {
  evaluateTripExecutionEligibility,
  PROVIDER_CAPABILITY_IDS,
  TRIP_EXECUTION_ELIGIBILITY_REASONS,
  type TripExecutionEligibility,
} from '../services/tripExecution/tripExecutionEligibility';

/**
 * The module source with comments and string literals stripped, so a structural
 * assertion cannot be fooled by prose. The eligibility module documents at length
 * that it makes no network call and holds no credential; a check that forbids
 * `fetch(` or `clientSecret` must not fail because a comment says so.
 */
const ELIGIBILITY_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'services', 'tripExecution', 'tripExecutionEligibility.ts'),
  'utf8'
);

/** The same source with comments and string literals removed. */
const ELIGIBILITY_CODE = ELIGIBILITY_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

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

/** A real STEP 56 request built through the real chain, never a hand-rolled stub. */
function validRequest(): TripPlanningExecutionRequest {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  });
  const proposal = createTripPlanningCompositionProposal(composition) as NonNullable<
    ReturnType<typeof createTripPlanningCompositionProposal>
  >;
  const approved = approveTripPlanningCompositionProposal(proposal) as NonNullable<
    ReturnType<typeof approveTripPlanningCompositionProposal>
  >;
  const application = createTripPlanningApplication(approved) as NonNullable<
    ReturnType<typeof createTripPlanningApplication>
  >;
  const target = createTripPlanningApplicationTarget({ scope: 'trip', tripId: 'trip-abc' }) as NonNullable<
    ReturnType<typeof createTripPlanningApplicationTarget>
  >;
  const binding = createTripPlanningApplicationBinding(application, target) as NonNullable<
    ReturnType<typeof createTripPlanningApplicationBinding>
  >;
  const intent = createTripPlanningExecutionIntent(binding) as NonNullable<
    ReturnType<typeof createTripPlanningExecutionIntent>
  >;
  return createTripPlanningExecutionRequest(intent) as TripPlanningExecutionRequest;
}

/** A snapshot entry with the STEP 69 shape. */
function provider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId: 'amadeus-execution',
    status: 'available',
    capabilityIds: ['search-transport'],
    reason: null,
    ...overrides,
  };
}

function snapshot(providers: ReadonlyArray<unknown>, problem: unknown = null): Record<string, unknown> {
  return { providers, problem };
}

function evaluate(
  request: unknown,
  snap: unknown,
  requiredCapabilityId?: unknown
): TripExecutionEligibility {
  return evaluateTripExecutionEligibility({ request, snapshot: snap, requiredCapabilityId });
}

describe('STEP 70 eligibility: validity (1-4)', () => {
  it('1. valid request + valid snapshot + explicit capability is eligible', () => {
    const result = evaluate(
      validRequest(),
      snapshot([provider()]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('eligible');
    expect(result.providerIds).toEqual(['amadeus-execution']);
    expect(result.capabilityIds).toEqual(['search-transport']);
    expect(result.requestId).toMatch(/^trip-planning-execution-request:/);
  });

  it('2. malformed request is ineligible and is never repaired', () => {
    const request = validRequest();
    const malformed: unknown[] = [
      null,
      undefined,
      'a-request',
      42,
      [],
      {},
      { ...request, kind: 'wrong-kind' },
      { ...request, intentId: 'not-an-intent-id' },
      // An id that no longer derives from the intent is internally inconsistent.
      { ...request, id: `${TRIP_PLANNING_EXECUTION_REQUEST_KIND}-forged` },
    ];
    for (const bad of malformed) {
      const result = evaluate(bad, snapshot([provider()]), 'search-transport');
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('request-invalid');
      expect(result.providerIds).toEqual([]);
      expect(result.requestId).toBeNull();
    }
  });

  it('2b. a tampered-but-well-shaped request fails its deterministic id check', () => {
    const request = validRequest();
    const forged = { ...request, id: getTripPlanningExecutionRequestId('forged-intent') };
    expect(evaluate(forged, snapshot([provider()]), 'search-transport').reason).toBe(
      'request-invalid'
    );
  });

  it('3. null or missing snapshot is ineligible, and distinct from empty', () => {
    for (const missing of [null, undefined]) {
      const result = evaluate(validRequest(), missing, 'search-transport');
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('snapshot-missing');
      expect(result.providerIds).toEqual([]);
    }
  });

  it('3b. an empty provider list is NOT snapshot-missing (10)', () => {
    // A present-but-empty snapshot is a real answer meaning nothing supports the
    // capability. Conflating it with "no snapshot" would hide a real state.
    const result = evaluate(validRequest(), snapshot([]), 'search-transport');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
  });

  it('4. malformed snapshot is ineligible and never partially trusted', () => {
    const malformed: unknown[] = [
      'a-snapshot',
      42,
      [],
      {},
      { providers: 'not-an-array' },
      snapshot([null]),
      snapshot(['amadeus-execution']),
      snapshot([[]]),
      snapshot([provider({ providerId: '' })]),
      snapshot([provider({ providerId: ' padded ' })]),
      snapshot([provider({ providerId: 'a'.repeat(101) })]),
      snapshot([provider({ status: 'ready' })]),
      snapshot([provider({ status: 'available', reason: 'execution-disabled' })]),
      snapshot([provider({ capabilityIds: 'search-transport' })]),
      snapshot([provider({ capabilityIds: ['flight-booking'] })]),
      snapshot([provider({ capabilityIds: [42] })]),
      snapshot([provider()], 'server-error'),
    ];
    for (const bad of malformed) {
      const result = evaluate(validRequest(), bad, 'search-transport');
      expect(result.eligible).toBe(false);
      expect(['snapshot-malformed', 'provider-identity-invalid']).toContain(result.reason);
      expect(result.providerIds).toEqual([]);
      expect(result.capabilityIds).toEqual([]);
    }
  });

  it('4b. a valid request id is echoed even when the snapshot is bad', () => {
    const request = validRequest();
    const result = evaluate(request, { providers: 'nope' }, 'search-transport');
    // The request was valid, so its id is safely reportable even though the
    // snapshot was not.
    expect(result.requestId).toBe(request.id);
    expect(result.reason).toBe('snapshot-malformed');
  });

  it('4c. non-object input does not throw', () => {
    for (const bad of [null, undefined, 'x', 7, true]) {
      expect(() => evaluateTripExecutionEligibility(bad as never)).not.toThrow();
      const result = evaluateTripExecutionEligibility(bad as never);
      expect(result.eligible).toBe(false);
    }
  });
});

describe('STEP 70 eligibility: capability matching (5-10)', () => {
  it('5. exact capability match is eligible', () => {
    for (const id of PROVIDER_CAPABILITY_IDS) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: [id] })]),
        id
      );
      expect(result.eligible, `"${id}" should match exactly`).toBe(true);
      expect(result.capabilityIds).toEqual([id]);
    }
  });

  it('5b. every recognized capability is independently eligible', () => {
    // Guard against a single id being special-cased.
    const matched = PROVIDER_CAPABILITY_IDS.filter(
      (id) => evaluate(validRequest(), snapshot([provider({ capabilityIds: [id] })]), id).eligible
    );
    expect(matched).toEqual([...PROVIDER_CAPABILITY_IDS]);
  });

  it('6. capability absent is ineligible', () => {
    const result = evaluate(
      validRequest(),
      snapshot([provider({ capabilityIds: [] })]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
    expect(result.providerIds).toEqual([]);
  });

  it('6b. a different reported capability does not satisfy the requirement', () => {
    const result = evaluate(
      validRequest(),
      snapshot([provider({ capabilityIds: ['search-accommodation'] })]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
  });

  it('7. case mismatch is ineligible (no case-insensitive matching)', () => {
    for (const required of [
      'Search-Transport',
      'SEARCH-TRANSPORT',
      'search-TRANSPORT',
      'Search-transport',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: ['search-transport'] })]),
        required
      );
      expect(result.eligible, `"${required}" must not match`).toBe(false);
      // An unrecognized requirement is reported as unspecified, not as "unsupported".
      expect(result.reason).toBe('capability-unspecified');
    }
  });

  it('7b. case mismatch inside the snapshot is also rejected, not repaired', () => {
    const result = evaluate(
      validRequest(),
      snapshot([provider({ capabilityIds: ['Search-Transport'] })]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('snapshot-malformed');
  });

  it('8. whitespace mismatch is ineligible (no whitespace normalization)', () => {
    for (const required of [
      ' search-transport',
      'search-transport ',
      ' search-transport ',
      'search transport',
      'search\ttransport',
      'search-\ntransport',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: ['search-transport'] })]),
        required
      );
      expect(result.eligible, `"${JSON.stringify(required)}" must not match`).toBe(false);
    }
  });

  it('8b. whitespace inside the snapshot is rejected as malformed', () => {
    for (const reported of [' search-transport', 'search-transport ', 'search- transport']) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: [reported] })]),
        'search-transport'
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('snapshot-malformed');
    }
  });

  it('9. alias mismatch is ineligible (no alias table)', () => {
    for (const alias of [
      'searchTransport',
      'search_transport',
      'transport-search',
      'find-transport',
      'search-transport-search',
      'transport',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: [alias] })]),
        'search-transport'
      );
      expect(result.eligible, `alias "${alias}" must not match`).toBe(false);
    }
  });

  it('10. substring, prefix, and suffix mismatches are ineligible', () => {
    // The spec's own example: none of these may satisfy "hotel-booking".
    for (const near of [
      'hotel',
      'Hotel-Booking',
      'hotel_booking',
      'hotel-booking-v2',
      'book',
      'booking',
      'hotel-book',
      'otel-booking',
      'xsearch-transport',
      'search-transportx',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: [near] })]),
        near
      );
      // Either the capability is not in the recognized vocabulary at all
      // (`capability-unspecified`) or the snapshot naming it is malformed.
      expect(result.eligible, `near-miss "${near}" must not be eligible`).toBe(false);
    }
  });

  it('10b. a required capability that is a substring of a reported one still fails', () => {
    // 'hotel' is a substring of 'hotel-booking'; neither is recognized, and the
    // point is that a shorter id is never treated as satisfied by a longer one.
    const result = evaluate(
      validRequest(),
      snapshot([provider({ capabilityIds: ['search-transport'] })]),
      'search'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('capability-unspecified');
  });
});

describe('STEP 70 eligibility: provider matching (11-16)', () => {
  it('11. exact provider id is preserved verbatim', () => {
    for (const providerId of [
      'amadeus-execution',
      'provider-b',
      'A',
      'provider_2',
      'x'.repeat(100),
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ providerId, capabilityIds: ['search-transport'] })]),
        'search-transport'
      );
      expect(result.eligible).toBe(true);
      // Byte-for-byte: no case change, no trim, no transformation.
      expect(result.providerIds).toEqual([providerId]);
      expect(result.providerIds[0]).toBe(providerId);
    }
  });

  it('12. invalid provider id is ineligible and invalidates the snapshot', () => {
    for (const providerId of [
      '',
      '  ',
      ' padded',
      'trailing ',
      'a'.repeat(101),
      42,
      null,
      undefined,
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ providerId, capabilityIds: ['search-transport'] })]),
        'search-transport'
      );
      expect(result.eligible, `providerId ${JSON.stringify(providerId)}`).toBe(false);
      expect(result.providerIds).toEqual([]);
    }
  });

  it('12b. an invalid provider id fails the whole snapshot, not just that entry', () => {
    // The bad entry might have been the matching one, so it cannot be skipped.
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'good', capabilityIds: ['search-transport'] }),
        provider({ providerId: '' }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.providerIds).toEqual([]);
  });

  it('13. duplicate provider id fails closed and is never deduplicated', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'amadeus-execution', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'amadeus-execution', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
    // Silently keeping one would hide the contradiction behind a plausible answer.
    expect(result.providerIds).toEqual([]);
  });

  it('13b. a duplicate is detected even when only one copy matches', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'dup', capabilityIds: [] }),
        provider({ providerId: 'dup', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
  });

  it('13c. a duplicate of an unrelated provider also fails', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'dup', capabilityIds: [] }),
        provider({ providerId: 'dup', capabilityIds: [] }),
        provider({ providerId: 'matcher', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('provider-identity-duplicate');
  });

  it('14. provider ordering is preserved exactly as reported', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'zeta', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'alpha', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'mid', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    // Not sorted alphabetically, not ranked: the server's order, untouched.
    expect(result.providerIds).toEqual(['zeta', 'alpha', 'mid']);
  });

  it('14b. a non-alphabetical server order survives verbatim', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'c-provider', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'a-provider', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'b-provider', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.providerIds).toEqual(['c-provider', 'a-provider', 'b-provider']);
  });

  it('15. an unavailable provider is not eligible even with a matching capability', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({
          status: 'unavailable',
          reason: 'execution-disabled',
          capabilityIds: ['search-transport'],
        }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
    expect(result.providerIds).toEqual([]);
  });

  it('15b. a credential-less provider is ineligible and leaks no credential detail', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({
          status: 'unavailable',
          reason: 'credentials-missing',
          capabilityIds: ['search-transport'],
        }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    // The result carries no reason about credentials of its own; it simply reports
    // that no provider is eligible.
    expect(result.reason).toBe('no-eligible-provider');
    expect(TRIP_EXECUTION_ELIGIBILITY_REASONS).not.toContain('credentials-missing');
  });

  it('16. an unsupported provider is not eligible', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({
          status: 'unsupported',
          reason: 'no-executable-capability',
          capabilityIds: ['search-transport'],
        }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
  });
});

describe('STEP 70 eligibility: multiple providers (17-20)', () => {
  it('17. exactly one eligible provider returns only that provider', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'no-caps', status: 'unsupported', reason: 'no-executable-capability', capabilityIds: [] }),
        provider({ providerId: 'matcher', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'disabled', status: 'unavailable', reason: 'execution-disabled', capabilityIds: [] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    expect(result.providerIds).toEqual(['matcher']);
  });

  it('18. multiple eligible providers are all returned, in server order', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'p1', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'p2', capabilityIds: ['search-transport', 'search-accommodation'] }),
        provider({ providerId: 'p3', capabilityIds: ['search-transport'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    expect(result.providerIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('18b. a provider reporting several capabilities is still listed once', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'multi', capabilityIds: ['search-transport', 'search-accommodation', 'verify-reference'] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    expect(result.providerIds).toEqual(['multi']);
    // One provider, one entry: no per-capability duplication.
    expect(result.providerIds).toHaveLength(1);
  });

  it('19. mixed providers yield only the eligible ones, order preserved', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'match-1', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'no-match', capabilityIds: ['search-accommodation'] }),
        provider({ providerId: 'match-2', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'disabled', status: 'unavailable', reason: 'execution-disabled', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'match-3', capabilityIds: ['search-transport'] }),
        provider({ providerId: 'unsupported', status: 'unsupported', reason: 'no-executable-capability', capabilityIds: [] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(true);
    expect(result.providerIds).toEqual(['match-1', 'match-2', 'match-3']);
  });

  it('20. no eligible providers is ineligible with an empty list', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ providerId: 'a', capabilityIds: [] }),
        provider({ providerId: 'b', capabilityIds: ['search-accommodation'] }),
        provider({ providerId: 'c', status: 'unavailable', reason: 'credentials-missing', capabilityIds: [] }),
      ]),
      'search-transport'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
    expect(result.providerIds).toEqual([]);
    expect(result.capabilityIds).toEqual([]);
  });

  it('20b. an empty provider list is ineligible but well-formed', () => {
    const result = evaluate(validRequest(), snapshot([]), 'search-transport');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-eligible-provider');
    expect(result.requestId).not.toBeNull();
    expect(result.requiredCapabilityId).toBe('search-transport');
  });
});

describe('STEP 70 eligibility: capability semantics (21-24)', () => {
  it('21. an unspecified capability is an explicit non-eligible result', () => {
    // The ordinary case: no execution request names a capability.
    for (const required of [undefined, null, '', 'unknown-capability']) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: ['search-transport'] })]),
        required
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('capability-unspecified');
      expect(result.requiredCapabilityId).toBeNull();
      expect(result.providerIds).toEqual([]);
    }
  });

  it('21b. omitting requiredCapabilityId entirely is capability-unspecified', () => {
    const result = evaluateTripExecutionEligibility({
      request: validRequest(),
      snapshot: snapshot([provider()]),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('capability-unspecified');
  });

  it('21c. a fully valid snapshot still fails closed without a stated capability', () => {
    // This is the honest answer: a request that does not say what it wants cannot
    // be matched against a capability list.
    const result = evaluate(
      validRequest(),
      snapshot([provider({ capabilityIds: ['search-transport', 'search-accommodation'] })]),
      undefined
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('capability-unspecified');
    expect(result.providerIds).toEqual([]);
  });

  it('22. no booking capability is invented from the request', () => {
    for (const invented of [
      'flight-booking',
      'hotel-booking',
      'accommodation-booking',
      'book',
      'booking',
      'create-booking',
      'reserve',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: ['search-transport'] })]),
        invented
      );
      expect(result.eligible, `"${invented}" must not be invented into eligibility`).toBe(false);
      expect(result.reason).toBe('capability-unspecified');
      // And no such id exists in the recognized vocabulary at all.
      expect(PROVIDER_CAPABILITY_IDS).not.toContain(invented);
    }
  });

  it('22b. the mere existence of a request never implies a capability', () => {
    // Same request, no stated capability: the answer must not change.
    const request = validRequest();
    const first = evaluate(request, snapshot([provider()]), undefined);
    const second = evaluate(request, snapshot([provider()]), 'flight-booking');
    expect(first.eligible).toBe(false);
    expect(second.eligible).toBe(false);
    expect(first.reason).toBe('capability-unspecified');
    expect(second.reason).toBe('capability-unspecified');
  });

  it('23. no payment capability is invented', () => {
    for (const invented of [
      'payment',
      'charge-card',
      'process-payment',
      'refund',
      'invoice',
      'purchase',
      'ticket-purchase',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ capabilityIds: ['search-transport'] })]),
        invented
      );
      expect(result.eligible, `"${invented}" must not be invented`).toBe(false);
      expect(PROVIDER_CAPABILITY_IDS).not.toContain(invented);
    }
  });

  it('23b. the recognized vocabulary is unchanged by this step', () => {
    // Step 70 adds no capability. The booking/payment surface is still absent.
    expect([...PROVIDER_CAPABILITY_IDS].sort()).toEqual([
      'retrieve-accommodation-details',
      'retrieve-booking-status',
      'retrieve-cancellation-information',
      'retrieve-transport-details',
      'search-accommodation',
      'search-transport',
      'verify-reference',
    ]);
  });

  it('24. no provider capability is inferred from the provider name', () => {
    // A provider whose id mentions a capability does not thereby support it.
    for (const providerId of [
      'flight-booking-provider',
      'hotel-booking',
      'payment-gateway',
      'search-transport-provider',
    ]) {
      const result = evaluate(
        validRequest(),
        snapshot([provider({ providerId, capabilityIds: [] })]),
        'search-transport'
      );
      expect(result.eligible, `provider "${providerId}" name must imply nothing`).toBe(false);
      expect(result.reason).toBe('no-eligible-provider');
    }
  });

  it('24b. no provider is inferred from a capability name either', () => {
    // An empty snapshot never conjures a provider, even for a known capability.
    const result = evaluate(validRequest(), snapshot([]), 'search-transport');
    expect(result.providerIds).toEqual([]);
    expect(result.eligible).toBe(false);
  });

  it('24c. no provider is fabricated for a providerless input', () => {
    const result = evaluate(null, null, 'search-transport');
    expect(result.eligible).toBe(false);
    expect(result.providerIds).toEqual([]);
    expect(result.requestId).toBeNull();
  });
});

describe('STEP 70 eligibility: safety (25-27)', () => {
  it('25. no network call is possible: the module has no transport surface', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/onCall|httpsCallable|getFunctions/);
  });

  it('26. no persistence is possible', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/firebase|firestore|Firestore|collection\(|doc\(|addDoc|setDoc/);
    expect(source).not.toMatch(/\bfetch\b/);
  });

  it('27. no React, Router, or Zustand dependency', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]react-dom/);
    expect(source).not.toMatch(/from\s+['"]react-router/);
    expect(source).not.toMatch(/from\s+['"]zustand/);
    expect(source).not.toMatch(/useState|useEffect|useMemo|useCallback/);
  });

  it('25b. no provider, credential, or execution path is referenced', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/amadeus/i);
    expect(source).not.toMatch(/credential|clientSecret|accessToken|apiKey|AMADEUS_/i);
    // STEP 63's runtime path is never imported: no plan, no provider invocation.
    expect(source).not.toMatch(/tripExecutionPlan|evaluateTripExecutionCapability\b/);
    expect(source).not.toMatch(/orchestrateTripExecution|executeTripExecutionPipeline/);
    expect(source).not.toMatch(/\.execute\(|executeTripExecution/);
  });

  it('25c. the result never carries a credential, URL, or provider message', () => {
    const result = evaluate(
      validRequest(),
      snapshot([
        provider({ status: 'unavailable', reason: 'credentials-missing', capabilityIds: [] }),
      ]),
      'search-transport'
    );
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'credential',
      'clientSecret',
      'accessToken',
      'http://',
      'https://',
      'AMADEUS',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('25d. purity: no clock, randomness, or environment', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/Date\.now\(|new\s+Date\(\s*\)|Math\.random/);
    expect(source).not.toMatch(/import\.meta\.env|process\.env/);
  });

  it('27b. the evaluation is deterministic across repeated calls', () => {
    const request = validRequest();
    const snap = snapshot([
      provider({ providerId: 'b', capabilityIds: ['search-transport'] }),
      provider({ providerId: 'a', capabilityIds: ['search-transport'] }),
    ]);
    const first = evaluate(request, snap, 'search-transport');
    const second = evaluate(request, snap, 'search-transport');
    const third = evaluate(request, snap, 'search-transport');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(third));
  });

  it('27c. the evaluator mutates neither its inputs nor the snapshot', () => {
    const request = validRequest();
    const providers = [provider({ capabilityIds: ['search-transport'] })];
    const snap = snapshot(providers);
    const requestBefore = JSON.stringify(request);
    const snapBefore = JSON.stringify(snap);
    const providersBefore = JSON.stringify(providers);

    evaluate(request, snap, 'search-transport');

    expect(JSON.stringify(request)).toBe(requestBefore);
    expect(JSON.stringify(snap)).toBe(snapBefore);
    expect(JSON.stringify(providers)).toBe(providersBefore);
  });

  it('27d. the result reason is always from the closed vocabulary', () => {
    const request = validRequest();
    const cases: unknown[] = [
      null,
      undefined,
      'x',
      {},
      snapshot([]),
      snapshot([provider()]),
      snapshot([provider({ providerId: '' })]),
      snapshot([provider(), provider()]),
      'search-transport',
      'no-such-capability',
    ];
    for (const required of cases) {
      for (const snap of cases) {
        const result = evaluate(request, snap, required);
        expect(TRIP_EXECUTION_ELIGIBILITY_REASONS).toContain(result.reason);
        // eligible:false always carries an empty, safe result.
        if (!result.eligible) {
          expect(result.providerIds).toEqual([]);
          expect(result.capabilityIds).toEqual([]);
        }
      }
    }
  });

  it('27e. eligible:true implies a non-empty provider list and one capability', () => {
    const request = validRequest();
    for (const id of PROVIDER_CAPABILITY_IDS) {
      const result = evaluate(
        request,
        snapshot([provider({ capabilityIds: [id] })]),
        id
      );
      if (result.eligible) {
        expect(result.providerIds.length).toBeGreaterThan(0);
        expect(result.capabilityIds).toEqual([id]);
        expect(result.reason).toBe('eligible');
        expect(result.requiredCapabilityId).toBe(id);
        expect(result.requestId).toBe(request.id);
      }
    }
  });

  it('27f. the reason vocabulary itself is closed and bounded', () => {
    expect([...TRIP_EXECUTION_ELIGIBILITY_REASONS].sort()).toEqual([
      'capability-unspecified',
      'eligible',
      'no-eligible-provider',
      'provider-identity-duplicate',
      'provider-identity-invalid',
      'request-invalid',
      'snapshot-malformed',
      'snapshot-missing',
    ]);
  });
});

describe('STEP 70 eligibility: module boundary', () => {
  it('imports only pure domain and type-only step contracts', () => {
    // Scanned against the raw source: import module paths are string literals,
    // which the code view strips.
    const imports = [
      ...ELIGIBILITY_SOURCE.matchAll(
      /import\s+((?:type\s+)?)([\s\S]*?)\s+from\s+'([^']+)';/g
      ),
    ].map(
      (match) => ({
        typeOnly: match[1].trim().startsWith('type'),
        module: match[3],
      })
    );
    // Exactly four dependencies: the Step 20 vocabulary, the shared provider-id
    // bound, the STEP 56 request validator, and the STEP 69 snapshot types.
    expect(imports.map((i) => i.module)).toEqual([
      '../../domain/providers/providerResults',
      '../../domain/providers/providerCapabilities',
      '../../domain/trips/tripPlanningExecutionRequest',
      './tripExecutionCapabilityService',
    ]);
    // The STEP 69 dependency is type-only, so it contributes no runtime code.
    const step69 = imports[3];
    expect(step69.typeOnly).toBe(true);
  });

  it('is a pure module: no class, no mutation, no side effect', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/class\s+\w+/);
    expect(source).not.toMatch(/\basync\b|\bawait\b/);
    expect(source).not.toMatch(/export function \w+[^{]*\)\s*:\s*Promise/);
    // The only exported functions are the pure evaluator and the re-export.
    const exports = [...source.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
    expect(exports).toEqual(['TRIP_EXECUTION_ELIGIBILITY_REASONS', 'evaluateTripExecutionEligibility']);
  });

  it('reuses the shared provider-id bound rather than inventing a limit', () => {
    const source = ELIGIBILITY_CODE;
    expect(source).toMatch(/MAX_PROVIDER_ID_LENGTH/);
    // No second, competing definition of the bound.
    expect(source).not.toMatch(/const\s+MAX_\w*(PROVIDER|CAPABILITY)\w*\s*=/);
  });

  it('does not modify any existing step contract', () => {
    // The evaluator consumes the STEP 56 validator and the STEP 20 vocabulary
    // read-only; it defines no request, provider, plan, or capability type.
    const source = ELIGIBILITY_CODE;
    expect(source).not.toMatch(/export interface TripExecutionProvider/);
    expect(source).not.toMatch(/export interface TripExecutionPlan\b/);
    expect(source).not.toMatch(/export function createTripExecution/);
    expect(source).not.toMatch(/export type ProviderCapabilityId\b/);
  });
});
