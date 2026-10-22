/**
 * STEP 59 - provider-neutral execution adapter contract.
 *
 * This module defines the contract every future execution provider adapter
 * must satisfy. It sits behind the STEP 58 dispatch boundary:
 *
 *   ... -> TripExecutionDispatchInstruction (STEP 58, service seam)
 *   -> TripExecutionProviderRequest / TripExecutionProvider (this module)
 *   -> [concrete execution adapters] (future milestones, NOT built)
 *
 * It is an interface/contract boundary only: it contains no concrete provider
 * implementation, no concrete adapter, no mock execution provider, no
 * selection logic, no coordination logic, no network transport, and no booking
 * or payment integration. It only defines the provider-neutral input, the
 * provider-neutral result, and the asynchronous adapter interface that future
 * adapters must satisfy.
 *
 * The request carries only the STEP 58 dispatch identity:
 *
 *   { id, kind: 'trip-execution-provider-request', dispatchId }
 *
 * Identity is deterministic: `trip-execution-provider-request:<dispatchId>`.
 * Same dispatch -> same request id; different dispatch -> different request
 * id. No clock, no entropy, no generated text.
 *
 * The result carries only an explicit provider identity, the request id, and a
 * deliberately small status vocabulary:
 *
 *   'accepted' | 'rejected' | 'unsupported' | 'failed'
 *
 * It never contains raw provider responses, HTTP bodies, credentials, tokens,
 * or payment information, and it never infers booking or payment success. The
 * vocabulary intentionally excludes future lifecycle states.
 *
 * providerId follows the existing provider-domain convention: non-empty,
 * already-trimmed, bounded by MAX_PROVIDER_ID_LENGTH.
 *
 * No React, Firebase, Router, Zustand, concrete provider, network, clock,
 * `any`, or generic `Record<string, any>` escape hatches. The only imports are
 * the STEP 58 dispatch contract and the shared provider identity bound.
 */

import { MAX_PROVIDER_ID_LENGTH } from '../../domain/providers/providerResults';
import {
  isTripExecutionDispatchInstruction,
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  type TripExecutionDispatchInstruction,
} from './tripExecutionDispatch';

/**
 * The deterministic, provider-neutral prefix for execution-provider-request
 * ids. Kept distinct from the dispatch id space so a provider-request id never
 * collides with the dispatch identity it references, or with any earlier
 * identity.
 */
export const TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX =
  'trip-execution-provider-request:' as const;

/** The single explicit kind carried by every execution-provider request. */
export const TRIP_EXECUTION_PROVIDER_REQUEST_KIND = 'trip-execution-provider-request' as const;

/**
 * The deliberately small, provider-neutral status vocabulary an execution
 * provider may report. Future lifecycle states are intentionally absent.
 */
export const TRIP_EXECUTION_PROVIDER_RESULT_STATUSES = [
  'accepted',
  'rejected',
  'unsupported',
  'failed',
] as const;

/** The provider-neutral result status vocabulary. */
export type TripExecutionProviderResultStatus =
  (typeof TRIP_EXECUTION_PROVIDER_RESULT_STATUSES)[number];

/**
 * The provider-neutral input an execution provider adapter receives. Carries
 * only identities: the deterministic provider-request id, the single request
 * kind, and the STEP 58 dispatch id. Nothing provider-specific is added: no
 * provider-specific field leaches into the contract.
 */
export interface TripExecutionProviderRequest {
  id: string;
  kind: typeof TRIP_EXECUTION_PROVIDER_REQUEST_KIND;
  /** The validated dispatch-instruction identity (STEP 58) this request answers to. */
  dispatchId: string;
}

/**
 * The provider-neutral outcome an execution provider adapter returns. Carries
 * only an explicit provider identity, the provider-request id it answers, and
 * one status from the small vocabulary above. It never contains raw provider
 * responses, HTTP response bodies, credentials, tokens, provider secrets, or
 * payment information, and it never implies booking or payment success.
 */
