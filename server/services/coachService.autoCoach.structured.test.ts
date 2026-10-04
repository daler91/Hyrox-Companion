import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import {
  generateReviewNotes,
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

describe("coachService triggerAutoCoach structured exercise writes", () => {
  it("replaces structured plan-day exercises before falling back to text fields", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        exerciseDetails: [
          {
            exerciseName: "back_squat",
            category: "strength",
            setNumber: 1,
            reps: 5,
            weight: 100,
            sortOrder: 0,
          },
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
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(parseExercisesFromText).toHaveBeenCalledWith(
      "Back squat 3x5 at 105kg",
      { weightUnit: "kg", distanceUnit: "km" },
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
          reps: 5,
          weight: 105,
          sortOrder: 0,
        }),
      ]),
    );
    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    // A structured replace reconciles the now-stale free text: the new
    // prescription lands in mainWorkout and accessory/notes are cleared so the
    // text no longer contradicts the replaced exercise rows.
    expect(updatePayload.mainWorkout).toEqual(expect.stringContaining("Back squat 3x5"));
    expect(updatePayload.accessory).toBeNull();
    expect(updatePayload.notes).toBeNull();
    // The AI-provider path carries no title override, so the title is left
    // untouched — but what the replace swapped out is kept as the day's
    // "Originally planned" record. AI13 (CODEBASE_ANALYSIS_2026-10-03)
    expect(updatePayload).not.toHaveProperty("focus");
    expect(updatePayload.aiInputsUsed).toEqual(
      expect.objectContaining({
        replacedPrescription: {
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          accessory: null,
          notes: null,
        },
      }),
    );
    expect(updatePayload).toEqual(expect.objectContaining({ aiRationale: "Progressive overload" }));
  });

  it("keeps the first 'Originally planned' record when a replaced day is replaced again", async () => {
    const original = { focus: "Strength", mainWorkout: "5x5 Squats @ 100kg" };
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        aiInputsUsed: { replacedPrescription: original },
        exerciseDetails: [
          { exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5, weight: 100 },
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
        sets: [{ setNumber: 1, reps: 5, weight: 105 }],
      },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1];
    expect(updatePayload.aiInputsUsed?.replacedPrescription).toEqual(original);
  });

  // AI13 (CODEBASE_ANALYSIS_2026-10-03): the table's rows carry no main or
  // accessory section, so an accessory-only replace could only be written by
  // deleting the whole table — the main work with it.
  it("refuses an accessory-only replace on a table-backed day and reviews the day instead", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        mainWorkout: "Back squat 5x5 @ 100kg",
        accessory: "Bulgarian split squat 3x10, plank 3x45s",
        exerciseDetails: [
          { exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5, weight: 100 },
          { exerciseName: "bulgarian_split_squat", category: "strength", setNumber: 1, reps: 10 },
          { exerciseName: "plank", category: "core", setNumber: 1, time: 0.75 },
        ],
      }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        targetField: "accessory",
        action: "replace",
        recommendation: "Plank 2x45s",
        rationale: "Taper: simplify the accessory work.",
      }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-1", note: "Keep the squats crisp; trim accessories if tired." },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(dbMockState.deleteWhere).not.toHaveBeenCalled();
    expect(dbMockState.insertValues).not.toHaveBeenCalled();
    const writes = vi.mocked(storage.plans.updatePlanDay).mock.calls;
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual(
      expect.objectContaining({
        aiSource: "review",
        aiRationale: "Keep the squats crisp; trim accessories if tired.",
      }),
    );
    expect(writes[0][1]).not.toHaveProperty("mainWorkout");
    expect(writes[0][1]).not.toHaveProperty("accessory");
  });

  it("still replaces a text-only day's accessory", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ accessory: "Bulgarian split squat 3x10" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ targetField: "accessory", action: "replace", recommendation: "Plank 2x45s" }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1]).toEqual(
      expect.objectContaining({ accessory: "Plank 2x45s" }),
    );
  });

  it("appends parsed structured suggestions after existing plan-day rows", async () => {
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
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(dbMockState.deleteWhere).not.toHaveBeenCalled();
    expect(dbMockState.insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 5 }),
        expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 6 }),
      ]),
    );
    const updatePayload = vi.mocked(storage.plans.updatePlanDay).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updatePayload).not.toHaveProperty("accessory");
    expect(updatePayload).toEqual(expect.objectContaining({ aiRationale: "Progressive overload" }));
  });

  it("serializes duplicate structured appends so sort orders do not collide", async () => {
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
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 2 });
    expect(dbMockState.insertValues).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ exerciseName: "walking_lunges", sortOrder: 5 }),
    ]);
    expect(dbMockState.insertValues).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ exerciseName: "wall_balls", sortOrder: 6 }),
    ]);
  });
});
