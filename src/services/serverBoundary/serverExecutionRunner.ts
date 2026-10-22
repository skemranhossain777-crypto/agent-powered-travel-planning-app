/**
 * The secure server-side execution host (STEP 67).
 *
 * This is the HTTP execution host for the STEP 66 Amadeus execution provider. It
 * is NOT a replacement for the provider abstraction and it does not talk to a
 * provider itself. It composes, in a fixed order:
 *
 *   1. **Authentication** — the server receives the already-verified identity as
 *      a `principal`; `null` means the request was unauthenticated/invalid and
 *      gets HTTP 401 before anything else runs. The Functions host computes the
 *      principal from a server-verified Firebase ID token (see
 *      `serverExecutionAuth.ts`); the UID can never come from the request body.
 *   2. **Strict validation** — the raw body must be exactly the STEP 59
 *      provider-neutral request and nothing more (see
 *      `serverExecutionValidation.ts`); otherwise HTTP 400 with a bounded,
 *      value-free problem.
 *   3. **Fail-closed configuration gate** — the attempt switch must be on and
 *      credentials present, exactly like STEP 66. Disabled is HTTP 501 (feature
 *      not enabled) and missing credentials HTTP 503 (service not configured).
 *      Both are decided from the *server's own* config, and both return before
 *      a provider is composed, so a disabled build performs no provider work at
 *      all. This gate is read from the STEP 66 module rather than reimplemented,
 *      so the boundary cannot drift from the provider's own idea of readiness.
 *   4. **Provider execution through the unchanged STEP 66 service** — the
 *      validated request and the server-side config are handed to
 *      `createRealExecutionService`, and the resulting provider list is executed
 *      in the service's own deterministic order. The boundary reuses the STEP 59
 *      `TripExecutionProvider` contract and the STEP 62 capability contract
 *      rather than calling the adapter, the connection, or any transport
 *      directly, and it never constructs an Amadeus request itself. It
 *      deliberately does not run the STEP 65 pipeline: this wire boundary needs
 *      only the provider-neutral results, and the plan/binding/aggregate
 *      artifacts the pipeline produces are not part of the response contract.
 *      Steps 61-65 remain the path any consumer that wants orchestration takes,
 *      and none of their semantics are altered or bypassed here.
 *   5. **Provider-neutral, secret-free response** — each provider result is
 *      projected field-by-field, so a config value, access token, raw provider
 *      body, or internal reason string can never serialize. A real provider
 *      failure is HTTP 502, never a misleading HTTP 200.
 *
 * Two properties are worth stating explicitly, because both are easy to lose in a
 * refactor:
 *
 * - **`accepted` stays unreachable and the mapping stays honest.** The STEP 66
 *   provider has no implemented operation, so it reports `rejected`,
 *   `unsupported`, or `failed`. The boundary maps those to real HTTP semantics
 *   and does not upgrade any of them to success.
 * - **Nothing is persisted.** No booking, reservation, payment, cancellation,
 *   modification, traveler record, or primary-plan assignment happens here, and
 *   no response claims one did.
 *
 * Determinism: given `(envelope, config, connection, principal)` the outcome is
 * deterministic. No clock, Firebase SDK, React, Router, Zustand, `any`, or
 * generic `Record<string, any>` escape hatches.
 */

