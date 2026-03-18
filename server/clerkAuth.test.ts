import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when no auth object is returned from getAuth", async () => {
    (getAuth as any).mockReturnValue(null);

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when auth object does not have a userId", async () => {
    (getAuth as any).mockReturnValue({ userId: null });

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when auth.userId exists and ensureUserExists succeeds", async () => {
    (getAuth as any).mockReturnValue({ userId: "test-user-id" });
    (storage.getUser as any).mockResolvedValue({ id: "test-user-id" });

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.getUser).toHaveBeenCalledWith("test-user-id");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns 500 when ensureUserExists throws an error", async () => {
    (getAuth as any).mockReturnValue({ userId: "test-user-id" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (storage.getUser as any).mockRejectedValue(new Error("Database error"));

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.getUser).toHaveBeenCalledWith("test-user-id");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to initialize user session" });
    expect(next).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
