import { exerciseSetSchema } from "@shared/schema";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { __resetCircuitBreakerForTests } from "./gemini/circuitBreaker";
import {
  isRetryableError,
  parsedExerciseSchema,
  retryWithBackoff,
  workoutSuggestionSchema,
} from "./gemini/index";

describe("isRetryableError", () => {
  it.each([
    new Error("Request failed with status 429"),
    new Error("rate limit exceeded"),
    new Error("500 Internal Server Error"),
    new Error("503 Service Unavailable"),
    new Error("network error"),
    new Error("ECONNRESET"),
    new Error("request timeout"),
    new Error("fetch failed"),
  ])("returns true for retryable error %#", (error) => {
    expect(isRetryableError(error)).toBe(true);
  });

  it.each([
    new Error("400 Bad Request"),
    "string error",
    42,
    null,
    undefined,
    new Error("Invalid JSON"),
    new Error("Missing required field"),
  ])("returns false for non-retryable error %#", (error) => {
    expect(isRetryableError(error)).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

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

  it("times out a slow call at the default 90s per-attempt limit", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(
        () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 100_000)),
      );
      const promise = retryWithBackoff(fn, "slow");
      const assertion = expect(promise).rejects.toThrow("AI call timed out after 90000ms (slow)");
      await vi.advanceTimersByTimeAsync(90_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a slow call exceed 90s when the per-call timeout is raised", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(
        () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 100_000)),
      );
      // budgetMs and callTimeoutMs raised to 5min; maxRetries/baseDelayMs keep defaults.
      const promise = retryWithBackoff(fn, "slow", undefined, undefined, 300_000, 300_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await expect(promise).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
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

  it.each([
    ["targetField", { targetField: "invalid" }],
    ["action", { action: "delete" }],
    ["priority", { priority: "urgent" }],
  ])("rejects invalid %s enum", (_field, override) => {
    expect(() =>
      workoutSuggestionSchema.parse({ ...validSuggestion, ...override }),
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

  it("synthesizes a default set when sets array is empty (lenient salvage)", () => {
    // Gemini frequently emits rows with empty sets for steady-state / EMOM
    // workouts. The schema preprocessor coerces a single default set so the
    // row survives validation instead of being silently dropped.
    const parsed = parsedExerciseSchema.parse({ ...validExercise, sets: [] });
    expect(parsed.sets).toHaveLength(1);
    expect(parsed.sets[0].setNumber).toBe(1);
  });

  it("synthesizes a default set when sets is missing entirely", () => {
    const { sets: _sets, ...withoutSets } = validExercise;
    const parsed = parsedExerciseSchema.parse(withoutSets);
    expect(parsed.sets).toHaveLength(1);
  });

  it("infers category from exerciseName when missing (known key)", () => {
    const { category: _category, ...withoutCategory } = validExercise;
    // validExercise.exerciseName is a known strength key (back_squat).
    const parsed = parsedExerciseSchema.parse(withoutCategory);
    expect(parsed.category).toBe("strength");
  });

  it("falls back to conditioning when exerciseName is unknown/custom", () => {
    const parsed = parsedExerciseSchema.parse({
      ...validExercise,
      exerciseName: "custom",
      category: undefined,
    });
    expect(parsed.category).toBe("conditioning");
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
