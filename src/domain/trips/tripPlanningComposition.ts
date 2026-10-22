/**
 * STEP 49 - route-aware planning composition (provider-neutral planning context).
 *
 * This module defines the smallest provider-neutral value that explicitly
 * connects an origin **place** planning reference, a destination **place**
 * planning reference, and an optional transport/route planning reference, without
 * mutating the trip or the itinerary. It exists so an explicit user/planner
 * selection can be reasoned about as one immutable planning-context value while
 * the existing explicit trip-planning lifecycle continues to decide whether
 * anything is saved.
 *
 * Rules:
 *
 * 1. **Planning context only.** A composition is never an itinerary item, never a
 *    new data model, and never a route. The route itself is already represented by
 *    `TripTransportReference`; this module only *composes* already-validated
 *    references. A composition never activates references, never assigns a primary,
 *    never creates trips, never modifies itinerary days, transport planning,
 *    budgets, or persistence, and never triggers a provider call.
 * 2. **Deterministic, immutable identity.** The id is derived only from the three
 *    reference ids as
 *    `trip-composition:<originReferenceId>:<destinationReferenceId>:<transportReferenceId-or-`none`>`.
 *    No timestamps, no randomness, no UUIDs, no browser state — same references
 *    always compose to the same id, and any change to a member changes the id.
 *    Mutable labels, descriptions, prices, or generated prose are never part of
 *    the identity.
 * 3. **Provider neutrality.** Nothing provider-specific — Google Places, Google
 *    Routes, place ids, API keys, HTTP response data — lives in this contract.
 *    Provider provenance stays inside the underlying planning references, which
 *    keeps the composition equally valid for any future provider. The origin and
 *    destination hold place references; the optional transport holds a
 *    routing/transport reference.
 * 4. **Explicit correspondence, never fabricated.** When the transport carries
 *    route endpoints AND both places carry coordinates, an exact coordinate match
 *    is claimed (`exact-coordinate-match`) or the composition is rejected
 *    (`mismatched-coordinates`) — there is no fuzzy geographic matching. When any
 *    of the required data is absent, the composition is preserved and marked
 *    `unverified` instead of guessing. Place coordinates are never invented.
 * 5. **No duplication.** The composition carries stable reference ids plus the
 *    minimum immutable metadata the architecture needs (optional place locations,
 *    optional transport mode and route endpoints). It never duplicates the full
 *    place or transport objects, and it never mutates its inputs.
 *
 * No React, Firebase, Router, Zustand, network, clock, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import { isTripPlanningReference } from './tripPlanning';
import type {
  TripPlanningReference,
  TripReferenceLocation,
} from '../../types/trip';

/**
 * The deterministic, provider-neutral prefix for composition ids. Kept distinct
 * from the `google-places:` / `google-routes:` reference-id prefixes because a
 * composition is a derived planning-context value, not a provider reference.
 */
export const TRIP_PLANNING_COMPOSITION_ID_PREFIX = 'trip-composition:';

/**
 * Whether the optional transport leg's endpoints correspond to the composed
 * place references. Only ever claims an exact, verified coordinate match; an
 * `unverified` value means the available data is insufficient to prove a match —
 * it never means "close enough" and never fabricates one.
 */
export type TripPlanningCompositionTransportCorrespondence =
  | 'exact-coordinate-match'
  | 'unverified';

/** The single immutable planning-context role each member plays. */
export interface TripPlanningCompositionPlace {
  referenceId: string;
  /** The place's own bounded coordinates, present only when the reference has them. */
  location?: TripReferenceLocation;
}

/** Minimum immutable transport metadata carried for planning context. */
export interface TripPlanningCompositionTransport {
  referenceId: string;
  /** Neutral transport mode, verbatim from the validated transport reference. */
  mode?: string;
  /** Route endpoint coordinates, present only when the transport reference has them. */
  routeOrigin?: TripReferenceLocation;
  routeDestination?: TripReferenceLocation;
}

/**
 * An immutable provider-neutral planning context: one origin place reference, one
 * destination place reference, and an optional transport/route reference. It is a
 * value, not an itinerary item — it participates in no lifecycle and is never
 * persisted by this module.
 */
