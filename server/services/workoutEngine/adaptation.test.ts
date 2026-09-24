import type { PlanEngineState } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  type AdaptablePlanDay,
  type AdaptationInput,
  type AdaptationLog,
  type AdaptationSet,
  adaptPlan,
} from "./adaptation";

const TODAY = "2026-10-14";
const NOW = "2026-10-14T18:00:00.000Z";

function squatDay(
  id: string,
  date: string,
  weekNumber: number,
  weight: number,
  reps = 6,
): AdaptablePlanDay {
  return {
    id,
    date,
    weekNumber,
    mainWorkout: `Warm-up: 8 min bike\nA) Front Squat 4x${reps} @ ${weight} kg (RPE 8, rest 2-3 min)`,
    accessory: null,
    notes: null,
    aiInputsUsed: null,
    sets: [1, 2, 3, 4].map((n) => ({
      id: `${id}-${n}`,
      exerciseName: "front_squat",
      reps,
      weight,
      weightUnit: "kg",
    })),
  };
}

const UPCOMING = [
  squatDay("a", "2026-10-16", 5, 85),
  squatDay("b", "2026-10-23", 6, 87.5),
  // Beyond the three-week horizon: a later log will reach it.
  squatDay("c", "2026-11-20", 10, 95),
];

function log(id: string, date: string, overrides: Partial<AdaptationLog> = {}): AdaptationLog {
  return { id, date, focus: "Strength", rpe: 7, countsAsTraining: true, ...overrides };
}

function squatSets(
  logId: string,
  date: string,
  reps: number[],
  weight: number,
  planned: { reps: number; weight: number } | null = { reps: 6, weight: 82.5 },
): AdaptationSet[] {
  return reps.map((rep, index) => ({
    workoutLogId: logId,
    date,
    exerciseName: "front_squat",
    category: "strength",
    setNumber: index + 1,
    reps: rep,
    weight,
    weightUnit: "kg",
    plannedReps: planned?.reps ?? null,
    plannedWeight: planned?.weight ?? null,
  }));
}

function input(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return {
    today: TODAY,
    now: NOW,
    weightUnit: "kg",
    distanceUnit: "km",
    plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: null },
    logs: [log("l1", "2026-10-13")],
    sets: squatSets("l1", "2026-10-13", [6, 6, 6, 6], 82.5),
    upcoming: UPCOMING,
    fatigued: false,
    ...overrides,
  };
}

function weights(result: ReturnType<typeof adaptPlan>, dayId: string): number[] | undefined {
  const day = result.days.find((entry) => entry.planDayId === dayId);
  return day?.setUpdates.map((update) => update.weight!);
}

