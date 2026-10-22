/**
 * The secure server-side capability discovery host (STEP 68).
 *
 * This is the HTTP host for "what can real execution actually do right now?".
 * It is NOT an execution endpoint, and it deliberately shares almost nothing with
 * the STEP 67 execution runner except its authentication.
 *
 * The pipeline, in a fixed order:
 *
 * 1. **Authentication** - the server receives the already-verified identity as a
 *    `principal`; `null` means unauthenticated/invalid and yields HTTP 401 before
 *    anything else runs. The UID can never come from the request, because this
 *    endpoint has no request vocabulary at all.
 * 2. **Strict validation** - only a `GET` with no body is accepted; a wrong verb
 *    is HTTP 405 and a body is HTTP 400 (see
 *    `serverExecutionCapabilityValidation.ts`). Because nothing is accepted, a
 *    client cannot name a provider, a capability, a host, a method, or a
 *    credential. This is enforced by the shape of the request, not by filtering
 *    fields out of it.
 * 3. **Evaluation through the unchanged STEP 66 service** - the server-side config
 *    is handed to `createRealExecutionService`, and the capability answer is read
 *    from what that service already computed: its deterministic `gate` and the
 *    Amadeus `capabilityProfile` the STEP 66 adapter declares. No capability
 *    logic is duplicated here. The STEP 62 `TripExecutionProviderCapability`
 *    mechanism and the STEP 20 operational guard are the source of truth, so
 *    "executable" means exactly what the provider itself says it can run.
 *
 *    Composing the service is itself a no-op by construction: STEP 66 documents
 *    that creating a service resolves a gate, builds a provider object, and reads
 *    a profile, and nothing more. The provider's `execute()` is never reached -
 *    not because it is guarded against, but because capability evaluation has no
 *    code path that calls it.
 * 4. **A truthful, coarse, secret-free response** - each provider becomes one
 *    projected entry, and malformed internal capability data fails closed rather
 *    than being echoed. See the mapping below.
 *
 * The mapping, and the invariant it protects:
 *
 *   gate `disabled`            -> `unavailable`  / `execution-disabled`
 *   gate `credentials-missing` -> `unavailable`  / `credentials-missing`
 *   gate `ready`, nothing run  -> `unsupported`  / `no-executable-capability`
 *   gate `ready`, something run-> `available`    / `null`
 *
 * The last two rows are the point of the whole endpoint. A fully configured
 * provider that implements no operation is reported as `unsupported` with an
 * empty `capabilityIds` - deliberately *distinct* from the `unavailable` a
 * disabled provider reports. Configuration, credentials, and provider presence
 * are therefore never able to imply that booking, purchasing, or any other
 * operation exists. The `available` row exists so the mapping stays correct if an
 * operation is ever implemented, and it is not reachable in this build.
 *
 * A successful *evaluation* is always HTTP 200, whatever the provider's state:
 * "this deployment can execute nothing" is a correct and useful answer, not a
 * server failure. Only authentication (401), method/body rejection (405/400), and
 * a defensive internal fault (500) are non-200.
 *
 * Determinism: given `(method, body, config, principal)` the outcome is
 * deterministic. No clock, SDK, React, Router, Zustand, `any`, or generic
 * `Record<string, any>` escape hatches.
 */

