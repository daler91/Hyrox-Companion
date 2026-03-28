import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { isAuthenticated } from "./clerkAuth";
import { getAuth } from "@clerk/express";
import { storage } from "./storage";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkMiddleware: vi.fn(),
  clerkClient: {
    users: {
      getUser: vi.fn(),
    },
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getUser: vi.fn(),
    upsertUser: vi.fn(),
  },
}));

describe("isAuthenticated middleware", () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, path: "/test" } as Request;
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    next = vi.fn() as unknown as NextFunction;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when no auth object is returned from getAuth", async () => {
    vi.mocked(getAuth).mockReturnValue(null);

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized", code: "UNAUTHORIZED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when auth object does not have a userId", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null });

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized", code: "UNAUTHORIZED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when auth.userId exists and ensureUserExists succeeds", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    vi.mocked(storage.getUser).mockResolvedValue({ id: "test-user-id" });

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.getUser).toHaveBeenCalledWith("test-user-id");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns 500 when ensureUserExists throws an error", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(storage.getUser).mockRejectedValue(new Error("Database error"));

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.getUser).toHaveBeenCalledWith("test-user-id");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to initialize user session", code: "INTERNAL_SERVER_ERROR" });
    expect(next).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