export interface TripPlanningComposition {
  id: string;
  kind: 'trip-planning-composition';
  origin: TripPlanningCompositionPlace;
  destination: TripPlanningCompositionPlace;
  /** Present only when an explicit transport reference was composed. */
  transport?: TripPlanningCompositionTransport;
  /** Present only when `transport` is present; never claims a match it cannot prove. */
  transportCorrespondence?: TripPlanningCompositionTransportCorrespondence;
}

/** Raw inputs accepted by the composition factory (validated before use). */
export interface TripPlanningCompositionInput {
  origin: unknown;
  destination: unknown;
  transport?: unknown;
}

/** Resolved correspondence for an optional transport leg. */
type CorrespondenceResult =
  | 'exact-coordinate-match'
  | 'unverified'
  | 'mismatched-coordinates';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a reference carries route endpoints (a routing transport reference). */
function isRoutingTransportReference(value: TripPlanningReference): boolean {
  return (
    value.kind === 'transport' &&
    (value.routeOrigin !== undefined || value.routeDestination !== undefined)
  );
}

/** Exact coordinate equality — never fuzzy, never rounded, never approximated. */
function sameLocation(a: TripReferenceLocation, b: TripReferenceLocation): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

/**
 * The deterministic composition id for three reference ids. The transport segment
 * is the literal string `none` when no transport reference composes the leg, so
 * adding or removing the transport always changes the id.
 */
export function getTripPlanningCompositionId(input: {
  originReferenceId: string;
  destinationReferenceId: string;
  transportReferenceId?: string;
}): string {
  const transportSegment = input.transportReferenceId ?? 'none';
  return `${TRIP_PLANNING_COMPOSITION_ID_PREFIX}${input.originReferenceId}:${input.destinationReferenceId}:${transportSegment}`;
}

/**
 * Resolves whether the optional transport's route endpoints match the composed
 * place references. Exactness requires all four coordinate pairs; a mismatch is
 * reported so the factory can reject it, while missing data reports `unverified`
 * so a composition is never rejected for data the references do not have.
 */
function resolveTransportCorrespondence(
  origin: TripPlanningReference,
  destination: TripPlanningReference,
  transport: TripPlanningCompositionTransport
): CorrespondenceResult {
  const originLocation = origin.location;
  const destinationLocation = destination.location;
  const routeOrigin = transport.routeOrigin;
  const routeDestination = transport.routeDestination;
  if (originLocation === undefined || destinationLocation === undefined) {
    return 'unverified';
  }
  if (routeOrigin === undefined || routeDestination === undefined) {
    return 'unverified';
  }
  if (sameLocation(routeOrigin, originLocation) && sameLocation(routeDestination, destinationLocation)) {
    return 'exact-coordinate-match';
  }
  return 'mismatched-coordinates';
}

/**
 * Creates an immutable planning-context composition from already-validated
 * references, or returns `null` when the members cannot be a safe composition.
 *
 * Rejects: missing/malformed origin or destination references, an origin or
 * destination that is itself a routing transport reference, identical origin and
 * destination reference ids (a place-to-itself leg), a malformed or
 * non-transport `transport`, a transport that is also the origin/destination
 * reference, and — when all needed coordinates exist — a transport whose route
 * endpoints do not exactly correspond to the composed place locations. Never
 * throws, never mutates its inputs, never persists, never guesses coordinates.
 */
