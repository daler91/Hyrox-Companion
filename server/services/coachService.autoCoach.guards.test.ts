import "./coachService.testSetup";

import { describe, expect, it, vi } from "vitest";

import { generateWorkoutSuggestions } from "../gemini/index";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { triggerAutoCoach } from "./coachService";
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
