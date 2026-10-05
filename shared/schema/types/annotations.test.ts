import { describe, expect, it } from "vitest";

import { insertTimelineAnnotationSchema, updateTimelineAnnotationSchema } from "./annotations";

// C50 (CODEBASE_ANALYSIS_2026-10-03): the shape check took "2026-02-30", which
// the annotation's date columns refused with a 500 instead of a 400.
describe("timeline annotation dates", () => {
  function insertMessages(startDate: string, endDate: string): string[] {
    const result = insertTimelineAnnotationSchema.safeParse({ startDate, endDate, type: "injury" });
    return result.error?.issues.map((issue) => issue.message) ?? [];
  }

  it("takes a real range", () => {
    expect(insertMessages("2026-02-27", "2026-03-02")).toEqual([]);
  });

  it("names an impossible day once, without a second date-order issue", () => {
    expect(insertMessages("2026-02-30", "2026-02-28")).toEqual(["Must be a real calendar date"]);
  });

  it("still refuses a range that ends before it starts", () => {
    expect(insertMessages("2026-03-02", "2026-02-27")).toEqual([
      "endDate must be on or after startDate",
    ]);
  });

  it("checks the dates of a partial update too", () => {
    expect(updateTimelineAnnotationSchema.safeParse({ endDate: "2026-04-31" }).success).toBe(false);
    expect(updateTimelineAnnotationSchema.safeParse({ endDate: "2026-04-30" }).success).toBe(true);
    expect(updateTimelineAnnotationSchema.safeParse({ note: "Back on track" }).success).toBe(true);
  });
});
