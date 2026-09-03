import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { assembleTrainingSummary, SUMMARY_COVERAGE_LOOKBACK_DAYS } from "./trainingSummaryService";

vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    timeline: { getCompletedWorkoutDates: vi.fn() },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getExerciseSetsForPersonalRecords: vi.fn(),
    },
  },
}));

// Wednesday 2026-05-20 (UTC). This week's Monday is 2026-05-18.
const NOW = new Date("2026-05-20T12:00:00Z");

describe("assembleTrainingSummary (P4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(storage.users.getUser).mockResolvedValue({ weeklyGoal: 4, userTimezone: "UTC" } as never);
    vi.mocked(storage.timeline.getCompletedWorkoutDates).mockResolvedValue(
      new Set(["2026-05-20", "2026-05-19", "2026-05-18", "2026-05-15"]),
    );
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
      { id: "w1", date: "2026-05-20", focus: "Sled push and run" },
      { id: "w2", date: "2026-05-19", focus: "Strength" },
      { id: "w3", date: "2026-05-15", focus: "SkiErg intervals" },
    ] as never);
    vi.mocked(storage.analytics.getExerciseSetsForPersonalRecords).mockResolvedValue([
      { workoutLogId: "w2", date: "2026-05-19", exerciseName: "back_squat", customLabel: null },
    ] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reads a bounded window and never the all-time history", async () => {
    await assembleTrainingSummary("user-1");

    const windowStart = "2025-11-21"; // 180 days before 2026-05-20
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("user-1", windowStart, "2026-05-20");
    expect(storage.analytics.getExerciseSetsForPersonalRecords).toHaveBeenCalledWith("user-1", windowStart, "2026-05-20");
    expect(SUMMARY_COVERAGE_LOOKBACK_DAYS).toBe(180);
  });

  it("computes streak, this week's count, goal and station coverage from the slim reads", async () => {
    const summary = await assembleTrainingSummary("user-1");

    expect(summary.currentStreak).toBe(3);
    expect(summary.weeklyCompletedWorkouts).toBe(2);
    expect(summary.weeklyGoal).toBe(4);
    expect(summary.coverageLookbackDays).toBe(180);

    const byStation = new Map(summary.stationCoverage.map((entry) => [entry.station, entry]));
    expect(byStation.get("sled_push")).toEqual({ station: "sled_push", lastTrained: "2026-05-20", daysSince: 0 });
    expect(byStation.get("skierg")).toEqual({ station: "skierg", lastTrained: "2026-05-15", daysSince: 5 });
    expect(byStation.get("rowing")?.lastTrained).toBeNull();
  });

  it("falls back to the default weekly goal and UTC for an athlete without preferences", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(storage.timeline.getCompletedWorkoutDates).mockResolvedValue(new Set());
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
    vi.mocked(storage.analytics.getExerciseSetsForPersonalRecords).mockResolvedValue([]);

    const summary = await assembleTrainingSummary("user-1");

    expect(summary).toMatchObject({ currentStreak: 0, weeklyCompletedWorkouts: 0, weeklyGoal: 5 });
    expect(summary.stationCoverage.every((entry) => entry.lastTrained === null)).toBe(true);
  });
});
