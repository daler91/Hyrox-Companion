import type { ExerciseSet } from "@shared/schema";

import type { TimelineEntry } from "./types";

/**
 * Shared test factories for the AI training-context modules. Centralised here
 * so the (large) ExerciseSet/TimelineEntry shapes are spelled out exactly once
 * instead of being copy-pasted across sibling *.test.ts files.
 */

export function makeTimelineEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    status: "completed",
    date: "2026-01-01",
    focus: "Strength",
    mainWorkout: "Squats",
    notes: null,
    ...overrides,
  };
}

export function makeExerciseSet(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: "set-1",
    workoutLogId: "wl-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    blockId: null,
    stepNumber: null,
    intervalMinute: null,
    cycleNumber: null,
    stepRole: null,
    groupId: null,
    intensity: null,
    load: null,
    repMode: null,
    tempo: null,
    standards: null,
    notes: null,
    confidence: null,
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}
