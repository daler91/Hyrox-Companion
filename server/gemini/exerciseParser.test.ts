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
});
