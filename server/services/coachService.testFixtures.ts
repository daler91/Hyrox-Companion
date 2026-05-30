import type { CoachNoteInputs, User } from "@shared/schema";
import { vi } from "vitest";

import { buildWorkoutPrescriptionFingerprint } from "./aiModificationGuard";

type StorageMock = typeof import("../storage").storage;
type BuildTrainingContextMock = typeof import("./ai").buildTrainingContext;

export function mockEnabledUser(storage: StorageMock) {
  const usersStorage = vi.mocked(storage.users);
  const enabledUser: User = {
    id: "user-1",
    email: null,
    firstName: null,
    lastName: null,
    profileImageUrl: null,
    weightUnit: "kg",
    distanceUnit: "km",
    userTimezone: "UTC",
    weeklyGoal: null,
    emailNotifications: null,
    emailWeeklySummary: null,
    emailMissedReminder: null,
    showAdherenceInsights: null,
    aiCoachEnabled: true,
    trainingStyleId: null,
    trainingStylePreviousId: null,
    trainingStyleChangedAt: null,
    trainingStyleRecomputeNow: null,
    onboardingCompleted: false,
    mafAge: null,
    mafInjuryIllnessMedication: null,
    mafConsistency: null,
    mafTrend: null,
    mafHrDataAvailable: null,
    mafHr: null,
    mafBaselineTestScheduledAt: null,
    isAutoCoaching: false,
    lastWeeklySummaryAt: null,
    lastMissedReminderAt: null,
    createdAt: null,
    updatedAt: null,
  };
  usersStorage.getUser.mockResolvedValue(enabledUser);
  usersStorage.updateIsAutoCoaching.mockResolvedValue(undefined);
}

export function makeTimelineEntry(overrides: Record<string, unknown> = {}) {
  return {
    status: "planned",
    date: "2026-01-16",
    planDayId: "day-1",
    focus: "Strength",
    mainWorkout: "3x5 Squats",
    accessory: null,
    notes: null,
    ...overrides,
  };
}

export function mockBaseAutoCoachDeps(
  storage: StorageMock,
  buildTrainingContext: BuildTrainingContextMock,
  timeline: Record<string, unknown>[] = [makeTimelineEntry()],
) {
  const coachingStorage = vi.mocked(storage.coaching);
  mockEnabledUser(storage);
  const upcomingWorkouts = timeline
    .filter((entry) => entry.status === "planned" && entry.planDayId)
    .map((entry) => ({
      planDayId: entry.planDayId as string,
      date: entry.date as string,
      focus: entry.focus as string,
      mainWorkout: entry.mainWorkout as string,
      accessory: entry.accessory as string | null,
      notes: entry.notes as string | null,
      aiSource: entry.aiSource as "rag" | "legacy" | "review" | null | undefined,
      aiRationale: entry.aiRationale as string | null | undefined,
      aiNoteUpdatedAt: entry.aiNoteUpdatedAt as string | Date | null | undefined,
      aiInputsUsed: entry.aiInputsUsed as CoachNoteInputs | null | undefined,
      ...(Array.isArray(entry.exerciseDetails) ? { exerciseDetails: entry.exerciseDetails } : {}),
    }));
  vi.mocked(buildTrainingContext).mockResolvedValue({
    totalWorkouts: 0,
    completedWorkouts: 0,
    plannedWorkouts: upcomingWorkouts.length,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 0,
    currentStreak: 0,
    recentWorkouts: [],
    upcomingWorkouts,
    exerciseBreakdown: {},
  });
  coachingStorage.hasChunksForUser.mockResolvedValue(false);
  coachingStorage.listCoachingMaterials.mockResolvedValue([]);
}

export function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    workoutId: "day-1",
    workoutDate: "2026-01-16",
    workoutFocus: "Strength",
    targetField: "mainWorkout",
    action: "replace",
    recommendation: "4x5 Squats @ 80%",
    rationale: "Progressive overload",
    priority: "high",
    ...overrides,
  };
}

export function textWorkoutFingerprint(mainWorkout: string) {
  return buildWorkoutPrescriptionFingerprint({ mainWorkout });
}
