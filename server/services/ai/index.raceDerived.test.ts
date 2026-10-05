import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { buildTrainingContext } from "./index";

/**
 * The race-derived flag on the coach's upcoming days. A day the plan's race
 * date sets (the race, the shakeout before it, recovery after) carries text
 * the race date generates, so the auto-coach must know it, or it saves that
 * text back over the stored day. AI29 (CODEBASE_ANALYSIS_2026-10-03)
 */

vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../routeUtils", () => ({ calculateStreak: vi.fn().mockReturnValue(0) }));
vi.mock("./nutritionContext", () => ({
  buildNutritionTrainingContext: vi.fn(() => Promise.resolve()),
  buildNextSessionFuelling: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: {
    timeline: { getTimeline: vi.fn(), getUpcomingPlannedDays: vi.fn() },
    plans: { getActivePlan: vi.fn() },
    users: { getUser: vi.fn() },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
    mafTests: { listTestResults: vi.fn(), listWorkoutAnalysis: vi.fn(), countTestResults: vi.fn() },
    timelineAnnotations: { list: vi.fn() },
    athleteFacts: { listActive: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  vi.mocked(storage.timeline).getTimeline.mockResolvedValue([]);
  vi.mocked(storage.plans).getActivePlan.mockResolvedValue(null as never);
  vi.mocked(storage.users).getUser.mockResolvedValue({ weeklyGoal: 0 } as never);
  vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue([]);
  vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([]);
  vi.mocked(storage.analytics).getExerciseLoadTags.mockResolvedValue([]);
  vi.mocked(storage.timelineAnnotations).list.mockResolvedValue([]);
  vi.mocked(storage.athleteFacts).listActive.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildTrainingContext — race-derived upcoming days", () => {
  it("carries the flag onto the coach's day and leaves ordinary days without it", async () => {
    vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([
      {
        planDayId: "pd-normal",
        date: "2026-06-16",
        focus: "Legs",
        mainWorkout: "Squats",
        exerciseSets: [],
      },
      {
        planDayId: "pd-shakeout",
        date: "2026-06-17",
        focus: "Shakeout",
        mainWorkout: "Pre-race shakeout: easy jog",
        exerciseSets: [],
        raceDerived: true,
      },
    ] as never);

    const ctx = await buildTrainingContext("user-1");
    const byId = (id: string) => ctx.upcomingWorkouts?.find((day) => day.planDayId === id);

    expect(byId("pd-shakeout")).toMatchObject({ focus: "Shakeout", raceDerived: true });
    expect(byId("pd-normal")).toBeDefined();
    expect(byId("pd-normal")).not.toHaveProperty("raceDerived");
  });
});
