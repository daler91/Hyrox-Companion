import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toDateStr } from "./types";

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
    expect(toDateStr(undefined)).toBe("2024-05-20");
  });
});
