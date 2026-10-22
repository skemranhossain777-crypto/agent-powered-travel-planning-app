import { getGenerativeModel, Schema, GenerativeModel } from 'firebase/ai';
import { getAIService } from './firebase';
import type { TripPlanningData, TripPlanningProposal } from '../types/trip';
import {
  normalizeTripPlanningProposal,
  normalizeTripPlanningRequest,
} from '../domain/trips/tripPlanningProposal';

/**
 * AI planning service boundary (STEP 15).
 *
 * This module is the ONLY place where a model is asked to draft a planning
 * proposal, and it is deliberately firewalled:
 *   - It imports NO dataConnect, placeImages, Firestore, or tripService code —
 *     it cannot persist, rename, book, or mutate a trip, so it structurally
 *     cannot write to Firestore.
 *   - It takes only the current structured planning projection plus the user
 *     instruction. No owner ids, document ids, tokens, or private metadata.
 *   - Every response passes through `normalizeTripPlanningProposal()`, whose
 *     `update` is enforced by the shared strict `normalizeTripPlanningUpdate()`
 *     domain boundary — the exact same gate used by manual editing.
 *   - The result is a *proposal only*. Persistence happens exclusively through
 *     the existing `updateTripPlanning` persistence boundary (owned by
 *     `tripService`) after explicit user review.
 *
 * Errors are always safe, pre-baked `AiPlanningError`s — raw provider errors
 * and model output are never surfaced to the UI verbatim.
 */

/** Gemini text model aliases to try in order (same roster as the travel agent). */
const PLANNING_MODEL_ALIASES = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
];

const planningModels: Record<string, GenerativeModel> = {};

/** Lazily builds models. getGenerativeModel itself does not hit the network. */
function getPlanningModel(alias: string): GenerativeModel {
  if (!planningModels[alias]) {
    const ai = getAIService();
    planningModels[alias] = getGenerativeModel(ai, {
      model: alias,
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: PROPOSAL_SCHEMA,
      },
      systemInstruction: PLANNING_SYSTEM_INSTRUCTION,
    });
  }
  return planningModels[alias];
}

/**
 * Structured-output schema for a planning proposal. It mirrors the proposal
 * envelope so the model returns JSON shaped close to the domain, but it is
 * deliberately permissive (every property optional). The authoritative gate is
 * still the strict domain normalizer, which rejects anything the schema does
 * not capture (unknown keys, unsafe urls, duplicates, invalid shapes).
 *
 * Reflecting the STEP 14 semantics, `dateRange` accepts an object OR null —
 * null is how an edit clears persisted dates. The schema intentionally has no
 * transport, accommodation, or budget keys: the AI may only propose changes to
 * the five editable sections (dates, destinations, days, notes, references).
 */
const PROPOSAL_SCHEMA = Schema.object({
  description: 'Approved proposal-shaped envelope for a trip planning edit',
  properties: {
    explanation: Schema.string({ description: 'Concise explanation of the proposed change' }),
    warnings: Schema.array({
      description: 'Review-required risks the change could introduce',
      items: Schema.string(),
    }),
    assumptions: Schema.array({
      description: 'Non-blocking assumptions made while drafting',
      items: Schema.string(),
    }),
    update: Schema.object({
      description: 'Structured editing update (full replacement sections only)',
      properties: {
        dateRange: Schema.object({
          description: 'Inclusive trip dates, or null to clear a saved date range',
          properties: {
            startDate: Schema.string({ description: 'YYYY-MM-DD' }),
            endDate: Schema.string({ description: 'YYYY-MM-DD' }),
          },
        }),
        destinations: Schema.array({
          description: 'Full destination list (preserve every existing id)',
          items: Schema.object({
            properties: {
              id: Schema.string(),
              name: Schema.string(),
              country: Schema.string(),
            },
          }),
        }),
        days: Schema.array({
          description: 'Full day-plan list (preserve every existing dayNumber)',
          items: Schema.object({
            properties: {
              dayNumber: Schema.integer(),
              title: Schema.string(),
              theme: Schema.string(),
              activities: Schema.array({
                items: Schema.object({
                  properties: {
                    id: Schema.string(),
                    time: Schema.string(),
                    title: Schema.string(),
                    description: Schema.string(),
                    locationName: Schema.string(),
                    category: Schema.string(),
                    estimatedCost: Schema.string(),
                  },
                }),
              }),
            },
          }),
        }),
        notes: Schema.array({ items: Schema.string() }),
        references: Schema.array({
          description: 'Identifier-only bookable-component references',
          items: Schema.object({
            properties: {
              id: Schema.string(),
              title: Schema.string(),
              url: Schema.string(),
              dayNumber: Schema.integer(),
              provider: Schema.string(),
              estimatedCost: Schema.string(),
              kind: Schema.string(),
            },
          }),
        }),
      },
    }),
  },
});

