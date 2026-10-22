/**
 * Pure, provider-independent discovery input contract (STEP 21).
 *
 * A read-only discovery search starts from this single, provider-independent
 * query shape. There is deliberately no provider-specific field anywhere: no
 * provider ids, opaque tokens, currency objects from a provider, or raw API
 * vocabulary. The only strings that enter a discovery query are free-form
 * location labels the user typed. Deliberately side-effect free and
 * dependency-free: no React, Firebase, Router, Zustand, network, clock, `any`,
 * or generic `Record<string, any>` escape hatches.
 *
 * Contract rules:
 *
 * 1. `category` ('transport' | 'accommodation') and `destination` are required;
 *    everything else is optional. Unknown keys reject the query — nothing is
 *    guessed and no provider feature can smuggle its own parameters through.
 * 2. Every string is trimmed and bounded. ISO dates must be real calendar dates
 *    and `endDate` must not precede `startDate`. `travelerCount` is a positive
 *    whole number within a documented bound. `currency` is an ISO-4217-style
 *    letters-only code, normalized to uppercase. `limit` is a positive whole
 *    number of at most `MAX_DISCOVERY_RESULT_LIMIT`.
 * 3. No sensitive data: there is no owner id, no trip id, no document id, no
 *    credential, and no payment field here, so a search can never carry private
 *    trip or user state.
 *
 * This contract feeds only read-only discovery. Nothing here books, pays,
 * verifies, or persists, and no result of a search is ever stored.
 */

/** The recognized discovery categories (unknown values are rejected). */
export type DiscoveryCategory = 'transport' | 'accommodation';

export const DISCOVERY_CATEGORIES: ReadonlyArray<DiscoveryCategory> = [
  'transport',
  'accommodation',
];

/** Upper bounds enforced at the normalization boundary (never silently truncated). */
export const MAX_DISCOVERY_DESTINATION_LENGTH = 120;
export const MAX_DISCOVERY_ORIGIN_LENGTH = 120;
export const MAX_DISCOVERY_CURRENCY_LENGTH = 8;
/** Traveler counts must be positive and at most this documented bound. */
export const MAX_DISCOVERY_TRAVELER_COUNT = 50;
/** A requested result limit must be a positive whole number of at most this size. */
export const MAX_DISCOVERY_RESULT_LIMIT = 25;

/**
 * The minimal normalized input a read-only discovery search accepts. Optional
 * fields are present only when the caller supplied a valid value.
 */
export interface TripDiscoveryQuery {
  /** What kind of option to discover. */
  category: DiscoveryCategory;
  /** Free-form destination label (required, bounded). */
  destination: string;
  /** Optional origin label (e.g. a departure airport). */
  origin?: string;
  /** Optional ISO calendar date (YYYY-MM-DD) the search window starts. */
  startDate?: string;
  /** Optional ISO calendar date (YYYY-MM-DD) the search window ends. */
  endDate?: string;
  /** Optional positive whole number of travelers. */
  travelerCount?: number;
  /** Optional letters-only currency code, normalized to uppercase. */
  currency?: string;
  /** Optional upper bound on how many results to return (1..MAX_DISCOVERY_RESULT_LIMIT). */
  limit?: number;
}

/** The recognized validation problems a discovery query can report. */
export type TripDiscoveryQueryProblemCode =
  | 'not-an-object'
  | 'unknown-key'
  | 'missing-category'
  | 'invalid-category'
  | 'missing-destination'
  | 'destination-too-long'
  | 'origin-invalid'
  | 'origin-too-long'
  | 'invalid-start-date'
  | 'invalid-end-date'
  | 'end-without-start'
  | 'end-before-start'
  | 'invalid-traveler-count'
  | 'traveler-count-out-of-range'
  | 'invalid-currency'
  | 'invalid-limit'
  | 'limit-out-of-range';

