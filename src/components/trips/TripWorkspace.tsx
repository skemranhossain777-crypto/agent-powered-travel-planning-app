import React from 'react';
import {
  TripAccommodationPlan,
  TripItinerarySnapshot,
  TripPlanningData,
  TripStatus,
  TripTransportPlan,
  TripWorkspace,
} from '../../types/trip';
import { buildTripPlanningData } from '../../domain/trips/tripPlanning';
import {
  countPlanningReferences,
  getEffectivePlanningReferenceState,
  getPlanningReferenceDisplayLabel,
  getPlanningReferenceSummary,
  isLegacyPlanningReference,
} from '../../domain/trips/planningReferenceProjection';
import {
  getPrimarySelectionStatusLabel,
  isPrimarySelectionAttentionState,
  partitionPlanningReferencesWithPrimary,
} from '../../domain/trips/planningReferenceSelection';
import { getPrimaryAssignmentConflictDetail } from '../../domain/trips/planningReferenceConflict';
import { getTripPlanProvenanceLabel } from '../../domain/trips/planningProvenance';
import { Briefcase, CalendarDays, Clock, MapPin } from 'lucide-react';

interface TripWorkspaceViewProps {
  workspace: TripWorkspace;
}

const STATUS_STYLE: Record<TripStatus, { color: string; background: string; border: string }> = {
  draft: {
    color: '#94a3b8',
    background: 'rgba(148,163,184,0.12)',
    border: '1px solid rgba(148,163,184,0.35)',
  },
  planning: {
    color: '#00f2fe',
    background: 'rgba(0,242,254,0.12)',
    border: '1px solid rgba(0,242,254,0.35)',
  },
  ready: {
    color: '#4ade80',
    background: 'rgba(74,222,128,0.12)',
    border: '1px solid rgba(74,222,128,0.35)',
  },
  in_progress: {
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.12)',
    border: '1px solid rgba(251,191,36,0.35)',
  },
  completed: {
    color: '#d8b4fe',
    background: 'rgba(216,180,254,0.12)',
    border: '1px solid rgba(216,180,254,0.35)',
  },
  cancelled: {
    color: '#fca5a5',
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
  },
};

export const TripWorkspaceView: React.FC<TripWorkspaceViewProps> = ({ workspace }) => {
  const statusStyle = STATUS_STYLE[workspace.status];

  return (
    <div className="section-container animate-fade-in">
      <div
        style={{
          padding: '1.5rem',
          borderRadius: '20px',
          background: 'rgba(15,23,42,0.75)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <div>
            <span
              style={{
                padding: '0.28rem 0.8rem',
                borderRadius: '9999px',
                ...statusStyle,
                fontSize: '0.75rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginBottom: '0.5rem',
              }}
            >
              <Briefcase className="w-3.5 h-3.5" />
              {workspace.status}
            </span>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              {workspace.title}
            </h2>
          </div>

          {workspace.dateRange && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#e2e8f0',
              }}
            >
              <CalendarDays className="w-4 h-4" style={{ color: '#00f2fe' }} />
              {workspace.dateRange.startDate} → {workspace.dateRange.endDate}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
            marginBottom: '1.25rem',
          }}
        >
          {workspace.destinations.length > 0 ? (
            workspace.destinations.map((destination) => (
              <div
                key={destination.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.7rem 0.9rem',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <MapPin className="w-4 h-4" style={{ color: '#d8b4fe', flexShrink: 0 }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
                  {destination.name}
                </span>
                {destination.country && (
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {destination.country}
                  </span>
                )}
              </div>
            ))
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>No destinations yet.</p>
          )}
        </div>

        {workspace.itinerary && (
          <>
            <ItinerarySnapshotSection snapshot={workspace.itinerary} />
            <StructuredPlanningSection planning={buildTripPlanningData(workspace)} />
          </>
        )}

        <div
          style={{
            padding: '0.9rem 1rem',
            borderRadius: '14px',
            background: 'rgba(0,242,254,0.06)',
            border: '1px dashed rgba(0,242,254,0.35)',
          }}
        >
          <p
            style={{
              fontSize: '0.78rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#00f2fe',
              margin: '0 0 0.25rem 0',
            }}
          >
            Workspace foundation
          </p>
          <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0 }}>
            Trip shell with an editable itinerary snapshot, ready for planning. Booking, payments,
            live availability, and execution monitoring are intentionally not implemented yet.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Presentational rendering of the optional itinerary snapshot stored on a
 * TripWorkspace. Never mutates the snapshot: it only reads `TripWorkspace` data.
 * Empty content falls back to safe placeholders instead of throwing.
 */
