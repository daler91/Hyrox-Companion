import { describe, expect, it } from "vitest";

import { addDaysToISODate, computePlanWeeks, dayDiff, MAX_PLAN_WEEKS, MIN_PLAN_WEEKS } from "./dateUtils";

describe("dayDiff", () => {
  it("returns the positive whole-day span when end is after start", () => {
    expect(dayDiff("2026-01-05", "2026-01-12")).toBe(7);
    expect(dayDiff("2026-01-05", "2026-03-02")).toBe(56);
  });

  it("returns zero for equal dates and negative when end precedes start", () => {
    expect(dayDiff("2026-01-05", "2026-01-05")).toBe(0);
    expect(dayDiff("2026-01-12", "2026-01-05")).toBe(-7);
  });

  it("is DST-safe (UTC math, not local Date subtraction)", () => {
    // US DST begins 2026-03-08; a naive local subtraction would yield 27.96 days.
    expect(dayDiff("2026-03-01", "2026-03-29")).toBe(28);
  });
});

describe("computePlanWeeks", () => {
  it("treats a 56-day span as exactly 8 weeks (preserves the historical default)", () => {
    expect(computePlanWeeks("2026-01-05", "2026-03-02")).toBe(8);
  });

  it("rounds a partial-week span to the nearest week", () => {
    expect(computePlanWeeks("2026-01-05", "2026-02-26")).toBe(7); // 52 days → round(7.43)
    expect(computePlanWeeks("2026-01-05", "2026-03-06")).toBe(9); // 60 days → round(8.57)
  });

  it("clamps to the minimum for tiny or non-positive spans", () => {
    expect(computePlanWeeks("2026-01-05", "2026-01-05")).toBe(MIN_PLAN_WEEKS);
    expect(computePlanWeeks("2026-01-05", "2026-01-07")).toBe(MIN_PLAN_WEEKS); // 2 days → round(0.29)
  });

  it("clamps to the maximum for very long spans", () => {
    expect(computePlanWeeks("2026-01-01", "2027-01-01")).toBe(MAX_PLAN_WEEKS); // 365 days
  });
});

describe("addDaysToISODate", () => {
  it("adds whole days within a month", () => {
    expect(addDaysToISODate("2026-01-05", 56)).toBe("2026-03-02");
    expect(addDaysToISODate("2026-05-15", 56)).toBe("2026-07-10");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDaysToISODate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToISODate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses a DST boundary cleanly", () => {
    expect(addDaysToISODate("2026-03-07", 1)).toBe("2026-03-08");
  });
});