const PLANNING_SYSTEM_INSTRUCTION = [
  'You are a travel-planning editor inside a trip planning app. You propose structured edits to an existing trip plan. You never persist anything and you never book or pay for anything — the human reviews and approves your proposal before it is saved.',
  '',
  'Return ONLY valid JSON matching exactly this envelope:',
  '{ "explanation": string, "warnings": [string], "assumptions": [string], "update": { "dateRange": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" } | null, "destinations": [ { "id": string, "name": string, "country": string } ], "days": [ { "dayNumber": number, "title": string, "theme": string, "activities": [ { "id": string, "time": string, "title": string, "description": string, "locationName": string, "category": string, "estimatedCost": string } ] } ], "notes": [string], "references": [ { "id": string, "title": string, "url": string, "dayNumber": number, "provider": string, "estimatedCost": string, "kind": "accommodation" | "activity" | "food" | "transport" } ] } }',
  '',
  'Editing rules:',
  '- The only allowed keys in "update" are dateRange, destinations, days, notes, references. Never emit transport, accommodation, hotels, budget, booking, payment, availability, or execution fields.',
  '- To change a section, output the FULL replacement array with every existing id preserved: destinations keep their "id", days keep their exact "dayNumber", activities keep their "id", references keep their "id". Sections you want unchanged must be omitted from "update" entirely.',
  '- Do not regenerate a section unless the instruction requires a change to that section.',
  '- New ids must use only "dst-N", "act-N", or "ref-N" (N ascending). Never invent timestamp-based or freeform ids.',
  '- Never change the number of days unless the instruction explicitly says so. If day numbers shift, add a warning.',
  '- When you change dates, add a warning if the shift affects planned activities or seasonal assumptions.',
  '- To clear a saved date range, set dateRange to null; a warning is required.',
  '- URLs must be http(s) only. Never invent insider booking tokens, account ids, or payment links.',
  '- Keep every value realistic and concrete. Do not invent specific real businesses as if they are booked.',
  '- explanation: 1-3 concise sentences naming the sections you changed and why. warnings: only genuine risks. assumptions: only non-blocking assumptions.',
  '',
].join('\n');

function buildPlanningPrompt(
  currentPlanning: TripPlanningData,
  instruction: string,
  constraints: string[]
): string {
  const lines: string[] = [
    'The current structured plan is provided as JSON below. Propose the minimal edit that satisfies the user instruction.',
    '',
    'CURRENT PLAN:',
    JSON.stringify(currentPlanning),
    '',
    `USER INSTRUCTION: ${instruction}`,
  ];
  if (constraints.length) {
    lines.push('', `HONORED CONSTRAINTS: ${constraints.join('; ')}`);
  }
  lines.push('', 'Return only the proposal JSON described in your system instructions.');
  return lines.join('\n');
}

function isRetriableModelError(message: string): boolean {
  const m = message.toLowerCase();
  return /quota|rate limit|resource exhausted|high demand|busy|too many|no longer available|not found|429|500|503/.test(
    m
  );
}

/**
 * Runs `invoke` against a freshly built model for each alias until one
 * succeeds. Transient errors (high demand, free-tier quota, retired-model
 * 404s) cause a retry on the next alias.
 */
async function runWithPlanningModelFallback(
  invoke: (model: GenerativeModel) => Promise<string>
): Promise<string> {
  let lastError: unknown = null;
  for (const alias of PLANNING_MODEL_ALIASES) {
    try {
      return await invoke(getPlanningModel(alias));
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      if (!isRetriableModelError(detail)) {
        throw err;
      }
      console.warn(
        `[AiPlanningService] model ${alias} unavailable (${detail.slice(0, 140)}); trying fallback alias.`
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Error codes the UI can branch on; messages are always safe for display. */
export type AiPlanningErrorCode = 'invalid-input' | 'invalid-output' | 'unavailable';

export class AiPlanningError extends Error {
  readonly code: AiPlanningErrorCode;
  constructor(code: AiPlanningErrorCode, message: string) {
    super(message);
    this.name = 'AiPlanningError';
    this.code = code;
  }
}

/**
 * Drafts a validated `TripPlanningProposal` from the current structured plan
 * and a user instruction. The AI never writes anything; the returned proposal
 * only describes an edit for the human to review and approve.
 *
 * - invalid-input: instruction empty or exceeds MAX_PLANNING_INSTRUCTION_LENGTH
 *   (checked before any model call), or currentPlanning fails domain validation.
 * - invalid-output: the model returned something the strict domain boundary
 *   could not repair (parse failure or rejected proposal shape).
 * - unavailable: the provider was unreachable or every model alias failed.
 */
export async function generateTripPlanningProposal(
  currentPlanning: TripPlanningData,
  instruction: string
): Promise<TripPlanningProposal> {
  const request = normalizeTripPlanningRequest({ currentPlanning, instruction });
  if (request === null) {
    throw new AiPlanningError(
      'invalid-input',
      'Add a short instruction for the planning suggestion (up to 1000 characters).'
    );
  }

  let text: string;
  try {
    text = await runWithPlanningModelFallback(async (model) =>
      (
        await model.generateContent(
          buildPlanningPrompt(
            request.currentPlanning,
            request.instruction,
            request.constraints || []
          )
        )
      ).response.text()
    );
  } catch (err) {
    console.error('[AiPlanningService] Proposal generation failed:', err);
    throw new AiPlanningError(
      'unavailable',
      'The planning assistant is busy right now (high demand or today’s free-tier limit). Wait a moment and try again.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiPlanningError(
      'invalid-output',
      'The planning assistant returned a malformed response. Review the plan and try again.'
    );
  }

  const proposal = normalizeTripPlanningProposal(parsed);
  if (proposal === null) {
    throw new AiPlanningError(
      'invalid-output',
      'The planning assistant suggested a change this plan cannot accept (it may touch sections planning cannot edit). Try a more specific instruction.'
    );
  }

  return proposal;
}
