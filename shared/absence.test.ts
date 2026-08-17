import { describe, expect, it } from "vitest";

import { isDateExcused, isExcusedFromMissed } from "./absence";

describe("isDateExcused", () => {
  const injury = { startDate: "2026-07-13", endDate: "2026-07-19" };

  it("covers the range inclusive of both ends", () => {
    expect(isDateExcused("2026-07-13", [injury])).toBe(true);
    expect(isDateExcused("2026-07-16", [injury])).toBe(true);
    expect(isDateExcused("2026-07-19", [injury])).toBe(true);
  });

  it("excludes the days either side", () => {
    expect(isDateExcused("2026-07-12", [injury])).toBe(false);
    expect(isDateExcused("2026-07-20", [injury])).toBe(false);
  });

  it("covers a single-day range", () => {
    const oneDay = { startDate: "2026-07-13", endDate: "2026-07-13" };
    expect(isDateExcused("2026-07-13", [oneDay])).toBe(true);
    expect(isDateExcused("2026-07-14", [oneDay])).toBe(false);
  });

  it("matches any of several ranges, overlapping or not", () => {
    const ranges = [
      injury,
      { startDate: "2026-08-01", endDate: "2026-08-05" },
      { startDate: "2026-08-03", endDate: "2026-08-09" },
    ];
    expect(isDateExcused("2026-08-04", ranges)).toBe(true); // in both later ranges
    expect(isDateExcused("2026-08-08", ranges)).toBe(true);
    expect(isDateExcused("2026-07-25", ranges)).toBe(false); // in none
  });

  it("is false with no ranges at all", () => {
    expect(isDateExcused("2026-07-16", [])).toBe(false);
  });

  it("compares across month and year boundaries", () => {
    // The lexical comparison is only equivalent to a chronological one because
    // the components are zero-padded and ordered widest-first — worth pinning,
    // since a "2026-7-3"-shaped date would silently compare wrong.
    const newYear = { startDate: "2026-12-28", endDate: "2027-01-04" };
    expect(isDateExcused("2026-12-31", [newYear])).toBe(true);
    expect(isDateExcused("2027-01-01", [newYear])).toBe(true);
    expect(isDateExcused("2027-01-05", [newYear])).toBe(false);
    expect(isDateExcused("2026-12-27", [newYear])).toBe(false);
  });
});

describe("isExcusedFromMissed", () => {
  const TODAY = "2026-08-16";

  it("is false when the day is not inside any declared absence", () => {
    expect(isExcusedFromMissed("missed", "2026-08-10", TODAY, false)).toBe(false);
    expect(isExcusedFromMissed("planned", "2026-08-10", TODAY, false)).toBe(false);
  });

  it("excuses a stored missed day — the sweep ran before the annotation existed", () => {
    expect(isExcusedFromMissed("missed", "2026-08-10", TODAY, true)).toBe(true);
  });

  it("excuses a past day still planned — the sweep skipped it for the annotation", () => {
    expect(isExcusedFromMissed("planned", "2026-08-10", TODAY, true)).toBe(true);
    expect(isExcusedFromMissed(null, "2026-08-10", TODAY, true)).toBe(true);
  });

  it("never excuses what the athlete actually did", () => {
    // Training through an injury week is still training, and an explicit skip
    // is a decision they made — neither gets rewritten as "not counted".
    expect(isExcusedFromMissed("completed", "2026-08-10", TODAY, true)).toBe(false);
    expect(isExcusedFromMissed("skipped", "2026-08-10", TODAY, true)).toBe(false);
  });

  it("does not excuse a future day inside a booked absence", () => {
    // Nothing has been missed yet — the day is simply still planned. Today
    // itself is the same: the session can still happen.
    expect(isExcusedFromMissed("planned", "2026-08-20", TODAY, true)).toBe(false);
    expect(isExcusedFromMissed("planned", TODAY, TODAY, true)).toBe(false);
  });
});
