import { describe, expect, it } from 'vitest';
import {
  GOOGLE_PLACES_PLACE_ID_MAX_LENGTH,
  getGooglePlacesPlaceIdProblem,
  isValidGooglePlacesPlaceId,
  normalizeGooglePlacesPlaceDetail,
  normalizeGooglePlacesPlaceId,
} from '../services/googleDiscovery/googlePlacesMapping';
import {
  GOOGLE_PLACES_BASE_URL,
  GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK,
  GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX,
  buildGooglePlacesPlaceDetailsRequest,
  runGooglePlacesPlaceDetails,
  type GooglePlacesTransport,
} from '../services/googleDiscovery/googlePlacesConnection';
import {
  GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE,
  createGooglePlacesDiscoveryAdapter,
  type GooglePlacesPayloadProvider,
  type GooglePlacesPlaceDetailPayloadProvider,
} from '../services/googleDiscovery/googlePlacesAdapter';
import {
  GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE,
  GOOGLE_PLACES_PROVIDER_ID,
  GOOGLE_PLACES_PROVIDER_NAME,
} from '../services/googleDiscovery/googlePlacesConfig';
import {
  hasGooglePlacesPlaceDetail,
  isGooglePlacesPlaceDetailAvailable,
  runGooglePlacesPlaceDetailsOnline,
  type GooglePlacesPlaceDetailOutcome,
} from '../services/googleDiscovery/googlePlacesService';

const NOW = '2026-09-13T08:00:00.000Z';

const VALID_PLACE_ID = 'ChIJj61dQgK6j4AR4GeTYWZsKWw';

const FULL_PAYLOAD = {
  id: VALID_PLACE_ID,
  displayName: { text: 'Rijksmuseum', languageCode: 'en' },
  formattedAddress: 'Museumstraat 1, 1071 XX Amsterdam, Netherlands',
  location: { latitude: 52.36, longitude: 4.885 },
  primaryType: 'museum',
  types: ['museum', 'tourist_attraction', 'point_of_interest', 'establishment'],
  rating: 4.7,
  userRatingCount: 80378,
  regularOpeningHours: { openNow: true, weekdayDescriptions: ['Monday: 9:00 AM - 5:00 PM'] },
  currentOpeningHours: { openNow: true, weekdayDescriptions: ['Monday: 9:00 AM - 5:00 PM'] },
  websiteUri: 'https://www.rijksmuseum.nl',
  internationalPhoneNumber: '+31 20 674 7000',
  googleMapsUri: 'https://maps.google.com/?cid=1234',
  editorialSummary: { text: 'Dutch national museum.', languageCode: 'en' },
  photos: [{ name: `places/${VALID_PLACE_ID}/photos/AAA1`, widthPx: 1600, heightPx: 1200 }],
  rawMarkerFreeform: 'should-never-leak',
};

const READY_CONFIG = {
  attemptEnabled: true,
  credentials: { apiKey: 'secret-key' },
};

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(FULL_PAYLOAD)) as Record<string, unknown>;
}

function expectBoundAuthor(
  outcome: GooglePlacesPlaceDetailOutcome,
  status: GooglePlacesPlaceDetailOutcome['status']
) {
  expect(outcome.status).toBe(status);
  expect(outcome.providerId).toBe(GOOGLE_PLACES_PROVIDER_ID);
  expect(outcome.providerName).toBe(GOOGLE_PLACES_PROVIDER_NAME);
  expect(outcome.createdAt).toBe(NOW);
  expect(outcome.limitations.length).toBeGreaterThan(0);
}

