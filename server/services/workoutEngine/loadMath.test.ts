import { describe, expect, it } from "vitest";

import {
  type EngineSet,
  estimateStrength,
  impliedRpe,
  loadForReps,
  loadIncrement,
  roundLoad,
} from "./loadMath";

function set(overrides: Partial<EngineSet> & Pick<EngineSet, "date">): EngineSet {
  return {
    exerciseName: "back_squat",
    workoutLogId: `log-${overrides.date}`,
    reps: 5,
    weight: 100,
    weightUnit: "kg",
    ...overrides,
  };
}

describe("loadForReps / impliedRpe", () => {
  it("reads 5 reps at RPE 8 as a 7-rep max — ~81% of 1RM, as the RPE charts do", () => {
    expect(loadForReps(100, 5, 8) / 100).toBeCloseTo(0.811, 3);
  });

  it("are inverses of each other", () => {
    const load = loadForReps(140, 6, 7.5);
    expect(impliedRpe(140, 6, load)).toBeCloseTo(7.5, 9);
  });
});

describe("implements and rounding", () => {
  // implementFor's own resolution rules (override table, equipment lookup,
  // barbell default) are covered directly in shared/exerciseEquipment.test.ts;
  // this file only needs enough of it to show roundLoad picking the right step.
  it("rounds to the implement's real step, in the athlete's unit", () => {
    expect(loadIncrement("back_squat", "kg")).toBe(2.5);
    expect(loadIncrement("back_squat", "lbs")).toBe(5);
    expect(loadIncrement("goblet_squat", "kg")).toBe(2);
    expect(roundLoad(81.2, "back_squat", "kg")).toBe(80);
    expect(roundLoad(81.3, "back_squat", "kg")).toBe(82.5);
    expect(roundLoad(81.3, "back_squat", "kg", "down")).toBe(80);
    expect(roundLoad(23.1, "goblet_squat", "kg")).toBe(24);
    expect(roundLoad(187, "back_squat", "lbs")).toBe(185);
  });

  it("does not let float noise floor an exact step down", () => {
    expect(roundLoad(82.49999999999999, "back_squat", "kg", "down")).toBe(82.5);
  });
});

describe("estimateStrength", () => {
  it("reads the best recent session, counting ~2 reps left in the tank", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01", weight: 80 }),
        set({ date: "2026-09-08", weight: 82.5 }),
        set({ date: "2026-09-15", weight: 85 }),
      ],
      "kg",
    );
    // 85 x (5 + 2) → 85 * (1 + 7/30)
    expect(estimates.get("back_squat")).toEqual({
      exercise: "back_squat",
      e1rm: 104.8,
      basis: { date: "2026-09-15", weight: 85, reps: 5 },
      sessions: 3,
    });
  });

  it("uses each session's best set, not its warm-ups", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01", weight: 60 }),
        set({ date: "2026-09-01", weight: 100 }),
        set({ date: "2026-09-08", weight: 60 }),
        set({ date: "2026-09-08", weight: 100 }),
      ],
      "kg",
    );
    expect(estimates.get("back_squat")?.basis.weight).toBe(100);
  });

  it("falls back to the second-best when the best is an outlier", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01", weight: 100 }),
        set({ date: "2026-09-08", weight: 102.5 }),
        // A typo: 1025 kg.
        set({ date: "2026-09-15", weight: 1025 }),
      ],
      "kg",
    );
    expect(estimates.get("back_squat")?.basis.weight).toBe(102.5);
  });

  it("reads only the four most recent sessions", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-07-01", weight: 140 }),
        set({ date: "2026-08-01", weight: 100 }),
        set({ date: "2026-08-08", weight: 100 }),
        set({ date: "2026-08-15", weight: 100 }),
        set({ date: "2026-08-22", weight: 100 }),
      ],
      "kg",
    );
    expect(estimates.get("back_squat")?.basis.weight).toBe(100);
  });

  it("reads a set that fell short of its prescription as a true max", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01", reps: 3, plannedReps: 5 }),
        set({ date: "2026-09-08", reps: 3, plannedReps: 5 }),
      ],
      "kg",
    );
    // 100 x 3 with nothing left: 100 * (1 + 3/30)
    expect(estimates.get("back_squat")?.e1rm).toBe(110);
  });

  it("needs two sessions, and skips bodyweight lifts and out-of-range sets", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01" }),
        set({ date: "2026-09-01", exerciseName: "pull_up", weight: 10 }),
        set({ date: "2026-09-08", exerciseName: "pull_up", weight: 10 }),
        set({ date: "2026-09-01", exerciseName: "deadlift", reps: 15 }),
        set({ date: "2026-09-08", exerciseName: "deadlift", reps: 15 }),
      ],
      "kg",
    );
    expect([...estimates.keys()]).toEqual([]);
  });

  it("reads each row through its own unit stamp", () => {
    const estimates = estimateStrength(
      [
        set({ date: "2026-09-01", weight: 225, weightUnit: "lbs" }),
        set({ date: "2026-09-08", weight: 225, weightUnit: "lbs" }),
      ],
      "kg",
    );
    expect(estimates.get("back_squat")?.basis.weight).toBe(102);
  });
});