export interface TripExecutionProviderResult {
  providerId: string;
  requestId: string;
  status: TripExecutionProviderResultStatus;
}

/**
 * The asynchronous, provider-neutral adapter interface every future execution
 * provider must satisfy. `providerId` is the explicit provider identity (per
 * the shared provider-domain bound); `execute` returns a Promise of the
 * provider-neutral result. The contract makes no assumption about the HTTP or
 * network implementation and carries no concrete provider dependency. No
 * adapter implements this interface yet.
 */
export interface TripExecutionProvider {
  readonly providerId: string;

  execute(
    request: TripExecutionProviderRequest
  ): Promise<TripExecutionProviderResult>;
}

/**
 * The deterministic execution-provider-request id for a dispatch id:
 * `trip-execution-provider-request:<dispatchId>`. Same dispatch -> same
 * request id; different dispatch -> different request id. No timestamps, no
 * randomness, no entropy, no generated text.
 */
export function getTripExecutionProviderRequestId(dispatchId: string): string {
  return `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatchId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDispatchId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_DISPATCH_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_DISPATCH_ID_PREFIX.length
  );
}

function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

function isProviderId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim()) return false;
  if (value.length === 0) return false;
  if (value.length > MAX_PROVIDER_ID_LENGTH) return false;
  return true;
}

/** True when `value` is a member of the provider-neutral status vocabulary. */
export function isTripExecutionProviderResultStatus(
  value: unknown
): value is TripExecutionProviderResultStatus {
  return TRIP_EXECUTION_PROVIDER_RESULT_STATUSES.includes(value as TripExecutionProviderResultStatus);
}

/**
 * True when `value` is a structurally valid provider-neutral request: exact
 * request kind, a well-formed dispatch id, and a deterministic id that still
 * derives exactly from that dispatch id. The request stays provider-neutral —
 * no provider-specific payload is allowed to leak into the contract. Pure
 * structural validation; it never calls a provider, queries a database, or
 * inspects external state.
 */
export function isTripExecutionProviderRequest(
  value: unknown
): value is TripExecutionProviderRequest {
  if (!isRecord(value)) return false;
  if (value.kind !== TRIP_EXECUTION_PROVIDER_REQUEST_KIND) return false;

  const dispatchId = value.dispatchId;
  if (!isDispatchId(dispatchId)) return false;

  return getTripExecutionProviderRequestId(dispatchId) === value.id;
}

/**
 * True when `value` is a structurally valid, internally consistent
 * provider-neutral result: a well-formed provider id, a well-formed
 * provider-request id, and an exact member of the status vocabulary. It never
 * calls a provider, queries a database, inspects external state, infers
 * booking success, infers payment success, or inspects HTTP responses.
 */
export function isTripExecutionProviderResult(
  value: unknown
): value is TripExecutionProviderResult {
  if (!isRecord(value)) return false;

  const providerId = value.providerId;
  if (!isProviderId(providerId)) return false;

  const requestId = value.requestId;
  if (!isProviderRequestId(requestId)) return false;

  return isTripExecutionProviderResultStatus(value.status);
}

/**
 * The pure mapping from the STEP 58 dispatch instruction to the
 * provider-neutral execution request: validates the dispatch, derives the
 * request deterministically from `dispatch.id` (`request.dispatchId ===
 * dispatch.id`), and returns a fresh identifiers-only value, or `null` for
 * invalid input. It never calls a provider, performs no network requests, and
 * performs no persistence.
 */
export function createTripExecutionProviderRequest(
  dispatch: TripExecutionDispatchInstruction
): TripExecutionProviderRequest | null {
  if (!isTripExecutionDispatchInstruction(dispatch)) return null;

  return {
    id: getTripExecutionProviderRequestId(dispatch.id),
    kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
    dispatchId: dispatch.id,
  };
}