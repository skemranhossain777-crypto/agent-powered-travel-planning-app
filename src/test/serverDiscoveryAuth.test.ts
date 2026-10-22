import { describe, expect, it, vi } from 'vitest';
import {
  verifyServerDiscoveryIdToken,
  type IdTokenVerifier,
} from '../services/serverBoundary/serverDiscoveryAuth';

describe('STEP 42 verifyServerDiscoveryIdToken never trusts the request body', () => {
  it('treats a missing token as unauthenticated without calling the verifier', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    const result = await verifyServerDiscoveryIdToken(undefined, verifier);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unauthenticated');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('treats a non-string token as unauthenticated', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    const result = await verifyServerDiscoveryIdToken(42 as unknown as string, verifier);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unauthenticated');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('treats an empty or whitespace token as unauthenticated', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    const result = await verifyServerDiscoveryIdToken('   ', verifier);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unauthenticated');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('accepts a verifier that returns a UID', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', async () => ({ uid: 'user-1' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.uid).toBe('user-1');
  });

  it('trims whitespace from returned identities', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', async () => ({
      uid: '  user-1  ',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.uid).toBe('user-1');
  });

  it('rejects when the verifier returns no uid', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', async () => ({}) as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('invalid-token');
  });

  it('rejects when the verifier returns an empty uid', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', async () => ({ uid: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('invalid-token');
  });

  it('rejects when the verifier throws (return resolves, not rethrows)', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', async () => {
      throw new Error('expired');
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('invalid-token');
  });

  it('rejects when the verifier rejects (return resolves, not rethrows)', async () => {
    const result = await verifyServerDiscoveryIdToken('token-abc', () =>
      Promise.reject(new Error('network'))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('invalid-token');
  });

  it('rejects tokens only via the injected verifier — no Firebase SDK in the boundary', () => {
    expect(verifyServerDiscoveryIdToken.length).toBe(2);
  });
});
