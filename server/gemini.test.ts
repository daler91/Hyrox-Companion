import { describe, it, expect } from "vitest";
import { exerciseSetSchema } from "@shared/schema";
import {
  workoutSuggestionSchema,
  parsedExerciseSchema,
} from "./gemini/index";

describe("workoutSuggestionSchema", () => {
  const validSuggestion = {
    workoutId: "w1",
    workoutDate: "2026-01-15",
    workoutFocus: "Strength",
    targetField: "mainWorkout" as const,
    action: "replace" as const,
    recommendation: "Add more squats",
    rationale: "Your legs need work",
    priority: "high" as const,
  };

  it("accepts valid suggestion", () => {
    expect(workoutSuggestionSchema.parse(validSuggestion)).toEqual(validSuggestion);
  });

  it("rejects missing required fields", () => {
    const { workoutId: _workoutId, ...missing } = validSuggestion;
    expect(() => workoutSuggestionSchema.parse(missing)).toThrow();
  });

  it("rejects invalid targetField enum", () => {
    expect(() =>
      workoutSuggestionSchema.parse({ ...validSuggestion, targetField: "invalid" }),
    ).toThrow();
  });

  it("rejects invalid action enum", () => {
    expect(() =>
      workoutSuggestionSchema.parse({ ...validSuggestion, action: "delete" }),
    ).toThrow();
  });

  it("rejects invalid priority enum", () => {
    expect(() =>
      workoutSuggestionSchema.parse({ ...validSuggestion, priority: "urgent" }),
    ).toThrow();
  });
});

describe("parsedExerciseSchema", () => {
  const validExercise = {
    exerciseName: "back_squat",
    category: "strength",
    sets: [{ setNumber: 1, reps: 8, weight: 100 }],
  };

  it("accepts valid exercise", () => {
    const result = parsedExerciseSchema.parse(validExercise);
    expect(result.exerciseName).toBe("back_squat");
    expect(result.sets).toHaveLength(1);
  });

  it("accepts optional/nullable fields", () => {
    const exercise = {
      ...validExercise,
      customLabel: "My Squat",
      confidence: 95,
    };
    const result = parsedExerciseSchema.parse(exercise);
    expect(result.customLabel).toBe("My Squat");
    expect(result.confidence).toBe(95);
  });

  it("accepts null for optional nullable fields", () => {
    const exercise = {
      ...validExercise,
      customLabel: null,
      confidence: null,
    };
    expect(() => parsedExerciseSchema.parse(exercise)).not.toThrow();
  });

  it("rejects empty sets array", () => {
    expect(() =>
      parsedExerciseSchema.parse({ ...validExercise, sets: [] }),
    ).toThrow();
  });

  it("rejects confidence outside 0-100 range", () => {
    expect(() =>
      parsedExerciseSchema.parse({ ...validExercise, confidence: 150 }),
    ).toThrow();
    expect(() =>
      parsedExerciseSchema.parse({ ...validExercise, confidence: -5 }),
    ).toThrow();
  });
});

describe("exerciseSetSchema", () => {
  it("accepts full set data", () => {
    const result = exerciseSetSchema.parse({
      setNumber: 1,
      reps: 8,
      weight: 100,
      distance: null,
      time: null,
    });
    expect(result.setNumber).toBe(1);
    expect(result.reps).toBe(8);
  });

  it("accepts partial set data", () => {
    const result = exerciseSetSchema.parse({ reps: 10 });
    expect(result.reps).toBe(10);
    expect(result.weight).toBeUndefined();
  });

  it("accepts completely empty set", () => {
    expect(() => exerciseSetSchema.parse({})).not.toThrow();
  });
});
