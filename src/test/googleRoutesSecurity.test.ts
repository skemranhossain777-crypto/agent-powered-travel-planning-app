import { describe, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import {
  GOOGLE_ROUTES_BASE_URL,
  GOOGLE_ROUTES_COMPUTE_ROUTES_PATH,
  GOOGLE_ROUTES_FIELD_MASK,
} from '../services/googleRoutes/googleRoutesConnection';
import {
  DEFAULT_GOOGLE_ROUTES_CONFIG,
  getGoogleRoutesAttemptGate,
} from '../services/googleRoutes/googleRoutesConfig';
import { runGoogleRoutesComputeOnline } from '../services/googleRoutes/googleRoutesService';
import {
  GOOGLE_ROUTES_TRAVEL_MODES,
  readGoogleRoutesDurationSeconds,
} from '../services/googleRoutes/googleRoutesMapping';
import type { GoogleRoutesRouteRequest } from '../services/googleRoutes/googleRoutesMapping';

const GOOGLE_ROUTES_DIR = nodePath.join(process.cwd(), 'src', 'services', 'googleRoutes');
const GOOGLE_ROUTES_FILES = [
  'googleRoutesConfig.ts',
  'googleRoutesMapping.ts',
  'googleRoutesConnection.ts',
  'googleRoutesAdapter.ts',
  'googleRoutesService.ts',
  'googleRoutesPlanningAdapter.ts',
];

function readGoogleRoutesSources(): string[] {
  return GOOGLE_ROUTES_FILES.map((file) =>
    nodeFs.readFileSync(nodePath.join(GOOGLE_ROUTES_DIR, file), 'utf8')
  );
}

function readGoogleRoutesCode(): string[] {
  return readGoogleRoutesSources().map((raw) =>
    raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  );
}

describe('STEP 47 Google Routes provider is read-only and additive', () => {
  it('keeps exactly six cohesive modules in the googleRoutes scope (STEP 48 adds the planning adapter)', () => {
    const entries = nodeFs
      .readdirSync(GOOGLE_ROUTES_DIR)
      .filter((name) => name.endsWith('.ts'));
    expect(entries.sort()).toEqual([...GOOGLE_ROUTES_FILES].sort());
  });

  it('never performs a live network call anywhere in the googleRoutes source', () => {
    for (const source of readGoogleRoutesCode()) {
      expect(source).not.toMatch(/(^|[^A-Za-z_$])fetch\(/);
    }
  });

  it('never reads a client or runtime environment (no VITE_, process.env, import.meta.env)', () => {
    for (const source of readGoogleRoutesCode()) {
      expect(source).not.toContain('VITE_');
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('import.meta.env');
    }
  });

  it('never reads a clock inside the provider (timestamps are injected)', () => {
    for (const source of readGoogleRoutesCode()) {
      expect(source).not.toContain('Date.now');
      expect(source).not.toContain('new Date()');
    }
  });

  it('never imports the UI stack (React, Firebase, Router, Zustand) into the provider', () => {
    for (const source of readGoogleRoutesSources()) {
      expect(source).not.toContain("from 'react'");
      expect(source).not.toContain("from 'firebase");
      expect(source).not.toContain("from 'zustand'");
      expect(source).not.toContain('react-router');
      expect(source).not.toContain('@tanstack');
    }
  });

  it('uses only the fixed read-only POST computeRoutes endpoint with a fixed mask', () => {
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_ROUTES_DIR, 'googleRoutesConnection.ts'),
      'utf8'
    );
    expect(connectionSource).toContain(GOOGLE_ROUTES_BASE_URL);
    expect(connectionSource).toContain(GOOGLE_ROUTES_COMPUTE_ROUTES_PATH);
    expect(connectionSource).toContain("method: 'POST'");
    expect(connectionSource).toContain('x-goog-fieldmask');
    expect(connectionSource).toContain(GOOGLE_ROUTES_FIELD_MASK);
    // The mask is a fixed application-owned list of needed fields, never `*`.
    expect(GOOGLE_ROUTES_FIELD_MASK).not.toBe('*');
    expect(GOOGLE_ROUTES_FIELD_MASK).toContain('routes.duration');
    expect(GOOGLE_ROUTES_FIELD_MASK).toContain('routes.distanceMeters');
  });

  it('never accepts an arbitrary endpoint, method, or field mask from a client', () => {
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_ROUTES_DIR, 'googleRoutesConnection.ts'),
      'utf8'
    );
    // The URL is assembled only from the fixed base host + fixed computeRoutes
    // path constants, and the request builder takes no client target argument.
    expect(connectionSource).toContain(
      'url: `${GOOGLE_ROUTES_BASE_URL}${GOOGLE_ROUTES_COMPUTE_ROUTES_PATH}`'
    );
    expect(connectionSource).not.toContain('buildGoogleRoutesComputeRoutesRequest(config, value');
    expect(connectionSource).not.toContain('targetUrl');
    expect(connectionSource).not.toMatch(/method:\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)/);
    expect(connectionSource).not.toMatch(/fieldmask\s*[:=]\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)/);
  });

  it('contains no Route Matrix or batch-routing surface (computeRoutes only)', () => {
    for (const source of readGoogleRoutesSources()) {
      expect(source).not.toContain(':computeRouteMatrix');
      expect(source).not.toContain('ComputeRouteMatrix');
      expect(source).not.toContain('computeRouteMatrix');
    }
  });

  it('the API key travels only as an injected header and never appears in outcomes or metadata', () => {
    const configSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_ROUTES_DIR, 'googleRoutesConfig.ts'),
      'utf8'
    );
    expect(configSource).not.toContain("= 'AIza");
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_ROUTES_DIR, 'googleRoutesConnection.ts'),
      'utf8'
    );
    expect(connectionSource).toContain("'x-goog-api-key': apiKey");
    expect(connectionSource).not.toContain('GOOGLE_ROUTES_PROVIDER_NAME');
  });

  it('it never mutates, books, pays, or persists - compute is read-only', () => {
    for (const source of readGoogleRoutesSources()) {
      expect(source).not.toContain('submit-booking');
      expect(source).not.toContain('prepare-booking');
      expect(source).not.toContain('cancel-booking');
      expect(source).not.toContain('DELETE');
      expect(source).not.toContain('updateTripPlanning');
      expect(source).not.toContain('setDoc|addDoc|updateDoc|deleteDoc|runTransaction');
      expect(source).not.toMatch(/from\s+['"].*tripService['"]/);
      expect(source).not.toMatch(/from\s+['"].*firestoreService['"]/);
      expect(source).not.toMatch(/from\s+['"].*dataConnectService['"]/);
    }
  });
});

describe('STEP 47 default-off and secret-free runtime behavior', () => {
  it('a browser build with no env and no keys stays fully disabled (independent of Places)', () => {
    expect(DEFAULT_GOOGLE_ROUTES_CONFIG).toEqual({ attemptEnabled: false, credentials: null });
    expect(getGoogleRoutesAttemptGate(DEFAULT_GOOGLE_ROUTES_CONFIG)).toBe('disabled');
  });

  it('a default runtime attempt reports not-configured and never leaks a key', () => {
    const request: GoogleRoutesRouteRequest = {
      origin: { latitude: 52.3676, longitude: 4.9041 },
      destination: { latitude: 48.8566, longitude: 2.3522 },
      travelMode: 'DRIVE',
    };
    const outcome = runGoogleRoutesComputeOnline(
      { attemptEnabled: false, credentials: null },
      request,
      '2026-09-23T08:00:00.000Z',
      () => ({ routes: [] })
    );
    expect(outcome.status).toBe('not-configured');
    expect(JSON.stringify(outcome)).not.toContain('AIza');
    expect(outcome.error?.category).toBe('provider-unavailable');
  });

  it('travel modes and duration parsing are a fixed, closed vocabulary', () => {
    expect(GOOGLE_ROUTES_TRAVEL_MODES.length).toBe(4);
    expect(readGoogleRoutesDurationSeconds('123s')).toBe(123);
    expect(readGoogleRoutesDurationSeconds('not-a-duration')).toBeNull();
  });
});