import {
  getAdapterOperationalCapabilityIds,
  isProviderAdapterProfile,
  type ProviderAdapterProfile,
} from '../../domain/providers/providerAdapter';
import { isProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import type { AmadeusExecutionConfig } from '../realExecution/amadeusExecutionConfig';
import { getAmadeusExecutionAttemptGate } from '../realExecution/amadeusExecutionConfig';
import { createRealExecutionService } from '../realExecution/realExecutionService';
import {
  SERVER_EXECUTION_AUTH_ERROR_RESPONSE_KIND,
  SERVER_EXECUTION_INVALID_TOKEN_MESSAGE,
  SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE,
  type ServerExecutionAuthProblem,
  type ServerExecutionPrincipal,
} from './serverExecutionContract';
import {
  SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND,
  SERVER_EXECUTION_CAPABILITY_HTTP_BAD_REQUEST,
  SERVER_EXECUTION_CAPABILITY_HTTP_INTERNAL_SERVER_ERROR,
  SERVER_EXECUTION_CAPABILITY_HTTP_METHOD_NOT_ALLOWED,
  SERVER_EXECUTION_CAPABILITY_HTTP_OK,
  SERVER_EXECUTION_CAPABILITY_HTTP_UNAUTHORIZED,
  type ServerExecutionCapabilityAvailability,
  type ServerExecutionCapabilityEntry,
  type ServerExecutionCapabilityHttpResult,
  type ServerExecutionCapabilityReason,
  type ServerExecutionCapabilityResponse,
  type ServerExecutionCapabilityResponseProblem,
} from './serverExecutionCapabilityContract';
import { validateServerExecutionCapabilityRequest } from './serverExecutionCapabilityValidation';

/** Everything one capability-discovery run needs (all injected). */
export interface RunServerExecutionCapabilityInput {
  /** The HTTP method, as received. */
  method: unknown;
  /**
   * The raw request body as received. It must be absent or empty; a present body
   * is rejected rather than read, so nothing in it can influence the result.
   */
  raw?: unknown;
  /** The server-side config that owns credentials (never echoed, never serialized). */
  config: AmadeusExecutionConfig;
  /**
   * The server-verified identity. `null` yields HTTP 401 before any validation or
   * capability evaluation runs.
   */
  principal: ServerExecutionPrincipal | null;
  /**
   * The bounded reason the principal is missing (defaults to `unauthenticated`).
   */
  authProblem?: ServerExecutionAuthProblem;
}

/**
 * Maps a STEP 66 gate to a coarse availability plus a bounded reason.
 *
 * The gate itself is never placed on the wire. `disabled` and `ready` in
 * particular stay internal: reporting `ready` would tell a client that
 * credentials are present, which is precisely the implication this endpoint must
 * not create. The reasons below are a closed client-facing vocabulary - they say
 * *whether* configuration is incomplete, never which value is absent.
 */
function availabilityForGate(
  gate: ReturnType<typeof getAmadeusExecutionAttemptGate>
): { status: ServerExecutionCapabilityAvailability; reason: ServerExecutionCapabilityReason } {
  if (gate === 'disabled') {
    return { status: 'unavailable', reason: 'execution-disabled' };
  }
  if (gate === 'credentials-missing') {
    return { status: 'unavailable', reason: 'credentials-missing' };
  }
  // A ready gate is the only case where capability can be claimed, and it still
  // has to earn it below. Returning `unsupported` here as the default means a new
  // gate value would fail closed rather than silently read as available.
  return { status: 'unsupported', reason: 'no-executable-capability' };
}

/**
 * Projects a provider's capability profile into one safe wire entry, failing
 * closed at every step.
 *
 * The order matters. Structural validity is checked first, then the identity
 * cross-check, then the executable ids, and only then is anything reported as
 * `available`. A profile that cannot be fully understood is reported as
 * `unsupported` / `malformed-provider-capability` with an empty id list, because
 * an unreadable capability declaration is not evidence of capability.
 */
function toCapabilityEntry(
  providerId: string,
  profile: ProviderAdapterProfile,
  fallback: { status: ServerExecutionCapabilityAvailability; reason: ServerExecutionCapabilityReason }
): ServerExecutionCapabilityEntry {
  if (!isProviderAdapterProfile(profile) || profile.id !== providerId) {
    return {
      providerId,
      status: 'unsupported',
      capabilityIds: [],
      reason: 'malformed-provider-capability',
    };
  }

  // `getAdapterOperationalCapabilityIds` is the STEP 20 operational guard: it
  // keeps only `available` declarations, in a deterministic order. The ids are
  // re-checked here anyway, so the guarantee that only recognized capability
  // vocabulary reaches the wire is locally verifiable and does not depend on the
  // internals of a module in another folder.
  //
  // That re-check cannot fail today: the helper builds its result by walking a
  // fixed list of the seven recognized ids, so every id it returns is a
  // `ProviderCapabilityId` by construction. Reaching the branch below would
  // require changing the STEP 20 helper, and it is left unexercised on purpose -
  // the only way to force it would be to weaken that helper, which is a far worse
  // trade than a defensive check that never fires. It stays so that a future
  // change to the STEP 20 operational guard fails closed here rather than
  // silently widening what the browser receives.
  const operational = getAdapterOperationalCapabilityIds(profile);
  if (!operational.every((id) => isProviderCapabilityId(id))) {
    return {
      providerId,
      status: 'unsupported',
      capabilityIds: [],
      reason: 'malformed-provider-capability',
    };
  }

  // A provider that is not even attemptable can never be reported as executable,
  // regardless of what its declarations claim. The STEP 66 adapter never declares
  // an available capability under such a gate, so this is belt-and-braces - but
  // it keeps the "no capability while disabled" invariant true by construction
  // here rather than by trust in the adapter.
  if (fallback.status === 'unavailable') {
    return { providerId, status: 'unavailable', capabilityIds: [], reason: fallback.reason };
  }

  if (operational.length === 0) {
    return {
      providerId,
      status: 'unsupported',
      capabilityIds: [],
      reason: fallback.reason,
    };
  }

  return {
    providerId,
    status: 'available',
    capabilityIds: operational,
    reason: null,
  };
}

/**
 * Builds a response body. `problem` is a bounded token, never a sentence, so the
 * body can never carry an internal detail even by accident.
 */
function body(
  providers: ServerExecutionCapabilityEntry[],
  problem: ServerExecutionCapabilityResponseProblem | null
): ServerExecutionCapabilityResponse {
  return { kind: SERVER_EXECUTION_CAPABILITIES_RESPONSE_KIND, providers, problem };
}

function successBody(providers: ServerExecutionCapabilityEntry[]): ServerExecutionCapabilityResponse {
  return body(providers, null);
}

function authRejection(problem: ServerExecutionAuthProblem): ServerExecutionCapabilityHttpResult {
  return {
    httpStatus: SERVER_EXECUTION_CAPABILITY_HTTP_UNAUTHORIZED,
    body: {
      kind: SERVER_EXECUTION_AUTH_ERROR_RESPONSE_KIND,
      status: problem,
      message:
        problem === 'unauthenticated'
          ? SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE
          : SERVER_EXECUTION_INVALID_TOKEN_MESSAGE,
    },
  };
}

function methodRejection(): ServerExecutionCapabilityHttpResult {
  return {
    httpStatus: SERVER_EXECUTION_CAPABILITY_HTTP_METHOD_NOT_ALLOWED,
    body: body([], 'unsupported-method'),
  };
}

function bodyRejection(): ServerExecutionCapabilityHttpResult {
  return {
    httpStatus: SERVER_EXECUTION_CAPABILITY_HTTP_BAD_REQUEST,
    body: body([], 'unexpected-body'),
  };
}

function unexpectedRejection(): ServerExecutionCapabilityHttpResult {
  return {
    httpStatus: SERVER_EXECUTION_CAPABILITY_HTTP_INTERNAL_SERVER_ERROR,
    body: body([], 'unexpected-failure'),
  };
}

/**
 * Runs a single authenticated, validated capability-discovery request through the
 * secure server boundary and the unchanged STEP 66 service.
 *
 * Never throws: an internal fault is contained and reported as the defensive 500
 * state. Never calls a provider's `execute()`, never consults a transport, never
 * obtains an access token, never persists, and never books, holds, cancels, or
 * modifies anything.
 */
export async function runServerBoundaryExecutionCapabilities(
  input: RunServerExecutionCapabilityInput
): Promise<ServerExecutionCapabilityHttpResult> {
  if (input.principal === null || input.principal === undefined) {
    return authRejection(input.authProblem ?? 'unauthenticated');
  }

  const validation = validateServerExecutionCapabilityRequest({
    method: input.method,
    raw: input.raw,
  });
  if (!validation.ok) {
    return validation.problem === 'unsupported-method' ? methodRejection() : bodyRejection();
  }

  // Everything below reads the server config and the composed STEP 66 service. A
  // fault here is a defect in the boundary itself, so it is reported defensively
  // rather than allowed to reject out of the function.
  try {
    const gate = getAmadeusExecutionAttemptGate(input.config);
    const fallback = availabilityForGate(gate);

    // Composing the STEP 66 service runs nothing: it resolves the gate, builds the
    // provider object, and reads the profile. No connection is passed, so the
    // default structurally network-incapable one is in place, and nothing would
    // reach a transport even if an execution path existed.
    const service = createRealExecutionService(input.config);
    const providers = service.providers.map((provider) =>
      toCapabilityEntry(provider.providerId, service.amadeusCapabilityProfile, fallback)
    );

    return {
      httpStatus: SERVER_EXECUTION_CAPABILITY_HTTP_OK,
      body: successBody(providers),
    };
  } catch {
    return unexpectedRejection();
  }
}
