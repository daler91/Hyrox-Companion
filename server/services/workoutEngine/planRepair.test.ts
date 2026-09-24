import { describe, expect, it } from "vitest";

import { buildWorkoutEnginePlan, type WorkoutEnginePlan } from "./enginePlan";
import type { EngineSet } from "./loadMath";
import { type RepairableDay, repairPrimaryLifts, rewriteLiftLine } from "./planRepair";

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

describe("repairPrimaryLifts", () => {
  it("snaps a drifted primary lift to the week's target, sets and text alike", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[0];
    const day = strengthDay(1, "Monday", [
      { exerciseName: "front_squat", sets: squatSets([60, 70, 70]) },
    ]);

    const repairs = repairPrimaryLifts([day], plan);

    expect(repairs).toEqual([{ exercise: "front_squat", weekNumber: 1, dayName: "Monday" }]);
    const sets = day.exercises![0].sets;
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

    expect(monday.exercises![0].sets[0].weight).toBe(target.load);
    expect(thursday.exercises![0].sets[0].weight).toBeLessThan(target.load!);
    expect(thursday.exercises![0].sets[0].weight).toBeGreaterThanOrEqual(target.load! * 0.85);
  });

  it("enforces sets and reps but keeps the model's weight for a lift with no logged load", () => {
    const plan = engine();
    const target = plan.lifts[1].weeks[0];
    const day = strengthDay(1, "Thursday", [
      { exerciseName: "bent_over_row", sets: squatSets([40, 45], 12) },
    ]);

    repairPrimaryLifts([day], plan);

    const sets = day.exercises![0].sets;
    expect(sets.map((set) => set.reps)).toEqual(Array(target.sets).fill(target.reps));
    expect(sets.map((set) => set.weight)).toEqual([40, 45, 45, 45].slice(0, target.sets));
  });

  it("leaves a lift that already matches alone", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[0];
    const day = strengthDay(1, "Monday", [
      {
        exerciseName: "front_squat",
        sets: squatSets(Array(target.sets).fill(target.load), target.reps),
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
    expect(raceWeek.exercises![0].sets[0].weight).toBe(50);
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

  it("leaves text that never names the lift untouched", () => {
    expect(rewriteLiftLine("Easy run 30 min", "front_squat", want, "kg")).toBe("Easy run 30 min");
  });
});
