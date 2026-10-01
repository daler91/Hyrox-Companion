import type { PlanDay, SessionGrade, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { loadFocusedWorkout } from "./focusedWorkoutService";
import { gradeWorkoutLogs } from "./sessionGrades/sessionGradeService";

vi.mock("../storage", () => ({
  storage: {
    plans: { getPlanDay: vi.fn() },
    workouts: {
      getWorkoutLog: vi.fn(),
      getExerciseSetsByPlanDay: vi.fn(),
      getExerciseSetsByWorkoutLog: vi.fn(),
    },
  },
}));

vi.mock("./sessionGrades/sessionGradeService", () => ({
  gradeWorkoutLogs: vi.fn(),
}));

const DAY = { id: "day-1", focus: "Threshold Run" } as PlanDay;
const LOG = { id: "log-1", planDayId: "day-1" } as WorkoutLog;
const GRADE = { workoutLogId: "log-1", headline: "Threshold held" } as SessionGrade;

describe("loadFocusedWorkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog).mockResolvedValue([]);
    vi.mocked(gradeWorkoutLogs).mockResolvedValue(new Map());
  });

  it("does nothing without an id", async () => {
    expect(await loadFocusedWorkout("user-1", {})).toBeNull();
    expect(storage.plans.getPlanDay).not.toHaveBeenCalled();
  });

  it("loads a plan day through the ownership-checked getter", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(DAY);

    const focused = await loadFocusedWorkout("user-1", { planDayId: "day-1" });

    expect(storage.plans.getPlanDay).toHaveBeenCalledWith("day-1", "user-1");
    expect(focused?.planDay).toBe(DAY);
    expect(focused?.log).toBeUndefined();
    expect(gradeWorkoutLogs).not.toHaveBeenCalled();
  });

  it("loads a log, its plan day by the log's link, its sets and its grade", async () => {
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(LOG);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(DAY);
    vi.mocked(gradeWorkoutLogs).mockResolvedValue(new Map([["log-1", GRADE]]));

    const focused = await loadFocusedWorkout("user-1", { workoutLogId: "log-1" });

    expect(storage.workouts.getWorkoutLog).toHaveBeenCalledWith("log-1", "user-1");
    expect(storage.plans.getPlanDay).toHaveBeenCalledWith("day-1", "user-1");
    expect(storage.workouts.getExerciseSetsByWorkoutLog).toHaveBeenCalledWith("log-1");
    expect(focused).toMatchObject({ planDay: DAY, log: LOG, grade: GRADE });
  });

  it("returns nothing for ids that aren't the athlete's", async () => {
    // The getters, reset before each test, find neither id.
    expect(await loadFocusedWorkout("user-1", { planDayId: "day-x", workoutLogId: "log-x" })).toBeNull();
    expect(storage.workouts.getWorkoutLog).toHaveBeenCalledWith("log-x", "user-1");
    expect(storage.plans.getPlanDay).toHaveBeenCalledWith("day-x", "user-1");
    // Never reads sets for a log it couldn't verify.
    expect(storage.workouts.getExerciseSetsByWorkoutLog).not.toHaveBeenCalled();
  });

  it("fails open when a read fails", async () => {
    vi.mocked(storage.plans.getPlanDay).mockRejectedValue(new Error("db down"));

    expect(await loadFocusedWorkout("user-1", { planDayId: "day-1" })).toBeNull();
  });
});
