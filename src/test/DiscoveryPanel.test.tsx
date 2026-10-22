import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TripProviderResult } from '../domain/providers/providerResults';
import type { MockDiscoveryOutcome } from '../services/mockDiscovery/mockDiscoveryService';
import type { RealDiscoveryOutcome } from '../services/realDiscovery/realDiscoveryService';
import { mockTransportProviderAdapter } from '../services/mockDiscovery/mockTransportProvider';
import { mockAlternativeTransportProviderAdapter } from '../services/mockDiscovery/mockAlternativeTransportProvider';
import { MOCK_RESULT_DISCLAIMER } from '../services/mockDiscovery/mockFixtures';
import { DiscoveryPanel, type DiscoveryViewState } from '../components/trips/DiscoveryPanel';
import type {
  DiscoveryHandoffConfig,
  DiscoveryHandoffNotice,
} from '../components/trips/DiscoveryPanel';

function makeResult(overrides: Partial<TripProviderResult> = {}): TripProviderResult {
  return {
    providerId: 'mock-transport-provider',
    providerName: 'Mock Transport Provider',
    resultId: 'mock-transport-1',
    category: 'transport',
    title: 'Mock Express Rail',
    summary: 'Direct high-speed rail option',
    origin: 'LHR',
    destination: 'Tokyo',
    departureAt: '2026-09-13T10:00:00.000Z',
    arrivalAt: '2026-09-13T14:45:00.000Z',
    durationMinutes: 285,
    price: { amount: 149, currency: 'USD' },
    cancellationPolicy: 'Mock policy: fully refundable until 24 hours before departure.',
    sourceUrl: 'https://mock.example/transport/result-1',
    retrievedAt: '2026-09-13T08:00:00.000Z',
    expiresAt: '2026-09-14T08:00:00.000Z',
    availability: 'available',
    limitations: [MOCK_RESULT_DISCLAIMER, 'Sample timetable.'],
    ...overrides,
  };
}

function makeOutcome(
  status: MockDiscoveryOutcome['status'],
  overrides: Partial<MockDiscoveryOutcome> = {}
): MockDiscoveryOutcome {
  const base: MockDiscoveryOutcome = {
    status,
    adaptersConsulted: [mockTransportProviderAdapter.profile],
    results: [],
    query: { category: 'transport', destination: 'Tokyo' },
    problem: null,
    error: null,
    providerOutcomes: [],
  };
  return { ...base, ...overrides };
}

function renderPanel(state: DiscoveryViewState) {
  const onSearch = vi.fn();
  const onReset = vi.fn();
  const view = render(<DiscoveryPanel state={state} onSearch={onSearch} onReset={onReset} />);
  return { onSearch, onReset, view };
}

describe('DiscoveryPanel form behavior', () => {
  it('shows the idle prompt and the mock-data disclaimer', () => {
    renderPanel({ status: 'idle' });
    expect(screen.getByRole('note')).toHaveTextContent('Simulated sample data');
    expect(screen.getByText(/Search to see simulated sample options/)).toBeInTheDocument();
  });

  it('submits a minimal transport query', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderPanel({ status: 'idle' });

    await user.type(screen.getByLabelText('Destination *'), 'Tokyo');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith({
      category: 'transport',
      destination: 'Tokyo',
    });
  });

  it('submits a full accommodation query including all optional fields', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderPanel({ status: 'idle' });

    await user.click(screen.getByRole('button', { name: 'Accommodation' }));
    await user.type(screen.getByLabelText('Destination *'), 'Osaka');
    await user.type(screen.getByLabelText('Origin'), 'LHR');
    await user.type(screen.getByLabelText('Start date'), '2026-10-01');
    await user.type(screen.getByLabelText('End date'), '2026-10-04');
    await user.type(screen.getByLabelText('Travelers'), '2');
    await user.type(screen.getByLabelText('Currency'), 'eur');
    await user.click(screen.getByRole('button', { name: 'Search sample options' }));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith({
      category: 'accommodation',
      destination: 'Osaka',
      origin: 'LHR',
      startDate: '2026-10-01',
      endDate: '2026-10-04',
      travelerCount: 2,
      currency: 'EUR',
    });
  });

  it('disables the search button while loading and shows the loading message', () => {
    renderPanel({ status: 'loading' });
    expect(screen.getByRole('button', { name: 'Searching sample options…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Consulting mock providers…');
  });
});

