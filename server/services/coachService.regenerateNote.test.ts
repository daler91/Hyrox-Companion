import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { AiConfigurationError } from "../ai/errors";
import { ErrorCode } from "../errors";
import { generateReviewNotes } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { regenerateCoachNoteForPlanDay } from "./coachService";

describe("coachService regenerateCoachNoteForPlanDay", () => {
  /** A planned strength day with one prescribed set, and an athlete with no coaching materials. */
  function arrangePlannedDay() {
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
    });
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
    ]);
    vi.mocked(buildTrainingContext).mockResolvedValue({
      recentWorkouts: [],
      coachingInsights: {
        rpeTrend: "stable",
        fatigueFlag: false,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });
    vi.mocked(storage.coaching.hasChunksForUser).mockResolvedValue(false);
    vi.mocked(storage.coaching.listCoachingMaterials).mockResolvedValue([]);
  }

  it("passes plan-day exercise rows to Coach's Take and suppresses accessory/notes fallback", async () => {
    arrangePlannedDay();
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-1", note: "Looks right for the current phase." },
    ]);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({
      aiRationale: "Looks right for the current phase.",
    });

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
      expect.objectContaining({
        promptSuffix: expect.stringContaining("Training style:"),
      }),
    );
  });

  it("reports a provider this deployment has not configured as the AI kill switch's 503, writing nothing", async () => {
    // AI8 (CODEBASE_ANALYSIS_2026-10-03): the suggestion service passes the
    // configuration error through unclassified, which alone would be a 500.
    arrangePlannedDay();
    vi.mocked(generateReviewNotes).mockRejectedValue(
      new AiConfigurationError('AI text model is not configured for provider "anthropic".'),
    );

    await expect(regenerateCoachNoteForPlanDay("day-1", "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_FEATURES_DISABLED,
      status: 503,
    });
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toEqual([]);
  });
});
