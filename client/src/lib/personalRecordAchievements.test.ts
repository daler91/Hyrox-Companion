import type { PersonalRecordAchievement } from "@shared/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "./api";
import { toastPersonalRecordAchievements } from "./personalRecordAchievements";
import { queryClient } from "./queryClient";

function achievement(overrides: Partial<PersonalRecordAchievement> = {}): PersonalRecordAchievement {
  return {
    exerciseKey: "back_squat",
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    metric: "maxWeight",
    metricLabel: "Max weight",
    value: 105,
    previousValue: 100,
    date: "2026-05-20",
    workoutLogId: "workout-1",
    ...overrides,
  };
}

describe("toastPersonalRecordAchievements", () => {
  afterEach(() => {
    queryClient.removeQueries({ queryKey: QUERY_KEYS.preferences });
  });

  it("shows one success toast for a single achievement", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, [achievement()]);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: "New PR",
      description: "Back Squat: Max weight 105",
    });
  });

  it("folds several achievements into one toast so none is hidden by the single-toast limit", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, [
      achievement(),
      achievement({ exerciseName: "kettlebell_swings", metricLabel: "Est. 1RM", value: 40 }),
    ]);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: "2 new PRs",
      description: "Back Squat: Max weight 105 · KB Swings: Est. 1RM 40",
    });
  });

  // CL58 (CODEBASE_ANALYSIS_2026-10-03): best time is stored in minutes and
  // printed as decimal minutes ("Best time 3.9" for 3:52); weight and
  // distance had no unit.
  it("reads a best time as a clock, not decimal minutes", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, [
      achievement({ exerciseName: "skierg", category: "functional", metric: "bestTime", metricLabel: "Best time", value: 3 + 52 / 60 }),
    ]);

    expect(toast).toHaveBeenCalledWith({ title: "New PR", description: "SkiErg: Best time 3:52" });
  });

  it("labels weight and distance in the athlete's own units", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(
      toast,
      [
        achievement({ value: 225.5 }),
        achievement({ exerciseName: "sled_push", category: "functional", metric: "maxDistance", metricLabel: "Max distance", value: 164 }),
      ],
      { weightLabel: "lbs", distanceUnit: "miles" },
    );

    expect(toast).toHaveBeenCalledWith({
      title: "2 new PRs",
      description: "Back Squat: Max weight 225.5 lbs · Sled Push: Max distance 164 ft",
    });
  });

  it("takes the units from the athlete's loaded preferences when the caller passes none", () => {
    const toast = vi.fn();
    queryClient.setQueryData(QUERY_KEYS.preferences, { weightUnit: "lbs", distanceUnit: "miles" });

    toastPersonalRecordAchievements(toast, [achievement({ value: 225 })]);

    expect(toast).toHaveBeenCalledWith({ title: "New PR", description: "Back Squat: Max weight 225 lbs" });
  });

  it("leaves the unit off rather than guess one before the preferences have loaded", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, [achievement({ value: 102.25 })]);

    expect(toast).toHaveBeenCalledWith({ title: "New PR", description: "Back Squat: Max weight 102.25" });
  });

  it("does nothing when there are no improvements", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, []);

    expect(toast).not.toHaveBeenCalled();
  });
});
