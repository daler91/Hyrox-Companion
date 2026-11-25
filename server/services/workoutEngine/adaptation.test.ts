import type { PlanEngineState } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  type AdaptablePlanDay,
  type AdaptationInput,
  type AdaptationLog,
  type AdaptationSet,
  adaptPlan,
  type MissedPlanSession,
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

function weights(
  result: ReturnType<typeof adaptPlan>,
  dayId: string,
): (number | undefined)[] | undefined {
  const day = result.days.find((entry) => entry.planDayId === dayId);
  return day?.setUpdates.map((update) => update.weight);
}

describe("adaptPlan — strength", () => {
  it("raises the lift's upcoming loads when a session beats its prescription", () => {
    // 4x8 where 4x6 @ 82.5 was planned: ~5% more than the plan assumed.
    const result = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }));

    expect(weights(result, "a")).toEqual([90, 90, 90, 90]);
    expect(weights(result, "b")).toEqual([92.5, 92.5, 92.5, 92.5]);
    expect(weights(result, "c")).toBeUndefined();
    const a = result.days.find((day) => day.planDayId === "a");
    if (!a) throw new Error("expected day a to be adapted");
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

  it("leaves a variant of the lift in the accessory text alone (C15)", () => {
    const withVariant = UPCOMING.map((day) => ({
      ...day,
      accessory: "C) Paused Front Squat 2x3 @ 60 kg (RPE 6)",
    }));
    const result = adaptPlan(
      input({ upcoming: withVariant, sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }),
    );
    const dayA = result.days.find((day) => day.planDayId === "a");
    expect(dayA?.mainWorkout).toContain("A) Front Squat 4x6 @ 90 kg");
    expect(dayA?.accessory).toBeUndefined();
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

describe("adaptPlan — several logs in one pass (C14)", () => {
  it("does not stack the raises of logs that beat the same prescription", () => {
    // Re-enabling the coach, the debounce or a backfill hands one pass two
    // logs, each measured against the same stale 82.5 kg prescription.
    const result = adaptPlan(
      input({
        logs: [log("l0", "2026-10-09"), log("l1", "2026-10-13")],
        sets: [
          ...squatSets("l0", "2026-10-09", [8, 8, 8, 8], 82.5),
          ...squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5),
        ],
      }),
    );
    // One session's 5%: 85 → 90, not 85 x 1.05 x 1.05 → 95.
    expect(weights(result, "a")).toEqual([90, 90, 90, 90]);
    expect(weights(result, "b")).toEqual([92.5, 92.5, 92.5, 92.5]);
    expect(result.adaptedLogIds).toEqual(["l0", "l1"]);
  });

  it("does not stack catch-ups from two stronger ad-hoc sessions either", () => {
    const result = adaptPlan(
      input({
        logs: [log("l0", "2026-10-09"), log("l1", "2026-10-13")],
        sets: [
          ...squatSets("l0", "2026-10-09", [5, 5, 5, 5], 100, null),
          ...squatSets("l1", "2026-10-13", [5, 5, 5, 5], 100, null),
        ],
      }),
    );
    expect(weights(result, "a")).toEqual([90, 90, 90, 90]);
  });

  it("still raises from a load an earlier log in the pass held down", () => {
    const result = adaptPlan(
      input({
        logs: [log("l0", "2026-10-09"), log("l1", "2026-10-13")],
        sets: [
          ...squatSets("l0", "2026-10-09", [6, 6, 5, 4], 82.5),
          ...squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5),
        ],
      }),
    );
    // Held at 82.5, then 82.5 x 1.05 → 87.5: below the plan's 85 x 1.05.
    expect(weights(result, "a")).toEqual([87.5, 87.5, 87.5, 87.5]);
  });
});

describe("adaptPlan — custom lifts (D14)", () => {
  function customDay(): AdaptablePlanDay {
    return {
      id: "custom",
      date: "2026-10-16",
      weekNumber: 5,
      mainWorkout: "A) Atlas Stone Load 3x5 @ 42.5 kg (RPE 8)\nB) Husafell Carry 4x20 m @ 150 kg",
      accessory: null,
      notes: null,
      aiInputsUsed: null,
      sets: [
        ...[1, 2, 3].map((n) => ({
          id: `stone-${n}`,
          exerciseName: "custom",
          customLabel: "Atlas Stone Load",
          reps: 5,
          weight: 42.5,
          weightUnit: "kg",
        })),
        ...[1, 2, 3, 4].map((n) => ({
          id: `carry-${n}`,
          exerciseName: "custom",
          customLabel: "Husafell Carry",
          reps: 1,
          weight: 150,
          weightUnit: "kg",
        })),
      ],
    };
  }

  const stoneSets = (reps: number[], customLabel: string | null = "Atlas Stone Load") =>
    squatSets("l1", "2026-10-13", reps, 40, { reps: 5, weight: 40 }).map((set) => ({
      ...set,
      exerciseName: "custom",
      customLabel,
    }));

  it("holds the custom lift that was missed and leaves every other custom lift alone", () => {
    const result = adaptPlan(input({ upcoming: [customDay()], sets: stoneSets([5, 5, 4]) }));
    const day = result.days.find((entry) => entry.planDayId === "custom");
    if (!day) throw new Error("expected the custom day to be adapted");
    expect(day.setUpdates).toEqual(
      ["stone-1", "stone-2", "stone-3"].map((setId) => ({ setId, weight: 40, weightUnit: "kg" })),
    );
    expect(day.mainWorkout).toBe(
      "A) Atlas Stone Load 3x5 @ 40 kg (RPE 8)\nB) Husafell Carry 4x20 m @ 150 kg",
    );
    expect(day.changes).toEqual([
      { exercise: "Atlas Stone Load", kind: "hold", from: 42.5, to: 40, unit: "kg" },
    ]);
    expect(day.rationale).toContain("Atlas Stone Load repeats that load");
  });

  it("never adapts a custom set with no label to tell it apart", () => {
    expect(
      adaptPlan(input({ upcoming: [customDay()], sets: stoneSets([5, 5, 4], null) })).days,
    ).toEqual([]);
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
      const weight = first.days
        .find((entry) => entry.planDayId === day.id)
        ?.setUpdates.at(0)?.weight;
      if (weight == null) return day;
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
    expect(result.engineState.runVdot).toBeCloseTo(42.4, 5);
    expect(day.mainWorkout).toMatch(/3 x 8 min @ 4:5\d\/km/);
    expect(day.notes).toBe("Easy pace 5:49-6:24/km");
    expect(day.setUpdates.map((update) => update.setId)).toEqual(["run-1"]);
    expect(day.setUpdates.at(0)?.notes).toMatch(/^4:5\d\/km · 2 min jog$/);
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

describe("adaptPlan — sessions that never happened", () => {
  // Tuesday's squat was missed; the next three Tuesdays climb past it.
  const NEXT = [
    squatDay("n1", "2026-10-20", 6, 87.5),
    squatDay("n2", "2026-10-27", 7, 90),
    squatDay("n3", "2026-11-03", 8, 92.5),
  ];

  function missedDay(
    overrides: Partial<MissedPlanSession> & { weight?: number } = {},
  ): MissedPlanSession {
    const { weight = 85, ...rest } = overrides;
    const date = rest.date ?? "2026-10-13";
    return {
      planDayId: "m",
      date,
      weekNumber: 5,
      kind: "missed",
      sets: squatDay("m", date, 5, weight).sets,
      ...rest,
    };
  }

  /** A pass with no new logs: only the missed sessions speak. */
  function missInput(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
    return input({ logs: [], sets: [], upcoming: NEXT, missed: [missedDay()], ...overrides });
  }

  /** The upcoming days as a pass left them. */
  function after(result: ReturnType<typeof adaptPlan>, days = NEXT): AdaptablePlanDay[] {
    return days.map((day) => {
      const adapted = result.days.find((entry) => entry.planDayId === day.id);
      if (!adapted) return day;
      const byId = new Map(adapted.setUpdates.map((update) => [update.setId, update.weight]));
      return {
        ...day,
        mainWorkout: adapted.mainWorkout ?? day.mainWorkout,
        sets: day.sets.map((set) => ({ ...set, weight: byId.get(set.id) ?? set.weight })),
      };
    });
  }

  function withState(engineState: PlanEngineState): AdaptationInput["plan"] {
    return { startDate: "2026-09-14", totalWeeks: 12, engineState };
  }

  it("repeats the missed step instead of climbing past it, then builds from there", () => {
    const result = adaptPlan(missInput());

    // One step behind the plan as written (87.5, 90, 92.5), not further.
    expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
    expect(weights(result, "n2")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n3")).toEqual([90, 90, 90, 90]);
    const first = result.days.find((day) => day.planDayId === "n1");
    expect(first?.rationale).toBe(
      "Auto-progression: You missed Tuesday's Front Squat (4x6 @ 85 kg), so it picks up from that load rather than jumping ahead.",
    );
    expect(first?.mainWorkout).toContain("A) Front Squat 4x6 @ 85 kg");
    expect(first?.changes).toEqual([
      { exercise: "front_squat", kind: "hold", from: 87.5, to: 85, unit: "kg" },
    ]);
    expect(result.days.find((day) => day.planDayId === "n2")?.rationale).toBe(
      "Auto-progression: Front Squat keeps building from the repeated step.",
    );
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
    expect(result.engineState.missHolds).toEqual([
      {
        planDayId: "m",
        missedOn: "2026-10-13",
        exercise: "front_squat",
        unit: "kg",
        sets: [
          ...[1, 2, 3, 4].map((n) => ({ setId: `n1-${n}`, from: 87.5, to: 85 })),
          ...[1, 2, 3, 4].map((n) => ({ setId: `n2-${n}`, from: 90, to: 87.5 })),
          ...[1, 2, 3, 4].map((n) => ({ setId: `n3-${n}`, from: 92.5, to: 90 })),
        ],
      },
    ]);
  });

  it("counts each miss once, so a load the athlete puts back stays put", () => {
    const first = adaptPlan(missInput());

    // The next pass finds the plan as it left it...
    const settled = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first) }),
    );
    expect(settled.days).toEqual([]);
    expect(settled.engineState.missHolds).toEqual(first.engineState.missHolds);

    // ...and one where the athlete edited the loads back up leaves their edit alone.
    const edited = adaptPlan(missInput({ plan: withState(first.engineState) }));
    expect(edited.days).toEqual([]);
  });

  it("takes the hold back when the session returns to the plan", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDayIds: new Set(["m"]),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toEqual([90, 90, 90, 90]);
    expect(weights(result, "n3")).toEqual([92.5, 92.5, 92.5, 92.5]);
    const day = result.days.find((entry) => entry.planDayId === "n1");
    expect(day?.rationale).toBe(
      "Auto-progression: Tuesday's session is no longer missed, so Front Squat returns to its planned load.",
    );
    expect(day?.mainWorkout).toContain("A) Front Squat 4x6 @ 87.5 kg");
    expect(day?.changes).toEqual([
      { exercise: "front_squat", kind: "raise", from: 85, to: 87.5, unit: "kg" },
    ]);
    expect(result.engineState.missHolds).toEqual([]);
    // Missed again on the same day, it counts afresh.
    expect(result.engineState.adaptedMisses).toEqual([]);
  });

  it("gives back only the sets that still read what the hold wrote", () => {
    const first = adaptPlan(missInput());
    const held = after(first);
    const editedDay = held[1];
    if (!editedDay) throw new Error("expected three held days");
    const edited = [
      held[0],
      { ...editedDay, sets: editedDay.sets.map((set) => ({ ...set, weight: 80 })) },
      held[2],
    ].flatMap((day) => day ?? []);
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: edited,
        missed: [],
        returnedPlanDayIds: new Set(["m"]),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toBeUndefined();
    expect(weights(result, "n3")).toEqual([92.5, 92.5, 92.5, 92.5]);
  });

  it("builds a raise on the restored load when the session is logged late and beaten", () => {
    const first = adaptPlan(missInput());
    // Logged against the missed day after all: 4x8 where 4x6 @ 85 was planned.
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDayIds: new Set(["m"]),
        logs: [log("late", "2026-10-13")],
        sets: squatSets("late", "2026-10-13", [8, 8, 8, 8], 85, { reps: 6, weight: 85 }),
      }),
    );
    // 87.5 x 1.05 = 91.9 → 92.5, not a raise from the held 85.
    expect(weights(result, "n1")).toEqual([92.5, 92.5, 92.5, 92.5]);
  });

  it("drops a hold without restoring it when the missed day was deleted", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first), missed: [] }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("holds nothing for a lift the athlete trained anyway", () => {
    // An unplanned squat session on the day of the miss.
    const result = adaptPlan(
      missInput({
        logs: [log("adhoc", "2026-10-13")],
        sets: squatSets("adhoc", "2026-10-13", [6, 6, 6, 6], 85, null),
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("lets a hold stand, for good, once the lift has been trained since", () => {
    const first = adaptPlan(missInput());
    const state: PlanEngineState = { ...first.engineState, adaptedLogIds: ["done"] };
    const result = adaptPlan(
      missInput({
        plan: withState(state),
        upcoming: after(first).slice(1),
        logs: [log("done", "2026-10-20")],
        sets: squatSets("done", "2026-10-20", [6, 6, 6, 6], 85, { reps: 6, weight: 85 }),
        today: "2026-10-21",
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);

    // The missed session coming back now changes nothing: the plan moved on.
    const back = adaptPlan(
      missInput({
        plan: withState(result.engineState),
        upcoming: after(first).slice(1),
        missed: [],
        returnedPlanDayIds: new Set(["m"]),
        today: "2026-10-21",
      }),
    );
    expect(back.days).toEqual([]);
  });

  it("gives the load back when the lift is trained anyway before the held session comes up", () => {
    // The session done after all, but logged as a workout of its own rather
    // than against the missed day: that day stays missed, the step was made up.
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({
        plan: withState({ ...first.engineState, adaptedLogIds: ["adhoc"] }),
        upcoming: after(first),
        logs: [log("adhoc", "2026-10-13")],
        sets: squatSets("adhoc", "2026-10-13", [6, 6, 6, 6], 85, null),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toEqual([90, 90, 90, 90]);
    expect(result.days.find((day) => day.planDayId === "n1")?.rationale).toBe(
      "Auto-progression: You have trained Front Squat since Tuesday's session, so it returns to its planned load.",
    );
    expect(result.engineState.missHolds).toEqual([]);
    // It stays counted: the same miss never holds the plan again.
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("holds nothing when the plan repeats the step itself", () => {
    // The lift's second day that week runs the same load.
    const result = adaptPlan(
      missInput({ upcoming: [squatDay("thu", "2026-10-15", 5, 85), ...NEXT] }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("passes over the week's lighter exposure and holds the next heavy one", () => {
    const result = adaptPlan(
      missInput({ upcoming: [squatDay("light", "2026-10-16", 5, 77.5), ...NEXT] }),
    );
    expect(weights(result, "light")).toBeUndefined();
    expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
  });

  it("does not pull the heavy day down for a missed lighter exposure", () => {
    // Friday's lighter squat (77.5) was missed: Tuesday's 87.5 is another tier.
    const result = adaptPlan(
      missInput({
        missed: [missedDay({ date: "2026-10-09", weight: 77.5 })],
        upcoming: [
          squatDay("heavy", "2026-10-20", 6, 87.5),
          squatDay("light", "2026-10-23", 6, 80),
        ],
      }),
    );
    expect(weights(result, "heavy")).toBeUndefined();
    expect(weights(result, "light")).toEqual([77.5, 77.5, 77.5, 77.5]);
  });

  it("holds nothing for a session missed in a deload week", () => {
    // Week 4 of 12 is a deload: no step of the progression was lost.
    const result = adaptPlan(missInput({ missed: [missedDay({ weekNumber: 4 })] }));
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("leaves misses from more than two weeks ago to the return-from-break rule", () => {
    const result = adaptPlan(missInput({ missed: [missedDay({ date: "2026-09-29" })] }));
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual([]);
  });

  it("repeats the earliest step when the same lift was missed twice", () => {
    const result = adaptPlan(
      missInput({
        missed: [
          missedDay({ planDayId: "m1", date: "2026-10-06", weight: 82.5 }),
          missedDay({ planDayId: "m2", date: "2026-10-13", weight: 85 }),
        ],
      }),
    );
    expect(weights(result, "n1")).toEqual([82.5, 82.5, 82.5, 82.5]);
    expect(result.engineState.adaptedMisses).toEqual(["m1|2026-10-06", "m2|2026-10-13"]);
  });

  it("says skipped for a skip, and never calls a declared absence a miss", () => {
    const skipped = adaptPlan(missInput({ missed: [missedDay({ kind: "skipped" })] }));
    expect(skipped.days[0]?.rationale).toContain("You skipped Tuesday's Front Squat (4x6 @ 85 kg)");

    const excused = adaptPlan(missInput({ missed: [missedDay({ kind: "excused" })] }));
    expect(excused.days[0]?.rationale).toContain(
      "Tuesday's Front Squat (4x6 @ 85 kg) didn't happen, so it picks up from that load",
    );
    expect(excused.days[0]?.rationale).not.toMatch(/missed/i);
  });

  it("holds the sessions after one skipped in advance, not the ones before it", () => {
    const result = adaptPlan(
      missInput({
        missed: [missedDay({ date: "2026-10-20", kind: "skipped", weight: 87.5 })],
        upcoming: [squatDay("before", "2026-10-16", 5, 85), ...NEXT.slice(1)],
      }),
    );
    expect(weights(result, "before")).toBeUndefined();
    expect(weights(result, "n2")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(result.days[0]?.rationale).toContain("You're skipping Tuesday's Front Squat");
  });

  it("still holds while fatigued, in a taper, and leaves excluded days alone", () => {
    const tired = adaptPlan(missInput({ fatigued: true }));
    expect(weights(tired, "n1")).toEqual([85, 85, 85, 85]);

    const taper = adaptPlan(
      missInput({ plan: { startDate: "2026-09-14", totalWeeks: 7, engineState: null } }),
    );
    expect(weights(taper, "n1")).toEqual([85, 85, 85, 85]);

    const excluded = adaptPlan(missInput({ excludedDayIds: new Set(["n1"]) }));
    expect(weights(excluded, "n1")).toBeUndefined();
  });

  it("ignores bodyweight, unweighted and unlabelled custom sets of the missed session", () => {
    const sets = [
      { id: "m-1", exerciseName: "pull_up", reps: 8, weight: 10, weightUnit: "kg" },
      { id: "m-2", exerciseName: "front_squat", reps: 6, weight: null, weightUnit: "kg" },
      { id: "m-3", exerciseName: "custom", reps: 6, weight: 85, weightUnit: "kg" },
      { id: "m-4", exerciseName: "front_squat", reps: 20, weight: 85, weightUnit: "kg" },
    ];
    const result = adaptPlan(missInput({ missed: [missedDay({ sets })] }));
    expect(result.days).toEqual([]);
  });

  it("leaves the record of misses alone on a pass that was not given any", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first), missed: undefined }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual(first.engineState.missHolds);
    expect(result.engineState.adaptedMisses).toEqual(first.engineState.adaptedMisses);
  });
});
