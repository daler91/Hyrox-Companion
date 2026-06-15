import type { ParsedExercise, StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { AppError } from "../../errors";
import { logger } from "../../logger";
import { storage } from "../../storage";
import {
  deriveMissingPlanDaySetsFromStructure,
  deriveMissingWorkoutSetsFromStructure,
  replacePlanDayStructure,
  resolveStructureBlocksForPersist,
  resolveStructureStepTimeTarget,
  shouldDeriveStructureExerciseSets,
  structureReplacementOptions,
  updateWorkoutStructureBlockScore,
} from "./structure";

// Isolate the unit: structure.ts pulls in db/storage at import time, the
// legacy-synthesis path logs a warning we assert on, and the exported async
// helpers exercise db/storage guards we drive through these mocks.
vi.mock("../../db", () => ({ db: { transaction: vi.fn(), select: vi.fn(), update: vi.fn() } }));
vi.mock("../../storage", () => ({
  storage: {
    plans: { getPlanDay: vi.fn() },
    workouts: {
      getWorkoutLog: vi.fn(),
      getWorkoutStructureByPlanDay: vi.fn(),
      getWorkoutStructureByWorkoutLog: vi.fn(),
      getExerciseSetsByPlanDay: vi.fn(),
    },
  },
}));
vi.mock("../../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type StepTargets = StructureBlockInput["steps"][number]["targets"];

// Cast helper so the runtime type guards can be exercised with values the
// static type would reject: strings, NaN, and non-object inputs.
function targets(value: unknown): StepTargets {
  return value as StepTargets;
}

function makeParsed(overrides: Partial<ParsedExercise> = {}): ParsedExercise {
  return {
    exerciseName: "burpees",
    category: "functional",
    sets: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldDeriveStructureExerciseSets", () => {
  it("derives when there are no explicit sets", () => {
    expect(shouldDeriveStructureExerciseSets(0)).toBe(true);
  });

  it("derives when the count is negative", () => {
    expect(shouldDeriveStructureExerciseSets(-3)).toBe(true);
  });

  it("does not derive when explicit sets exist", () => {
    expect(shouldDeriveStructureExerciseSets(1)).toBe(false);
    expect(shouldDeriveStructureExerciseSets(25)).toBe(false);
  });
});

describe("structureReplacementOptions", () => {
  it("enables derivation when there are no explicit sets", () => {
    expect(structureReplacementOptions(0)).toEqual({ deriveExerciseSets: true });
  });

  it("disables derivation when explicit sets exist", () => {
    expect(structureReplacementOptions(4)).toEqual({ deriveExerciseSets: false });
  });
});

describe("resolveStructureStepTimeTarget", () => {
  it("returns null for null targets", () => {
    expect(resolveStructureStepTimeTarget(null)).toBeNull();
  });

  it("returns null for undefined targets", () => {
    expect(resolveStructureStepTimeTarget(undefined)).toBeNull();
  });

  it("returns null for a non-object value", () => {
    expect(resolveStructureStepTimeTarget(targets(42))).toBeNull();
  });

  it("returns null when no time-like key is present", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetReps: 10 }))).toBeNull();
  });

  it("reads targetTime", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetTime: 90 }))).toBe(90);
  });

  it("falls back to time", () => {
    expect(resolveStructureStepTimeTarget(targets({ time: 45 }))).toBe(45);
  });

  it("falls back to durationSeconds (passthrough key)", () => {
    expect(resolveStructureStepTimeTarget(targets({ durationSeconds: 120 }))).toBe(120);
  });

  it("prefers targetTime over time and durationSeconds", () => {
    expect(
      resolveStructureStepTimeTarget(targets({ targetTime: 90, time: 45, durationSeconds: 30 })),
    ).toBe(90);
  });

  it("skips a null candidate and uses the next key", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetTime: null, time: 45 }))).toBe(45);
  });

  it("skips a non-finite candidate and uses the next key", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetTime: Number.NaN, time: 45 }))).toBe(45);
  });

  it("returns null when the only candidate is non-finite", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetTime: Infinity }))).toBeNull();
  });

  it("treats zero as a valid time", () => {
    expect(resolveStructureStepTimeTarget(targets({ time: 0 }))).toBe(0);
  });

  it("ignores a non-numeric candidate", () => {
    expect(resolveStructureStepTimeTarget(targets({ targetTime: "90" }))).toBeNull();
  });
});

