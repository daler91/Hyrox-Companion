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
    weightUnit: null,
    distance: null,
    distanceUnit: null,
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

/**
 * `count` timeline entries in one status, a day apart from `from` — backwards
 * by default (history), forwards with `step = 1` (the plan ahead).
 */
export function makeTimelineDays(
  count: number,
  status: "completed" | "planned",
  from: string,
  step = -1,
): TimelineEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i * step);
    return makeTimelineEntry({ status, date: date.toISOString().slice(0, 10), focus: "Run" });
  });
}
