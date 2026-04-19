import type { InsertWorkoutLog, PlanDay,TimelineEntry, TrainingPlan, TrainingPlanWithDays } from "@shared/schema";

import type { UpcomingWorkout } from "../server/gemini/suggestionService";
import type { TrainingContext } from "../server/gemini/types";

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
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    ...overrides,
  };
}

export function createMockUpcomingWorkout(
  overrides: Partial<UpcomingWorkout> = {},
): UpcomingWorkout {
  return {
    id: "upcoming-day-1",
    date: "2026-04-20",
    focus: "strength",
    mainWorkout: "Back squat 5x5",
    accessory: undefined,
    notes: undefined,
    ...overrides,
  };
}

export function createMockTrainingContext(
  overrides: Partial<TrainingContext> = {},
): TrainingContext {
  return {
    totalWorkouts: 40,
    completedWorkouts: 30,
    plannedWorkouts: 7,
    missedWorkouts: 2,
    skippedWorkouts: 1,
    completionRate: 75,
    currentStreak: 4,
    weeklyGoal: 5,
    recentWorkouts: [],
    upcomingWorkouts: [],
    exerciseBreakdown: {},
    structuredExerciseStats: {},
    activePlan: undefined,
    coachingInsights: {
      rpeTrend: "insufficient_data",
      fatigueFlag: false,
      undertrainingFlag: false,
      stationGaps: [],
      planPhase: undefined,
      weeklyVolume: undefined,
      progressionFlags: [],
    },
    ...overrides,
  };
}
