import { describe, expect, it } from 'vitest';
import {
  getTripTaskCategoryLabel,
  getTripTaskRelatedSectionLabel,
  getTripTaskStatusLabel,
  hasUniqueTaskIds,
  isTripChecklistItem,
  isTripTaskCategory,
  isTripTaskRelatedSection,
  isTripTaskStatus,
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_NOTE_LENGTH,
  MAX_TASK_RELATED_PLAN_ID_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  normalizeTripChecklistItem,
  TRIP_TASK_CATEGORIES,
  TRIP_TASK_RELATED_SECTIONS,
  TRIP_TASK_STATUSES,
} from '../domain/trips/executionChecklist';
import type { TripChecklistItem, TripTaskCategory, TripTaskStatus } from '../types/trip';

function taskWith(overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
  return {
    id: 'tsk-1',
    category: 'general',
    title: 'Book airport transfer',
    status: 'pending',
    ...overrides,
  };
}

describe('STEP 18 checklist vocabulary', () => {
  it('recognizes exactly the four documented task statuses and rejects provider ones', () => {
    expect(TRIP_TASK_STATUSES).toEqual(['pending', 'in_progress', 'completed', 'skipped']);
    for (const status of TRIP_TASK_STATUSES) {
      expect(isTripTaskStatus(status)).toBe(true);
    }
    expect(isTripTaskStatus('booked')).toBe(false);
    expect(isTripTaskStatus('confirmed-reservation')).toBe(false);
    expect(isTripTaskStatus('verified')).toBe(false);
    expect(isTripTaskStatus('cancelled')).toBe(false);
    expect(isTripTaskStatus(3)).toBe(false);
    expect(isTripTaskStatus(null)).toBe(false);
    expect(isTripTaskStatus(undefined)).toBe(false);
    expect(isTripTaskStatus({})).toBe(false);
  });

  it('recognizes exactly the six documented preparation categories', () => {
    expect(TRIP_TASK_CATEGORIES).toEqual([
      'transport-preparation',
      'accommodation-preparation',
      'budget-preparation',
      'document-preparation',
      'itinerary-preparation',
      'general',
    ]);
    for (const category of TRIP_TASK_CATEGORIES) {
      expect(isTripTaskCategory(category)).toBe(true);
    }
    expect(isTripTaskCategory('booking')).toBe(false);
    expect(isTripTaskCategory('payment')).toBe(false);
    expect(isTripTaskCategory(7)).toBe(false);
  });

  it('recognizes the documented related planning sections', () => {
    expect(TRIP_TASK_RELATED_SECTIONS).toEqual([
      'transport',
      'accommodation',
      'budget',
      'itinerary',
    ]);
    for (const section of TRIP_TASK_RELATED_SECTIONS) {
      expect(isTripTaskRelatedSection(section)).toBe(true);
    }
    expect(isTripTaskRelatedSection('flights')).toBe(false);
  });
});