import type { ProviderSafeError } from '../../domain/providers/executionOperations';
import type { AmadeusExecutionConfig } from '../realExecution/amadeusExecutionConfig';
import { getAmadeusExecutionAttemptGate } from '../realExecution/amadeusExecutionConfig';
import type { AmadeusExecutionConnection } from '../realExecution/amadeusExecutionConnection';
import { createRealExecutionService } from '../realExecution/realExecutionService';
import type {
  TripExecutionProviderRequest,
  TripExecutionProviderResult,
  TripExecutionProviderResultStatus,
} from '../tripExecution/tripExecutionProvider';
import {
  SERVER_EXECUTION_AUTH_ERROR_RESPONSE_KIND,
  SERVER_EXECUTION_HTTP_BAD_GATEWAY,
  SERVER_EXECUTION_HTTP_BAD_REQUEST,
  SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR,
  SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED,
  SERVER_EXECUTION_HTTP_OK,
  SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE,
  SERVER_EXECUTION_HTTP_UNAUTHORIZED,
  SERVER_EXECUTION_INVALID_TOKEN_MESSAGE,
  SERVER_EXECUTION_UNAUTHENTICATED_MESSAGE,
  type ServerExecutionAuthProblem,
  type ServerExecutionHttpResult,
  type ServerExecutionPrincipal,
  type ServerExecutionResponse,
  type ServerExecutionStatus,
} from './serverExecutionContract';
import {
  validateServerExecutionRequest,
  type ServerExecutionValidationProblem,
} from './serverExecutionValidation';

/** Everything one server-boundary execution run needs (all injected). */
export interface RunServerExecutionInput {
  /** The transport facts: HTTP method, content type, and the raw parsed body. */
  method: unknown;
  /** The `Content-Type` header as received, or `undefined` when absent. */
  contentType?: unknown;
  /** The raw request body as received over HTTP (never trusted). */
  raw: unknown;
  /** The server-side config that owns credentials (never echoed). */
  config: AmadeusExecutionConfig;
  /**
   * The server-verified identity. `null` rejects with HTTP 401 before any input
   * or provider code runs.
   */
  principal: ServerExecutionPrincipal | null;
  /**
   * The bounded reason the principal is missing (defaults to `unauthenticated`).
   * The Functions host passes `invalid-token` when ID-token verification fails
   * so the browser can distinguish an expired session from a missing one.
   */
  authProblem?: ServerExecutionAuthProblem;
  /**
   * Optional injection seam for the STEP 66 transport. Omitting it uses the
   * default connection, which is structurally incapable of reaching the network.
   * A test injects a connection to drive the provider's `failed` path without a
   * real request; the Functions host deliberately does not pass one.
   */
  connection?: AmadeusExecutionConnection;
}

/** Stable messages for the fail-closed configuration states (mirror STEP 66). */
export const SERVER_EXECUTION_DISABLED_MESSAGE =
  'Real-provider execution is not enabled in this build.';
export const SERVER_EXECUTION_CREDENTIALS_MISSING_MESSAGE =
  'Real-provider execution credentials are not configured for this build.';

/**
 * Bounded, credential-free messages for each provider result status. These are
 * fixed strings: the provider's internal reason token is never forwarded, so a
 * provider can neither leak a diagnostic nor smuggle a value into a response.
 */
export const SERVER_EXECUTION_UNSUPPORTED_MESSAGE =
  'The provider did not implement this execution request.';
export const SERVER_EXECUTION_REJECTED_MESSAGE =
  'The provider rejected this execution request.';
export const SERVER_EXECUTION_FAILED_MESSAGE =
  'The provider could not complete this execution request.';
export const SERVER_EXECUTION_UNEXPECTED_FAILURE_MESSAGE =
  'The execution boundary could not complete this request.';

/**
 * The status each provider result status contributes. Precedence is applied
 * later; a single failure is never masked by a sibling's `unsupported`.
 */
const STATUS_FOR_PROVIDER_RESULT: Readonly<
  Record<TripExecutionProviderResultStatus, ServerExecutionStatus>
> = Object.freeze({
  accepted: 'success',
  rejected: 'invalid-input',
  unsupported: 'not-implemented',
  failed: 'provider-failure',
});

/** The bounded message for each status. `null` for the successful path. */
const MESSAGE_FOR_STATUS: Readonly<Record<ServerExecutionStatus, string | null>> = Object.freeze({
  success: null,
  'invalid-input': SERVER_EXECUTION_REJECTED_MESSAGE,
  'not-implemented': SERVER_EXECUTION_UNSUPPORTED_MESSAGE,
  'not-configured': SERVER_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
  'provider-failure': SERVER_EXECUTION_FAILED_MESSAGE,
  'unexpected-failure': SERVER_EXECUTION_UNEXPECTED_FAILURE_MESSAGE,
});

