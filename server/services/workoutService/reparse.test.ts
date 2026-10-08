import {
  type InsertExerciseSet,
  type ParsedExercise,
  type StructureBlockInput,
} from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseWorkoutStructureFromImageWithDiagnostics,
  parseWorkoutStructureFromTextWithDiagnostics,
} from "../../gemini";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { incrementStructuredExerciseCounter } from "../structuredExerciseHealth";
import { replaceExerciseSetsAndStructureByOwner, saveParsedWorkoutsBatch } from "./persistence";
import {
  batchReparseWorkouts,
  processBatchChunk,
  reparsePlanDay,
  reparsePlanDayFromImage,
  reparseWorkout,
  reparseWorkoutFromImage,
} from "./reparse";
import { expandExercisesToRows, prepareParsedWorkout } from "./setRows";

vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../storage", () => ({
  storage: {
    workouts: { getWorkoutsWithoutExerciseSets: vi.fn() },
    users: { getUser: vi.fn() },
  },
}));
vi.mock("../structuredExerciseHealth", () => ({ incrementStructuredExerciseCounter: vi.fn() }));
vi.mock("./persistence", () => ({
  replaceExerciseSetsAndStructureByOwner: vi.fn(),
  saveParsedWorkoutsBatch: vi.fn(),
}));
vi.mock("./setRows", () => ({ expandExercisesToRows: vi.fn(), prepareParsedWorkout: vi.fn() }));
vi.mock("../../gemini", () => ({
  parseWorkoutStructureFromTextWithDiagnostics: vi.fn(),
  parseWorkoutStructureFromImageWithDiagnostics: vi.fn(),
}));

const UNITS: UnitPreferences = { weightUnit: "kg", distanceUnit: "km" };
const USER_ID = "user1";
const MANUAL_FIX = "manual_fix_completed";

type DiagnosticsResult = Awaited<ReturnType<typeof parseWorkoutStructureFromTextWithDiagnostics>>;
type WriteResult = {
  exercises: ParsedExercise[];
  setCount: number;
  saved: true;
  rejectedCount: number;
  rejectionReasons: string[];
  fallbackUsed?: boolean;
};

function ex(exerciseName: string): ParsedExercise {
  return { exerciseName } as unknown as ParsedExercise;
}

function block(): StructureBlockInput {
  return {} as unknown as StructureBlockInput;
}

function parseResult(overrides: Partial<DiagnosticsResult> = {}): DiagnosticsResult {
  return {
    acceptedRows: [],
    rejectedRows: [],
    fallbackUsed: false,
    structureBlocks: [],
    warnings: [],
    confidence: null,
    ...overrides,
  };
}


const textMock = vi.mocked(parseWorkoutStructureFromTextWithDiagnostics);
const imageMock = vi.mocked(parseWorkoutStructureFromImageWithDiagnostics);
const replaceMock = vi.mocked(replaceExerciseSetsAndStructureByOwner);
const expandMock = vi.mocked(expandExercisesToRows);
const counterMock = vi.mocked(incrementStructuredExerciseCounter);
const prepareMock = vi.mocked(prepareParsedWorkout);
const saveBatchMock = vi.mocked(saveParsedWorkoutsBatch);

