import { describe, expect, it } from 'vitest';
import {
  AMADEUS_EXECUTION_REQUEST_ID_PREFIX,
  AMADEUS_EXECUTION_REQUEST_KIND,
  AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS,
  auditAmadeusExecutionInput,
  getAmadeusExecutionInsufficientInformationMessage,
  getAmadeusExecutionRequestId,
  isAmadeusExecutionRequest,
  mapAmadeusExecutionRequest,
} from '../services/realExecution/amadeusExecutionMapping';
import { TRIP_EXECUTION_DISPATCH_ID_PREFIX } from '../services/tripExecution/tripExecutionDispatch';
import {
  getTripExecutionProviderRequestId,
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  type TripExecutionProviderRequest,
} from '../services/tripExecution/tripExecutionProvider';

const DISPATCH_ID = `${TRIP_EXECUTION_DISPATCH_ID_PREFIX}amadeus-execution-test`;
const REQUEST_ID = getTripExecutionProviderRequestId(DISPATCH_ID);

const VALID_REQUEST: TripExecutionProviderRequest = {
  id: REQUEST_ID,
  kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  dispatchId: DISPATCH_ID,
};

describe('STEP 66 Amadeus execution request identity', () => {
  it('uses a deterministic Amadeus-side id space distinct from the provider-request space', () => {
    expect(AMADEUS_EXECUTION_REQUEST_ID_PREFIX).toBe('amadeus-execution-request:');
    expect(AMADEUS_EXECUTION_REQUEST_KIND).toBe('amadeus-execution-request');
    expect(REQUEST_ID.startsWith(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX)).toBe(true);
  });

  it('derives the Amadeus-side id deterministically from the provider-request id', () => {
    expect(getAmadeusExecutionRequestId(REQUEST_ID)).toBe(
      `${AMADEUS_EXECUTION_REQUEST_ID_PREFIX}${REQUEST_ID}`
    );
    expect(getAmadeusExecutionRequestId(REQUEST_ID)).toBe(getAmadeusExecutionRequestId(REQUEST_ID));
  });

  it('refuses a foreign, empty-suffix, or non-string request id', () => {
    expect(getAmadeusExecutionRequestId('not-a-provider-request-id')).toBeNull();
    expect(getAmadeusExecutionRequestId(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX)).toBeNull();
    expect(getAmadeusExecutionRequestId('')).toBeNull();
    expect(getAmadeusExecutionRequestId(undefined)).toBeNull();
    expect(getAmadeusExecutionRequestId(42)).toBeNull();
  });
});

describe('STEP 66 mapping a provider request to the Amadeus execution shape', () => {
  it('preserves the request identity and dispatch identity verbatim', () => {
    const mapped = mapAmadeusExecutionRequest(VALID_REQUEST);
    expect(mapped).toEqual({
      id: `${AMADEUS_EXECUTION_REQUEST_ID_PREFIX}${REQUEST_ID}`,
      kind: AMADEUS_EXECUTION_REQUEST_KIND,
      requestId: REQUEST_ID,
      dispatchId: DISPATCH_ID,
      operation: null,
    });
  });

  it('never derives an operation, because the provider request carries none', () => {
    expect(mapAmadeusExecutionRequest(VALID_REQUEST)?.operation).toBeNull();
  });

  it('ignores a caller-injected operation instead of adopting it', () => {
    const hostile = { ...VALID_REQUEST, operation: 'injected-operation' } as unknown;
    expect(mapAmadeusExecutionRequest(hostile)?.operation).toBeNull();
    expect(mapAmadeusExecutionRequest(hostile)?.requestId).toBe(REQUEST_ID);
  });

  it('fabricates no traveler, passenger, payment, booking, or reservation data', () => {
    const mapped = mapAmadeusExecutionRequest(VALID_REQUEST) as unknown as Record<string, unknown>;

    // The mapped request is identities only, so no such field can exist at all.
    expect(Object.keys(mapped).sort()).toEqual(['dispatchId', 'id', 'kind', 'operation', 'requestId']);
    for (const forbidden of [
      'traveler',
      'travelerIdentity',
      'passenger',
      'passengers',
      'payment',
      'paymentAuthorization',
      'card',
      'creditCard',
      'booking',
      'reservation',
      'ticket',
      'price',
      'total',
      'contact',
      'email',
    ]) {
      expect(mapped[forbidden]).toBeUndefined();
    }
    expect(JSON.stringify(mapped)).not.toMatch(/traveler|passenger|payment|booking|reservation|ticket/i);
  });

  it('drops caller-injected traveler and payment fields rather than carrying them', () => {
    const hostile = {
      ...VALID_REQUEST,
      travelerIdentity: { givenName: 'Ada', familyName: 'Lovelace' },
      paymentAuthorization: { cardNumber: '4111111111111111' },
      booking: { pnr: 'ABC123' },
    } as unknown;
    const mapped = mapAmadeusExecutionRequest(hostile);

    expect(mapped).toEqual({
      id: `${AMADEUS_EXECUTION_REQUEST_ID_PREFIX}${REQUEST_ID}`,
      kind: AMADEUS_EXECUTION_REQUEST_KIND,
      requestId: REQUEST_ID,
      dispatchId: DISPATCH_ID,
      operation: null,
    });
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain('Ada');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('ABC123');
  });

  it('returns null for every malformed request instead of repairing it', () => {
    expect(mapAmadeusExecutionRequest(null)).toBeNull();
    expect(mapAmadeusExecutionRequest(undefined)).toBeNull();
    expect(mapAmadeusExecutionRequest({})).toBeNull();
    expect(mapAmadeusExecutionRequest('request')).toBeNull();
    expect(mapAmadeusExecutionRequest([VALID_REQUEST])).toBeNull();
    expect(mapAmadeusExecutionRequest({ ...VALID_REQUEST, kind: 'other-kind' })).toBeNull();
    expect(mapAmadeusExecutionRequest({ ...VALID_REQUEST, dispatchId: 'forged-dispatch' })).toBeNull();
    expect(mapAmadeusExecutionRequest({ ...VALID_REQUEST, id: 'forged-request-id' })).toBeNull();
  });

  it('does not mutate the request it maps', () => {
    const snapshot = { ...VALID_REQUEST };
    mapAmadeusExecutionRequest(VALID_REQUEST);
    expect(VALID_REQUEST).toEqual(snapshot);
  });

  it('recognizes its own mapped shape and rejects a fabricated operation', () => {
    const mapped = mapAmadeusExecutionRequest(VALID_REQUEST);
    expect(mapped).not.toBeNull();
    expect(isAmadeusExecutionRequest(mapped)).toBe(true);
    expect(isAmadeusExecutionRequest({ ...(mapped as object), operation: 'injected-operation' })).toBe(false);
    expect(isAmadeusExecutionRequest(null)).toBe(false);
    expect(isAmadeusExecutionRequest(VALID_REQUEST)).toBe(false);
  });

  it('rejects a mapped shape whose identities are not strings', () => {
    const mapped = mapAmadeusExecutionRequest(VALID_REQUEST) as object;
    expect(isAmadeusExecutionRequest({ ...mapped, requestId: 42 })).toBe(false);
    expect(isAmadeusExecutionRequest({ ...mapped, dispatchId: null })).toBe(false);
    expect(isAmadeusExecutionRequest({ ...mapped, kind: 'other-kind' })).toBe(false);
    expect(isAmadeusExecutionRequest({ ...mapped, id: 'forged-id' })).toBe(false);
  });
});