describe('STEP 45 Place Details normalization (application-owned object)', () => {
  it('scenario 1: a valid place detail produces a normalized application-owned object', () => {
    const detail = normalizeGooglePlacesPlaceDetail(fixture(), NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.placeId).toBe(VALID_PLACE_ID);
    expect(detail.displayName).toBe('Rijksmuseum');
    expect(detail.formattedAddress).toBe('Museumstraat 1, 1071 XX Amsterdam, Netherlands');
    expect(detail.location).toEqual({ latitude: 52.36, longitude: 4.885 });
    expect(detail.primaryType).toBe('museum');
    expect(detail.types).toContain('museum');
    expect(detail.rating).toBe(4.7);
    expect(detail.userRatingCount).toBe(80378);
    expect(detail.regularOpeningHours?.openNow).toBe(true);
    expect(detail.currentOpeningHours?.weekdayDescriptions?.length).toBeGreaterThan(0);
    expect(detail.websiteUri).toBe('https://www.rijksmuseum.nl');
    expect(detail.phone).toBe('+31 20 674 7000');
    expect(detail.googleMapsUri).toBe('https://maps.google.com/?cid=1234');
    expect(detail.editorialSummary).toBe('Dutch national museum.');
    expect(detail.photos).toEqual([
      { name: `places/${VALID_PLACE_ID}/photos/AAA1`, widthPx: 1600, heightPx: 1200 },
    ]);
    expect(detail.retrievedAt).toBe(NOW);
    expect(detail.expiresAt.localeCompare(NOW)).toBeGreaterThan(0);
  });

  it('scenario 2: missing optional fields are omitted, not fabricated', () => {
    const payload = { id: VALID_PLACE_ID, displayName: { text: 'Minimal Place' } } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    const json = JSON.stringify(detail);
    expect(detail.formattedAddress).toBeUndefined();
    expect(detail.location).toBeUndefined();
    expect(detail.rating).toBeUndefined();
    expect(detail.userRatingCount).toBeUndefined();
    expect(detail.websiteUri).toBeUndefined();
    expect(detail.googleMapsUri).toBeUndefined();
    expect(detail.phone).toBeUndefined();
    expect(detail.editorialSummary).toBeUndefined();
    expect(detail.photos).toBeUndefined();
    expect(json).not.toContain('photos');
    expect(json).not.toContain('addressComponents');
    expect(json).not.toContain('priceLevel');
  });

  it('scenario 3: opening-hours data is normalized (openNow + weekday descriptions)', () => {
    const payload = {
      id: VALID_PLACE_ID,
      displayName: { text: 'Hours Place' },
      regularOpeningHours: { openNow: false, weekdayDescriptions: ['Sunday: Closed'] },
      currentOpeningHours: weekdayGovernedHours(),
    } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.regularOpeningHours?.openNow).toBe(false);
    expect(detail.regularOpeningHours?.weekdayDescriptions).toEqual(['Sunday: Closed']);
    expect(detail.currentOpeningHours?.openNow).toBe(true);
    expect(detail.currentOpeningHours?.weekdayDescriptions).toEqual(['Monday: 8:00 AM - 8:00 PM']);
  });

  it('scenario 4: photo metadata is kept only as bounded provider references (never image URLs)', () => {
    const payload = fixture();
    payload['photos'] = [
      { name: `places/${VALID_PLACE_ID}/photos/AAA2`, widthPx: 800, heightPx: 600 },
      'not-an-object',
      { widthPx: 100, heightPx: 100 },
      { name: '', widthPx: 10 },
      { name: `places/${VALID_PLACE_ID}/photos/AAA3`, widthPx: -5 },
    ];
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.photos).toEqual([
      { name: `places/${VALID_PLACE_ID}/photos/AAA2`, widthPx: 800, heightPx: 600 },
      { name: `places/${VALID_PLACE_ID}/photos/AAA3` },
    ]);
    const json = JSON.stringify(detail.photos);
    expect(json).toBeDefined();
    expect(json).not.toContain('https://');
    expect(JSON.stringify(detail)).not.toContain('not-an-object');
  });

  it('scenario 5: editorial/description text is preserved when present and bounded', () => {
    const payload = {
      id: VALID_PLACE_ID,
      displayName: { text: 'Described Place' },
      editorialSummary: { text: 'A bounded descriptive summary published by Google.', languageCode: 'en' },
    } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail?.editorialSummary).toBe('A bounded descriptive summary published by Google.');
  });

  it('scenario 6: website and maps URIs pass through the shared URL-safety contract (http allowed too)', () => {
    const payload = {
      id: VALID_PLACE_ID,
      displayName: { text: 'Uris Place' },
      websiteUri: 'http://plain.example/place',
      googleMapsUri: 'https://maps.example/place/123',
    } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.websiteUri).toBe('http://plain.example/place');
    expect(detail.googleMapsUri).toBe('https://maps.example/place/123');
  });

  it('scenario 6b: unsafe or irregular URLs are dropped entirely', () => {
    const payload = {
      id: VALID_PLACE_ID,
      displayName: { text: 'Unsafe Uris Place' },
      websiteUri: 'javascript:alert(1)',
      googleMapsUri: 'https://evil.example/space path',
    } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.websiteUri).toBeUndefined();
    expect(detail.googleMapsUri).toBeUndefined();
  });

  it('scenario 7: rating, rating-count, and location data is kept only when trustworthy', () => {
    const payload = {
      id: VALID_PLACE_ID,
      displayName: { text: 'Trustworthy Data Place' },
      rating: 6.5,
      userRatingCount: -3,
      location: { latitude: 999, longitude: 4.885 },
    } as Record<string, unknown>;
    const detail = normalizeGooglePlacesPlaceDetail(payload, NOW);
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.rating).toBeUndefined();
    expect(detail.userRatingCount).toBeUndefined();
    expect(detail.location).toBeUndefined();
  });

  it('scenario 8: a malformed provider response is rejected (no id or no display name)', () => {
    const missingId = { displayName: { text: 'No Id' } } as Record<string, unknown>;
    const blankId = { id: '   ', displayName: { text: 'Blank Id' } } as Record<string, unknown>;
    const missingName = { id: VALID_PLACE_ID, displayName: { text: '   ' } } as Record<string, unknown>;
    const nonObject = ['not', 'an', 'object'];
    expect(normalizeGooglePlacesPlaceDetail(missingId, NOW)).toBeNull();
    expect(normalizeGooglePlacesPlaceDetail(blankId, NOW)).toBeNull();
    expect(normalizeGooglePlacesPlaceDetail(missingName, NOW)).toBeNull();
    expect(normalizeGooglePlacesPlaceDetail(nonObject, NOW)).toBeNull();
  });
});

