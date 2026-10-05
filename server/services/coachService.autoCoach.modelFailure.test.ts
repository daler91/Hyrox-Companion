import "./coachService.testSetup";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AiConfigurationError } from "../ai/errors";
import { isTextAiProviderConfigured } from "../ai/providers";
import { env } from "../env";
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
const ORIGINAL_AI_FEATURES_ENABLED = env.AI_FEATURES_ENABLED;

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

  it("keeps the model's applied changes and completes the job when only the review-note call fails", async () => {
    // A retry would re-run the suggestions on days they already changed and
    // could append a second cue, so the job completes without the notes.
    threePlannedDays();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-2", recommendation: "5km tempo", rationale: "Variety" }),
    ] as never);
    vi.mocked(generateReviewNotes).mockRejectedValueOnce(OUTAGE);

    await expect(triggerAutoCoach("user-1")).resolves.toEqual({ adjusted: 2 });

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

/**
 * AI8 (CODEBASE_ANALYSIS_2026-10-03): a missing provider key, a missing
 * reasoning model or AI switched off fails every call the same way
 * (AiConfigurationError), so failing the job only bought three identical
 * retries. The pass applies the rule-based stages and completes, as it does
 * over budget.
 */
describe("triggerAutoCoach — no text AI provider to call", () => {
  afterEach(() => {
    env.AI_FEATURES_ENABLED = ORIGINAL_AI_FEATURES_ENABLED;
  });

  it.each<[string, () => void]>([
    [
      "no provider key or reasoning model is configured",
      () => {
        vi.mocked(isTextAiProviderConfigured).mockReturnValueOnce(false);
      },
    ],
    [
      "AI is switched off",
      () => {
        env.AI_FEATURES_ENABLED = "false";
      },
    ],
  ])("applies the rule-based stages and completes the job when %s", async (_label, arrange) => {
    threePlannedDays();
    arrange();

    await expect(triggerAutoCoach("user-1")).resolves.toEqual({ adjusted: 1 });

    expect(applyPlanAdaptation).toHaveBeenCalledWith(adaptation("day-1"), "user-1", dbMockState.tx);
    expect(generateWorkoutSuggestions).not.toHaveBeenCalled();
    expect(generateReviewNotes).not.toHaveBeenCalled();
    expect(vi.mocked(storage.users).updateIsAutoCoaching.mock.lastCall).toEqual(["user-1", false]);
  });

  it("asks about the reasoning model, the one both of the model's calls run on", async () => {
    // A check of the fast model alone let a provider configured only for it
    // through, and every call then failed.
    threePlannedDays();
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([]);

    await triggerAutoCoach("user-1");

    expect(isTextAiProviderConfigured).toHaveBeenCalledWith("reasoning");
  });

  it("completes without a retry when the call itself finds the configuration missing", async () => {
    // The suggestion service passes the configuration error through unwrapped,
    // so it is told apart from an outage, which is retried.
    threePlannedDays();
    const missingModel = new AiConfigurationError(
      'AI text model is not configured for provider "anthropic".',
    );
    vi.mocked(generateWorkoutSuggestions).mockRejectedValue(missingModel);

    await expect(triggerAutoCoach("user-1")).resolves.toEqual({ adjusted: 1 });

    expect(applyPlanAdaptation).toHaveBeenCalledWith(adaptation("day-1"), "user-1", dbMockState.tx);
    // Nothing was weighed, so nothing is explained.
    expect(generateReviewNotes).not.toHaveBeenCalled();
    expect(reviewNoteWrites()).toEqual([]);
    expect(vi.mocked(storage.users).updateIsAutoCoaching.mock.lastCall).toEqual(["user-1", false]);
  });
});
