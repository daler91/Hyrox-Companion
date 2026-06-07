import { afterEach, describe, expect, it, vi } from "vitest";

import { getMondayWeekBoundaries } from "./weeklyProgress";

// 2026-06-15 is a Monday, so every day in 2026-06-15..2026-06-21 belongs to
// the same Monday-anchored week (Sunday is the last day of that week).
const THIS_MONDAY = "2026-06-15";
const LAST_MONDAY = "2026-06-08";

afterEach(() => {
  vi.useRealTimers();
});

describe("getMondayWeekBoundaries", () => {
  it.each([
    ["2026-06-15", "Monday"],
    ["2026-06-16", "Tuesday"],
    ["2026-06-17", "Wednesday"],
    ["2026-06-18", "Thursday"],
    ["2026-06-19", "Friday"],
    ["2026-06-20", "Saturday"],
    ["2026-06-21", "Sunday"],
  ])("anchors %s (%s) to the Monday of its week", (date) => {
    expect(getMondayWeekBoundaries(new Date(`${date}T12:00:00Z`))).toEqual({
      thisMondayStr: THIS_MONDAY,
      lastMondayStr: LAST_MONDAY,
    });
  });

  it("treats Sunday as the end of the current week, not the start of the next", () => {
    // The dayOfWeek === 0 branch maps Sunday back six days to its Monday.
    expect(getMondayWeekBoundaries(new Date("2026-06-21T00:00:00Z"))).toEqual({
      thisMondayStr: THIS_MONDAY,
      lastMondayStr: LAST_MONDAY,
    });
  });

  it("ignores the time component of the input", () => {
    const lateInDay = getMondayWeekBoundaries(new Date("2026-06-17T23:59:59Z"));
    const startOfDay = getMondayWeekBoundaries(new Date("2026-06-17T00:00:00Z"));
    expect(lateInDay).toEqual(startOfDay);
    expect(lateInDay.thisMondayStr).toBe(THIS_MONDAY);
  });

  it("rolls the Monday back across a month boundary", () => {
    // Wed 2026-04-01 -> this Monday 2026-03-30, last Monday 2026-03-23.
    expect(getMondayWeekBoundaries(new Date("2026-04-01T00:00:00Z"))).toEqual({
      thisMondayStr: "2026-03-30",
      lastMondayStr: "2026-03-23",
    });
  });

  it("rolls the previous Monday back across a year boundary", () => {
    // Mon 2026-01-05 -> last Monday 2025-12-29.
    expect(getMondayWeekBoundaries(new Date("2026-01-05T00:00:00Z"))).toEqual({
      thisMondayStr: "2026-01-05",
      lastMondayStr: "2025-12-29",
    });
  });

  it("defaults to the current date when no argument is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T08:00:00Z"));
    expect(getMondayWeekBoundaries()).toEqual({
      thisMondayStr: THIS_MONDAY,
      lastMondayStr: LAST_MONDAY,
    });
  });
});
