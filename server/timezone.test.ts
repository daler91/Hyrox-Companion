import { describe, expect, it } from "vitest";

import {
  addDaysLocal,
  getDayOfWeekForDateStr,
  getLocalDateStr,
  getLocalDayOfWeek,
  isLocalHourDue,
  isValidTimezone,
} from "./timezone";

describe("getLocalDayOfWeek", () => {
  it("returns the same day for UTC as Date.getDay()", () => {
    // 2026-05-31 was a Sunday (day 0).
    const sundayMidday = new Date("2026-05-31T12:00:00Z");
    expect(getLocalDayOfWeek(sundayMidday, "UTC")).toBe(0);
    // 2026-06-01 was a Monday (day 1).
    expect(getLocalDayOfWeek(new Date("2026-06-01T12:00:00Z"), "UTC")).toBe(1);
  });

  it("shifts day forward for east-of-UTC timezones near midnight", () => {
    // 23:30 Sunday UTC is already 09:30 Monday in Sydney (UTC+10).
    const sundayLateUtc = new Date("2026-05-31T23:30:00Z");
    expect(getLocalDayOfWeek(sundayLateUtc, "UTC")).toBe(0);
    expect(getLocalDayOfWeek(sundayLateUtc, "Australia/Sydney")).toBe(1);
  });

  it("shifts day backward for west-of-UTC timezones near midnight", () => {
    // 01:00 Monday UTC is 18:00 Sunday in Los Angeles (UTC-7 DST).
    const mondayEarlyUtc = new Date("2026-06-01T01:00:00Z");
    expect(getLocalDayOfWeek(mondayEarlyUtc, "UTC")).toBe(1);
    expect(getLocalDayOfWeek(mondayEarlyUtc, "America/Los_Angeles")).toBe(0);
  });
});

describe("getLocalDateStr", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(getLocalDateStr(new Date("2026-05-31T12:00:00Z"), "UTC")).toBe("2026-05-31");
  });

  it("respects east-of-UTC rollover", () => {
    // 23:30 May 31 UTC is already June 1 in Sydney.
    expect(getLocalDateStr(new Date("2026-05-31T23:30:00Z"), "Australia/Sydney")).toBe("2026-06-01");
  });

  it("respects west-of-UTC rollback", () => {
    // 01:00 June 1 UTC is still May 31 in Los Angeles.
    expect(getLocalDateStr(new Date("2026-06-01T01:00:00Z"), "America/Los_Angeles")).toBe("2026-05-31");
  });
});

