import { describe, expect, it, vi } from 'vitest';
import {
  verifyServerExecutionIdToken,
  type IdTokenVerifier,
} from '../services/serverBoundary/serverExecutionAuth';
import {
  verifyServerDiscoveryIdToken,
  type IdTokenVerifier as DiscoveryIdTokenVerifier,
} from '../services/serverBoundary/serverDiscoveryAuth';

describe('STEP 67 verifyServerExecutionIdToken never trusts the request body', () => {
  it('treats a missing token as unauthenticated without calling the verifier', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    const result = await verifyServerExecutionIdToken(undefined, verifier);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unauthenticated');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('treats a non-string token as unauthenticated', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    const result = await verifyServerExecutionIdToken(42, verifier);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unauthenticated');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('treats an empty or whitespace token as unauthenticated', async () => {
    const verifier = vi.fn<IdTokenVerifier>();
    for (const token of ['', '   ', '\t\n']) {
      const result = await verifyServerExecutionIdToken(token, verifier);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.problem).toBe('unauthenticated');
    }
    expect(verifier).not.toHaveBeenCalled();
  });

  it('accepts a verifier that returns a UID and trims it', async () => {
    const result = await verifyServerExecutionIdToken('token-abc', async () => ({
      uid: '  user-1  ',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.uid).toBe('user-1');
  });

  it('rejects a verified identity that carries no usable uid', async () => {
    for (const identity of [{}, { uid: '' }, { uid: '   ' }, { uid: 42 }]) {
      const result = await verifyServerExecutionIdToken(
        'token-abc',
        async () => identity as { uid: string }
      );
      expect(result).toEqual({ ok: false, problem: 'invalid-token' });
    }
  });

  it('resolves rather than rethrows when the verifier throws or rejects', async () => {
    const thrown = await verifyServerExecutionIdToken('token-abc', async () => {
      throw new Error('expired');
    });
    expect(thrown).toEqual({ ok: false, problem: 'invalid-token' });

    const rejected = await verifyServerExecutionIdToken('token-abc', () =>
      Promise.reject(new Error('network'))
    );
    expect(rejected).toEqual({ ok: false, problem: 'invalid-token' });
  });

  it('never leaks a verifier failure message into the result', async () => {
    const result = await verifyServerExecutionIdToken('token-abc', async () => {
      throw new Error('uid=admin-secret-token-rejected');
    });
    expect(JSON.stringify(result)).not.toContain('admin-secret-token');
  });

  it('accepts tokens only via the injected verifier, with no SDK in the boundary', () => {
    // Two parameters: the token and the verifier. No request, no SDK, no clock.
    expect(verifyServerExecutionIdToken.length).toBe(2);
  });
});

describe('STEP 67 execution auth cannot drift from the discovery auth', () => {
  it('reuses the identical IdTokenVerifier type', () => {
    const shared: IdTokenVerifier = async () => ({ uid: 'user-1' });
    const asDiscovery: DiscoveryIdTokenVerifier = shared;
    expect(asDiscovery).toBe(shared);
  });

  it('produces the same verdict as the discovery boundary for every input', async () => {
    const verifier = vi.fn<IdTokenVerifier>(async () => ({ uid: 'user-1' }));
    const rejecting = vi.fn<IdTokenVerifier>(async () => {
      throw new Error('expired');
    });

    const cases: unknown[] = [
      undefined,
      null,
      42,
      '',
      '   ',
      'token-abc',
    ];

    for (const token of cases) {
      const execution = await verifyServerExecutionIdToken(token, verifier);
      const discovery = await verifyServerDiscoveryIdToken(token, verifier);
      expect(execution.ok).toBe(discovery.ok);
      if (!execution.ok && !discovery.ok) {
        expect(execution.problem).toBe(discovery.problem);
      }
    }

    const executionFail = await verifyServerExecutionIdToken('token-abc', rejecting);
    const discoveryFail = await verifyServerDiscoveryIdToken('token-abc', rejecting);
    expect(executionFail).toEqual(discoveryFail);
  });

  it('returns an equivalent principal, not a shared reference', async () => {
    const shared = { uid: 'user-1' };
    const execution = await verifyServerExecutionIdToken('token-abc', async () => shared);
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.principal).toEqual(shared);
    // A new object, so a caller mutating it cannot affect another boundary.
    expect(execution.principal).not.toBe(shared);
  });
});
