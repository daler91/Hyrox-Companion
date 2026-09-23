import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

import { getUserId } from "./types";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
}));

describe("getUserId", () => {
  it("throws an error when auth is null", () => {
    vi.mocked(getAuth).mockReturnValue(null as unknown as ReturnType<typeof getAuth>);
    const req = {} as Request;
    expect(() => getUserId(req)).toThrow("User not authenticated");
  });

  it("throws an error when auth does not have userId", () => {
    vi.mocked(getAuth).mockReturnValue({} as unknown as ReturnType<typeof getAuth>);
    const req = {} as Request;
    expect(() => getUserId(req)).toThrow("User not authenticated");
  });

  it("returns userId when auth is valid", () => {
    vi.mocked(getAuth).mockReturnValue({ userId: "user_123" } as unknown as ReturnType<typeof getAuth>);
    const req = {} as Request;
    expect(getUserId(req)).toBe("user_123");
  });
});