function weekdayGovernedHours() {
  return { openNow: true, weekdayDescriptions: ['Monday: 8:00 AM - 8:00 PM'] };
}

describe('STEP 45 Place ID validation (bounded, never over-constrained)', () => {
  it('scenario 9: a bounded valid place id parses and is trimmed for the request', () => {
    expect(isValidGooglePlacesPlaceId(VALID_PLACE_ID)).toBe(true);
    expect(normalizeGooglePlacesPlaceId(`  ${VALID_PLACE_ID}  `)).toBe(VALID_PLACE_ID);
    expect(getGooglePlacesPlaceIdProblem(VALID_PLACE_ID)).toBeNull();
  });

  it('scenario 9b: non-string values are rejected with a bounded problem', () => {
    expect(getGooglePlacesPlaceIdProblem(12345)?.code).toBe('not-a-string');
    expect(getGooglePlacesPlaceIdProblem(null)?.code).toBe('not-a-string');
    expect(normalizeGooglePlacesPlaceId(undefined)).toBeNull();
  });

  it('scenario 10: an empty place id is rejected', () => {
    expect(getGooglePlacesPlaceIdProblem('')?.code).toBe('empty');
    expect(getGooglePlacesPlaceIdProblem('   ')?.code).toBe('empty');
  });

  it('scenario 11: an oversized place id is rejected (bounded length)', () => {
    const oversized = 'a'.repeat(GOOGLE_PLACES_PLACE_ID_MAX_LENGTH + 1);
    expect(getGooglePlacesPlaceIdProblem(oversized)?.code).toBe('too-long');
    expect(normalizeGooglePlacesPlaceId(oversized)).toBeNull();
    expect(getGooglePlacesPlaceIdProblem('a'.repeat(GOOGLE_PLACES_PLACE_ID_MAX_LENGTH))).toBeNull();
  });

  it('scenario 12: path-like, control-character, whitespace, and unicode place ids are rejected', () => {
    expect(getGooglePlacesPlaceIdProblem('places/ChIJfoo')?.code).toBe('path-like');
    expect(getGooglePlacesPlaceIdProblem('..\\etc')?.code).toBe('path-like');
    expect(getGooglePlacesPlaceIdProblem('ChIJ..foo')?.code).toBe('path-like');
    expect(getGooglePlacesPlaceIdProblem('ChIJ foo')?.code).toBe('invalid-character');
    expect(getGooglePlacesPlaceIdProblem('ChIJ\u0000foo')?.code).toBe('invalid-character');
    expect(getGooglePlacesPlaceIdProblem('ChIJ\u00e9toile')?.code).toBe('invalid-character');
  });
});

