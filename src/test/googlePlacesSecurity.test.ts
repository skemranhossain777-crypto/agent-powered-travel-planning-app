import { describe, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import {
  DEFAULT_GOOGLE_PLACES_CONFIG,
  GOOGLE_PLACES_PROVIDER_ID,
  getGooglePlacesAttemptGate,
} from '../services/googleDiscovery/googlePlacesConfig';
import {
  GOOGLE_PLACES_BASE_URL,
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_NEARBY_SEARCH_PATH,
  GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK,
  GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX,
  GOOGLE_PLACES_RANK_PREFERENCE,
} from '../services/googleDiscovery/googlePlacesConnection';
import {
  GOOGLE_PLACES_CATEGORY_INCLUDED_TYPES,
  GOOGLE_PLACES_PLACE_ID_MAX_LENGTH,
} from '../services/googleDiscovery/googlePlacesMapping';
import {
  runGooglePlacesDiscoveryOnline,
  runGooglePlacesPlaceDetailsOnline,
} from '../services/googleDiscovery/googlePlacesService';

const GOOGLE_DISCOVERY_DIR = nodePath.join(process.cwd(), 'src', 'services', 'googleDiscovery');
const GOOGLE_DISCOVERY_FILES = [
  'googlePlacesConfig.ts',
  'googlePlacesMapping.ts',
  'googlePlacesConnection.ts',
  'googlePlacesAdapter.ts',
  'googlePlacesService.ts',
  'googlePlacesPlanningAdapter.ts',
];

function readGoogleDiscoverySources(): string[] {
  return GOOGLE_DISCOVERY_FILES.map((file) =>
    nodeFs.readFileSync(nodePath.join(GOOGLE_DISCOVERY_DIR, file), 'utf8')
  );
}

function readGoogleDiscoveryCode(): string[] {
  return readGoogleDiscoverySources().map((raw) =>
    raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  );
}

describe('STEP 44 Google Places provider is read-only and additive', () => {
  it('keeps exactly six cohesive modules in the googleDiscovery scope', () => {
    const entries = nodeFs
      .readdirSync(GOOGLE_DISCOVERY_DIR)
      .filter((name) => name.endsWith('.ts'));
    expect(entries.sort()).toEqual([...GOOGLE_DISCOVERY_FILES].sort());
  });

  it('never performs a live network call anywhere in the googleDiscovery source', () => {
    for (const source of readGoogleDiscoveryCode()) {
      expect(source).not.toMatch(/(^|[^A-Za-z_$])fetch\(/);
    }
  });

  it('never reads a client or runtime environment (no VITE_, process.env, import.meta.env)', () => {
    for (const source of readGoogleDiscoveryCode()) {
      expect(source).not.toContain('VITE_');
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('import.meta.env');
    }
  });

  it('never reads a clock inside the provider (timestamps are injected)', () => {
    for (const source of readGoogleDiscoveryCode()) {
      expect(source).not.toContain('Date.now');
      expect(source).not.toContain('new Date()');
    }
  });

  it('never imports the UI stack (React, Firebase, Router, Zustand) into the provider', () => {
    for (const source of readGoogleDiscoverySources()) {
      expect(source).not.toContain("from 'react'");
      expect(source).not.toContain("from 'firebase");
      expect(source).not.toContain("from 'zustand'");
      expect(source).not.toContain('react-router');
      expect(source).not.toContain('@tanstack');
    }
  });

  it('uses only the fixed read-only POST Nearby Search endpoint with a fixed mask and ranking', () => {
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConnection.ts'),
      'utf8'
    );
    expect(connectionSource).toContain(GOOGLE_PLACES_BASE_URL);
    expect(connectionSource).toContain(GOOGLE_PLACES_NEARBY_SEARCH_PATH);
    expect(connectionSource).toContain("method: 'POST'");
    expect(connectionSource).toContain('x-goog-fieldmask');
    expect(connectionSource).toContain(GOOGLE_PLACES_FIELD_MASK);
    expect(connectionSource).toContain('rankPreference');
    expect(connectionSource).toContain(GOOGLE_PLACES_RANK_PREFERENCE);
  });

  it('the API key travels only as an injected header and never appears in outcomes or metadata', () => {
    const configSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConfig.ts'),
      'utf8'
    );
    expect(configSource).not.toContain('= \'AIza');
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConnection.ts'),
      'utf8'
    );
    expect(connectionSource).toContain("'x-goog-api-key': apiKey");
    expect(connectionSource).not.toContain('GOOGLE_PLACES_PROVIDER_NAME');
  });

  it('it never mutates, books, or pays - the operation kind covers only discovery reads', () => {
    for (const source of readGoogleDiscoverySources()) {
      expect(source).not.toContain('submit-booking');
      expect(source).not.toContain('prepare-booking');
      expect(source).not.toContain('cancel-booking');
      expect(source).not.toContain('DELETE');
    }
  });
});

