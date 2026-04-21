import { beforeEach,describe, expect, it, vi } from "vitest";

import { logger } from "../logger";
import { parseAndValidateSuggestions } from "./suggestionService";

vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("suggestionService - parseAndValidateSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse and validate a correctly formatted JSON array of suggestions", () => {
    const validJson = JSON.stringify([
      {
        workoutId: "123",
        workoutDate: "2023-10-01",
        workoutFocus: "Legs",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Squats 5x5",
        rationale: "Increase strength",
        priority: "high"
      }
    ]);

    const result = parseAndValidateSuggestions(validJson);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      workoutId: "123",
      workoutDate: "2023-10-01",
      workoutFocus: "Legs",
      targetField: "mainWorkout",
      action: "replace",
      rationale: "Increase strength",
      priority: "high",
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("preserves apostrophes and quotes as raw characters for React-text rendering", () => {
    // Regression: sanitizeHtml used to encode `'` → `&#39;` and `"` → `&quot;`.
    // Because CoachTakePanel renders `{rationale}` as text (not HTML), the
    // encoded entities were leaking into the UI as literal characters —
    // users saw "You&#39;ve crushed" instead of "You've crushed". React
    // already escapes text safely, so we store raw characters now.
    const json = JSON.stringify([
      {
        workoutId: "1",
        workoutDate: "2023-10-01",
        workoutFocus: `Strength "heavy" day`,
        targetField: "mainWorkout",
        action: "replace",
        recommendation: `Don't skip warm-ups`,
        rationale: `You've crushed a 7-day streak`,
        priority: "high",
      },
    ]);

    const result = parseAndValidateSuggestions(json);

    expect(result).toHaveLength(1);
    expect(result[0].rationale).toBe("You've crushed a 7-day streak");
    expect(result[0].recommendation).toBe("Don't skip warm-ups");
    expect(result[0].workoutFocus).toBe(`Strength "heavy" day`);
    expect(result[0].rationale).not.toContain("&#39;");
    expect(result[0].recommendation).not.toContain("&#39;");
    expect(result[0].workoutFocus).not.toContain("&quot;");
  });

  it("swaps ampersands for 'and' to keep free-text readable", () => {
    const json = JSON.stringify([
      {
        workoutId: "1",
        workoutDate: "2023-10-01",
        workoutFocus: "Push & Pull",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "A & B supersets",
        rationale: "Lower back & hamstrings",
        priority: "low",
      },
    ]);

    const result = parseAndValidateSuggestions(json);

    expect(result[0].workoutFocus).toBe("Push and Pull");
    expect(result[0].recommendation).toBe("A and B supersets");
    expect(result[0].rationale).toBe("Lower back and hamstrings");
  });

  it("should gracefully handle malformed JSON and log an error", () => {
    const invalidJson = "This is definitely not JSON";

    const result = parseAndValidateSuggestions(invalidJson);

    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLength: 27
      }),
      "[gemini] suggestions JSON.parse failed."
    );
  });

  it("should drop suggestions that fail schema validation and log a warning", () => {
    const mixedJson = JSON.stringify([
      {
        workoutId: "123",
        workoutDate: "2023-10-01",
        workoutFocus: "Legs",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Squats 5x5",
        rationale: "Increase strength",
        priority: "high"
      },
      {
        // Invalid entry: missing required fields like workoutId, action, etc.
        workoutFocus: "Invalid",
        targetField: "unknown_field"
      }
    ]);

    const result = parseAndValidateSuggestions(mixedJson);

    // Should only return the 1 valid item
    expect(result).toHaveLength(1);
    expect(result[0].workoutId).toBe("123");

    // Warning should be logged for the dropped invalid item
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: expect.any(Array),
        item: expect.stringContaining("unknown_field")
      }),
      "[gemini] Dropping invalid suggestion:"
    );
  });
});