describe('DiscoveryPanel outcome states', () => {
  it('renders result cards with price, source identity, availability, and limitations', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    };
    renderPanel(state);

    expect(screen.getByText('Mock Express Rail')).toBeInTheDocument();
    expect(screen.getByText('Mock Transport Provider · mock-transport-1')).toBeInTheDocument();
    expect(screen.getByText('149.00 USD')).toBeInTheDocument();
    expect(screen.getByText('Simulated availability: available')).toBeInTheDocument();
    expect(screen.getByText(MOCK_RESULT_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sample source link' })).toHaveAttribute(
      'href',
      'https://mock.example/transport/result-1'
    );
    expect(screen.getByText(/LHR → Tokyo/)).toBeInTheDocument();
    expect(screen.getByText(/departs 2026-09-13 10:00 UTC/)).toBeInTheDocument();
  });

  it('shows the empty state for an empty result set', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('empty'),
    };
    renderPanel(state);
    expect(screen.getByText(/No sample options matched this search/)).toBeInTheDocument();
  });

  it('shows the unsupported state with the consulted adapter name', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('unsupported'),
    };
    renderPanel(state);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /No mock provider supports this category yet/
    );
    expect(screen.getByText(/Mock Transport Provider was consulted/)).toBeInTheDocument();
  });

  it('shows a bounded safe label for a provider failure', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('provider-failure', {
        error: {
          category: 'provider-unavailable',
          message: 'The simulated transport search could not be completed.',
        },
      }),
    };
    renderPanel(state);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(
      screen.getByText(/The simulated transport search could not be completed/)
    ).toBeInTheDocument();
    expect(screen.getByText(/controlled mock failure/)).toBeInTheDocument();
  });

  it('shows the validation problem message for invalid input', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('invalid-input', {
        problem: {
          code: 'end-before-start',
          message: 'The end date must not be before the start date.',
        },
      }),
    };
    renderPanel(state);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The end date must not be before the start date.'
    );
  });

  it('shows a safe generic message for an unexpected failure', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('unexpected-failure'),
    };
    renderPanel(state);
    expect(screen.getByRole('alert')).toHaveTextContent(/returned an unexpected result/);
  });

  it('warns when a result is expired instead of treating it as current', () => {
    const expiredResult = makeResult({
      expiresAt: '2026-09-12T08:00:00.000Z',
    });
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [expiredResult] }),
    };
    renderPanel(state);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /is expired and must not be treated as current/
    );
  });

  it('shows the searched-at timestamp and offers a working Clear results action', async () => {
    const user = userEvent.setup();
    const { onReset } = renderPanel({
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    });

    expect(screen.getByText(/Searched at 2026-09-13 08:00 UTC/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear results' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('never renders a booking/reserve/pay/verify action anywhere', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    };
    renderPanel(state);
    expect(
      screen.queryByRole('button', { name: /book|reserve|pay|verify|confirm/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/book now|reserve now|pay now|confirm booking|book this|reserve this/i)
    ).not.toBeInTheDocument();
  });
});

function makeHandoffConfig(
  overrides: Partial<{
    getPlanId: (resultId: string) => string;
    isPlanPresent: (planId: string) => boolean;
    onImport: (result: TripProviderResult) => void;
    onRemove: (planId: string) => void;
    notice: DiscoveryHandoffNotice | null;
  }> = {}
): {
  config: DiscoveryHandoffConfig;
  onImport: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
} {
  const onImport = vi.fn();
  const onRemove = vi.fn();
  const config: DiscoveryHandoffConfig = {
    getPlanId: (resultId) => `handoff-${resultId}`,
    isPlanPresent: () => false,
    onImport,
    onRemove,
    notice: null,
    ...overrides,
  };
  return { config, onImport, onRemove };
}

function renderPanelWithHandoff(state: DiscoveryViewState, config: DiscoveryHandoffConfig) {
  const view = render(
    <DiscoveryPanel state={state} onSearch={vi.fn()} onReset={vi.fn()} handoff={config} />
  );
  return { view };
}

describe('DiscoveryPanel STEP 22 handoff', () => {
  it('renders a Use as planning reference action per card and forwards the click', async () => {
    const user = userEvent.setup();
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    };
    const { config, onImport } = makeHandoffConfig();
    renderPanelWithHandoff(state, config);

    const action = screen.getByRole('button', { name: 'Use as planning reference' });
    await user.click(action);

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ resultId: 'mock-transport-1', title: 'Mock Express Rail' })
    );
  });

  it('shows Added to planning draft and disables the action for an already-imported result', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    };
    const { config } = makeHandoffConfig({ isPlanPresent: () => true });
    renderPanelWithHandoff(state, config);

    expect(screen.getByText('Added to planning draft')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use as planning reference' })
    ).not.toBeInTheDocument();
  });

  it('blocks the handoff for an expired result with the expiry problem text', () => {
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', {
        results: [makeResult({ expiresAt: '2026-09-12T08:00:00.000Z' })],
      }),
    };
    const { config } = makeHandoffConfig();
    renderPanelWithHandoff(state, config);

    expect(screen.getByText('Cannot add')).toBeInTheDocument();
    expect(
      screen.getByText('This quote has expired and must not be used as planning data.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use as planning reference' })
    ).not.toBeInTheDocument();
  });

  it('renders the handoff notice with a working Remove from draft action', async () => {
    const user = userEvent.setup();
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', { results: [makeResult()] }),
    };
    const { config, onRemove } = makeHandoffConfig({
      notice: { planId: 'handoff-mock-transport-1', kind: 'transport', title: 'Mock Express Rail' },
    });
    renderPanelWithHandoff(state, config);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Added “Mock Express Rail” to your planning draft as a user-entered reference.'
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing imported here is booked or reserved.'
    );
    await user.click(screen.getByRole('button', { name: 'Remove from draft' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('handoff-mock-transport-1');
  });
});

