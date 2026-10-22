/**
 * Mock discovery adapter boundary and registry (STEP 21, extended STEP 39).
 *
 * `MockDiscoveryAdapter` is a plain alias for the STEP 20 `ProviderAdapter`,
 * because that interface now declares the single read-only discovery operation
 * `search(query, now)` (added at STEP 39) and returns the same normalized
 * execution envelope a future real adapter will return. The registry maps the
 * two discovery categories to the two deterministic mock adapters, and
 * `DISCOVERY_CATEGORY_CAPABILITY` names the capability id each category needs
 * so the service can gate calls through the STEP 20
 * `providerCapabilityIsOperational` guard before anything runs.
 *
 * Registry-only module: it owns no behavior beyond wiring, so swapping a mock
 * for a real adapter later is a local change at this boundary.
 */

import type { ProviderAdapter } from '../../domain/providers/providerAdapter';
import type { ProviderCapabilityId } from '../../domain/providers/providerCapabilities';
import type { DiscoveryCategory } from '../../domain/providers/discoveryInput';
import { mockAccommodationProviderAdapter } from './mockAccommodationProvider';
import { mockAlternativeTransportProviderAdapter } from './mockAlternativeTransportProvider';
import { mockTransportProviderAdapter } from './mockTransportProvider';

/** The discovery-capable surface a mock adapter implements (read-only). */
export type MockDiscoveryAdapter = ProviderAdapter;

/**
 * All registered mock adapters, in a stable order. The two transport adapters
 * are deliberately distinct sources (STEP 40) so discovery stays truthful about
 * which simulated provider supplied which result and never merges them into one
 * provider during per-result attribution.
 */
export const MOCK_DISCOVERY_ADAPTERS: ReadonlyArray<MockDiscoveryAdapter> = [
  mockTransportProviderAdapter,
  mockAlternativeTransportProviderAdapter,
  mockAccommodationProviderAdapter,
];

/**
 * The mock adapters that serve each discovery category, in a stable order.
 * `transport` is multi-adapter by design: the content rests on convincing but
 * clearly-fake sample options from two different simulated sources, and the
 * orchestrator (STEP 40) runs every adapter in the category and merges their
 * normalized results while keeping each result attribution-honest.
 */
export const MOCK_DISCOVERY_CATEGORY_ADAPTERS: Readonly<
  Record<DiscoveryCategory, ReadonlyArray<MockDiscoveryAdapter>>
> = {
  transport: [mockTransportProviderAdapter, mockAlternativeTransportProviderAdapter],
  accommodation: [mockAccommodationProviderAdapter],
};

/**
 * Legacy single-adapter-per-category view kept for STEP 21 compatibility. New
 * code should read `MOCK_DISCOVERY_CATEGORY_ADAPTERS` so `transport` is backed
 * by both transport mock sources. This alias always resolves `transport` to the
 * primary transport adapter (the first entry of the per-category array).
 */
export const MOCK_DISCOVERY_CATEGORY_ADAPTER: Readonly<
  Record<DiscoveryCategory, MockDiscoveryAdapter>
> = {
  transport: mockTransportProviderAdapter,
  accommodation: mockAccommodationProviderAdapter,
};

/** The capability id each category must be operational for before a search runs. */
export const DISCOVERY_CATEGORY_CAPABILITY: Readonly<
  Record<DiscoveryCategory, ProviderCapabilityId>
> = {
  transport: 'search-transport',
  accommodation: 'search-accommodation',
};
