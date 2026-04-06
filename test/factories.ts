import type { InsertWorkoutLog, PlanDay,TimelineEntry, TrainingPlan, TrainingPlanWithDays } from "@shared/schema";

export function createMockTimelineEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "test-entry-1",
    date: "2026-01-01",
    type: "logged",
    status: "completed",
    focus: "strength",
    mainWorkout: "Test workout",
    accessory: null,
    notes: null,
    duration: null,
    rpe: null,
    planDayId: null,
    workoutLogId: null,
    ...overrides,
  };
}

export function createMockWorkoutLog(
  overrides: Partial<InsertWorkoutLog & { userId: string }> = {},
): InsertWorkoutLog & { userId: string } {
  return {
    date: "2026-01-01",
    userId: "test-user",
    focus: "strength",
    mainWorkout: "Test workout",
    accessory: null,
    notes: null,
    duration: null,
    rpe: null,
    planDayId: null,
    planId: null,
    source: "manual",
    stravaActivityId: null,
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
    ...overrides,
  };
}

export function createMockTrainingPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: "test-plan-1",
    userId: "test-user",
    name: "Test Plan",
    sourceFileName: null,
    totalWeeks: 8,
    goal: null,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

export function createMockTrainingPlanWithDays(
  overrides: Partial<TrainingPlanWithDays> = {},
): TrainingPlanWithDays {
  return {
    ...createMockTrainingPlan(overrides),
    days: [],
    ...overrides,
  };
}

export function createMockPlanDay(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    id: "test-day-1",
    planId: "test-plan-1",
    weekNumber: 1,
    dayName: "Monday",
    focus: "strength",
    mainWorkout: "Test workout",
    accessory: null,
    notes: null,
    scheduledDate: null,
    status: "planned",
    aiSource: null,
    ...overrides,
  };
}
