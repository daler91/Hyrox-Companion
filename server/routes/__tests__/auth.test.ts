import { createTestApp } from "./testUtils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import authRouter from "../auth";
import { storage } from "../../storage";
import { getUserId } from "../../types";

const { TEST_USER_ID } = vi.hoisted(() => ({ TEST_USER_ID: "test_user_id" }));
const ENDPOINT_URL = "/api/v1/auth/user";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: TEST_USER_ID };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: vi.fn().mockReturnValue(TEST_USER_ID),
}));

// Mock the storage functions
vi.mock("../../logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
    },
  },
}));

describe("Auth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
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

  });
});
