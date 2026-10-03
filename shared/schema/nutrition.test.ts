import { describe, expect, it } from "vitest";

import { addDaysToISODate } from "../dateUtils";
import { blockViewQuerySchema, NUTRITION_RANGE_MAX_DAYS, nutritionRangeSchema } from "./nutrition";

// PF1 (CODEBASE_ANALYSIS_2026-10-03): /nutrition/block and /summary-range build
// one point per day of the range synchronously, so the range must be bounded.
describe("blockViewQuerySchema range bounds (PF1)", () => {
  const from = "2026-01-01";
  const lastAllowedTo = addDaysToISODate(from, NUTRITION_RANGE_MAX_DAYS - 1);

  it("accepts a range of exactly NUTRITION_RANGE_MAX_DAYS days", () => {
    expect(blockViewQuerySchema.safeParse({ from, to: lastAllowedTo }).success).toBe(true);
  });

  it("covers the longest window a client asks for (Analytics 'All time': 366 days)", () => {
    expect(NUTRITION_RANGE_MAX_DAYS).toBeGreaterThanOrEqual(366);
    expect(blockViewQuerySchema.safeParse({ from, to: addDaysToISODate(from, 365) }).success).toBe(true);
  });

  it("rejects a range one day longer than the cap", () => {
    const result = blockViewQuerySchema.safeParse({ from, to: addDaysToISODate(lastAllowedTo, 1) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["to"] });
  });

  it("accepts a single-day range and rejects from after to", () => {
    expect(blockViewQuerySchema.safeParse({ from, to: from }).success).toBe(true);
    const result = blockViewQuerySchema.safeParse({ from: "2026-01-02", to: "2026-01-01" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["from"] });
  });

  it.each([
    // The training-load day loop compares dates as strings and steps from
    // 9999-12-31 to "10000-01-01", which sorts first: it never stops, so this
    // one-day range must be refused too, not just wide spans.
    ["a far-future one-day range", { from: "9999-12-31", to: "9999-12-31" }],
    ["a far-future to", { from: "2026-01-01", to: "9999-12-31" }],
    ["an ancient from", { from: "0001-01-01", to: "0001-01-02" }],
    ["an ancient from with no to", { from: "0001-01-01" }],
  ])("rejects %s", (_label, query) => {
    expect(blockViewQuerySchema.safeParse(query).success).toBe(false);
  });

  it("leaves a from-only span to the route, which re-checks it once `to` resolves", () => {
    expect(blockViewQuerySchema.safeParse({ from: "1990-01-01" }).success).toBe(true);
    expect(nutritionRangeSchema.safeParse({ from: "1990-01-01", to: "2026-10-03" }).success).toBe(false);
    expect(nutritionRangeSchema.safeParse({ from: "2026-01-01", to: "2026-10-03" }).success).toBe(true);
  });
});
