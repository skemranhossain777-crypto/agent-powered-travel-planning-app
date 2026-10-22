/**
 * Amadeus EXECUTION adapter (STEP 66).
 *
 * The first real-provider implementation of the STEP 59
 * `TripExecutionProvider` contract, and the boundary that finally joins the
 * execution pipeline (STEPS 61-65) to a real provider identity. It follows the
 * capability-gated adapter philosophy already established by the STEP 41 Amadeus
 * *discovery* adapter (`services/realDiscovery/amadeusAdapter.ts`), applied to
 * the execution domain.
 *
 * Its single most important property: **`accepted` is unreachable.** This module
 * contains no code path that returns it. There is no implemented operation, so
 * the honest answer to every request is `rejected`, `unsupported`, or `failed` -
 * and a real provider that cannot act never pretends otherwise.
 *
 * The decision order is fixed, and every branch is a bounded, value-free reason:
 *
 *   1. malformed provider request        -> `rejected`
 *   2. execution switch off (default)    -> `unsupported`   (never called in a browser build)
 *   3. no usable credentials             -> `unsupported`
 *   4. request is unmappable             -> `rejected`
 *   5. connection reports a defect       -> `failed`
 *   6. connection declines the request   -> `unsupported`   (never `accepted`)
 *
 * Two subtleties are worth stating explicitly, because both are easy to
 * misread later:
 *
 * - `supports(request)` answers "may this provider be *consulted* about this
 *   request?", not "can this provider execute it?". A structurally valid request
 *   is supported, so the pipeline really calls this adapter and surfaces a
 *   truthful `unsupported` provider result. A malformed request is unsupported,
 *   mirroring the STEP 62 contract. Returning `false` for valid requests would
 *   hide the provider from the plan and the user would learn nothing.
 * - The declared STEP 20 capabilities are therefore never `available`. Being
 *   configured is not the same as being able to act: a not-ready gate reports
 *   `unavailable-missing-credentials`, and even a fully configured build reports
 *   `unsupported`, because nothing is implemented. Nothing books, pays, reserves,
 *   cancels, modifies, or retrieves on behalf of a user, and no booking,
 *   payment, traveler, reservation, or confirmation data is ever created, echoed,
 *   or inferred.
 *
 * Side-effect free: no network, clock, SDK, `any`, generic `Record<string, any>`,
 * React, Firebase, Router, Zustand, or persistence. It never throws, never
 * mutates its request, and never logs a credential.
 */

import {
  PROVIDER_CAPABILITY_IDS,
  type ProviderCapabilityDeclaration,
} from '../../domain/providers/providerCapabilities';
import type { ProviderAdapterProfile } from '../../domain/providers/providerAdapter';
import type { TripExecutionCapabilityProvider } from '../tripExecution/tripExecutionCapability';
import {
  isTripExecutionProviderRequest,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
  type TripExecutionProviderResultStatus,
} from '../tripExecution/tripExecutionProvider';
import {
  AMADEUS_EXECUTION_PROVIDER_ID,
  AMADEUS_EXECUTION_PROVIDER_NAME,
  getAmadeusExecutionAttemptGate,
  getAmadeusExecutionCapabilityStatus,
  type AmadeusExecutionAttemptGate,
  type AmadeusExecutionConfig,
} from './amadeusExecutionConfig';
import {
  createAmadeusExecutionConnection,
  type AmadeusExecutionConnection,
} from './amadeusExecutionConnection';
import {
  auditAmadeusExecutionInput,
  mapAmadeusExecutionRequest,
  type AmadeusExecutionInputAudit,
} from './amadeusExecutionMapping';

/** Fixed, deterministic request id used when a rejected input exposes no usable id. */
const UNSAFE_INPUT_REQUEST_ID = `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}unspecified`;

/**
 * The bounded, value-free reasons this adapter can decline a request. Each one
 * is a closed state of the boundary, never a provider message and never a
 * credential, a traveler detail, a payment detail, or a raw response.
 */
export type AmadeusExecutionReadinessReason =
  | 'malformed-request'
  | 'execution-disabled'
  | 'credentials-missing'
  | 'unmappable-request'
  | 'insufficient-execution-information'
  | 'connection-internal-failure'
  | 'operation-not-implemented';

/** The bounded outcome of the readiness decision, before it becomes a result. */
export interface AmadeusExecutionReadiness {
  readonly status: TripExecutionProviderResultStatus;
  readonly reason: AmadeusExecutionReadinessReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX) &&
    value.length > TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX.length
  );
}

/** The safe request id to echo on a `rejected` result: only a real, well-formed id. */
function getSafeRequestId(request: unknown): string {
  if (isRecord(request) && isProviderRequestId(request.id)) return request.id;
  return UNSAFE_INPUT_REQUEST_ID;
}

