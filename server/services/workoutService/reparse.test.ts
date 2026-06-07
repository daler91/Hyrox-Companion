import {
  exerciseSets,
  type InsertExerciseSet,
  type ParsedExercise,
  type StructureBlockInput,
} from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import {
  parseWorkoutStructureFromImageWithDiagnostics,
  parseWorkoutStructureFromTextWithDiagnostics,
} from "../../gemini";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { incrementStructuredExerciseCounter } from "../structuredExerciseHealth";
import { replaceExerciseSetsAndStructureByOwner, saveParsedWorkoutsBatch } from "./persistence";
import {
  autoHydrateExerciseSetsFromTextIfNeeded,
  batchReparseWorkouts,
  processBatchChunk,
  reparsePlanDay,
  reparsePlanDayFromImage,
  reparseWorkout,
  reparseWorkoutFromImage,
} from "./reparse";
import { expandExercisesToRows, prepareParsedWorkout } from "./setRows";

vi.mock("../../db", () => ({ db: { select: vi.fn() } }));
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
const MANUAL_FIX = "manual_fix_completed";
const ATTEMPTED = "auto_hydration_attempted";
const SUCCEEDED = "auto_hydration_succeeded";
const FAILED = "auto_hydration_failed";

type DiagnosticsResult = Awaited<ReturnType<typeof parseWorkoutStructureFromTextWithDiagnostics>>;
type WriteResult = {
  exercises: ParsedExercise[];
  setCount: number;
  saved: true;
  rejectedCount: number;
  rejectionReasons: string[];
  fallbackUsed?: boolean;
};

const dbState = {
  count: 0,
  source: "manual" as string | null,
  sourceThrows: false,
  countMissing: false,
  sourceMissing: false,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => Promise.resolve();

const textMock = vi.mocked(parseWorkoutStructureFromTextWithDiagnostics);
const imageMock = vi.mocked(parseWorkoutStructureFromImageWithDiagnostics);
const replaceMock = vi.mocked(replaceExerciseSetsAndStructureByOwner);
const expandMock = vi.mocked(expandExercisesToRows);
const counterMock = vi.mocked(incrementStructuredExerciseCounter);
const prepareMock = vi.mocked(prepareParsedWorkout);
const saveBatchMock = vi.mocked(saveParsedWorkoutsBatch);

beforeEach(() => {
  vi.clearAllMocks();
  dbState.count = 0;
  dbState.source = "manual";
  dbState.sourceThrows = false;
  dbState.countMissing = false;
  dbState.sourceMissing = false;

  vi.mocked(db.select).mockImplementation(
    () =>
      ({
        from: (table: unknown) => {
          const isCount = table === exerciseSets;
          const countRows = dbState.countMissing ? [] : [{ count: dbState.count }];
          const sourceRows = dbState.sourceMissing ? [] : [{ source: dbState.source }];
          const rows = isCount ? countRows : sourceRows;
          const limit = () =>
            !isCount && dbState.sourceThrows
              ? Promise.reject(new Error("source lookup failed"))
              : Promise.resolve(rows);
          return { where: () => Object.assign(Promise.resolve(rows), { limit }) };
        },
      }) as unknown as ReturnType<typeof db.select>,
  );

  counterMock.mockResolvedValue(undefined);
  replaceMock.mockResolvedValue(0);
  expandMock.mockReturnValue([]);
  textMock.mockResolvedValue(parseResult());
  imageMock.mockResolvedValue(parseResult());
  prepareMock.mockResolvedValue(null);
  saveBatchMock.mockResolvedValue({ saved: 0, failed: 0 });
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
    const result = await reparseWorkout({ id: "w1", mainWorkout: null, accessory: null }, UNITS);
    expect(result).toBeNull();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("returns null when the provider yields no rows and no structure blocks", async () => {
    textMock.mockResolvedValue(parseResult());
    const result = await reparseWorkout({ id: "w1", mainWorkout: "5 squats" }, UNITS);
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
    )) as WriteResult;

    expect(result).toEqual({
      exercises: rows,
      setCount: 2,
      saved: true,
      rejectedCount: 0,
      rejectionReasons: [],
      fallbackUsed: false,
    });
    expect(expandMock).toHaveBeenCalledWith(rows, { workoutLogId: "w1" }, "workout");
    expect(replaceMock).toHaveBeenCalledWith({ workoutLogId: "w1" }, [{}, {}], undefined);
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", MANUAL_FIX);
  });

  it("surfaces the rejected count and a schema-validation reason", async () => {
    textMock.mockResolvedValue(
      parseResult({ acceptedRows: [ex("squat")], rejectedRows: [{}, {}] as never }),
    );
    const result = (await reparseWorkout(
      { id: "w1", mainWorkout: "squats" },
      UNITS,
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
    )) as WriteResult;
    expect(result.fallbackUsed).toBe(true);
  });

  it("targets the plan-day owner and plan context", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    await reparsePlanDay({ id: "p1", mainWorkout: "squats" }, UNITS);
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { planDayId: "p1" }, "plan");
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
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { workoutLogId: "w1" }, "workout");
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
    expect(expandMock).toHaveBeenCalledWith([ex("squat")], { planDayId: "p1" }, "plan");
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
    const result = await processBatchChunk([], UNITS);
    expect(result).toEqual({ parsed: 0, failed: 0 });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(saveBatchMock).not.toHaveBeenCalled();
  });

  it("counts successful parses saved by the batch writer", async () => {
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 2, failed: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS);

    expect(result).toEqual({ parsed: 2, failed: 0 });
    expect(saveBatchMock).toHaveBeenCalledWith([
      { workoutId: "w1", setRows: [{}] },
      { workoutId: "w2", setRows: [{}] },
    ]);
  });

  it("counts a rejected parse as failed and logs it", async () => {
    prepareMock
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS);

    expect(result).toEqual({ parsed: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it("counts a null parse result as failed", async () => {
    prepareMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS);

    expect(result).toEqual({ parsed: 1, failed: 1 });
  });

  it("adds batch write failures to the failed count", async () => {
    prepareMock.mockResolvedValue({ exercises: [], setRows: [{}] as InsertExerciseSet[] });
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 1 });

    const result = await processBatchChunk([{ id: "w1" }, { id: "w2" }], UNITS);

    expect(result).toEqual({ parsed: 1, failed: 1 });
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
    saveBatchMock.mockResolvedValue({ saved: 1, failed: 0 });

    const result = await batchReparseWorkouts("user1");

    expect(result).toEqual({ total: 1, parsed: 1, failed: 0 });
    expect(prepareMock).toHaveBeenCalledWith(
      { id: "w1" },
      { weightUnit: "kg", distanceUnit: "km" },
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
    saveBatchMock.mockImplementation((arr) => Promise.resolve({ saved: arr.length, failed: 0 }));

    const result = await batchReparseWorkouts("user1");

    expect(result).toEqual({ total: 7, parsed: 7, failed: 0 });
    expect(prepareMock).toHaveBeenCalledTimes(7);
    expect(saveBatchMock).toHaveBeenCalledTimes(2); // chunk of 5, then chunk of 2
    expect(prepareMock).toHaveBeenCalledWith(
      { id: "w1" },
      { weightUnit: "lbs", distanceUnit: "miles" },
    );
  });
});

