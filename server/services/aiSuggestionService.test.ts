import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseExercisesFromText } from "../gemini/index";
import { storage } from "../storage";
import { applyTimelineAiSuggestion } from "./aiSuggestionService";

const dbMockState = vi.hoisted(() => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const selectWhere = vi.fn().mockResolvedValue([{ maxSortOrder: 2 }]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({ from: selectFrom })),
  };
  return { deleteWhere, insertValues, selectWhere, tx };
});

vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
    },
    workouts: {
      getExerciseSetsByPlanDay: vi.fn(),
    },
    plans: {
      getPlanDay: vi.fn(),
      updatePlanDay: vi.fn(),
    },
    timeline: {
      getUpcomingPlannedDays: vi.fn(),
    },
    aiUsage: {
      getDailyTotalCents: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn(dbMockState.tx as unknown)),
  },
}));

vi.mock("../gemini/index", () => ({
  generateWorkoutSuggestions: vi.fn(),
  parseExercisesFromText: vi.fn(),
}));

vi.mock("./aiContextService", () => ({
  buildAIContext: vi.fn(),
  extractCoachingMaterialsText: vi.fn(),
}));

vi.mock("./ragRetrieval", () => ({
  sanitizeRagInfo: vi.fn((ragInfo) => ragInfo),
}));

type ParsedExerciseLike = {
  exerciseName: string;
  category: string;
  sets?: Array<{ reps?: number; weight?: number }>;
};

vi.mock("./workoutService", () => ({
  expandExercisesToPlanDaySetRows: vi.fn((exercises: ParsedExerciseLike[], planDayId: string) =>
    exercises.flatMap((exercise) =>
      (exercise.sets && exercise.sets.length > 0 ? exercise.sets : [{}]).map((set, index) => ({
        workoutLogId: null,
        planDayId,
        exerciseName: exercise.exerciseName,
        category: exercise.category,
        setNumber: index + 1,
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        sortOrder: index,
      })),
    ),
  ),
}));

vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const testLog = { warn: vi.fn() } as never;

function mockPlanDay(overrides: Record<string, unknown> = {}) {
  return {
    id: "day-1",
    mainWorkout: "Old main",
    accessory: "Old accessory",
    notes: null,
    ...overrides,
  };
}

describe("applyTimelineAiSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMockState.deleteWhere.mockResolvedValue(undefined);
    dbMockState.insertValues.mockResolvedValue(undefined);
    dbMockState.selectWhere.mockResolvedValue([{ maxSortOrder: 2 }]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(mockPlanDay() as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({ weightUnit: "lb" } as never);
    vi.mocked(storage.aiUsage.getDailyTotalCents).mockResolvedValue(0);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([
      { id: "set-1", planDayId: "day-1", workoutLogId: null, exerciseName: "back_squat" },
    ] as never);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);
  });

  it("writes structured rows when applying a suggestion to a table-backed day", async () => {
    vi.mocked(parseExercisesFromText).mockResolvedValue([
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { reps: 5, weight: 205 },
          { reps: 5, weight: 205 },
        ],
      },
    ] as never);

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Back squat 2x5 at 205 lb",
        rationale: "Load is trending well",
        aiSource: "rag",
      },
      testLog,
    );

    expect(result).toEqual({ applied: true, structured: true });
    expect(parseExercisesFromText).toHaveBeenCalledWith(
      "Back squat 2x5 at 205 lb",
      "lb",
      undefined,
      "user-1",
    );
    expect(dbMockState.deleteWhere).toHaveBeenCalled();
    expect(dbMockState.insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ planDayId: "day-1", workoutLogId: null, exerciseName: "back_squat" }),
      ]),
    );
    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty("mainWorkout");
    expect(updatePayload).toEqual(expect.objectContaining({
      aiSource: "rag",
      aiRationale: "Load is trending well",
      aiNoteUpdatedAt: expect.any(Date),
    }));
  });

  it("falls back to text updates when the day is not table-backed", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([] as never);
    vi.mocked(storage.aiUsage.getDailyTotalCents).mockResolvedValue(200);

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "accessory",
        action: "append",
        recommendation: "Add calf raises",
        rationale: "Build lower leg durability",
        aiSource: "none",
      },
      testLog,
    );

    expect(result).toEqual({ applied: true, structured: false });
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(storage.aiUsage.getDailyTotalCents).not.toHaveBeenCalled();
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        accessory: "Old accessory\n\nAI suggestion: Add calf raises",
        aiSource: null,
        aiRationale: "Build lower leg durability",
      }),
      "user-1",
    );
  });

  it("leaves table-backed days unchanged when structured parsing returns no rows", async () => {
    vi.mocked(parseExercisesFromText).mockResolvedValue([] as never);

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Keep this easier today",
        rationale: "Fatigue is elevated",
        aiSource: "rag",
      },
      testLog,
    );

    expect(result).toEqual({
      applied: false,
      structured: false,
      reason: "structured_parse_failed",
      message: expect.stringContaining("left the table-backed workout unchanged"),
    });
    expect(dbMockState.deleteWhere).not.toHaveBeenCalled();
    expect(dbMockState.insertValues).not.toHaveBeenCalled();
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
  });

  it("leaves table-backed days unchanged when structured parsing is over budget", async () => {
    vi.mocked(storage.aiUsage.getDailyTotalCents).mockResolvedValue(200);

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "accessory",
        action: "append",
        recommendation: "Walking lunges 2x20m",
        rationale: "Add station durability",
        aiSource: "rag",
      },
      testLog,
    );

    expect(result).toEqual({
      applied: false,
      structured: false,
      reason: "ai_budget_exceeded",
      message: expect.stringContaining("daily AI limit"),
    });
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
  });
});
