import { describe, expect, it } from "vitest";

import { buildWorkoutEnginePlan, type WorkoutEnginePlan } from "./enginePlan";
import type { EngineSet } from "./loadMath";
import {
  namesExercise,
  type RepairableDay,
  type RepairableSet,
  repairPrimaryLifts,
  rewriteLiftLine,
  rewriteLiftLoad,
} from "./planRepair";
import type { LiftWeekTarget } from "./strength";

function squatHistory(): EngineSet[] {
  return ["2026-09-01", "2026-09-08", "2026-09-15"].map((date, index) => ({
    exerciseName: "front_squat",
    workoutLogId: `log-${index}`,
    date,
    reps: 5,
    weight: 80 + 2.5 * index,
    weightUnit: "kg",
  }));
}

function engine(overrides: { hasRace?: boolean } = {}): WorkoutEnginePlan {
  return buildWorkoutEnginePlan({
    lens: "hyrox",
    experience: "intermediate",
    primaryLifts: [
      { slot: "squat", exercise: "front_squat", sessions: 3 },
      { slot: "pull", exercise: "bent_over_row", sessions: 0 },
    ],
    totalWeeks: 12,
    daysPerWeek: 4,
    hasRace: overrides.hasRace ?? true,
    today: "2026-09-20",
    weightUnit: "kg",
    distanceUnit: "km",
    sets: squatHistory(),
    logs: [],
  });
}

function strengthDay(
  weekNumber: number,
  dayName: string,
  exercises: RepairableDay["exercises"],
  mainWorkout = "A) Front Squat 3x10 @ 70 kg (RPE 7-8, rest 2 min)\nB) Bent Over Row 4x8 @ 50 kg (RPE 7)",
): RepairableDay {
  return { weekNumber, dayName, mainWorkout, accessory: null, exercises };
}

function squatSets(weights: number[], reps = 10) {
  return weights.map((weight, index) => ({ setNumber: index + 1, reps, weight, weightUnit: "kg" }));
}

/** The sets of the day's first exercise; a day without a table fails the test. */
function firstSets(day: RepairableDay): RepairableSet[] {
  const sets = day.exercises?.at(0)?.sets;
  if (!sets) throw new Error(`expected an exercise table on ${day.dayName}`);
  return sets;
}

function loadOf(target: LiftWeekTarget | undefined): number {
  if (target?.load == null) throw new Error("expected the engine to compute a load");
  return target.load;
}

describe("repairPrimaryLifts", () => {
  it("snaps a drifted primary lift to the week's target, sets and text alike", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[0];
    const day = strengthDay(1, "Monday", [
      { exerciseName: "front_squat", sets: squatSets([60, 70, 70]) },
    ]);

    const repairs = repairPrimaryLifts([day], plan);

    expect(repairs).toEqual([{ exercise: "front_squat", weekNumber: 1, dayName: "Monday" }]);
    const sets = firstSets(day);
    expect(sets).toHaveLength(target.sets);
    expect(sets.every((set) => set.reps === target.reps && set.weight === target.load)).toBe(true);
    expect(sets[0].notes).toBe(`RPE ${target.rpe} · rest 90-120 s`);
    expect(day.mainWorkout.split("\n")[0]).toBe(
      `A) Front Squat ${target.sets}x${target.reps} @ ${target.load} kg (RPE ${target.rpe}, rest 2 min)`,
    );
  });

  it("gives a second appearance in the same week the lighter exposure", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[1];
    const monday = strengthDay(2, "Monday", [
      { exerciseName: "front_squat", sets: squatSets([70]) },
    ]);
    const thursday = strengthDay(2, "Thursday", [
      { exerciseName: "front_squat", sets: squatSets([70]) },
    ]);

    // Handed over out of order: exposures follow the week, not the array.
    repairPrimaryLifts([thursday, monday], plan);

    const load = loadOf(target);
    expect(firstSets(monday).at(0)?.weight).toBe(load);
    expect(firstSets(thursday).at(0)?.weight).toBeLessThan(load);
    expect(firstSets(thursday).at(0)?.weight).toBeGreaterThanOrEqual(load * 0.85);
  });

  it("enforces sets and reps but keeps the model's weight for a lift with no logged load", () => {
    const plan = engine();
    const target = plan.lifts[1].weeks[0];
    const day = strengthDay(1, "Thursday", [
      { exerciseName: "bent_over_row", sets: squatSets([40, 45], 12) },
    ]);

    repairPrimaryLifts([day], plan);

    const sets = firstSets(day);
    expect(sets.map((set) => set.reps)).toEqual(
      Array.from({ length: target.sets }, () => target.reps),
    );
    expect(sets.map((set) => set.weight)).toEqual([40, 45, 45, 45].slice(0, target.sets));
  });

  it("leaves a lift that already matches alone", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[0];
    const day = strengthDay(1, "Monday", [
      {
        exerciseName: "front_squat",
        sets: squatSets(
          Array.from({ length: target.sets }, () => loadOf(target)),
          target.reps,
        ),
      },
    ]);
    const before = day.mainWorkout;

    expect(repairPrimaryLifts([day], plan)).toEqual([]);
    expect(day.mainWorkout).toBe(before);
  });

  it("leaves race week and everything that isn't a primary lift as written", () => {
    const plan = engine();
    const raceWeek = strengthDay(12, "Monday", [
      { exerciseName: "front_squat", sets: squatSets([50]) },
    ]);
    const accessory = strengthDay(1, "Monday", [
      { exerciseName: "walking_lunges", sets: squatSets([20]) },
    ]);

    expect(repairPrimaryLifts([raceWeek, accessory], plan)).toEqual([]);
    expect(firstSets(raceWeek).at(0)?.weight).toBe(50);
  });

  it("leaves a variant of the lift in the accessory text alone (C15)", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[0];
    const day = strengthDay(1, "Monday", [
      { exerciseName: "front_squat", sets: squatSets([60, 70, 70]) },
    ]);
    day.accessory = "C) Paused Front Squat 2x3 @ 50 kg (RPE 6)";

    repairPrimaryLifts([day], plan);

    expect(day.accessory).toBe("C) Paused Front Squat 2x3 @ 50 kg (RPE 6)");
    expect(day.mainWorkout.split("\n")[0]).toContain(`@ ${target.load} kg`);
  });

  it("does nothing without an engine plan", () => {
    const day = strengthDay(1, "Monday", [{ exerciseName: "front_squat", sets: squatSets([60]) }]);
    expect(repairPrimaryLifts([day], null)).toEqual([]);
  });
});

