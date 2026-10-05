import { describe, expect, it } from "vitest";

import { addDaysToISODate } from "../dateUtils";
import {
  blockViewQuerySchema,
  dailySummaryQuerySchema,
  NUTRITION_RANGE_MAX_DAYS,
  nutritionRangeSchema,
  repeatDaySchema,
  upsertMealTargetSchema,
  upsertNutritionTargetSchema,
} from "./nutrition";

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

// C49 (CODEBASE_ANALYSIS_2026-10-03): the nutrition date check used Date.parse,
// which takes "2026-02-30" and rolls it into March, so the summary, targets and
// block routes passed it to the database and answered 500. Every route date
// goes through the one isoDate rule; a bad value gets one issue.
describe("nutrition dates must be real calendar days (C49)", () => {
  const impossible = ["2026-02-30", "2026-02-31", "2026-04-31", "2025-02-29", "2026-13-40", "2026-1-5", "20266-01-01"];
  // A leap day, and month ends; within one range window of the range case's from.
  const real = ["2024-02-29", "2025-02-28", "2025-04-30", "2025-12-31"];

  // Each schema that takes a nutrition date, with the date in the field it checks.
  const dateFields: [string, (date: string) => { success: boolean; error?: { issues: unknown[] } }][] = [
    ["the daily summary date", (date) => dailySummaryQuerySchema.safeParse({ date })],
    ["the repeat-day source", (date) => repeatDaySchema.safeParse({ sourceDate: date })],
    ["the repeat-day target", (date) => repeatDaySchema.safeParse({ sourceDate: "2026-01-01", targetDate: date })],
    ["a target's effectiveFrom", (date) => upsertNutritionTargetSchema.safeParse({ calories: 2500, effectiveFrom: date })],
    ["a meal target's effectiveFrom", (date) => upsertMealTargetSchema.safeParse({ mealType: "lunch", calories: 600, effectiveFrom: date })],
    ["a block range's from", (date) => blockViewQuerySchema.safeParse({ from: date })],
    ["a summary range's to", (date) => nutritionRangeSchema.safeParse({ from: "2024-01-01", to: date })],
  ];

  it.each(dateFields)("refuses an impossible date as %s, with one issue", (_label, parse) => {
    for (const date of impossible) {
      const result = parse(date);
      expect(result.success, date).toBe(false);
      expect(result.error?.issues, date).toHaveLength(1);
    }
  });

  it.each(dateFields)("still accepts a real date as %s", (_label, parse) => {
    for (const date of real) {
      expect(parse(date).success, date).toBe(true);
    }
  });

  it.each([
    // Date.UTC reads year 50 as 1950, so this fails the round trip as well as
    // the range bound: the bound is checked only on a real date.
    ["a two-digit year", { from: "0050-01-01" }, ["from"]],
    // An impossible from sorts after to; the span is checked only on real dates.
    ["an impossible from after to", { from: "2026-04-31", to: "2026-04-30" }, ["from"]],
  ])("names %s once", (_label, query, path) => {
    const result = blockViewQuerySchema.safeParse(query);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({ path });
  });
});
