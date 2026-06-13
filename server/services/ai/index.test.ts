import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_CONTEXT_TIMELINE_LIMIT } from "../../constants";
import { logger } from "../../logger";
import { calculateStreak } from "../../routeUtils";
import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import {
  computeCurrentWeek,
  computeExerciseGaps,
  computePlanPhase,
  computeProgressionFlags,
  computeRpeTrend,
  computeWeeklyVolume,
} from "./coachingInsights";
import { buildTrainingContext } from "./index";
import { summarizeMafTrend } from "./mafTrend";
import { buildNextSessionFuelling, buildNutritionTrainingContext } from "./nutritionContext";
import { decideTrainingState } from "./trainingDecisionEngine";
import {
  calculateTrainingStats,
  collectRecentWorkouts,
  getExerciseBreakdown,
  getStructuredExerciseStats,
} from "./trainingStats";

vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../routeUtils", () => ({ calculateStreak: vi.fn() }));
vi.mock("../trainingLoadService", () => ({ calculateTrainingLoad: vi.fn() }));
vi.mock("./coachingInsights", () => ({
  computeCurrentWeek: vi.fn(),
  computeExerciseGaps: vi.fn(),
  computePlanPhase: vi.fn(),
  computeProgressionFlags: vi.fn(),
  computeRpeTrend: vi.fn(),
  computeWeeklyVolume: vi.fn(),
}));
vi.mock("./mafTrend", () => ({ summarizeMafTrend: vi.fn() }));
vi.mock("./nutritionContext", () => ({
  buildNutritionTrainingContext: vi.fn(),
  buildNextSessionFuelling: vi.fn(),
}));
vi.mock("./trainingDecisionEngine", () => ({ decideTrainingState: vi.fn() }));
vi.mock("./trainingStats", () => ({
  calculateTrainingStats: vi.fn(),
  collectRecentWorkouts: vi.fn(),
  getExerciseBreakdown: vi.fn(),
  getStructuredExerciseStats: vi.fn(),
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
    mafTests: { listTestResults: vi.fn(), listWorkoutAnalysis: vi.fn() },
  },
}));

const USER_ID = "user-1";
const TODAY = "2026-06-15";
const LOAD_START = "2026-04-06"; // TODAY - 70 days

const statsMock = vi.mocked(calculateTrainingStats);
const breakdownMock = vi.mocked(getExerciseBreakdown);
const recentMock = vi.mocked(collectRecentWorkouts);
const structuredMock = vi.mocked(getStructuredExerciseStats);
const streakMock = vi.mocked(calculateStreak);
const rpeMock = vi.mocked(computeRpeTrend);
const gapsMock = vi.mocked(computeExerciseGaps);
const flagsMock = vi.mocked(computeProgressionFlags);
const weekMock = vi.mocked(computeCurrentWeek);
const phaseMock = vi.mocked(computePlanPhase);
const volumeMock = vi.mocked(computeWeeklyVolume);
const loadMock = vi.mocked(calculateTrainingLoad);
const decideMock = vi.mocked(decideTrainingState);
const mafMock = vi.mocked(summarizeMafTrend);
const nutritionMock = vi.mocked(buildNutritionTrainingContext);
const nextSessionFuellingMock = vi.mocked(buildNextSessionFuelling);

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    completedWorkouts: 0,
    plannedWorkouts: 0,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    totalWorkouts: 0,
    completionRate: 0,
    completedDates: new Set<string>(),
    ...overrides,
  };
}