/** A bounded, user-facing description of one validation problem. */
export interface TripDiscoveryQueryProblem {
  code: TripDiscoveryQueryProblemCode;
  message: string;
  /** Present only for `unknown-key`: the offending key. */
  key?: string;
}

export function isDiscoveryCategory(value: unknown): value is DiscoveryCategory {
  return (
    typeof value === 'string' && (DISCOVERY_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

/** True when `value` is a well-formed discovery query (unknown keys rejected). */
export function isTripDiscoveryQuery(value: unknown): value is TripDiscoveryQuery {
  return normalizeTripDiscoveryQuery(value) !== null;
}

/**
 * The first validation problem for `value`, or `null` when the value is a
 * well-formed discovery query. The checks run in a canonical order so the
 * reported problem is deterministic.
 */
export function getTripDiscoveryQueryProblem(value: unknown): TripDiscoveryQueryProblem | null {
  return analyzeDiscoveryQuery(value).problem;
}

/**
 * Normalizes an untrusted discovery query into the minimal `TripDiscoveryQuery`
 * shape, or returns `null` when the shape cannot be repaired. Unknown keys
 * reject the whole record; optional strings are trimmed and dropped when empty;
 * `currency` is uppercased. Never throws.
 */
export function normalizeTripDiscoveryQuery(value: unknown): TripDiscoveryQuery | null {
  return analyzeDiscoveryQuery(value).query;
}

interface DiscoveryQueryAnalysis {
  query: TripDiscoveryQuery | null;
  problem: TripDiscoveryQueryProblem | null;
}

function analyzeDiscoveryQuery(value: unknown): DiscoveryQueryAnalysis {
  if (!isRecord(value)) {
    return {
      query: null,
      problem: {
        code: 'not-an-object',
        message: 'A discovery search must be an object.',
      },
    };
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_DISCOVERY_QUERY_KEYS.includes(key)) {
      return {
        query: null,
        problem: {
          code: 'unknown-key',
          key,
          message: `Discovery queries do not accept the field "${key}".`,
        },
      };
    }
  }

  const { category, destination, origin, startDate, endDate, travelerCount, currency, limit } =
    value;

  if (category === undefined || category === null) {
    return {
      query: null,
      problem: {
        code: 'missing-category',
        message: 'A discovery search needs a category.',
      },
    };
  }
  if (!isDiscoveryCategory(category)) {
    return {
      query: null,
      problem: {
        code: 'invalid-category',
        message: 'The discovery category must be "transport" or "accommodation".',
      },
    };
  }

  if (
    destination === undefined ||
    destination === null ||
    typeof destination !== 'string' ||
    destination.trim().length === 0
  ) {
    return {
      query: null,
      problem: {
        code: 'missing-destination',
        message: 'A discovery search needs a destination.',
      },
    };
  }
  const requiredDestination = destination.trim();
  if (requiredDestination.length > MAX_DISCOVERY_DESTINATION_LENGTH) {
    return {
      query: null,
      problem: {
        code: 'destination-too-long',
        message: `The destination must be ${MAX_DISCOVERY_DESTINATION_LENGTH} characters or fewer.`,
      },
    };
  }

  let optionalOrigin: string | undefined;
  if (origin !== undefined && origin !== null) {
    if (typeof origin !== 'string') {
      return {
        query: null,
        problem: {
          code: 'origin-invalid',
          message: 'The origin must be text.',
        },
      };
    }
    const trimmed = origin.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > MAX_DISCOVERY_ORIGIN_LENGTH) {
        return {
          query: null,
          problem: {
            code: 'origin-too-long',
            message: `The origin must be ${MAX_DISCOVERY_ORIGIN_LENGTH} characters or fewer.`,
          },
        };
      }
      optionalOrigin = trimmed;
    }
  }

  const startValue = optionalIsoDate(startDate);
  if (startValue === 'INVALID') {
    return {
      query: null,
      problem: {
        code: 'invalid-start-date',
        message: 'The start date must be a real ISO calendar date (YYYY-MM-DD).',
      },
    };
  }

  const endValue = optionalIsoDate(endDate);
  if (endValue === 'INVALID') {
    return {
      query: null,
      problem: {
        code: 'invalid-end-date',
        message: 'The end date must be a real ISO calendar date (YYYY-MM-DD).',
      },
    };
  }

  if (endValue !== undefined && startValue === undefined) {
    return {
      query: null,
      problem: {
        code: 'end-without-start',
        message: 'An end date is only valid together with a start date.',
      },
    };
  }
  if (startValue !== undefined && endValue !== undefined && endValue < startValue) {
    return {
      query: null,
      problem: {
        code: 'end-before-start',
        message: 'The end date must not be before the start date.',
      },
    };
  }

  let normalizedTravelerCount: number | undefined;
  if (travelerCount !== undefined && travelerCount !== null) {
    if (typeof travelerCount !== 'number' || !Number.isInteger(travelerCount)) {
      return {
        query: null,
        problem: {
          code: 'invalid-traveler-count',
          message: 'The traveler count must be a whole number.',
        },
      };
    }
    if (travelerCount <= 0 || travelerCount > MAX_DISCOVERY_TRAVELER_COUNT) {
      return {
        query: null,
        problem: {
          code: 'traveler-count-out-of-range',
          message: `The traveler count must be between 1 and ${MAX_DISCOVERY_TRAVELER_COUNT}.`,
        },
      };
    }
    normalizedTravelerCount = travelerCount;
  }

  let normalizedCurrency: string | undefined;
  if (currency !== undefined && currency !== null) {
    if (typeof currency !== 'string' || !/^[A-Za-z]{1,8}$/.test(currency.trim())) {
      return {
        query: null,
        problem: {
          code: 'invalid-currency',
          message: 'The currency must be a letters-only code of up to 8 characters.',
        },
      };
    }
    normalizedCurrency = currency.trim().toUpperCase();
  }

  let normalizedLimit: number | undefined;
  if (limit !== undefined && limit !== null) {
    if (typeof limit !== 'number' || !Number.isInteger(limit)) {
      return {
        query: null,
        problem: {
          code: 'invalid-limit',
          message: 'The result limit must be a whole number.',
        },
      };
    }
    if (limit <= 0 || limit > MAX_DISCOVERY_RESULT_LIMIT) {
      return {
        query: null,
        problem: {
          code: 'limit-out-of-range',
          message: `The result limit must be between 1 and ${MAX_DISCOVERY_RESULT_LIMIT}.`,
        },
      };
    }
    normalizedLimit = limit;
  }

  const query: TripDiscoveryQuery = {
    category,
    destination: requiredDestination,
  };
  if (optionalOrigin !== undefined) query.origin = optionalOrigin;
  if (startValue !== undefined) query.startDate = startValue;
  if (endValue !== undefined) query.endDate = endValue;
  if (normalizedTravelerCount !== undefined) query.travelerCount = normalizedTravelerCount;
  if (normalizedCurrency !== undefined) query.currency = normalizedCurrency;
  if (normalizedLimit !== undefined) query.limit = normalizedLimit;
  return { query, problem: null };
}

const ALLOWED_DISCOVERY_QUERY_KEYS: ReadonlyArray<string> = [
  'category',
  'destination',
  'origin',
  'startDate',
  'endDate',
  'travelerCount',
  'currency',
  'limit',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns `undefined` (absent/empty), the normalized date, or `'INVALID'`. */
function optionalIsoDate(value: unknown): string | 'INVALID' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return 'INVALID';
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'INVALID';
  const time = Date.parse(`${trimmed}T00:00:00Z`);
  if (!Number.isFinite(time)) return 'INVALID';
  if (new Date(time).toISOString().slice(0, 10) !== trimmed) return 'INVALID';
  return trimmed;
}
