import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBlockCounts } from "../useBlockCounts";
import type { StructuredExercise } from "@/components/ExerciseInput";

describe("useBlockCounts", () => {
  it("should return empty counts and indices for empty inputs", () => {
    const { result } = renderHook(() => useBlockCounts([], {}));
    expect(result.current.blockCounts).toEqual({});
    expect(result.current.blockIndices).toEqual({});
  });

  it("should handle blockIds not present in editExerciseData", () => {
    const { result } = renderHook(() => useBlockCounts(["block1", "block2"], {}));
    expect(result.current.blockCounts).toEqual({});
    expect(result.current.blockIndices).toEqual({});
  });

  it("should handle blockIds with missing exerciseName", () => {
    const mockData: Record<string, StructuredExercise> = {
      block1: { exerciseName: "" } as StructuredExercise, // empty string is falsy, or it might just be missing
      block2: {} as StructuredExercise,
    };
    const { result } = renderHook(() => useBlockCounts(["block1", "block2"], mockData));
    expect(result.current.blockCounts).toEqual({});
    expect(result.current.blockIndices).toEqual({});
  });

  it("should correctly count and index blocks with valid exercise names", () => {
    const mockData: Record<string, StructuredExercise> = {
      b1: { exerciseName: "Pushup" } as StructuredExercise,
      b2: { exerciseName: "Pullup" } as StructuredExercise,
      b3: { exerciseName: "Pushup" } as StructuredExercise,
    };
    const { result } = renderHook(() => useBlockCounts(["b1", "b2", "b3"], mockData));

    expect(result.current.blockCounts).toEqual({
      Pushup: 2,
      Pullup: 1,
    });

    expect(result.current.blockIndices).toEqual({
      b1: 1,
      b2: 1,
      b3: 2,
    });
  });

  it("should ignore blockIds that do not have exerciseName and still count others correctly", () => {
    const mockData: Record<string, StructuredExercise> = {
      b1: { exerciseName: "Squat" } as StructuredExercise,
      b2: {} as StructuredExercise, // missing name
      b3: { exerciseName: "Squat" } as StructuredExercise,
    };
    const { result } = renderHook(() => useBlockCounts(["b1", "b2", "b3"], mockData));

    expect(result.current.blockCounts).toEqual({
      Squat: 2,
    });

    expect(result.current.blockIndices).toEqual({
      b1: 1,
      b3: 2,
    });
  });
});
