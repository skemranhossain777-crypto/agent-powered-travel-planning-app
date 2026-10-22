import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX,
  TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
  TRIP_EXECUTION_PROVIDER_RESULT_STATUSES,
  createTripExecutionProviderRequest,
  getTripExecutionProviderRequestId,
  isTripExecutionProviderRequest,
  isTripExecutionProviderResult,
  isTripExecutionProviderResultStatus,
  type TripExecutionProviderRequest,
  type TripExecutionProviderResult,
} from '../services/tripExecution/tripExecutionProvider';
import {
  TRIP_EXECUTION_DISPATCH_ID_PREFIX,
  TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND,
  createTripExecutionDispatchInstruction,
  type TripExecutionDispatchInstruction,
} from '../services/tripExecution/tripExecutionDispatch';
import {
  createTripPlanningExecutionAuthorization,
  type TripPlanningExecutionAuthorization,
} from '../domain/trips/tripPlanningExecutionAuthorization';
import {
  createTripPlanningExecutionRequest,
  type TripPlanningExecutionRequest,
} from '../domain/trips/tripPlanningExecutionRequest';
import {
  createTripPlanningExecutionIntent,
  type TripPlanningExecutionIntent,
} from '../domain/trips/tripPlanningExecutionIntent';
import {
  createTripPlanningApplicationBinding,
  type TripPlanningApplicationBinding,
} from '../domain/trips/tripPlanningApplicationBinding';
import {
  createTripPlanningApplication,
  type TripPlanningApplication,
} from '../domain/trips/tripPlanningApplication';
import {
  createTripPlanningApplicationTarget,
  type TripPlanningApplicationTarget,
} from '../domain/trips/tripPlanningApplicationTarget';
import { approveTripPlanningCompositionProposal } from '../domain/trips/tripPlanningCompositionProposalApproval';
import {
  createTripPlanningCompositionProposal,
  type TripPlanningCompositionProposal,
} from '../domain/trips/tripPlanningCompositionProposal';
import { createTripPlanningComposition } from '../domain/trips/tripPlanningComposition';
import type { TripPlanningReference } from '../types/trip';

const ORIGIN_LOCATION = { latitude: 52.3676, longitude: 4.9041 };
const DESTINATION_LOCATION = { latitude: 48.8566, longitude: 2.3522 };

function placeReference(overrides: Record<string, unknown> = {}): TripPlanningReference {
  return {
    id: 'place:alpha',
    title: 'Alpha Place',
    kind: 'activity',
    provider: 'Test Provider',
    providerId: 'alpha-1',
    ...overrides,
  } as TripPlanningReference;
}

function validApplication(): TripPlanningApplication {
  const composition = createTripPlanningComposition({
    origin: placeReference({ id: 'place:a', location: ORIGIN_LOCATION }),
    destination: placeReference({ id: 'place:b', location: DESTINATION_LOCATION }),
  }) as NonNullable<ReturnType<typeof createTripPlanningComposition>>;
  const proposal = createTripPlanningCompositionProposal(
    composition
  ) as TripPlanningCompositionProposal;
  const approved = approveTripPlanningCompositionProposal(
    proposal
  ) as TripPlanningCompositionProposal;
  return createTripPlanningApplication(approved) as TripPlanningApplication;
}

function validTarget(): TripPlanningApplicationTarget {
  return createTripPlanningApplicationTarget({
    scope: 'trip',
    tripId: 'trip-abc',
  }) as TripPlanningApplicationTarget;
}

function validBinding(): TripPlanningApplicationBinding {
  return createTripPlanningApplicationBinding(
    validApplication(),
    validTarget()
  ) as TripPlanningApplicationBinding;
}

function validIntent(): TripPlanningExecutionIntent {
  return createTripPlanningExecutionIntent(validBinding()) as TripPlanningExecutionIntent;
}

function validRequest(): TripPlanningExecutionRequest {
  return createTripPlanningExecutionRequest(validIntent()) as TripPlanningExecutionRequest;
}

