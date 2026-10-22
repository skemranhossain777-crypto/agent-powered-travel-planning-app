import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE,
  createGoogleRoutesComputeAdapter,
} from '../services/googleRoutes/googleRoutesAdapter';
import type { GoogleRoutesRouteRequest } from '../services/googleRoutes/googleRoutesMapping';
import { GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING } from '../services/googleRoutes/googleRoutesMapping';
import { isNormalizedRoute } from '../domain/routes/providerRoutes';

const REQUEST: GoogleRoutesRouteRequest = {
  origin: { latitude: 52.3676, longitude: 4.9041 },
  destination: { latitude: 48.8566, longitude: 2.3522 },
  travelMode: 'DRIVE',
};

function routePayload() {
  return {
    routes: [
      { distanceMeters: 223300, duration: '7560s', polyline: { encodedPolyline: 'abcd' } },
    ],
  };
}

describe('STEP 47 Google Routes adapter factory', () => {
  it('is non-operational at the browser default and fails bounded without a key', () => {
    const adapter = createGoogleRoutesComputeAdapter({ attemptEnabled: false, credentials: null });
    expect(adapter.isOperational()).toBe(false);
    expect(adapter.id()).toBe('google-routes');
    expect(adapter.name()).toBe('Google Routes');
    const result = adapter.compute(REQUEST, () => routePayload());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('credentials-missing');
  });

  it('is operational only in the ready gate state', () => {
    const ready = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    expect(ready.isOperational()).toBe(true);
  });

  it('maps a validated request through the payload seam into the neutral contract', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(REQUEST, () => routePayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isNormalizedRoute(result.route)).toBe(true);
      expect(result.route.distanceMeters).toBe(223300);
      expect(result.route.durationSeconds).toBe(7560);
      expect(result.route.origin).toEqual(REQUEST.origin);
      expect(result.route.destination).toEqual(REQUEST.destination);
      expect(result.route.warnings).toBeUndefined();
    }
  });

  it('rejects an invalid request as invalid-input even when ready', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(
      { ...REQUEST, travelMode: 'FLIGHT' as GoogleRoutesRouteRequest['travelMode'] },
      () => routePayload()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('invalid-input');
  });

  it('reports a bounded provider-unavailable when no payload source exists', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(REQUEST, () => null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('provider-unavailable');
      expect(result.error.message).toBe(GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE);
    }
  });

  it('turns a throwing payload source into a bounded provider-unavailable', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(REQUEST, () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('provider-unavailable');
  });

  it('maps a structurally unusable payload to malformed-response', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(REQUEST, () => ({ routes: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('malformed-response');
  });

  it('attaches the Beta warning to WALK and BICYCLE routes', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    for (const mode of ['WALK', 'BICYCLE'] as const) {
      const result = adapter.compute({ ...REQUEST, travelMode: mode }, () => routePayload());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.route.warnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
    }
  });

  it('uses the factory-injected payload provider when compute gets no explicit one', () => {
    const adapter = createGoogleRoutesComputeAdapter(
      { attemptEnabled: true, credentials: { apiKey: 'k' } },
      () => routePayload()
    );
    const result = adapter.compute(
      REQUEST,
      undefined as unknown as (request: GoogleRoutesRouteRequest) => unknown | null
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(isNormalizedRoute(result.route)).toBe(true);
  });

  it('reports a bounded provider-unavailable with no injected provider at all', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'k' },
    });
    const result = adapter.compute(
      REQUEST,
      undefined as unknown as (request: GoogleRoutesRouteRequest) => unknown | null
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('provider-unavailable');
      expect(result.error.message).toBe(GOOGLE_ROUTES_PAYLOAD_SOURCE_ERROR_MESSAGE);
    }
  });

  it('never leaks the API key into a computed result', () => {
    const adapter = createGoogleRoutesComputeAdapter({
      attemptEnabled: true,
      credentials: { apiKey: 'routes-secret-key' },
    });
    const result = adapter.compute(REQUEST, () => routePayload());
    expect(JSON.stringify(result)).not.toContain('routes-secret-key');
  });
});