describe("adaptPlan — strength", () => {
  it("raises the lift's upcoming loads when a session beats its prescription", () => {
    // 4x8 where 4x6 @ 82.5 was planned: ~5% more than the plan assumed.
    const result = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }));

    expect(weights(result, "a")).toEqual([90, 90, 90, 90]);
    expect(weights(result, "b")).toEqual([92.5, 92.5, 92.5, 92.5]);
    expect(weights(result, "c")).toBeUndefined();
    const a = result.days.find((day) => day.planDayId === "a")!;
    expect(a.mainWorkout).toContain("A) Front Squat 4x6 @ 90 kg (RPE 8, rest 2-3 min)");
    expect(a.rationale).toMatch(
      /^Auto-progression: .*4x8 @ 82\.5 kg beat the planned 4x6 @ 82\.5 kg/,
    );
    expect(a.changes).toEqual([
      { exercise: "front_squat", kind: "raise", from: 85, to: 90, unit: "kg" },
    ]);
    expect(a.inputsUsed.lastModification).toMatchObject({ kind: "auto_progression", at: NOW });
    expect(a.inputsUsed.progressionChanges).toEqual(a.changes);
    expect(a.inputsUsed.planPhase).toBe("build");
  });

  it("applies each logged workout once", () => {
    const first = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }));
    expect(first.adaptedLogIds).toEqual(["l1"]);

    const again = adaptPlan(
      input({
        sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5),
        plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: first.engineState },
      }),
    );
    expect(again.days).toEqual([]);
    expect(again.adaptedLogIds).toEqual([]);
  });

  it("leaves the plan alone when a session simply met its prescription", () => {
    expect(adaptPlan(input()).days).toEqual([]);
  });

  it("takes one step up when a met session felt easy", () => {
    const result = adaptPlan(input({ logs: [log("l1", "2026-10-13", { rpe: 6 })] }));
    expect(weights(result, "a")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(result.days[0].rationale).toContain("felt easy (RPE 6)");
  });

  it("holds the next session at the load when a met session was a grind", () => {
    const result = adaptPlan(input({ logs: [log("l1", "2026-10-13", { rpe: 9 })] }));
    expect(weights(result, "a")).toEqual([82.5, 82.5, 82.5, 82.5]);
    expect(result.days[0].changes[0].kind).toBe("hold");
    expect(result.days[0].rationale).toContain("felt very hard (RPE 9)");
  });

  it("repeats a missed load before it climbs again", () => {
    const result = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [6, 6, 5, 4], 82.5) }));
    expect(weights(result, "a")).toEqual([82.5, 82.5, 82.5, 82.5]);
    // A week later progression resumes from the held load, not from the old plan.
    expect(weights(result, "b")).toEqual([82.5, 82.5, 82.5, 82.5]);
    expect(result.days[0].rationale).toContain("fell short (6, 6, 5, 4)");
  });

  it("deloads 10% when the same prescription is missed twice in a row", () => {
    const state: PlanEngineState = {
      version: 1,
      runVdot: null,
      adaptedLogIds: ["l0"],
      updatedAt: NOW,
    };
    const result = adaptPlan(
      input({
        plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: state },
        logs: [log("l0", "2026-10-06"), log("l1", "2026-10-13")],
        sets: [
          ...squatSets("l0", "2026-10-06", [6, 6, 5, 5], 82.5),
          ...squatSets("l1", "2026-10-13", [6, 5, 5, 4], 82.5),
        ],
      }),
    );
    // 82.5 x 0.9 = 74.25 → 72.5 on the bar; a week later 74.25 x 1.025 → 75.
    expect(weights(result, "a")).toEqual([72.5, 72.5, 72.5, 72.5]);
    expect(weights(result, "b")).toEqual([75, 75, 75, 75]);
    expect(result.days[0].changes[0].kind).toBe("deload");
    expect(result.days[0].rationale).toContain("missed twice in a row");
  });

  it("never raises while the athlete is fatigued, but still holds a missed load", () => {
    const beat = adaptPlan(
      input({ fatigued: true, sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }),
    );
    expect(beat.days).toEqual([]);
    const missed = adaptPlan(
      input({ fatigued: true, sets: squatSets("l1", "2026-10-13", [6, 6, 5, 4], 82.5) }),
    );
    expect(weights(missed, "a")).toEqual([82.5, 82.5, 82.5, 82.5]);
  });

  it("never raises a taper or race-week session", () => {
    // A 6-week plan: week 5 is the taper.
    const result = adaptPlan(
      input({
        plan: { startDate: "2026-09-14", totalWeeks: 6, engineState: null },
        sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5),
      }),
    );
    expect(weights(result, "a")).toBeUndefined();
  });

  it("pulls the plan up to stronger ad-hoc work, but never down to lighter work", () => {
    const stronger = adaptPlan(
      input({ sets: squatSets("l1", "2026-10-13", [5, 5, 5, 5], 100, null) }),
    );
    expect(weights(stronger, "a")).toEqual([90, 90, 90, 90]);
    expect(stronger.days[0].rationale).toContain("is ahead of the plan");

    const lighter = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [5, 5, 5], 60, null) }));
    expect(lighter.days).toEqual([]);
  });

  it("ignores old logs, logs from before the plan, non-training sessions and excluded days", () => {
    const beat = (id: string, date: string) => squatSets(id, date, [8, 8, 8, 8], 82.5);
    expect(
      adaptPlan(input({ logs: [log("old", "2026-09-30")], sets: beat("old", "2026-09-30") })).days,
    ).toEqual([]);
    expect(
      adaptPlan(
        input({
          plan: { startDate: "2026-10-14", totalWeeks: 12, engineState: null },
          sets: beat("l1", "2026-10-13"),
        }),
      ).days,
    ).toEqual([]);
    expect(
      adaptPlan(
        input({
          logs: [log("l1", "2026-10-13", { countsAsTraining: false })],
          sets: beat("l1", "2026-10-13"),
        }),
      ).days,
    ).toEqual([]);
    const excluded = adaptPlan(
      input({ sets: beat("l1", "2026-10-13"), excludedDayIds: new Set(["a"]) }),
    );
    expect(weights(excluded, "a")).toBeUndefined();
    expect(weights(excluded, "b")).toBeDefined();
  });

  it("reads a pounds athlete's logs and plan in pounds", () => {
    const lbsDay: AdaptablePlanDay = {
      ...squatDay("a", "2026-10-16", 5, 185),
      mainWorkout: "A) Front Squat 4x6 @ 185 lbs",
      sets: [1, 2, 3, 4].map((n) => ({
        id: `a-${n}`,
        exerciseName: "front_squat",
        reps: 6,
        weight: 185,
        weightUnit: "lbs",
      })),
    };
    const result = adaptPlan(
      input({
        weightUnit: "lbs",
        upcoming: [lbsDay],
        sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 180, { reps: 6, weight: 180 }).map(
          (set) => ({ ...set, weightUnit: "lbs" }),
        ),
      }),
    );
    // 185 x 1.05 = 194.25 → 195 on 5 lb steps.
    expect(weights(result, "a")).toEqual([195, 195, 195, 195]);
    expect(result.days[0].mainWorkout).toBe("A) Front Squat 4x6 @ 195 lbs");
  });
});

