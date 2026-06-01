import type { TimelineEntry } from '@shared/schema';
import { describe, expect,it } from 'vitest';

import { buildLoggedTimelineEntry, type CreatedWorkout } from './useWorkoutActionMutations';

describe('buildLoggedTimelineEntry', () => {
  it('correctly maps properties when sourceEntry is null', () => {
    const mockWorkout: CreatedWorkout = {
      id: 'mock-workout-1',
      date: '2023-10-27',
      focus: 'Strength',
      mainWorkout: 'Deadlift',
      accessory: 'Rows',
      notes: 'Felt good',
      duration: 60,
      rpe: 8,
      planDayId: null,
      userId: 'user-1',
      createdAt: '2023-10-27',
      updatedAt: '2023-10-27',
      planId: null,
      source: 'manual',
    };

    const result = buildLoggedTimelineEntry(mockWorkout, null);

    expect(result).toMatchObject({
      id: `log-${mockWorkout.id}`,
      date: mockWorkout.date,
      type: 'logged',
      status: 'completed',
      focus: mockWorkout.focus,
      mainWorkout: mockWorkout.mainWorkout,
      accessory: mockWorkout.accessory,
      notes: mockWorkout.notes,
      duration: mockWorkout.duration,
      rpe: mockWorkout.rpe,
      planDayId: mockWorkout.planDayId,
      workoutLogId: mockWorkout.id,
      weekNumber: undefined,
      dayName: undefined,
      planName: undefined,
      planId: null,
      source: 'manual',
      aiSource: undefined,
      aiRationale: undefined,
      aiNoteUpdatedAt: undefined,
      aiInputsUsed: undefined,
      exerciseSets: [],
      calories: undefined,
      distanceMeters: undefined,
    });
  });

  it('correctly maps properties when sourceEntry is undefined', () => {
    const mockWorkout: CreatedWorkout = {
      id: 'mock-workout-2',
      date: '2023-10-28',
      focus: 'Endurance',
      mainWorkout: 'Run',
      accessory: null,
      notes: null,
      duration: 45,
      rpe: 7,
      planDayId: 'plan-day-2',
      userId: 'user-1',
      createdAt: '2023-10-28',
      updatedAt: '2023-10-28',
      planId: null,
      source: 'manual',
    };

    const result = buildLoggedTimelineEntry(mockWorkout);

    expect(result).toMatchObject({
      id: `log-${mockWorkout.id}`,
      date: mockWorkout.date,
      type: 'logged',
      status: 'completed',
      focus: mockWorkout.focus,
      mainWorkout: mockWorkout.mainWorkout,
      accessory: mockWorkout.accessory,
      notes: mockWorkout.notes,
      duration: mockWorkout.duration,
      rpe: mockWorkout.rpe,
      planDayId: mockWorkout.planDayId,
      workoutLogId: mockWorkout.id,
      weekNumber: undefined,
      dayName: undefined,
      planName: undefined,
      planId: null,
      source: 'manual',
      aiSource: undefined,
      aiRationale: undefined,
      aiNoteUpdatedAt: undefined,
      aiInputsUsed: undefined,
      exerciseSets: [],
      calories: undefined,
      distanceMeters: undefined,
    });
  });

  it('correctly falls back to sourceEntry properties when workout properties are missing or falsy', () => {
    const mockWorkout: CreatedWorkout = {
      id: 'mock-workout-3',
      date: '', // empty date string, falls back to sourceEntry.date in logic or not?
      // Wait, date is `workout.date ?? sourceEntry?.date ?? ""`
      // `workout.date` is "", which is NOT nullish. It is falsy, but ?? checks for nullish.
      // `workout.focus || sourceEntry?.focus || "Workout"` uses ||, so it checks falsy.
      focus: '', // falsy focus, uses ||
      mainWorkout: '', // ?? uses nullish, so it uses "" if provided as ""
      accessory: null,
      notes: null,
      duration: null,
      rpe: null,
      planDayId: null,
      userId: 'user-1',
      createdAt: '2023-10-29',
      updatedAt: '2023-10-29',
      planId: null,
      source: 'manual',
    };

    const mockSourceEntry: TimelineEntry = {
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
    };

    // Fix the mock to properly test ?? vs ||
    // For date and mainWorkout, it uses ?? so we should pass undefined/null to test fallback
    const mockWorkoutFixed: CreatedWorkout = {
      id: 'mock-workout-3',
      date: null as any,
      focus: '',
      mainWorkout: null as any,
      accessory: null,
      notes: null,
      duration: null,
      rpe: null,
      planDayId: null,
      userId: 'user-1',
      createdAt: '2023-10-29',
      updatedAt: '2023-10-29',
      planId: null,
      source: null,
    };

    const result = buildLoggedTimelineEntry(mockWorkoutFixed, mockSourceEntry);

    expect(result).toMatchObject({
      id: `log-${mockWorkoutFixed.id}`,
      date: mockSourceEntry.date,
      type: 'logged',
      status: 'completed',
      focus: mockSourceEntry.focus,
      mainWorkout: mockSourceEntry.mainWorkout,
      accessory: mockSourceEntry.accessory,
      notes: mockSourceEntry.notes,
      duration: mockWorkoutFixed.duration, // workout duration is null
      rpe: mockWorkoutFixed.rpe,         // workout rpe is null
      planDayId: mockSourceEntry.planDayId,
      workoutLogId: mockWorkoutFixed.id,
      weekNumber: mockSourceEntry.weekNumber,
      dayName: mockSourceEntry.dayName,
      planId: mockSourceEntry.planId,
      planName: mockSourceEntry.planName,
    });
  });
});
