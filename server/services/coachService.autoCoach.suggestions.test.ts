import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import {
  generateWorkoutSuggestions,
  parseExercisesFromText,
  type TrainingContext,
} from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { triggerAutoCoach } from "./coachService";
import { dbMockState } from "./coachService.dbMockState";
import {
  makeSuggestion,
  makeTimelineEntry,
  mockBaseAutoCoachDeps,
} from "./coachService.testFixtures";
import { retrieveRelevantChunks } from "./ragService";

const HILL_REPEATS_WORKOUT = "Hill repeats 8x60 seconds";
const HILL_REPEAT_SET = {
  exerciseName: "hill_repeats",
  category: "running",
  setNumber: 1,
  time: 40,
  sortOrder: 0,
};

function expectPlanDayUpdate(planDayId: string, update: Record<string, unknown>) {
  expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
    planDayId,
    expect.objectContaining(update),
    "user-1",
    expect.anything(),
  );
}

function hillRepeatTimelineEntry() {
  return makeTimelineEntry({
    focus: "Run",
    mainWorkout: HILL_REPEATS_WORKOUT,
    exerciseDetails: [HILL_REPEAT_SET],
  });
}

function loadGovernorTrainingContext(): TrainingContext {
  return {
    totalWorkouts: 10,
    completedWorkouts: 10,
    plannedWorkouts: 1,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 100,
    currentStreak: 4,
    recentWorkouts: [],
    upcomingWorkouts: [
      {
        planDayId: "day-1",
        date: "2026-01-16",
        focus: "Run",
        mainWorkout: HILL_REPEATS_WORKOUT,
        exerciseDetails: [HILL_REPEAT_SET],
      },
    ],
    exerciseBreakdown: {},
    coachingInsights: {
      rpeTrend: "stable",
      fatigueFlag: false,
      undertrainingFlag: false,
      stationGaps: [],
      progressionFlags: [],
      loadGovernor: {
        currentUtss: 100,
        acuteAvg: 70,
        chronicAvg: 65,
        acwr: 1.08,
        zone: "sweet_spot",
        tsb: -5,
        monotony: 1.2,
        strain: 600,
        monotonyZone: "ok",
        trimp: null,
        tss: null,
        flaggedVectors: ["posterior_chain"],
        activeRestrictions: [
          {
            id: "posterior_chain_velocity_lock",
            label: "Posterior chain velocity lock",
            severity: "danger",
            expiresOn: "2026-01-17",
            vector: "posterior_chain",
            rationale: "Recent posterior-chain load conflicts with speed work.",
          },
        ],
        downshiftRationale: "Recent posterior-chain load conflicts with speed work.",
        trend: [],
      },
    },
  };
}

