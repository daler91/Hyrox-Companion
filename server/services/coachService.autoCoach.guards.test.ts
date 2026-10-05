import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { generateReviewNotes, generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { lockAutoCoachWriteTargets } from "./autoCoachWriteGuard";
import { triggerAutoCoach } from "./coachService";
import { dbMockState } from "./coachService.dbMockState";
import {
  makeSuggestion,
  makeTimelineEntry,
  mockBaseAutoCoachDeps,
  mockEnabledUser,
} from "./coachService.testFixtures";

describe("coachService triggerAutoCoach guards", () => {
  it("returns 0 and resets flag when user has aiCoachEnabled=false", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: false });
    vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  it("returns 0 and resets flag when user is not found", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  it("returns 0 when no upcoming planned workouts exist", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, []);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  it("resets isAutoCoaching flag even when an error occurs", async () => {
    mockEnabledUser(storage);
    vi.mocked(buildTrainingContext).mockRejectedValue(new Error("AI service down"));

    await expect(triggerAutoCoach("user-1")).rejects.toThrow("AI service down");
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", true);
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  it("resets isAutoCoaching flag when getUser throws", async () => {
    vi.mocked(storage.users.getUser).mockRejectedValue(new Error("DB down"));
    vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);

    await expect(triggerAutoCoach("user-1")).rejects.toThrow("DB down");
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  it("resets isAutoCoaching flag when checkAiBudget throws", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true });
    vi.mocked(storage.users.updateIsAutoCoaching).mockResolvedValue(undefined);
    vi.mocked(storage.aiUsage.getDailyTotalCents).mockRejectedValueOnce(new Error("budget svc down"));

    await expect(triggerAutoCoach("user-1")).rejects.toThrow("budget svc down");
    expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false);
  });

  // AI16 (CODEBASE_ANALYSIS_2026-10-03): the pass writes from a snapshot taken
  // before tens of seconds of model calls. A day the athlete edited meanwhile
  // must keep the athlete's edit.
  it("leaves alone a day that changed after the pass took its snapshot", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ planDayId: "day-1" }),
      makeTimelineEntry({ planDayId: "day-2", date: "2026-01-17" }),
      makeTimelineEntry({ planDayId: "day-3", date: "2026-01-18" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "day-1", recommendation: "4x5 Squats @ 80%" }),
      makeSuggestion({ workoutId: "day-2", recommendation: "5km tempo" }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValue([
      { workoutId: "day-3", note: "On track." },
    ]);
    vi.mocked(lockAutoCoachWriteTargets).mockResolvedValue({
      dayIds: new Set(["day-1", "day-3"]),
      adaptation: false,
    });
    vi.mocked(storage.plans).updatePlanDay.mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 1 });
    // Every day the pass writes is checked, inside the write transaction.
    const [tx, userId, targets] = vi.mocked(lockAutoCoachWriteTargets).mock.calls[0];
    expect(tx).toBe(dbMockState.tx);
    expect(userId).toBe("user-1");
    expect(targets.days.map((day) => day.id).sort()).toEqual(["day-1", "day-2", "day-3"]);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls.map((call) => call[0])).toEqual([
      "day-2",
    ]);
  });

  // AI29 (CODEBASE_ANALYSIS_2026-10-03): a shakeout carries the race date's
  // generated text, not the stored prescription. An append saved that text
  // plus the cue over the day's own workout.
  it("shows the model a race-derived day but never writes to it", async () => {
    const shakeoutText =
      "Pre-race shakeout: 10-15 min easy jog, light mobility, and 3-4 short strides. Keep it very light.";
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ planDayId: "day-1" }),
      makeTimelineEntry({
        planDayId: "shakeout-day",
        date: "2026-01-17",
        focus: "Shakeout",
        mainWorkout: shakeoutText,
        raceDerived: true,
      }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({
        workoutId: "shakeout-day",
        action: "append",
        recommendation: "Add 4x20s strides",
        rationale: "Sharpen up for race day",
      }),
    ]);
    vi.mocked(generateReviewNotes).mockResolvedValueOnce([
      { workoutId: "day-1", note: "On track." },
      { workoutId: "shakeout-day", note: "Keep it light." },
    ]);
    vi.mocked(storage.plans).updatePlanDay.mockResolvedValue({});

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    const [, promptDays] = vi.mocked(generateWorkoutSuggestions).mock.calls[0];
    expect(promptDays).toContainEqual(
      expect.objectContaining({ id: "shakeout-day", mainWorkout: shakeoutText, raceDerived: true }),
    );
    // No review note for it either: the timeline hides coach notes there.
    expect(vi.mocked(generateReviewNotes).mock.calls[0][1].map((day) => day.id)).toEqual(["day-1"]);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls.map((call) => call[0])).toEqual([
      "day-1",
    ]);
  });

  it("skips suggestions with missing workoutId or recommendation", async () => {
    mockBaseAutoCoachDeps(storage, buildTrainingContext, [
      makeTimelineEntry({ focus: "Running", mainWorkout: "5km" }),
    ]);
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue([
      makeSuggestion({ workoutId: "", recommendation: "test" }),
      makeSuggestion({ workoutId: "day-1", recommendation: "" }),
    ]);

    expect(await triggerAutoCoach("user-1")).toEqual({ adjusted: 0 });
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
  });
});