describe("adaptPlan — returning from a break", () => {
  const history = (dates: string[], weight = 85) =>
    dates.flatMap((date) => squatSets(`h-${date}`, date, [5, 5, 5], weight, null));

  it("eases a lift back in below where the athlete left it", () => {
    // Weekly squats, then five weeks off (last session 8 Sep, next 16 Oct).
    const result = adaptPlan(
      input({ logs: [], sets: history(["2026-08-25", "2026-09-01", "2026-09-08"]) }),
    );
    // 85 x 5 less 7.5% (three weeks beyond the first two), as a 6-rep load → 75.
    expect(weights(result, "a")).toEqual([75, 75, 75, 75]);
    // A week later it has built 2.5% from there, not jumped back to the old plan.
    expect(weights(result, "b")).toEqual([77.5, 77.5, 77.5, 77.5]);
    const [a, b] = result.days;
    expect(a.rationale).toContain("It has been 5 weeks since your last Front Squat (85 kg x 5)");
    expect(b.rationale).toContain("Front Squat keeps building from its return load");
    expect(a.changes[0].kind).toBe("hold");
  });

  it("is idempotent, and leaves lifts trained recently or rarely alone", () => {
    const sets = history(["2026-08-25", "2026-09-01", "2026-09-08"]);
    const first = adaptPlan(input({ logs: [], sets }));
    const settled = UPCOMING.map((day) => {
      const update = first.days.find((entry) => entry.planDayId === day.id);
      if (!update) return day;
      const weight = update.setUpdates[0].weight!;
      return { ...day, sets: day.sets.map((set) => ({ ...set, weight })) };
    });
    expect(adaptPlan(input({ logs: [], sets, upcoming: settled })).days).toEqual([]);

    const recent = history(["2026-09-29", "2026-10-06", "2026-10-10"]);
    expect(adaptPlan(input({ logs: [], sets: recent })).days).toEqual([]);
    const rare = history(["2026-09-01", "2026-09-08"]);
    expect(adaptPlan(input({ logs: [], sets: rare })).days).toEqual([]);
  });
});

describe("adaptPlan — runs", () => {
  const runDay: AdaptablePlanDay = {
    id: "run",
    date: "2026-10-17",
    weekNumber: 5,
    mainWorkout: "15 min easy, 3 x 8 min @ 5:04/km with 2 min jog, 10 min easy",
    accessory: null,
    notes: "Easy pace 6:05-6:42/km",
    aiInputsUsed: null,
    sets: [{ id: "run-1", exerciseName: "tempo_run", notes: "5:04/km · 2 min jog" }],
  };
  const runLogs = [
    log("r1", "2026-10-02", { focus: "Run", distanceMeters: 8000, duration: 48, rpe: 4 }),
    log("r2", "2026-10-06", { focus: "Run", distanceMeters: 8000, duration: 47, rpe: 4 }),
    log("r3", "2026-10-12", { focus: "Run", distanceMeters: 5000, duration: 22, rpe: 9 }),
  ];
  const state = (runVdot: number | null): PlanEngineState => ({
    version: 1,
    runVdot,
    adaptedLogIds: ["r1", "r2"],
    updatedAt: NOW,
  });

  it("moves every written pace up after a new best effort", () => {
    const result = adaptPlan(
      input({
        plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: state(40) },
        logs: runLogs,
        sets: [],
        upcoming: [runDay],
      }),
    );
    const day = result.days[0];
    // 5 km in 22:00 is VDOT ~44.5; one pass moves at most 6%, to 42.4.
    expect(result.engineState.runVdot).toBe(42.4);
    expect(day.mainWorkout).toMatch(/3 x 8 min @ 4:5\d\/km/);
    expect(day.notes).toBe("Easy pace 5:49-6:24/km");
    expect(day.setUpdates).toEqual([
      { setId: "run-1", notes: expect.stringMatching(/^4:5\d\/km · 2 min jog$/) },
    ]);
    expect(day.changes).toEqual([
      { exercise: "run_paces", kind: "pace", from: 40, to: 42.4, unit: "vdot" },
    ]);
    expect(day.rationale).toContain("is a new best, so run paces move up");
  });

  it("remembers the athlete's fitness without rewriting when the plan had none", () => {
    const result = adaptPlan(
      input({
        plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: state(null) },
        logs: runLogs,
        sets: [],
        upcoming: [runDay],
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.runVdot).toBeCloseTo(44.5, 0);
  });

  it("keeps paces when the athlete is fatigued or the best is not new", () => {
    const base = {
      plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: state(40) },
      logs: runLogs,
      sets: [],
      upcoming: [runDay],
    };
    expect(adaptPlan(input({ ...base, fatigued: true })).days).toEqual([]);
    expect(
      adaptPlan(
        input({
          ...base,
          plan: { ...base.plan, engineState: { ...state(40), adaptedLogIds: ["r1", "r2", "r3"] } },
        }),
      ).days,
    ).toEqual([]);
  });
});
