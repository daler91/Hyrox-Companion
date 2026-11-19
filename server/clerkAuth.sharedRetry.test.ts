import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearProfileRetries, clearUserSeenCache, isAuthenticated } from "./clerkAuth";
import { logger } from "./logger";
import { claimRuntimeCacheKey, getRuntimeCache, setRuntimeCache } from "./sharedRuntimeState";
import { storage } from "./storage";

// clerkAuth.test.ts runs under NODE_ENV=test, where the Clerk profile retry is
// gated by the per-process record alone. Outside test the retry is also claimed
// across replicas through server_runtime_cache; these cases cover that claim.

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkMiddleware: vi.fn(),
  clerkClient: {
    users: {
      getUser: vi.fn(),
    },
  },
}));

vi.mock("./env", () => ({
  env: {
    NODE_ENV: "production",
    CLERK_PUBLISHABLE_KEY: "pk_test_key",
    CLERK_SECRET_KEY: "sk_test_key",
  },
}));

vi.mock("./sharedRuntimeState", () => ({
  claimRuntimeCacheKey: vi.fn(),
  deleteRuntimeCache: vi.fn(),
  getRuntimeCache: vi.fn(),
  runtimeCacheKey: (scope: string, value: string) => `${scope}:${value}`,
  setRuntimeCache: vi.fn(),
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

describe("isAuthenticated Clerk profile retry across replicas", () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, path: "/test" } as Request;
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    next = vi.fn();
    clearUserSeenCache();
    clearProfileRetries();
    vi.clearAllMocks();
    vi.mocked(getRuntimeCache).mockResolvedValue(undefined);
    vi.mocked(setRuntimeCache).mockResolvedValue(undefined);
    vi.mocked(getAuth).mockReturnValue({ userId: "test-user-id" } as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test-user-id", email: null } as never);
    vi.mocked(storage.users.upsertUser).mockResolvedValue({ id: "test-user-id" } as never);
    vi.mocked(clerkClient.users.getUser).mockResolvedValue({
      primaryEmailAddress: { emailAddress: "test@example.com" },
      emailAddresses: [],
      firstName: "Test",
      lastName: "User",
      imageUrl: "https://example.com/avatar.png",
    } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("fetches the profile when this replica wins the shared retry slot", async () => {
    vi.mocked(claimRuntimeCacheKey).mockResolvedValue(true);

    await isAuthenticated(req, res, next);

    expect(storage.users.upsertUser).toHaveBeenCalledWith({
      id: "test-user-id",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: "https://example.com/avatar.png",
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("skips the profile fetch when another replica already retried inside the interval", async () => {
    vi.mocked(claimRuntimeCacheKey).mockResolvedValue(false);

    await isAuthenticated(req, res, next);

    expect(clerkClient.users.getUser).not.toHaveBeenCalled();
    expect(storage.users.upsertUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("lets the request through without a profile fetch when the shared claim cannot be written", async () => {
    vi.mocked(claimRuntimeCacheKey).mockRejectedValue(new Error("connection terminated"));

    await isAuthenticated(req, res, next);

    expect(clerkClient.users.getUser).not.toHaveBeenCalled();
    expect(storage.users.upsertUser).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "test-user-id" }),
      "Failed to claim the Clerk profile retry; skipping it",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
