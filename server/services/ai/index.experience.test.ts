import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { buildTrainingContext } from "./index";
import { makeTimelineDays } from "./testFixtures";

/**
 * How much history buildTrainingContext credits the athlete with: the
 * experience level the decision engine and the exercise brief coach to, and
 * the gate on "never trained" coverage gaps.
 *
 * Only the reads are mocked. The stats, the decision engine and the brief are
 * the real ones: index.test.ts used to mock the stats wholesale, which is how
 * the plan's future days counting as experience went unnoticed —
 * AI11 (CODEBASE_ANALYSIS_2026-10-03).
 */

vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../routeUtils", () => ({ calculateStreak: vi.fn().mockReturnValue(0) }));
vi.mock("./nutritionContext", () => ({
  buildNutritionTrainingContext: vi.fn().mockResolvedValue(undefined),
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

const USER_ID = "user-1";
const TODAY = "2026-06-15";
const TOMORROW = "2026-06-16";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  vi.mocked(storage.timeline).getTimeline.mockResolvedValue([]);
  vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([]);
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

async function contextFor(timeline: ReturnType<typeof makeTimelineDays>) {
  vi.mocked(storage.timeline).getTimeline.mockResolvedValue(timeline as never);
  return await buildTrainingContext(USER_ID);
}

describe("buildTrainingContext — the athlete's history", () => {
  it.each([
    [5, "beginner"],
    [19, "beginner"],
    [20, "intermediate"],
    [79, "intermediate"],
    [80, "advanced"],
    [150, "advanced"],
  ])("classifies %i completed workouts as experience level %s", async (done, level) => {
    const ctx = await contextFor(makeTimelineDays(done, "completed", TODAY));

    expect(ctx.exerciseSelection?.experienceLevel).toBe(level);
  });

  // One logged session and a 12-week, 6-day plan ahead read as 73 "workouts
  // tracked" and were coached as intermediate: power cleans, pistol squats.
  it("coaches a new athlete with a long plan ahead as a beginner", async () => {
    const ctx = await contextFor([
      ...makeTimelineDays(1, "completed", TODAY),
      ...makeTimelineDays(72, "planned", TOMORROW, 1),
    ]);

    expect(ctx.totalWorkouts).toBe(73);
    expect(ctx.exerciseSelection?.experienceLevel).toBe("beginner");
  });

  it("does not count a completed day dated after today", async () => {
    const ctx = await contextFor([
      ...makeTimelineDays(19, "completed", TODAY),
      ...makeTimelineDays(1, "completed", TOMORROW),
    ]);

    expect(ctx.exerciseSelection?.experienceLevel).toBe("beginner");
  });

  it("surfaces never-trained coverage gaps once the athlete has training history", async () => {
    const ctx = await contextFor(makeTimelineDays(15, "completed", TODAY));

    // Empty sets + enough history => every pattern/muscle reads as "never", capped.
    expect(ctx.coachingInsights?.neglectedPatterns?.length).toBeGreaterThan(0);
    expect(ctx.coachingInsights?.neglectedPatterns?.[0].daysSince).toBeNull();
  });

  it("omits coverage gaps for athletes without enough history, however long the plan ahead", async () => {
    const ctx = await contextFor([
      ...makeTimelineDays(3, "completed", TODAY),
      ...makeTimelineDays(40, "planned", TOMORROW, 1),
    ]);

    expect(ctx.coachingInsights?.neglectedPatterns).toBeUndefined();
    expect(ctx.coachingInsights?.neglectedMuscles).toBeUndefined();
  });
});