function makeRpe(overrides: Record<string, unknown> = {}) {
  return {
    rpeTrend: "insufficient_data",
    fatigueFlag: false,
    undertrainingFlag: false,
    ...overrides,
  } as ReturnType<typeof computeRpeTrend>;
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    phase: "aerobic_base",
    allowedWorkoutTypes: ["easy_aerobic"],
    intensityPermitted: true,
    rationaleCodes: [],
    ...overrides,
  } as ReturnType<typeof decideTrainingState>;
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return { weeklyGoal: 0, ...overrides } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));

  statsMock.mockReturnValue(makeStats());
  breakdownMock.mockReturnValue({});
  recentMock.mockReturnValue([]);
  structuredMock.mockReturnValue(undefined);
  streakMock.mockReturnValue(0);
  rpeMock.mockReturnValue(makeRpe());
  gapsMock.mockReturnValue([]);
  flagsMock.mockReturnValue([]);
  weekMock.mockReturnValue(1);
  phaseMock.mockReturnValue(undefined);
  volumeMock.mockReturnValue({
    thisWeekCompleted: 0,
    lastWeekCompleted: 0,
    goal: 3,
    trend: "stable",
  });
  loadMock.mockReturnValue({ overview: { zone: "sweet_spot" } } as never);
  decideMock.mockReturnValue(makeDecision());
  mafMock.mockReturnValue({ testCount: 2 } as never);
  nutritionMock.mockResolvedValue(undefined);

  vi.mocked(storage.timeline.getTimeline).mockResolvedValue([]);
  vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([]);
  vi.mocked(storage.plans.getActivePlan).mockResolvedValue(null as never);
  vi.mocked(storage.users.getUser).mockResolvedValue(makeUser());
  vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
  vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
  vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
  vi.mocked(storage.mafTests.listTestResults).mockResolvedValue([]);
  vi.mocked(storage.mafTests.listWorkoutAnalysis).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildTrainingContext", () => {
  it("passes through the core training stats and computed fields", async () => {
    statsMock.mockReturnValue(
      makeStats({ totalWorkouts: 10, completedWorkouts: 7, completionRate: 70 }),
    );
    breakdownMock.mockReturnValue({ running: 3 });
    streakMock.mockReturnValue(5);
    structuredMock.mockReturnValue({ back_squat: { count: 2 } });

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx).toMatchObject({
      totalWorkouts: 10,
      completedWorkouts: 7,
      completionRate: 70,
      currentStreak: 5,
      exerciseBreakdown: { running: 3 },
      structuredExerciseStats: { back_squat: { count: 2 } },
    });
    expect(ctx.coachingInsights?.rpeTrend).toBe("insufficient_data");
    expect(ctx.coachingInsights?.decisionTree?.currentPhase).toBe("aerobic_base");
  });

  it("bounds the timeline read and uses a 70-day training-load window", async () => {
    await buildTrainingContext(USER_ID);

    expect(storage.timeline.getTimeline).toHaveBeenCalledWith(
      USER_ID,
      undefined,
      AI_CONTEXT_TIMELINE_LIMIT,
    );
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
      USER_ID,
      LOAD_START,
      TODAY,
    );
    expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledWith(
      USER_ID,
      LOAD_START,
      TODAY,
    );
  });

  it("derives the active plan and its phase when a plan is active", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
      name: "12wk Build",
      totalWeeks: 12,
      startDate: "2026-05-01",
      goal: "sub-70",
    } as never);
    weekMock.mockReturnValue(3);
    phaseMock.mockReturnValue({ phaseLabel: "build" } as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(weekMock).toHaveBeenCalledWith("2026-05-01", 12);
    expect(computePlanPhase).toHaveBeenCalledWith(12, 3);
    expect(ctx.activePlan).toEqual({
      name: "12wk Build",
      totalWeeks: 12,
      currentWeek: 3,
      goal: "sub-70",
    });
    expect(ctx.coachingInsights?.planPhase).toEqual({ phaseLabel: "build" });
  });

  it("omits the active plan and phase when none is active", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(null as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.activePlan).toBeUndefined();
    expect(ctx.coachingInsights?.planPhase).toBeUndefined();
    expect(computeCurrentWeek).not.toHaveBeenCalled();
    expect(computePlanPhase).not.toHaveBeenCalled();
  });

  it("computes weekly volume only when a weekly goal is set", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ weeklyGoal: 4 }));
    const ctx = await buildTrainingContext(USER_ID);
    expect(computeWeeklyVolume).toHaveBeenCalled();
    expect(ctx.coachingInsights?.weeklyVolume).toBeDefined();
  });

  it("skips weekly volume when the weekly goal is zero", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ weeklyGoal: 0 }));
    const ctx = await buildTrainingContext(USER_ID);
    expect(computeWeeklyVolume).not.toHaveBeenCalled();
    expect(ctx.coachingInsights?.weeklyVolume).toBeUndefined();
  });

  it.each([
    [5, "beginner"],
    [19, "beginner"],
    [20, "intermediate"],
    [79, "intermediate"],
    [80, "advanced"],
    [150, "advanced"],
  ])("classifies %i total workouts as experience level %s", async (total, level) => {
    statsMock.mockReturnValue(makeStats({ totalWorkouts: total }));
    await buildTrainingContext(USER_ID);
    expect(decideMock).toHaveBeenCalledWith(
      expect.objectContaining({ profile: expect.objectContaining({ experienceLevel: level }) }),
    );
  });

  it.each([
    ["rising", "declining"],
    ["falling", "improving"],
    ["stable", "flat"],
    ["insufficient_data", "insufficient_data"],
  ])("maps rpe trend %s to test-trend direction %s", async (trend, direction) => {
    rpeMock.mockReturnValue(makeRpe({ rpeTrend: trend }));
    await buildTrainingContext(USER_ID);
    expect(decideMock).toHaveBeenCalledWith(expect.objectContaining({ testTrend: { direction } }));
  });

  it("flags high soreness when the rpe fatigue flag is set", async () => {
    rpeMock.mockReturnValue(makeRpe({ fatigueFlag: true }));
    await buildTrainingContext(USER_ID);
    expect(decideMock).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryMarkers: expect.objectContaining({ soreness: "high" }) }),
    );
  });

  it("counts workouts completed in the last seven days for the decision engine", async () => {
    recentMock.mockReturnValue([
      { date: "2026-06-14" },
      { date: "2026-06-10" },
      { date: "2026-06-01" }, // 14 days ago -> excluded
    ] as never);

    await buildTrainingContext(USER_ID);

    expect(decideMock).toHaveBeenCalledWith(
      expect.objectContaining({ latestWorkouts: expect.objectContaining({ completedLast7d: 2 }) }),
    );
  });

  it("logs a blocked-intensity line in a strict performance phase", async () => {
    decideMock.mockReturnValue(makeDecision({ phase: "performance", intensityPermitted: false }));

    await buildTrainingContext(USER_ID);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "strict_phase_intensity_blocked" }),
      expect.any(String),
    );
  });

  it("does not log the blocked-intensity line when intensity is permitted", async () => {
    decideMock.mockReturnValue(makeDecision({ phase: "performance", intensityPermitted: true }));
    await buildTrainingContext(USER_ID);
    const events = vi.mocked(logger.info).mock.calls.map((c) => (c[0] as { event?: string }).event);
    expect(events).not.toContain("strict_phase_intensity_blocked");
  });

  it("includes the MAF trend for MAF-method athletes", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ trainingStyleId: "maf_method" }));

    const ctx = await buildTrainingContext(USER_ID);

    expect(storage.mafTests.listTestResults).toHaveBeenCalledWith(USER_ID);
    expect(summarizeMafTrend).toHaveBeenCalled();
    expect(ctx.mafTrend).toEqual({ testCount: 2 });
  });

  it("omits the MAF trend and skips the reads for non-MAF athletes", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ trainingStyleId: "hyrox" }));

    const ctx = await buildTrainingContext(USER_ID);

    expect(storage.mafTests.listTestResults).not.toHaveBeenCalled();
    expect(ctx.mafTrend).toBeUndefined();
  });

  it("omits nutrition when the nutrition builder returns undefined", async () => {
    nutritionMock.mockResolvedValue(undefined);

    const ctx = await buildTrainingContext(USER_ID);

    expect(buildNutritionTrainingContext).toHaveBeenCalledWith(USER_ID);
    expect(ctx).not.toHaveProperty("nutrition");
  });

  it("includes the nutrition slice when the builder returns one", async () => {
    const nutrition = {
      windowDays: 14,
      loggedDaysCount: 6,
      avgCalories: 2400,
      avgProteinG: 160,
      avgCarbG: 270,
      avgFatG: 78,
      highLoadDays: [],
      lowMicros: [],
    };
    nutritionMock.mockResolvedValue(nutrition);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.nutrition).toEqual(nutrition);
  });

  it("attaches the next-session fuelling target when nutrition and an upcoming day exist", async () => {
    const upcomingDay = { planDayId: "pd-1", date: "2026-06-16", focus: "Legs", mainWorkout: "Squats" };
    const fuelling = { date: "2026-06-16", focus: "Legs", preCarbG: 35 };
    nutritionMock.mockResolvedValue({ windowDays: 14, loggedDaysCount: 2 } as never);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([upcomingDay] as never);
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ bodyweightKg: 75 }));
    nextSessionFuellingMock.mockReturnValue(fuelling as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(buildNextSessionFuelling).toHaveBeenCalledWith(upcomingDay, 75, "km");
    expect(ctx.nutrition?.nextSessionFuelling).toEqual(fuelling);
  });

  it("skips next-session fuelling when the nutrition slice is absent", async () => {
    nutritionMock.mockResolvedValue(undefined);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      { planDayId: "pd-1", date: "2026-06-16", focus: "Legs", mainWorkout: "Squats" },
    ] as never);

    await buildTrainingContext(USER_ID);

    expect(buildNextSessionFuelling).not.toHaveBeenCalled();
  });

  it("includes unit preferences only when the user has them", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(
      makeUser({ weightUnit: "lbs", distanceUnit: "miles", mafHr: 135 }),
    );
    const ctx = await buildTrainingContext(USER_ID);
    expect(ctx.weightUnit).toBe("lbs");
    expect(ctx.distanceUnit).toBe("miles");
    expect(ctx.mafHr).toBe(135);
  });

  it("defaults mafHr to null and omits absent unit preferences", async () => {
    const ctx = await buildTrainingContext(USER_ID);
    expect(ctx.mafHr).toBeNull();
    expect(ctx).not.toHaveProperty("weightUnit");
    expect(ctx).not.toHaveProperty("distanceUnit");
  });

  it("caps recent workouts at ten", async () => {
    recentMock.mockReturnValue(
      Array.from({ length: 12 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      })) as never,
    );
    const ctx = await buildTrainingContext(USER_ID);
    expect(ctx.recentWorkouts).toHaveLength(10);
  });

  it("maps upcoming planned days, including exercise details when present", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      {
        planDayId: "pd-1",
        date: "2026-06-16",
        focus: "Legs",
        mainWorkout: "Squats",
        accessory: null,
        notes: null,
        aiSource: null,
        aiRationale: null,
        aiNoteUpdatedAt: null,
        aiInputsUsed: null,
        exerciseSets: [{ exerciseName: "back_squat", setNumber: 1, reps: 5, sortOrder: 0 }],
      },
    ] as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.upcomingWorkouts?.[0]).toMatchObject({ planDayId: "pd-1", focus: "Legs" });
    expect(ctx.upcomingWorkouts?.[0].exerciseDetails).toEqual([
      {
        exerciseName: "back_squat",
        customLabel: undefined,
        category: undefined,
        setNumber: 1,
        reps: 5,
        weight: undefined,
        distance: undefined,
        time: undefined,
        notes: undefined,
        sortOrder: 0,
      },
    ]);
  });

  it("falls back to the planned prescription in upcoming exercise details", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      {
        planDayId: "pd-1",
        date: "2026-06-16",
        focus: "Legs",
        mainWorkout: "Squats",
        exerciseSets: [
          // Plan-day sets carry the prescription in planned*; actuals are null
          // until the workout is logged.
          { exerciseName: "back_squat", setNumber: 1, reps: null, plannedReps: 5, weight: null, plannedWeight: 100, sortOrder: 0 },
        ],
      },
    ] as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.upcomingWorkouts?.[0].exerciseDetails?.[0]).toMatchObject({
      reps: 5,
      weight: 100,
    });
  });

  it("omits exercise details for upcoming days without exercise sets", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      {
        planDayId: "pd-2",
        date: "2026-06-17",
        focus: "Rest",
        mainWorkout: "",
        accessory: null,
        notes: null,
        aiSource: null,
        aiRationale: null,
        aiNoteUpdatedAt: null,
        aiInputsUsed: null,
        exerciseSets: [],
      },
    ] as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.upcomingWorkouts?.[0]).not.toHaveProperty("exerciseDetails");
  });

  it("treats a wholly missing exerciseSets field as no exercise details", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      { planDayId: "pd-3", date: "2026-06-18", focus: "Rest", mainWorkout: "" },
    ] as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.upcomingWorkouts?.[0]).not.toHaveProperty("exerciseDetails");
  });

  it("falls back to defaults when the active plan has a null goal and no computed week", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
      name: "Plan",
      totalWeeks: 8,
      startDate: "2026-05-01",
      goal: null,
    } as never);
    weekMock.mockReturnValue(undefined as never);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.activePlan).toEqual({
      name: "Plan",
      totalWeeks: 8,
      currentWeek: undefined,
      goal: undefined,
    });
    expect(computePlanPhase).toHaveBeenCalledWith(8, 1); // currentWeek ?? 1
  });

  it("tolerates a missing user record", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);

    const ctx = await buildTrainingContext(USER_ID);

    expect(ctx.mafHr).toBeNull();
    expect(ctx.weeklyGoal).toBeUndefined();
    expect(ctx).not.toHaveProperty("weightUnit");
    expect(computeWeeklyVolume).not.toHaveBeenCalled();
    expect(storage.mafTests.listTestResults).not.toHaveBeenCalled();
  });
});
