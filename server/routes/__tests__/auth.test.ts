import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import authRouter from "../auth";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
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

describe("Auth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(authRouter);
  });

  describe("GET /api/auth/user", () => {
    it("should return the user data when user exists", async () => {
      // Mock the storage response
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;

      const mockUser = {
        id: 1,
        userId: "test_user_id",
        email: "test@example.com",
        createdAt: "2024-03-10",
      };
      storage.getUser.mockResolvedValue(mockUser);

      const response = await request(app).get("/api/auth/user");

      expect(response.status).toBe(200);
      expect(storage.getUser).toHaveBeenCalledWith("test_user_id");
      expect(response.body).toEqual(mockUser);
    });

    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getUser.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/auth/user");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch user" });
    });
  });
});
