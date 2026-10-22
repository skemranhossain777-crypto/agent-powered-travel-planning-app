import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ROUTES_PROVIDER_ID,
  GOOGLE_ROUTES_PROVIDER_NAME,
  buildGoogleRoutesNotPreparedOutcome,
  googleRoutesNotConfiguredOutcome,
  runGoogleRoutesComputeOnline,
} from '../services/googleRoutes/googleRoutesService';
import type { GoogleRoutesRouteRequest } from '../services/googleRoutes/googleRoutesMapping';
import { GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING } from '../services/googleRoutes/googleRoutesMapping';
import type { GoogleRoutesConfig } from '../services/googleRoutes/googleRoutesConfig';

const REQUEST: GoogleRoutesRouteRequest = {
  origin: { latitude: 52.3676, longitude: 4.9041 },
  destination: { latitude: 48.8566, longitude: 2.3522 },
  travelMode: 'DRIVE',
};

const NOW = '2026-09-23T08:00:00.000Z';

const READY: GoogleRoutesConfig = {
  attemptEnabled: true,
  credentials: { apiKey: 'routes-secret-key' },
};

function routePayload() {
  return {
    routes: [
      { distanceMeters: 223300, duration: '7560s', polyline: { encodedPolyline: 'abcd' } },
    ],
  };
}

describe('STEP 47 Google Routes compute service outcome', () => {
  it('reports not-configured and never leaks a key when disabled by default', () => {
    const outcome = runGoogleRoutesComputeOnline(
      { attemptEnabled: false, credentials: null },
      REQUEST,
      NOW,
      () => routePayload()
    );
    expect(outcome.status).toBe('not-configured');
    expect(outcome.route).toBeNull();
    expect(outcome.providerId).toBe(GOOGLE_ROUTES_PROVIDER_ID);
    expect(outcome.providerName).toBe(GOOGLE_ROUTES_PROVIDER_NAME);
    expect(outcome.error?.category).toBe('provider-unavailable');
    expect(outcome.createdAt).toBe(NOW);
    expect(JSON.stringify(outcome)).not.toContain('routes-secret-key');
    expect(JSON.stringify(outcome)).not.toContain('AIza');
  });

  it('reports not-configured with a credentials-missing safe error on a missing key', () => {
    const outcome = runGoogleRoutesComputeOnline(
      { attemptEnabled: true, credentials: null },
      REQUEST,
      NOW,
      () => routePayload()
    );
    expect(outcome.status).toBe('not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
  });

  it('reports invalid-input for an unsafe request before any payload access', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      { ...REQUEST, travelMode: 'FLIGHT' as GoogleRoutesRouteRequest['travelMode'] },
      NOW,
      () => routePayload()
    );
    expect(outcome.status).toBe('invalid-input');
    expect(outcome.error?.category).toBe('invalid-input');
  });

  it('returns the normalized route on a successful deterministic compute', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, REQUEST, NOW, () => routePayload());
    expect(outcome.status).toBe('success');
    expect(outcome.route).not.toBeNull();
    expect(outcome.route?.distanceMeters).toBe(223300);
    expect(outcome.route?.durationSeconds).toBe(7560);
    expect(outcome.route?.origin).toEqual(REQUEST.origin);
    expect(outcome.request).toEqual(REQUEST);
    expect(outcome.error).toBeNull();
    expect(outcome.createdAt).toBe(NOW);
    expect(outcome.limitations).toHaveLength(1);
  });

  it('maps a malformed provider result to a bounded provider-failure', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, REQUEST, NOW, () => ({ routes: [] }));
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
  });

  it('maps a missing payload source to a bounded provider-failure', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, REQUEST, NOW, () => null);
    expect(outcome.status).toBe('provider-failure');
    expect(outcome.error?.category).toBe('provider-unavailable');
  });

  it('carries the Beta warning for WALK routes into the outcome', () => {
    const outcome = runGoogleRoutesComputeOnline(
      READY,
      { ...REQUEST, travelMode: 'WALK' },
      NOW,
      () => routePayload()
    );
    expect(outcome.status).toBe('success');
    expect(outcome.warnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
    expect(outcome.route?.warnings).toContain(GOOGLE_ROUTES_BETA_ACTIVE_MODE_WARNING);
  });

  it('never surfaces raw provider fields or the key through an outcome', () => {
    const outcome = runGoogleRoutesComputeOnline(READY, REQUEST, NOW, () =>
      routePayload()
    );
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('routes-secret-key');
    expect(serialized).not.toContain('AIza');
  });

  it('not-prepared and not-configured helpers produce bounded outcomes', () => {
    const notPrepared = buildGoogleRoutesNotPreparedOutcome(REQUEST, NOW);
    expect(notPrepared.status).toBe('not-configured');
    expect(notPrepared.error?.category).toBe('credentials-missing');

    const notConfigured = googleRoutesNotConfiguredOutcome(REQUEST, NOW);
    expect(notConfigured.status).toBe('not-configured');
    expect(notConfigured.error?.category).toBe('provider-unavailable');
  });
});