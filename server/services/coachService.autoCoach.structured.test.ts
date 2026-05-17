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
    expect(updatePayload).not.toHaveProperty("mainWorkout");
    expect(updatePayload).not.toHaveProperty("accessory");
    expect(updatePayload).toEqual(expect.objectContaining({ aiRationale: "Progressive overload" }));
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
