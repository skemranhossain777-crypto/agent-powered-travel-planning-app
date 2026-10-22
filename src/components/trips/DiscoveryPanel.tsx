/**
 * Read-only discovery panel (STEP 21; dual-source rendering STEP 43).
 *
 * Presentational front end for external discovery. The panel owns only its
 * local search form; the search lifecycle (`DiscoveryViewState`) is owned by
 * the page. The page chooses the read-only source — the deterministic mock
 * providers (`mockDiscoveryService`) by default, or the authenticated server
 * boundary (`serverDiscoveryClient`) when the non-secret capability flag is on —
 * and tells the panel which via `source` so every label stays honest.
 *
 * Read-only boundaries (mirrors the STEP 14/16 editing boundaries):
 *   - There is no reserve, book, pay, verify, confirm, connect, or "live"
 *     affordance anywhere in this panel. Results are labeled simulated sample
 *     data and always carry the mock disclaimer.
 *   - The panel never persists and never calls `tripService`; a search cannot
 *     mutate the trip, its readiness, or the execution checklist.
 *   - Provider/source identity, retrieval timestamps, freshness/expiry, and
 *     limitations come straight from the normalized `TripProviderResult` and
 *     the shared STEP 20 staleness helpers.
 *   - STEP 22: when the page supplies an optional `handoff` config, each result
 *     card gains a user-triggered "Use as planning reference" action. The panel
 *     only forwards the click (and renders the handoff notice); it never
 *     imports, saves, or persists anything itself.
 *
 * The panel is presentational: `onSearch` hands a normalized `TripDiscoveryQuery`
 * to the page, which runs the service and feeds the outcome back through
 * `state`.
 */

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { getDiscoveryHandoffProblem } from '../../domain/discovery/handoff';
import type { DiscoveryCategory, TripDiscoveryQuery } from '../../domain/providers/discoveryInput';
import {
  getTripProviderResultRecencyWarning,
  type TripProviderResult,
  type TripProviderResultAvailability,
} from '../../domain/providers/providerResults';
import { getProviderSafeErrorCategoryLabel } from '../../domain/providers/executionOperations';
import { getMockAvailabilityLabel } from '../../services/mockDiscovery/mockFixtures';
import type { MockDiscoveryOutcome } from '../../services/mockDiscovery/mockDiscoveryService';
import type { RealDiscoveryOutcome } from '../../services/realDiscovery/realDiscoveryService';

/** The normalized outcome either read-only discovery source can produce (STEP 43). */
export type DiscoveryOutcome = MockDiscoveryOutcome | RealDiscoveryOutcome;

/**
 * Which read-only source the page is wired to (STEP 43). `mock` is the
 * in-app simulated provider set; `external` is the authenticated server
 * boundary, which the page only uses when the non-secret capability flag is on.
 */
export type DiscoverySource = 'mock' | 'external';

/** The discovery lifecycle owned by the page. */
export type DiscoveryViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; searchedAt: string; outcome: DiscoveryOutcome };

/** A notice shown once a result has been added to the planning draft (STEP 22). */
export interface DiscoveryHandoffNotice {
  planId: string;
  kind: 'transport' | 'accommodation';
  title: string;
}

/**
 * Optional STEP 22 handoff extension. When present, each result card gains a
 * user-triggered "Use as planning reference" action; the notice area reports
 * what the user added and how to remove it. The panel only calls these
 * callbacks — the page owns the planning draft, persistence, and guards.
 */
export interface DiscoveryHandoffConfig {
  getPlanId: (resultId: string) => string;
  isPlanPresent: (planId: string) => boolean;
  onImport: (result: TripProviderResult) => void;
  onRemove: (planId: string) => void;
  notice: DiscoveryHandoffNotice | null;
}

interface DiscoveryPanelProps {
  state: DiscoveryViewState;
  onSearch: (query: TripDiscoveryQuery) => void;
  onReset: () => void;
  handoff?: DiscoveryHandoffConfig;
  /** Which read-only source the page is wired to (defaults to the mock path). */
  source?: DiscoverySource;
}

/** Neutral, source-honest availability label for a normalized result. */
function getProviderAvailabilityLabel(availability: TripProviderResultAvailability): string {
  return `Availability: ${availability}`;
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  color: '#fff',
  fontSize: '0.9rem',
  padding: '0.55rem 0.75rem',
  outline: 'none',
  fontFamily: 'inherit',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#e2e8f0',
};

