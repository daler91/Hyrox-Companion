import { describe, expect, it } from "vitest";

import { formatDayLabel, formatWeekRange, lastCompletedWeekStart, mondayOf } from "./weekDates";

describe("mondayOf", () => {
  it.each([
    ["2026-06-15", "Monday"],
    ["2026-06-17", "Wednesday"],
    ["2026-06-21", "Sunday"],
  ])("anchors %s (%s) to Mon 2026-06-15", (date) => {
    expect(mondayOf(date)).toBe("2026-06-15");
  });

  it("closes the week on Sunday rather than opening a new one", () => {
    // Must match getWeekRangeForDate on the server, which does the same.
    expect(mondayOf("2026-06-21")).toBe("2026-06-15");
    expect(mondayOf("2026-06-22")).toBe("2026-06-22");
  });

  it("rolls back across month, year and leap-day boundaries", () => {
    expect(mondayOf("2026-04-01")).toBe("2026-03-30");
    expect(mondayOf("2026-01-02")).toBe("2025-12-29");
    expect(mondayOf("2024-02-29")).toBe("2024-02-26");
  });

  it("is DST-immune", () => {
    // Spring-forward 2026-03-08 and fall-back 2026-11-01 both sit mid-week; a
    // local Date walked back a day here can land an hour short and slip.
    expect(mondayOf("2026-03-08")).toBe("2026-03-02");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });

  it("is idempotent", () => {
    expect(mondayOf(mondayOf("2026-06-18"))).toBe(mondayOf("2026-06-18"));
  });
});

describe("lastCompletedWeekStart", () => {
  it("is a Monday, and a week or more behind today", () => {
    const start = lastCompletedWeekStart();
    expect(mondayOf(start)).toBe(start);
    expect(start < new Date().toISOString().slice(0, 10)).toBe(true);
  });
});

describe("formatWeekRange", () => {
  it("says the month once when the week sits inside one", () => {
    expect(formatWeekRange("2026-06-01", "2026-06-07")).toBe("Jun 1–7, 2026");
  });

  it("names both months when the week straddles one", () => {
    expect(formatWeekRange("2026-06-29", "2026-07-05")).toBe("Jun 29 – Jul 5, 2026");
  });

  it("names both years when the week straddles one", () => {
    expect(formatWeekRange("2025-12-29", "2026-01-04")).toBe("Dec 29, 2025 – Jan 4, 2026");
  });
});

describe("formatDayLabel", () => {
  it("names the weekday, so a row reads without arithmetic", () => {
    expect(formatDayLabel("2026-06-08")).toBe("Mon, Jun 8");
  });
});
