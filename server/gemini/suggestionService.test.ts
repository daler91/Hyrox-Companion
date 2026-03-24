import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAndValidateSuggestions } from "./suggestionService";
import { logger } from "../logger";

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
        workoutFocus: "Legs &lt;script&gt;alert(1)&lt;/script&gt;",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Squats 5x5",
        rationale: "Increase strength <img src=x onerror=alert(1)>",
        priority: "high"
      }
    ]);

    const result = parseAndValidateSuggestions(validJson);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      workoutId: "123",
      workoutDate: "2023-10-01",
      targetField: "mainWorkout",
      action: "replace",
      priority: "high",
    });

    // Testing sanitizeHtml side-effects
    expect(result[0].workoutFocus).not.toContain("<script>");
    expect(result[0].rationale).not.toContain("<img src=x onerror=alert(1)>");
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should gracefully handle malformed JSON and log an error", () => {
    const invalidJson = "This is definitely not JSON";

    const result = parseAndValidateSuggestions(invalidJson);

    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: "This is definitely not JSON"
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