function validAuthorization(): TripPlanningExecutionAuthorization {
  return createTripPlanningExecutionAuthorization(
    validRequest()
  ) as TripPlanningExecutionAuthorization;
}

function validDispatch(): TripExecutionDispatchInstruction {
  return createTripExecutionDispatchInstruction(
    validAuthorization()
  ) as TripExecutionDispatchInstruction;
}

function tamperedRequest(overrides: Record<string, unknown>): Record<string, unknown> {
  const dispatch = validDispatch();
  return {
    id: getTripExecutionProviderRequestId(dispatch.id),
    kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
    dispatchId: dispatch.id,
    ...overrides,
  };
}

function validResult(overrides: Record<string, unknown> = {}): TripExecutionProviderResult {
  return {
    providerId: 'provider:test',
    requestId: getTripExecutionProviderRequestId(validDispatch().id),
    status: 'accepted',
    ...overrides,
  } as TripExecutionProviderResult;
}

describe('STEP 59 provider request: structure and identity', () => {
  it('1. valid dispatch creates provider request', () => {
    const request = createTripExecutionProviderRequest(validDispatch());
    expect(request).not.toBeNull();
    expect(request?.kind).toBe(TRIP_EXECUTION_PROVIDER_REQUEST_KIND);
  });

  it('2. deterministic provider-request ID', () => {
    const dispatch = validDispatch();
    const request = createTripExecutionProviderRequest(dispatch);
    expect(request?.id).toBe(`${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatch.id}`);
    expect(request?.id).toBe(getTripExecutionProviderRequestId(dispatch.id));
    expect(request?.id).toMatch(
      new RegExp(`^${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}[^\\s]+$`)
    );
  });

  it('3. exact provider-request kind', () => {
    expect(TRIP_EXECUTION_PROVIDER_REQUEST_KIND).toBe('trip-execution-provider-request');
    expect(createTripExecutionProviderRequest(validDispatch())?.kind).toBe(
      TRIP_EXECUTION_PROVIDER_REQUEST_KIND
    );
  });

  it('4. dispatchId preserved', () => {
    const dispatch = validDispatch();
    const request = createTripExecutionProviderRequest(dispatch);
    expect(request?.dispatchId).toBe(dispatch.id);
  });

  it('5. fresh provider request', () => {
    const dispatch = validDispatch();
    const request = createTripExecutionProviderRequest(dispatch) as TripExecutionProviderRequest;
    expect(request).not.toBe(dispatch);
    expect(JSON.stringify(request)).not.toBe(JSON.stringify(dispatch));
  });

  it('6. dispatch input not mutated', () => {
    const dispatch = validDispatch();
    const snapshot = JSON.stringify(dispatch);
    expect(createTripExecutionProviderRequest(dispatch)).not.toBeNull();
    expect(JSON.stringify(dispatch)).toBe(snapshot);
  });

  it('7. repeated creation deterministic', () => {
    const dispatch = validDispatch();
    const first = createTripExecutionProviderRequest(dispatch);
    const again = createTripExecutionProviderRequest(dispatch);
    expect(first?.id).toBe(again?.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
  });

  it('8. malformed dispatch rejected', () => {
    expect(createTripExecutionProviderRequest(null as never)).toBeNull();
    expect(createTripExecutionProviderRequest(undefined as never)).toBeNull();
    expect(createTripExecutionProviderRequest({} as never)).toBeNull();
    expect(createTripExecutionProviderRequest('trip-execution-dispatch:x' as never)).toBeNull();
    expect(createTripExecutionProviderRequest(42 as never)).toBeNull();
    const dispatch = validDispatch();
    expect(createTripExecutionProviderRequest({ ...dispatch, kind: 'other' } as never)).toBeNull();
    expect(createTripExecutionProviderRequest({ ...dispatch, id: 'stray' } as never)).toBeNull();
  });

  it('9. malformed dispatch ID rejected', () => {
    expect(
      isTripExecutionProviderRequest({
        id: TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX + TRIP_EXECUTION_DISPATCH_ID_PREFIX + 'x',
        kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
        dispatchId: 7,
      })
    ).toBe(false);
    expect(isTripExecutionProviderRequest(tamperedRequest({ dispatchId: '' }))).toBe(false);
    expect(isTripExecutionProviderRequest(tamperedRequest({ dispatchId: 'dispatch:abc' }))).toBe(
      false
    );
  });

  it('10. missing dispatch ID rejected', () => {
    expect(isTripExecutionProviderRequest(tamperedRequest({ dispatchId: undefined }))).toBe(false);
    const removed = { kind: tamperedRequest({}).kind, id: tamperedRequest({}).id };
    expect(isTripExecutionProviderRequest(removed)).toBe(false);
  });

  it('11. wrong dispatch kind rejected', () => {
    const request = tamperedRequest({});
    expect(isTripExecutionProviderRequest({ ...request, kind: 'other' })).toBe(false);
    expect(
      isTripExecutionProviderRequest({ ...request, kind: TRIP_EXECUTION_DISPATCH_INSTRUCTION_KIND })
    ).toBe(false);
  });

  it('12. incorrect deterministic provider-request ID rejected', () => {
    const request = tamperedRequest({});
    expect(
      isTripExecutionProviderRequest({ ...request, id: 'trip-execution-provider-request:other' })
    ).toBe(false);
    expect(isTripExecutionProviderRequest({ ...request, id: request.dispatchId })).toBe(false);
    expect(isTripExecutionProviderRequest({ ...request, id: undefined })).toBe(false);
  });

  it('13. prefix-only dispatch ID rejected', () => {
    const dispatchId = TRIP_EXECUTION_DISPATCH_ID_PREFIX;
    expect(
      isTripExecutionProviderRequest({
        id: `${TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX}${dispatchId}`,
        kind: TRIP_EXECUTION_PROVIDER_REQUEST_KIND,
        dispatchId,
      })
    ).toBe(false);
  });

  it('malformed provider-request object rejected', () => {
    expect(isTripExecutionProviderRequest(null)).toBe(false);
    expect(isTripExecutionProviderRequest(undefined)).toBe(false);
    expect(isTripExecutionProviderRequest({})).toBe(false);
    expect(isTripExecutionProviderRequest('x')).toBe(false);
    expect(isTripExecutionProviderRequest(['x'])).toBe(false);
    expect(isTripExecutionProviderRequest(7)).toBe(false);
  });

  it('request id derivability is enforced (no reassignment of dispatchId)', () => {
    const request = tamperedRequest({});
    expect(isTripExecutionProviderRequest({ ...request, dispatchId: request.id })).toBe(false);
  });

  it('provider-request id space is distinct from the dispatch id space', () => {
    expect(TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX).not.toBe(TRIP_EXECUTION_DISPATCH_ID_PREFIX);
    expect(getTripExecutionProviderRequestId('i')).not.toBe('i');
  });
});

describe('STEP 59 provider result: status vocabulary', () => {
  it('14. valid provider result accepted', () => {
    const result = validResult();
    expect(isTripExecutionProviderResult(result)).toBe(true);
  });

  it('15. accepted status accepted', () => {
    expect(isTripExecutionProviderResult(validResult({ status: 'accepted' }))).toBe(true);
  });

  it('16. rejected status accepted', () => {
    expect(isTripExecutionProviderResult(validResult({ status: 'rejected' }))).toBe(true);
  });

  it('17. unsupported status accepted', () => {
    expect(isTripExecutionProviderResult(validResult({ status: 'unsupported' }))).toBe(true);
  });

  it('18. failed status accepted', () => {
    expect(isTripExecutionProviderResult(validResult({ status: 'failed' }))).toBe(true);
  });

  it('status vocabulary is exactly the four allowed members', () => {
    expect([...TRIP_EXECUTION_PROVIDER_RESULT_STATUSES]).toEqual([
      'accepted',
      'rejected',
      'unsupported',
      'failed',
    ]);
    for (const status of TRIP_EXECUTION_PROVIDER_RESULT_STATUSES) {
      expect(isTripExecutionProviderResultStatus(status)).toBe(true);
    }
  });

  it('19. unsupported future status rejected', () => {
    for (const status of [
      'executing',
      'completed',
      'pending',
      'cancelled',
      'refunded',
      'booked',
      'paid',
    ]) {
      expect(isTripExecutionProviderResult(validResult({ status }))).toBe(false);
    }
    expect(isTripExecutionProviderResult(validResult({ status: 'Accepted' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ status: 'accepted ' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ status: 42 }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ status: undefined }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ status: null }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ status: '' }))).toBe(false);
  });

  it('20. malformed provider ID rejected', () => {
    expect(isTripExecutionProviderResult(validResult({ providerId: undefined }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: 7 }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: '' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: '   ' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: ' padded' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: 'padded ' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: 'x'.repeat(101) }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ providerId: 'x'.repeat(100) }))).toBe(true);
    expect(isTripExecutionProviderResult(validResult({ providerId: 'provider:test' }))).toBe(true);
  });

  it('21. malformed request ID rejected', () => {
    expect(isTripExecutionProviderResult(validResult({ requestId: undefined }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ requestId: 7 }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ requestId: '' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ requestId: 'x' }))).toBe(false);
    expect(isTripExecutionProviderResult(validResult({ requestId: 'request:abc' }))).toBe(false);
    expect(
      isTripExecutionProviderResult(
        validResult({ requestId: TRIP_EXECUTION_PROVIDER_REQUEST_ID_PREFIX })
      )
    ).toBe(false);
  });

  it('malformed provider-result object rejected', () => {
    expect(isTripExecutionProviderResult(null)).toBe(false);
    expect(isTripExecutionProviderResult(undefined)).toBe(false);
    expect(isTripExecutionProviderResult({})).toBe(false);
    expect(isTripExecutionProviderResult('x')).toBe(false);
    expect(isTripExecutionProviderResult(['x'])).toBe(false);
    expect(isTripExecutionProviderResult(7)).toBe(false);
  });
});