describe('STEP 45 Place Details connection seam (fixed endpoint, method, field mask)', () => {
  it('scenario 21a: the request is exactly the fixed GET endpoint with a URL-escaped id', () => {
    const request = buildGooglePlacesPlaceDetailsRequest(READY_CONFIG, VALID_PLACE_ID);
    expect(request).not.toBeNull();
    if (request === null) return;
    expect(request.method).toBe('GET');
    expect(request.url).toBe(
      `${GOOGLE_PLACES_BASE_URL}${GOOGLE_PLACES_PLACE_DETAILS_PATH_PREFIX}${encodeURIComponent(VALID_PLACE_ID)}`
    );
    expect(request.headers['x-goog-fieldmask']).toBe(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK);
    expect(request.headers['x-goog-api-key']).toBe('secret-key');
    expect(request.body).toBeUndefined();
    expect(request.url).not.toContain('secret-key');
    expect(request.url).not.toContain('/v1/places:searchNearby');
  });

  it('scenario 21b: the field mask is the fixed constant and can never be caller-supplied', () => {
    expect(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK).toContain('regularOpeningHours');
    expect(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK).toContain('photos');
    expect(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK).not.toContain('searchNearby');
    const request = buildGooglePlacesPlaceDetailsRequest(READY_CONFIG, VALID_PLACE_ID);
    expect(request).not.toBeNull();
    if (request === null) return;
    expect(request.headers['x-goog-fieldmask']).toBe(GOOGLE_PLACES_PLACE_DETAILS_FIELD_MASK);
    expect(request.headers).not.toHaveProperty('x-goog-fieldmask-details');
  });

  it('scenario 21c: a client cannot choose the endpoint, URL, method, or mask', () => {
    const arbitrary = buildGooglePlacesPlaceDetailsRequest(READY_CONFIG, 'https://evil.example/x');
    expect(arbitrary).toBeNull();
    const traversal = buildGooglePlacesPlaceDetailsRequest(READY_CONFIG, '../../etc/passwd');
    expect(traversal).toBeNull();
  });

  it('scenario 17a: the request is null when credentials are missing', () => {
    expect(buildGooglePlacesPlaceDetailsRequest({ attemptEnabled: true, credentials: null }, VALID_PLACE_ID)).toBeNull();
  });

  it('scenario 16a: a network failure maps to network-error', async () => {
    const transport: GooglePlacesTransport = async () => {
      throw new Error('boom');
    };
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, transport, VALID_PLACE_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('network-error');
  });

  it('scenario 13: provider HTTP 400 maps to provider-rejected', async () => {
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, fakeTransport(400, {}), VALID_PLACE_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('provider-rejected');
  });

  it('scenario 14: provider HTTP 429 maps to rate-limited', async () => {
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, fakeTransport(429, {}), VALID_PLACE_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('rate-limited');
  });

  it('scenario 15: provider 404 maps to provider-unavailable (never a raw 404 message)', async () => {
    const result = await runGooglePlacesPlaceDetails(
      READY_CONFIG,
      fakeTransport(404, { code: 404, message: 'Place not found' }),
      VALID_PLACE_ID
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('provider-unavailable');
    expect(JSON.stringify(result)).not.toContain('Place not found');
  });

  it('scenario 17b: enabled-but-keyless yields a bounded credentials-missing run', async () => {
    const result = await runGooglePlacesPlaceDetails(
      { attemptEnabled: true, credentials: null },
      fakeTransport(200, {}),
      VALID_PLACE_ID
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('credentials-missing');
  });

  it('scenario 10b: an invalid place id yields invalid-input at the connection run', async () => {
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, fakeTransport(200, {}), '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('invalid-input');
  });

  it('scenario 13b: a 200 response with an unreadable body is a malformed-response', async () => {
    const transport: GooglePlacesTransport = async () => ({
      status: 200,
      json: async () => {
        throw new Error('json parse failed');
      },
    });
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, transport, VALID_PLACE_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.category).toBe('malformed-response');
  });

  it('scenario 1b: a 200 detail body is returned as the raw payload for mapping', async () => {
    const result = await runGooglePlacesPlaceDetails(READY_CONFIG, fakeTransport(200, fixture()), VALID_PLACE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload as Record<string, unknown>).id).toBe(VALID_PLACE_ID);
  });
});

