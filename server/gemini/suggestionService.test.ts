import { beforeEach,describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../ai/providers";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import {
  generateReviewNotes,
  generateWorkoutSuggestions,
  parseAndValidateReviewNotes,
  parseAndValidateSuggestions,
} from "./suggestionService";
import type { TrainingContext } from "./types";

vi.mock("../ai/providers", () => ({ generateJsonText: vi.fn() }));

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

  // AI8 (CODEBASE_ANALYSIS_2026-10-03): `[]` is the model's answer "nothing
  // to change". An unreadable reply used to come back as the same `[]`.
  it("throws on malformed JSON instead of reading it as no suggestions, and logs it", () => {
    const invalidJson = "This is definitely not JSON";

    expect(() => parseAndValidateSuggestions(invalidJson)).toThrow(AppError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLength: 27
      }),
      "[gemini] suggestions JSON.parse failed."
    );
  });

  it.each([
    ["an empty reply", ""],
    ["a JSON object", JSON.stringify({ suggestions: [] })],
    ["a JSON null", "null"],
  ])("throws on %s, which is not the array asked for", (_label, text) => {
    expect(() => parseAndValidateSuggestions(text)).toThrow(
      expect.objectContaining({ code: ErrorCode.AI_ERROR, status: 502 }),
    );
    expect(() => parseAndValidateReviewNotes(text)).toThrow(AppError);
  });

  it("reads an empty array as the model finding nothing to change", () => {
    expect(parseAndValidateSuggestions("[]")).toEqual([]);
    expect(parseAndValidateReviewNotes("[]")).toEqual([]);
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

    // Warning should be logged for the dropped invalid item. Both values go
    // through the log-injection boundary now (see utils/sanitize): `issues` is
    // a flattened `path:message` string rather than the raw issue array, and
    // the item preview has its control characters stripped.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: expect.stringContaining("targetField:"),
        item: expect.stringContaining("unknown_field")
      }),
      "[gemini] Dropping invalid suggestion:"
    );
  });

  it("does not let a newline in the model's output forge a log record", () => {
    // The item is model output shaped by the athlete's own text. An unsanitized
    // preview let a newline in it open a second, attacker-chosen log line.
    const forged = JSON.stringify([{ workoutFocus: "x\nlevel=error msg=\"forged\"", targetField: "nope" }]);

    parseAndValidateSuggestions(forged);

    const logged = vi.mocked(logger.warn).mock.calls.at(-1)?.[0] as { item: string; issues: string };
    expect(logged.item).toContain("forged");
    expect(logged.item).not.toContain("\n");
    expect(logged.issues).not.toContain("\n");
  });
});

/**
 * AI8 (CODEBASE_ANALYSIS_2026-10-03): both coach calls caught every failure
 * and returned `[]`, so an outage read as "the plan still fits". A failed call
 * now rejects with a classified AppError the caller can act on.
 */
describe("suggestionService - failed coach calls", () => {
  const context = {
    totalWorkouts: 0,
    completedWorkouts: 0,
    plannedWorkouts: 1,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 0,
    currentStreak: 0,
    recentWorkouts: [],
    exerciseBreakdown: {},
  } as unknown as TrainingContext;
  const upcoming = [{ id: "day-1", date: "2026-06-16", focus: "Run", mainWorkout: "Easy 5k" }];
  const calls = [
    ["suggestions", () => generateWorkoutSuggestions(context, upcoming)],
    ["review notes", () => generateReviewNotes(context, upcoming)],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(calls)("%s: a provider outage rejects with its classified code", async (_label, call) => {
    vi.mocked(generateJsonText).mockRejectedValue(
      new Error("AI provider temporarily unavailable (circuit breaker open)"),
    );

    await expect(call()).rejects.toMatchObject({ code: ErrorCode.AI_UNAVAILABLE, status: 503 });
  });

  it.each(calls)("%s: an empty reply rejects rather than reading as no changes", async (_label, call) => {
    vi.mocked(generateJsonText).mockResolvedValue({ text: "", model: "m" });

    await expect(call()).rejects.toMatchObject({ code: ErrorCode.AI_ERROR, status: 502 });
  });

  it.each(calls)("%s: an empty array is a real answer", async (_label, call) => {
    vi.mocked(generateJsonText).mockResolvedValue({ text: "[]", model: "m" });

    await expect(call()).resolves.toEqual([]);
  });

  it("makes no call when there is nothing upcoming", async () => {
    await expect(generateWorkoutSuggestions(context, [])).resolves.toEqual([]);
    await expect(generateReviewNotes(context, [])).resolves.toEqual([]);
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});
