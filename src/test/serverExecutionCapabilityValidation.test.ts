import { describe, expect, it } from 'vitest';
import {
  validateServerExecutionCapabilityRequest,
  type ServerExecutionCapabilityRequestEnvelope,
} from '../services/serverBoundary/serverExecutionCapabilityValidation';

function check(
  envelope: ServerExecutionCapabilityRequestEnvelope
): ReturnType<typeof validateServerExecutionCapabilityRequest> {
  return validateServerExecutionCapabilityRequest(envelope);
}

describe('serverExecutionCapabilityValidation', () => {
  describe('method handling', () => {
    it('accepts a GET with no body', () => {
      expect(check({ method: 'GET' })).toEqual({ ok: true });
    });

    it('accepts a GET regardless of case or surrounding whitespace', () => {
      for (const method of ['get', 'Get', 'GET', ' get ', 'GET ']) {
        expect(check({ method })).toEqual({ ok: true });
      }
    });

    it('rejects POST', () => {
      expect(check({ method: 'POST' })).toEqual({ ok: false, problem: 'unsupported-method' });
    });

    it('rejects PUT', () => {
      expect(check({ method: 'PUT' })).toEqual({ ok: false, problem: 'unsupported-method' });
    });

    it('rejects DELETE', () => {
      expect(check({ method: 'DELETE' })).toEqual({ ok: false, problem: 'unsupported-method' });
    });

    it('rejects PATCH, HEAD, and OPTIONS', () => {
      for (const method of ['PATCH', 'HEAD', 'OPTIONS']) {
        expect(check({ method })).toEqual({ ok: false, problem: 'unsupported-method' });
      }
    });

    it('rejects a non-string or missing method', () => {
      for (const method of [undefined, null, 42, {}, ['GET'], true]) {
        expect(check({ method })).toEqual({ ok: false, problem: 'unsupported-method' });
      }
    });

    it('rejects a method-lookalike such as GETX or GET /admin', () => {
      for (const method of ['GETX', 'GET /admin', 'getall', 'HEADGET']) {
        expect(check({ method })).toEqual({ ok: false, problem: 'unsupported-method' });
      }
    });

    it('decides the method before the body, so a POST with no body is still 405', () => {
      // Method rejection must not be reachable-by-body: an attacker cannot make a
      // mutating verb acceptable by omitting the body.
      expect(check({ method: 'POST', raw: undefined })).toEqual({
        ok: false,
        problem: 'unsupported-method',
      });
    });
  });

  describe('body handling', () => {
    it('accepts an absent, null, or empty body', () => {
      for (const raw of [undefined, null, '', '   ', {}, []]) {
        expect(check({ method: 'GET', raw })).toEqual({ ok: true });
      }
    });

    it('rejects a non-empty object body', () => {
      expect(check({ method: 'GET', raw: { providerId: 'amadeus-execution' } })).toEqual({
        ok: false,
        problem: 'unexpected-body',
      });
    });

    it('rejects every field a client might try to inject', () => {
      // Each of these is an attempt to steer the server's capability answer. The
      // endpoint accepts no body at all, so none can be honored.
      const attempts: unknown[] = [
        { providerId: 'other-provider' },
        { capabilityId: 'search-transport' },
        { providerId: 'amadeus-execution', capabilityIds: ['search-transport'] },
        { host: 'evil.example.com' },
        { url: 'https://evil.example.com' },
        { method: 'POST' },
        { clientId: 'x' },
        { clientSecret: 'x' },
        { credentials: { clientId: 'x' } },
        { accessToken: 'tok' },
        { apiKey: 'x' },
        { enabled: true },
        { attemptEnabled: true },
      ];
      for (const raw of attempts) {
        expect(check({ method: 'GET', raw })).toEqual({
          ok: false,
          problem: 'unexpected-body',
        });
      }
    });

    it('rejects array, number, and boolean bodies rather than treating them as empty', () => {
      // `false` and `0` are real values, not "absent"; treating them as an empty
      // body would let a crafted request through the no-input rule.
      for (const raw of [['GET'], 0, 1, false, true, NaN, () => undefined]) {
        expect(check({ method: 'GET', raw })).toEqual({ ok: false, problem: 'unexpected-body' });
      }
    });

    it('rejects a body whose only content is whitespace-bearing keys', () => {
      expect(check({ method: 'GET', raw: { '': '' } })).toEqual({
        ok: false,
        problem: 'unexpected-body',
      });
    });
  });

  describe('determinism and safety', () => {
    it('is deterministic: the same envelope always yields the same result', () => {
      const envelope: ServerExecutionCapabilityRequestEnvelope = { method: 'GET' };
      const first = check(envelope);
      for (let i = 0; i < 5; i += 1) {
        expect(check(envelope)).toEqual(first);
      }
    });

    it('does not mutate the envelope it is given', () => {
      const raw = { providerId: 'amadeus-execution' };
      const envelope: ServerExecutionCapabilityRequestEnvelope = { method: 'GET', raw };
      check(envelope);
      expect(raw).toEqual({ providerId: 'amadeus-execution' });
    });

    it('never echoes a submitted value into the problem token', () => {
      const marker = 'attacker-controlled-marker-9f2a';
      const result = check({ method: 'GET', raw: { value: marker } });
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(JSON.stringify(result)).not.toContain('attacker');
    });

    it('reports only the two bounded problems it declares', () => {
      const problems = new Set<string>();
      const envelopes: ServerExecutionCapabilityRequestEnvelope[] = [
        { method: 'POST' },
        { method: 'GET', raw: { a: 1 } },
        { method: 'DELETE', raw: { a: 1 } },
        { method: undefined },
        { method: 'GET', raw: 1 },
      ];
      for (const envelope of envelopes) {
        const result = check(envelope);
        if (!result.ok) problems.add(result.problem);
      }
      expect([...problems].sort()).toEqual(['unexpected-body', 'unsupported-method']);
    });
  });
});
