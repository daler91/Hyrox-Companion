import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSamplePlanSchema } from "./plans";

// CL9 (CODEBASE_ANALYSIS_2026-10-03): a past race date (a mistyped year) built
// a template plan whose every day read as post-race recovery, and nothing can
// edit a plan's race date afterwards.
describe("createSamplePlanSchema race date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 05:00 UTC on 4 October: still 3 October in Honolulu (UTC-10).
    vi.setSystemTime(new Date("2026-10-04T05:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["2026-10-04", "2026-11-15", "2027-03-01"])("accepts a race on %s", (raceDate) => {
    expect(createSamplePlanSchema.safeParse({ raceDate }).success).toBe(true);
  });

  it("accepts the day before UTC's, which is still today for an athlete west of it", () => {
    expect(createSamplePlanSchema.safeParse({ raceDate: "2026-10-03" }).success).toBe(true);
  });

  it.each(["2026-10-02", "2025-11-15"])("refuses a race already past on %s", (raceDate) => {
    const result = createSamplePlanSchema.safeParse({ raceDate });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["raceDate"]);
  });

  // The past check ran after a failed format check too, so a malformed date
  // came back with a second, misleading "can't be in the past".
  it.each(["15/11/2026", "aaaa", ""])(
    "names only the format for a malformed date %j",
    (raceDate) => {
      const result = createSamplePlanSchema.safeParse({ raceDate });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "Must be a valid date in YYYY-MM-DD format",
      ]);
    },
  );

  it("names only the past for a well-formed past date", () => {
    const result = createSamplePlanSchema.safeParse({ raceDate: "2025-11-15" });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Race date can't be in the past",
    ]);
  });

  // The regex takes any digits, and UTC date math rolled an impossible date
  // forward ("2026-13-45" is 2027-02-14), so it passed as a race still ahead.
  it.each(["2026-13-45", "2026-02-30", "2027-02-29", "2026-00-10", "2026-11-00", "2020-02-31"])(
    "names only the calendar for an impossible date %s",
    (raceDate) => {
      const result = createSamplePlanSchema.safeParse({ raceDate });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "Race date must be a real calendar date",
      ]);
    },
  );

  it("accepts a leap day in a leap year", () => {
    expect(createSamplePlanSchema.safeParse({ raceDate: "2028-02-29" }).success).toBe(true);
  });

  // A browser date field takes a five-digit year, which sorts after any
  // four-digit today. It is named once: dateStringSchema's length bound used
  // to add a second issue (date-schema-single-issue,
  // CODEBASE_ANALYSIS_2026-10-03).
  it("refuses a five-digit year as malformed, and names only that", () => {
    const result = createSamplePlanSchema.safeParse({ raceDate: "20266-11-15" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Must be a valid date in YYYY-MM-DD format",
    ]);
  });

  it("still takes an empty body, as the Timeline sends", () => {
    const missingBody = undefined;
    expect(createSamplePlanSchema.parse(missingBody)).toEqual({});
    expect(createSamplePlanSchema.parse({})).toEqual({});
  });
});