function gateReason(gate: AmadeusExecutionAttemptGate): AmadeusExecutionReadiness {
  return gate === 'disabled'
    ? { status: 'unsupported', reason: 'execution-disabled' }
    : { status: 'unsupported', reason: 'credentials-missing' };
}

/**
 * The pure readiness decision for a request against a config and a connection.
 *
 * Pure with respect to the request and the config: it never calls a provider, is
 * never affected by a clock, and never mutates its inputs. The only stateful
 * collaborator is the injected connection, and a defect there is reported as
 * `failed` rather than being allowed to throw out of the adapter. `accepted` is
 * not a possible return value.
 */
export function getAmadeusExecutionReadiness(
  config: AmadeusExecutionConfig,
  request: TripExecutionProviderRequest | unknown,
  connection: AmadeusExecutionConnection = createAmadeusExecutionConnection()
): AmadeusExecutionReadiness {
  if (!isTripExecutionProviderRequest(request)) {
    return { status: 'rejected', reason: 'malformed-request' };
  }

  const gate = getAmadeusExecutionAttemptGate(config);
  if (gate !== 'ready') return gateReason(gate);

  const mapped = mapAmadeusExecutionRequest(request);
  if (mapped === null) return { status: 'rejected', reason: 'unmappable-request' };

  // The connection is the authority on whether it may proceed, and it is asked
  // before anything is inferred. A defect there is reported as a defect rather
  // than swallowed; an unexpected throw is contained so the adapter can never
  // reject-throw out of the pipeline.
  let outcome: 'not-implemented' | 'internal-failure';
  try {
    outcome = connection.attempt({ requestId: mapped.requestId, dispatchId: mapped.dispatchId });
  } catch {
    return { status: 'failed', reason: 'connection-internal-failure' };
  }

  if (outcome === 'internal-failure') {
    return { status: 'failed', reason: 'connection-internal-failure' };
  }

  // The connection declined. The audit names *why* the boundary is still closed:
  // an identity-only request carries no operation, traveler identity, or payment
  // authorization, and none of them is ever defaulted or fabricated to make the
  // request look complete.
  const audit: AmadeusExecutionInputAudit = auditAmadeusExecutionInput(mapped);
  return {
    status: 'unsupported',
    reason: audit.sufficient ? 'operation-not-implemented' : 'insufficient-execution-information',
  };
}

/**
 * The declared STEP 20 capabilities of this adapter. Every capability is
 * declared explicitly - including the read-only ones - so a consumer reading the
 * profile can see that they are *not* implemented rather than merely absent. No
 * capability is ever `available`, and a note records the bounded reason.
 */
export function getAmadeusExecutionCapabilityDeclarations(
  config: AmadeusExecutionConfig
): ReadonlyArray<ProviderCapabilityDeclaration> {
  const status = getAmadeusExecutionCapabilityStatus(config);
  return Object.freeze(
    PROVIDER_CAPABILITY_IDS.map((capability) =>
      Object.freeze({
        capability,
        status,
        note: 'Not implemented. No Amadeus execution operation runs in this build.',
      })
    )
  );
}

/**
 * The application-facing profile for this adapter. Read-only and free of any
 * secret, so it is safe to log or present; because no declaration is `available`,
 * nothing advertises this provider as able to search, verify, retrieve, or act.
 */
export function getAmadeusExecutionCapabilityProfile(
  config: AmadeusExecutionConfig
): ProviderAdapterProfile {
  return {
    id: AMADEUS_EXECUTION_PROVIDER_ID,
    name: AMADEUS_EXECUTION_PROVIDER_NAME,
    capabilities: [...getAmadeusExecutionCapabilityDeclarations(config)],
  };
}

/**
 * Composes the Amadeus execution provider.
 *
 * Satisfies both the STEP 59 `TripExecutionProvider` contract and the STEP 62
 * `TripExecutionCapabilityProvider` contract. The connection is injectable so a
 * server - or a test - can supply a different seam; the default one holds no
 * transport and is structurally incapable of reaching the network. Nothing is
 * attempted, and no credential is used, at construction time.
 */
export function createAmadeusExecutionProvider(
  config: AmadeusExecutionConfig,
  connection: AmadeusExecutionConnection = createAmadeusExecutionConnection()
): TripExecutionCapabilityProvider {
  return {
    providerId: AMADEUS_EXECUTION_PROVIDER_ID,

    supports(request: TripExecutionProviderRequest): boolean {
      return isTripExecutionProviderRequest(request);
    },

    async execute(request: TripExecutionProviderRequest): Promise<TripExecutionProviderResult> {
      const readiness = getAmadeusExecutionReadiness(config, request, connection);
      return {
        providerId: AMADEUS_EXECUTION_PROVIDER_ID,
        requestId: getSafeRequestId(request),
        status: readiness.status,
      };
    },
  };
}
