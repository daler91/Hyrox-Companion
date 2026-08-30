import type { Food } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildBlockView } from "./blockView";
import { makeLogRow } from "./foodTestFixture";
import { type LogEntryWithFood } from "./rollup";

/** Block-view defaults: a lunch on the given day, id derived from date+grams. */
function makeRow(logDate: string, quantityG: number, foodOver: Partial<Food> = {}): LogEntryWithFood {
  return makeLogRow(
    {
      id: `${logDate}-${quantityG}`,
      loggedAt: new Date(`${logDate}T12:00:00Z`),
      logDate,
      quantityG,
      mealType: "lunch",
    },
    foodOver,
  );
}

describe("buildBlockView", () => {
  it("joins nutrition and UTSS by date, zero-filling every day in the range", () => {
    const rows = [
      makeRow("2026-06-01", 100),
      makeRow("2026-06-01", 50), // same-day summation → 150 kcal
      makeRow("2026-06-03", 200),
    ];
    const dailyLoads = [
      { date: "2026-06-02", utss: 42.5 }, // training-only day (no intake)
      { date: "2026-06-03", utss: 30 }, // overlap day
      // 2026-06-01 has no load entry → utss 0
    ];

    const points = buildBlockView(rows, dailyLoads, { from: "2026-06-01", to: "2026-06-03" });

    expect(points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);

    expect(points[0]).toMatchObject({ date: "2026-06-01", calories: 150, protein: 15, utss: 0 });
    // Zero-filled intake on the training-only middle day.
    expect(points[1]).toMatchObject({ date: "2026-06-02", calories: 0, protein: 0, utss: 42.5 });
    expect(points[2]).toMatchObject({ date: "2026-06-03", calories: 200, protein: 20, utss: 30 });
  });

  it("ignores UTSS entries outside the range and rounds macros", () => {
    const rows = [makeRow("2026-06-02", 33, { caloriesPer100g: 89, proteinPer100g: 1.1 })];
    const dailyLoads = [
      { date: "2026-05-31", utss: 99 }, // before range → ignored
      { date: "2026-06-02", utss: 12.34 }, // rounded to 1dp
    ];

    const points = buildBlockView(rows, dailyLoads, { from: "2026-06-01", to: "2026-06-02" });

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ date: "2026-06-01", calories: 0, utss: 0 });
    // 33g of an 89 kcal/100g food = 29.37 → 29; protein 0.363 → 0.4; utss 12.34 → 12.3
    expect(points[1]).toMatchObject({ date: "2026-06-02", calories: 29, protein: 0.4, utss: 12.3 });
  });

  it("returns a single zero-filled point for a one-day range with no data", () => {
    const points = buildBlockView([], [], { from: "2026-06-07", to: "2026-06-07" });
    expect(points).toEqual([
      { date: "2026-06-07", calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0, utss: 0 },
    ]);
  });

  it("returns an empty series for an inverted range", () => {
    expect(buildBlockView([], [], { from: "2026-06-07", to: "2026-06-01" })).toEqual([]);
  });
});
