import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { generateReviewNotes, generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { checkAiBudget } from "./aiUsageService";
import { lockAutoCoachWriteTargets } from "./autoCoachWriteGuard";
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
    baseline: { engineStateUpdatedAt: null, dayFingerprints: new Map([[planDayId, "fp"]]) },
    heldDayIds: new Set(),
  };
}

/** A pass that changes nothing, on a plan whose `heldDayId` an earlier pass holds for a missed session. */
function standingHold(heldDayId: string): PlanAdaptation {
  return {
    planId: "plan-1",
    result: {
      days: [],
      engineState: { version: 1, runVdot: null, adaptedLogIds: [], updatedAt: "now" },
      adaptedLogIds: [],
    },
    baseline: { engineStateUpdatedAt: null, dayFingerprints: new Map() },
    heldDayIds: new Set([heldDayId]),
  };
}

function twoPlannedDays() {
  mockBaseAutoCoachDeps(storage, buildTrainingContext, [
    makeTimelineEntry({ planDayId: "day-1", date: "2026-01-16" }),
    makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
  ]);
  vi.mocked(storage.plans).updatePlanDay.mockResolvedValue({ id: "updated" } as never);
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
    const writtenDays = vi.mocked(storage.plans).updatePlanDay.mock.calls.map((call) => call[0]);
    expect(writtenDays).toEqual(["day-2"]);
    // The adapted day carries the engine's note, so the model isn't asked for one.
    const reviewed = vi
      .mocked(generateReviewNotes)
      .mock.calls.flatMap((call) => call[1].map((workout) => workout.id));
    expect(reviewed).not.toContain("day-1");
    expect(result.adjusted).toBe(2);
  });

  // The hold was written on an earlier pass, so the day is not one this pass
  // changes. A rewrite would put its loads wherever the model likes, past the
  // step that was not done, and delete the rows the hold is recorded against.
  it("refuses the model's rewrite of a day still held for a missed session, and reviews it instead", async () => {
    twoPlannedDays();
    vi.mocked(computePlanAdaptation).mockResolvedValue(standingHold("day-1"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(0);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-1", recommendation: "Back Squat 5x5 @ 105 kg" }),
      makeSuggestion({ workoutId: "day-2", recommendation: "Swap to intervals" }),
    ] as never);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-1", note: "Held at last week's load after the missed session." },
    ]);

    await triggerAutoCoach("user-1");

    const writes = vi.mocked(storage.plans).updatePlanDay.mock.calls;
    // The other day's rewrite goes through; the held day gets only its note.
    expect(writes.map(([dayId]) => dayId)).toEqual(["day-2", "day-1"]);
    const held = writes.find(([dayId]) => dayId === "day-1")?.[1];
    expect(held?.aiSource).toBe("review");
    expect(held).not.toHaveProperty("mainWorkout");
  });

  it("still lets the model add a cue to a held day", async () => {
    twoPlannedDays();
    vi.mocked(computePlanAdaptation).mockResolvedValue(standingHold("day-1"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(0);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        workoutId: "day-1",
        targetField: "notes",
        action: "append",
        recommendation: "Brace before each rep.",
      }),
    ] as never);

    await triggerAutoCoach("user-1");

    const cue = vi.mocked(storage.plans).updatePlanDay.mock.calls.find(([dayId]) => dayId === "day-1");
    expect(cue?.[1].notes).toContain("Brace before each rep.");
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
    expect(vi.mocked(storage.users).updateIsAutoCoaching.mock.lastCall).toEqual(["user-1", false]);
  });

  it("adapts sessions beyond this week when nothing is planned this week", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, []);
    vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-9"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(1);

    const result = await triggerAutoCoach("user-1");

    expect(generateWorkoutSuggestions).not.toHaveBeenCalled();
    expect(result.adjusted).toBe(1);
  });

  // AI16 (CODEBASE_ANALYSIS_2026-10-03): the adaptation was computed before
  // the model calls; if its plan moved underneath it, it is dropped whole so
  // its logs are re-adapted from fresh rows rather than applied twice.
  it("drops the adaptation, and only it, when its plan changed during the pass", async () => {
    twoPlannedDays();
    vi.mocked(computePlanAdaptation).mockResolvedValue(adaptation("day-1"));
    vi.mocked(applyPlanAdaptation).mockResolvedValue(0);
    vi.mocked(lockAutoCoachWriteTargets).mockResolvedValue({ dayIds: new Set(), adaptation: true });
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-2", recommendation: "Swap to intervals", rationale: "Variety" }),
    ] as never);

    const result = await triggerAutoCoach("user-1");

    expect(lockAutoCoachWriteTargets).toHaveBeenCalledWith(
      dbMockState.tx,
      "user-1",
      expect.objectContaining({ adaptation: adaptation("day-1") }),
    );
    expect(applyPlanAdaptation).toHaveBeenCalledWith(null, "user-1", dbMockState.tx);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls.map((call) => call[0])).toEqual([
      "day-2",
    ]);
    expect(result.adjusted).toBe(1);
  });

  it("does nothing extra when there is nothing to adapt", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, []);
    vi.mocked(computePlanAdaptation).mockResolvedValue(null);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(applyPlanAdaptation).not.toHaveBeenCalled();
  });
});