function fakeTransport(status: number, body: unknown): GooglePlacesTransport {
  return async () => ({ status, json: () => Promise.resolve(body) });
}

describe('STEP 45 Place Details adapter (bounded envelopes only)', () => {
  it('scenario 17c: a non-ready adapter reports a bounded credentials-missing envelope', () => {
    const adapter = createGooglePlacesDiscoveryAdapter({ attemptEnabled: false, credentials: null });
    const envelope = adapter.details(VALID_PLACE_ID, NOW, () => fixture());
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('failure');
    expect(envelope.error?.category).toBe('credentials-missing');
    expect(JSON.stringify(envelope)).not.toContain('secret-key');
  });

  it('scenario 18: a ready adapter with a payload provider succeeds and never leaks raw data', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const envelope = adapter.details(VALID_PLACE_ID, NOW, () => fixture());
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('success');
    expect(envelope.data?.placeId).toBe(VALID_PLACE_ID);
    expect(envelope.data?.displayName).toBe('Rijksmuseum');
    expect(envelope.operation).toBe('search');
    const json = JSON.stringify(envelope);
    expect(json).not.toContain('secret-key');
    expect(json).not.toContain('rawMarkerFreeform');
  });

  it('scenario 18b: the factory-level details payload provider is used as a fallback', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG, undefined, () => fixture());
    const envelope = adapter.details(VALID_PLACE_ID, NOW, undefined as unknown as GooglePlacesPlaceDetailPayloadProvider);
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('success');
    expect(envelope.data?.displayName).toBe('Rijksmuseum');
  });

  it('scenario 19b: a malformed detail payload yields a malformed-response envelope', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const envelope = adapter.details(VALID_PLACE_ID, NOW, () => ({ displayName: { text: 'Missing Id' } }));
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('failure');
    expect(envelope.error?.category).toBe('malformed-response');
  });

  it('scenario 20: an invalid place id yields an invalid-input envelope', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const envelope = adapter.details('../../etc/passwd', NOW, () => fixture());
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('failure');
    expect(envelope.error?.category).toBe('invalid-input');
  });

  it('scenario 16b: a missing or throwing payload provider is a bounded provider-unavailable', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const missing = adapter.details(VALID_PLACE_ID, NOW, undefined as unknown as GooglePlacesPlaceDetailPayloadProvider);
    expect(missing).not.toBeNull();
    if (missing === null) return;
    expect(missing.status).toBe('failure');
    expect(missing.error?.message).toBe(GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE);

    const throwing = adapter.details(VALID_PLACE_ID, NOW, () => {
      throw new Error('provider exploded');
    });
    expect(throwing).not.toBeNull();
    if (throwing === null) return;
    expect(throwing.status).toBe('failure');
    expect(throwing.error?.category).toBe('provider-unavailable');
    expect(JSON.stringify(throwing)).not.toContain('provider exploded');
  });

  it('scenario 16c: a ready adapter search with no payload source is a bounded provider-unavailable', () => {
    const adapter = createGooglePlacesDiscoveryAdapter(READY_CONFIG);
    const envelope = adapter.search(
      { latitude: 52.3676, longitude: 4.9041, radiusMeters: 5000, category: 'hotels', resultLimit: 5 },
      NOW,
      undefined as unknown as GooglePlacesPayloadProvider
    );
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(envelope.status).toBe('failure');
    expect(envelope.error?.category).toBe('provider-unavailable');
    expect(envelope.error?.message).toBe(GOOGLE_PLACES_PAYLOAD_SOURCE_ERROR_MESSAGE);
    const json = JSON.stringify(envelope);
    expect(json).not.toContain('secret-key');
    expect(json).not.toContain('rawMarkerFreeform');
  });
});

