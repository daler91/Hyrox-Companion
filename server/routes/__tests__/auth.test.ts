import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import authRouter from "../auth";
import { createTestApp } from "./testUtils";

const { TEST_USER_ID } = vi.hoisted(() => ({ TEST_USER_ID: "test_user_id" }));
const ENDPOINT_URL = "/api/v1/auth/user";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: TEST_USER_ID };
    next();
  },
}));

// Mock the getUserId function to return our test user. The default is passed
// as vi.fn(impl) so the vi.resetAllMocks() in beforeEach restores it after a
// test overrides it (e.g. with a throwing implementation) — a chained
// .mockReturnValue() default would be wiped by the reset instead.
vi.mock("../../types", () => ({
  getUserId: vi.fn(() => TEST_USER_ID),
}));

// Mock the storage functions
vi.mock("../../logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    users: ["getUser"],
  }),
);

describe("Auth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(authRouter);

  });

  describe(`GET ${ENDPOINT_URL}`, () => {
    it("should return the user data when user exists", async () => {
      const mockUser = {
        id: 1,
        userId: TEST_USER_ID,
        email: "test@example.com",
        createdAt: "2024-03-10",
      };
      vi.mocked(storage.users.getUser).mockResolvedValue(mockUser);

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(200);
      expect(storage.users.getUser).toHaveBeenCalledWith(TEST_USER_ID);
      expect(response.body).toEqual(mockUser);
    });

    it("should return 500 when storage throws an error", async () => {
      vi.mocked(storage.users.getUser).mockRejectedValue(new Error("Database error"));

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });

    });

    it("should return 500 when getUserId throws an error", async () => {
      vi.mocked(getUserId).mockImplementation(() => {
        throw new Error("User not authenticated");
      });

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });

    });

    // C5 (CODEBASE_ANALYSIS_2026-10-03): the client polls this route every 2 s
    // while the auto-coach runs. A minute of that (30 polls) plus a few
    // ordinary refetches must not 429; the old 20/min cap failed at poll 21.
    it("serves a full minute of 2 s auto-coach polling without a 429", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        statuses.push((await request(app).get(ENDPOINT_URL)).status);
      }

      expect(statuses.filter((status) => status !== 200)).toEqual([]);
    });

    it("still rate-limits the route past 60 requests a minute", async () => {
      for (let i = 0; i < 60; i++) {
        expect((await request(app).get(ENDPOINT_URL)).status).toBe(200);
      }

      const response = await request(app).get(ENDPOINT_URL);
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ code: "RATE_LIMITED" });
    });

  });
});
