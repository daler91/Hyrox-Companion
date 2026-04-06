import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import emailRouter from "../email";
import { createTestApp } from "./testUtils";

// Mock storage
vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
    },
  },
}));

// Mock emailScheduler
vi.mock("../../emailScheduler", () => ({
  checkAndSendEmailsForUser: vi.fn(),
  runEmailCronJob: vi.fn(),
}));

// Mock clerkAuth
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe("Email Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    env.CRON_SECRET = "super-secret";
    app = createTestApp(emailRouter);

  });

  describe("GET /api/cron/emails", () => {
    it("should return 401 if CRON_SECRET is not set", async () => {
      env.CRON_SECRET = undefined;
      const response = await request(app)
        .get("/api/v1/cron/emails")
        .set("x-cron-secret", "any-secret");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
    });

    it("should return 401 if secret header is missing", async () => {
      const response = await request(app)
        .get("/api/v1/cron/emails");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
    });

    it("should return 401 if secret is incorrect", async () => {
      const response = await request(app)
        .get("/api/v1/cron/emails")
        .set("x-cron-secret", "wrong-secret");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
    });

    it("should return 200 and run cron job if secret is correct", async () => {
      const mockResult = { usersChecked: 1, emailsSent: 1, details: ["Sent to test@example.com"] };
      const { runEmailCronJob } = await import("../../emailScheduler");
      vi.mocked(runEmailCronJob).mockResolvedValue(mockResult);

      const response = await request(app)
        .get("/api/v1/cron/emails")
        .set("x-cron-secret", "super-secret");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(runEmailCronJob).toHaveBeenCalled();
    });

    it("should return 500 if cron job fails", async () => {
      const { runEmailCronJob } = await import("../../emailScheduler");
      vi.mocked(runEmailCronJob).mockRejectedValue(new Error("Cron failed"));

      const response = await request(app)
        .get("/api/v1/cron/emails")
        .set("x-cron-secret", "super-secret");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    });
  });
});