describe("addDaysLocal", () => {
  it("adds and subtracts days in calendar space", () => {
    expect(addDaysLocal("2026-05-31", 1)).toBe("2026-06-01");
    expect(addDaysLocal("2026-06-01", -1)).toBe("2026-05-31");
    expect(addDaysLocal("2026-06-01", -6)).toBe("2026-05-26");
  });

  it("handles month and year boundaries", () => {
    expect(addDaysLocal("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysLocal("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("is DST-immune (no hour shift)", () => {
    // North-American DST spring-forward 2026-03-08. Subtracting a week should
    // still land on the same calendar date a week earlier.
    expect(addDaysLocal("2026-03-09", -7)).toBe("2026-03-02");
    // Fall-back 2026-11-01.
    expect(addDaysLocal("2026-11-02", -7)).toBe("2026-10-26");
  });

  it("rejects malformed inputs", () => {
    expect(() => addDaysLocal("not-a-date", 1)).toThrow();
    expect(() => addDaysLocal("2026/01/01", 1)).toThrow();
  });
});

describe("isValidTimezone", () => {
  it("accepts well-known IANA names", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Australia/Sydney")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
  });

  it("rejects empty, non-string, or unknown inputs", () => {
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Not/A/Real/Zone")).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(123)).toBe(false);
  });
});

describe("getDayOfWeekForDateStr", () => {
  it("matches getLocalDayOfWeek for the same calendar day", () => {
    // 2026-06-15 was a Monday, 2026-06-21 the Sunday closing that week.
    expect(getDayOfWeekForDateStr("2026-06-15")).toBe(1);
    expect(getDayOfWeekForDateStr("2026-06-21")).toBe(0);
    expect(getLocalDayOfWeek(new Date("2026-06-15T12:00:00Z"), "UTC")).toBe(1);
  });

  it("is timezone-independent — a date falls on one weekday everywhere", () => {
    // The instant-based helper disagrees across zones near midnight; the
    // date-only one cannot, which is the whole reason it exists.
    const instant = new Date("2026-06-14T23:30:00Z");
    expect(getLocalDayOfWeek(instant, "Australia/Sydney")).toBe(1);
    expect(getLocalDayOfWeek(instant, "UTC")).toBe(0);
    expect(getDayOfWeekForDateStr("2026-06-14")).toBe(0);
  });

  it("is unaffected by the process timezone", () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const east = getDayOfWeekForDateStr("2024-02-29");
      process.env.TZ = "Etc/GMT+12";
      expect(getDayOfWeekForDateStr("2024-02-29")).toBe(east);
      expect(east).toBe(4); // leap day 2024 was a Thursday
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("rejects malformed inputs", () => {
    expect(() => getDayOfWeekForDateStr("not-a-date")).toThrow();
    expect(() => getDayOfWeekForDateStr("2026/01/01")).toThrow();
  });
});

// C24 (CODEBASE_ANALYSIS_2026-10-03): an hour a spring-forward gap removes
// never equalled the local hour, so anything scheduled inside it was skipped.
describe("isLocalHourDue", () => {
  const HOUR_MS = 60 * 60 * 1000;

  /** How many hourly UTC ticks in [from, to) each local date sees `hour` fall due on. */
  function dueTicksPerLocalDate(tz: string, hour: number, from: string, to: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (let ms = Date.parse(from); ms < Date.parse(to); ms += HOUR_MS) {
      const tick = new Date(ms);
      if (isLocalHourDue(tick, tz, hour)) {
        const date = getLocalDateStr(tick, tz);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      }
    }
    return counts;
  }

  it("is due inside the chosen local hour on an ordinary day", () => {
    // 2026-03-09 07:00Z is 03:00 EDT, the day after the change.
    expect(isLocalHourDue(new Date("2026-03-09T07:00:00Z"), "America/New_York", 3)).toBe(true);
    expect(isLocalHourDue(new Date("2026-03-09T07:00:00Z"), "America/New_York", 2)).toBe(false);
    expect(isLocalHourDue(new Date("2026-03-09T06:00:00Z"), "America/New_York", 2)).toBe(true);
  });

  it("fires a 02:00 New York choice at 03:00 on the spring-forward Sunday, once", () => {
    // 01:59 EST is followed by 03:00 EDT at 07:00Z; 02:00 never happens.
    expect(isLocalHourDue(new Date("2026-03-08T06:00:00Z"), "America/New_York", 2)).toBe(false);
    expect(isLocalHourDue(new Date("2026-03-08T07:00:00Z"), "America/New_York", 2)).toBe(true);
    expect(isLocalHourDue(new Date("2026-03-08T08:00:00Z"), "America/New_York", 2)).toBe(false);
    // The hours either side of the gap are untouched.
    expect(isLocalHourDue(new Date("2026-03-08T07:00:00Z"), "America/New_York", 1)).toBe(false);
    expect(isLocalHourDue(new Date("2026-03-08T07:00:00Z"), "America/New_York", 3)).toBe(true);
  });

  it("fires local midnight at 01:00 where the clocks spring forward at midnight", () => {
    // Santiago goes from Saturday 23:59 to Sunday 01:00 (04:00Z on 2026-09-06).
    expect(isLocalHourDue(new Date("2026-09-06T03:00:00Z"), "America/Santiago", 0)).toBe(false);
    expect(isLocalHourDue(new Date("2026-09-06T04:00:00Z"), "America/Santiago", 0)).toBe(true);
    expect(getLocalDateStr(new Date("2026-09-06T04:00:00Z"), "America/Santiago")).toBe("2026-09-06");
    expect(isLocalHourDue(new Date("2026-09-06T05:00:00Z"), "America/Santiago", 0)).toBe(false);
  });

  it.each([
    ["America/New_York", 2],
    ["America/Santiago", 0],
    ["Asia/Beirut", 0],
    ["America/Havana", 0],
    ["Europe/London", 1],
    ["Asia/Kolkata", 0],
    ["Australia/Lord_Howe", 2],
  ])("in %s, hour %i falls due on every local date of the year", (tz, hour) => {
    const counts = dueTicksPerLocalDate(tz, hour, "2026-01-02T00:00:00Z", "2026-12-30T00:00:00Z");
    // 362 UTC days span 362 local dates whatever the offset.
    expect(counts.size).toBe(362);
    // Twice at most, and only where a fall-back repeats the hour itself.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });
});
