import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { generateReviewNotes, generateWorkoutSuggestions, parseExercisesFromText } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { regenerateCoachNoteForPlanDay, triggerAutoCoach } from "./coachService";
import { retrieveRelevantChunks } from "./ragService";

const dbMockState = vi.hoisted(() => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const selectWhere = vi.fn().mockResolvedValue([{ maxSortOrder: 1 }]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({ from: selectFrom })),
  };
  return { deleteWhere, insertValues, selectFrom, selectWhere, tx };
});

vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
      updateIsAutoCoaching: vi.fn(),
    },
    workouts: {
      getExerciseSetsByPlanDay: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getActivePlan: vi.fn(),
      getPlanDay: vi.fn(),
      updatePlanDay: vi.fn(),
    },
    timeline: {
      getTimeline: vi.fn(),
    },
    coaching: {
      hasChunksForUser: vi.fn(),
      getStoredEmbeddingDimension: vi.fn(),
      listCoachingMaterials: vi.fn(),
    },
    aiUsage: {
      getDailyTotalCents: vi.fn().mockResolvedValue(0),
    },
  },
}));

// db.transaction is a thin wrapper; invoke the callback with a sentinel tx
// so tests don't need a live Postgres to exercise the C2 atomic apply path.
vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn(dbMockState.tx as unknown)),
  },
}));

vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("../gemini/index", () => ({
  generateWorkoutSuggestions: vi.fn(),
  generateReviewNotes: vi.fn().mockResolvedValue([]),
  parseExercisesFromText: vi.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));
vi.mock("./ragService", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("../prompts", () => ({ buildCoachingMaterialsSection: vi.fn().mockReturnValue(""), buildRetrievedChunksSection: vi.fn().mockReturnValue("[RAG chunks]"), FUNCTIONAL_EXERCISES: ["skierg", "sled_push", "sled_pull", "burpee_broad_jump", "rowing", "farmers_carry", "sandbag_lunges", "wall_balls"] }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// -- Helpers ------------------------------------------------------------------

function mockEnabledUser() {
  vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true, isAutoCoaching: false } as never);
  vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);
}

function makeTimelineEntry(overrides: Record<string, unknown> = {}) {
  return { status: "planned", date: "2026-01-16", planDayId: "day-1", focus: "Strength", mainWorkout: "3x5 Squats", accessory: null, notes: null, ...overrides };
}

function mockBaseAutoCoachDeps(timeline: Record<string, unknown>[] = [makeTimelineEntry()]) {
  mockEnabledUser();
  // buildTrainingContext now provides upcoming workouts (with planDayId)
  // that triggerAutoCoach maps into the suggestion generator's format.
  const upcomingWorkouts = timeline
    .filter((e) => e.status === "planned" && e.planDayId)
    .map((e) => ({
      planDayId: e.planDayId as string,
      date: e.date as string,
      focus: e.focus as string,
      mainWorkout: e.mainWorkout as string,
      accessory: e.accessory as string | null,
      notes: e.notes as string | null,
      ...(Array.isArray(e.exerciseDetails) ? { exerciseDetails: e.exerciseDetails } : {}),
    }));
  vi.mocked(buildTrainingContext).mockResolvedValue({ upcomingWorkouts } as never);
  vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(false);
  vi.mocked(storage.coaching.listCoachingMaterials).mockResolvedValue([]);
}

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    workoutId: "day-1", workoutDate: "2026-01-16", workoutFocus: "Strength",
    targetField: "mainWorkout", action: "replace", recommendation: "4x5 Squats @ 80%",
    rationale: "Progressive overload", priority: "high", ...overrides,
  };
}

// -- Tests --------------------------------------------------------------------

