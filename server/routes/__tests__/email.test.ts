import type { Request, Response, NextFunction } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import emailRouter from "../email";

// Mock storage
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
  },
}));

// Mock emailScheduler
vi.mock("../../emailScheduler", () => ({
  checkAndSendEmailsForUser: vi.fn(),
  runEmailCronJob: vi.fn(),
}));

// Mock clerkAuth
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Request, res: Response, next: NextFunction) => next(),
}));

describe("Email Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "super-secret";
    app = express();
    app.use(express.json());
    app.use(emailRouter);
  });

  describe("GET /api/cron/emails", () => {
    it("should return 401 if CRON_SECRET is not set", async () => {
      delete process.env.CRON_SECRET;
      const response = await request(app)
        .get("/api/cron/emails")
        .set("x-cron-secret", "any-secret");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 if secret header is missing", async () => {
      const response = await request(app)
        .get("/api/cron/emails");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 if secret is incorrect", async () => {
      const response = await request(app)
        .get("/api/cron/emails")
        .set("x-cron-secret", "wrong-secret");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should return 200 and run cron job if secret is correct", async () => {
      const mockResult = { usersChecked: 1, emailsSent: 1, details: ["Sent to test@example.com"] };
      const { runEmailCronJob } = await import("../../emailScheduler");
      vi.mocked(runEmailCronJob).mockResolvedValue(mockResult);

      const response = await request(app)
        .get("/api/cron/emails")
        .set("x-cron-secret", "super-secret");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(runEmailCronJob).toHaveBeenCalled();
    });

    it("should return 500 if cron job fails", async () => {
      const { runEmailCronJob } = await import("../../emailScheduler");
      vi.mocked(runEmailCronJob).mockRejectedValue(new Error("Cron failed"));

      const response = await request(app)
        .get("/api/cron/emails")
        .set("x-cron-secret", "super-secret");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Cron job failed" });
    });
  });
});