describe('STEP 66 auditing insufficient Amadeus execution information', () => {
  it('names every required input the identity-only request is missing', () => {
    const audit = auditAmadeusExecutionInput(mapAmadeusExecutionRequest(VALID_REQUEST));
    expect(audit.sufficient).toBe(false);
    expect(audit.missingInput).toEqual([...AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS]);
  });

  it('requires an operation, a traveler identity, and a payment authorization by name', () => {
    expect(AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS).toEqual([
      'operation',
      'travelerIdentity',
      'paymentAuthorization',
    ]);
  });

  it('reports only the absent names, never a value', () => {
    const audit = auditAmadeusExecutionInput({ operation: 'a-real-operation' });
    expect(audit.sufficient).toBe(false);
    expect(audit.missingInput).toEqual(['travelerIdentity', 'paymentAuthorization']);
    expect(JSON.stringify(audit)).not.toContain('a-real-operation');
  });

  it('is sufficient only when every required name is present and usable', () => {
    expect(
      auditAmadeusExecutionInput({
        operation: 'a-real-operation',
        travelerIdentity: { givenName: 'Ada' },
        paymentAuthorization: { reference: 'opaque' },
      })
    ).toEqual({ sufficient: true, missingInput: [] });
  });

  it('accepts a non-string usable value but rejects a non-finite number', () => {
    expect(
      auditAmadeusExecutionInput({
        operation: 'a-real-operation',
        travelerIdentity: true,
        paymentAuthorization: 7,
      })
    ).toEqual({ sufficient: true, missingInput: [] });
    expect(
      auditAmadeusExecutionInput({
        operation: Number.NaN,
        travelerIdentity: Number.POSITIVE_INFINITY,
        paymentAuthorization: Number.NaN,
      }).missingInput
    ).toEqual(['operation', 'travelerIdentity', 'paymentAuthorization']);
  });

  it('treats blank, empty, and over-length names as absent', () => {    expect(
      auditAmadeusExecutionInput({
        operation: '   ',
        travelerIdentity: '',
        paymentAuthorization: 'x'.repeat(101),
      })
    ).toEqual({
      sufficient: false,
      missingInput: ['operation', 'travelerIdentity', 'paymentAuthorization'],
    });
  });

  it('fails closed for a non-record input bag rather than throwing', () => {
    expect(auditAmadeusExecutionInput(null)).toEqual({
      sufficient: false,
      missingInput: [...AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS],
    });
    expect(auditAmadeusExecutionInput('inputs')).toEqual({
      sufficient: false,
      missingInput: [...AMADEUS_EXECUTION_REQUIRED_INPUT_KEYS],
    });
    expect(auditAmadeusExecutionInput(undefined).sufficient).toBe(false);
  });

  it('exposes a frozen, name-only explanation of the closed boundary', () => {
    const audit = auditAmadeusExecutionInput({});
    expect(Object.isFrozen(audit)).toBe(true);
    expect(Object.isFrozen(audit.missingInput)).toBe(true);
    const message = getAmadeusExecutionInsufficientInformationMessage(audit);
    expect(message).toContain('operation');
    expect(message).toContain('travelerIdentity');
    expect(message).toContain('paymentAuthorization');
  });

  it('reports an honest message when the audit passes and no operation exists', () => {
    const message = getAmadeusExecutionInsufficientInformationMessage(
      auditAmadeusExecutionInput({
        operation: 'a-real-operation',
        travelerIdentity: { givenName: 'Ada' },
        paymentAuthorization: { reference: 'opaque' },
      })
    );
    expect(message).toMatch(/no operation is implemented/i);
  });
});
