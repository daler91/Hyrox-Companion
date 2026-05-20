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
  it("shows one success toast per achievement", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, [achievement()]);

    expect(toast).toHaveBeenCalledWith({
      title: "New PR",
      description: "Back Squat: Max weight 105",
    });
  });

  it("does nothing when there are no improvements", () => {
    const toast = vi.fn();

    toastPersonalRecordAchievements(toast, []);

    expect(toast).not.toHaveBeenCalled();
  });
});
