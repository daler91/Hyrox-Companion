import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { generateReviewNotes, generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { checkAiBudget } from "./aiUsageService";
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
  };
}

function twoPlannedDays() {
  mockBaseAutoCoachDeps(storage, buildTrainingContext, [
    makeTimelineEntry({ planDayId: "day-1", date: "2026-01-16" }),
    makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
  ]);
  vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({ id: "updated" } as never);
}

describe("triggerAutoCoach — plan adaptation", () => {
  it("applies the engine's adaptation and keeps the model off the days it changed", async () => {
    twoPlannedDays();
    vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-1"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(1);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        workoutId: "day-1",
        recommendation: "Generic rewrite",
        rationale: "Because",
      }),
      makeSuggestion({
        workoutId: "day-2",
        recommendation: "Swap to intervals",
        rationale: "Variety",
      }),
    ] as never);

    const result = await triggerAutoCoach("user-1");

    expect(applyPlanAdaptation).toHaveBeenCalledWith(adaptation("day-1"), "user-1", dbMockState.tx);
    const writtenDays = vi.mocked(storage.plans.updatePlanDay).mock.calls.map((call) => call[0]);
    expect(writtenDays).toEqual(["day-2"]);
    // The adapted day carries the engine's note, so the model isn't asked for one.
    const reviewed = vi
      .mocked(generateReviewNotes)
      .mock.calls.flatMap((call) => call[1].map((workout) => workout.id));
    expect(reviewed).not.toContain("day-1");
    expect(result.adjusted).toBe(2);
  });

  it("still adapts the plan when the athlete's AI budget is spent", async () => {
    twoPlannedDays();
    vi.mocked(checkAiBudget).mockResolvedValueOnce({ allowed: false } as never);
    vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-1"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(1);

    const result = await triggerAutoCoach("user-1");

    expect(generateWorkoutSuggestions).not.toHaveBeenCalled();
    expect(applyPlanAdaptation).toHaveBeenCalledTimes(1);
    expect(result.adjusted).toBe(1);
    expect(storage.users.updateIsAutoCoaching).toHaveBeenLastCalledWith("user-1", false);
  });

  it("adapts sessions beyond this week when nothing is planned this week", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, []);
    vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-9"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(1);

    const result = await triggerAutoCoach("user-1");

    expect(generateWorkoutSuggestions).not.toHaveBeenCalled();
    expect(result.adjusted).toBe(1);
  });

  it("does nothing extra when there is nothing to adapt", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, []);
    vi.mocked(computePlanAdaptation).mockResolvedValue(null);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(applyPlanAdaptation).not.toHaveBeenCalled();
  });
});