describe("coachService triggerAutoCoach suggestion application", () => {
  it("applies suggestions and returns adjusted count", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry(),
      makeTimelineEntry({
        planDayId: "day-2",
        date: "2026-01-17",
        focus: "Running",
        mainWorkout: "5km easy",
      }),
    ]);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
      id: "plan-1",
      goal: "Sub-90 Hyrox",
    });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion()]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expectPlanDayUpdate("day-1", {
      mainWorkout: "4x5 Squats @ 80%",
      aiSource: null,
      aiRationale: "Progressive overload",
      aiNoteUpdatedAt: new Date("2026-01-15T12:00:00Z"),
      aiInputsUsed: expect.objectContaining({ ragUsed: false }),
    });
  });

  it("uses RAG when chunks are available and dimensions match", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext);
    vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(true);
    vi.mocked(storage.coaching.getStoredEmbeddingDimension).mockResolvedValue(3072);
    vi.mocked(retrieveRelevantChunks).mockResolvedValue(["chunk 1", "chunk 2"]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ targetField: "notes", recommendation: "Focus on form", priority: "low" }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(retrieveRelevantChunks).toHaveBeenCalled();
    expectPlanDayUpdate("day-1", {
      notes: "Focus on form",
      aiSource: "rag",
      aiRationale: "Progressive overload",
      aiInputsUsed: expect.objectContaining({ ragUsed: true }),
    });
  });

  it("falls back to legacy when RAG dimension mismatch occurs", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ focus: "Running", mainWorkout: "5km" }),
    ]);
    vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(true);
    vi.mocked(storage.coaching.getStoredEmbeddingDimension).mockResolvedValue(1536);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
  });

  it("handles append action by prefixing with [AI Coach]", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ accessory: "Leg Press" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        targetField: "accessory",
        action: "append",
        recommendation: "Add 3x10 calf raises",
      }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expectPlanDayUpdate("day-1", {
      accessory: "Leg Press\n[AI Coach] Add 3x10 calf raises",
      aiSource: null,
      aiRationale: "Progressive overload",
    });
  });

  it("falls back to text-field writes when structured recommendation parsing returns no exercises", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        exerciseDetails: [
          {
            exerciseName: "deadlift",
            category: "strength",
            setNumber: 1,
            reps: 3,
            weight: 140,
            sortOrder: 0,
          },
        ],
      }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ recommendation: "Keep this lighter today" }),
    ]);
    vi.mocked(parseExercisesFromText).mockResolvedValue([]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(dbMockState.insertValues).not.toHaveBeenCalled();
    expectPlanDayUpdate("day-1", {
      mainWorkout: "Keep this lighter today",
      aiRationale: "Progressive overload",
    });
  });

  it("keeps notes suggestions as text writes for table-backed workouts", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        exerciseDetails: [
          {
            exerciseName: "deadlift",
            category: "strength",
            setNumber: 1,
            reps: 3,
            weight: 140,
            sortOrder: 0,
          },
        ],
      }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ targetField: "notes", recommendation: "Keep two reps in reserve." }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(dbMockState.insertValues).not.toHaveBeenCalled();
    expectPlanDayUpdate("day-1", {
      notes: "Keep two reps in reserve.",
      aiRationale: "Progressive overload",
    });
  });

  it("applies load-governor suggestions through structured rows before provider suggestions", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      hillRepeatTimelineEntry(),
    ]);
    vi.mocked(buildTrainingContext).mockResolvedValue(loadGovernorTrainingContext());
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ recommendation: "Keep the hill repeats hard." }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(dbMockState.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        planDayId: "day-1",
        exerciseName: "recovery_run",
        category: "running",
      }),
    ]);
    expectPlanDayUpdate("day-1", {
      // Title, main, and accessory/notes are all reconciled to the recovery run
      // so no remnants of the original "Run" session linger.
      focus: "Recovery Run",
      mainWorkout: expect.stringContaining("aerobic run"),
      accessory: null,
      notes: null,
      aiSource: "load_governor",
      aiRationale: expect.stringContaining("posterior-chain"),
      aiInputsUsed: expect.objectContaining({
        loadGovernorAcwrZone: "sweet_spot",
        loadGovernorFlaggedVectors: ["posterior_chain"],
        // The original prescription is kept as an "Originally planned" record.
        replacedPrescription: expect.objectContaining({
          focus: "Run",
          mainWorkout: HILL_REPEATS_WORKOUT,
        }),
      }),
    });
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({ mainWorkout: "Keep the hill repeats hard." }),
      "user-1",
      expect.anything(),
    );
  });

  it("does not rename or re-snapshot when converting an already-converted day", async () => {
    const base = loadGovernorTrainingContext();
    const context: TrainingContext = {
      ...base,
      upcomingWorkouts: [
        {
          ...base.upcomingWorkouts[0],
          focus: "Recovery Run",
          aiInputsUsed: {
            replacedPrescription: { focus: "Run", mainWorkout: "Original hill session" },
          },
        },
      ],
    };
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [hillRepeatTimelineEntry()]);
    vi.mocked(buildTrainingContext).mockResolvedValue(context);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });

    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    // Title already equals the override → no rename.
    expect(updatePayload).not.toHaveProperty("focus");
    // The first conversion's record is preserved, not overwritten with the run.
    expect(updatePayload.aiInputsUsed).toEqual(
      expect.objectContaining({
        replacedPrescription: { focus: "Run", mainWorkout: "Original hill session" },
      }),
    );
    // Free text is still re-reconciled to the recovery run on every apply.
    expect(updatePayload.mainWorkout).toEqual(expect.stringContaining("aerobic run"));
    expect(updatePayload.accessory).toBeNull();
    expect(updatePayload.notes).toBeNull();
  });

  it("does not fall back to text when a load-governor structured write fails", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      hillRepeatTimelineEntry(),
    ]);
    vi.mocked(buildTrainingContext).mockResolvedValue(loadGovernorTrainingContext());
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);
    dbMockState.insertValues.mockRejectedValueOnce(new Error("structured write failed"));

    await expect(triggerAutoCoach("user-1")).rejects.toThrow("structured write failed");
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({ mainWorkout: expect.any(String) }),
      "user-1",
      expect.anything(),
    );
  });
});
