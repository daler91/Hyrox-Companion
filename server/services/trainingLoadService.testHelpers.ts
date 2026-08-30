import type { WorkoutLog } from "@shared/schema";

// Shared fixture for tests that feed WorkoutLog rows into the training-load
// model (trainingLoadService.test.ts, test/audit/criticals.audit.test.ts).
// The large row shape is spelled out exactly once here — same convention as
// services/ai/testFixtures.ts — instead of being copy-pasted per test file.
// The default date matches CURRENT_DATE in trainingLoadGovernor.testHelpers.
export function makeWorkoutLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: "log-1",
    userId: "user-1",
    date: "2026-05-22",
    focus: "Run",
    mainWorkout: "Easy run",
    accessory: null,
    notes: null,
    prescribedMainWorkout: null,
    prescribedAccessory: null,
    prescribedNotes: null,
    plannedSetCount: null,
    actualSetCount: null,
    matchedSetCount: null,
    addedSetCount: null,
    removedSetCount: null,
    compliancePct: null,
    duration: null,
    rpe: null,
    planDayId: null,
    planId: null,
    source: "manual",
    stravaActivityId: null,
    garminActivityId: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    startedAt: null,
    timeOfDayMin: null,
    ...overrides,
  };
}