describe("resolveStructureBlocksForPersist", () => {
  const baseArgs = { workoutSource: "manual", workoutLogId: "wl-1" };

  it("passes through an explicit (structure editor) block array", () => {
    const blocks = [
      { sectionType: "main", formatType: "steady", steps: [] },
    ] as unknown as StructureBlockInput[];
    const result = resolveStructureBlocksForPersist({
      ...baseArgs,
      structureBlocks: blocks,
      exercises: undefined,
    });
    expect(result.source).toBe("structure_editor");
    expect(result.blocks).toBe(blocks);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("treats an empty block array as an explicit (structure editor) payload", () => {
    const result = resolveStructureBlocksForPersist({
      ...baseArgs,
      structureBlocks: [],
      exercises: undefined,
    });
    expect(result).toEqual({ blocks: [], source: "structure_editor" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("synthesizes a single steady main block from legacy exercises and warns", () => {
    const exercises = [
      makeParsed({ exerciseName: "wall_balls", category: "functional" }),
      makeParsed({
        exerciseName: "rowing",
        category: "functional",
        stepRole: "fast",
        customLabel: "Row hard",
        groupId: "g1",
      }),
    ];
    const result = resolveStructureBlocksForPersist({
      ...baseArgs,
      structureBlocks: undefined,
      exercises,
    });

    expect(result.source).toBe("legacy_synthesized");
    expect(result.blocks).toEqual([
      {
        sectionType: "main",
        formatType: "steady",
        sortOrder: 0,
        steps: [
          {
            stepNumber: 1,
            exerciseName: "wall_balls",
            category: "functional",
            customLabel: null,
            stepType: "work",
            stepRole: "steady",
            groupId: null,
            groupMeta: null,
            targets: null,
          },
          {
            stepNumber: 2,
            exerciseName: "rowing",
            category: "functional",
            customLabel: "Row hard",
            stepType: "work",
            stepRole: "fast",
            groupId: "g1",
            groupMeta: null,
            targets: null,
          },
        ],
      },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "legacy_structure_synthesis_used", workoutLogId: "wl-1" }),
      expect.any(String),
    );
  });

  it("returns 'none' when neither structure blocks nor exercises are provided", () => {
    const result = resolveStructureBlocksForPersist({
      ...baseArgs,
      structureBlocks: undefined,
      exercises: undefined,
    });
    expect(result).toEqual({ blocks: undefined, source: "none" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns 'none' for an empty legacy exercise list (no synthesis, no warning)", () => {
    const result = resolveStructureBlocksForPersist({
      ...baseArgs,
      structureBlocks: undefined,
      exercises: [],
    });
    expect(result).toEqual({ blocks: undefined, source: "none" });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

const AMRAP_SCORE: StructureBlockScore = { type: "amrap", rounds: 5 };

// Stubs the owned-block lookup query chain used by updateWorkoutStructureBlockScore.
// Built bottom-up so each link is its own function rather than a deeply nested literal.
function mockBlockLookup(rows: unknown[]): void {
  const limit = () => Promise.resolve(rows);
  const where = () => ({ limit });
  const innerJoin = () => ({ where });
  const from = () => ({ innerJoin });
  vi.mocked(db.select).mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
}

describe("updateWorkoutStructureBlockScore", () => {
  it("returns null when the block is not found or not owned by the user", async () => {
    mockBlockLookup([]);
    expect(await updateWorkoutStructureBlockScore("w1", "b1", "user-1", null)).toBeNull();
  });

  it("throws a validation error when the score type does not match the block format", async () => {
    mockBlockLookup([{ id: "b1", formatType: "emom" }]);
    await expect(
      updateWorkoutStructureBlockScore("w1", "b1", "user-1", AMRAP_SCORE),
    ).rejects.toThrow(AppError);
  });

  it("persists a matching score and returns the refreshed structure", async () => {
    mockBlockLookup([{ id: "b1", formatType: "amrap" }]);
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.update).mockReturnValue({
      set: () => ({ where }),
    } as unknown as ReturnType<typeof db.update>);
    const refreshed = [{ sectionType: "main" }] as unknown as StructureBlockInput[];
    vi.mocked(storage.workouts.getWorkoutStructureByWorkoutLog).mockResolvedValue(refreshed);

    const result = await updateWorkoutStructureBlockScore("w1", "b1", "user-1", AMRAP_SCORE);

    expect(where).toHaveBeenCalledTimes(1);
    expect(result).toBe(refreshed);
  });
});

describe("replacePlanDayStructure", () => {
  it("returns null and skips the transaction when the plan day is missing", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(undefined);
    expect(await replacePlanDayStructure("pd1", "user-1", [])).toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("deriveMissingPlanDaySetsFromStructure", () => {
  it("returns null when the plan day is missing", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(undefined);
    expect(await deriveMissingPlanDaySetsFromStructure("pd1", "user-1")).toBeNull();
  });
});

describe("deriveMissingWorkoutSetsFromStructure", () => {
  it("returns null when the workout log is missing", async () => {
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(undefined);
    expect(await deriveMissingWorkoutSetsFromStructure("w1", "user-1")).toBeNull();
  });
});
