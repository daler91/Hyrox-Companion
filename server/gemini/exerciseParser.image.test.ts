import { beforeEach,describe, expect, it, vi } from "vitest";

import { logger } from "../logger";
import { trackUsageFromResponse } from "./client";
import { parseExercisesFromImage } from "./exerciseParser";

// Each test configures this spy to return a response. The mock wraps
// `retryWithBackoff` so it calls the underlying fn (the generateContent
// invocation from the parser), letting us capture the actual request
// shape the parser builds for the vision path.
const generateContentSpy = vi.fn();

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    // Run the wrapped fn so generateContent is actually called with the
    // args the parser constructed.
    retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
    getAiClient: () => ({ models: { generateContent: generateContentSpy } }),
    trackUsageFromResponse: vi.fn(),
    GEMINI_VISION_MODEL: "gemini-2.5-flash",
  };
});

describe("parseExercisesFromImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the image as inlineData on the vision model and maps rows like the text path", async () => {
    generateContentSpy.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          exerciseName: "back_squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        },
      ]),
    });

    const result = await parseExercisesFromImage({
      imageBase64: "ZmFrZS1pbWFnZQ==",
      mimeType: "image/jpeg",
      weightUnit: "kg",
      userId: "user-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("back_squat");
    expect(result[0].sets[0].reps).toBe(5);

    // One call landed; the model is the vision default; the request shape
    // carries the base64 under `inlineData` alongside a short text nudge.
    expect(generateContentSpy).toHaveBeenCalledTimes(1);
    const callArgs = generateContentSpy.mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-flash");
    expect(callArgs.config.responseMimeType).toBe("application/json");
    expect(callArgs.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "ZmFrZS1pbWFnZQ==" },
    });
    expect(typeof callArgs.contents[0].parts[1].text).toBe("string");
    expect(callArgs.contents[0].parts[1].text.length).toBeGreaterThan(0);
  });

  it("returns [] when the model returns an empty array", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: JSON.stringify([]) });
    const result = await parseExercisesFromImage({
      imageBase64: "ZmFrZQ==",
      mimeType: "image/jpeg",
    });
    expect(result).toEqual([]);
  });

  // The parse goes through the shared callGeminiVisionJson (C-vision), which
  // keeps the exercise path's own two rules: usage is recorded only against an
  // athlete, and an empty reply is logged before it fails.
  it("records usage under parse for an athlete, and none without one", async () => {
    generateContentSpy.mockResolvedValue({ text: JSON.stringify([]) });

    await parseExercisesFromImage({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg", userId: "user-1" });
    expect(trackUsageFromResponse).toHaveBeenCalledWith("user-1", "gemini-2.5-flash", "parse", expect.anything());

    vi.mocked(trackUsageFromResponse).mockClear();
    await parseExercisesFromImage({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg" });
    expect(trackUsageFromResponse).not.toHaveBeenCalled();
  });

  it("logs and fails on an empty reply", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    generateContentSpy.mockResolvedValueOnce({ text: "" });

    await expect(
      parseExercisesFromImage({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg", userId: "user-1" }),
    ).rejects.toThrow("AI returned empty response for exercise parsing");
    expect(errorSpy).toHaveBeenCalledWith(
      { response: { text: "" } },
      "[gemini] exercise-parse-image returned empty response",
    );
    errorSpy.mockRestore();
  });

  it("throws a specific error when the model returns invalid JSON", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: "not json" });
    await expect(
      parseExercisesFromImage({
        imageBase64: "ZmFrZQ==",
        mimeType: "image/png",
      }),
    ).rejects.toThrow("AI returned invalid JSON for exercise parsing");
  });

  it("falls back to an Unknown-exercise synthesis when a 'custom' row has no label", async () => {
    generateContentSpy.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          exerciseName: "custom",
          category: "strength",
          customLabel: "",
          sets: [{ setNumber: 1, reps: 10 }],
        },
      ]),
    });
    const result = await parseExercisesFromImage({
      imageBase64: "ZmFrZQ==",
      mimeType: "image/webp",
    });
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("custom");
    // For image input there's no source text, so the synthesizer lands on
    // the "Unknown exercise" fallback rather than extracting a real name.
    expect(result[0].customLabel).toBe("Unknown exercise");
    expect(result[0].missingFields).toContain("Name");
  });

  it("returns empty array when object-shaped payload has only malformed exercise rows", async () => {
    generateContentSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        exercises: [
          { exerciseName: "", category: "strength", sets: [{ reps: 1 }] },
          { exerciseName: "" },
        ],
      }),
    });
    await expect(
      parseExercisesFromImage({
        imageBase64: "ZmFrZQ==",
        mimeType: "image/png",
      }),
    ).resolves.toEqual([]);
  });
});
