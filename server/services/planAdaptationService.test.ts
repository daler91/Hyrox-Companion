import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../gemini/index";
import { fingerprintStoredPlanDay } from "./autoCoachWriteGuard";
import {
  adaptedDayIds,
  applyPlanAdaptation,
  computePlanAdaptation,
  isFatigued,
  type PlanAdaptation,
} from "./planAdaptationService";

const plans = vi.hoisted(() => ({
  getActivePlan: vi.fn(),
  getPlanDaysForAdaptation: vi.fn(),
  getPlanDaysForMissAdaptation: vi.fn(),
  updatePlanDay: vi.fn(),
  updatePlanDaySets: vi.fn(),
  updateEngineState: vi.fn(),
}));
const analytics = vi.hoisted(() => ({
  getWorkoutLogsByDateRange: vi.fn(),
  getAllExerciseSetsWithDates: vi.fn(),
}));
const timelineAnnotations = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../storage", () => ({ storage: { plans, analytics, timelineAnnotations } }));
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
  plans.getActivePlan.mockResolvedValue({
    id: "plan-1",
    startDate: "2026-09-14",
    totalWeeks: 12,
    engineState: null,
  });
  plans.getPlanDaysForAdaptation.mockResolvedValue([planDayRow()]);
  plans.getPlanDaysForMissAdaptation.mockResolvedValue([]);
  timelineAnnotations.list.mockResolvedValue([]);
  analytics.getWorkoutLogsByDateRange.mockResolvedValue([
    { id: "log-1", date: "2026-10-13", focus: "Strength", rpe: 7, countsAsTraining: true },
  ]);
  analytics.getAllExerciseSetsWithDates.mockResolvedValue(
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
    })),
  );
});

