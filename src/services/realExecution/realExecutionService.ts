/**
 * Real-provider EXECUTION service boundary (STEP 66).
 *
 * Composes the first real execution provider and hands the application a single,
 * read-only place to obtain it. It follows the composition style already
 * established by the STEP 41 Amadeus *discovery* service
 * (`services/realDiscovery/realDiscoveryService.ts`), with the execution domain's
 * extra constraint: **construction runs nothing.**
 *
 * 1. **Composing the service executes nothing.** `createRealExecutionService`
 *    resolves a gate, builds a provider object, and reads a capability profile.
 *    It never calls a provider's `execute`, never consults a transport, and
 *    never touches a credential. Execution happens only when a caller explicitly
 *    runs the STEP 65 pipeline, so a service reference can be created, held, and
 *    dropped with no observable effect.
 * 2. **Default off is preserved end to end.** The default config is
 *    `DEFAULT_AMADEUS_EXECUTION_CONFIG`, so a service built with no arguments is
 *    `disabled`, the Amadeus provider answers `unsupported`, and no browser build
 *    can reach a real provider. Turning anything on requires an explicitly
 *    supplied config from a server.
 * 3. **The deterministic mock is untouched.** `mockTripExecutionProvider` is
 *    imported and re-exported for convenience but is never wrapped, substituted,
 *    or re-implemented, so STEP 60's exact behavior is preserved. The default
 *    provider set is the Amadeus provider alone; the mock is available for a
 *    caller to add explicitly through `includeMock`, which keeps a real provider
 *    from being silently mixed into a test that expected only the mock.
 * 4. **Nothing here mutates state or talks to the network.** No React,
 *    Firebase, Router, Zustand, persistence, clock, randomness, SDK, `any`, or
 *    generic `Record<string, any>`. A credential is passed through as an opaque
 *    config value and is never logged, echoed, serialized into a result, or
 *    exposed on the service object.
 *
 * The service exposes only identities, a gate, a capability profile, and the
 * provider instances themselves - never a provider payload, a booking, a
 * payment, a traveler, a confirmation, or a raw provider response.
 */

import {
  DEFAULT_AMADEUS_EXECUTION_CONFIG,
  getAmadeusExecutionAttemptGate,
  type AmadeusExecutionAttemptGate,
  type AmadeusExecutionConfig,
} from './amadeusExecutionConfig';
import {
  createAmadeusExecutionProvider,
  getAmadeusExecutionCapabilityProfile,
} from './amadeusExecutionAdapter';
import type { AmadeusExecutionConnection } from './amadeusExecutionConnection';
import type { ProviderAdapterProfile } from '../../domain/providers/providerAdapter';
import type { TripExecutionCapabilityProvider } from '../tripExecution/tripExecutionCapability';
import { mockTripExecutionProvider } from '../tripExecution/mockTripExecutionProvider';

/**
 * The injected execution provider set, read-only and in deterministic order.
 * Returning it (rather than a bare array) keeps the caller's list authoritative
 * while making it obvious that the service does not manage provider state.
 */
export type RealExecutionProviders = ReadonlyArray<TripExecutionCapabilityProvider>;

/** Optional composition inputs. Every field is opt-in; the defaults change nothing. */
export interface RealExecutionServiceOptions {
  /**
   * The transport seam to compose into the Amadeus provider. When omitted the
   * default connection is used, which holds no transport and cannot reach the
   * network. Injecting one is how a server would later supply a real `fetch`
   * without this module ever constructing it.
   */
  connection?: AmadeusExecutionConnection;
  /**
   * Whether to append the deterministic STEP 60 mock after the Amadeus provider.
   * Defaults to `false` so a real provider is never mixed into a caller's list
   * implicitly. The mock itself is never modified either way.
   */
  includeMock?: boolean;
}

/** The read-only execution service handle. Holds no secret and no provider payload. */
export interface RealExecutionService {
  /** The deterministic gate for the composed config: `disabled` by default. */
  readonly gate: AmadeusExecutionAttemptGate;
  /** The composed providers, in deterministic order. */
  readonly providers: RealExecutionProviders;
  /** The composed provider ids, in the same order. */
  readonly providerIds: ReadonlyArray<string>;
  /** The Amadeus capability profile: every capability declared, none available. */
  readonly amadeusCapabilityProfile: ProviderAdapterProfile;
  /** The composed Amadeus execution provider itself. */
  readonly amadeusProvider: TripExecutionCapabilityProvider;
}

/**
 * Orders the composed providers deterministically so a plan's provider order -
 * and therefore every pipeline result - is reproducible. The mock is appended
 * only when explicitly requested, so a real provider is never mixed into a
 * caller's list implicitly.
 */
function composeProviders(
  amadeusProvider: TripExecutionCapabilityProvider,
  options: RealExecutionServiceOptions
): RealExecutionProviders {
  const providers: TripExecutionCapabilityProvider[] = [amadeusProvider];
  if (options.includeMock === true) {
    providers.push(mockTripExecutionProvider);
  }
  return providers;
}

/**
 * Composes the real execution providers for a config, without executing
 * anything. The Amadeus provider is always first.
 */
export function getRealExecutionProviders(
  config: AmadeusExecutionConfig = DEFAULT_AMADEUS_EXECUTION_CONFIG,
  options: RealExecutionServiceOptions = {}
): RealExecutionProviders {
  return composeProviders(createAmadeusExecutionProvider(config, options.connection), options);
}

/**
 * Creates the real execution service for a config. Resolves the gate, composes
 * the providers, and reads the capability profile - and does nothing else: no
 * provider is executed, no transport is consulted, no credential is used, and no
 * state is created. Holding the returned handle has no observable effect, which
 * is what makes it safe to create one at module scope in a future server entry
 * point.
 */
export function createRealExecutionService(
  config: AmadeusExecutionConfig = DEFAULT_AMADEUS_EXECUTION_CONFIG,
  options: RealExecutionServiceOptions = {}
): RealExecutionService {
  const amadeusProvider = createAmadeusExecutionProvider(config, options.connection);
  const providers = composeProviders(amadeusProvider, options);
  return {
    gate: getAmadeusExecutionAttemptGate(config),
    providers,
    providerIds: providers.map((provider) => provider.providerId),
    amadeusCapabilityProfile: getAmadeusExecutionCapabilityProfile(config),
    amadeusProvider,
  };
}

/**
 * Re-exported unchanged so a caller that needs the deterministic STEP 60 mock
 * and a caller that needs the Amadeus execution provider can both come from this
 * one boundary. The mock's own semantics are defined in its module and are not
 * altered here.
 */
export { mockTripExecutionProvider };