/** The error category reported alongside each failing status. */
const ERROR_CATEGORY_FOR_STATUS: Readonly<
  Record<Exclude<ServerExecutionStatus, 'success'>, ProviderSafeError['category']>
> = Object.freeze({
  'invalid-input': 'invalid-input',
  'not-implemented': 'not-implemented',
  'not-configured': 'credentials-missing',
  'provider-failure': 'provider-unavailable',
  'unexpected-failure': 'unknown',
});

/**
 * Ranks statuses so the most severe outcome wins. A failure dominates a
 * rejection, which dominates an unimplemented answer, which dominates success.
 */
const STATUS_SEVERITY: Readonly<Record<ServerExecutionStatus, number>> = Object.freeze({
  success: 0,
  'not-implemented': 1,
  'invalid-input': 2,
  'not-configured': 2,
  'provider-failure': 3,
  'unexpected-failure': 3,
});

/**
 * The HTTP status for an execution status: 200 only for a genuine success, 400
 * for invalid input, 501 for disabled or unimplemented, 503 for missing server
 * credentials, 502 for any real provider failure, and 500 for the defensive
 * unexpected state.
 */
export function httpStatusForExecutionStatus(status: ServerExecutionStatus): number {
  switch (status) {
    case 'success':
      return SERVER_EXECUTION_HTTP_OK;
    case 'invalid-input':
      return SERVER_EXECUTION_HTTP_BAD_REQUEST;
    case 'not-implemented':
      return SERVER_EXECUTION_HTTP_NOT_IMPLEMENTED;
    case 'not-configured':
      return SERVER_EXECUTION_HTTP_SERVICE_UNAVAILABLE;
    case 'provider-failure':
      return SERVER_EXECUTION_HTTP_BAD_GATEWAY;
    case 'unexpected-failure':
      return SERVER_EXECUTION_HTTP_INTERNAL_SERVER_ERROR;
  }
}

/**
 * Projects one provider result into the wire-safe shape, field by field. The
 * input is treated as untrusted: only the three contract fields are copied, so a
 * provider that returned extra keys cannot serialize them.
 */
export function toServerExecutionProviderResult(
  result: TripExecutionProviderResult
): TripExecutionProviderResult {
  return {
    providerId: result.providerId,
    requestId: result.requestId,
    status: result.status,
  };
}

/** Builds a normalized response body for a status, with the standard safe error. */
function responseFor(
  status: ServerExecutionStatus,
  request: TripExecutionProviderRequest | null,
  providerResults: TripExecutionProviderResult[],
  overrides: {
    problem?: ServerExecutionValidationProblem;
    error?: ProviderSafeError;
  } = {}
): ServerExecutionResponse {
  // The `success` arm is unreachable while the composed provider implements no
  // operation, which is the point: the boundary is written so that HTTP 200 is
  // only ever reachable by a real `accepted`. Its semantics are pinned directly by
  // the `httpStatusForExecutionStatus('success')` test instead.
  if (status === 'success') {
    return { status, request, providerResults, problem: null, error: null };
  }

  return {
    status,
    request,
    providerResults,
    problem: overrides.problem ?? null,
    error: overrides.error ?? {
      category: ERROR_CATEGORY_FOR_STATUS[status],
      message: MESSAGE_FOR_STATUS[status] as string,
    },
  };
}

function toHttpResult(response: ServerExecutionResponse): ServerExecutionHttpResult {
  return { httpStatus: httpStatusForExecutionStatus(response.status), body: response };
}

