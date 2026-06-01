import type { TimelineEntry } from '@shared/schema';
import { describe, expect, it } from 'vitest';

import { buildLoggedTimelineEntry, type CreatedWorkout } from './useWorkoutActionMutations';

function createBaseWorkout(overrides?: Partial<CreatedWorkout>): CreatedWorkout {
  return {
    id: 'mock-workout',
    date: '2023-10-27',
    focus: 'Strength',
    mainWorkout: 'Deadlift',
    accessory: 'Rows',
    notes: 'Felt good',
    duration: 60,
    rpe: 8,
    planDayId: 'pd-1',
    userId: 'user-1',
    createdAt: '2023-10-27',
    updatedAt: '2023-10-27',
    planId: null,
    source: 'manual',
    ...overrides,
  };
}

function createExpectedEntry(workout: CreatedWorkout, overrides?: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: `log-${workout.id}`,
    date: workout.date,
    type: 'logged',
    status: 'completed',
    focus: workout.focus,
    mainWorkout: workout.mainWorkout,
    accessory: workout.accessory,
    notes: workout.notes,
    duration: workout.duration,
    rpe: workout.rpe,
    planDayId: workout.planDayId,
    workoutLogId: workout.id,
    weekNumber: undefined,
    dayName: undefined,
    planName: undefined,
    planId: workout.planId,
    source: workout.source,
    aiSource: undefined,
    aiRationale: undefined,
    aiNoteUpdatedAt: undefined,
    aiInputsUsed: undefined,
    exerciseSets: workout.exerciseSets ?? [],
    calories: workout.calories,
    distanceMeters: workout.distanceMeters,
    ...overrides,
  };
}

describe('buildLoggedTimelineEntry', () => {
  it('correctly maps properties when sourceEntry is null', () => {
    const mockWorkout = createBaseWorkout();
    const result = buildLoggedTimelineEntry(mockWorkout, null);
    expect(result).toMatchObject(createExpectedEntry(mockWorkout));
  });

  it('correctly maps properties when sourceEntry is undefined', () => {
    const mockWorkout = createBaseWorkout({ id: 'mock-2' });
    const result = buildLoggedTimelineEntry(mockWorkout);
    expect(result).toMatchObject(createExpectedEntry(mockWorkout));
  });

  it('correctly falls back to sourceEntry properties when workout properties are missing or falsy', () => {
    const mockWorkout = createBaseWorkout({
      id: 'mock-3',
      date: null as any,
      focus: '',
      mainWorkout: null as any,
      accessory: null,
      notes: null,
      duration: null,
      rpe: null,
      planDayId: null,
      planId: null,
      source: null,
    });

    const mockSourceEntry = {
      id: 'source-1',
      date: '2023-10-29',
      type: 'planned',
      status: 'planned',
      focus: 'Hypertrophy',
      mainWorkout: 'Squats',
      accessory: 'Leg Press',
      notes: 'Push hard',
      planDayId: 'plan-day-3',
      workoutLogId: null,
      weekNumber: 2,
      dayName: 'Leg Day',
      planId: 'plan-1',
      planName: 'My Plan',
    } as TimelineEntry;

    const result = buildLoggedTimelineEntry(mockWorkout, mockSourceEntry);

    expect(result).toMatchObject(createExpectedEntry(mockWorkout, {
      date: mockSourceEntry.date,
      focus: mockSourceEntry.focus,
      mainWorkout: mockSourceEntry.mainWorkout,
      accessory: mockSourceEntry.accessory,
      notes: mockSourceEntry.notes,
      planDayId: mockSourceEntry.planDayId,
      weekNumber: mockSourceEntry.weekNumber,
      dayName: mockSourceEntry.dayName,
      planId: mockSourceEntry.planId,
      planName: mockSourceEntry.planName,
      source: 'manual', // falls back to 'manual' if both missing or if workout source is missing and sourceEntry source is missing
    }));
  });
});
