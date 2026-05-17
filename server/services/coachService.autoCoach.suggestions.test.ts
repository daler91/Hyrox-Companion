import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import {
  generateWorkoutSuggestions,
  parseExercisesFromText,
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
});
