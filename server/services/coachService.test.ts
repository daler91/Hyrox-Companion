import { describe, it, expect, vi, beforeEach } from "vitest";
import { triggerAutoCoach } from "./coachService";
import { storage } from "../storage";
import { buildTrainingContext } from "./aiService";
import { generateWorkoutSuggestions } from "../gemini/index";
import { retrieveRelevantChunks } from "./ragService";

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateIsAutoCoaching: vi.fn(),
    listTrainingPlans: vi.fn(),
    getTimeline: vi.fn(),
    updatePlanDay: vi.fn(),
    hasChunksForUser: vi.fn(),
    getStoredEmbeddingDimension: vi.fn(),
    listCoachingMaterials: vi.fn(),
  },
}));

vi.mock("./aiService", () => ({
  buildTrainingContext: vi.fn(),
}));

vi.mock("../gemini/index", () => ({
  generateWorkoutSuggestions: vi.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));

vi.mock("./ragService", () => ({
  retrieveRelevantChunks: vi.fn(),
}));

vi.mock("../prompts", () => ({
  buildCoachingMaterialsSection: vi.fn().mockReturnValue(""),
  buildRetrievedChunksSection: vi.fn().mockReturnValue("[RAG chunks]"),
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("coachService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("triggerAutoCoach", () => {
    it("returns 0 when user has aiCoachEnabled=false", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({ aiCoachEnabled: false } as any);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
      expect(storage.updateIsAutoCoaching).not.toHaveBeenCalled();
    });

    it("returns 0 when user is not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
    });

    it("returns 0 when user is already auto-coaching (prevents overlapping runs)", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: true,
      } as any);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
      expect(storage.updateIsAutoCoaching).not.toHaveBeenCalled();
    });

    it("returns 0 when no upcoming planned workouts exist", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({} as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([]);
      vi.mocked(storage.getTimeline).mockResolvedValue([]);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
      // Should still set and unset the auto-coaching flag
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("applies suggestions to upcoming workouts and returns adjusted count", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({ totalWorkouts: 10 } as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([
        { id: "plan-1", goal: "Sub-90 Hyrox" } as any,
      ]);
      vi.mocked(storage.getTimeline).mockResolvedValue([
        {
          status: "planned",
          date: "2026-01-16",
          planDayId: "day-1",
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          accessory: null,
          notes: null,
        },
        {
          status: "planned",
          date: "2026-01-17",
          planDayId: "day-2",
          focus: "Running",
          mainWorkout: "5km easy",
          accessory: null,
          notes: null,
        },
      ] as any);

      vi.mocked(storage.hasChunksForUser).mockResolvedValue(false);
      vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        {
          workoutId: "day-1",
          workoutDate: "2026-01-16",
          targetField: "mainWorkout",
          action: "replace",
          recommendation: "4x5 Squats @ 80%",
          rationale: "Progressive overload",
          priority: "high",
        },
      ]);

      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as any);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 1 });
      expect(storage.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        { mainWorkout: "4x5 Squats @ 80%", aiSource: null },
        "user-1",
      );
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);

      vi.useRealTimers();
    });

    it("uses RAG when chunks are available and dimensions match", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({} as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([]);
      vi.mocked(storage.getTimeline).mockResolvedValue([
        {
          status: "planned",
          date: "2026-01-16",
          planDayId: "day-1",
          focus: "Strength",
          mainWorkout: "Squats",
          accessory: null,
          notes: null,
        },
      ] as any);

      vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.getStoredEmbeddingDimension).mockResolvedValue(3072);
      vi.mocked(retrieveRelevantChunks).mockResolvedValue(["chunk 1", "chunk 2"]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        {
          workoutId: "day-1",
          workoutDate: "2026-01-16",
          targetField: "notes",
          action: "replace",
          recommendation: "Focus on form",
          rationale: "Based on coaching materials",
          priority: "low",
        },
      ]);
      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as any);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 1 });
      expect(retrieveRelevantChunks).toHaveBeenCalled();
      // aiSource should be "rag" since RAG was used
      expect(storage.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        { notes: "Focus on form", aiSource: "rag" },
        "user-1",
      );

      vi.useRealTimers();
    });

    it("falls back to legacy when RAG dimension mismatch occurs", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({} as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([]);
      vi.mocked(storage.getTimeline).mockResolvedValue([
        {
          status: "planned",
          date: "2026-01-16",
          planDayId: "day-1",
          focus: "Running",
          mainWorkout: "5km",
          accessory: null,
          notes: null,
        },
      ] as any);

      vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
      vi.mocked(storage.getStoredEmbeddingDimension).mockResolvedValue(1536); // Mismatch!
      vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);
      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
      expect(retrieveRelevantChunks).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("handles append action correctly by prefixing with [AI Coach]", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({} as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([]);
      vi.mocked(storage.getTimeline).mockResolvedValue([
        {
          status: "planned",
          date: "2026-01-16",
          planDayId: "day-1",
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          accessory: "Leg Press",
          notes: null,
        },
      ] as any);

      vi.mocked(storage.hasChunksForUser).mockResolvedValue(false);
      vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        {
          workoutId: "day-1",
          workoutDate: "2026-01-16",
          targetField: "accessory",
          action: "append",
          recommendation: "Add 3x10 calf raises",
          rationale: "Calf weakness detected",
          priority: "medium",
        },
      ]);
      vi.mocked(storage.updatePlanDay).mockResolvedValue({} as any);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 1 });
      expect(storage.updatePlanDay).toHaveBeenCalledWith(
        "day-1",
        {
          accessory: "Leg Press\n[AI Coach] Add 3x10 calf raises",
          aiSource: null,
        },
        "user-1",
      );

      vi.useRealTimers();
    });

    it("resets isAutoCoaching flag even when an error occurs", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockRejectedValue(new Error("AI service down"));

      await expect(triggerAutoCoach("user-1")).rejects.toThrow("AI service down");

      // Verify the flag was reset despite the error
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
      expect(storage.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
    });

    it("skips suggestions with missing workoutId or recommendation", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

      vi.mocked(storage.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        isAutoCoaching: false,
      } as any);
      vi.mocked(storage.updateIsAutoCoaching).mockResolvedValue(undefined);
      vi.mocked(buildTrainingContext).mockResolvedValue({} as any);
      vi.mocked(storage.listTrainingPlans).mockResolvedValue([]);
      vi.mocked(storage.getTimeline).mockResolvedValue([
        {
          status: "planned",
          date: "2026-01-16",
          planDayId: "day-1",
          focus: "Running",
          mainWorkout: "5km",
          accessory: null,
          notes: null,
        },
      ] as any);

      vi.mocked(storage.hasChunksForUser).mockResolvedValue(false);
      vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

      vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
        {
          workoutId: "",
          workoutDate: "2026-01-16",
          targetField: "mainWorkout",
          action: "replace",
          recommendation: "test",
          rationale: "test",
          priority: "high",
        },
        {
          workoutId: "day-1",
          workoutDate: "2026-01-16",
          targetField: "mainWorkout",
          action: "replace",
          recommendation: "",
          rationale: "test",
          priority: "high",
        },
      ]);

      const result = await triggerAutoCoach("user-1");

      expect(result).toEqual({ adjusted: 0 });
      expect(storage.updatePlanDay).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
