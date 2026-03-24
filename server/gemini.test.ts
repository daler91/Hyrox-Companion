import { generateWorkoutSuggestions } from "./gemini/suggestionService";
import { logger } from "./logger";
import * as clientModule from "./gemini/client";
import { describe, it, expect, vi } from "vitest";
import { exerciseSetSchema } from "@shared/schema";
import {
  isRetryableError,
  retryWithBackoff,
  workoutSuggestionSchema,
  parsedExerciseSchema,
} from "./gemini/index";

describe("isRetryableError", () => {
  it("returns true for 429 rate limit", () => {
    expect(isRetryableError(new Error("Request failed with status 429"))).toBe(true);
  });

  it("returns true for 'rate limit' message", () => {
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("returns true for 500 server error", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
  });

  it("returns true for 503 service unavailable", () => {
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("returns true for network errors", () => {
    expect(isRetryableError(new Error("network error"))).toBe(true);
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("request timeout"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });

  it("returns false for 400 bad request", () => {
    expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    expect(isRetryableError(new Error("Invalid JSON"))).toBe(false);
    expect(isRetryableError(new Error("Missing required field"))).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("succeeds on first try without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await retryWithBackoff(fn, "test", 2, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("recovered");
    const result = await retryWithBackoff(fn, "test", 2, 1);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400 Bad Request"));
    await expect(retryWithBackoff(fn, "test", 2, 1)).rejects.toThrow("400 Bad Request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
    await expect(retryWithBackoff(fn, "test", 2, 1)).rejects.toThrow("503 Service Unavailable");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

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

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("./gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini/client")>();
  return {
    ...actual,
    retryWithBackoff: vi.fn((fn) => {
      // If we are in the generateWorkoutSuggestions test, throw the error
      if (new Error().stack?.includes("generateWorkoutSuggestions")) {
        return Promise.reject(new Error("Simulated AI generation failure"));
      }
      // Otherwise, keep the original behavior for other tests
      return actual.retryWithBackoff(fn, "test");
    }),
  };
});

describe("generateWorkoutSuggestions", () => {
  it("returns an empty array and logs error when AI client fails", async () => {
    // 1. Arrange

    const mockTrainingContext = {
      completionRate: 85,
      currentStreak: 5,
      completedWorkouts: 20,
      exerciseBreakdown: { "Squat": 5 },
      structuredExerciseStats: {},
      recentWorkouts: [],
      weeklyGoal: 3,
    };

    const mockUpcomingWorkouts = [
      { id: "1", date: "2024-11-20", focus: "Legs", mainWorkout: "Squats 5x5" }
    ];

    // 2. Act
    const { generateWorkoutSuggestions } = await import("./gemini/suggestionService");
    const { logger } = await import("./logger");
    const result = await generateWorkoutSuggestions(mockTrainingContext, mockUpcomingWorkouts);

    // 3. Assert
    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error)
      }),
      "[gemini] suggestions error:"
    );
  });
});