describe('DiscoveryPanel STEP 40 multi-provider attribution', () => {
  it('attributes every card to its own provider and names every consulted adapter', () => {
    const alternative = makeResult({
      providerId: mockAlternativeTransportProviderAdapter.id(),
      providerName: mockAlternativeTransportProviderAdapter.name(),
      resultId: 'mock-alt-transport-1',
      title: 'Mock Alternative Coastal Link',
    });
    const state: DiscoveryViewState = {
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: makeOutcome('success', {
        results: [makeResult(), alternative],
        adaptersConsulted: [
          mockTransportProviderAdapter.profile,
          mockAlternativeTransportProviderAdapter.profile,
        ],
      }),
    };
    renderPanel(state);

    expect(screen.getByText('Mock Transport Provider · mock-transport-1')).toBeInTheDocument();
    expect(
      screen.getByText('Mock Alternative Transport Provider · mock-alt-transport-1')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '2 simulated sample options for Tokyo · Mock Transport Provider and Mock Alternative Transport Provider'
      )
    ).toBeInTheDocument();
  });
});

describe('DiscoveryPanel STEP 43 external server-boundary source', () => {
  const externalResult = makeResult({
    providerId: 'amadeus-self-service',
    providerName: 'Amadeus Self-Service',
    resultId: 'H-1:O-1',
    title: 'Amadeus Hotel Offer',
    sourceUrl: 'https://test.api.amadeus.com/hotel-offers/H-1:O-1',
  });

  const externalProfile = {
    ...mockTransportProviderAdapter.profile,
    id: 'amadeus-self-service',
    name: 'Amadeus Self-Service',
  };

  const externalSuccess: RealDiscoveryOutcome = {
    status: 'success',
    adaptersConsulted: [externalProfile],
    results: [externalResult],
    query: { category: 'transport', destination: 'Tokyo' },
    problem: null,
    error: null,
    providerOutcomes: [],
  };

  function renderExternal(state: DiscoveryViewState) {
    const onSearch = vi.fn();
    const onReset = vi.fn();
    render(
      <DiscoveryPanel state={state} source="external" onSearch={onSearch} onReset={onReset} />
    );
    return { onSearch, onReset };
  }

  it('labels the panel as read-only live provider data without claiming a booking', () => {
    renderExternal({ status: 'idle' });
    expect(screen.getByRole('note')).toHaveTextContent('Live provider quotes');
    expect(screen.getByRole('note')).toHaveTextContent('or a booking');
    expect(screen.getByText(/Search to see read-only live provider options/)).toBeInTheDocument();
    expect(screen.getByText('Live provider — read-only')).toBeInTheDocument();
    expect(screen.queryByText('Mock data — read-only')).not.toBeInTheDocument();
  });

  it('uses live copy for the search action and loading state', () => {
    renderExternal({ status: 'loading' });
    expect(screen.getByRole('button', { name: 'Searching live options…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Consulting the live provider…');
  });

  it('renders provider attribution, result id, neutral availability, and provider source link', () => {
    renderExternal({
      status: 'complete',
      searchedAt: '2026-09-13T08:00:00.000Z',
      outcome: externalSuccess,
    });

    expect(screen.getByText('Amadeus Hotel Offer')).toBeInTheDocument();
    expect(screen.getByText('Amadeus Self-Service · H-1:O-1')).toBeInTheDocument();
    expect(screen.getByText('Availability: available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Provider source link' })).toHaveAttribute(
      'href',
      'https://test.api.amadeus.com/hotel-offers/H-1:O-1'
    );
    expect(
      screen.getByText('1 live provider option for Tokyo · Amadeus Self-Service')
    ).toBeInTheDocument();
    expect(screen.queryByText('Simulated availability: available')).not.toBeInTheDocument();
  });

  it('shows a bounded not-configured message when the boundary is unavailable', () => {
    const outcome: RealDiscoveryOutcome = {
      status: 'not-configured',
      adaptersConsulted: [],
      results: [],
      query: null,
      problem: null,
      error: { category: 'not-implemented', message: 'Real discovery is not enabled.' },
      providerOutcomes: [],
    };
    renderExternal({ status: 'complete', searchedAt: '2026-09-13T08:00:00.000Z', outcome });
    expect(screen.getByRole('alert')).toHaveTextContent('Real discovery is not enabled.');
  });
});
