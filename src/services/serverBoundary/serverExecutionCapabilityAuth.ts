/**
 * Server-side authentication for the capability boundary (STEP 68).
 *
 * Capability discovery is a credentialed read. It is not anonymous, because
 * knowing which providers are wired into a deployment is deployment-specific
 * information, and because the future client/agent that consumes it is already
 * required to be authenticated everywhere else. But it is also strictly weaker
 * than execution, so it is kept behind the *same* mechanism rather than a new,
 * "simpler" one.
 *
 * This module holds no verification logic. It delegates to the STEP 67
 * `verifyServerExecutionIdToken`, which in turn delegates to the STEP 42
 * discovery verifier. There is therefore still exactly one verifier, one token
 * type, and one identity source in the whole repository, and the three execution
 * endpoints cannot drift apart in how they treat a missing, blank, rejected, or
 * throwing token.
 *
 * Authorization is unchanged and intentionally trivial: any authenticated user
 * may ask what the deployment can execute. There is no admin-only tier, because
 * the answer itself carries no secret - only coarse availability, a bounded
 * reason, and the (currently empty) list of executable capability ids.
 *
 * The verified UID is never read from the request. This endpoint has no request
 * vocabulary at all, so a UID, a provider id, or a capability id cannot be
 * supplied by the caller even accidentally.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

import type { ServerExecutionPrincipal } from './serverExecutionContract';
import { verifyServerExecutionIdToken } from './serverExecutionAuth';

/** The result of one server-side authentication check for the capability endpoint. */
export type ServerExecutionCapabilityAuthResult =
  | { ok: true; principal: ServerExecutionPrincipal }
  | { ok: false; problem: 'unauthenticated' | 'invalid-token' };

/**
 * Verifies a Firebase ID token for a capability request by delegating to the
 * STEP 67 execution verifier. A missing/empty token is `unauthenticated`; a
 * rejected or throwing token is `invalid-token`. Never throws, and never reads
 * anything from the request beyond the token the host already extracted.
 */
export async function verifyServerExecutionCapabilityIdToken(
  idToken: unknown,
  verifier: Parameters<typeof verifyServerExecutionIdToken>[1]
): Promise<ServerExecutionCapabilityAuthResult> {
  const result = await verifyServerExecutionIdToken(idToken, verifier);
  return result.ok
    ? { ok: true, principal: { uid: result.principal.uid } }
    : { ok: false, problem: result.problem };
}