describe("autoHydrateExerciseSetsFromTextIfNeeded", () => {
  const workoutOwner = { workoutLogId: "w1" } as const;
  const target = { id: "w1", mainWorkout: "10 squats" };

  it("returns null when structured sets already exist", async () => {
    dbState.count = 3;
    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      target,
      workoutOwner,
      UNITS,
      "workout",
    );
    expect(result).toBeNull();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("returns null when there is no free text to parse", async () => {
    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      { id: "w1", mainWorkout: null, accessory: null },
      workoutOwner,
      UNITS,
      "workout",
    );
    expect(result).toBeNull();
    expect(textMock).not.toHaveBeenCalled();
  });

  it("hydrates, persists, and records success telemetry", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    replaceMock.mockResolvedValue(1);

    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      target,
      workoutOwner,
      UNITS,
      "workout",
    );

    expect(result).toMatchObject({ setCount: 1, saved: true, rejectedCount: 0 });
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", ATTEMPTED);
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", SUCCEEDED);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "exercise_set_auto_hydration_success" }),
      expect.any(String),
    );
  });

  it.each([
    ["strava", "import"],
    ["garmin", "import"],
    ["import", "import"],
    ["voice", "voice"],
    ["photo", "photo"],
    ["other", "manual"],
  ])("maps workout-log source %s to telemetry source %s", async (raw, expected) => {
    dbState.source = raw;
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(counterMock).toHaveBeenCalledWith("workout_log", expected, ATTEMPTED);
  });

  it("uses the manual fallback source for plan-day owners (no source lookup)", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    await autoHydrateExerciseSetsFromTextIfNeeded(
      { id: "p1", mainWorkout: "x" },
      { planDayId: "p1" },
      UNITS,
      "plan",
    );
    expect(counterMock).toHaveBeenCalledWith("plan_day", "manual", ATTEMPTED);
  });

  it("logs degraded quality when rejections exceed accepted rows", async () => {
    textMock.mockResolvedValue(
      parseResult({ acceptedRows: [ex("squat")], rejectedRows: [{}, {}] as never }),
    );
    replaceMock.mockResolvedValue(1);

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "exercise_set_auto_hydration_success_degraded",
        qualityState: "degraded",
      }),
      expect.any(String),
    );
  });

  it("treats zero accepted rows (blocks only) as failed quality", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [], structureBlocks: [block()] }));
    replaceMock.mockResolvedValue(0);

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ qualityState: "failed" }),
      expect.any(String),
    );
  });

  it("dedupes concurrent calls through the hydration lock", async () => {
    const gate = deferred<DiagnosticsResult>();
    textMock.mockReturnValue(gate.promise);

    const first = autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");
    await tick(); // let the first call install the lock before the second checks
    const second = autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    gate.resolve(parseResult({ acceptedRows: [ex("squat")] }));
    const [a, b] = await Promise.all([first, second]);

    expect(b).toBe(a);
    expect(textMock).toHaveBeenCalledTimes(1);
  });

  it("records failure telemetry and rethrows when parsing fails", async () => {
    textMock.mockRejectedValue(new Error("provider exploded"));

    await expect(
      autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout"),
    ).rejects.toThrow("provider exploded");
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", FAILED);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "exercise_set_auto_hydration_failure" }),
      expect.any(String),
    );
  });

  it("clears the lock so a subsequent call re-parses", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");
    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(textMock).toHaveBeenCalledTimes(2);
  });

  it("defaults to the manual source and warns when source resolution fails", async () => {
    dbState.sourceThrows = true;
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auto_hydration_source_resolution_failed" }),
      expect.any(String),
    );
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", ATTEMPTED);
  });

  it("swallows and logs telemetry-increment failures during successful hydration", async () => {
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));
    counterMock.mockRejectedValue(new Error("telemetry down"));

    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      target,
      workoutOwner,
      UNITS,
      "workout",
    );
    await tick();
    await tick();

    // Hydration still succeeds even though every telemetry counter rejected.
    expect(result).toMatchObject({ saved: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auto_hydration_attempt_counter_failed" }),
      expect.any(String),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "manual_fix_counter_failed" }),
      expect.any(String),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auto_hydration_success_counter_failed" }),
      expect.any(String),
    );
  });

  it("logs when the failure-telemetry increment itself fails", async () => {
    textMock.mockRejectedValue(new Error("provider exploded"));
    counterMock.mockRejectedValue(new Error("telemetry down"));

    await expect(
      autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout"),
    ).rejects.toThrow("provider exploded");
    await tick();
    await tick();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auto_hydration_failure_counter_failed" }),
      expect.any(String),
    );
  });

  it("returns null and logs failed quality when the provider yields nothing despite text", async () => {
    textMock.mockResolvedValue(parseResult()); // no accepted rows and no structure blocks

    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      target,
      workoutOwner,
      UNITS,
      "workout",
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ qualityState: "failed" }),
      expect.any(String),
    );
    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", SUCCEEDED);
  });

  it("treats a missing count row as zero existing sets and proceeds", async () => {
    dbState.countMissing = true;
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));

    const result = await autoHydrateExerciseSetsFromTextIfNeeded(
      target,
      workoutOwner,
      UNITS,
      "workout",
    );

    expect(result).toMatchObject({ saved: true });
  });

  it("falls back to the manual source when the workout-log source row is missing", async () => {
    dbState.sourceMissing = true;
    textMock.mockResolvedValue(parseResult({ acceptedRows: [ex("squat")] }));

    await autoHydrateExerciseSetsFromTextIfNeeded(target, workoutOwner, UNITS, "workout");

    expect(counterMock).toHaveBeenCalledWith("workout_log", "manual", ATTEMPTED);
  });

  it("records failure telemetry for plan-day owners", async () => {
    textMock.mockRejectedValue(new Error("boom"));

    await expect(
      autoHydrateExerciseSetsFromTextIfNeeded(
        { id: "p1", mainWorkout: "x" },
        { planDayId: "p1" },
        UNITS,
        "plan",
      ),
    ).rejects.toThrow("boom");

    expect(counterMock).toHaveBeenCalledWith("plan_day", "manual", FAILED);
  });
});