describe('STEP 44 default-off and secret-free runtime behavior', () => {
  it('a browser build with no env and no keys stays fully disabled', () => {
    expect(DEFAULT_GOOGLE_PLACES_CONFIG).toEqual({ attemptEnabled: false, credentials: null });
    expect(getGooglePlacesAttemptGate(DEFAULT_GOOGLE_PLACES_CONFIG)).toBe('disabled');
  });

  it('a default runtime attempt reports not-configured and never leaks a key', () => {
    const outcome = runGooglePlacesDiscoveryOnline(
      { attemptEnabled: false, credentials: null },
      {
        latitude: 52.3676,
        longitude: 4.9041,
        radiusMeters: 5000,
        category: 'hotels',
        resultLimit: 5,
      },
      '2026-09-13T08:00:00.000Z',
      () => ({ places: [] })
    );
    expect(outcome.status).toBe('not-configured');
    expect(JSON.stringify(outcome)).not.toContain('AIza');
    expect(outcome.error?.category).toBe('provider-unavailable');
  });

  it('the app-category to includedTypes table is a fixed, closed vocabulary', () => {
    const allTypes = Object.values(GOOGLE_PLACES_CATEGORY_INCLUDED_TYPES).flat();
    expect(allTypes.length).toBeGreaterThan(0);
    expect(allTypes.every((type) => typeof type === 'string' && type.length > 0)).toBe(true);
    const anyRandomPlace = `xx-${GOOGLE_PLACES_PROVIDER_ID}-type`;
    expect(allTypes).not.toContain(anyRandomPlace);
  });
});

describe('STEP 45 Place Details is read-only, fixed-shape, and additive', () => {
  it('the details request uses a fixed GET endpoint, fixed field mask, and URL-escaping only', () => {
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConnection.ts'),
      'utf8'
    );
    expect(connectionSource).toContain(GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX);
    expect(connectionSource).toContain(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK);
    expect(connectionSource).toContain("method: 'GET'");
    expect(connectionSource).toContain('encodeURIComponent');
    expect(connectionSource).not.toContain("method: 'DELETE'");
    expect(connectionSource).not.toContain('allowedMethods');
  });

  it('place ids are validated to a fixed bounded contract that no request can bypass', () => {
    const mappingSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesMapping.ts'),
      'utf8'
    );
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConnection.ts'),
      'utf8'
    );
    expect(mappingSource).toContain(`export const GOOGLE_PLACES_PLACE_ID_MAX_LENGTH = ${GOOGLE_PLACES_PLACE_ID_MAX_LENGTH};`);
    expect(mappingSource).toContain('normalizeGooglePlacesPlaceId');
    expect(connectionSource).toContain('normalizeGooglePlacesPlaceId');
    expect(mappingSource).not.toContain('normalizeGooglePlacesPlaceId = identity');
  });

  it('the details operation stays inside the fixed field-mask and fixed-query contract', () => {
    const connectionSource = nodeFs.readFileSync(
      nodePath.join(GOOGLE_DISCOVERY_DIR, 'googlePlacesConnection.ts'),
      'utf8'
    );
    const maskFields = GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK.split(',');
    expect(maskFields.length).toBeGreaterThanOrEqual(12);
    expect(maskFields.every((field) => field.trim().length > 0)).toBe(true);
    expect(connectionSource).toContain(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK);
  });

  it('a default runtime details attempt reports not-configured and never leaks a key', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(
      { attemptEnabled: false, credentials: null },
      'ChIJj61dQgK6j4AR4GeTYWZsKWw',
      '2026-09-13T08:00:00.000Z',
      () => ({ id: 'ChIJj61dQgK6j4AR4GeTYWZsKWw', displayName: { text: 'Rijksmuseum' } })
    );
    expect(outcome.status).toBe('not-configured');
    expect(outcome.detail).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain('AIza');
    expect(outcome.error?.category).toBe('provider-unavailable');
  });
});