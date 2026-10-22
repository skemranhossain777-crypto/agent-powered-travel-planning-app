/**
 * Server-side authentication for the discovery boundary (STEP 42).
 *
 * The discovery endpoint must never become an anonymous credentialed proxy, so
 * every request must carry a Firebase ID token that the SERVER verifies. The
 * repository's existing authentication model is Firebase Auth (used by the
 * client), and the server verifies that same identity via the injectable
 * `IdTokenVerifier` seam:
 *
 * - The browser sends its Firebase ID token in the `Authorization` header.
 * - The Functions host supplies the verifier wired to the Firebase Admin SDK;
 *   offline tests supply a deterministic fake.
 * - The UID is always taken from the server-verified token, never from the
 *   request body, so a body-supplied UID can never impersonate a user.
 * - No alternate authentication mechanism is introduced.
 *
 * Authorization for STEP 42 stays intentionally simple: any authenticated user
 * is allowed read-only discovery. There are no admin controls, no booking or
 * transaction permissions, and no provider-specific role system.
 *
 * Determinism: no clock, network, SDK, Firebase, React, Router, Zustand, `any`,
 * or generic `Record<string, any>` escape hatches.
 */

import type { ServerDiscoveryPrincipal } from './serverDiscoveryContract';

/**
 * The injectable Firebase ID-token verification seam. The Functions host wires
 * this to the Admin SDK's `verifyIdToken`; tests wire deterministic fakes. It
 * resolves to the verified identity (the UID alone is needed) or throws.
 */
export type IdTokenVerifier = (idToken: string) => Promise<{ uid: string }>;

/** The result of one server-side authentication check. */
export type ServerDiscoveryAuthResult =
  | { ok: true; principal: ServerDiscoveryPrincipal }
  | { ok: false; problem: 'unauthenticated' | 'invalid-token' };

/**
 * Verifies a Firebase ID token server-side. A missing/empty token is
 * `unauthenticated`; a token the verifier rejects or that throws is
 * `invalid-token`. Never observes the request body; never throws.
 */
export async function verifyServerDiscoveryIdToken(
  idToken: unknown,
  verifier: IdTokenVerifier
): Promise<ServerDiscoveryAuthResult> {
  if (typeof idToken !== 'string' || idToken.trim().length === 0) {
    return { ok: false, problem: 'unauthenticated' };
  }
  try {
    const identity = await verifier(idToken.trim());
    if (typeof identity?.uid !== 'string' || identity.uid.trim().length === 0) {
      return { ok: false, problem: 'invalid-token' };
    }
    return { ok: true, principal: { uid: identity.uid.trim() } };
  } catch {
    return { ok: false, problem: 'invalid-token' };
  }
}
