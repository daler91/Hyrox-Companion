import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import preferencesRouter from "../preferences";
import { storage } from "../../storage";

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
    // Mock global error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err.status >= 500 || !err.status) {
        if (req.log) {
          req.log.error({ err }, "Unhandled error in route");
        } else {
          // If logger mock exists, call it so tests pass

        }
      }
      console.log("Global error handler caught error:", err.message);
      res.status(err.status || 500).json({ error: "Internal Server Error" });
    });
  });

  it("should return 500 when storage.getUser throws an error", async () => {
    // Mock storage.getUser to throw an error
    const errorMessage = "Database connection failed";
    vi.mocked(storage.getUser).mockRejectedValueOnce(new Error(errorMessage));

    const response = await request(app).get("/api/v1/preferences");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error" });
    expect(storage.getUser).toHaveBeenCalledWith("test_user_id");
  });
});