describe('STEP 45 Place Details service outcomes (bounded)', () => {
  it('scenario 8b: a malformed detail payload routed through the service is a bounded provider-failure', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, VALID_PLACE_ID, NOW, () => ({
      displayName: { text: 'Missing Id' },
    }));
    expectBoundAuthor(outcome, 'provider-failure');
    expect(outcome.error?.category).toBe('malformed-response');
    expect(outcome.detail).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain('Missing Id');
    expect(JSON.stringify(outcome)).not.toContain('secret-key');
  });

  it('scenario 18c: a ready gate + payload produces a success outcome with a validated echo', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, VALID_PLACE_ID, NOW, () => fixture());
    expectBoundAuthor(outcome, 'success');
    expect(outcome.placeId).toBe(VALID_PLACE_ID);
    expect(outcome.detail?.displayName).toBe('Rijksmuseum');
    expect(isGooglePlacesPlaceDetailAvailable(outcome)).toBe(true);
    expect(hasGooglePlacesPlaceDetail(outcome)).toBe(true);
  });

  it('scenario 17d: the default disabled gate yields a not-configured outcome', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(
      { attemptEnabled: false, credentials: null },
      VALID_PLACE_ID,
      NOW,
      () => fixture()
    );
    expectBoundAuthor(outcome, 'not-configured');
    expect(outcome.error?.category).toBe('provider-unavailable');
    expect(outcome.detail).toBeNull();
    expect(isGooglePlacesPlaceDetailAvailable(outcome)).toBe(false);
  });

  it('scenario 17e: enabled-but-keyless yields not-configured with credentials-missing honesty', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(
      { attemptEnabled: true, credentials: null },
      VALID_PLACE_ID,
      NOW,
      () => fixture()
    );
    expectBoundAuthor(outcome, 'not-configured');
    expect(outcome.error?.category).toBe('credentials-missing');
    expect(outcome.error?.message).toBe(GOOGLE_PLACES_CREDENTIALS_MISSING_MESSAGE);
  });

  it('scenario 10c: an invalid place id yields a bounded invalid-input outcome', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, 'ChIJ\u0001foo', NOW, () => fixture());
    expectBoundAuthor(outcome, 'invalid-input');
    expect(outcome.placeId).toBe('');
    expect(outcome.detail).toBeNull();
    expect(hasGooglePlacesPlaceDetail(outcome)).toBe(false);
  });

  it('scenario 19: the raw provider payload never crosses the outcome boundary', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, VALID_PLACE_ID, NOW, () => fixture());
    const json = JSON.stringify(outcome);
    expect(json).not.toContain('rawMarkerFreeform');
    expect(json).not.toContain('should-never-leak');
  });

  it('scenario 20b: the Google API key never appears in any outcome', () => {
    const outcome = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, VALID_PLACE_ID, NOW, () => fixture());
    expect(JSON.stringify(outcome)).not.toContain('secret-key');
    const missing = runGooglePlacesPlaceDetailsOnline(
      { attemptEnabled: true, credentials: null },
      VALID_PLACE_ID,
      NOW,
      () => fixture()
    );
    expect(JSON.stringify(missing)).not.toContain('secret-key');
  });

  it('scenario 22: availability helpers report status honestly', () => {
    const success = runGooglePlacesPlaceDetailsOnline(READY_CONFIG, VALID_PLACE_ID, NOW, () => fixture());
    expect(isGooglePlacesPlaceDetailAvailable(success)).toBe(true);
    expect(hasGooglePlacesPlaceDetail(success)).toBe(true);

    const disabled = runGooglePlacesPlaceDetailsOnline(
      { attemptEnabled: false, credentials: null },
      VALID_PLACE_ID,
      NOW,
      () => fixture()
    );
    expect(isGooglePlacesPlaceDetailAvailable(disabled)).toBe(false);
    expect(hasGooglePlacesPlaceDetail(disabled)).toBe(false);
  });
});