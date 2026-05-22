import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction,Request, Response } from "express";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { clearUserSeenCache, isAuthenticated } from "./clerkAuth";
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
    users: {
      getUser: vi.fn(),
      upsertUser: vi.fn(),
    },
  },
}));

vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("isAuthenticated middleware", () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, path: "/test" } as Request;
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    next = vi.fn();
    clearUserSeenCache();
    vi.clearAllMocks();
    vi.mocked(storage.users.upsertUser).mockResolvedValue({ id: "test-user-id" });
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
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test-user-id" });

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.users.getUser).toHaveBeenCalledWith("test-user-id");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("provisions a missing user before syncing the Clerk profile", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(clerkClient.users.getUser).mockResolvedValue({
      emailAddresses: [{ emailAddress: "test@example.com" }],
      firstName: "Test",
      lastName: "User",
      imageUrl: "https://example.com/avatar.png",
    });

    await isAuthenticated(req, res, next);

    expect(storage.users.upsertUser).toHaveBeenNthCalledWith(1, { id: "test-user-id" });
    expect(storage.users.upsertUser).toHaveBeenNthCalledWith(2, {
      id: "test-user-id",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: "https://example.com/avatar.png",
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("continues with a minimal user when Clerk profile sync fails", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(clerkClient.users.getUser).mockRejectedValue(new Error("Clerk unavailable"));

    await isAuthenticated(req, res, next);

    expect(storage.users.upsertUser).toHaveBeenCalledTimes(1);
    expect(storage.users.upsertUser).toHaveBeenCalledWith({ id: "test-user-id" });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("retries Clerk profile sync without email when the email is already owned", async () => {
    const duplicateEmailError = Object.assign(new Error("duplicate email"), {
      code: "23505",
      constraint: "users_email_unique",
    });

    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(clerkClient.users.getUser).mockResolvedValue({
      primaryEmailAddress: { emailAddress: "test@example.com" },
      emailAddresses: [],
      firstName: "Test",
      lastName: "User",
      imageUrl: "https://example.com/avatar.png",
    });
    vi.mocked(storage.users.upsertUser)
      .mockResolvedValueOnce({ id: "test-user-id" })
      .mockRejectedValueOnce(duplicateEmailError)
      .mockResolvedValueOnce({ id: "test-user-id" });

    await isAuthenticated(req, res, next);

    expect(storage.users.upsertUser).toHaveBeenNthCalledWith(1, { id: "test-user-id" });
    expect(storage.users.upsertUser).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: "test-user-id",
      email: "test@example.com",
    }));
    expect(storage.users.upsertUser).toHaveBeenNthCalledWith(3, {
      id: "test-user-id",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: "https://example.com/avatar.png",
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 500 when the minimal user row cannot be created", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    vi.mocked(storage.users.upsertUser).mockRejectedValue(new Error("insert failed"));

    await isAuthenticated(req, res, next);

    expect(storage.users.upsertUser).toHaveBeenCalledWith({ id: "test-user-id" });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to initialize user session", code: "INTERNAL_SERVER_ERROR" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when ensureUserExists throws an error", async () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(storage.users.getUser).mockRejectedValue(new Error("Database error"));

    await isAuthenticated(req, res, next);

    expect(getAuth).toHaveBeenCalledWith(req);
    expect(storage.users.getUser).toHaveBeenCalledWith("test-user-id");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to initialize user session", code: "INTERNAL_SERVER_ERROR" });
    expect(next).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
