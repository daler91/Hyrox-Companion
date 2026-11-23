import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getClerkUserId } from "./clerkUserId";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
}));

const req = {} as Request;
type Auth = ReturnType<typeof getAuth>;

describe("getClerkUserId", () => {
  afterEach(() => {
    vi.mocked(getAuth).mockReset();
  });

  it("returns the Clerk user id", () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "user_123" } as unknown as Auth);

    expect(getClerkUserId(req)).toBe("user_123");
    expect(getAuth).toHaveBeenCalledWith(req);
  });

  it("returns undefined for a signed-out request", () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as unknown as Auth);

    expect(getClerkUserId(req)).toBeUndefined();
  });

  it("returns undefined when there is no auth object", () => {
    vi.mocked(getAuth).mockReturnValue(null as unknown as Auth);

    expect(getClerkUserId(req)).toBeUndefined();
  });

  it("returns undefined, rather than throwing, when clerkMiddleware has not run", () => {
    vi.mocked(getAuth).mockImplementation(() => {
      throw new Error("clerkMiddleware() was not run");
    });

    expect(getClerkUserId(req)).toBeUndefined();
  });
});
