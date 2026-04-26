import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { buildTrainingContext } from "./ai";

vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
    },
    workouts: {
      getExerciseSetsByWorkoutLogs: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getActivePlan: vi.fn(),
    },
    timeline: {
      getTimeline: vi.fn(),
      getUpcomingPlannedDays: vi.fn(),
    },
  },
}));

describe("buildTrainingContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default zeroed context when user has no timeline or plans", async () => {
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([]);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

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
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([
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
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    const timeline = Array.from({ length: 15 }, (_, i) => ({
      status: "completed",
      date: `2026-01-${(i + 1).toString().padStart(2, "0")}`,
      focus: `Focus ${i}`,
      mainWorkout: `Workout ${i}`,
    }));

    vi.mocked(storage.timeline.getTimeline).mockResolvedValue(timeline);

    const result = await buildTrainingContext("user-1");

    expect(result.recentWorkouts.length).toBe(10);
    expect(result.recentWorkouts[0].date).toBe("2026-01-15");
    expect(result.recentWorkouts[9].date).toBe("2026-01-06");
    expect(result.recentWorkouts[0].focus).toBe("Focus 14");
    expect(result.recentWorkouts[0].mainWorkout).toBe("Workout 14");
  });

  it("carries completed athlete notes and upcoming plan-day exercise rows into AI context", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([
      {
        status: "completed",
        date: "2026-01-15",
        focus: "strength",
        mainWorkout: "Logged free text",
        notes: "Felt strong on the last set",
        exerciseSets: [
          {
            exerciseName: "back_squat",
            customLabel: null,
            category: "strength",
            setNumber: 1,
            reps: 5,
            weight: 100,
            distance: null,
            time: null,
            notes: null,
            sortOrder: 0,
          },
        ],
      },
    ]);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      {
        planDayId: "day-1",
        date: "2026-01-16",
        focus: "strength",
        mainWorkout: "Planned free text",
        accessory: "Accessory free text",
        notes: "Plan note",
        exerciseSets: [
          {
            id: "set-1",
            workoutLogId: null,
            planDayId: "day-1",
            exerciseName: "deadlift",
            customLabel: null,
            category: "strength",
            setNumber: 1,
            reps: 3,
            weight: 140,
            distance: null,
            time: null,
            notes: null,
            confidence: 95,
            sortOrder: 0,
          },
        ],
      },
    ] as never);

    const result = await buildTrainingContext("user-1");

    expect(result.recentWorkouts[0]).toEqual(
      expect.objectContaining({
        athleteNote: "Felt strong on the last set",
        exerciseDetails: [expect.objectContaining({ exerciseName: "back_squat", reps: 5, weight: 100 })],
      }),
    );
    expect(result.upcomingWorkouts?.[0]).toEqual(
      expect.objectContaining({
        planDayId: "day-1",
        exerciseDetails: [expect.objectContaining({ exerciseName: "deadlift", reps: 3, weight: 140 })],
      }),
    );
  });

  it("calculates structured exercise stats correctly", async () => {
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);

    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([
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
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([]);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(
      { id: "plan-1", name: "Hyrox Base", totalWeeks: 12, goal: "Complete a sub-1:30 race" } as unknown as Awaited<ReturnType<typeof storage.plans.getActivePlan>>,
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
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLogs).mockResolvedValue([]);

    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([
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
