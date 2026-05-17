import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateWorkoutSuggestions, parseExercisesFromText } from "../gemini/index";
import { storage } from "../storage";
import { buildAIContext, extractCoachingMaterialsText } from "./aiContextService";
import { buildWorkoutPrescriptionFingerprint } from "./aiModificationGuard";
import { applyTimelineAiSuggestion, generateTimelineAiSuggestions } from "./aiSuggestionService";

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
    transaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(dbMockState.tx as unknown)),
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

const testLog = { error: vi.fn(), warn: vi.fn() };

function mockPlanDay(overrides: Record<string, unknown> = {}) {
  return {
    id: "day-1",
    mainWorkout: "Old main",
    accessory: "Old accessory",
    notes: null,
    ...overrides,
  };
}

function textWorkoutFingerprint(
  mainWorkout: string,
  accessory?: string | null,
  notes?: string | null,
) {
  return buildWorkoutPrescriptionFingerprint({ mainWorkout, accessory, notes });
}

function makePlannedDay(overrides: Record<string, unknown> = {}) {
  return {
    planDayId: "day-1",
    date: "2026-05-02",
    focus: "strength",
    mainWorkout: "Back squat 3x5",
    accessory: null,
    notes: null,
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    exerciseSets: [],
    ...overrides,
  };
}

function makeCoachingInsights(overrides: Record<string, unknown> = {}) {
  return {
    rpeTrend: "rising",
    fatigueFlag: true,
    undertrainingFlag: false,
    stationGaps: [],
    progressionFlags: [],
    ...overrides,
  };
}

function makeTrainingContext(overrides: Record<string, unknown> = {}) {
  return {
    totalWorkouts: 12,
    completedWorkouts: 12,
    plannedWorkouts: 1,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 100,
    currentStreak: 4,
    recentWorkouts: [],
    exerciseBreakdown: {},
    coachingInsights: makeCoachingInsights(),
    ...overrides,
  };
}

function makeFatigueReduction(mainWorkout: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "fatigue_volume_reduction" as const,
    completedWorkoutCount: 12,
    fatigueFlag: true,
    rpeTrend: "rising" as const,
    prescriptionFingerprint: textWorkoutFingerprint(mainWorkout),
    ...overrides,
  };
}

function makeWorkoutSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    workoutId: "day-1",
    workoutDate: "2026-05-02",
    workoutFocus: "strength",
    targetField: "mainWorkout",
    action: "replace",
    recommendation: "Back squat 2x5 lighter",
    rationale: "Reduce volume because RPE and fatigue remain high.",
    priority: "high",
    ...overrides,
  };
}

function mockUpcomingDay(overrides: Record<string, unknown> = {}) {
  vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([makePlannedDay(overrides)]);
}

function mockAIContext(overrides: Record<string, unknown> = {}) {
  vi.mocked(buildAIContext).mockResolvedValue({
    trainingContext: makeTrainingContext(overrides),
    ragInfo: { source: "none" },
  });
}