export function createTripPlanningComposition(
  input: TripPlanningCompositionInput
): TripPlanningComposition | null {
  if (
    !isRecord(input.origin) ||
    !isRecord(input.destination) ||
    !isTripPlanningReference(input.origin) ||
    !isTripPlanningReference(input.destination)
  ) {
    return null;
  }
  const origin = input.origin;
  const destination = input.destination;

  if (origin.id === destination.id) return null;
  if (isRoutingTransportReference(origin) || isRoutingTransportReference(destination)) {
    return null;
  }

  let transport: TripPlanningCompositionTransport | undefined;
  let correspondence: CorrespondenceResult | undefined;

  if (input.transport !== undefined) {
    if (!isTripPlanningReference(input.transport)) return null;
    if (input.transport.kind !== 'transport') return null;
    const transportReference = input.transport;

    if (
      transportReference.id === origin.id ||
      transportReference.id === destination.id
    ) {
      return null;
    }

    transport = {
      referenceId: transportReference.id,
    };
    if (transportReference.mode !== undefined) {
      transport.mode = transportReference.mode;
    }
    if (transportReference.routeOrigin !== undefined) {
      transport.routeOrigin = { ...transportReference.routeOrigin };
    }
    if (transportReference.routeDestination !== undefined) {
      transport.routeDestination = { ...transportReference.routeDestination };
    }

    correspondence = resolveTransportCorrespondence(origin, destination, transport);
    if (correspondence === 'mismatched-coordinates') return null;
  }

  const composition: TripPlanningComposition = {
    id: getTripPlanningCompositionId({
      originReferenceId: origin.id,
      destinationReferenceId: destination.id,
      transportReferenceId: transport?.referenceId,
    }),
    kind: 'trip-planning-composition',
    origin: { referenceId: origin.id },
    destination: { referenceId: destination.id },
  };

  if (origin.location !== undefined) {
    composition.origin.location = { ...origin.location };
  }
  if (destination.location !== undefined) {
    composition.destination.location = { ...destination.location };
  }

  if (transport !== undefined) {
    composition.transport = transport;
    if (correspondence === 'exact-coordinate-match' || correspondence === 'unverified') {
      composition.transportCorrespondence = correspondence;
    }
  }

  return composition;
}

function isCompositionLocation(value: unknown): value is TripReferenceLocation {
  return (
    isRecord(value) &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude)
  );
}

function isCompositionPlace(value: unknown): value is TripPlanningCompositionPlace {
  if (!isRecord(value)) return false;
  if (typeof value.referenceId !== 'string' || value.referenceId.length === 0) return false;
  if (value.location !== undefined && !isCompositionLocation(value.location)) return false;
  return true;
}

function isCompositionTransport(value: unknown): value is TripPlanningCompositionTransport {
  if (!isRecord(value)) return false;
  if (typeof value.referenceId !== 'string' || value.referenceId.length === 0) return false;
  if (value.mode !== undefined && typeof value.mode !== 'string') return false;
  if (value.routeOrigin !== undefined && !isCompositionLocation(value.routeOrigin)) return false;
  if (value.routeDestination !== undefined && !isCompositionLocation(value.routeDestination)) return false;
  return true;
}

/**
 * Validates an already-built `TripPlanningComposition` structurally and for
 * internal consistency (STEP 50). Checks the discriminated `kind`, the member
 * place/transport shapes, the no-self-leg and no-transport-collision rules, the
 * correspondence rule (never present without transport, never an unknown value),
 * and — crucially — that the carried `id` re-derives deterministically from the
 * carried member ids. A tampered, inconsistent, or fabricated composition fails.
 * This is the single validator downstream layers (e.g. the composition-proposal
 * factory) reuse instead of re-encoding the rules.
 */
export function isTripPlanningComposition(value: unknown): value is TripPlanningComposition {
  if (!isRecord(value)) return false;
  if (value.kind !== 'trip-planning-composition') return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isCompositionPlace(value.origin) || !isCompositionPlace(value.destination)) return false;
  const origin = value.origin;
  const destination = value.destination;
  if (origin.referenceId === destination.referenceId) return false;

  let transport: TripPlanningCompositionTransport | undefined;
  if (value.transport !== undefined) {
    if (!isCompositionTransport(value.transport)) return false;
    transport = value.transport;
    if (
      transport.referenceId === origin.referenceId ||
      transport.referenceId === destination.referenceId
    ) {
      return false;
    }
  }
  if (value.transportCorrespondence !== undefined) {
    if (transport === undefined) return false;
    if (
      value.transportCorrespondence !== 'exact-coordinate-match' &&
      value.transportCorrespondence !== 'unverified'
    ) {
      return false;
    }
  }

  const expectedId = getTripPlanningCompositionId({
    originReferenceId: origin.referenceId,
    destinationReferenceId: destination.referenceId,
    transportReferenceId: transport?.referenceId,
  });
  return value.id === expectedId;
}