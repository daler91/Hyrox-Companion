import { beforeEach,describe, expect, it, vi } from "vitest";

import { retryWithBackoff } from "./client";
import { parseExercisesFromText, parseWorkoutStructureFromText } from "./exerciseParser";

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

  it("normalizes explicit kg parser weights into lbs for pounds users", async () => {
    vi.mocked(retryWithBackoff).mockResolvedValueOnce({
      text: JSON.stringify({
        exercises: [
          {
            exerciseName: "back_squat",
            category: "strength",
            sets: [{ setNumber: 1, reps: 5, weight: 75, weightUnit: "kg" }],
          },
        ],
      }),
    });

    const result = await parseExercisesFromText(
      "Back squat 1x5 at 75kg",
      { weightUnit: "lbs", distanceUnit: "miles" },
    );

    expect(result[0].sets[0].weight).toBe(165);
  });

  it("normalizes explicit lb parser weights into kg for kilogram users", async () => {
    vi.mocked(retryWithBackoff).mockResolvedValueOnce({
      text: JSON.stringify({
        exercises: [
          {
            exerciseName: "back_squat",
            category: "strength",
            sets: [{ setNumber: 1, reps: 5, weight: 165, weightUnit: "lb" }],
          },
        ],
      }),
    });

    const result = await parseExercisesFromText(
      "Back squat 1x5 at 165lb",
      { weightUnit: "kg", distanceUnit: "km" },
    );

    expect(result[0].sets[0].weight).toBe(75);
  });

  it("normalizes explicit distance units into the user's table distance unit", async () => {
    vi.mocked(retryWithBackoff).mockResolvedValueOnce({
      text: JSON.stringify({
        exercises: [
          {
            exerciseName: "sled_push",
            category: "functional",
            sets: [{ setNumber: 1, distance: 50, distanceUnit: "m" }],
          },
        ],
      }),
    });

    const result = await parseExercisesFromText(
      "Sled push 50m",
      { weightUnit: "lbs", distanceUnit: "miles" },
    );

    expect(result[0].sets[0].distance).toBe(164);
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

  it("returns empty array when AI returns valid JSON but invalid schema", async () => {
    const mockResponse = {
      // exerciseName empty — unsalvageable. The lenience layer can synthesize
      // a default sets array, but a blank name has no signal to recover from.
      text: JSON.stringify([{ exerciseName: "", category: "strength", sets: [{ reps: 1 }] }]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("Some text")).resolves.toEqual([]);
  });

  it("salvages rows with empty sets by synthesizing a single default set", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "back_squat", category: "strength", sets: [] },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("back squat");
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("back_squat");
    expect(result[0].sets).toHaveLength(1);
    expect(result[0].sets[0].setNumber).toBe(1);
  });

  it("salvages rows with no sets field at all", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "deadlift", category: "strength" },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("deadlift session");
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("deadlift");
    expect(result[0].sets).toHaveLength(1);
  });

  it("defaults missing category to conditioning instead of dropping the row", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "burpees", sets: [{ setNumber: 1, reps: 20 }] },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("20 burpees");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("conditioning");
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

  it("returns empty array when every row is malformed", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "", category: "strength", sets: [{ reps: 1 }] },
        { exerciseName: "" },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("garbage input")).resolves.toEqual([]);
  });

  it("returns empty array when object-shaped payload has only malformed exercise rows", async () => {
    const mockResponse = {
      text: JSON.stringify({
        exercises: [
          { exerciseName: "", category: "strength", sets: [{ reps: 1 }] },
          { exerciseName: "" },
        ],
      }),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    await expect(parseExercisesFromText("garbage input")).resolves.toEqual([]);
  });

  
  it("recovers common strength+interval patterns via heuristic fallback when AI rows are malformed", async () => {
    const mockResponse = {
      text: JSON.stringify([
        { exerciseName: "", category: "strength", sets: [{ reps: 1 }] },
      ]),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const input = "Strength: Back Squat 3x4 at 80-85% 1RM. Deadlift 3 x 5 at 60% 1RM (Technique focus). Rowing: 4x4 minutes strictly at MAF heart rate ceiling with 90 seconds easy active recovery between sets.";
    const result = await parseExercisesFromText(input);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.sets.some((s) => s.reps === 4))).toBe(true);
    expect(result.some((r) => r.sets.some((s) => s.reps === 5))).toBe(true);
    expect(result.some((r) => r.sets.some((s) => s.time === 4))).toBe(true);
    expect(result.some((r) => (r.missingFields ?? []).some((f) => f.includes("Heuristic fallback parser")))).toBe(true);
  });

  it("parses a full Hyrox circuit via the heuristic fallback when the AI returns no rows", async () => {
    // The AI contributes nothing (valid JSON, empty list). The deterministic
    // fallback must still recover every run and station from the source text —
    // this is the guarantee for the "couldn't parse exercises" Hyrox report.
    vi.mocked(retryWithBackoff).mockResolvedValueOnce({ text: JSON.stringify([]) });

    const hyrox = [
      "1000m Run",
      "1000m SkiErg",
      "1000m Run",
      "50m Sled Push",
      "1000m Run",
      "50m Sled Pull",
      "1000m Run",
      "80m Burpee Broad Jump",
      "1000m Run",
      "1000m Row",
      "1000m Run",
      "200m Farmers Carry",
      "1000m Run",
      "100m Sandbag Lunges",
      "1000m Run",
      "100 Wall Balls",
    ].join("\n");

    const result = await parseExercisesFromText(hyrox);

    expect(result).toHaveLength(16);
    expect(result.filter((r) => r.exerciseName === "run_1k")).toHaveLength(8);
    // Stations resolve to their canonical functional keys, in race order.
    const stations = result.filter((r) => r.exerciseName !== "run_1k").map((r) => r.exerciseName);
    expect(stations).toEqual([
      "skierg",
      "sled_push",
      "sled_pull",
      "burpee_broad_jump",
      "rowing",
      "farmers_carry",
      "sandbag_lunges",
      "wall_balls",
    ]);
    // Runs carry distance (1000m), wall balls carry reps (100).
    expect(result[0].exerciseName).toBe("run_1k");
    expect(result[0].category).toBe("running");
    expect(result[0].sets[0].distance).toBe(1000);
    const wallBalls = result.find((r) => r.exerciseName === "wall_balls");
    expect(wallBalls?.category).toBe("functional");
    expect(wallBalls?.sets[0].reps).toBe(100);
    // Every recovered row is flagged as heuristic so the UI can prompt review.
    expect(
      result.every((r) => (r.missingFields ?? []).some((f) => f.includes("Heuristic fallback parser"))),
    ).toBe(true);
  });

  it("recovers a Hyrox circuit from source text when the AI returns invalid JSON", async () => {
    // A truncated/garbled AI response used to hard-fail with a 502; it now falls
    // back to the heuristic parser instead of throwing when recovery is possible.
    vi.mocked(retryWithBackoff).mockResolvedValueOnce({ text: "{ not valid json" });

    const hyrox = ["1000m Run", "50m Sled Push", "100 Wall Balls"].join("\n");
    const result = await parseExercisesFromText(hyrox);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.exerciseName)).toEqual(["run_1k", "sled_push", "wall_balls"]);
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

  it("salvages exercises from object-shaped payload when structureBlocks are malformed", async () => {
    const mockResponse = {
      text: JSON.stringify({
        exercises: [
          {
            exerciseName: "back_squat",
            category: "strength",
            sets: [{ setNumber: 1, reps: 5, weight: 100 }],
          },
        ],
        structureBlocks: [{ sectionType: "main" }], // malformed on purpose
        warnings: ["ambiguous interval semantics"],
      }),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("Back squat 1x5 at 100kg");

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("back_squat");
    expect(result[0].missingFields).toContain("ambiguous interval semantics");
  });

  it("accepts parser contract payloads for EMOM/AMRAP with warmup-cooldown and scaling warnings", async () => {
    const mockResponse = {
      text: JSON.stringify({
        exercises: [
          { exerciseName: "emom", category: "conditioning", sets: [{ setNumber: 1, time: 12 }] },
          { exerciseName: "amrap", category: "conditioning", sets: [{ setNumber: 1, time: 10 }] },
        ],
        structureBlocks: [
          {
            sectionType: "warmup",
            formatType: "rounds",
            rounds: 2,
            steps: [{ stepNumber: 1, exerciseName: "rowing", category: "conditioning" }],
          },
          {
            sectionType: "main",
            formatType: "emom",
            durationSeconds: 720,
            steps: [{ stepNumber: 1, exerciseName: "emom", category: "conditioning", stepRole: "work" }],
          },
          {
            sectionType: "cooldown",
            formatType: "amrap",
            durationSeconds: 600,
            steps: [{ stepNumber: 1, exerciseName: "amrap", category: "conditioning" }],
          },
        ],
        warnings: ["scaling branch: reduce load 20% if RPE > 8"],
      }),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseExercisesFromText("Warmup rounds then EMOM, finish with cooldown AMRAP");
    expect(result).toHaveLength(2);
    expect(result[0].exerciseName).toBe("emom");
    expect(result[1].exerciseName).toBe("amrap");
    expect(result[0].missingFields).toContain("scaling branch: reduce load 20% if RPE > 8");
  });

  it("links structured parser exercise rows to generated block ids", async () => {
    const mockResponse = {
      text: JSON.stringify({
        exercises: [
          {
            exerciseName: "wall_balls",
            category: "conditioning",
            sets: [{ setNumber: 1, reps: 12 }],
          },
        ],
        structureBlocks: [
          {
            sectionType: "main",
            formatType: "emom",
            durationMinutes: 10,
            steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "wall_balls" }],
          },
        ],
      }),
    };
    vi.mocked(retryWithBackoff).mockResolvedValueOnce(mockResponse);

    const result = await parseWorkoutStructureFromText("10 min EMOM: 12 wall balls");
    const blockId = result.structureBlocks[0].id;

    expect(blockId).toEqual(expect.any(String));
    expect(result.exercises[0].sets[0]).toMatchObject({
      blockId,
      stepNumber: 1,
      intervalMinute: 1,
      stepRole: "work",
    });
  });
});
