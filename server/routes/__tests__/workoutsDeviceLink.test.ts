import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { clearRateLimitBuckets } from "../../routeUtils";
import { makeWorkoutLog } from "../../services/trainingLoadService.testHelpers";
import { registerWorkoutDeviceLinkRoutes } from "../workouts/workoutsDeviceLink.routes";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../middleware/aibudget", async () =>
  (await import("./testUtils")).mockAiBudgetModule(),
);

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    users: ["getUser"],
  }),
);

vi.mock("../../services/deviceActivityLink", () => ({
  linkStandaloneDeviceLog: vi.fn(),
  unlinkDeviceActivity: vi.fn(),
}));

/**
 * The device-link routes are the athlete's override of the sync's matcher, so
 * the contract that matters here is the one the timeline will build on: the
 * body accepts exactly one target, the service is called with the caller's
 * identity (never a body-supplied one), and service conflicts surface as 409.
 */
describe("Workout device-link routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    const router = Router();
    registerWorkoutDeviceLinkRoutes(router);
    app = createTestApp(router);

    const { storage } = await import("../../storage");
    vi.mocked(storage.users.getUser).mockResolvedValue({
      id: "test_user_id",
      distanceUnit: "mi",
    } as never);
  });

  describe("POST /api/v1/workouts/:id/device-link", () => {
    it("merges the import into a plan day for the authenticated athlete", async () => {
      const { linkStandaloneDeviceLog } = await import("../../services/deviceActivityLink");
      vi.mocked(linkStandaloneDeviceLog).mockResolvedValue(
        makeWorkoutLog({ id: "log-1", planDayId: "day-1", deviceLinkSource: "manual" }),
      );

      const res = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ planDayId: "day-1" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: "log-1",
        planDayId: "day-1",
        deviceLinkSource: "manual",
      });
      expect(linkStandaloneDeviceLog).toHaveBeenCalledWith({
        userId: "test_user_id",
        deviceLogId: "import-1",
        target: { planDayId: "day-1" },
      });
    });

    it("merges the import into a workout the athlete logged", async () => {
      const { linkStandaloneDeviceLog } = await import("../../services/deviceActivityLink");
      vi.mocked(linkStandaloneDeviceLog).mockResolvedValue(
        makeWorkoutLog({ id: "log-2", deviceLinkSource: "manual" }),
      );

      const res = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ workoutLogId: "log-2" });

      expect(res.status).toBe(200);
      expect(linkStandaloneDeviceLog).toHaveBeenCalledWith(
        expect.objectContaining({ deviceLogId: "import-1", target: { workoutLogId: "log-2" } }),
      );
    });

    it("rejects a body with neither, both, or an unknown target", async () => {
      const { linkStandaloneDeviceLog } = await import("../../services/deviceActivityLink");

      const neither = await request(app).post("/api/v1/workouts/import-1/device-link").send({});
      expect(neither.status).toBe(400);
      const both = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ planDayId: "day-1", workoutLogId: "log-2" });
      expect(both.status).toBe(400);
      const unknown = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ userId: "someone-else" });
      expect(unknown.status).toBe(400);
      const blank = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ planDayId: "" });
      expect(blank.status).toBe(400);

      expect(linkStandaloneDeviceLog).not.toHaveBeenCalled();
    });

    it("surfaces a service conflict as 409", async () => {
      const { linkStandaloneDeviceLog } = await import("../../services/deviceActivityLink");
      vi.mocked(linkStandaloneDeviceLog).mockRejectedValue(
        new AppError(
          ErrorCode.CONFLICT,
          "This Strava activity is already linked to a workout",
          409,
        ),
      );

      const res = await request(app)
        .post("/api/v1/workouts/import-1/device-link")
        .send({ planDayId: "day-1" });

      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /api/v1/workouts/:id/device-link", () => {
    it("unlinks in the athlete's distance unit and returns both rows", async () => {
      const { unlinkDeviceActivity } = await import("../../services/deviceActivityLink");
      vi.mocked(unlinkDeviceActivity).mockResolvedValue({
        log: makeWorkoutLog({ id: "log-1", stravaActivityId: null }),
        standalone: makeWorkoutLog({
          id: "standalone-1",
          stravaActivityId: "9001",
          source: "strava",
        }),
      });

      const res = await request(app).delete("/api/v1/workouts/log-1/device-link");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        log: { id: "log-1", stravaActivityId: null },
        standalone: { id: "standalone-1", stravaActivityId: "9001", source: "strava" },
      });
      expect(unlinkDeviceActivity).toHaveBeenCalledWith({
        userId: "test_user_id",
        logId: "log-1",
        distanceUnit: "mi",
      });
    });

    it("falls back to kilometres when the athlete has no unit preference", async () => {
      const [{ storage }, { unlinkDeviceActivity }] = await Promise.all([
        import("../../storage"),
        import("../../services/deviceActivityLink"),
      ]);
      vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
      vi.mocked(unlinkDeviceActivity).mockResolvedValue({
        log: null,
        standalone: makeWorkoutLog({ id: "standalone-1" }),
      });

      const res = await request(app).delete("/api/v1/workouts/log-2/device-link");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ log: null, standalone: { id: "standalone-1" } });
      expect(unlinkDeviceActivity).toHaveBeenCalledWith(
        expect.objectContaining({ logId: "log-2", distanceUnit: "km" }),
      );
    });

    it("surfaces a 409 when there is nothing to unlink", async () => {
      const { unlinkDeviceActivity } = await import("../../services/deviceActivityLink");
      vi.mocked(unlinkDeviceActivity).mockRejectedValue(
        new AppError(ErrorCode.CONFLICT, "Workout has no linked Strava activity to remove", 409),
      );

      const res = await request(app).delete("/api/v1/workouts/log-3/device-link");

      expect(res.status).toBe(409);
    });
  });
});
