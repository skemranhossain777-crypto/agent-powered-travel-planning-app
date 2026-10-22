/**
 * Deterministic, mock-only fixture data for read-only discovery (STEP 21).
 *
 * Everything here is simulated sample data for exercising the STEP 20 provider
 * architecture end-to-end. There is deliberately no real provider, no network,
 * no SDK, no credential, and no current-clock access: every timestamp derives
 * from the `now` the caller passes in, so a given `(query, now)` always maps to
 * the same results.
 *
 * Labeling rules (enforced in code and tests):
 * - Result titles/summaries are prefixed "Mock"/"Sample".
 * - Every result carries `MOCK_RESULT_DISCLAIMER` in its limitations and the
 *   source label is always "Mock Transport Provider"/"Mock Accommodation
 *   Provider".
 * - No result or text claims live availability, a real price, a booking, a
 *   reservation, a confirmation, or a provider reference.
 * - Optional metadata pairs (e.g. `vehicle-class`) are labeled "sample" and
 *   never claim a live attribute.
 *
 * Controlled outcomes: besides the normal sample results, the reserved
 * destination sentinels below drive the empty path, the documented controlled
 * provider failure, a timeout, a rate limit, a malformed-response outcome, and
 * an unknown failure — so the honest STEP 20 outcome vocabulary can be
 * exercised end-to-end without any real provider.
 *
 * Nothing here books, pays, verifies, or persists; the fixtures are never
 * written anywhere and never leave the app as a control.
 */

