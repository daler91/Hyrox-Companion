import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import authRouter from "../auth";
import { storage } from "../../storage";

const TEST_USER_ID = "test_user_id";
const ENDPOINT_URL = "/api/auth/user";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
    req.auth = { userId: TEST_USER_ID };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: () => TEST_USER_ID,
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

  describe(`GET ${ENDPOINT_URL}`, () => {
    it("should return the user data when user exists", async () => {
      const mockUser = {
        id: 1,
        userId: TEST_USER_ID,
        email: "test@example.com",
        createdAt: "2024-03-10",
      };
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(200);
      expect(storage.getUser).toHaveBeenCalledWith(TEST_USER_ID);
      expect(response.body).toEqual(mockUser);
    });

    it("should return 500 when storage throws an error", async () => {
      vi.mocked(storage.getUser).mockRejectedValue(new Error("Database error"));

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch user" });
    });
  });
});
