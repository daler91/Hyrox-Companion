import { describe, expect, it } from "vitest";

import {
  addDaysToISODate,
  computePlanWeeks,
  dayDiff,
  describeWeekdaySpan,
  MAX_PLAN_WEEKS,
  MIN_PLAN_WEEKS,
  nextPlanStartDate,
  parseIsoDate,
  planWeekOneMonday,
  toIsoDateUtc,
  weekdayIndex,
  weekdayName,
  weekOneDaysBeforeStart,
} from "./dateUtils";

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

describe("toIsoDateUtc / parseIsoDate", () => {
  it("formats an instant as its UTC calendar date", () => {
    expect(toIsoDateUtc(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-29");
    // Same instant, but 30 minutes later crosses UTC midnight.
    expect(toIsoDateUtc(new Date("2026-03-30T00:30:00Z"))).toBe("2026-03-30");
    // An offset-carrying input is converted, not read as a wall-clock date:
    // 23:00 on the 15th in UTC-4 is already the 16th in UTC.
    expect(toIsoDateUtc(new Date("2023-10-15T23:00:00-04:00"))).toBe("2023-10-16");
  });

  it("parseIsoDate yields UTC midnight, so it round-trips through toIsoDateUtc", () => {
    const parsed = parseIsoDate("2024-02-29");
    expect(parsed.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(toIsoDateUtc(parsed)).toBe("2024-02-29");
  });
});

// 2026-09-21 is a Monday.
describe("plan week 1", () => {
  it("indexes weekdays from Monday", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0);
    expect(weekdayIndex("2026-09-23")).toBe(2);
    expect(weekdayIndex("2026-09-27")).toBe(6);
  });

  it("names the weekday a date falls on", () => {
    expect(weekdayName("2026-09-21")).toBe("Monday");
    expect(weekdayName("2026-09-24")).toBe("Thursday");
    expect(weekdayName("2026-09-27")).toBe("Sunday");
  });

  it("opens week 1 on the Monday of the start date's week", () => {
    expect(planWeekOneMonday("2026-09-21")).toBe("2026-09-21");
    expect(planWeekOneMonday("2026-09-24")).toBe("2026-09-21");
    expect(planWeekOneMonday("2026-09-27")).toBe("2026-09-21");
  });

  it("names the week-1 days that fall before a midweek start", () => {
    expect(weekOneDaysBeforeStart("2026-09-21")).toEqual([]);
    expect(weekOneDaysBeforeStart("2026-09-23")).toEqual(["Monday", "Tuesday"]);
    expect(weekOneDaysBeforeStart("2026-09-27")).toHaveLength(6);
  });

  it("defaults a start to the next Monday, or today when today is one", () => {
    expect(nextPlanStartDate("2026-09-21")).toBe("2026-09-21");
    expect(nextPlanStartDate("2026-09-22")).toBe("2026-09-28");
    expect(nextPlanStartDate("2026-09-27")).toBe("2026-09-28");
    // Across a month and a year boundary.
    expect(nextPlanStartDate("2026-12-30")).toBe("2027-01-04");
  });
});

describe("describeWeekdaySpan", () => {
  it("reads one, two, or a longer run of days as prose", () => {
    expect(describeWeekdaySpan([])).toBe("");
    expect(describeWeekdaySpan(["Monday"])).toBe("Monday");
    expect(describeWeekdaySpan(["Monday", "Tuesday"])).toBe("Monday and Tuesday");
    expect(describeWeekdaySpan(["Monday", "Tuesday", "Wednesday", "Thursday"])).toBe("Monday to Thursday");
  });
});