beforeEach(() => {
  vi.clearAllMocks();

  counterMock.mockResolvedValue(undefined);
  replaceMock.mockResolvedValue(0);
  expandMock.mockReturnValue([]);
  textMock.mockResolvedValue(parseResult());
  imageMock.mockResolvedValue(parseResult());
  prepareMock.mockResolvedValue(null);
  saveBatchMock.mockResolvedValue({ saved: 0, failed: 0, skipped: 0 });
  vi.mocked(storage.workouts.getWorkoutsWithoutExerciseSets).mockResolvedValue([]);
  vi.mocked(storage.users.getUser).mockResolvedValue({
    weightUnit: "kg",
    distanceUnit: "km",
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reparseWorkout / reparsePlanDay (text)", () => {
  it("returns null when the combined free text is empty", async () => {
    const result = await reparseWorkout({ id: "w1", mainWorkout: null, accessory: null }, UNITS, USER_ID);
    expect(result).toBeNull();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("returns null when the provider yields no rows and no structure blocks", async () => {
    textMock.mockResolvedValue(parseResult());
    const result = await reparseWorkout({ id: "w1", mainWorkout: "5 squats" }, UNITS, USER_ID);
    expect(result).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("persists parsed rows and returns the write-through result", async () => {
    const rows = [ex("squat"), ex("lunge")];
    textMock.mockResolvedValue(parseResult({ acceptedRows: rows }));
    expandMock.mockReturnValue([{}, {}] as InsertExerciseSet[]);
    replaceMock.mockResolvedValue(2);

    const result = (await reparseWorkout(
      { id: "w1", mainWorkout: "squats" },
      UNITS,
      USER_ID,
    )) as WriteResult;

    expect(result).toEqual({
      exercises: rows,
      setCount: 2,
      saved: true,
      rejectedCount: 0,
      rejectionReasons: [],
      fallbackUsed: false,
    });
    expect(expandMock).toHaveBeenCalledWith(rows, { workoutLogId: "w1" }, "workout", UNITS);
    expect(replaceMock).toHaveBeenCalledWith({ workoutLogId: "w1" }, [{}, {}], undefined);
    // The provider records usage only for a call that names its user — PF2
    // (CODEBASE_ANALYSIS_2026-10-03).
    expect(textMock).toHaveBeenCalledWith("squats", UNITS, undefined, USER_ID);
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", MANUAL_FIX);
  });

  it("surfaces the rejected count and a schema-validation reason", async () => {
    textMock.mockResolvedValue(
      parseResult({ acceptedRows: [ex("squat")], rejectedRows: [{}, {}] as never }),
    );
    const result = (await reparseWorkout(
      { id: "w1", mainWorkout: "squats" },
      UNITS,
      USER_ID,
    )) as WriteResult;
    expect(result.rejectedCount).toBe(2);
    expect(result.rejectionReasons).toEqual(["schema_validation_failed"]);
  });

  it("writes structure blocks even when no rows are accepted", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [], structureBlocks: [block()] }));
    replaceMock.mockResolvedValue(1);
    const result = (await reparseWorkout(
      { id: "w1", mainWorkout: "EMOM 10" },
      UNITS,
      USER_ID,
    )) as WriteResult;
    expect(result.exercises).toEqual([]);
    expect(expandMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith({ workoutLogId: "w1" }, [], [block()]);
  });

  it("passes the fallbackUsed flag through", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")], fallbackUsed: true }));
    const result = (await reparseWorkout(
      { id: "w1", mainWorkout: "squats" },
      UNITS,
      USER_ID,
    )) as WriteResult;
    expect(result.fallbackUsed).toBe(true);
  });

  it("targets the plan-day owner and plan context", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    await reparsePlanDay({ id: "p1", mainWorkout: "squats" }, UNITS, USER_ID);
    expect(textMock).toHaveBeenCalledWith("squats", UNITS, undefined, USER_ID);
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { planDayId: "p1" }, "plan", UNITS);
    expect(counterMock).toHaveBeenCalledWith("plan_day", "manual", MANUAL_FIX);
  });
});

describe("reparseWorkoutFromImage / reparsePlanDayFromImage", () => {
  const image = { imageBase64: "b64", mimeType: "image/png" };

  it("parses an image and persists for a workout owner", async () => {
    imageMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    replaceMock.mockResolvedValue(1);

    const result = (await reparseWorkoutFromImage({ id: "w1" }, image, UNITS, "user1", [
      "my_lift",
    ])) as WriteResult;

    expect(result.setCount).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(imageMock).toHaveBeenCalledWith({
      imageBase64: "b64",
      mimeType: "image/png",
      weightUnit: "kg",
      distanceUnit: "km",
      customExerciseNames: ["my_lift"],
      userId: "user1",
    });
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { workoutLogId: "w1" }, "workout", UNITS);
    expect(counterMock).toHaveBeenCalledWith("workout_log", "photo", MANUAL_FIX);
  });

  it("defaults the units to kg/km when none are set", async () => {
    imageMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    await reparseWorkoutFromImage(
      { id: "w1" },
      image,
      { weightUnit: null, distanceUnit: null },
      "user1",
    );
    expect(imageMock).toHaveBeenCalledWith(
      expect.objectContaining({ weightUnit: "kg", distanceUnit: "km" }),
    );
  });

  it("targets the plan-day owner for plan-day images", async () => {
    imageMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    await reparsePlanDayFromImage({ id: "p1" }, image, UNITS, "user1");
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { planDayId: "p1" }, "plan", UNITS);
    expect(counterMock).toHaveBeenCalledWith("plan_day", "photo", MANUAL_FIX);
  });

  it("returns null when the image yields nothing", async () => {
    imageMock.mockResolvedValue(parseResult());
    const result = await reparseWorkoutFromImage({ id: "w1" }, image, UNITS, "user1");
    expect(result).toBeNull();
  });
});

