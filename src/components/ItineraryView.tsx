import React, { useState } from 'react';
import { Itinerary } from '../types/travel';
import { Sparkles, Clock, MapPin, BookmarkCheck, Download, Trash2, CheckCircle } from 'lucide-react';

interface ItineraryViewProps {
  itinerary: Itinerary;
  onSaveItinerary?: (itinerary: Itinerary) => void;
  onDeleteItinerary?: (id: string) => void;
  isSaved?: boolean;
}

export const ItineraryView: React.FC<ItineraryViewProps> = ({
  itinerary,
  onSaveItinerary,
  onDeleteItinerary,
  isSaved = false
}) => {
  const [activeDay, setActiveDay] = useState(1);
  const [savedSuccess, setSavedSuccess] = useState(isSaved);

  const handleSave = () => {
    if (onSaveItinerary) {
      onSaveItinerary(itinerary);
      setSavedSuccess(true);
    }
  };

  const handleExportText = () => {
    let text = `✈️ VOYAGE AI ITINERARY: ${itinerary.destination.toUpperCase()} (${itinerary.durationDays} DAYS)\n`;
    text += `Summary: ${itinerary.summary}\n`;
    text += `Estimated Cost: ${itinerary.estimatedTotalCost}\n\n`;

    itinerary.dayPlans.forEach((day) => {
      text += `--- DAY ${day.dayNumber}: ${day.title} ---\n`;
      day.activities.forEach((act) => {
        text += `• ${act.time} - ${act.title} (${act.locationName}): ${act.description}\n`;
      });
      text += `\n`;
    });

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${itinerary.destination.toLowerCase().replace(/\s+/g, '-')}-itinerary.txt`;
    link.click();
  };

  const currentDayPlan = itinerary.dayPlans.find(d => d.dayNumber === activeDay) || itinerary.dayPlans[0];

  return (
    <div className="section-container animate-fade-in">
      
      {/* Header Banner */}
      <div style={{ padding: '2rem', borderRadius: '24px', background: 'linear-gradient(135deg, rgba(112,0,255,0.2), rgba(0,242,254,0.1), rgba(15,23,42,0.9))', border: '1px solid rgba(255,255,255,0.12)', marginBottom: '2rem' }}>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justify: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', background: 'rgba(0, 242, 254, 0.15)', border: '1px solid rgba(0, 242, 254, 0.4)', color: '#00f2fe', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.75rem' }}>
              <Sparkles className="w-3.5 h-3.5" />
              AI Generated Itinerary
            </span>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              {itinerary.durationDays}-Day Trip to {itinerary.destination}
            </h1>
            <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginTop: '0.5rem', maxWidth: '650px' }}>
              {itinerary.summary}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {onSaveItinerary && (
              <button
                type="button"
                onClick={handleSave}
                className="btn-primary"
                style={{ padding: '0.6rem 1.2rem', fontSize: '0.85rem' }}
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <BookmarkCheck className="w-4 h-4" />
                    Save Itinerary
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleExportText}
              className="btn-secondary"
              title="Export Itinerary as Text File"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              Export
            </button>

            {onDeleteItinerary && (
              <button
                type="button"
                onClick={() => onDeleteItinerary(itinerary.id)}
                className="btn-icon"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
                title="Delete Itinerary"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Budget Level</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#10b981' }}>{itinerary.budgetLevel}</span>
          </div>

          <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Travel Style</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#d8b4fe' }}>{itinerary.travelStyle}</span>
          </div>

          <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Estimated Total</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#00f2fe' }}>{itinerary.estimatedTotalCost}</span>
          </div>

          <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>Best Season</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>{itinerary.bestTimeToVisit}</span>
          </div>
        </div>

      </div>

      {/* Day Selector Buttons */}
      <div className="category-scroll-row" style={{ marginBottom: '1.5rem' }}>
        {itinerary.dayPlans.map((dp) => {
          const isActive = dp.dayNumber === activeDay;
          return (
            <button
              type="button"
              key={dp.dayNumber}
              onClick={() => setActiveDay(dp.dayNumber)}
              className={`category-btn ${isActive ? 'active' : ''}`}
              style={{ padding: '0.6rem 1.2rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem' }}
            >
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800 }}>Day {dp.dayNumber}</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{dp.theme}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Day Activities Schedule */}
      {currentDayPlan && (
        <div style={{ padding: '2rem', background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#00f2fe' }}>
              Day {currentDayPlan.dayNumber} Schedule
            </span>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginTop: '0.25rem' }}>
              {currentDayPlan.title}
            </h3>
          </div>

          <div style={{ position: 'relative', paddingLeft: '1.75rem', borderLeft: '2px solid rgba(0, 242, 254, 0.3)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {currentDayPlan.activities.map((act, index) => (
              <div key={index} style={{ position: 'relative' }}>
                
                {/* Timeline Dot */}
                <div style={{ position: 'absolute', left: '-2.35rem', top: '0.35rem', width: '14px', height: '14px', borderRadius: '50%', background: '#040812', border: '2px solid #00f2fe' }} />

                <div style={{ padding: '1.25rem', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', background: 'rgba(0, 242, 254, 0.1)', border: '1px solid rgba(0, 242, 254, 0.3)', color: '#00f2fe', fontSize: '0.75rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Clock className="w-3.5 h-3.5" />
                      {act.time}
                    </span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', background: 'rgba(112, 0, 255, 0.15)', color: '#d8b4fe', fontSize: '0.75rem', fontWeight: 600 }}>
                        {act.category}
                      </span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#10b981' }}>
                        {act.estimatedCost}
                      </span>
                    </div>
                  </div>

                  <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
                    {act.title}
                  </h4>

                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.5rem' }}>
                    <MapPin className="w-3.5 h-3.5" />
                    {act.locationName}
                  </p>

                  <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                    {act.description}
                  </p>
                </div>

              </div>
            ))}
          </div>

        </div>
      )}

    </div>
  );
};