function authRejection(problem: ServerExecutionAuthProblem): ServerExecutionHttpResult {
  return {
    httpStatus: SERVER_EXECUTION_HTTP_UNAUTHORIZED,
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

function invalidInputRejection(
  problem: ServerExecutionValidationProblem
): ServerExecutionHttpResult {
  return toHttpResult(
    responseFor('invalid-input', null, [], {
      problem,
      error: { category: 'invalid-input', message: SERVER_EXECUTION_REJECTED_MESSAGE },
    })
  );
}

/**
 * Runs a single authenticated, validated execution attempt through the secure
 * server boundary and the unchanged STEP 66 service.
 *
 * Never throws: every internal fault is contained and reported as a bounded safe
 * error. Never persists, never books, holds, pays, cancels, or modifies, and
 * never assigns a primary plan. The result carries appropriate HTTP status
 * semantics plus a provider-neutral, secret-free body.
 */
export async function runServerBoundaryExecution(
  input: RunServerExecutionInput
): Promise<ServerExecutionHttpResult> {
  if (input.principal === null || input.principal === undefined) {
    return authRejection(input.authProblem ?? 'unauthenticated');
  }

  const validation = validateServerExecutionRequest({
    method: input.method,
    contentType: input.contentType,
    raw: input.raw,
  });
  if (!validation.ok) {
    return invalidInputRejection(validation.problem);
  }

  const request = validation.request;

  // Everything below this point touches the server config or a provider. A fault
  // here is a defect in the boundary itself, so it is reported as the defensive
  // 500 state rather than being allowed to reject out of the function.
  try {
    // The gate is read from the STEP 66 module, so this boundary can never have a
    // different idea of "enabled" than the provider does.
    const gate = getAmadeusExecutionAttemptGate(input.config);
    if (gate === 'disabled') {
      return toHttpResult(
        responseFor('not-implemented', request, [], {
          error: { category: 'not-implemented', message: SERVER_EXECUTION_DISABLED_MESSAGE },
        })
      );
    }
    if (gate === 'credentials-missing') {
      return toHttpResult(
        responseFor('not-configured', request, [], {
          error: {
            category: 'credentials-missing',
            message: SERVER_EXECUTION_CREDENTIALS_MISSING_MESSAGE,
          },
        })
      );
    }

    // Compose the unchanged STEP 66 service. Composing runs nothing: the
    // provider is only executed below, through the STEP 59 contract.
    const service = createRealExecutionService(input.config, { connection: input.connection });

    const providerResults: TripExecutionProviderResult[] = [];
    let status: ServerExecutionStatus = 'success';

    for (const provider of service.providers) {
      let result: TripExecutionProviderResult;
      try {
        result = await provider.execute(request);
      } catch {
        // The STEP 66 adapter contains its own faults, so reaching this branch
        // means the provider itself misbehaved. It is an upstream execution
        // failure, not a boundary defect: report it as 502 and carry on being
        // honest rather than letting a rejection escape.
        //
        // Not reachable through the composed provider set today, and left
        // unexercised on purpose: the only way to test it would be to inject a
        // misbehaving provider, and this boundary deliberately offers no seam for
        // substituting a provider. The defensive shape is kept because a future
        // adapter is exactly the code that could throw.
        providerResults.push({
          providerId: provider.providerId,
          requestId: request.id,
          status: 'failed',
        });
        status = 'provider-failure';
        continue;
      }

      providerResults.push(toServerExecutionProviderResult(result));

      // The composed set holds one provider today, so this comparison only ever
      // upgrades `success`. It is written generally so a second real provider
      // cannot be masked by a sibling's `unsupported`, and so a future `accepted`
      // can never be masked by a `failed`.
      const candidate = STATUS_FOR_PROVIDER_RESULT[result.status];
      if (STATUS_SEVERITY[candidate] > STATUS_SEVERITY[status]) {
        status = candidate;
      }
    }

    if (providerResults.length === 0) {
      // A ready gate with no composed provider is an internal inconsistency, not
      // a client error, so it is reported defensively rather than as success.
      // `createRealExecutionService` always composes the Amadeus provider, so
      // this cannot happen today; it exists so a future empty composition fails
      // loudly instead of reporting an empty success.
      status = 'unexpected-failure';
    }

    return toHttpResult(responseFor(status, request, providerResults));
  } catch {
    return toHttpResult(
      responseFor('unexpected-failure', request, [], {
        error: { category: 'unknown', message: SERVER_EXECUTION_UNEXPECTED_FAILURE_MESSAGE },
      })
    );
  }
}
