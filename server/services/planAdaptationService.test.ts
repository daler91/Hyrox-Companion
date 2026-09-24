import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../gemini/index";
import { storage } from "../storage";
import {
  adaptedDayIds,
  applyPlanAdaptation,
  computePlanAdaptation,
  isFatigued,
  type PlanAdaptation,
} from "./planAdaptationService";

vi.mock("../storage", () => ({
  storage: {
    plans: {
      getActivePlan: vi.fn(),
      getPlanDaysForAdaptation: vi.fn(),
      updatePlanDay: vi.fn(),
      updatePlanDaySets: vi.fn(),
      updateEngineState: vi.fn(),
    },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
    },
  },
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const TODAY = "2026-10-14";
const context = { currentDate: TODAY } as unknown as TrainingContext;
const units = { weightUnit: "kg", distanceUnit: "km" };

function planDayRow() {
  return {
    id: "day-a",
    scheduledDate: "2026-10-16",
    weekNumber: 5,
    mainWorkout: "A) Front Squat 4x6 @ 85 kg",
    accessory: null,
    notes: null,
    aiInputsUsed: null,
    sets: [1, 2, 3, 4].map((n) => ({
      id: `s${n}`,
      exerciseName: "front_squat",
      reps: 6,
      weight: 85,
      weightUnit: "kg",
      notes: null,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
    id: "plan-1",
    startDate: "2026-09-14",
    totalWeeks: 12,
    engineState: null,
  } as never);
  vi.mocked(storage.plans.getPlanDaysForAdaptation).mockResolvedValue([planDayRow()] as never);
  vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
    { id: "log-1", date: "2026-10-13", focus: "Strength", rpe: 7, countsAsTraining: true },
  ] as never);
  vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue(
    [1, 2, 3, 4].map((setNumber) => ({
      workoutLogId: "log-1",
      date: "2026-10-13",
      exerciseName: "front_squat",
      category: "strength",
      setNumber,
      reps: 8,
      weight: 82.5,
      weightUnit: "kg",
      plannedReps: 6,
      plannedWeight: 82.5,
    })) as never,
  );
});

describe("computePlanAdaptation", () => {
  it("adapts the active plan from its stored days and the athlete's logs", async () => {
    const result = await computePlanAdaptation("user-1", context, units, new Set());

    expect(storage.plans.getPlanDaysForAdaptation).toHaveBeenCalledWith("plan-1", TODAY);
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
      "user-1",
      "2026-08-05",
      TODAY,
    );
    expect(result?.planId).toBe("plan-1");
    expect(result?.result.days[0]?.setUpdates.map((update) => update.weight)).toEqual([
      90, 90, 90, 90,
    ]);
    expect(adaptedDayIds(result)).toEqual(new Set(["day-a"]));
  });

  it("leaves days another stage rewrote alone", async () => {
    const result = await computePlanAdaptation("user-1", context, units, new Set(["day-a"]));
    expect(result?.result.days).toEqual([]);
  });

  it("holds back raises while the athlete is fatigued", async () => {
    const tired = {
      currentDate: TODAY,
      coachingInsights: { loadGovernor: { zone: "yellow" } },
    } as unknown as TrainingContext;
    const result = await computePlanAdaptation("user-1", tired, units, new Set());
    expect(result?.result.days).toEqual([]);
  });

  it("is null without an active plan, and never throws", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValueOnce(undefined);
    expect(await computePlanAdaptation("user-1", context, units, new Set())).toBeNull();

    vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockRejectedValueOnce(
      new Error("db down"),
    );
    expect(await computePlanAdaptation("user-1", context, units, new Set())).toBeNull();
  });
});

describe("applyPlanAdaptation", () => {
  const tx = {} as never;
  const pass: PlanAdaptation = {
    planId: "plan-1",
    result: {
      days: [
        {
          planDayId: "day-a",
          setUpdates: [{ setId: "s1", weight: 90, weightUnit: "kg" }],
          mainWorkout: "A) Front Squat 4x6 @ 90 kg",
          rationale: "Auto-progression: ahead of the plan.",
          inputsUsed: { lastModification: { kind: "auto_progression" } },
          changes: [],
        },
        {
          planDayId: "not-mine",
          setUpdates: [{ setId: "x1", weight: 90, weightUnit: "kg" }],
          rationale: "Auto-progression: ahead of the plan.",
          inputsUsed: {},
          changes: [],
        },
      ],
      engineState: { version: 1, runVdot: 40, adaptedLogIds: ["log-1"], updatedAt: "now" },
      adaptedLogIds: ["log-1"],
    },
  };

  it("writes each day's note, text and sets, then the plan's engine state", async () => {
    vi.mocked(storage.plans.updatePlanDay)
      .mockResolvedValueOnce({ id: "day-a" } as never)
      .mockResolvedValueOnce(undefined);

    expect(await applyPlanAdaptation(pass, "user-1", tx)).toBe(1);

    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-a",
      expect.objectContaining({
        mainWorkout: "A) Front Squat 4x6 @ 90 kg",
        aiSource: "progression",
        aiRationale: "Auto-progression: ahead of the plan.",
        aiInputsUsed: { lastModification: { kind: "auto_progression" } },
      }),
      "user-1",
      tx,
    );
    // A day the athlete doesn't own gets no set writes.
    expect(storage.plans.updatePlanDaySets).toHaveBeenCalledTimes(1);
    expect(storage.plans.updatePlanDaySets).toHaveBeenCalledWith(
      "day-a",
      pass.result.days[0].setUpdates,
      tx,
    );
    expect(storage.plans.updateEngineState).toHaveBeenCalledWith(
      "plan-1",
      "user-1",
      pass.result.engineState,
      tx,
    );
  });

  it("does nothing without an adaptation", async () => {
    expect(await applyPlanAdaptation(null, "user-1", tx)).toBe(0);
    expect(storage.plans.updateEngineState).not.toHaveBeenCalled();
  });
});

describe("isFatigued", () => {
  it("reads the load governor's zone and the fatigue flag", () => {
    const withInsights = (insights: Record<string, unknown>) =>
      ({ coachingInsights: insights }) as unknown as TrainingContext;
    expect(isFatigued(withInsights({ loadGovernor: { zone: "danger" } }))).toBe(true);
    expect(isFatigued(withInsights({ fatigueFlag: true }))).toBe(true);
    expect(isFatigued(withInsights({ loadGovernor: { zone: "sweet_spot" } }))).toBe(false);
    expect(isFatigued({} as TrainingContext)).toBe(false);
  });
});