describe("applyTimelineAiSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMockState.deleteWhere.mockResolvedValue(undefined);
    dbMockState.insertValues.mockResolvedValue(undefined);
    dbMockState.selectWhere.mockResolvedValue([{ maxSortOrder: 2 }]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(mockPlanDay());
    vi.mocked(storage.users.getUser).mockResolvedValue({ weightUnit: "lb", distanceUnit: "miles" });
    vi.mocked(storage.aiUsage.getDailyTotalCents).mockResolvedValue(0);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([
      { id: "set-1", planDayId: "day-1", workoutLogId: null, exerciseName: "back_squat" },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});
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
    ]);

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
      { weightUnit: "lb", distanceUnit: "miles" },
      undefined,
      "user-1",
    );
    expect(dbMockState.deleteWhere).toHaveBeenCalled();
    expect(dbMockState.insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          planDayId: "day-1",
          workoutLogId: null,
          exerciseName: "back_squat",
        }),
      ]),
    );
    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updatePayload).not.toHaveProperty("mainWorkout");
    expect(updatePayload).toEqual(
      expect.objectContaining({
        aiSource: "rag",
        aiRationale: "Load is trending well",
        aiNoteUpdatedAt: expect.any(Date),
      }),
    );
  });

  it("falls back to text updates when the day is not table-backed", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
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

  it("stores fatigue-reduction metadata when applying a workload suggestion", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(
      mockPlanDay({
        aiInputsUsed: {
          fatigueFlag: true,
          rpeTrend: "rising",
          completedWorkoutCount: 12,
          recommendationTrace: {
            trainingStyleId: "balanced_default",
            phase: "build",
            strategyRuleVersion: "training-decision-engine@v1",
            promptBundleVersion: "timeline-suggestion@v1",
          },
        },
      }),
    );

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Back squat 2x5 lighter",
        rationale: "Reduce volume because RPE is rising and fatigue is elevated.",
        aiSource: "rag",
      },
      testLog,
    );

    expect(result).toEqual({ applied: true, structured: false });
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        mainWorkout: "Back squat 2x5 lighter",
        aiInputsUsed: expect.objectContaining({
          lastModification: expect.objectContaining({
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 12,
            fatigueFlag: true,
            rpeTrend: "rising",
            prescriptionFingerprint: textWorkoutFingerprint(
              "Back squat 2x5 lighter",
              "Old accessory",
            ),
          }),
          lastFatigueReduction: expect.objectContaining({
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 12,
            prescriptionFingerprint: textWorkoutFingerprint(
              "Back squat 2x5 lighter",
              "Old accessory",
            ),
          }),
        }),
      }),
      "user-1",
    );
  });

  it("preserves the fatigue-reduction marker when applying a non-fatigue workload suggestion", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
    const priorFatigueReduction = {
      kind: "fatigue_volume_reduction" as const,
      completedWorkoutCount: 12,
      fatigueFlag: true,
      rpeTrend: "rising" as const,
      prescriptionFingerprint: textWorkoutFingerprint("Old main"),
    };
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(
      mockPlanDay({
        aiInputsUsed: {
          fatigueFlag: true,
          rpeTrend: "rising",
          completedWorkoutCount: 12,
          lastFatigueReduction: priorFatigueReduction,
        },
      }),
    );

    const result = await applyTimelineAiSuggestion(
      "user-1",
      {
        workoutId: "day-1",
        targetField: "mainWorkout",
        action: "replace",
        recommendation: "Old main plus sled push 4x20m",
        rationale: "Sled Push has not been trained recently.",
        aiSource: "rag",
      },
      testLog,
    );

    expect(result).toEqual({ applied: true, structured: false });
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        aiInputsUsed: expect.objectContaining({
          lastModification: expect.objectContaining({
            kind: "workload_adjustment",
            reason: "Sled Push has not been trained recently.",
          }),
          lastFatigueReduction: priorFatigueReduction,
        }),
      }),
      "user-1",
    );
  });

  it("leaves table-backed days unchanged when structured parsing returns no rows", async () => {
    vi.mocked(parseExercisesFromText).mockResolvedValue([]);

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

describe("generateTimelineAiSuggestions safety surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpcomingDay({ focus: "run", mainWorkout: "easy run", notes: "chest pain during warmup" });
    vi.mocked(storage.users.getUser).mockResolvedValue({ trainingStyleId: null, weightUnit: "kg" });
    mockAIContext({
      totalWorkouts: 0,
      completedWorkouts: 0,
      plannedWorkouts: 0,
      completionRate: 0,
      currentStreak: 0,
      coachingInsights: undefined,
    });
    vi.mocked(extractCoachingMaterialsText).mockReturnValue(undefined);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);
  });

  it("returns a surfaced safety suggestion when forced alert exists and model suggestions are empty", async () => {
    const result = await generateTimelineAiSuggestions("user-1", testLog);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        workoutId: "day-1",
        targetField: "notes",
        action: "append",
        priority: "high",
      }),
    );
    expect(result.message).toMatch(/potentially serious medical issue/i);
  });

  it("suppresses repeat fatigue reductions when the plan day already has the same fatigue adjustment", async () => {
    mockUpcomingDay({
      aiSource: "rag",
      aiRationale: "Reduced from 5x5 because RPE was high.",
      aiNoteUpdatedAt: new Date("2026-05-01T12:00:00Z"),
      aiInputsUsed: {
        lastFatigueReduction: makeFatigueReduction("Back squat 3x5", {
          reason: "Reduced from 5x5 because RPE was high.",
        }),
      },
    });
    mockAIContext();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeWorkoutSuggestion()]);

    const result = await generateTimelineAiSuggestions("user-1", testLog);

    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/already reflects the prior fatigue adjustment/i);
  });

  it("does not suppress fatigue reductions after the current workout prescription changes", async () => {
    mockUpcomingDay({
      mainWorkout: "Back squat 5x5",
      aiSource: "rag",
      aiRationale: "Reduced from 5x5 because RPE was high.",
      aiNoteUpdatedAt: new Date("2026-05-01T12:00:00Z"),
      aiInputsUsed: {
        lastFatigueReduction: makeFatigueReduction("Back squat 3x5", {
          reason: "Reduced from 5x5 because RPE was high.",
        }),
      },
    });
    mockAIContext();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeWorkoutSuggestion({
        recommendation: "Back squat 3x5 again",
      }),
    ]);

    const result = await generateTimelineAiSuggestions("user-1", testLog);

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        workoutId: "day-1",
        recommendation: "Back squat 3x5 again",
      }),
    ]);
  });

  it("still surfaces non-fatigue adjustments on a previously fatigue-reduced day", async () => {
    mockUpcomingDay({
      aiSource: "rag",
      aiRationale: "Reduced from 5x5 because RPE was high.",
      aiNoteUpdatedAt: new Date("2026-05-01T12:00:00Z"),
      aiInputsUsed: {
        lastFatigueReduction: makeFatigueReduction("Back squat 3x5"),
      },
    });
    mockAIContext({
      coachingInsights: makeCoachingInsights({
        stationGaps: [{ station: "Sled Push", daysSinceLastTrained: 20 }],
      }),
    });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeWorkoutSuggestion({
        recommendation: "Back squat 3x5 then sled push 4x20m",
        rationale: "Sled Push has not been trained in 20 days.",
        priority: "medium",
      }),
    ]);

    const result = await generateTimelineAiSuggestions("user-1", testLog);

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        workoutId: "day-1",
        recommendation: "Back squat 3x5 then sled push 4x20m",
      }),
    ]);
  });
});
