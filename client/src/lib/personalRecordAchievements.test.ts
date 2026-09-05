import type { PersonalRecordAchievement } from "@shared/schema";
import { describe, expect, it, vi } from "vitest";

import { toastPersonalRecordAchievements } from "./personalRecordAchievements";

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

  it("does nothing when there are no improvements", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, []);

    expect(toast).not.toHaveBeenCalled();
  });
});
