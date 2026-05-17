import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import {
  generateReviewNotes,
  generateWorkoutSuggestions,
} from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { triggerAutoCoach } from "./coachService";
import {
  makeSuggestion,
  makeTimelineEntry,
  mockBaseAutoCoachDeps,
  textWorkoutFingerprint,
} from "./coachService.testFixtures";

describe("coachService triggerAutoCoach fatigue suppression and review notes", () => {
  it("suppresses repeat fatigue reductions when no new completed workouts exist", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        aiRationale: "Reduced volume because RPE was high.",
        aiInputsUsed: {
          lastFatigueReduction: {
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 12,
            fatigueFlag: true,
            rpeTrend: "rising",
            reason: "Reduced volume because RPE was high.",
            prescriptionFingerprint: textWorkoutFingerprint("3x5 Squats"),
          },
        },
      }),
    ]);
    vi.mocked(buildTrainingContext).mockResolvedValue({
      totalWorkouts: 12,
      completedWorkouts: 12,
      plannedWorkouts: 1,
      missedWorkouts: 0,
      skippedWorkouts: 0,
      completionRate: 100,
      currentStreak: 3,
      recentWorkouts: [],
      upcomingWorkouts: [
        {
          planDayId: "day-1",
          date: "2026-01-16",
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          aiRationale: "Reduced volume because RPE was high.",
          aiInputsUsed: {
            lastFatigueReduction: {
              kind: "fatigue_volume_reduction",
              completedWorkoutCount: 12,
              fatigueFlag: true,
              rpeTrend: "rising",
              reason: "Reduced volume because RPE was high.",
              prescriptionFingerprint: textWorkoutFingerprint("3x5 Squats"),
            },
          },
        },
      ],
      exerciseBreakdown: {},
      coachingInsights: {
        rpeTrend: "rising",
        fatigueFlag: true,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        recommendation: "Back squat 2x5 lighter",
        rationale: "Reduce volume because RPE and fatigue remain high.",
      }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      {
        workoutId: "day-1",
        note: "Already reduced for the current fatigue trend; keep this version.",
      },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        aiSource: "review",
        aiRationale: "Already reduced for the current fatigue trend; keep this version.",
      }),
      "user-1",
      expect.anything(),
    );
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({ mainWorkout: "Back squat 2x5 lighter" }),
      "user-1",
      expect.anything(),
    );
  });

  it("allows another fatigue reduction when new completed workouts change the evidence", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({
        aiInputsUsed: {
          lastFatigueReduction: {
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 12,
            fatigueFlag: true,
            rpeTrend: "rising",
            prescriptionFingerprint: textWorkoutFingerprint("3x5 Squats"),
          },
        },
      }),
    ]);
    vi.mocked(buildTrainingContext).mockResolvedValue({
      totalWorkouts: 13,
      completedWorkouts: 13,
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
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          aiInputsUsed: {
            lastFatigueReduction: {
              kind: "fatigue_volume_reduction",
              completedWorkoutCount: 12,
              fatigueFlag: true,
              rpeTrend: "rising",
              prescriptionFingerprint: textWorkoutFingerprint("3x5 Squats"),
            },
          },
        },
      ],
      exerciseBreakdown: {},
      coachingInsights: {
        rpeTrend: "rising",
        fatigueFlag: true,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        recommendation: "Back squat 2x5 lighter",
        rationale: "Reduce volume because RPE and fatigue remain high.",
      }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        mainWorkout: "Back squat 2x5 lighter",
        aiInputsUsed: expect.objectContaining({
          lastModification: expect.objectContaining({
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 13,
          }),
          lastFatigueReduction: expect.objectContaining({
            kind: "fatigue_volume_reduction",
            completedWorkoutCount: 13,
            prescriptionFingerprint: textWorkoutFingerprint("Back squat 2x5 lighter"),
          }),
        }),
      }),
      "user-1",
      expect.anything(),
    );
  });

  it("preserves same-run fatigue metadata when a later suggestion updates the same day", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [makeTimelineEntry()]);
    vi.mocked(buildTrainingContext).mockResolvedValue({
      totalWorkouts: 12,
      completedWorkouts: 12,
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
          focus: "Strength",
          mainWorkout: "3x5 Squats",
          accessory: null,
          notes: null,
        },
      ],
      exerciseBreakdown: {},
      coachingInsights: {
        rpeTrend: "rising",
        fatigueFlag: true,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        recommendation: "Back squat 2x5 lighter",
        rationale: "Reduce volume because RPE and fatigue remain high.",
      }),
      makeSuggestion({
        targetField: "accessory",
        recommendation: "Sled push 4x20m",
        rationale: "Sled Push has not been trained recently.",
        priority: "medium",
      }),
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 2 });
    const updateCalls = vi
      .mocked(storage.plans.updatePlanDay)
      .mock.calls.filter(([workoutId]) => workoutId === "day-1");
    expect(updateCalls).toHaveLength(2);

    const secondInputs = updateCalls[1][1].aiInputsUsed;
    expect(secondInputs).toEqual(
      expect.objectContaining({
        lastModification: expect.objectContaining({
          kind: "workload_adjustment",
          reason: "Sled Push has not been trained recently.",
        }),
        lastFatigueReduction: expect.objectContaining({
          kind: "fatigue_volume_reduction",
          completedWorkoutCount: 12,
          prescriptionFingerprint: textWorkoutFingerprint("Back squat 2x5 lighter"),
        }),
      }),
    );
  });

  it("still requests a review note for days whose modification suggestion is malformed", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ planDayId: "day-1" }),
      makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-1", recommendation: "" }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-1", note: "Good as-is - light intro day." },
      { workoutId: "day-2", note: "Good as-is - build-phase volume." },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    const calls = vi.mocked(storage.plans.updatePlanDay).mock.calls;
    const reviewIds = calls
      .filter((call) => (call[1] as { aiSource?: string }).aiSource === "review")
      .map((call) => call[0])
      .sort();
    expect(reviewIds).toEqual(["day-1", "day-2"]);
  });

  it("drops review notes whose workoutId was modified or is not upcoming", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ planDayId: "day-1" }),
      makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-1" }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-1", note: "should be discarded - already modified" },
      { workoutId: "day-2", note: "legit - untouched day" },
      { workoutId: "ghost-id", note: "should be discarded - hallucinated id" },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    const applyCalls = vi.mocked(storage.plans.updatePlanDay).mock.calls;
    const reviewCalls = applyCalls.filter(
      (call) => (call[1] as { aiSource?: string }).aiSource === "review",
    );
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0][0]).toBe("day-2");
  });

  it("writes review notes on upcoming days the coach did NOT modify", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ planDayId: "day-1" }),
      makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-1" }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-2", note: "On track - building-phase volume looks appropriate." },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    expect(generateReviewNotes).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: "day-2" })]),
      undefined,
      undefined,
      "user-1",
      expect.objectContaining({
        promptSuffix: expect.stringContaining("Training style:"),
      }),
    );
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-2",
      expect.objectContaining({
        aiSource: "review",
        aiRationale: "On track - building-phase volume looks appropriate.",
        aiNoteUpdatedAt: new Date("2026-01-15T12:00:00Z"),
        aiInputsUsed: expect.objectContaining({ ragUsed: false }),
      }),
      "user-1",
      expect.anything(),
    );
  });
});
