/**
 * Firebase Cloud Functions v2 host for the VoyageAI read-only external
 * discovery, execution, and execution-capability boundaries (STEPS 42, 67, 68).
 *
 * NOTE: This file is the DEPLOY-TIME host shim. It is intentionally thin:
 * every piece of logic it wires is the offline-tested core under
 * `src/services/serverBoundary` plus the STEP 41 Amadeus discovery seams and the
 * STEP 66 Amadeus execution seams, so the security boundary does not depend on
 * this file's own correctness. It is compiled by the canonical `functions/`
 * package (`npm install && npm run build` inside this directory) and is never
 * part of the client bundle.
 *
 * Flow (all server-side):
 *
 *   Browser POST /api/real-discovery (Firebase Hosting rewrite to the
 *   `realDiscovery` function) with `Authorization: Bearer <Firebase ID token>`
 *   and the normalized discovery query JSON.
 *
 *   Browser POST /api/real-execution (Firebase Hosting rewrite to the
 *   `realExecution` function) with the same header and the STEP 59
 *   provider-neutral execution request JSON:
 *   `{ id, kind: 'trip-execution-provider-request', dispatchId }`.
 *
 *   Browser GET /api/real-execution/capabilities (rewrite to the
 *   `realExecutionCapabilities` function) with the same header and no body. It
 *   reports what execution can actually do; it cannot cause any of it.
 *
 *   In all cases:
 *
 *   1. The Firebase ID token is verified server-side via the Admin SDK. The
 *      resulting UID alone becomes the authenticated principal; the request
 *      body is never read for identity.
 *   2. The Amadeus config is loaded from the Functions runtime configuration.
 *      Both safe defaults are off - `REAL_DISCOVERY_ATTEMPT_ENABLED=false` and
 *      `AMADEUS_EXECUTION_ATTEMPT_ENABLED=false` - so each function fails closed
 *      (501/503) unless the deployment explicitly enables it with credentials.
 *   3. The Amadeus transport is the injected fetch seam (server-side only) for
 *      discovery. Execution and capability discovery are different: STEP 66's
 *      connection is structurally incapable of reaching the network, so these
 *      hosts pass no connection at all and the STEP 66 default is used.
 *   4. The boundary runner validates the request, runs the request through the
 *      unchanged STEP 41 / STEP 66 services, and returns an appropriate HTTP
 *      status plus a provider-neutral, secret-free body.
 *
 * Secrets and tokens never leave this process: the client id/secret appear only
 * inside the token exchange envelope, the access token stays local to the
 * request, and no credential is ever serialized into a response. This file has
 * no booking, payment, verification, persistence, or provider-selection logic.
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { loadAmadeusConfigFromEnv } from '../../src/services/realDiscovery/amadeusConfig';
import {
  createAmadeusFetchTransport,
  type AmadeusTransport,
} from '../../src/services/realDiscovery/amadeusConnection';
import { loadAmadeusExecutionConfigFromEnv } from '../../src/services/realExecution/amadeusExecutionConfig';
import { verifyServerDiscoveryIdToken } from '../../src/services/serverBoundary/serverDiscoveryAuth';
import { runServerBoundaryDiscovery } from '../../src/services/serverBoundary/serverDiscoveryRunner';
import { verifyServerExecutionIdToken } from '../../src/services/serverBoundary/serverExecutionAuth';
import { runServerBoundaryExecution } from '../../src/services/serverBoundary/serverExecutionRunner';
import { verifyServerExecutionCapabilityIdToken } from '../../src/services/serverBoundary/serverExecutionCapabilityAuth';
import { runServerBoundaryExecutionCapabilities } from '../../src/services/serverBoundary/serverExecutionCapabilityRunner';

initializeApp();

/** Read-only real-provider discovery behind the authenticated server boundary. */
export const realDiscovery = onRequest(
  { concurrency: 80, timeoutSeconds: 60 },
  async (request, response) => {
    const idToken = bearerToken(request.headers.authorization);

    const auth = await verifyServerDiscoveryIdToken(idToken, async (token) => {
      const decoded = await getAuth().verifyIdToken(token);
      return { uid: decoded.uid };
    });

    const config = loadAmadeusConfigFromEnv(process.env);
    const transport: AmadeusTransport = createAmadeusFetchTransport(
      fetch as unknown as typeof fetch
    );

    const result = await runServerBoundaryDiscovery({
      raw: request.body,
      config,
      now: new Date().toISOString(),
      principal: auth.ok ? auth.principal : null,
      authProblem: auth.ok ? undefined : auth.problem,
      transport,
    });

    response.status(result.httpStatus).json(result.body);
  }
);

