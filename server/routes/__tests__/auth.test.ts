import { setupTestErrorHandler } from "./testUtils";
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
      expect(response.body).toEqual({ error: "Internal Server Error" });

    });

    it("should return 500 when getUserId throws an error", async () => {
      vi.mocked(getUserId).mockImplementation(() => {
        throw new Error("User not authenticated");
      });

      const response = await request(app).get(ENDPOINT_URL);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error" });

    });

  });
});
