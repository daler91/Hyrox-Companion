import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../errors";
import { generateReviewNotes, generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { triggerAutoCoach } from "./coachService";
import { dbMockState } from "./coachService.dbMockState";
import {
  makeSuggestion,
  makeTimelineEntry,
  mockBaseAutoCoachDeps,
} from "./coachService.testFixtures";
import {
  applyPlanAdaptation,
  computePlanAdaptation,
  type PlanAdaptation,
} from "./planAdaptationService";

vi.mock("./planAdaptationService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planAdaptationService")>();
  return { ...actual, computePlanAdaptation: vi.fn(), applyPlanAdaptation: vi.fn() };
});

vi.mock("./aiUsageService", () => ({
  checkAiBudget: vi.fn().mockResolvedValue({ allowed: true }),
}));

const OUTAGE = new AppError(ErrorCode.AI_UNAVAILABLE, "AI service temporarily unavailable.", 503);

function adaptation(planDayId: string): PlanAdaptation {
  return {
    planId: "plan-1",
    result: {
      days: [
        {
          planDayId,
          setUpdates: [{ setId: "s1", weight: 90, weightUnit: "kg" }],
          rationale: "Auto-progression: Front Squat now builds from what you did.",
          inputsUsed: { lastModification: { kind: "auto_progression" } },
          changes: [{ exercise: "front_squat", kind: "raise", from: 85, to: 90, unit: "kg" }],
        },
      ],
      engineState: { version: 1, runVdot: null, adaptedLogIds: ["log-1"], updatedAt: "now" },
      adaptedLogIds: ["log-1"],
    },
    baseline: { engineStateUpdatedAt: null, dayFingerprints: new Map([[planDayId, "fp"]]) },
  };
}

function threePlannedDays(notes: string | null = null) {
  mockBaseAutoCoachDeps(storage, buildTrainingContext, [
    makeTimelineEntry({ planDayId: "day-1", date: "2026-01-16" }),
    makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17", notes }),
    makeTimelineEntry({ planDayId: "day-3", date: "2026-01-18" }),
  ]);
  vi.mocked(storage.plans).updatePlanDay.mockResolvedValue({ id: "updated" } as never);
  vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-1"));
  vi.mocked(applyPlanAdaptation).mockResolvedValue(1);
}

function reviewNoteWrites() {
  return vi
    .mocked(storage.plans)
    .updatePlanDay.mock.calls.filter((call) => call[1].aiSource === "review")
    .map((call) => [call[0], call[1].aiRationale]);
}

/**
 * AI8 (CODEBASE_ANALYSIS_2026-10-03): a failed model call used to come back
 * as `[]`, "nothing to change", so an outage wrote "the plan still fits" notes
 * the model never weighed and completed the job with no retry. Now the stages
 * that need no model are written and the job fails for pg-boss to retry.
 */
describe("triggerAutoCoach — a failed model call", () => {
  it("still writes the plan adaptation, writes no review notes, and fails the job", async () => {
    threePlannedDays();
    vi.mocked(generateWorkoutSuggestions).mockRejectedValue(OUTAGE);

    await expect(triggerAutoCoach("user-1")).rejects.toBe(OUTAGE);

    expect(applyPlanAdaptation).toHaveBeenCalledWith(adaptation("day-1"), "user-1", dbMockState.tx);
    // Nothing was evaluated, so nothing is explained.
    expect(generateReviewNotes).not.toHaveBeenCalled();
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toEqual([]);
    expect(vi.mocked(storage.users).updateIsAutoCoaching.mock.lastCall).toEqual(["user-1", false]);
  });

  it("keeps the model's applied changes when only the review-note call fails, and fails the job", async () => {
    threePlannedDays();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-2", recommendation: "5km tempo", rationale: "Variety" }),
    ] as never);
    vi.mocked(generateReviewNotes).mockRejectedValueOnce(OUTAGE);

    await expect(triggerAutoCoach("user-1")).rejects.toBe(OUTAGE);

    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls.map((call) => call[0])).toEqual([
      "day-2",
    ]);
    expect(reviewNoteWrites()).toEqual([]);
    expect(applyPlanAdaptation).toHaveBeenCalledTimes(1);
  });

  it("still writes a safety note, which needs no model, before failing the job", async () => {
    threePlannedDays("Chest pain during warmup");
    vi.mocked(generateWorkoutSuggestions).mockRejectedValue(OUTAGE);

    await expect(triggerAutoCoach("user-1")).rejects.toBe(OUTAGE);

    expect(generateReviewNotes).not.toHaveBeenCalled();
    const written = reviewNoteWrites();
    expect(written.map(([id]) => id)).toEqual(["day-2", "day-3"]);
    for (const [, note] of written) expect(note).toMatch(/potentially serious medical issue/i);
  });

  it("writes review notes as before when the model answers that nothing needs changing", async () => {
    threePlannedDays();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);
    vi.mocked(generateReviewNotes).mockResolvedValueOnce([
      { workoutId: "day-2", note: "Still fits." },
      { workoutId: "day-3", note: "Still fits." },
    ]);

    await expect(triggerAutoCoach("user-1")).resolves.toEqual({ adjusted: 1 });

    expect(reviewNoteWrites()).toEqual([
      ["day-2", "Still fits."],
      ["day-3", "Still fits."],
    ]);
  });
});
