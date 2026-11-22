import { describe, expect, it } from "vitest";

import { dateRange } from "./utils";

describe("dateRange", () => {
  it("lists every day from start to end, inclusive, across a month end", () => {
    expect(dateRange("2026-01-30", "2026-02-02")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
  });

  it("is empty for an inverted range", () => {
    expect(dateRange("2026-02-02", "2026-02-01")).toEqual([]);
  });

  it("is empty for an unparseable bound instead of looping on the string comparison", () => {
    // "2026-…" <= "not-a-date" holds for every date, so the loop never ended.
    expect(dateRange("2026-01-01", "not-a-date")).toEqual([]);
    expect(dateRange("", "2026-01-01")).toEqual([]);
  });
});