/**
 * Real-provider EXECUTION behind the authenticated server boundary (STEP 67).
 *
 * The request is the STEP 59 provider-neutral execution identity only. This host
 * composes the unchanged STEP 66 service through the boundary runner, which
 * validates, gates fail-closed on the server's own config, and returns a
 * provider-neutral result. Because STEP 66 implements no operation, the honest
 * answer is always a refusal; no booking, payment, or provider payload is ever
 * produced here.
 */
export const realExecution = onRequest(
  { concurrency: 80, timeoutSeconds: 60 },
  async (request, response) => {
    const idToken = bearerToken(request.headers.authorization);

    const auth = await verifyServerExecutionIdToken(idToken, async (token) => {
      const decoded = await getAuth().verifyIdToken(token);
      return { uid: decoded.uid };
    });

    const config = loadAmadeusExecutionConfigFromEnv(process.env);

    // No connection is passed on purpose. STEP 66's default connection holds no
    // transport and cannot reach the network, so the host does not construct or
    // wire one even if a future operation were added.
    const result = await runServerBoundaryExecution({
      method: request.method,
      contentType: request.headers['content-type'],
      raw: request.body,
      config,
      principal: auth.ok ? auth.principal : null,
      authProblem: auth.ok ? undefined : auth.problem,
    });

    response.status(result.httpStatus).json(result.body);
  }
);

/**
 * Real-provider EXECUTION capability discovery behind the authenticated server
 * boundary (STEP 68).
 *
 * A separate function from `realExecution`, because a read-only readiness query
 * and an execution attempt have genuinely different rules: this one is `GET`-only
 * with no request body at all, so a client cannot name a provider, a capability, a
 * host, an HTTP method, or a credential, and there is no code path by which it
 * could reach `execute()`. It reuses the STEP 67 verifier unchanged.
 *
 * It composes the same unchanged STEP 66 service and reads the gate and capability
 * profile that service already computed, so no capability logic is duplicated and
 * "executable" means exactly what the provider itself declares. With the default
 * `AMADEUS_EXECUTION_ENABLED=false`, the honest answer is `unavailable` with an
 * empty `capabilityIds`.
 */
export const realExecutionCapabilities = onRequest(
  { concurrency: 80, timeoutSeconds: 30 },
  async (request, response) => {
    const idToken = bearerToken(request.headers.authorization);

    const auth = await verifyServerExecutionCapabilityIdToken(idToken, async (token) => {
      const decoded = await getAuth().verifyIdToken(token);
      return { uid: decoded.uid };
    });

    const config = loadAmadeusExecutionConfigFromEnv(process.env);

    // No connection is passed, for the same reason as `realExecution`: STEP 66's
    // default connection holds no transport and cannot reach the network. Reading
    // a capability profile never consults it in any case.
    const result = await runServerBoundaryExecutionCapabilities({
      method: request.method,
      raw: request.body,
      config,
      principal: auth.ok ? auth.principal : null,
      authProblem: auth.ok ? undefined : auth.problem,
    });

    response.status(result.httpStatus).json(result.body);
  }
);

function bearerToken(header: string | undefined): string {
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}