import type { TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import type {
  ProviderExecutionResult,
  ProviderSafeErrorCategory,
} from '../../domain/providers/executionOperations';
import { buildProviderExecutionFailure } from '../../domain/providers/executionOperations';
import type {
  ProviderResultMetadata,
  TripProviderResult,
  TripProviderResultAvailability,
} from '../../domain/providers/providerResults';

export const MOCK_TRANSPORT_SOURCE_ID = 'mock-transport-provider';
export const MOCK_TRANSPORT_SOURCE_NAME = 'Mock Transport Provider';
export const MOCK_ACCOMMODATION_SOURCE_ID = 'mock-accommodation-provider';
export const MOCK_ACCOMMODATION_SOURCE_NAME = 'Mock Accommodation Provider';
export const MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID = 'mock-alternative-transport-provider';
export const MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME = 'Mock Alternative Transport Provider';

/** Shown on every result and on the discovery panel — never implied away. */
export const MOCK_RESULT_DISCLAIMER = 'Simulated sample data — not live availability or a booking.';

/** Mock quotes are stamped as fresh for this many minutes past `now`. */
export const MOCK_RESULT_FRESHNESS_MINUTES = 24 * 60;

/** Reserved destination sentinel: request an empty (no-options) mock result set. */
export const MOCK_EMPTY_RESULTS_DESTINATION = 'MOCK-EMPTY-RESULTS';

/** Reserved destination sentinel: trigger the documented controlled mock failure. */
export const MOCK_PROVIDER_FAILURE_DESTINATION = 'MOCK-PROVIDER-FAILURE';

/** Reserved destination sentinel: mock outcome times out before a response. */
export const MOCK_TIMEOUT_DESTINATION = 'MOCK-TIMEOUT';

/** Reserved destination sentinel: mock provider reports it is rate-limited. */
export const MOCK_RATE_LIMITED_DESTINATION = 'MOCK-RATE-LIMITED';

/** Reserved destination sentinel: mock provider response cannot be normalized. */
export const MOCK_MALFORMED_DESTINATION = 'MOCK-MALFORMED-RESPONSE';

/** Reserved destination sentinel: mock outcome is an unmapped unknown failure. */
export const MOCK_UNKNOWN_FAILURE_DESTINATION = 'MOCK-UNKNOWN-FAILURE';

/** Sample metadata attached to every mock transport result (display-only). */
export const MOCK_TRANSPORT_METADATA: ReadonlyArray<ProviderResultMetadata> = [
  { key: 'vehicle-class', value: 'sample high-speed rail' },
];

/** Sample metadata attached to every mock accommodation result (display-only). */
export const MOCK_ACCOMMODATION_METADATA: ReadonlyArray<ProviderResultMetadata> = [
  { key: 'property-type', value: 'sample hotel' },
];

/** Sample metadata attached to every mock alternative-transport result (display-only). */
export const MOCK_ALTERNATIVE_TRANSPORT_METADATA: ReadonlyArray<ProviderResultMetadata> = [
  { key: 'vehicle-class', value: 'sample alternative coach' },
];

/**
 * Maps a reserved destination sentinel to its honest safe error category, or
 * `null` when the destination is not a failure sentinel. The returned category
 * is the only trace of the sentinel that ever reaches a user-facing envelope —
 * the message itself never contains the reserved destination string.
 */
export function getMockDestinationFailureCategory(
  destination: string
): ProviderSafeErrorCategory | null {
  switch (destination) {
    case MOCK_TIMEOUT_DESTINATION:
      return 'timeout';
    case MOCK_RATE_LIMITED_DESTINATION:
      return 'rate-limited';
    case MOCK_MALFORMED_DESTINATION:
      return 'malformed-response';
    case MOCK_UNKNOWN_FAILURE_DESTINATION:
      return 'unknown';
    default:
      return null;
  }
}

/**
 * Builds the honest normalized failure envelope for a reserved failure
 * sentinel, or `null` when `destination` is not one. The message is generic and
 * never contains the reserved destination string; the category is the only
 * trace of the controlled outcome.
 */
export function buildMockSentinelFailure(
  source: { id: string; name: string },
  destination: string,
  now: string
): ProviderExecutionResult<never> | null {
  const category = getMockDestinationFailureCategory(destination);
  if (category === null) return null;
  let message: string;
  switch (category) {
    case 'timeout':
      message = 'The simulated provider search timed out before returning a response.';
      break;
    case 'rate-limited':
      message = 'The simulated provider is currently rate-limited.';
      break;
    case 'malformed-response':
      message = 'The simulated provider returned a response that could not be normalized.';
      break;
    default:
      message = 'The simulated provider search could not be completed for an unknown reason.';
      break;
  }
  return buildProviderExecutionFailure('search', source, category, message, now, 'not-retryable', {
    limitations: [MOCK_RESULT_DISCLAIMER],
  });
}

/** Clearly-fake origin for any `sourceUrl` attached to a mock result. */
export const MOCK_SOURCE_URL_PREFIX = 'https://mock.example/';

/**
 * Adds `minutes` to an ISO date-time string deterministically. Invalid input is
 * returned unchanged so callers never observe a throw or an invented value.
 */
export function addIsoMinutes(baseIso: string, minutes: number): string {
  const baseMs = Date.parse(baseIso);
  if (!Number.isFinite(baseMs)) return baseIso;
  return new Date(baseMs + minutes * 60_000).toISOString();
}

/** One deterministic mock transport option before normalization. */
export interface MockTransportFixture {
  label: string;
  routeSummary: string;
  origin: string;
  departureOffsetMinutes: number;
  durationMinutes: number;
  priceAmount: number;
  availability: TripProviderResultAvailability;
  cancellationPolicy: string;
  limitations: string[];
}

export const MOCK_TRANSPORT_FIXTURES: ReadonlyArray<MockTransportFixture> = [
  {
    label: 'Mock Express Rail',
    routeSummary: 'Direct high-speed rail option',
    origin: 'LHR',
    departureOffsetMinutes: 120,
    durationMinutes: 285,
    priceAmount: 149,
    availability: 'available',
    cancellationPolicy: 'Mock policy: fully refundable until 24 hours before departure.',
    limitations: ['Sample timetable — not a confirmed departure time.'],
  },
  {
    label: 'Mock Coastal Connect',
    routeSummary: 'One-stop coach connection',
    origin: 'LHR',
    departureOffsetMinutes: 300,
    durationMinutes: 410,
    priceAmount: 79,
    availability: 'limited',
    cancellationPolicy: 'Mock policy: refundable with a 10% booking fee.',
    limitations: ['Sample availability — may not reflect real seats.'],
  },
  {
    label: 'Mock Sky Link',
    routeSummary: 'Flight option via a sample carrier',
    origin: 'LHR',
    departureOffsetMinutes: 540,
    durationMinutes: 160,
    priceAmount: 320,
    availability: 'unknown',
    cancellationPolicy: 'Mock policy: non-refundable.',
    limitations: ['Sample flight — not a booking or issued ticket.'],
  },
];

/** One deterministic mock accommodation option before normalization. */
export interface MockAccommodationFixture {
  propertyLabel: string;
  staySummary: string;
  nightlyAmount: number;
  nights: number;
  availability: TripProviderResultAvailability;
  cancellationPolicy: string;
  limitations: string[];
}

export const MOCK_ACCOMMODATION_FIXTURES: ReadonlyArray<MockAccommodationFixture> = [
  {
    propertyLabel: 'Mock Harborview Suites',
    staySummary: 'Water-view studio with kitchenette',
    nightlyAmount: 140,
    nights: 3,
    availability: 'available',
    cancellationPolicy: 'Mock policy: free cancellation up to 48 hours before arrival.',
    limitations: ['Sample room type — not a reserved room.'],
  },
  {
    propertyLabel: 'Mock Old Town Guesthouse',
    staySummary: 'Private room, shared courtyard',
    nightlyAmount: 92,
    nights: 3,
    availability: 'available',
    cancellationPolicy: 'Mock policy: free cancellation up to 24 hours before arrival.',
    limitations: ['Sample nightly rate — not a confirmed price.'],
  },
  {
    propertyLabel: 'Mock Pine Cabin Retreat',
    staySummary: 'Whole cabin with breakfast',
    nightlyAmount: 210,
    nights: 3,
    availability: 'limited',
    cancellationPolicy: 'Mock policy: refundable minus one night.',
    limitations: ['Sample availability — not a live quote.'],
  },
];

/** Builds the normalized transport fixture results for `query` at `now`. */
export function buildMockTransportResults(
  query: TripDiscoveryQuery,
  now: string
): TripProviderResult[] {
  return MOCK_TRANSPORT_FIXTURES.map((fixture, index) => {
    const departureAt = addIsoMinutes(now, fixture.departureOffsetMinutes);
    return {
      providerId: MOCK_TRANSPORT_SOURCE_ID,
      providerName: MOCK_TRANSPORT_SOURCE_NAME,
      resultId: `mock-transport-${index + 1}`,
      category: 'transport',
      title: fixture.label,
      summary: fixture.routeSummary,
      origin: fixture.origin,
      destination: query.destination,
      departureAt,
      arrivalAt: addIsoMinutes(departureAt, fixture.durationMinutes),
      durationMinutes: fixture.durationMinutes,
      price: { amount: fixture.priceAmount, currency: query.currency ?? 'USD' },
      cancellationPolicy: fixture.cancellationPolicy,
      sourceUrl: `${MOCK_SOURCE_URL_PREFIX}transport/result-${index + 1}`,
      retrievedAt: now,
      expiresAt: addIsoMinutes(now, MOCK_RESULT_FRESHNESS_MINUTES),
      availability: fixture.availability,
      limitations: [MOCK_RESULT_DISCLAIMER, ...fixture.limitations],
      metadata: [...MOCK_TRANSPORT_METADATA],
    } satisfies TripProviderResult;
  });
}

/** Builds the normalized accommodation fixture results for `query` at `now`. */
export function buildMockAccommodationResults(
  query: TripDiscoveryQuery,
  now: string
): TripProviderResult[] {
  return MOCK_ACCOMMODATION_FIXTURES.map((fixture, index) => {
    const nights = fixture.nights;
    return {
      providerId: MOCK_ACCOMMODATION_SOURCE_ID,
      providerName: MOCK_ACCOMMODATION_SOURCE_NAME,
      resultId: `mock-accommodation-${index + 1}`,
      category: 'accommodation',
      title: fixture.propertyLabel,
      summary: `${fixture.staySummary} · ${nights} nights`,
      destination: query.destination,
      price: { amount: fixture.nightlyAmount * nights, currency: query.currency ?? 'USD' },
      cancellationPolicy: fixture.cancellationPolicy,
      sourceUrl: `${MOCK_SOURCE_URL_PREFIX}accommodation/result-${index + 1}`,
      retrievedAt: now,
      expiresAt: addIsoMinutes(now, MOCK_RESULT_FRESHNESS_MINUTES),
      availability: fixture.availability,
      limitations: [MOCK_RESULT_DISCLAIMER, ...fixture.limitations],
      metadata: [...MOCK_ACCOMMODATION_METADATA],
    } satisfies TripProviderResult;
  });
}

/**
 * The availability of a fixture option rendered for display only. The label is
 * explicitly framed as simulated availability, never a live seat/room count.
 */
export function getMockAvailabilityLabel(availability: TripProviderResultAvailability): string {
  switch (availability) {
    case 'available':
      return 'Simulated availability: available';
    case 'limited':
      return 'Simulated availability: limited';
    case 'unavailable':
      return 'Simulated availability: unavailable';
    case 'unknown':
      return 'Simulated availability: unknown';
  }
}

/** One deterministic mock alternative-transport option before normalization. */
export interface MockAlternativeTransportFixture {
  label: string;
  routeSummary: string;
  origin: string;
  departureOffsetMinutes: number;
  durationMinutes: number;
  priceAmount: number;
  availability: TripProviderResultAvailability;
  cancellationPolicy: string;
  limitations: string[];
}

export const MOCK_ALTERNATIVE_TRANSPORT_FIXTURES: ReadonlyArray<MockAlternativeTransportFixture> = [
  {
    label: 'Mock Express Coach',
    routeSummary: 'Direct express coach service',
    origin: 'LHR',
    departureOffsetMinutes: 165,
    durationMinutes: 300,
    priceAmount: 64,
    availability: 'available',
    cancellationPolicy: 'Mock policy: fully refundable until 12 hours before departure.',
    limitations: ['Sample timetable — not a confirmed departure time.'],
  },
  {
    label: 'Mock Night Sleeper',
    routeSummary: 'Overnight sleeper coach connection',
    origin: 'LHR',
    departureOffsetMinutes: 620,
    durationMinutes: 660,
    priceAmount: 118,
    availability: 'limited',
    cancellationPolicy: 'Mock policy: refundable with a 15% booking fee.',
    limitations: ['Sample availability — may not reflect real berths.'],
  },
  {
    label: 'Mock Regional Link',
    routeSummary: 'Regional express coach via a sample operator',
    origin: 'LHR',
    departureOffsetMinutes: 855,
    durationMinutes: 370,
    priceAmount: 51,
    availability: 'unknown',
    cancellationPolicy: 'Mock policy: non-refundable.',
    limitations: ['Sample fare — not a booking or issued ticket.'],
  },
];

/**
 * Builds the normalized mock alternative-transport fixture results for `query`
 * at `now`. Mirrors `buildMockTransportResults` exactly (same disclaimer, same
 * freshness stamp, same reserved `MOCK_EMPTY_RESULTS_DESTINATION` contraction),
 * but stamps every result with the distinct alternative source identity so the
 * two transport adapters never collapse into one provider during attribution.
 */
export function buildMockAlternativeTransportResults(
  query: TripDiscoveryQuery,
  now: string
): TripProviderResult[] {
  return MOCK_ALTERNATIVE_TRANSPORT_FIXTURES.map((fixture, index) => {
    const departureAt = addIsoMinutes(now, fixture.departureOffsetMinutes);
    return {
      providerId: MOCK_ALTERNATIVE_TRANSPORT_SOURCE_ID,
      providerName: MOCK_ALTERNATIVE_TRANSPORT_SOURCE_NAME,
      resultId: `mock-alternative-transport-${index + 1}`,
      category: 'transport',
      title: fixture.label,
      summary: fixture.routeSummary,
      origin: fixture.origin,
      destination: query.destination,
      departureAt,
      arrivalAt: addIsoMinutes(departureAt, fixture.durationMinutes),
      durationMinutes: fixture.durationMinutes,
      price: { amount: fixture.priceAmount, currency: query.currency ?? 'USD' },
      cancellationPolicy: fixture.cancellationPolicy,
      sourceUrl: `${MOCK_SOURCE_URL_PREFIX}alternative-transport/result-${index + 1}`,
      retrievedAt: now,
      expiresAt: addIsoMinutes(now, MOCK_RESULT_FRESHNESS_MINUTES),
      availability: fixture.availability,
      limitations: [MOCK_RESULT_DISCLAIMER, ...fixture.limitations],
      metadata: [...MOCK_ALTERNATIVE_TRANSPORT_METADATA],
    } satisfies TripProviderResult;
  });
}