describe('STEP 59 data shape and provider neutrality', () => {
  it('provider request contains only required identifiers', () => {
    const request = createTripExecutionProviderRequest(
      validDispatch()
    ) as TripExecutionProviderRequest;
    expect(Object.keys(request).sort()).toEqual(['dispatchId', 'id', 'kind']);
  });

  it('provider result contains only providerId, requestId, status', () => {
    const result = validResult();
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('22. provider request remains provider-neutral', () => {
    const request = createTripExecutionProviderRequest(
      validDispatch()
    ) as TripExecutionProviderRequest;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toMatch(
      /providerName|latitude|longitude|placeId|endpoint|apiKey|currency|amount/i
    );
    expect(serialized).not.toContain('"authorizationId"');
    expect(serialized).not.toContain('"intentId"');
    expect(serialized).not.toContain('"scope"');
    expect(serialized).not.toContain('"tripId"');
    expect(serialized).not.toContain('"bindingId"');
  });

  it('28. no provider-specific request payload', () => {
    const request = createTripExecutionProviderRequest(
      validDispatch()
    ) as TripExecutionProviderRequest;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toMatch(/payload|options|config|extras|params|transport/i);
    expect(Object.keys(request).sort()).toEqual(['dispatchId', 'id', 'kind']);
  });

  it('23. provider result remains provider-neutral', () => {
    const result = validResult();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /latitude|longitude|currency|amount|totalCost|placeId|endpoint|url|apiKey/i
    );
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('24. no raw provider response allowed', () => {
    const result = validResult();
    expect(result).not.toHaveProperty('response');
    expect(result).not.toHaveProperty('data');
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('headers');
    expect(result).not.toHaveProperty('raw');
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('25. no credential/token fields', () => {
    const result = validResult();
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('sessionToken');
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('26. no payment fields', () => {
    const result = validResult();
    expect(result).not.toHaveProperty('amount');
    expect(result).not.toHaveProperty('currency');
    expect(result).not.toHaveProperty('paymentId');
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });

  it('27. no booking fields', () => {
    const result = validResult();
    expect(result).not.toHaveProperty('bookingRef');
    expect(result).not.toHaveProperty('confirmationCode');
    expect(result).not.toHaveProperty('pnr');
    expect(Object.keys(result).sort()).toEqual(['providerId', 'requestId', 'status']);
  });
});

describe('STEP 59 module boundary and provider interface', () => {
  const sourcePath = join(
    process.cwd(),
    'src',
    'services',
    'tripExecution',
    'tripExecutionProvider.ts'
  );
  const source = readFileSync(sourcePath, 'utf8');

  it('imports only the STEP 58 dispatch contract and the shared provider identity bound', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports).toEqual(['../../domain/providers/providerResults', './tripExecutionDispatch']);
  });

  it('42. provider interface is asynchronous', () => {
    expect(source).toMatch(/execute\s*\([\s\S]*?\)\s*:\s*Promise<TripExecutionProviderResult>/);
    expect(source).toMatch(/\bPromise\b/);
  });

  it('43. provider identity is explicit', () => {
    expect(source).toMatch(/readonly\s+providerId:\s*string/);
    expect(source).toMatch(/TripExecutionProvider\b/);
  });

  it('44. the STEP 59 contract module itself has no concrete provider implementation', () => {
    expect(source).not.toMatch(/implements\s+TripExecutionProvider/);
    expect(source).not.toMatch(/class\s+\w+.*TripExecutionProvider/);
    const files = readdirSync(join(process.cwd(), 'src', 'services', 'tripExecution')).sort();
    // A closed inventory, so a new module in this directory cannot appear without
    // this test being read. `tripExecutionCapabilityService.ts` is the STEP 69
    // browser capability client: it is a pure reader that validates the STEP 68
    // response and holds no provider implementation, which the assertion below
    // confirms for it as well. The STEP 79-91 history/record modules and the
    // STEP 80 Firestore record repository are the most recent additions.
    expect(files).toEqual([
      'firestoreTripExecutionRecordRepository.ts',
      'mockTripExecutionProvider.ts',
      'tripExecutionAuthorizedExecution.ts',
      'tripExecutionAuthorizedOrchestrator.ts',
      'tripExecutionAuthorizedRequest.ts',
      'tripExecutionCapability.ts',
      'tripExecutionCapabilityService.ts',
      'tripExecutionDispatch.ts',
      'tripExecutionEligibility.ts',
      'tripExecutionHistory.ts',
      'tripExecutionHistoryAccess.ts',
      'tripExecutionHistoryComposition.ts',
      'tripExecutionHistoryConsumer.ts',
      'tripExecutionHistoryListingService.ts',
      'tripExecutionHistoryPresentation.ts',
      'tripExecutionHistoryQueryService.ts',
      'tripExecutionOrchestrator.ts',
      'tripExecutionOutcomeReceipt.ts',
      'tripExecutionPipeline.ts',
      'tripExecutionPlan.ts',
      'tripExecutionPlanBinding.ts',
      'tripExecutionPlanQualification.ts',
      'tripExecutionProvider.ts',
      'tripExecutionQualifiedAuthorization.ts',
      'tripExecutionQualifiedDispatch.ts',
      'tripExecutionRecord.ts',
      'tripExecutionRecordRepository.ts',
      'tripExecutionRecordRetrievalService.ts',
      'tripExecutionRecordService.ts',
    ]);
    // Every non-STEP-59 module in this directory is a client, an execution
    // boundary, a pure calculation, or part of the STEP 79-91 history/record
    // line, and none is a provider implementation. The STEP 80
    // `firestoreTripExecutionRecordRepository.ts` is the one exception to the
    // class-free rule below, so it is checked on its own.
    // `tripExecutionAuthorizedExecution.ts` calls a *supplied* provider's
    // execute(); `tripExecutionAuthorizedOrchestrator.ts` does not call execute()
    // at all - it reaches providers only through STEP 75.
    for (const file of [
      'tripExecutionAuthorizedExecution.ts',
      'tripExecutionAuthorizedOrchestrator.ts',
      'tripExecutionAuthorizedRequest.ts',
      'tripExecutionCapabilityService.ts',
      'tripExecutionEligibility.ts',
      'tripExecutionHistory.ts',
      'tripExecutionHistoryAccess.ts',
      'tripExecutionHistoryComposition.ts',
      'tripExecutionHistoryConsumer.ts',
      'tripExecutionHistoryListingService.ts',
      'tripExecutionHistoryPresentation.ts',
      'tripExecutionHistoryQueryService.ts',
      'tripExecutionOutcomeReceipt.ts',
      'tripExecutionPlanQualification.ts',
      'tripExecutionQualifiedAuthorization.ts',
      'tripExecutionQualifiedDispatch.ts',
      'tripExecutionRecord.ts',
      'tripExecutionRecordRepository.ts',
      'tripExecutionRecordRetrievalService.ts',
      'tripExecutionRecordService.ts',
    ]) {
      const extra = readFileSync(join(process.cwd(), 'src', 'services', 'tripExecution', file), 'utf8');
      expect(extra, file).not.toMatch(/implements\s+TripExecutionProvider/);
      expect(extra, file).not.toMatch(/class\s+\w+/);
      expect(extra, file).not.toMatch(/from\s+['"][^'"]*mockTripExecutionProvider/);
    }

    // `firestoreTripExecutionRecordRepository.ts` declares a class, so it is not
    // in the class-free list above. It is the STEP 80 concrete persistence
    // adapter for the STEP 79 *record* repository contract - not a provider: it
    // implements no provider interface and carries no provider identity.
    const recordRepository = readFileSync(
      join(process.cwd(), 'src', 'services', 'tripExecution', 'firestoreTripExecutionRecordRepository.ts'),
      'utf8'
    );
    expect(recordRepository).toMatch(/implements\s+TripExecutionRecordRepository/);
    expect(recordRepository).not.toMatch(/implements\s+TripExecutionProvider/);
    expect(recordRepository).not.toMatch(/TripExecutionProvider\b/);

    // Exactly two files in this directory INVOKE a provider - STEP 61 (its own
    // pipeline) and STEP 75 (the single-provider boundary). STEP 60's `execute`
    // is a method declaration rather than a call, and STEP 59's is the interface
    // declaration, so neither matches. STEP 76 is absent: composing STEP 75 adds
    // no new route to a provider.
    const invoked = files.filter((file) =>
      /\.execute\s*\(/.test(
        readFileSync(join(process.cwd(), 'src', 'services', 'tripExecution', file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n]*/g, ' ')
      )
    );
    expect(invoked).toEqual(['tripExecutionAuthorizedExecution.ts', 'tripExecutionOrchestrator.ts']);
  });

  it('29. no Google dependency', () => {
    expect(source).not.toMatch(
      /googlePlacesAdapter|googleRoutesAdapter|googleRoutesService|googlePlacesService|googleDiscovery|googlePlacesConnection|googleRoutesConnection/i
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*(googleDiscovery|googleRoutes)/i);
  });

  it('30. no Amadeus dependency', () => {
    expect(source).not.toMatch(/amadeusAdapter|amadeusConnection|amadeusConfig|amadeusMapping/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*(realDiscovery|amadeus)/i);
  });

  it('31. no AI dependency', () => {
    expect(source).not.toMatch(/aiPlanningService|gemini|generativeLanguage/i);
    expect(source).not.toMatch(/aiTravelAgent/i);
  });

  it('32. no persistence/database dependency', () => {
    expect(source).not.toMatch(/from\s+['"][^'"]*firebase/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*firestore/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
    expect(source).not.toMatch(/cloud functions|onCall|getFirestore/i);
    expect(source).not.toMatch(
      /from\s+['"][^'"]*(firestoreService|dataConnectService|authService)/i
    );
  });

  it('33. no network dependency', () => {
    expect(source).not.toMatch(/fetch\s*\(|new\s+WebSocket|XMLHttpRequest|axios/i);
    expect(source).not.toMatch(/http:\/\/|https:\/\//i);
    expect(source).not.toMatch(/endpoint|baseUrl|apiEndpoint|httpMethod/i);
  });

  it('34. no clock dependency', () => {
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new\s+Date\(\s*\)/);
    expect(source).not.toMatch(/performance\.now|process\.hrtime/);
  });

  it('35. no randomness dependency', () => {
    expect(source).not.toMatch(/\bMath\.random\b/);
    expect(source).not.toMatch(/crypto\.randomUUID|geolocation/i);
    expect(source).not.toMatch(/navigator\.|window\.|document\./);
    expect(source).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it('no credentials, tokens, provider secrets, or API keys', () => {
    expect(source).not.toMatch(/apiKey|x-goog-api-key|Bearer\s/i);
    expect(source).not.toMatch(/accessToken|refreshToken|clientSecret|authorizationHeader/i);
    expect(source).not.toMatch(/OAuth|AppCheck|getIdToken/i);
  });

  it('26. no booking behavior and no payment behavior', () => {
    expect(source).not.toMatch(/submit-booking|cancel-booking|prepare-booking|createBooking/i);
    expect(source).not.toMatch(
      /refund|charge|payment-intent|checkout|paymentMethod|\bstripe\b|invoice|paid/i
    );
  });

  it('36. no provider selection', () => {
    expect(source).not.toMatch(
      /selectProvider\(|defaultProvider|providerRegistry|providerFactory/i
    );
    expect(source).not.toMatch(/preferProvider|providerRanking|providerPriority/i);
    expect(source).not.toMatch(/createTripExecutionProviderAdapter|makeExecutionProvider/i);
  });

  it('37. no provider orchestration', () => {
    expect(source).not.toMatch(/orchestrat|dispatchAll|parallelDispatch|forkJoin|Promise\.all\(/i);
    expect(source).not.toMatch(/executeAll|runAllProviders/i);
  });

  it('38. no automatic execution', () => {
    expect(source).not.toMatch(/startExecution|beginExecution|fire\(|emit\(/i);
    expect(source).not.toMatch(/system\.on|process\.on|app\.use\(|listen\(/i);
  });

  it('no execution-lifecycle statuses beyond the allowed vocabulary', () => {
    expect(source).not.toMatch(
      /executing|pending-execution|completed|cancelled|refunded|\bbooked\b/i
    );
    expect(source).not.toMatch(/markApply|markApplied|executionStatus|externalRequestId/i);
  });

  it('39. no itinerary mutation and 40. no trip mutation', () => {
    expect(source).not.toMatch(
      /updateTripDays|setTripStatus|createDraftTrip|itineraryToTripWorkspace/
    );
    expect(source).not.toMatch(/updateTrip\(|deleteTrip\(/);
    expect(source).not.toMatch(/dayPlans|primaryAccommodationPlanId|primaryTransportPlanId/);
  });

  it('no React, Router, UI, or Zustand imports', () => {
    expect(source).not.toMatch(/from\s+['"]react(?:-dom)?['"]/);
    expect(source).not.toMatch(/from\s+['"]react-router-?dom?['"]/);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.[\\/]components/i);
  });

  it('no retry or rollback/compensation logic', () => {
    expect(source).not.toMatch(/retryCount|attempts|backoff|deadLetter/i);
    expect(source).not.toMatch(/rollback|compensa|recoveryQueue/i);
  });
});

describe('STEP 59 deterministic validators', () => {
  it('41. deterministic request validator', () => {
    const request = createTripExecutionProviderRequest(validDispatch());
    expect(isTripExecutionProviderRequest(request)).toBe(true);
    expect(isTripExecutionProviderRequest(JSON.parse(JSON.stringify(request)))).toBe(true);
    expect(isTripExecutionProviderRequest(request)).toBe(true);
  });

  it('41. deterministic result validator', () => {
    const result = validResult();
    expect(isTripExecutionProviderResult(result)).toBe(true);
    expect(isTripExecutionProviderResult(JSON.parse(JSON.stringify(result)))).toBe(true);
    expect(isTripExecutionProviderResult(result)).toBe(true);
  });
});