describe("rewriteLiftLine", () => {
  const want = { sets: 4, reps: 6, load: 85, effort: "RPE 8", rest: "2-3 min" };

  it("rewrites ranges and units on the first line naming the lift", () => {
    const text =
      "Warm-up: 8 min bike\nA) Front squat 3 x 8-10 @ 80-82.5 lbs, RPE 7-8\nB) Front squat 2x5";
    expect(rewriteLiftLine(text, "front_squat", want, "kg").split("\n")).toEqual([
      "Warm-up: 8 min bike",
      "A) Front squat 4x6 @ 85 kg, RPE 8",
      "B) Front squat 2x5",
    ]);
  });

  it("keeps the punctuation around the numbers it rewrites", () => {
    expect(
      rewriteLiftLine("A) Front squat 3x5 @ 80kg (RPE ~7.5).", "front_squat", want, "kg"),
    ).toBe("A) Front squat 4x6 @ 85 kg (RPE 8).");
  });

  it("leaves text that never names the lift untouched", () => {
    expect(rewriteLiftLine("Easy run 30 min", "front_squat", want, "kg")).toBe("Easy run 30 min");
  });
});

describe("rewriteLiftLoad — the lift's own line, never a variant's (C15)", () => {
  it("skips a variant whose name contains the lift's and rewrites the lift's line", () => {
    const text = "A) Romanian Deadlift 3x10 @ 70 kg (RPE 7)\nB) Deadlift 4x5 @ 140 kg (RPE 8)";
    expect(rewriteLiftLoad(text, "deadlift", 147.5, "kg").split("\n")).toEqual([
      "A) Romanian Deadlift 3x10 @ 70 kg (RPE 7)",
      "B) Deadlift 4x5 @ 147.5 kg (RPE 8)",
    ]);
  });

  it("leaves text that names only variants untouched", () => {
    const accessory =
      "B1) Romanian Deadlift 3x10 @ 70 kg\nB2) Trap-bar deadlift 3x5 @ 120 kg\nB3) Incline Bench Press 3x8 @ 50 kg";
    expect(rewriteLiftLoad(accessory, "deadlift", 147.5, "kg")).toBe(accessory);
    expect(rewriteLiftLoad(accessory, "bench_press", 82.5, "kg")).toBe(accessory);
    expect(rewriteLiftLoad("Bulgarian Split Squat 3x8 @ 20 kg", "split_squat", 40, "kg")).toBe(
      "Bulgarian Split Squat 3x8 @ 20 kg",
    );
    expect(rewriteLiftLoad("Sandbag Lunges 4x25 m @ 20 kg", "lunges", 40, "kg")).toBe(
      "Sandbag Lunges 4x25 m @ 20 kg",
    );
  });

  it("never reads a line as naming an empty name (C15)", () => {
    expect(namesExercise("A) Deadlift 4x5 @ 140 kg", "")).toBe(false);
    expect(namesExercise("", "")).toBe(false);
    expect(namesExercise("a) deadlift 4x5 @ 140 kg", "deadlift")).toBe(true);
    expect(namesExercise("a) romanian deadlift 3x10", "deadlift")).toBe(false);
  });

  it("finds the lift after a block label, a list mark, a set scheme or at the line start", () => {
    for (const line of [
      "Deadlift 4x5 @ 140 kg",
      "- Deadlift 4x5 @ 140 kg",
      "Main: Deadlift 4x5 @ 140 kg",
      "4x5 deadlift @ 140 kg",
    ]) {
      expect(rewriteLiftLoad(line, "deadlift", 147.5, "kg")).toBe(
        line.replace("@ 140 kg", "@ 147.5 kg"),
      );
    }
  });
});
