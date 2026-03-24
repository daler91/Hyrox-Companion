import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBlockCounts } from "../useBlockCounts";
import type { StructuredExercise } from "@/components/ExerciseInput";

describe("useBlockCounts", () => {
  describe("basic functionality via it.each", () => {
    it.each([
      {
        description: "empty inputs",
        editExercises: [],
        editExerciseData: {},
        expectedCounts: {},
        expectedIndices: {},
      },
      {
        description: "blockIds not present in editExerciseData",
        editExercises: ["block1", "block2"],
        editExerciseData: {},
        expectedCounts: {},
        expectedIndices: {},
      },
      {
        description: "blockIds with missing exerciseName",
        editExercises: ["block1", "block2"],
        editExerciseData: {
          block1: { exerciseName: "" } as StructuredExercise,
          block2: {} as StructuredExercise,
        },
        expectedCounts: {},
        expectedIndices: {},
      },
      {
        description: "valid exercise names counting and indexing",
        editExercises: ["b1", "b2", "b3"],
        editExerciseData: {
          b1: { exerciseName: "Pushup" } as StructuredExercise,
          b2: { exerciseName: "Pullup" } as StructuredExercise,
          b3: { exerciseName: "Pushup" } as StructuredExercise,
        },
        expectedCounts: { Pushup: 2, Pullup: 1 },
        expectedIndices: { b1: 1, b2: 1, b3: 2 },
      },
      {
        description: "ignoring blockIds missing exerciseName and counting others correctly",
        editExercises: ["b1", "b2", "b3"],
        editExerciseData: {
          b1: { exerciseName: "Squat" } as StructuredExercise,
          b2: {} as StructuredExercise,
          b3: { exerciseName: "Squat" } as StructuredExercise,
        },
        expectedCounts: { Squat: 2 },
        expectedIndices: { b1: 1, b3: 2 },
      },
    ])(
      "should handle $description",
      ({ editExercises, editExerciseData, expectedCounts, expectedIndices }) => {
        const { result } = renderHook(() => useBlockCounts(editExercises, editExerciseData));
        expect(result.current.blockCounts).toEqual(expectedCounts);
        expect(result.current.blockIndices).toEqual(expectedIndices);
      },
    );
  });

  describe("memoization behavior", () => {
    it("should return the exact same object references if inputs are referentially equal", () => {
      const editExercises = ["b1", "b2"];
      const editExerciseData: Record<string, StructuredExercise> = {
        b1: { exerciseName: "Squat" } as StructuredExercise,
        b2: { exerciseName: "Squat" } as StructuredExercise,
      };

      const { result, rerender } = renderHook(({ ex, data }) => useBlockCounts(ex, data), {
        initialProps: { ex: editExercises, data: editExerciseData },
      });

      const firstRenderCounts = result.current.blockCounts;
      const firstRenderIndices = result.current.blockIndices;

      rerender({ ex: editExercises, data: editExerciseData });

      expect(result.current.blockCounts).toBe(firstRenderCounts);
      expect(result.current.blockIndices).toBe(firstRenderIndices);
    });

    it("should recompute if editExercises changes", () => {
      const initialExercises = ["b1"];
      const editExerciseData: Record<string, StructuredExercise> = {
        b1: { exerciseName: "Squat" } as StructuredExercise,
        b2: { exerciseName: "Squat" } as StructuredExercise,
      };

      const { result, rerender } = renderHook(({ ex, data }) => useBlockCounts(ex, data), {
        initialProps: { ex: initialExercises, data: editExerciseData },
      });

      const firstRenderCounts = result.current.blockCounts;

      rerender({ ex: ["b1", "b2"], data: editExerciseData });

      expect(result.current.blockCounts).not.toBe(firstRenderCounts);
      expect(result.current.blockCounts).toEqual({ Squat: 2 });
    });

    it("should recompute if editExerciseData changes", () => {
      const editExercises = ["b1"];
      const initialData: Record<string, StructuredExercise> = {
        b1: { exerciseName: "Squat" } as StructuredExercise,
      };

      const { result, rerender } = renderHook(({ ex, data }) => useBlockCounts(ex, data), {
        initialProps: { ex: editExercises, data: initialData },
      });

      const firstRenderCounts = result.current.blockCounts;

      rerender({
        ex: editExercises,
        data: { b1: { exerciseName: "Lunge" } as StructuredExercise },
      });

      expect(result.current.blockCounts).not.toBe(firstRenderCounts);
      expect(result.current.blockCounts).toEqual({ Lunge: 1 });
    });
  });
});
