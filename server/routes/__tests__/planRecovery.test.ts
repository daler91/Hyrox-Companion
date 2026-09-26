import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { clearRateLimitBuckets } from "../../routeUtils";
import { applyMissedSessionRecovery, getMissedSessionRecoveryPreview } from "../../services/missedRecovery";
import planRecoveryRouter from "../planRecovery";
import { createTestApp, TEST_USER_ID } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../middleware/aibudget", async () => (await import("./testUtils")).mockAiBudgetModule());
vi.mock("../../services/missedRecovery", () => ({
  getMissedSessionRecoveryPreview: vi.fn(),
  applyMissedSessionRecovery: vi.fn(),
}));

const PATH = "/api/v1/plans/days/day-1/recovery";

describe("missed-session recovery routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(planRecoveryRouter);
  });

  describe("GET /api/v1/plans/days/:dayId/recovery", () => {
    it("returns the preview for the athlete's own day", async () => {
      const preview = { planDayId: "day-1", recommendation: { action: "let_go", targetDate: null, reason: "Optional." } };
      vi.mocked(getMissedSessionRecoveryPreview).mockResolvedValue(preview as never);

      const response = await request(app).get(PATH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(preview);
      expect(getMissedSessionRecoveryPreview).toHaveBeenCalledWith(TEST_USER_ID, "day-1");
    });

    it("passes the service's 404 and 409 through", async () => {
      vi.mocked(getMissedSessionRecoveryPreview).mockRejectedValueOnce(
        new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404),
      );
      const missing = await request(app).get(PATH);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(ErrorCode.NOT_FOUND);

      vi.mocked(getMissedSessionRecoveryPreview).mockRejectedValueOnce(
        new AppError(ErrorCode.CONFLICT, "This session isn't missed", 409),
      );
      const notMissed = await request(app).get(PATH);
      expect(notMissed.status).toBe(409);
      expect(notMissed.body.code).toBe(ErrorCode.CONFLICT);
    });
  });

  describe("POST /api/v1/plans/days/:dayId/recovery", () => {
    it("applies a fold to the chosen day and returns the updated day", async () => {
      const day = { id: "day-1", scheduledDate: "2026-09-25", status: "planned", recovery: "folded" };
      vi.mocked(applyMissedSessionRecovery).mockResolvedValue(day as never);

      const response = await request(app).post(PATH).send({ action: "fold", targetDate: "2026-09-25" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ day });
      expect(applyMissedSessionRecovery).toHaveBeenCalledWith(TEST_USER_ID, "day-1", {
        action: "fold",
        targetDate: "2026-09-25",
      });
    });

    it("accepts let go and reopen without a date", async () => {
      vi.mocked(applyMissedSessionRecovery).mockResolvedValue({ id: "day-1" } as never);

      expect((await request(app).post(PATH).send({ action: "let_go" })).status).toBe(200);
      expect((await request(app).post(PATH).send({ action: "reopen" })).status).toBe(200);
      expect(vi.mocked(applyMissedSessionRecovery).mock.calls.map((call) => call[2])).toEqual([
        { action: "let_go" },
        { action: "reopen" },
      ]);
    });

    it.each([
      ["an unknown action", { action: "reschedule" }],
      ["a fold without a day", { action: "fold" }],
      ["a malformed day", { action: "shorten", targetDate: "25/09/2026" }],
      ["a day on let go", { action: "let_go", targetDate: "2026-09-25" }],
      ["a status smuggled in", { action: "fold", targetDate: "2026-09-25", status: "completed" }],
    ])("rejects %s", async (_label, body) => {
      const response = await request(app).post(PATH).send(body);
      expect(response.status).toBe(400);
      expect(applyMissedSessionRecovery).not.toHaveBeenCalled();
    });

    it("passes a stale decision's conflict through", async () => {
      vi.mocked(applyMissedSessionRecovery).mockRejectedValue(
        new AppError(ErrorCode.CONFLICT, "This session changed while you were deciding.", 409),
      );

      const response = await request(app).post(PATH).send({ action: "let_go" });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(ErrorCode.CONFLICT);
    });
  });
});