const ItinerarySnapshotSection: React.FC<{ snapshot: TripItinerarySnapshot }> = ({ snapshot }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        marginBottom: '1.25rem',
        padding: '1rem',
        borderRadius: '16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <p
        style={{
          fontSize: '0.78rem',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#d8b4fe',
          margin: 0,
        }}
      >
        Itinerary overview
      </p>

      {snapshot.summary.trim() ? (
        <p style={{ fontSize: '0.9rem', color: '#cbd5e1', margin: 0, lineHeight: 1.55 }}>
          {snapshot.summary}
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>No overview yet.</p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', fontSize: '0.82rem' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{snapshot.travelStyle}</span>
        <span style={{ color: '#e2e8f0', fontWeight: 700 }}>
          {snapshot.durationDays} {snapshot.durationDays === 1 ? 'day' : 'days'}
        </span>
        {snapshot.bestTimeToVisit && (
          <span style={{ color: '#94a3b8' }}>Best time: {snapshot.bestTimeToVisit}</span>
        )}
      </div>

      <div>
        <p
          style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#00f2fe',
            margin: '0 0 0.5rem 0',
          }}
        >
          Day-by-day plan
        </p>
        {snapshot.dayPlans.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
            No day-by-day plan yet.
          </p>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            {snapshot.dayPlans.map((plan) => (
              <div
                key={plan.dayNumber}
                style={{
                  padding: '0.7rem 0.9rem',
                  borderRadius: '12px',
                  background: 'rgba(15,23,42,0.5)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <p style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  Day {plan.dayNumber}
                  {plan.title ? ` — ${plan.title}` : ''}
                </p>
                {plan.activities.length > 0 ? (
                  <ul style={{ margin: '0.5rem 0 0 0', padding: '0', listStyle: 'none' }}>
                    {plan.activities.map((activity, index) => (
                      <li
                        key={`${plan.dayNumber}-${index}`}
                        style={{
                          display: 'flex',
                          gap: '0.5rem',
                          fontSize: '0.82rem',
                          color: '#cbd5e1',
                          padding: '0.35rem 0',
                          alignItems: 'baseline',
                        }}
                      >
                        <Clock
                          className="w-3.5 h-3.5"
                          style={{ color: '#00f2fe', flexShrink: 0 }}
                        />
                        <span>
                          <strong style={{ color: '#e2e8f0' }}>{activity.time}</strong>{' '}
                          <strong style={{ color: '#fff' }}>{activity.title}</strong>
                          {activity.locationName && (
                            <span style={{ color: '#94a3b8' }}> · {activity.locationName}</span>
                          )}
                          {activity.estimatedCost && (
                            <span style={{ color: '#94a3b8' }}> · {activity.estimatedCost}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.4rem 0 0 0' }}>
                    No activities planned for this day.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {snapshot.transport && snapshot.transport.length > 0 && (
        <div>
          <p
            style={{
              fontSize: '0.78rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#fbbf24',
              margin: '0 0 0.5rem 0',
            }}
          >
            Transport
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            {snapshot.transport.map((option, index) => (
              <li key={`transport-${index}`} style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                <strong>{option.mode}</strong>
                {option.route ? ` · ${option.route}` : ''}
                {option.estimatedCost ? ` · ${option.estimatedCost}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snapshot.hotels && snapshot.hotels.length > 0 && (
        <div>
          <p
            style={{
              fontSize: '0.78rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#d8b4fe',
              margin: '0 0 0.5rem 0',
            }}
          >
            Accommodation
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            {snapshot.hotels.map((hotel, index) => (
              <li key={`hotel-${index}`} style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                <strong>{hotel.name}</strong>
                {hotel.area ? ` · ${hotel.area}` : ''}
                {hotel.ratePerNight ? ` · ${hotel.ratePerNight}/night` : ''}
                {hotel.estimatedCost ? ` · ${hotel.estimatedCost}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const SECTION_HEADING_STYLE: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#4ade80',
  margin: '0 0 0.5rem 0',
};

const KIND_LABEL: Record<TripPlanningData['references'][number]['kind'], string> = {
  activity: 'Activity',
  transport: 'Transport',
  accommodation: 'Accommodation',
};

type AnyPlan = TripTransportPlan | TripAccommodationPlan;

const LIFECYCLE_CHIP_STYLE: React.CSSProperties = {
  padding: '0.12rem 0.45rem',
  borderRadius: '9999px',
  fontSize: '0.66rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  border: '1px solid rgba(148,163,184,0.35)',
  color: '#cbd5e1',
  background: 'rgba(148,163,184,0.1)',
  whiteSpace: 'nowrap',
};

const REVIEW_LIFECYCLE_CHIP_STYLE: React.CSSProperties = {
  ...LIFECYCLE_CHIP_STYLE,
  color: '#fbbf24',
  border: '1px solid rgba(251,191,36,0.4)',
  background: 'rgba(251,191,36,0.12)',
};

const SECONDARY_LIFECYCLE_CHIP_STYLE: React.CSSProperties = {
  ...LIFECYCLE_CHIP_STYLE,
  color: '#94a3b8',
  border: '1px solid rgba(100,116,139,0.35)',
  background: 'rgba(100,116,139,0.1)',
};

const PROVENANCE_CHIP_STYLE: React.CSSProperties = {
  padding: '0.12rem 0.45rem',
  borderRadius: '9999px',
  fontSize: '0.66rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  border: '1px solid rgba(167,139,250,0.35)',
  color: '#c4b5fd',
  background: 'rgba(167,139,250,0.1)',
  whiteSpace: 'nowrap',
};

/** Chip for the explicitly selected primary reference (STEP 26). */
const PRIMARY_REFERENCE_CHIP_STYLE: React.CSSProperties = {
  padding: '0.12rem 0.45rem',
  borderRadius: '9999px',
  fontSize: '0.66rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  border: '1px solid rgba(74,222,128,0.4)',
  color: '#86efac',
  background: 'rgba(74,222,128,0.12)',
  whiteSpace: 'nowrap',
};

/** Chip marking a selected primary reference whose plan is no longer effective-active (STEP 27). */
const PRIMARY_ATTENTION_REFERENCE_CHIP_STYLE: React.CSSProperties = {
  padding: '0.12rem 0.45rem',
  borderRadius: '9999px',
  fontSize: '0.66rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  border: '1px solid rgba(251,191,36,0.4)',
  color: '#fbbf24',
  background: 'rgba(251,191,36,0.12)',
  whiteSpace: 'nowrap',
};

function lifecycleChipStyle(plan: AnyPlan): React.CSSProperties {
  const state = getEffectivePlanningReferenceState(plan);
  if (state === 'needs-review') return REVIEW_LIFECYCLE_CHIP_STYLE;
  if (state === 'replaced' || state === 'archived') return SECONDARY_LIFECYCLE_CHIP_STYLE;
  return LIFECYCLE_CHIP_STYLE;
}

function transportPlanHeading(plan: TripTransportPlan): string {
  const parts: string[] = [];
  if (plan.mode) parts.push(plan.mode);
  if (plan.provider) parts.push(plan.provider);
  if (plan.departureLocation || plan.arrivalLocation) {
    parts.push(`${plan.departureLocation ?? ''} → ${plan.arrivalLocation ?? ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Untitled transport plan';
}

function accommodationPlanHeading(plan: TripAccommodationPlan): string {
  const parts: string[] = [];
  if (plan.name) parts.push(plan.name);
  if (plan.location) parts.push(plan.location);
  return parts.length > 0 ? parts.join(' · ') : 'Untitled accommodation plan';
}

function planHeading(kind: 'transport' | 'accommodation', plan: AnyPlan): string {
  return kind === 'transport'
    ? transportPlanHeading(plan as TripTransportPlan)
    : accommodationPlanHeading(plan as TripAccommodationPlan);
}

function planDetail(kind: 'transport' | 'accommodation', plan: AnyPlan): string | undefined {
  const bits: string[] = [];
  if (kind === 'transport') {
    const transport = plan as TripTransportPlan;
    if (transport.departureTime || transport.arrivalTime) {
      bits.push([transport.departureTime, transport.arrivalTime].filter(Boolean).join(' → '));
    }
    if (transport.referenceNumber) bits.push(`Ref ${transport.referenceNumber}`);
  } else {
    const accommodation = plan as TripAccommodationPlan;
    if (accommodation.checkInDate || accommodation.checkOutDate) {
      bits.push(
        [accommodation.checkInDate, accommodation.checkOutDate].filter(Boolean).join(' → ')
      );
    }
    if (accommodation.roomDetails) bits.push(accommodation.roomDetails);
    if (accommodation.referenceNumber) bits.push(`Ref ${accommodation.referenceNumber}`);
  }
  return bits.length > 0 ? bits.join(' · ') : undefined;
}

/**
 * Read-only, lifecycle-aware plan reference list (STEP 25). Splits the plan
 * references into a primary display (`active`/`needs-review`, legacy resolving
 * to active) and an always-visible "Replaced / archived" subgroup. Display
 * only: no editing controls, no mutation of the source arrays, original order
 * preserved, and provenance stays a separate label from lifecycle.
 */
const PlanReferenceRow: React.FC<{
  kind: 'transport' | 'accommodation';
  plan: AnyPlan;
  secondary?: boolean;
  primary?: boolean;
  attention?: boolean;
  attentionTitle?: string;
}> = ({ kind, plan, secondary, primary, attention, attentionTitle }) => {
  const lifecycleNote = isLegacyPlanningReference(plan)
    ? 'Legacy reference — treated as active'
    : undefined;
  return (
    <li
      key={plan.id}
      style={{
        fontSize: '0.82rem',
        color: secondary ? '#94a3b8' : '#e2e8f0',
        padding: '0.3rem 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        opacity: secondary ? 0.85 : 1,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          flexWrap: 'wrap',
        }}
      >
        {primary && (
          <span
            style={PRIMARY_REFERENCE_CHIP_STYLE}
            title="The reference you explicitly chose as the primary for this section."
          >
            Primary reference
          </span>
        )}
        {attention && (
          <span style={PRIMARY_ATTENTION_REFERENCE_CHIP_STYLE} role="status" title={attentionTitle}>
            Primary assignment needs attention
          </span>
        )}
        <span style={lifecycleChipStyle(plan)} title={lifecycleNote}>
          {getPlanningReferenceDisplayLabel(plan)}
        </span>
        {plan.provenance && (
          <span style={PROVENANCE_CHIP_STYLE} title="Where this plan came from">
            {getTripPlanProvenanceLabel(plan.provenance.kind)}
          </span>
        )}
        <strong style={{ color: secondary ? '#cbd5e1' : '#fff' }}>{planHeading(kind, plan)}</strong>
      </span>
      {planDetail(kind, plan) && <span style={{ color: '#94a3b8' }}>{planDetail(kind, plan)}</span>}
    </li>
  );
};

const PlanningReferenceSection: React.FC<{
  title: string;
  kind: 'transport' | 'accommodation';
  plans: ReadonlyArray<AnyPlan>;
  primaryId?: string;
}> = ({ title, kind, plans, primaryId }) => {
  const { partition, resolution } = partitionPlanningReferencesWithPrimary(plans, primaryId);
  const counts = countPlanningReferences(plans);
  const inactiveSelectedId =
    resolution.state === 'selected-plan-inactive' ? resolution.selectedId : undefined;
  const mainRows = [
    ...partition.selected.map((plan) => ({
      plan,
      primary: true as const,
      attention: plan.id === inactiveSelectedId,
    })),
    ...partition.eligibleActive.map((plan) => ({
      plan,
      primary: false as const,
      attention: plan.id === inactiveSelectedId,
    })),
    ...partition.needsReview.map((plan) => ({
      plan,
      primary: false as const,
      attention: plan.id === inactiveSelectedId,
    })),
  ];
  const attentionTitle = getPrimaryAssignmentConflictDetail(resolution) ?? undefined;

  return (
    <div>
      <p style={SECTION_HEADING_STYLE}>{title}</p>
      {counts.total > 0 && (
        <p
          style={{
            fontSize: '0.72rem',
            color: '#94a3b8',
            margin: '0 0 0.5rem 0',
          }}
        >
          {getPlanningReferenceSummary(plans)}
        </p>
      )}
      {counts.total > 0 && resolution.state === 'no-explicit-selection' && (
        <p
          style={{
            fontSize: '0.72rem',
            color: '#64748b',
            margin: '0 0 0.5rem 0',
          }}
        >
          No primary reference selected.
        </p>
      )}
      {isPrimarySelectionAttentionState(resolution.state) && (
        <p
          role="status"
          style={{
            fontSize: '0.74rem',
            color: '#fbbf24',
            margin: '0 0 0.5rem 0',
            lineHeight: 1.4,
          }}
        >
          {getPrimarySelectionStatusLabel(resolution.state)} — {resolution.reason}
        </p>
      )}
      {mainRows.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {mainRows.map(({ plan, primary, attention }) => (
            <PlanReferenceRow
              key={plan.id}
              kind={kind}
              plan={plan}
              primary={primary}
              attention={attention}
              attentionTitle={attentionTitle}
            />
          ))}
        </ul>
      )}
      {partition.secondary.length > 0 && (
        <div
          style={{
            marginTop: '0.6rem',
            padding: '0.6rem 0.7rem',
            borderRadius: '12px',
            background: 'rgba(15,23,42,0.5)',
            border: '1px dashed rgba(100,116,139,0.4)',
          }}
        >
          <p
            style={{
              fontSize: '0.7rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#94a3b8',
              margin: '0 0 0.3rem 0',
            }}
          >
            Replaced / archived ({partition.secondary.length})
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {partition.secondary.map((plan) => (
              <PlanReferenceRow
                key={plan.id}
                kind={kind}
                plan={plan}
                secondary
                attention={plan.id === inactiveSelectedId}
                attentionTitle={attentionTitle}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/**
 * Read-only, structured planning presentation (STEP 13). Renders the derived
 * `TripPlanningData` projection for a Trip Workspace: budget summary, planning
 * notes, and external references. Each block appears only when the canonical
 * data is present; legacy workspaces render no new sections.
 * STEP 25 additions: the transport and accommodation plan references are also
 * rendered read-only, split into a primary display and an always-visible
 * "Replaced / archived" subgroup by the pure lifecycle projection helpers.
 * STEP 26 additions: when the owner explicitly selected a primary reference,
 * that reference renders first labeled "Primary reference"; remaining active
 * references stay visible unlabeled, and a missing or inactive selection
 * surfaces as a concise non-blocking needs-attention notice. No automatic
 * promotion ever happens.
 */
const StructuredPlanningSection: React.FC<{ planning: TripPlanningData }> = ({ planning }) => {
  const hasBudget = planning.budget !== undefined;
  const hasNotes = planning.notes.length > 0;
  const hasReferences = planning.references.length > 0;
  const hasTransportPlans = planning.transportPlans.length > 0;
  const hasAccommodationPlans = planning.accommodationPlans.length > 0;

  if (!hasBudget && !hasNotes && !hasReferences && !hasTransportPlans && !hasAccommodationPlans) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        marginBottom: '1.25rem',
        padding: '1rem',
        borderRadius: '16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <p style={SECTION_HEADING_STYLE}>Structured planning</p>

      {hasTransportPlans && (
        <PlanningReferenceSection
          title="Transport plans"
          kind="transport"
          plans={planning.transportPlans}
          primaryId={planning.primaryTransportPlanId}
        />
      )}

      {hasAccommodationPlans && (
        <PlanningReferenceSection
          title="Accommodation plans"
          kind="accommodation"
          plans={planning.accommodationPlans}
          primaryId={planning.primaryAccommodationPlanId}
        />
      )}

      {planning.budget && (
        <div>
          <p style={SECTION_HEADING_STYLE}>Budget summary</p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            {planning.budget.level && (
              <li style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                <strong>{planning.budget.level}</strong>
              </li>
            )}
            {planning.budget.estimatedTotalCost && (
              <li style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                Estimated total: {planning.budget.estimatedTotalCost}
              </li>
            )}
            {planning.budget.sightseeingCost && (
              <li style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                Sightseeing: {planning.budget.sightseeingCost}
              </li>
            )}
          </ul>
        </div>
      )}

      {planning.notes.length > 0 && (
        <div>
          <p style={SECTION_HEADING_STYLE}>Planning notes</p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            {planning.notes.map((note, index) => (
              <li key={`note-${index}`} style={{ fontSize: '0.84rem', color: '#cbd5e1' }}>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {planning.references.length > 0 && (
        <div>
          <p style={SECTION_HEADING_STYLE}>External references</p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            {planning.references.map((reference, index) => (
              <li
                key={`${reference.id}-${index}`}
                style={{ fontSize: '0.82rem', color: '#cbd5e1' }}
              >
                <span
                  style={{
                    padding: '0.12rem 0.45rem',
                    borderRadius: '9999px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#4ade80',
                    border: '1px solid rgba(74,222,128,0.35)',
                    marginRight: '0.4rem',
                  }}
                >
                  {KIND_LABEL[reference.kind]}
                </span>
                <strong style={{ color: '#fff' }}>{reference.title}</strong>
                {reference.dayNumber && (
                  <span style={{ color: '#94a3b8' }}> · Day {reference.dayNumber}</span>
                )}
                {reference.provider && (
                  <span style={{ color: '#94a3b8' }}> · {reference.provider}</span>
                )}
                {reference.providerId && (
                  <span style={{ color: '#64748b' }}> · {reference.providerId}</span>
                )}
                {reference.estimatedCost && (
                  <span style={{ color: '#94a3b8' }}> · {reference.estimatedCost}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