/** Renders an ISO date-time as a deterministic UTC display string. */
function formatDiscoveryDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())} UTC`;
}

/** Formats a price without inventing a live quote (amount + currency code). */
function formatDiscoveryPrice(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

export function DiscoveryPanel({
  state,
  onSearch,
  onReset,
  handoff,
  source = 'mock',
}: DiscoveryPanelProps) {
  const [category, setCategory] = useState<DiscoveryCategory>('transport');
  const [destination, setDestination] = useState('');
  const [origin, setOrigin] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [travelerCount, setTravelerCount] = useState('');
  const [currency, setCurrency] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query: TripDiscoveryQuery = { category, destination: destination.trim() };
    const trimmedOrigin = origin.trim();
    if (trimmedOrigin.length > 0) query.origin = trimmedOrigin;
    if (startDate.length > 0) query.startDate = startDate;
    if (endDate.length > 0) query.endDate = endDate;
    if (travelerCount.length > 0) {
      const parsed = Number(travelerCount);
      if (Number.isFinite(parsed)) query.travelerCount = parsed;
    }
    const trimmedCurrency = currency.trim().toUpperCase();
    if (trimmedCurrency.length > 0) query.currency = trimmedCurrency;
    onSearch(query);
  };

  return (
    <section
      aria-label={
        source === 'external'
          ? 'Discovery search (live provider data)'
          : 'Discovery search (simulated sample data)'
      }
      style={{
        padding: '1.25rem 1.5rem',
        borderRadius: '20px',
        background: 'rgba(15,23,42,0.75)',
        border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '1.25rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.9rem',
        }}
      >
        <p
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#00e5a0',
            margin: 0,
          }}
        >
          Discover &amp; compare
        </p>
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 800,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.12)',
            padding: '0.25rem 0.7rem',
            borderRadius: '9999px',
          }}
        >
          {source === 'external' ? 'Live provider — read-only' : 'Mock data — read-only'}
        </span>
      </div>

      <p
        role="note"
        style={{
          fontSize: '0.8rem',
          color: '#fde68a',
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: '12px',
          padding: '0.6rem 0.8rem',
          margin: '0 0 1rem 0',
        }}
      >
        {source === 'external'
          ? 'Live provider quotes — not verified availability or a booking. Nothing you search here can reserve, book, pay for, or change your trip.'
          : 'Simulated sample data — not live availability or a booking. Nothing you search here can reserve, book, pay for, or change your trip.'}
      </p>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
      >
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            background: 'rgba(255,255,255,0.04)',
            padding: '0.25rem',
            borderRadius: '12px',
            alignSelf: 'flex-start',
          }}
        >
          {(['transport', 'accommodation'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                borderRadius: '9px',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
                background: category === option ? 'rgba(0,229,160,0.25)' : 'transparent',
              }}
            >
              {option === 'transport' ? 'Transport' : 'Accommodation'}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-destination" style={LABEL_STYLE}>
              Destination *
            </label>
            <input
              id="discovery-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="e.g. Tokyo"
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-origin" style={LABEL_STYLE}>
              Origin
            </label>
            <input
              id="discovery-origin"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="e.g. LHR (optional)"
              style={INPUT_STYLE}
            />
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-start" style={LABEL_STYLE}>
              Start date
            </label>
            <input
              id="discovery-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-end" style={LABEL_STYLE}>
              End date
            </label>
            <input
              id="discovery-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-travelers" style={LABEL_STYLE}>
              Travelers
            </label>
            <input
              id="discovery-travelers"
              type="number"
              min={1}
              max={50}
              value={travelerCount}
              onChange={(event) => setTravelerCount(event.target.value)}
              placeholder="1"
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor="discovery-currency" style={LABEL_STYLE}>
              Currency
            </label>
            <input
              id="discovery-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              placeholder="USD"
              maxLength={8}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={state.status === 'loading'}
            className="btn-primary"
            style={{
              padding: '0.55rem 1.2rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <Search className="w-4 h-4" />
            {state.status === 'loading'
              ? source === 'external'
                ? 'Searching live options…'
                : 'Searching sample options…'
              : source === 'external'
                ? 'Search live options'
                : 'Search sample options'}
          </button>
          {state.status === 'complete' && (
            <button
              type="button"
              onClick={onReset}
              className="btn-secondary"
              style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem', fontWeight: 800 }}
            >
              Clear results
            </button>
          )}
          {state.status === 'complete' && (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Searched at {formatDiscoveryDateTime(state.searchedAt)}
            </span>
          )}
        </div>
      </form>

      <div style={{ marginTop: '1.1rem' }}>
        <OutcomeArea state={state} handoff={handoff} source={source} />
      </div>
    </section>
  );
}

function OutcomeArea({
  state,
  handoff,
  source,
}: {
  state: DiscoveryViewState;
  handoff?: DiscoveryHandoffConfig;
  source: DiscoverySource;
}) {
  if (state.status === 'idle') {
    return (
      <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
        {source === 'external'
          ? 'Search to see read-only live provider options. Results never book or change your trip.'
          : 'Search to see simulated sample options from the mock providers. Results never book or change your trip.'}
      </p>
    );
  }

  if (state.status === 'loading') {
    return (
      <p role="status" style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: 0 }}>
        {source === 'external'
          ? 'Consulting the live provider… (read-only, no booking)'
          : 'Consulting mock providers… (read-only, no live data)'}
      </p>
    );
  }

  const { outcome, searchedAt } = state;

  if (outcome.status === 'not-configured') {
    return (
      <div role="alert" style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
        {outcome.error?.message ??
          'Live provider discovery is not configured. Enable the server capability and try again.'}
      </div>
    );
  }

  if (outcome.status === 'invalid-input') {
    return (
      <div role="alert" style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
        {outcome.problem?.message ??
          'That search could not be read. Check the destination and dates and try again.'}
      </div>
    );
  }

  if (outcome.status === 'provider-failure') {
    return (
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <p style={{ fontWeight: 800, color: '#fca5a5', fontSize: '0.85rem', margin: 0 }}>
          {outcome.error
            ? getProviderSafeErrorCategoryLabel(outcome.error.category)
            : 'Search failed'}
        </p>
        <p style={{ fontSize: '0.8rem', color: '#cbd5e1', margin: 0 }}>
          {outcome.error?.message ?? 'The simulated search could not be completed.'}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
          {source === 'external'
            ? 'The live provider request failed — no booking or trip change occurred.'
            : 'This is a controlled mock failure — no live provider was contacted.'}
        </p>
      </div>
    );
  }

  if (outcome.status === 'unsupported') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <p
          role="alert"
          style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 700, margin: 0 }}
        >
          {source === 'external'
            ? 'No live provider supports this category yet.'
            : 'No mock provider supports this category yet.'}
        </p>
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
          {outcome.adaptersConsulted.length > 0
            ? outcome.adaptersConsulted.map((p) => p.name).join(' and ')
            : 'No adapter was consulted'}{' '}
          was consulted, but it reports this capability as unsupported.
        </p>
      </div>
    );
  }

  if (outcome.status === 'unexpected-failure') {
    return (
      <p role="alert" style={{ fontSize: '0.85rem', color: '#fca5a5', margin: 0 }}>
        {source === 'external'
          ? 'The live search returned an unexpected result. Please try again.'
          : 'The simulated search returned an unexpected result. Please try again.'}
      </p>
    );
  }

  if (outcome.status === 'empty') {
    return (
      <p style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: 0 }}>
        {source === 'external'
          ? 'No live options matched this search.'
          : 'No sample options matched this search.'}
      </p>
    );
  }

  const handoffNotice = handoff?.notice ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {handoffNotice !== null && (
        <div
          role="status"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            fontSize: '0.8rem',
            color: '#d1fae5',
            background: 'rgba(0,229,160,0.08)',
            border: '1px solid rgba(0,229,160,0.25)',
            borderRadius: '12px',
            padding: '0.7rem 0.9rem',
          }}
        >
          <p style={{ margin: 0, fontWeight: 800 }}>
            Added “{handoffNotice.title}” to your planning draft as a user-entered reference.
          </p>
          <p style={{ margin: 0 }}>
            Review and save it with the planning editor. Nothing imported here is booked or
            reserved.
          </p>
          <div>
            <button
              type="button"
              onClick={() => handoff?.onRemove(handoffNotice.planId)}
              style={{
                fontSize: '0.75rem',
                fontWeight: 800,
                color: '#0f172a',
                background: '#00e5a0',
                border: 'none',
                borderRadius: '8px',
                padding: '0.3rem 0.7rem',
                cursor: 'pointer',
              }}
            >
              Remove from draft
            </button>
          </div>
        </div>
      )}
      <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
        {outcome.results.length} {source === 'external' ? 'live provider' : 'simulated sample'}{' '}
        option{outcome.results.length === 1 ? '' : 's'}
        {outcome.query?.destination ? ` for ${outcome.query.destination}` : ''} ·{' '}
        {outcome.adaptersConsulted.map((p) => p.name).join(' and ')}
      </p>
      {outcome.results.map((result) => (
        <DiscoveryResultCard
          key={result.resultId}
          result={result}
          now={searchedAt}
          handoff={handoff}
          source={source}
        />
      ))}
    </div>
  );
}

function DiscoveryResultCard({
  result,
  now,
  handoff,
  source,
}: {
  result: TripProviderResult;
  now: string;
  handoff?: DiscoveryHandoffConfig;
  source: DiscoverySource;
}) {
  const recencyWarning = getTripProviderResultRecencyWarning(result, now);
  return (
    <article
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        padding: '0.9rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          <p style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff', margin: 0 }}>
            {result.title}
          </p>
          <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: 0 }}>
            {result.providerName} · {result.resultId}
          </p>
        </div>
        {result.price && (
          <span
            style={{
              fontWeight: 900,
              fontSize: '0.95rem',
              color: '#00e5a0',
              background: 'rgba(0,229,160,0.1)',
              padding: '0.3rem 0.7rem',
              borderRadius: '10px',
            }}
          >
            {formatDiscoveryPrice(result.price.amount, result.price.currency)}
          </span>
        )}
      </div>

      {result.summary && (
        <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0 }}>{result.summary}</p>
      )}

      <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
        {(() => {
          const routeLabel = [result.origin, result.destination]
            .filter((value): value is string => typeof value === 'string')
            .join(' → ');
          return routeLabel.length > 0 ? <span>{routeLabel}</span> : null;
        })()}
        {result.departureAt && (
          <span> · departs {formatDiscoveryDateTime(result.departureAt)}</span>
        )}
        {result.arrivalAt && <span> · arrives {formatDiscoveryDateTime(result.arrivalAt)}</span>}
        {result.durationMinutes !== undefined && (
          <span>
            {' '}
            · {Math.round(result.durationMinutes / 60)}h {result.durationMinutes % 60}m
          </span>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: '#a78bfa', margin: 0 }}>
        {source === 'external'
          ? getProviderAvailabilityLabel(result.availability)
          : getMockAvailabilityLabel(result.availability)}
      </p>

      {result.cancellationPolicy && (
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
          {result.cancellationPolicy}
        </p>
      )}

      {recencyWarning !== undefined && (
        <p role="alert" style={{ fontSize: '0.75rem', color: '#fbbf24', margin: 0 }}>
          {recencyWarning}
        </p>
      )}

      {Array.isArray(result.limitations) && result.limitations.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
          {result.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}

      {result.sourceUrl && (
        <a
          href={result.sourceUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: '0.75rem', color: '#38bdf8' }}
        >
          {source === 'external' ? 'Provider source link' : 'Sample source link'}
        </a>
      )}

      {handoff !== undefined &&
        (() => {
          const problem = getDiscoveryHandoffProblem(result, now);
          const planId = handoff.getPlanId(result.resultId);
          const present = handoff.isPlanPresent(planId);
          if (problem !== null || present) {
            return (
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#94a3b8',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 800, color: present ? '#00e5a0' : '#fbbf24' }}>
                  {present ? 'Added to planning draft' : 'Cannot add'}
                </span>
                {problem !== null && <span>{problem}</span>}
              </p>
            );
          }
          return (
            <button
              type="button"
              onClick={() => handoff.onImport(result)}
              style={{
                alignSelf: 'flex-start',
                fontSize: '0.78rem',
                fontWeight: 800,
                color: '#00e5a0',
                background: 'rgba(0,229,160,0.08)',
                border: '1px solid rgba(0,229,160,0.35)',
                borderRadius: '9px',
                padding: '0.35rem 0.8rem',
                cursor: 'pointer',
              }}
            >
              Use as planning reference
            </button>
          );
        })()}
    </article>
  );
}