describe("processBatchChunk", () => {
  it("returns zero counts for an empty chunk", async () => {
    const result = await processBatchChunk([], UNITS, USER_ID);
    expect(result).toEqual({ parsed: 0, failed: 0 });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(saveBatchMock).not.toHaveBeenCalled();
  });

  it("counts successful parses saved by the batch writer", async () => {
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 2, failed: 0, skipped: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS, USER_ID);

    expect(result).toEqual({ parsed: 2, failed: 0 });
    expect(prepareMock).toHaveBeenCalledWith({ id: "w1" }, UNITS, USER_ID);
    expect(saveBatchMock).toHaveBeenCalledWith([
      { workoutId: "w1", setRows: [{}] },
      { workoutId: "w2", setRows: [{}] },
    ]);
  });

  it("counts a rejected parse as failed and logs it", async () => {
    prepareMock
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0, skipped: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS, USER_ID);

    expect(result).toEqual({ parsed: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it("counts a null parse result as failed", async () => {
    prepareMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0, skipped: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS, USER_ID);

    expect(result).toEqual({ parsed: 1, failed: 1 });
  });

  it("adds batch write failures to the failed count", async () => {
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 1, skipped: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS, USER_ID);

    expect(result).toEqual({ parsed: 1, failed: 1 });
  });

  it("counts a workout skipped by the batch writer as neither parsed nor failed", async () => {
    // Skipped means the athlete logged sets into it after the snapshot, so it
    // is no longer unstructured and its parse was discarded (D17,
    // CODEBASE_ANALYSIS_2026-10-03).
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0, skipped: 1 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS, USER_ID);

    expect(result).toEqual({ parsed: 1, failed: 0 });
  });
});

describe("batchReparseWorkouts", () => {
  it("returns zero totals when there are no workouts", async () => {
    vi.mocked(storage.workouts.getWorkoutsWithoutExerciseSets).mockResolvedValue([]);
    const result = await batchReparseWorkouts("user1");
    expect(result).toEqual({ total: 0, parsed: 0, failed: 0 });
  });

  it("defaults units to kg/km when the user record is missing", async () => {
    vi.mocked(storage.workouts.getWorkoutsWithoutExerciseSets).mockResolvedValue([
      { id: "w1" },
    ] as never);
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0, skipped: 0 });

    const result = await batchReparseWorkouts("user1");

    expect(result).toEqual({ total: 1, parsed: 1, failed: 0 });
    expect(prepareMock).toHaveBeenCalledWith(
      { id: "w1" },
      { weightUnit: "kg", distanceUnit: "km" },
      "user1",
    );
  });

  it("processes workouts in chunks of five and aggregates the totals", async () => {
    const workouts = Array.from({ length: 7 }, (_, i) => ({ id: `w${i + 1}` }));
    vi.mocked(storage.workouts.getWorkoutsWithoutExerciseSets).mockResolvedValue(workouts as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({
      weightUnit: "lbs",
      distanceUnit: "miles",
    } as never);
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockImplementation((arr) => Promise.resolve({ saved: arr.length, failed: 0, skipped: 0 }));

    const result = await batchReparseWorkouts("user1");

    expect(result).toEqual({ total: 7, parsed: 7, failed: 0 });
    expect(prepareMock).toHaveBeenCalledTimes(7);
    expect(saveBatchMock).toHaveBeenCalledTimes(2); // chunk of 5, then chunk of 2
    expect(prepareMock).toHaveBeenCalledWith(
      { id: "w1" },
      { weightUnit: "lbs", distanceUnit: "miles" },
      "user1",
    );
  });
});
