import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors";

const {
  getUser,
  getWorkoutLog,
  createTestWithAnalysis,
  getTestResultByWorkoutLogId,
  getWorkoutAnalysisByWorkoutLogId,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  getWorkoutLog: vi.fn(),
  createTestWithAnalysis: vi.fn(),
  getTestResultByWorkoutLogId: vi.fn(),
  getWorkoutAnalysisByWorkoutLogId: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    users: { getUser },
    workouts: { getWorkoutLog },
    mafTests: {
      createTestWithAnalysis,
      getTestResultByWorkoutLogId,
      getWorkoutAnalysisByWorkoutLogId,
    },
  },
}));

import { recordMafTestFromWorkout } from "./mafTestService";

const mafUser = { id: "u1", trainingStyleId: "maf_method", mafHr: 145 };

describe("recordMafTestFromWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: workout not yet tagged, so the insert path runs.
    getTestResultByWorkoutLogId.mockResolvedValue(undefined);
    getWorkoutAnalysisByWorkoutLogId.mockResolvedValue(undefined);
    // Echo the persisted rows back, mirroring the atomic write.
    createTestWithAnalysis.mockImplementation((testData, analysisData) =>
      Promise.resolve({
        testResult: { id: "t1", ...testData },
        analysis: analysisData ? { id: "a1", ...analysisData } : null,
      }),
    );
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

  it("writes the test + a compliance analysis atomically when HR is present", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: 150, maxHeartrate: 165 });

    const result = await recordMafTestFromWorkout("u1", "w1", { notes: "5k test" });

    expect(createTestWithAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", protocolType: "fixed_time_run", notes: "5k test" }),
      expect.objectContaining({
        userId: "u1",
        workoutLogId: "w1",
        classification: "over_ceiling",
        compliancePct: 70,
      }),
    );
    expect(result.analysis).not.toBeNull();
    expect(result.created).toBe(true);
  });

  it("writes the test with no analysis when the workout has no HR data", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: null, maxHeartrate: null });

    const result = await recordMafTestFromWorkout("u1", "w1");

    expect(createTestWithAnalysis).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), null);
    expect(result.analysis).toBeNull();
    expect(result.created).toBe(true);
  });

  it("is idempotent: returns the existing record and writes nothing when already tagged", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: 150, maxHeartrate: 165 });
    getTestResultByWorkoutLogId.mockResolvedValue({ id: "t-existing", userId: "u1" });
    getWorkoutAnalysisByWorkoutLogId.mockResolvedValue({ id: "a-existing", userId: "u1", workoutLogId: "w1" });

    const result = await recordMafTestFromWorkout("u1", "w1", { notes: "retry" });

    expect(createTestWithAnalysis).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.testResult).toMatchObject({ id: "t-existing" });
    expect(result.analysis).toMatchObject({ id: "a-existing" });
  });

  it("returns an existing test with null analysis when the original run had no HR", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: 150, maxHeartrate: 165 });
    getTestResultByWorkoutLogId.mockResolvedValue({ id: "t-existing", userId: "u1" });
    getWorkoutAnalysisByWorkoutLogId.mockResolvedValue(undefined);

    const result = await recordMafTestFromWorkout("u1", "w1");

    expect(result.created).toBe(false);
    expect(result.analysis).toBeNull();
  });
});