describe('STEP 18 checklist normalization', () => {
  it('normalizes a minimal valid task', () => {
    expect(normalizeTripChecklistItem(taskWith())).toEqual(taskWith());
  });

  it('normalizes a full task, trimming strings and dropping empty present-only keys', () => {
    const normalized = normalizeTripChecklistItem({
      id: '  tsk-1  ',
      category: 'document-preparation',
      title: '  Apply for e-visa  ',
      description: '  Check validity before departure  ',
      status: 'in_progress',
      dueDate: ' 2026-09-20 ',
      note: '   ',
      relatedSection: 'itinerary',
      relatedPlanId: '  trp-7  ',
    } as unknown as TripChecklistItem);
    expect(normalized).toEqual({
      id: 'tsk-1',
      category: 'document-preparation',
      title: 'Apply for e-visa',
      description: 'Check validity before departure',
      status: 'in_progress',
      dueDate: '2026-09-20',
      relatedSection: 'itinerary',
      relatedPlanId: 'trp-7',
    });
  });

  it('treats explicit-null optionals as absent (never persisted)', () => {
    const normalized = normalizeTripChecklistItem({
      ...taskWith(),
      description: null,
      dueDate: null,
      note: null,
      relatedSection: null,
      relatedPlanId: null,
    } as unknown as TripChecklistItem);
    expect(normalized).toEqual({
      id: 'tsk-1',
      category: 'general',
      title: 'Book airport transfer',
      status: 'pending',
    });
  });

  it('rebuilds the record so runtime-only keys never persist', () => {
    const normalized = normalizeTripChecklistItem({
      ...taskWith(),
      runtimeKey: 'drop me',
      createdAt: '2026-09-11T00:00:00.000Z',
    } as unknown as TripChecklistItem);
    expect(normalized).toEqual(taskWith());
    expect(normalized).not.toHaveProperty('runtimeKey');
    expect(normalized).not.toHaveProperty('createdAt');
  });

  it('rejects malformed tasks wholesale without throwing', () => {
    expect(normalizeTripChecklistItem(null)).toBeNull();
    expect(normalizeTripChecklistItem(undefined)).toBeNull();
    expect(normalizeTripChecklistItem([])).toBeNull();
    expect(normalizeTripChecklistItem('tsk-1')).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), id: '' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), id: 7 })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), category: 'payment' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), title: '' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), title: '   ' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), title: 7 })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), status: 'booked' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), status: 'confirmed' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), description: 7 })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), dueDate: 'next week' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), dueDate: '2026-13-99' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), note: 7 })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), relatedSection: 'flights' })).toBeNull();
    expect(normalizeTripChecklistItem({ ...taskWith(), relatedPlanId: 7 })).toBeNull();
  });

  it('enforces the documented maximum lengths by rejection, never truncation', () => {
    const overlengthTitle = taskWith({ title: 'x'.repeat(MAX_TASK_TITLE_LENGTH + 1) });
    expect(normalizeTripChecklistItem(overlengthTitle)).toBeNull();
    expect(
      normalizeTripChecklistItem(taskWith({ title: 'x'.repeat(MAX_TASK_TITLE_LENGTH) }))
    ).not.toBeNull();

    const overlengthDescription = taskWith({
      description: 'x'.repeat(MAX_TASK_DESCRIPTION_LENGTH + 1),
    });
    expect(normalizeTripChecklistItem(overlengthDescription)).toBeNull();

    const overlengthNote = taskWith({ note: 'x'.repeat(MAX_TASK_NOTE_LENGTH + 1) });
    expect(normalizeTripChecklistItem(overlengthNote)).toBeNull();

    const overlengthPlanId = taskWith({
      relatedPlanId: 'x'.repeat(MAX_TASK_RELATED_PLAN_ID_LENGTH + 1),
    });
    expect(normalizeTripChecklistItem(overlengthPlanId)).toBeNull();
  });

  it('isTripChecklistItem reflects the normalizer', () => {
    expect(isTripChecklistItem(taskWith())).toBe(true);
    expect(isTripChecklistItem({ ...taskWith(), status: 'booked' })).toBe(false);
    expect(isTripChecklistItem(null)).toBe(false);
  });
});

describe('STEP 18 duplicate-id gate', () => {
  it('detects duplicate and empty ids across a task list', () => {
    expect(hasUniqueTaskIds([taskWith(), taskWith({ id: 'tsk-2' })])).toBe(true);
    expect(hasUniqueTaskIds([taskWith(), taskWith()])).toBe(false);
    expect(hasUniqueTaskIds([])).toBe(true);
  });
});

describe('STEP 18 labels keep statuses honest and neutral', () => {
  it('returns the documented neutral status labels', () => {
    expect(getTripTaskStatusLabel('pending')).toBe('Pending');
    expect(getTripTaskStatusLabel('in_progress')).toBe('In progress');
    expect(getTripTaskStatusLabel('completed')).toBe('Completed');
    expect(getTripTaskStatusLabel('skipped')).toBe('Skipped');
  });

  it('never claims a booking, payment, or external verification', () => {
    for (const status of TRIP_TASK_STATUSES as ReadonlyArray<TripTaskStatus>) {
      const label = getTripTaskStatusLabel(status).toLowerCase();
      expect(label).not.toMatch(/book|pay|reservation|confirmed|verified|ticket/);
    }
  });

  it('returns friendly category and related-section labels', () => {
    expect(getTripTaskCategoryLabel('transport-preparation')).toBe('Transport preparation');
    expect(getTripTaskCategoryLabel('general')).toBe('General');
    expect(getTripTaskRelatedSectionLabel('transport')).toBe('Transport plans');
    expect(getTripTaskRelatedSectionLabel('itinerary')).toBe('Daily itinerary');
  });
});

describe('STEP 18 category/status round-trip helper types', () => {
  it('keeps category and status values typed to the vocabulary', () => {
    const category: TripTaskCategory = 'budget-preparation';
    const status: TripTaskStatus = 'completed';
    expect(category).toBe('budget-preparation');
    expect(status).toBe('completed');
    expect(isTripTaskCategory(category)).toBe(true);
    expect(isTripTaskStatus(status)).toBe(true);
  });
});
