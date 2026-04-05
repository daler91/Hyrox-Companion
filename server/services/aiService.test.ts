import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildTrainingContext } from "./ai";
import { storage } from "../storage";

vi.mock("../storage", () => ({
  storage: {
    getTimeline: vi.fn(),
    listTrainingPlans: vi.fn(),
    getActivePlan: vi.fn(),
    getExerciseSetsByWorkoutLogs: vi.fn(),
    getUser: vi.fn(),
    getUpcomingPlannedDays: vi.fn(),
  },
}));

describe("buildTrainingContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(storage.getUser).mockResolvedValue(undefined);
    vi.mocked(storage.getUpcomingPlannedDays).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default zeroed context when user has no timeline or plans", async () => {
    vi.mocked(storage.getTimeline).mockResolvedValue([]);
    vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    const result = await buildTrainingContext("user-1");

    expect(result).toEqual({
      totalWorkouts: 0,
      completedWorkouts: 0,
      plannedWorkouts: 0,
      missedWorkouts: 0,
      skippedWorkouts: 0,
      completionRate: 0,
      currentStreak: 0,
      weeklyGoal: undefined,
      recentWorkouts: [],
      upcomingWorkouts: [],
      exerciseBreakdown: {},
      structuredExerciseStats: undefined,
      activePlan: undefined,
      coachingInsights: expect.objectContaining({
        rpeTrend: "insufficient_data",
        fatigueFlag: false,
        undertrainingFlag: false,
        progressionFlags: [],
      }),
    });
  });

  it("calculates basic stats and completion rate correctly", async () => {
    vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.getTimeline).mockResolvedValue([
      { status: "completed", date: "2026-01-15", focus: "running" },
      { status: "completed", date: "2026-01-14", focus: "strength" },
      { status: "missed", date: "2026-01-13" },
      { status: "skipped", date: "2026-01-12" },
      { status: "planned", date: "2026-01-16" },
    ]);

    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

    const result = await buildTrainingContext("user-1");

    expect(result.totalWorkouts).toBe(5);
    expect(result.completedWorkouts).toBe(2);
    expect(result.missedWorkouts).toBe(1);
    expect(result.skippedWorkouts).toBe(1);
    expect(result.plannedWorkouts).toBe(1);
    expect(result.completionRate).toBe(50);
    expect(result.currentStreak).toBe(2);
  });

  it("collects and sorts recent workouts, maintaining a max limit of 10", async () => {
    vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    const timeline = Array.from({ length: 15 }, (_, i) => ({
      status: "completed",
      date: `2026-01-${(i + 1).toString().padStart(2, "0")}`,
      focus: `Focus ${i}`,
      mainWorkout: `Workout ${i}`,
    }));

    vi.mocked(storage.getTimeline).mockResolvedValue(timeline);

    const result = await buildTrainingContext("user-1");

    expect(result.recentWorkouts.length).toBe(10);
    expect(result.recentWorkouts[0].date).toBe("2026-01-15");
    expect(result.recentWorkouts[9].date).toBe("2026-01-06");
    expect(result.recentWorkouts[0].focus).toBe("Focus 14");
    expect(result.recentWorkouts[0].mainWorkout).toBe("Workout 14");
  });

  it("calculates structured exercise stats correctly", async () => {
    vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);

    vi.mocked(storage.getTimeline).mockResolvedValue([
      {
        status: "completed",
        date: "2026-01-15",
        workoutLogId: "log-1",
        exerciseSets: [
          { exerciseName: "back_squat", weight: 100, reps: 5, setNumber: 1, sortOrder: 0, distance: null, time: null, workoutLogId: "log-1" },
          { exerciseName: "back_squat", weight: 120, reps: 3, setNumber: 2, sortOrder: 1, distance: null, time: null, workoutLogId: "log-1" },
        ]
      },
      {
        status: "completed",
        date: "2026-01-14",
        workoutLogId: "log-2",
        exerciseSets: [
          { exerciseName: "running", distance: 5000, time: 1500, setNumber: 1, sortOrder: 0, weight: null, reps: null, workoutLogId: "log-2" },
        ]
      },
    ]);

    const result = await buildTrainingContext("user-1");

    expect(result.structuredExerciseStats).toBeDefined();

    const stats = result.structuredExerciseStats!;
    expect(stats["back_squat"]).toBeDefined();
    expect(stats["back_squat"].count).toBe(2);
    expect(stats["back_squat"].maxWeight).toBe(120);
    expect(stats["back_squat"].avgReps).toBe(4);

    expect(stats["running"]).toBeDefined();
    expect(stats["running"].count).toBe(1);
    expect(stats["running"].maxDistance).toBe(5000);
    expect(stats["running"].bestTime).toBe(1500);
  });

  it("populates active plan correctly", async () => {
    vi.mocked(storage.getTimeline).mockResolvedValue([]);
    vi.mocked(storage.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.getActivePlan).mockResolvedValue(
      { id: "plan-1", name: "Hyrox Base", totalWeeks: 12, goal: "Complete a sub-1:30 race" } as unknown as Awaited<ReturnType<typeof storage.getActivePlan>>,
    );

    const result = await buildTrainingContext("user-1");

    expect(result.activePlan).toEqual({
      name: "Hyrox Base",
      totalWeeks: 12,
      currentWeek: 1,
      goal: "Complete a sub-1:30 race",
    });
  });

  it("calculates exercise breakdown matching functional exercises", async () => {
    vi.mocked(storage.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.getTimeline).mockResolvedValue([
      { status: "completed", focus: "did some wall balls today" },
      { status: "completed", focus: "burpees are awful" },
      { status: "completed", focus: "custom movement" },
    ]);

    const result = await buildTrainingContext("user-1");

    expect(result.exerciseBreakdown).toBeDefined();
    expect(result.exerciseBreakdown["wall balls"]).toBe(1); // 'wall balls' is in FUNCTIONAL_EXERCISES
    expect(result.exerciseBreakdown["burpees"]).toBe(1); // 'burpees' is in FUNCTIONAL_EXERCISES
    expect(result.exerciseBreakdown["custom movement"]).toBe(1);
  });
});
