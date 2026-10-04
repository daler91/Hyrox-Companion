/**
 * Every custom lift is named "custom"; the overload clamp tells them apart by
 * their label. D14 (CODEBASE_ANALYSIS_2026-10-03).
 */
import { describe, expect, it, vi } from "vitest";

import {
  clampProgressiveOverload,
  findProgressiveOverloadViolations,
  overloadViolationLogEntries,
} from "./planGenerationService";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../ai/providers", () => ({ generateJsonText: vi.fn() }));

function customDay(weekNumber: number, customLabel: string | null, weight: number) {
  return {
    weekNumber,
    dayName: "Monday" as const,
    focus: "Strongman",
    mainWorkout: `A) ${customLabel ?? "Custom"} 3x5 @ ${String(weight)} kg`,
    exercises: [
      {
        exerciseName: "custom",
        category: "strength",
        customLabel,
        sets: [1, 2, 3].map((setNumber) => ({ setNumber, reps: 5, weight })),
      },
    ],
  };
}

describe("the overload clamp and custom lifts (D14)", () => {
  it("does not read a different custom lift the next week as a jump", () => {
    const days = [customDay(1, "Sandbag Clean", 40), customDay(2, "Yoke Carry", 150)];

    expect(findProgressiveOverloadViolations(days)).toEqual([]);
    expect(clampProgressiveOverload(days)).toEqual([]);
    expect(days[1].exercises[0].sets.map((set) => set.weight)).toEqual([150, 150, 150]);
  });

  it("still clamps the same custom lift jumping past the ceiling", () => {
    const days = [customDay(1, "Yoke Carry", 100), customDay(2, "Yoke Carry", 150)];

    const clamps = clampProgressiveOverload(days);

    expect(clamps).toEqual([
      expect.objectContaining({ exerciseName: "custom:Yoke Carry", weekNumber: 2, toWeight: 108 }),
    ]);
    expect(days[1].exercises[0].sets.map((set) => set.weight)).toEqual([108, 108, 108]);
  });

  it("clamps only the lift that jumped when two custom lifts share a week", () => {
    const week1 = customDay(1, "Yoke Carry", 100);
    week1.exercises.push(customDay(1, "Sandbag Clean", 40).exercises[0]);
    const week2 = customDay(2, "Yoke Carry", 105);
    week2.exercises.push(customDay(2, "Sandbag Clean", 60).exercises[0]);

    clampProgressiveOverload([week1, week2]);

    expect(week2.exercises.map((exercise) => exercise.sets[0].weight)).toEqual([105, 43.2]);
  });
});

describe("the overload warning and custom lifts (D14)", () => {
  // The label is model-written free text that can echo the athlete's injuries,
  // so the warning keeps only that the lift was custom.
  it("logs a custom lift as the bare 'custom', never its label", () => {
    const days = [customDay(1, "Knee-friendly Yoke Carry", 100), customDay(2, "Knee-friendly Yoke Carry", 150)];
    const violations = findProgressiveOverloadViolations(days);
    expect(violations[0]?.exerciseName).toBe("custom:Knee-friendly Yoke Carry");

    const logged = overloadViolationLogEntries([
      ...violations,
      { exerciseName: "back_squat", fromWeek: 1, toWeek: 2, fromWeight: 100, toWeight: 140, increasePct: 40 },
    ]);

    expect(logged).toEqual([
      { exerciseName: "custom", fromWeek: 1, toWeek: 2, increasePct: 50 },
      { exerciseName: "back_squat", fromWeek: 1, toWeek: 2, increasePct: 40 },
    ]);
    expect(JSON.stringify(logged)).not.toContain("Knee");
  });
});
