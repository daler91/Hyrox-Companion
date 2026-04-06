import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import preferencesRouter from "../preferences";
import { createTestApp } from "./testUtils";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

// Mock the storage functions
vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
    },
  },
}));

describe("GET /api/preferences", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(preferencesRouter);

  });

  it("should return 500 when storage.users.getUser throws an error", async () => {
    // Mock storage.users.getUser to throw an error
    const errorMessage = "Database connection failed";
    vi.mocked(storage.users.getUser).mockRejectedValueOnce(new Error(errorMessage));

    const response = await request(app).get("/api/v1/preferences");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    expect(storage.users.getUser).toHaveBeenCalledWith("test_user_id");
  });
});
