import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripPlanningData } from '../types/trip';
import { AiPlanningError, generateTripPlanningProposal } from '../services/aiPlanningService';

const h = vi.hoisted(() => {
  const behaviors: Record<string, () => string> = {};
  const callCount: Record<string, number> = {};
  return { behaviors, callCount };
});

vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...actual,
    getGenerativeModel: vi.fn((_ai: unknown, config: { model?: string }) => ({
      model: config?.model,
      generateContent: vi.fn(async () => {
        const alias = config?.model || '';
        h.callCount[alias] = (h.callCount[alias] || 0) + 1;
        return { response: { text: () => (h.behaviors[alias] || (() => '{}'))() } };
      }),
    })),
  };
});

vi.mock('../services/firebase', () => ({
  getAIService: vi.fn(() => ({})),
}));

function currentPlanning(): TripPlanningData {
  return {
    dates: { startDate: '2026-09-11', endDate: '2026-09-15' },
    destinations: [{ id: 'd1', name: 'Ubud', country: 'Indonesia' }],
    days: [{ dayNumber: 1, title: 'Arrival', theme: 'Settle in', activities: [] }],
    transportation: [],
    accommodation: [],
    transportPlans: [],
    accommodationPlans: [],
    notes: ['Book early'],
    references: [],
  };
}

function validProposalJson(): string {
  return JSON.stringify({
    explanation: 'Moves the beach day to day 2.',
    warnings: ['Day numbering shifts with the change.'],
    assumptions: ['Weather remains mild.'],
    update: {
      dateRange: { startDate: '2026-09-12', endDate: '2026-09-16' },
      destinations: [
        { id: 'd1', name: 'Ubud', country: 'Indonesia' },
        { id: 'dst-1', name: 'Canggu', country: 'Indonesia' },
      ],
    },
  });
}

describe('generateTripPlanningProposal', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.behaviors = {};
    h.callCount = {};
  });

  it('returns a normalized proposal from a valid model response', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => validProposalJson();

    const proposal = await generateTripPlanningProposal(currentPlanning(), 'Move the beach day');

    expect(proposal.explanation).toBe('Moves the beach day to day 2.');
    expect(proposal.warnings).toEqual(['Day numbering shifts with the change.']);
    expect(proposal.assumptions).toEqual(['Weather remains mild.']);
    expect(proposal.update.dateRange).toEqual({
      startDate: '2026-09-12',
      endDate: '2026-09-16',
    });
    expect(proposal.update.destinations).toHaveLength(2);
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
  });

  it('returns a shallow proposal for a minimal valid response', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({ explanation: 'Tighten notes.', update: { notes: ['Pack layers'] } });

    const proposal = await generateTripPlanningProposal(currentPlanning(), 'Trim the notes');
    expect(proposal.update.notes).toEqual(['Pack layers']);
    expect(proposal.update.dateRange).toBeUndefined();
  });

  it('rejects an empty instruction BEFORE any model call (invalid-input)', async () => {
    await expect(generateTripPlanningProposal(currentPlanning(), '   ')).rejects.toThrow(
      AiPlanningError
    );
    await expect(generateTripPlanningProposal(currentPlanning(), '')).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(h.callCount['gemini-3.5-flash-lite']).toBeUndefined();
  });

  it('rejects an overlong instruction before any model call (invalid-input)', async () => {
    await expect(
      generateTripPlanningProposal(currentPlanning(), 'x'.repeat(1001))
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(h.callCount['gemini-3.5-flash-lite']).toBeUndefined();
  });

  it('rejects an invalid currentPlanning payload before any model call (invalid-input)', async () => {
    await expect(
      generateTripPlanningProposal('not-planning' as unknown as TripPlanningData, 'Move something')
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(h.callCount['gemini-3.5-flash-lite']).toBeUndefined();
  });

  it('uses the trimmed instruction and returns a safe error on invalid JSON (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => 'not-json {';
    await expect(
      generateTripPlanningProposal(currentPlanning(), '  Surf lesson  ')
    ).rejects.toMatchObject({ code: 'invalid-output' });
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
  });

  it('rejects a proposal with unknown top-level keys (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: {},
        budget: { estimatedTotalCost: '$0' },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects update sections planning cannot edit (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({ explanation: 'x', update: { transport: [] } });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects an unsafe reference url (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: {
          references: [{ id: 'ref-1', kind: 'activity', title: 'T', url: 'javascript:alert(1)' }],
        },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects duplicate destination ids (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: {
          destinations: [
            { id: 'dst-1', name: 'Ubud', country: 'Indonesia' },
            { id: 'dst-1', name: 'Canggu', country: 'Indonesia' },
          ],
        },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects a proposal with no explanation (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => JSON.stringify({ warnings: [], update: {} });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects an invalid date range (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: { dateRange: { startDate: '2026-09-20', endDate: '2026-09-10' } },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects an invalid destination record (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: { destinations: [{ id: 'dst-1', name: '   ', country: 'Indonesia' }] },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects an invalid activity (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: {
          days: [
            {
              dayNumber: 1,
              title: 'Beach',
              theme: 'Sun',
              activities: [{ time: '09:00', title: 'Swim' }],
            },
          ],
        },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('rejects an invalid reference (invalid-output)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () =>
      JSON.stringify({
        explanation: 'x',
        update: { references: [{ id: 'ref-1', kind: 'activity', title: '   ' }] },
      });
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'invalid-output' }
    );
  });

  it('falls back to the next alias on a retriable provider error', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('429 RESOURCE_EXHAUSTED: quota exceeded');
    };
    h.behaviors['gemini-3.6-flash'] = () => validProposalJson();

    const proposal = await generateTripPlanningProposal(currentPlanning(), 'Move the beach day');
    expect(proposal.update.dateRange?.startDate).toBe('2026-09-12');
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
    expect(h.callCount['gemini-3.6-flash']).toBe(1);
  });

  it('does not retry when the provider fails non-retriably (unavailable)', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('network disconnected');
    };
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      { code: 'unavailable' }
    );
    expect(h.callCount['gemini-3.5-flash-lite']).toBe(1);
    expect(h.callCount['gemini-3.6-flash']).toBeUndefined();
  });

  it('returns a safe unavailable message when every alias exhausts quota', async () => {
    for (const alias of [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
    ]) {
      h.behaviors[alias] = () => {
        throw new Error('RESOURCE_EXHAUSTED');
      };
    }
    await expect(generateTripPlanningProposal(currentPlanning(), 'anything')).rejects.toMatchObject(
      {
        code: 'unavailable',
        message: expect.stringMatching(/free-tier limit|busy/),
      }
    );
  });

  it('never exposes raw provider detail or model JSON in its messages', async () => {
    h.behaviors['gemini-3.5-flash-lite'] = () => {
      throw new Error('TOKEN-wants-credit-card-details');
    };
    const error = await generateTripPlanningProposal(currentPlanning(), 'anything').then(
      () => null,
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(AiPlanningError);
    expect(String((error as AiPlanningError).message)).not.toMatch(/credit.card|TOKEN/);
  });
});
