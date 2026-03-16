import type { Request, Response, NextFunction } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import preferencesRouter from "../preferences";
import { storage } from "../../storage";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Request, res: Response, next: NextFunction) => {
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
    getUser: vi.fn(),
  },
}));

describe("GET /api/preferences", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(preferencesRouter);
    vi.clearAllMocks();
  });

  it("should return 500 when storage.getUser throws an error", async () => {
    // Mock storage.getUser to throw an error
    const errorMessage = "Database connection failed";
    vi.mocked(storage.getUser).mockRejectedValueOnce(new Error(errorMessage));

    const response = await request(app).get("/api/preferences");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to fetch preferences" });
    expect(storage.getUser).toHaveBeenCalledWith("test_user_id");
  });
});