describe("coachService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMockState.deleteWhere.mockResolvedValue(undefined);
    dbMockState.insertValues.mockResolvedValue(undefined);
    dbMockState.selectWhere.mockResolvedValue([{ maxSortOrder: 1 }]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("triggerAutoCoach", () => {
    it("returns 0 and resets flag when user has aiCoachEnabled=false", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: false } as never);
      vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("returns 0 and resets flag when user is not found", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
      vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("returns 0 when no upcoming planned workouts exist", async () => {
      mockBaseAutoCoachDeps([]);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("applies suggestions and returns adjusted count", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry(), makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17", focus: "Running", mainWorkout: "5km easy" })]);
      vi.mocked(storage.plans.getActivePlan).mockResolvedValue({ id: "plan-1", goal: "Sub-90 Hyrox" } as never);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion()]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        expect.objectContaining({
          mainWorkout: "4x5 Squats @ 80%",
          aiSource: null,
          aiRationale: "Progressive overload",
          aiNoteUpdatedAt: new Date("2026-01-15T12:00:00Z"),
          aiInputsUsed: expect.objectContaining({ ragUsed: false }),
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("uses RAG when chunks are available and dimensions match", async () => {
      mockBaseAutoCoachDeps();
      vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.coaching.getStoredEmbeddingDimension).mockResolvedValue(3072);
      vi.mocked(retrieveRelevantChunks).mockResolvedValue(["chunk 1", "chunk 2"]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion({ targetField: "notes", recommendation: "Focus on form", priority: "low" })]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(retrieveRelevantChunks).toHaveBeenCalled();
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        expect.objectContaining({
          notes: "Focus on form",
          aiSource: "rag",
          aiRationale: "Progressive overload",
          aiInputsUsed: expect.objectContaining({ ragUsed: true }),
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("falls back to legacy when RAG dimension mismatch occurs", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ focus: "Running", mainWorkout: "5km" })]);
      vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.coaching.getStoredEmbeddingDimension).mockResolvedValue(1536);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    });

    it("handles append action by prefixing with [AI Coach]", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ accessory: "Leg Press" })]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ targetField: "accessory", action: "append", recommendation: "Add 3x10 calf raises" }),
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        expect.objectContaining({
          accessory: "Leg Press\n[AI Coach] Add 3x10 calf raises",
          aiSource: null,
          aiRationale: "Progressive overload",
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("replaces structured plan-day exercises before falling back to text fields", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({
          exerciseDetails: [
            { exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5, weight: 100, sortOrder: 0 },
          ],
        }),
      ]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ recommendation: "Back squat 3x5 at 105kg" }),
      ]);
      vi.mocked(parseExercisesFromText).mockResolvedValue([
        {
          exerciseName: "back_squat",
          category: "strength",
          confidence: 95,
          sets: [
            { setNumber: 1, reps: 5, weight: 105 },
            { setNumber: 2, reps: 5, weight: 105 },
            { setNumber: 3, reps: 5, weight: 105 },
          ],
        },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(parseExercisesFromText).toHaveBeenCalledWith("Back squat 3x5 at 105kg", "kg", undefined, "user-1");
      expect(dbMockState.deleteWhere).toHaveBeenCalled();
      expect(dbMockState.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            planDayId: "day-1",
            workoutLogId: null,
            exerciseName: "back_squat",
            reps: 5,
            weight: 105,
            sortOrder: 0,
          }),
        ]),
      );
      const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<string, unknown>;
      expect(updatePayload).not.toHaveProperty("mainWorkout");
      expect(updatePayload).not.toHaveProperty("accessory");
      expect(updatePayload).toEqual(expect.objectContaining({ aiRationale: "Progressive overload" }));
    });

    it("appends parsed structured suggestions after existing plan-day rows", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({
          exerciseDetails: [
            { exerciseName: "deadlift", category: "strength", setNumber: 1, reps: 3, weight: 140, sortOrder: 0 },
          ],
        }),
      ]);
      dbMockState.selectWhere.mockResolvedValue([{ maxSortOrder: 4 }]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({
          targetField: "accessory",
          action: "append",
          recommendation: "Walking lunges 2x20m",
        }),
      ]);
      vi.mocked(parseExercisesFromText).mockResolvedValue([
        {
          exerciseName: "walking_lunges",
          category: "conditioning",
          confidence: 90,
          sets: [
            { setNumber: 1, distance: 20 },
            { setNumber: 2, distance: 20 },
          ],
        },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(dbMockState.deleteWhere).not.toHaveBeenCalled();
      expect(dbMockState.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 5 }),
          expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 6 }),
        ]),
      );
      const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<string, unknown>;
      expect(updatePayload).not.toHaveProperty("accessory");
      expect(updatePayload).toEqual(expect.objectContaining({ aiRationale: "Progressive overload" }));
    });

    it("serializes duplicate structured appends so sort orders do not collide", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({
          exerciseDetails: [
            { exerciseName: "deadlift", category: "strength", setNumber: 1, reps: 3, weight: 140, sortOrder: 0 },
          ],
        }),
      ]);
      dbMockState.selectWhere.mockImplementation(() =>
        Promise.resolve([{ maxSortOrder: 4 + dbMockState.insertValues.mock.calls.length }]),
      );
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({
          targetField: "accessory",
          action: "append",
          recommendation: "Walking lunges 20m",
        }),
        makeSuggestion({
          targetField: "accessory",
          action: "append",
          recommendation: "Wall balls 15 reps",
        }),
      ]);
      vi.mocked(parseExercisesFromText)
        .mockResolvedValueOnce([
          {
            exerciseName: "walking_lunges",
            category: "conditioning",
            confidence: 90,
            sets: [{ setNumber: 1, distance: 20 }],
          },
        ])
        .mockResolvedValueOnce([
          {
            exerciseName: "wall_balls",
            category: "functional",
            confidence: 90,
            sets: [{ setNumber: 1, reps: 15 }],
          },
        ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 2 });
      expect(dbMockState.insertValues).toHaveBeenNthCalledWith(
        1,
        [expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 5 })],
      );
      expect(dbMockState.insertValues).toHaveBeenNthCalledWith(
        2,
        [expect.objectContaining({ exerciseName: "wall_balls", sortOrder: 6 })],
      );
    });

    it("falls back to text-field writes when structured recommendation parsing returns no exercises", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({
          exerciseDetails: [
            { exerciseName: "deadlift", category: "strength", setNumber: 1, reps: 3, weight: 140, sortOrder: 0 },
          ],
        }),
      ]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ recommendation: "Keep this lighter today" }),
      ]);
      vi.mocked(parseExercisesFromText).mockResolvedValue([]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(dbMockState.insertValues).not.toHaveBeenCalled();
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        expect.objectContaining({
          mainWorkout: "Keep this lighter today",
          aiRationale: "Progressive overload",
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("keeps notes suggestions as text writes for table-backed workouts", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({
          exerciseDetails: [
            { exerciseName: "deadlift", category: "strength", setNumber: 1, reps: 3, weight: 140, sortOrder: 0 },
          ],
        }),
      ]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ targetField: "notes", recommendation: "Keep two reps in reserve." }),
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(parseExercisesFromText).not.toHaveBeenCalled();
      expect(dbMockState.insertValues).not.toHaveBeenCalled();
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        expect.objectContaining({
          notes: "Keep two reps in reserve.",
          aiRationale: "Progressive overload",
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("resets isAutoCoaching flag even when an error occurs", async () => {
      mockEnabledUser();
      vi.mocked(buildTrainingContext).mockRejectedValue(new Error("AI service down"));

      await expect(triggerAutoCoach("user-1")).rejects.toThrow("AI service down");
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    // Regression: triggerAutoCoach's caller (workoutService) pre-sets the flag
    // to true inside the workout-creation transaction before enqueuing the job.
    // If any code runs before the inner body throws (getUser, checkAiBudget, or
    // the updateIsAutoCoaching(true) call itself), the outer finally MUST still
    // reset the flag or the frontend will poll /api/user forever.
    it("resets isAutoCoaching flag when getUser throws (caller pre-set scenario)", async () => {
      vi.mocked(storage.users.getUser).mockRejectedValue(new Error("DB down"));
      vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);

      await expect(triggerAutoCoach("user-1")).rejects.toThrow("DB down");
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("resets isAutoCoaching flag when checkAiBudget throws", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true } as never);
      vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(storage.aiUsage.getDailyTotalCents).mockRejectedValueOnce(new Error("budget svc down"));

      await expect(triggerAutoCoach("user-1")).rejects.toThrow("budget svc down");
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("still requests a review note for days whose modification suggestion is malformed", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({ planDayId: "day-1" }),
        makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
      ]);
      // Gemini returns a suggestion for day-1 with empty recommendation —
      // applySuggestion will reject it. Without treating that suggestion as
      // invalid at the routing step, day-1 would also be excluded from the
      // review-note pass, leaving it silent on the timeline.
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ workoutId: "day-1", recommendation: "" }),
      ]);
      vi.mocked(generateReviewNotes).mockResolvedValue([
        { workoutId: "day-1", note: "Good as-is — light intro day." },
        { workoutId: "day-2", note: "Good as-is — build-phase volume." },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      const calls = vi.mocked(storage.plans.updatePlanDay).mock.calls;
      const reviewIds = calls
        .filter(c => (c[1] as { aiSource?: string }).aiSource === "review")
        .map(c => c[0])
        .sort();
      expect(reviewIds).toEqual(["day-1", "day-2"]);
    });

    it("drops review notes whose workoutId was modified or is not upcoming", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({ planDayId: "day-1" }),
        makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
      ]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion({ workoutId: "day-1" })]);
      vi.mocked(generateReviewNotes).mockResolvedValue([
        { workoutId: "day-1", note: "should be discarded — already modified" },
        { workoutId: "day-2", note: "legit — untouched day" },
        { workoutId: "ghost-id", note: "should be discarded — hallucinated id" },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      const applyCalls = vi.mocked(storage.plans.updatePlanDay).mock.calls;
      const reviewCalls = applyCalls.filter(c => (c[1] as { aiSource?: string }).aiSource === "review");
      expect(reviewCalls).toHaveLength(1);
      expect(reviewCalls[0][0]).toBe("day-2");
    });

    it("writes review notes on upcoming days the coach did NOT modify", async () => {
      mockBaseAutoCoachDeps([
        makeTimelineEntry({ planDayId: "day-1" }),
        makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
      ]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion({ workoutId: "day-1" })]);
      vi.mocked(generateReviewNotes).mockResolvedValue([
        { workoutId: "day-2", note: "On track — building-phase volume looks appropriate." },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(generateReviewNotes).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ id: "day-2" })]),
        undefined,
        undefined,
        "user-1",
      );
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        "day-2",
        expect.objectContaining({
          aiSource: "review",
          aiRationale: "On track — building-phase volume looks appropriate.",
          aiNoteUpdatedAt: new Date("2026-01-15T12:00:00Z"),
          aiInputsUsed: expect.objectContaining({ ragUsed: false }),
        }),
        "user-1",
        expect.anything(),
      );
    });

    it("skips suggestions with missing workoutId or recommendation", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ focus: "Running", mainWorkout: "5km" })]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ workoutId: "", recommendation: "test" }),
        makeSuggestion({ workoutId: "day-1", recommendation: "" }),
      ]);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
    });
  });

  describe("regenerateCoachNoteForPlanDay", () => {
    it("passes plan-day exercise rows to Coach's Take and suppresses accessory/notes fallback", async () => {
      vi.mocked(storage.plans.getPlanDay).mockResolvedValue({
        id: "day-1",
        planId: "plan-1",
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "FINGERPRINT_PLAN_MAIN",
        accessory: "FINGERPRINT_PLAN_ACCESSORY",
        notes: "FINGERPRINT_PLAN_NOTES",
        scheduledDate: "2026-01-16",
        status: "planned",
        aiSource: null,
        aiRationale: null,
        aiNoteUpdatedAt: null,
        aiInputsUsed: null,
      } as never);
      vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([
        {
          id: "set-1",
          workoutLogId: null,
          planDayId: "day-1",
          exerciseName: "back_squat",
          customLabel: null,
          category: "strength",
          setNumber: 1,
          reps: 5,
          weight: 100,
          distance: null,
          time: null,
          notes: null,
          confidence: 95,
          sortOrder: 0,
        },
      ] as never);
      vi.mocked(buildTrainingContext).mockResolvedValue({
        recentWorkouts: [],
        coachingInsights: { rpeTrend: "stable", fatigueFlag: false, undertrainingFlag: false, stationGaps: [], progressionFlags: [] },
      } as never);
      vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(false);
      vi.mocked(storage.coaching.listCoachingMaterials).mockResolvedValue([]);
      vi.mocked(generateReviewNotes).mockResolvedValue([
        { workoutId: "day-1", note: "Looks right for the current phase." },
      ]);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({
        aiRationale: "Looks right for the current phase.",
      } as never);

      await expect(regenerateCoachNoteForPlanDay("day-1", "user-1")).resolves.toEqual(
        expect.objectContaining({
          planDayId: "day-1",
          aiRationale: "Looks right for the current phase.",
        }),
      );

      expect(generateReviewNotes).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({
            id: "day-1",
            accessory: undefined,
            notes: undefined,
            exerciseDetails: [
              expect.objectContaining({
                exerciseName: "back_squat",
                reps: 5,
                weight: 100,
              }),
            ],
          }),
        ],
        undefined,
        undefined,
        "user-1",
      );
    });
  });
});
