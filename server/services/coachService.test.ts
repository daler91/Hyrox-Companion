import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { generateReviewNotes, generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { triggerAutoCoach } from "./coachService";
import { retrieveRelevantChunks } from "./ragService";

vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
      updateIsAutoCoaching: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getActivePlan: vi.fn(),
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
    transaction: vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn({} as unknown)),
  },
}));

vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("../gemini/index", () => ({
  generateWorkoutSuggestions: vi.fn(),
  generateReviewNotes: vi.fn().mockResolvedValue([]),
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
});
