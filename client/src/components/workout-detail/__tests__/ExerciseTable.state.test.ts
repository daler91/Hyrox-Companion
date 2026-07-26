import { describe, expect, it, vi } from "vitest";

import { makeExerciseSet as makeSet } from "@/test/factories/exerciseSetFactory";

import { dispatchSortOrderMutations, toggleExerciseRow } from "../ExerciseTable";

describe("ExerciseTable state units", () => {
  it("toggles row expansion without mutating input set", () => {
    const initial = new Set(["a"]);
    const next = toggleExerciseRow(initial, "b");
    expect([...initial]).toEqual(["a"]);
    expect([...next].sort((a, b) => a.localeCompare(b))).toEqual(["a", "b"]);
    expect(toggleExerciseRow(next, "a").has("a")).toBe(false);
  });

  it("dispatches sortOrder mutations only when positions changed", () => {
    const onUpdateSet = vi.fn();
    dispatchSortOrderMutations([
      { exerciseName: "custom", customLabel: null, category: "conditioning", confidence: 80, sets: [makeSet({ id: "c", sortOrder: 3 })] },
      { exerciseName: "back_squat", customLabel: null, category: "strength", confidence: 80, sets: [makeSet({ id: "a", sortOrder: 0 })] },
    ], onUpdateSet);
    expect(onUpdateSet).toHaveBeenCalledWith("c", { sortOrder: 0 });
    expect(onUpdateSet).toHaveBeenCalledWith("a", { sortOrder: 1 });
  });
});
