import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors";

const { getUser, getWorkoutLog, createTestResult, createWorkoutAnalysis } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getWorkoutLog: vi.fn(),
  createTestResult: vi.fn(),
  createWorkoutAnalysis: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    users: { getUser },
    workouts: { getWorkoutLog },
    mafTests: { createTestResult, createWorkoutAnalysis },
  },
}));

import { recordMafTestFromWorkout } from "./mafTestService";

const mafUser = { id: "u1", trainingStyleId: "maf_method", mafHr: 145 };

describe("recordMafTestFromWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestResult.mockImplementation((d) => Promise.resolve({ id: "t1", ...d }));
    createWorkoutAnalysis.mockImplementation((d) => Promise.resolve({ id: "a1", ...d }));
  });

  it("rejects when the user isn't on MAF / has no ceiling", async () => {
    getUser.mockResolvedValue({ id: "u1", trainingStyleId: "balanced_default", mafHr: null });
    await expect(recordMafTestFromWorkout("u1", "w1")).rejects.toBeInstanceOf(AppError);
    expect(getWorkoutLog).not.toHaveBeenCalled();
  });

  it("404s when the workout isn't found / owned", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue(undefined);
    await expect(recordMafTestFromWorkout("u1", "w1")).rejects.toMatchObject({ status: 404 });
  });

  it("records a test result + a compliance analysis when HR is present", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: 150, maxHeartrate: 165 });

    const result = await recordMafTestFromWorkout("u1", "w1", { notes: "5k test" });

    expect(createTestResult).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", protocolType: "fixed_time_run", notes: "5k test" }),
    );
    expect(createWorkoutAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        workoutLogId: "w1",
        classification: "over_ceiling",
        compliancePct: 70,
      }),
    );
    expect(result.analysis).not.toBeNull();
  });

  it("records the test but skips analysis when the workout has no HR data", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: null, maxHeartrate: null });

    const result = await recordMafTestFromWorkout("u1", "w1");

    expect(createTestResult).toHaveBeenCalledOnce();
    expect(createWorkoutAnalysis).not.toHaveBeenCalled();
    expect(result.analysis).toBeNull();
  });
});