describe("computePlanAdaptation", () => {
  it("adapts the active plan from its stored days and the athlete's logs", async () => {
    const result = await computePlanAdaptation("user-1", context, units, new Set());

    expect(plans.getPlanDaysForAdaptation).toHaveBeenCalledWith("plan-1", TODAY);
    expect(analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("user-1", "2026-08-05", TODAY);
    expect(result?.planId).toBe("plan-1");
    expect(result?.result.days[0]?.setUpdates.map((update) => update.weight)).toEqual([
      90, 90, 90, 90,
    ]);
    expect(adaptedDayIds(result)).toEqual(new Set(["day-a"]));
  });

  it("records what it read, so the coach's write can tell the plan moved (AI16)", async () => {
    plans.getActivePlan.mockResolvedValueOnce({
      id: "plan-1",
      startDate: "2026-09-14",
      totalWeeks: 12,
      engineState: { version: 1, runVdot: null, adaptedLogIds: [], updatedAt: "2026-10-01T00:00:00Z" },
    });

    const result = await computePlanAdaptation("user-1", context, units, new Set());

    expect(result?.baseline.engineStateUpdatedAt).toBe("2026-10-01T00:00:00Z");
    const row = planDayRow();
    expect(result?.baseline.dayFingerprints).toEqual(
      new Map([["day-a", fingerprintStoredPlanDay(row, row.sets as never)]]),
    );
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

  // D14 (CODEBASE_ANALYSIS_2026-10-03): a custom lift is keyed by its label, so
  // the stored plan sets must carry it, or no logged custom lift ever finds its
  // planned sets, and the day's other custom lifts would share one identity.
  it("adapts a custom lift by its label and leaves the day's other custom lift alone", async () => {
    const custom = (id: string, customLabel: string, weight: number) => ({
      id,
      exerciseName: "custom",
      customLabel,
      reps: 6,
      weight,
      weightUnit: "kg",
      notes: null,
    });
    plans.getPlanDaysForAdaptation.mockResolvedValueOnce([
      {
        ...planDayRow(),
        mainWorkout: "A) Yoke Carry 3x6 @ 100 kg\nB) Sandbag Clean 3x6 @ 40 kg",
        sets: [
          custom("y1", "Yoke Carry", 100),
          custom("y2", "Yoke Carry", 100),
          custom("y3", "Yoke Carry", 100),
          custom("c1", "Sandbag Clean", 40),
          custom("c2", "Sandbag Clean", 40),
          custom("c3", "Sandbag Clean", 40),
        ],
      },
    ]);
    analytics.getAllExerciseSetsWithDates.mockResolvedValueOnce(
      [1, 2, 3].map((setNumber) => ({
        workoutLogId: "log-1",
        date: "2026-10-13",
        exerciseName: "custom",
        customLabel: "Yoke Carry",
        category: "strength",
        setNumber,
        reps: 8,
        weight: 100,
        weightUnit: "kg",
        plannedReps: 6,
        plannedWeight: 100,
      })),
    );

    const result = await computePlanAdaptation("user-1", context, units, new Set());

    const day = result?.result.days.at(0);
    expect(day?.setUpdates).toEqual(
      ["y1", "y2", "y3"].map((setId) => ({ setId, weight: 105, weightUnit: "kg" })),
    );
    expect(day?.mainWorkout).toBe("A) Yoke Carry 3x6 @ 105 kg\nB) Sandbag Clean 3x6 @ 40 kg");
    expect(day?.changes.map((change) => change.exercise)).toEqual(["Yoke Carry"]);
  });

  describe("sessions that never happened", () => {
    /** Last Friday's squat session, not done: 4x6 @ 82.5 kg where this Friday's climbs to 85. */
    function missedRow(overrides: Record<string, unknown> = {}) {
      return {
        ...planDayRow(),
        id: "day-missed",
        scheduledDate: "2026-10-09",
        weekNumber: 3,
        status: "missed",
        focus: "Lower Strength",
        priority: null,
        mainWorkout: "A) Front Squat 4x6 @ 82.5 kg",
        sets: [1, 2, 3, 4].map((n) => ({
          id: `m${n}`,
          exerciseName: "front_squat",
          category: "strength",
          reps: 6,
          weight: 82.5,
          weightUnit: "kg",
          notes: null,
        })),
        ...overrides,
      };
    }

    function heldWeights(result: Awaited<ReturnType<typeof computePlanAdaptation>>) {
      return result?.result.days.at(0)?.setUpdates.map((update) => update.weight);
    }

    beforeEach(() => {
      // No new log: only the missed session speaks.
      analytics.getWorkoutLogsByDateRange.mockResolvedValue([]);
      analytics.getAllExerciseSetsWithDates.mockResolvedValue([]);
    });

    it("reads the last two weeks, sessions skipped ahead, and the days it holds a change for", async () => {
      plans.getActivePlan.mockResolvedValueOnce({
        id: "plan-1",
        startDate: "2026-09-14",
        totalWeeks: 12,
        engineState: {
          version: 1,
          runVdot: null,
          adaptedLogIds: [],
          missHolds: [
            { planDayId: "day-held", missedOn: "2026-10-02", exercise: "back_squat", unit: "kg", sets: [] },
            { planDayId: "day-held", missedOn: "2026-10-02", exercise: "bench_press", unit: "kg", sets: [] },
          ],
          updatedAt: "t0",
        },
      });

      await computePlanAdaptation("user-1", context, units, new Set());

      expect(plans.getPlanDaysForMissAdaptation).toHaveBeenCalledWith("plan-1", {
        from: "2026-09-30",
        today: TODAY,
        until: "2026-11-04",
        alsoIds: ["day-held"],
      });
    });

    it("holds the next session at a missed session's load", async () => {
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow()]);

      const result = await computePlanAdaptation("user-1", context, units, new Set());

      expect(heldWeights(result)).toEqual([82.5, 82.5, 82.5, 82.5]);
      expect(result?.result.days.at(0)?.rationale).toContain(
        "You missed Friday's Front Squat (4x6 @ 82.5 kg)",
      );
      expect(result?.result.engineState.adaptedMisses).toEqual(["day-missed|2026-10-09"]);
    });

    it("reads a skip, and a planned day the sweep has not reached, as not done", async () => {
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow({ status: "skipped" })]);
      const skipped = await computePlanAdaptation("user-1", context, units, new Set());
      expect(skipped?.result.days.at(0)?.rationale).toContain("You skipped Friday's Front Squat");

      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow({ status: "planned" })]);
      const unswept = await computePlanAdaptation("user-1", context, units, new Set());
      expect(unswept?.result.days.at(0)?.rationale).toContain("You missed Friday's Front Squat");
    });

    it("never calls a session inside a declared absence a miss", async () => {
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow()]);
      timelineAnnotations.list.mockResolvedValueOnce([
        { startDate: "2026-10-08", endDate: "2026-10-10", type: "travel" },
      ]);

      const result = await computePlanAdaptation("user-1", context, units, new Set());

      expect(heldWeights(result)).toEqual([82.5, 82.5, 82.5, 82.5]);
      const rationale = result?.result.days.at(0)?.rationale ?? "";
      expect(rationale).toContain("Friday's Front Squat (4x6 @ 82.5 kg) didn't happen");
      expect(rationale).not.toMatch(/missed/i);
    });

    it("follows only the sessions the plan leans on", async () => {
      const ignored = [
        // The plan never needed an optional session, and a rest day is not one.
        missedRow({ priority: "optional" }),
        missedRow({ focus: "Easy Recovery" }),
        missedRow({ focus: "Rest", mainWorkout: "Rest day", sets: missedRow().sets }),
      ];
      for (const row of ignored) {
        plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([row]);
        const result = await computePlanAdaptation("user-1", context, units, new Set());
        expect(result?.result.days).toEqual([]);
        expect(result?.result.engineState.adaptedMisses).toEqual([]);
      }
    });

    it("leaves out a day the race date sets and a day past a retired plan's cut-off", async () => {
      const base = { id: "plan-1", startDate: "2026-09-14", totalWeeks: 12, engineState: null };
      // 9 Oct is the shakeout before a race on the 10th: its stored session was never shown.
      plans.getActivePlan.mockResolvedValueOnce({ ...base, raceDate: "2026-10-10" });
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow()]);
      const raceWeek = await computePlanAdaptation("user-1", context, units, new Set());
      expect(raceWeek?.result.days).toEqual([]);

      plans.getActivePlan.mockResolvedValueOnce({ ...base, retiredOn: "2026-10-09" });
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow()]);
      const retired = await computePlanAdaptation("user-1", context, units, new Set());
      expect(retired?.result.days).toEqual([]);
    });

    it("takes a hold back once the session is in the plan again", async () => {
      const held = {
        version: 1 as const,
        runVdot: null,
        adaptedLogIds: [],
        adaptedMisses: ["day-missed|2026-10-09"],
        missHolds: [
          {
            planDayId: "day-missed",
            missedOn: "2026-10-09",
            exercise: "front_squat",
            unit: "kg",
            sets: [1, 2, 3, 4].map((n) => ({ setId: `s${n}`, from: 85, to: 82.5 })),
          },
        ],
        updatedAt: "t0",
      };
      const heldDay = {
        ...planDayRow(),
        mainWorkout: "A) Front Squat 4x6 @ 82.5 kg",
        sets: planDayRow().sets.map((set) => ({ ...set, weight: 82.5 })),
      };
      const plan = { id: "plan-1", startDate: "2026-09-14", totalWeeks: 12, engineState: held };

      // Folded into a day still ahead.
      plans.getActivePlan.mockResolvedValueOnce(plan);
      plans.getPlanDaysForAdaptation.mockResolvedValueOnce([heldDay]);
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([
        missedRow({ status: "planned", scheduledDate: "2026-10-15" }),
      ]);
      const folded = await computePlanAdaptation("user-1", context, units, new Set());
      expect(heldWeights(folded)).toEqual([85, 85, 85, 85]);
      expect(folded?.result.engineState.missHolds).toEqual([]);

      // Still missed: the hold stays as it is.
      plans.getActivePlan.mockResolvedValueOnce(plan);
      plans.getPlanDaysForAdaptation.mockResolvedValueOnce([heldDay]);
      plans.getPlanDaysForMissAdaptation.mockResolvedValueOnce([missedRow()]);
      const still = await computePlanAdaptation("user-1", context, units, new Set());
      expect(still?.result.days).toEqual([]);
      expect(still?.result.engineState.missHolds).toEqual(held.missHolds);
    });
  });

  it("is null without an active plan, and never throws", async () => {
    plans.getActivePlan.mockResolvedValueOnce(undefined);
    expect(await computePlanAdaptation("user-1", context, units, new Set())).toBeNull();

    analytics.getAllExerciseSetsWithDates.mockRejectedValueOnce(new Error("db down"));
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
    baseline: { engineStateUpdatedAt: null, dayFingerprints: new Map() },
  };

  it("writes each day's note, text and sets, then the plan's engine state", async () => {
    plans.updatePlanDay.mockResolvedValueOnce({ id: "day-a" }).mockResolvedValueOnce(undefined);

    expect(await applyPlanAdaptation(pass, "user-1", tx)).toBe(1);

    expect(plans.updatePlanDay).toHaveBeenCalledWith(
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
    expect(plans.updatePlanDaySets).toHaveBeenCalledTimes(1);
    expect(plans.updatePlanDaySets).toHaveBeenCalledWith(
      "day-a",
      pass.result.days[0].setUpdates,
      tx,
    );
    expect(plans.updateEngineState).toHaveBeenCalledWith(
      "plan-1",
      "user-1",
      pass.result.engineState,
      tx,
    );
  });

  it("does nothing without an adaptation", async () => {
    expect(await applyPlanAdaptation(null, "user-1", tx)).toBe(0);
    expect(plans.updateEngineState).not.toHaveBeenCalled();
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
