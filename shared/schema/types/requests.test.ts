import { describe, expect, it } from "vitest";

import { calendarDateSchema, dateStringSchema } from "./requests";

/** The messages a parse raised, in order; empty when it passed. */
function issueMessages(value: unknown): string[] {
  return dateStringSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
}

const FORMAT_MESSAGE = "Must be a valid date in YYYY-MM-DD format";

describe("dateStringSchema", () => {
  it.each(["2026-10-04", "2028-02-29", "0001-01-01"])("takes %s", (value) => {
    expect(dateStringSchema.safeParse(value).success).toBe(true);
  });

  // A shape check only: whether the day is real is isIsoCalendarDate's call.
  it("takes a well-formed but impossible date, as before", () => {
    expect(dateStringSchema.safeParse("2026-02-31").success).toBe(true);
  });

  // date-schema-single-issue (CODEBASE_ANALYSIS_2026-10-03): a value longer
  // than ten characters failed the length bound and the format both, so a
  // five-digit year from a browser date field came back with two issues.
  it.each([
    ["a five-digit year", "20266-11-15"],
    ["a timestamp", "2026-11-15T00:00:00Z"],
    ["a trailing space", "2026-11-15 "],
    ["a trailing newline", "2026-11-15\n"],
    ["a long string", "x".repeat(1_000)],
  ])("names only the format for %s", (_label, value) => {
    expect(issueMessages(value)).toEqual([FORMAT_MESSAGE]);
  });

  it.each(["15/11/2026", "2026-1-5", "", "aaaa-bb-cc"])("names only the format for %j", (value) => {
    expect(issueMessages(value)).toEqual([FORMAT_MESSAGE]);
  });

  it("refuses a value that is not a string", () => {
    expect(dateStringSchema.safeParse(20_261_115).success).toBe(false);
  });
});

// C50 (CODEBASE_ANALYSIS_2026-10-03): a value bound for a Postgres date column
// must be a real day, or the column refuses it and the request returns 500.
describe("calendarDateSchema", () => {
  function calendarIssues(value: unknown): string[] {
    return calendarDateSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
  }

  it.each(["2026-10-04", "2028-02-29", "2026-12-31"])("takes the real day %s", (value) => {
    expect(calendarIssues(value)).toEqual([]);
  });

  it.each(["2026-02-30", "2026-02-31", "2026-04-31", "2027-02-29", "2026-13-01", "2026-00-10"])(
    "names only the calendar for the impossible day %s",
    (value) => {
      expect(calendarIssues(value)).toEqual(["Must be a real calendar date"]);
    },
  );

  it.each(["15/11/2026", "next tuesday", "2026-11-15T00:00:00Z"])(
    "names only the format for %j",
    (value) => {
      expect(calendarIssues(value)).toEqual([FORMAT_MESSAGE]);
    },
  );
});
