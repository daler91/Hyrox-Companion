import type { InsertWorkoutLog, PlanDay, SessionGrade, TimelineEntry, TrainingPlan, TrainingPlanWithDays, User } from "@shared/schema";

import type { MissedWorkoutData, WeeklySummaryData } from "../server/emailTemplates";
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
    raceDate: null,
    retiredOn: null,
    generationStatus: "ready",
    generationError: null,
    generationStartedAt: null,
    engineState: null,
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
    expectedDurationMin: null,
    expectedRpe: null,
    plannedTimeOfDayMin: null,
    skipReason: null,
    priority: null,
    recovery: null,
    missedOn: null,
    recoveryUndo: null,
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

/** A complete `users` row so tests typecheck against the live schema. */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "athlete@example.com",
    firstName: "John",
    lastName: "Doe",
    profileImageUrl: null,
    weightUnit: "kg",
    distanceUnit: "km",
    userTimezone: "UTC",
    weeklyGoal: 5,
    mealSchedule: 4,
    emailNotifications: true,
    emailWeeklySummary: true,
    emailMissedReminder: true,
    showAdherenceInsights: true,
    aiCoachEnabled: false,
    coachAutoApplyPlanChanges: false,
    trainingStyleId: "balanced_default",
    trainingStylePreviousId: null,
    trainingStyleChangedAt: null,
    trainingStyleRecomputeNow: false,
    onboardingCompleted: true,
    division: "open",
    gender: null,
    age: null,
    bodyweightKg: null,
    heightCm: null,
    restingHr: null,
    maxHr: null,
    ftp: null,
    activityLevel: null,
    weightGoalDirection: null,
    weightGoalRateKgPerWeek: null,
    trainingConstraints: null,
    mafAge: null,
    mafInjuryIllnessMedication: null,
    mafConsistency: null,
    mafTrend: null,
    mafCategory: null,
    mafHrDataAvailable: null,
    mafHr: null,
    mafBaselineTestScheduledAt: null,
    isAutoCoaching: false,
    lastWeeklySummaryAt: null,
    lastMissedReminderAt: null,
    emailWeeklyReviewReminder: false,
    emailTodaySession: false,
    emailAnalysisDigest: false,
    notifyHour: 7,
    notifyHourWeeklySummary: null,
    notifyHourMissedReminder: null,
    notifyHourWeeklyReviewReminder: null,
    notifyHourTodaySession: null,
    notifyHourAnalysisDigest: null,
    lastWeeklyReviewReminderAt: null,
    lastTodaySessionAt: null,
    lastAnalysisDigestAt: null,
    pushRefuelReminder: false,
    pushLoggingReminder: false,
    lastRefuelReminderAt: null,
    lastLoggingReminderAt: null,
    erasureRequestedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** A week with 3 of 4 plan days done (75%), one missed, one PR. */
export function createMockWeeklySummary(overrides: Partial<WeeklySummaryData> = {}): WeeklySummaryData {
  return {
    completedCount: 3,
    planCompletedCount: 3,
    dueCount: 4,
    plannedCount: 0,
    missedCount: 1,
    skippedCount: 0,
    excusedCount: 0,
    letGoCount: 0,
    completionRate: 75,
    currentStreak: 2,
    prsThisWeek: 1,
    totalDuration: 125,
    weekStartDate: "Oct 1",
    weekEndDate: "Oct 7",
    ...overrides,
  };
}

export function createMockMissedWorkout(overrides: Partial<MissedWorkoutData> = {}): MissedWorkoutData {
  return {
    planDayId: "plan-day-1",
    date: "Oct 3",
    focus: "Strength",
    mainWorkout: "Squats, Deadlifts, Bench",
    planName: "Hyrox Base",
    ...overrides,
  };
}

/** A finished session grade, for rollup/route/UI tests that do not care how it was reached. */
export function createMockSessionGrade(overrides: Partial<SessionGrade> = {}): SessionGrade {
  return {
    workoutLogId: "log-1",
    planDayId: `day-${overrides.workoutLogId ?? "1"}`,
    planId: "plan-1",
    date: "2026-09-22",
    weekNumber: 1,
    title: "Easy Run",
    intent: "easy",
    purpose: "easy",
    intentReason: "The plan day is titled for it",
    verdict: "on_target",
    headline: "Stayed easy",
    evidence: ["HR averaged 140 bpm, under your easy ceiling of 148 bpm."],
    confidence: "high",
    dataSource: "stream",
    streamStatus: "ok",
    ungradeableReason: null,
    targets: {
      easyCeilingHr: 148,
      thresholdHr: { min: 162, max: 176 },
      z5FloorHr: 176,
      hrBasis: "measured",
      easyPace: { fast: 360, slow: 400 },
      thresholdPace: null,
      paceSource: "plan",
    },
    easy: null,
    threshold: null,
    countsInRollup: true,
    ...overrides,
  };
}
