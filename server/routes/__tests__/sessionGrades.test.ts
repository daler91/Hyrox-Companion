import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { makeGrade } from "../../services/sessionGrades/testFixtures";
import { makeWorkoutLog } from "../../services/trainingLoadService.testHelpers";
import sessionGradesRouter from "../sessionGrades";
import { createTestApp, resetRouteTestState, TEST_USER_ID } from "./testUtils";

const mocks = vi.hoisted(() => ({
  buildPlanSessionGrades: vi.fn(),
  gradeWorkoutLogs: vi.fn(),
  requestSessionStreamForLog: vi.fn(),
}));

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({ workouts: ["getWorkoutLog"] }),
);
vi.mock("../../services/sessionGrades/sessionGradeService", () => ({
  buildPlanSessionGrades: mocks.buildPlanSessionGrades,
  gradeWorkoutLogs: mocks.gradeWorkoutLogs,
}));
vi.mock("../../services/sessionStreamHooks", () => ({
  requestSessionStreamForLog: mocks.requestSessionStreamForLog,
}));

import { storage } from "../../storage";

const EMPTY = { plan: null, sessions: [], weeks: [], blocks: [], totals: null };

describe("session grade routes", () => {
  const app = createTestApp(sessionGradesRouter);

  beforeEach(async () => {
    await resetRouteTestState();
    vi.resetAllMocks();
    mocks.buildPlanSessionGrades.mockResolvedValue(EMPTY);
    mocks.gradeWorkoutLogs.mockResolvedValue(new Map());
  });

  describe("GET /api/v1/session-grades", () => {
    it("grades the active plan by default", async () => {
      const res = await request(app).get("/api/v1/session-grades");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(EMPTY);
      expect(mocks.buildPlanSessionGrades).toHaveBeenCalledWith(storage, TEST_USER_ID, undefined);
    });

    it("grades the plan it is asked for", async () => {
      await request(app).get("/api/v1/session-grades?planId=plan-7");
      expect(mocks.buildPlanSessionGrades).toHaveBeenCalledWith(storage, TEST_USER_ID, "plan-7");
    });

    it("rejects an unknown query parameter or an empty plan id", async () => {
      expect((await request(app).get("/api/v1/session-grades?planId=")).status).toBe(400);
      expect((await request(app).get("/api/v1/session-grades?week=1")).status).toBe(400);
    });

    it("passes a plan that is not the athlete's through as a 404", async () => {
      mocks.buildPlanSessionGrades.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, "Training plan not found", 404));
      expect((await request(app).get("/api/v1/session-grades?planId=x")).status).toBe(404);
    });
  });

  describe("GET /api/v1/workouts/:id/session-grade", () => {
    it("404s a workout that is not the athlete's", async () => {
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(undefined);
      const res = await request(app).get("/api/v1/workouts/nope/session-grade");
      expect(res.status).toBe(404);
      expect(mocks.gradeWorkoutLogs).not.toHaveBeenCalled();
    });

    it("returns a null grade for a workout we do not grade", async () => {
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(makeWorkoutLog({ id: "w1" }));
      const res = await request(app).get("/api/v1/workouts/w1/session-grade");
      expect(res.body).toEqual({ grade: null });
      expect(mocks.requestSessionStreamForLog).not.toHaveBeenCalled();
    });

    it("returns the grade, and nudges the stream fetcher while it is pending", async () => {
      const log = makeWorkoutLog({ id: "w1", planDayId: "d1", stravaActivityId: "9" });
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(log);
      const grade = makeGrade({ workoutLogId: "w1", streamStatus: "pending", dataSource: "summary" });
      mocks.gradeWorkoutLogs.mockResolvedValue(new Map([["w1", grade]]));

      const res = await request(app).get("/api/v1/workouts/w1/session-grade");

      expect(res.status).toBe(200);
      expect(res.body.grade).toMatchObject({ workoutLogId: "w1", verdict: "on_target", streamStatus: "pending" });
      expect(storage.workouts.getWorkoutLog).toHaveBeenCalledWith("w1", TEST_USER_ID);
      expect(mocks.requestSessionStreamForLog).toHaveBeenCalledWith(storage, TEST_USER_ID, log, "read");
    });

    it("does not nudge once the stream is in", async () => {
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(makeWorkoutLog({ id: "w1", planDayId: "d1" }));
      mocks.gradeWorkoutLogs.mockResolvedValue(new Map([["w1", makeGrade({ workoutLogId: "w1" })]]));
      await request(app).get("/api/v1/workouts/w1/session-grade");
      expect(mocks.requestSessionStreamForLog).not.toHaveBeenCalled();
    });
  });
});
