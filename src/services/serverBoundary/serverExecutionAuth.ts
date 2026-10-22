/**
 * Server-side authentication for the execution boundary (STEP 67).
 *
 * The execution endpoint must never become an anonymous credentialed proxy, so
 * it reuses the authentication mechanism the STEP 42 discovery boundary already
 * established, unchanged:
 *
 * - The browser sends its Firebase ID token in the `Authorization` header.
 * - The Functions host supplies the verifier wired to the Firebase Admin SDK;
 *   offline tests supply a deterministic fake.
 * - The UID is always taken from the server-verified token, never from the
 *   request body, so a body-supplied UID can never impersonate a user.
 * - No alternate authentication mechanism is introduced: there is still exactly
 *   one verifier, one token type, and one identity source in the repository.
 *
 * This module deliberately holds no verification logic of its own. It delegates
 * to `verifyServerDiscoveryIdToken` and re-types the result, so the two
 * boundaries cannot drift apart in how they treat a missing, blank, rejected, or
 * throwing token. Adding a second copy of this logic is exactly the kind of
 * divergence that eventually lets one endpoint accept a weaker credential than
 * the other.
 *
 * Authorization stays intentionally simple and identical to STEP 42: any
 * authenticated user may attempt an execution. There are no admin controls, no
 * booking or transaction permissions, and no provider-specific role system. The
 * real provider is additionally fail-closed by the STEP 66 gate, so an
 * authenticated caller can never reach an unimplemented operation.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

import {
  verifyServerDiscoveryIdToken,
  type IdTokenVerifier,
} from './serverDiscoveryAuth';
import type { ServerExecutionPrincipal } from './serverExecutionContract';

/**
 * The injectable Firebase ID-token verification seam, re-exported from the
 * discovery boundary so both endpoints are wired by the same type and the
 * Functions host cannot pass a different verifier shape to one of them.
 */
export type { IdTokenVerifier };

/** The result of one server-side authentication check. */
export type ServerExecutionAuthResult =
  | { ok: true; principal: ServerExecutionPrincipal }
  | { ok: false; problem: 'unauthenticated' | 'invalid-token' };

/**
 * Verifies a Firebase ID token server-side for an execution request, by
 * delegating to the discovery boundary's verifier. A missing/empty token is
 * `unauthenticated`; a token the verifier rejects or that throws is
 * `invalid-token`. Never observes the request body; never throws.
 */
export async function verifyServerExecutionIdToken(
  idToken: unknown,
  verifier: IdTokenVerifier
): Promise<ServerExecutionAuthResult> {
  const result = await verifyServerDiscoveryIdToken(idToken, verifier);
  return result.ok
    ? { ok: true, principal: { uid: result.principal.uid } }
    : { ok: false, problem: result.problem };
}
