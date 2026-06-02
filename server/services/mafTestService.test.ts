import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors";

const {
  getUser,
  getWorkoutLog,
  createTestWithAnalysis,
  updateTestWithAnalysis,
  getTestResultByWorkoutLogId,
  getWorkoutAnalysisByWorkoutLogId,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  getWorkoutLog: vi.fn(),
  createTestWithAnalysis: vi.fn(),
  updateTestWithAnalysis: vi.fn(),
  getTestResultByWorkoutLogId: vi.fn(),
  getWorkoutAnalysisByWorkoutLogId: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    users: { getUser },
    workouts: { getWorkoutLog },
    mafTests: {
      createTestWithAnalysis,
      updateTestWithAnalysis,
      getTestResultByWorkoutLogId,
      getWorkoutAnalysisByWorkoutLogId,
    },
  },
}));

import { recordMafTestFromWorkout, updateMafTestForWorkout } from "./mafTestService";

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

  it("applies manual metrics and scores them even when the workout has no HR", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: null, avgHeartrate: null, maxHeartrate: null, distanceMeters: null });

    const result = await recordMafTestFromWorkout("u1", "w1", {
      metrics: { avgHeartRate: 142, maxHeartRate: 150, durationSeconds: 1710, distanceMeters: 5000 },
    });

    expect(createTestWithAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolType: "fixed_time_run", // inferred from the manual duration
        metrics: {
          avgHeartRate: 142,
          maxHeartRate: 150,
          durationSeconds: 1710,
          distanceMeters: 5000,
          mafCeilingUsed: 145,
        },
      }),
      expect.objectContaining({ workoutLogId: "w1", compliancePct: 100, classification: "compliant" }),
    );
    expect(result.analysis).not.toBeNull();
    expect(result.created).toBe(true);
  });

  it("lets a manual field override the workout value while omitted fields fall back", async () => {
    getUser.mockResolvedValue(mafUser);
    getWorkoutLog.mockResolvedValue({ id: "w1", duration: 1800, avgHeartrate: 150, maxHeartrate: 165, distanceMeters: 5000 });

    // Only avg HR supplied: it overrides 150; max/duration/distance fall back.
    await recordMafTestFromWorkout("u1", "w1", { metrics: { avgHeartRate: 140 } });

    expect(createTestWithAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: { avgHeartRate: 140, maxHeartRate: 165, durationSeconds: 1800, distanceMeters: 5000, mafCeilingUsed: 145 },
      }),
      expect.objectContaining({ classification: "mostly_compliant", compliancePct: 85 }),
    );
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

describe("updateMafTestForWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue(mafUser);
    updateTestWithAnalysis.mockImplementation((userId, workoutLogId, patch, analysisData) =>
      Promise.resolve({
        testResult: { id: "t1", userId, ...patch },
        analysis: analysisData ? { id: "a1", ...analysisData } : null,
      }),
    );
  });

  it("404s when the workout isn't tagged", async () => {
    getTestResultByWorkoutLogId.mockResolvedValue(undefined);

    await expect(
      updateMafTestForWorkout("u1", "w1", { metrics: { avgHeartRate: 140 } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(updateTestWithAnalysis).not.toHaveBeenCalled();
  });

  it("merges edits over the stored metrics and recomputes the analysis", async () => {
    getTestResultByWorkoutLogId.mockResolvedValue({
      id: "t1",
      userId: "u1",
      metrics: { durationSeconds: 1800, distanceMeters: 5000, avgHeartRate: 150, maxHeartRate: 160, mafCeilingUsed: 145 },
    });

    const result = await updateMafTestForWorkout("u1", "w1", { metrics: { avgHeartRate: 140 } });

    expect(updateTestWithAnalysis).toHaveBeenCalledWith(
      "u1",
      "w1",
      expect.objectContaining({
        metrics: { durationSeconds: 1800, distanceMeters: 5000, avgHeartRate: 140, maxHeartRate: 160, mafCeilingUsed: 145 },
      }),
      expect.objectContaining({ workoutLogId: "w1", classification: "mostly_compliant", compliancePct: 85 }),
    );
    expect(result.created).toBe(false);
    expect(result.analysis).not.toBeNull();
  });

  it("drops the analysis when the average HR is cleared", async () => {
    getTestResultByWorkoutLogId.mockResolvedValue({
      id: "t1",
      userId: "u1",
      metrics: { durationSeconds: 1800, distanceMeters: 5000, avgHeartRate: 150, maxHeartRate: 160, mafCeilingUsed: 145 },
    });

    const result = await updateMafTestForWorkout("u1", "w1", { metrics: { avgHeartRate: null } });

    expect(updateTestWithAnalysis).toHaveBeenCalledWith("u1", "w1", expect.anything(), null);
    expect(result.analysis).toBeNull();
  });
});
