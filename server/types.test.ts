import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toDateStr, getUserId } from "./types";
import { getAuth } from "@clerk/express";
import type { Request } from "express";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
}));

describe("toDateStr", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the correct date string for a specific Date", () => {
    const date = new Date("2023-10-15T10:00:00Z");
    expect(toDateStr(date)).toBe("2023-10-15");
  });

  it("returns the correct date string when created in a specific timezone (toISOString converts to UTC)", () => {
    // A date created at 2023-10-15 23:00 in UTC-4 (e.g., EDT)
    // This is 2023-10-16 03:00 in UTC.
    // toISOString() uses UTC, so it should return '2023-10-16'
    const date = new Date("2023-10-15T23:00:00-04:00");
    expect(toDateStr(date)).toBe("2023-10-16");
  });

  it("returns today's date string when no argument is provided", () => {
    vi.setSystemTime(new Date("2024-05-20T12:00:00Z"));
    expect(toDateStr()).toBe("2024-05-20");
  });

  it("returns today's date string when undefined is provided", () => {
    vi.setSystemTime(new Date("2024-05-20T12:00:00Z"));
    expect(toDateStr()).toBe("2024-05-20");
  });
});

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
    vi.mocked(getAuth).mockReturnValue({ userId: "user_123" } as unknown as ReturnType<
      typeof getAuth
    >);
    const req = {} as Request;
    expect(getUserId(req)).toBe("user_123");
  });
});
