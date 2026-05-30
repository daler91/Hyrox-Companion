import { describe, expect, it } from "vitest";

import { addDaysLocal, getLocalDateStr, getLocalDayOfWeek, isValidTimezone } from "./timezone";

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
