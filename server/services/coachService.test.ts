import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerAutoCoach } from "./coachService";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { generateWorkoutSuggestions } from "../gemini/index";
import { retrieveRelevantChunks } from "./ragService";

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateIsAutoCoaching: vi.fn(),
    listTrainingPlans: vi.fn(),
    getActivePlan: vi.fn(),
    getTimeline: vi.fn(),
    updatePlanDay: vi.fn(),
    hasChunksForUser: vi.fn(),
    getStoredEmbeddingDimension: vi.fn(),
    listCoachingMaterials: vi.fn(),
  },
}));

vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("../gemini/index", () => ({ generateWorkoutSuggestions: vi.fn(), EMBEDDING_DIMENSIONS: 3072 }));
vi.mock("./ragService", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("../prompts", () => ({ buildCoachingMaterialsSection: vi.fn().mockReturnValue(""), buildRetrievedChunksSection: vi.fn().mockReturnValue("[RAG chunks]"), FUNCTIONAL_EXERCISES: ["skierg", "sled_push", "sled_pull", "burpee_broad_jump", "rowing", "farmers_carry", "sandbag_lunges", "wall_balls"] }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// -- Helpers ------------------------------------------------------------------

function mockEnabledUser() {
  vi.mocked(storage.getUser).mockResolvedValue({ aiCoachEnabled: true, isAutoCoaching: false } as never);
  vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
}

function makeTimelineEntry(overrides: Record<string, unknown> = {}) {
  return { status: "planned", date: "2026-01-16", planDayId: "day-1", focus: "Strength", mainWorkout: "3x5 Squats", accessory: null, notes: null, ...overrides };
}

function mockBaseAutoCoachDeps(timeline: Record<string, unknown>[] = [makeTimelineEntry()]) {
  mockEnabledUser();
  vi.mocked(buildTrainingContext).mockResolvedValue({} as never);
  vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);
  vi.mocked(storage.getTimeline).mockResolvedValue(timeline as never);
  vi.mocked(storage.hasChunksForUser).mockResolvedValue(false);
  vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);
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
      vi.mocked(storage.getUser).mockResolvedValue({ aiCoachEnabled: false } as never);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("returns 0 and resets flag when user is not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("returns 0 when no upcoming planned workouts exist", async () => {
      mockBaseAutoCoachDeps([]);
      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("applies suggestions and returns adjusted count", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry(), makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17", focus: "Running", mainWorkout: "5km easy" })]);
      vi.mocked(storage.getActivePlan).mockResolvedValue({ id: "plan-1", goal: "Sub-90 Hyrox" } as never);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion()]);
      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(storage.updatePlanDay).toHaveBeenCalledWith("day-1", { mainWorkout: "4x5 Squats @ 80%", aiSource: null }, "user-1");
    });

    it("uses RAG when chunks are available and dimensions match", async () => {
      mockBaseAutoCoachDeps();
      vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.getStoredEmbeddingDimension).mockResolvedValue(3072);
      vi.mocked(retrieveRelevantChunks).mockResolvedValue(["chunk 1", "chunk 2"]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([makeSuggestion({ targetField: "notes", recommendation: "Focus on form", priority: "low" })]);
      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(retrieveRelevantChunks).toHaveBeenCalled();
      expect(storage.updatePlanDay).toHaveBeenCalledWith("day-1", { notes: "Focus on form", aiSource: "rag" }, "user-1");
    });

    it("falls back to legacy when RAG dimension mismatch occurs", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ focus: "Running", mainWorkout: "5km" })]);
      vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.getStoredEmbeddingDimension).mockResolvedValue(1536);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    });

    it("handles append action by prefixing with [AI Coach]", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ accessory: "Leg Press" })]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ targetField: "accessory", action: "append", recommendation: "Add 3x10 calf raises" }),
      ]);
      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as never);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
      expect(storage.updatePlanDay).toHaveBeenCalledWith("day-1", { accessory: "Leg Press\n[AI Coach] Add 3x10 calf raises", aiSource: null }, "user-1");
    });

    it("resets isAutoCoaching flag even when an error occurs", async () => {
      mockEnabledUser();
      vi.mocked(buildTrainingContext).mockRejectedValue(new Error("AI service down"));

      await expect(triggerAutoCoach("user-1")).rejects.toThrow("AI service down");
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("skips suggestions with missing workoutId or recommendation", async () => {
      mockBaseAutoCoachDeps([makeTimelineEntry({ focus: "Running", mainWorkout: "5km" })]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        makeSuggestion({ workoutId: "", recommendation: "test" }),
        makeSuggestion({ workoutId: "day-1", recommendation: "" }),
      ]);

      expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
      expect(storage.updatePlanDay).not.toHaveBeenCalled();
    });
  });
});
