import { beforeEach,describe, expect, it, vi } from "vitest";

import { retryWithBackoff } from "./client";
import { parseExercisesFromText } from "./exerciseParser";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    retryWithBackoff: vi.fn(),
  };
});

describe("parseExercisesFromText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse valid workout text successfully", async () => {
    const mockResponse = {
      text: JSON.stringify([
        {
          exerciseName: "back_squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("Squat 5x100");

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("back_squat");
    expect(result[0].sets[0].reps).toBe(5);
  });

  it("should throw a specific error when AI returns invalid JSON", async () => {
    const mockResponse = {
      text: "This is not JSON",
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("Some text")).rejects.toThrow(
      "AI returned invalid JSON for exercise parsing"
    );
  });

  it("should throw a specific error when AI returns valid JSON but invalid schema", async () => {
    const mockResponse = {
      text: JSON.stringify([{ exerciseName: "squat", sets: [] }]), // Invalid missing fields
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("Some text")).rejects.toThrow(
      "AI returned malformed exercise data"
    );
  });

  it("should throw a generic error when the Gemini client throws an unexpected error", async () => {
    vi.mocked(retryWithBackoff).mockRejectedValueOnce(new Error("API quota exceeded"));

    await expect(parseExercisesFromText("Some text")).rejects.toThrow(
      "Failed to parse exercises from text"
    );
  });

  it("should keep unknown exercises and preserve a well-formed customLabel", async () => {
    const mockResponse = {
      text: JSON.stringify([
        {
          exerciseName: "custom",
          category: "strength",
          customLabel: "Turkish Get-Up",
          confidence: 85,
          sets: [{ setNumber: 1, reps: 8, weight: 20 }],
        },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("4x8 turkish get-ups at 20kg");

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("custom");
    expect(result[0].customLabel).toBe("Turkish Get-Up");
    expect(result[0].confidence).toBe(85);
  });

  it("should synthesize a customLabel when AI returns 'custom' with no label", async () => {
    const mockResponse = {
      text: JSON.stringify([
        {
          exerciseName: "custom",
          category: "strength",
          customLabel: "",
          sets: [{ setNumber: 1, reps: 10 }],
        },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("3x10 copenhagen planks");

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("custom");
    // Synthesized from source text — non-empty, title-cased.
    expect(result[0].customLabel).toBeDefined();
    expect(result[0].customLabel!.length).toBeGreaterThan(0);
    expect(result[0].customLabel).toMatch(/^[A-Z]/);
    // Low confidence signals the UI to prompt the user to review.
    expect(result[0].confidence).toBeLessThanOrEqual(40);
    // "Name" is flagged as a missing field so the UI can highlight it.
    expect(result[0].missingFields).toContain("Name");
  });

  it("should drop rows with an empty exerciseName but keep valid siblings", async () => {
    const mockResponse = {
      text: JSON.stringify([
        {
          exerciseName: "",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5 }],
        },
        {
          exerciseName: "back_squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("blank then squats");

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("back_squat");
  });

  it("should throw when every row is malformed", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "", category: "strength", sets: [{ reps: 1 }] },
        { exerciseName: "squat", sets: [] },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("garbage input")).rejects.toThrow(
      "AI returned malformed exercise data",
    );
  });

  it("should fall back to source text when customLabel and exerciseName are both 'custom'", async () => {
    const mockResponse = {
      text: JSON.stringify([
        {
          exerciseName: "custom",
          category: "strength",
          // Both missing — synthesizeCustomLabel should derive from input.
          sets: [{ setNumber: 1, reps: 12, weight: 15 }],
        },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("3x12 zottman curls at 15kg");

    expect(result).toHaveLength(1);
    expect(result[0].customLabel).toBeDefined();
    // Derived from "zottman curls" in the input.
    expect(result[0].customLabel!.toLowerCase()).toContain("zottman");
  });
});
