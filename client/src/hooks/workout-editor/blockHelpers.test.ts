import { describe, expect, it } from "vitest";
import { getBlockExerciseName, makeBlockId } from "./blockHelpers";

describe("makeBlockId", () => {
  it("should increment the counter and format the ID correctly", () => {
    const counterRef = { current: 0 };

    const id1 = makeBlockId("exercise", counterRef);
    expect(id1).toBe("exercise__1");
    expect(counterRef.current).toBe(1);

    const id2 = makeBlockId("exercise", counterRef);
    expect(id2).toBe("exercise__2");
    expect(counterRef.current).toBe(2);
  });

  it("should handle names with underscores and special characters", () => {
    const counterRef = { current: 5 };
    const id = makeBlockId("my_custom_exercise-name!", counterRef);
    expect(id).toBe("my_custom_exercise-name!__6");
  });
});

describe("getBlockExerciseName", () => {
  it("should extract the name from a standard block ID", () => {
    expect(getBlockExerciseName("squat__1")).toBe("squat");
    expect(getBlockExerciseName("bench_press__2")).toBe("bench_press");
  });

  it("should return the full input if there is no separator", () => {
    expect(getBlockExerciseName("deadlift")).toBe("deadlift");
  });

  it("should handle multiple separators by using all but the last part", () => {
    // Though unusual, if an exercise name contains __, the function currently splits and joins
    expect(getBlockExerciseName("incline__bench__press__1")).toBe("incline__bench__press");
  });

  it('should return "custom" if the name starts with "custom:"', () => {
    expect(getBlockExerciseName("custom:my_weird_exercise__3")).toBe("custom");
    expect(getBlockExerciseName("custom:__4")).toBe("custom");
  });

  it("should handle edge cases with empty strings or missing parts", () => {
    expect(getBlockExerciseName("__1")).toBe("");
    expect(getBlockExerciseName("")).toBe("");
  });
});
