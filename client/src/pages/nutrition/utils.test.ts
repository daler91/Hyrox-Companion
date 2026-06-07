import type { NutritionMacroTotals, NutritionTarget } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { computeTargetProgress } from "./utils";

const TOTALS: NutritionMacroTotals = { calories: 1000, protein: 75, carb: 200, fat: 80, fiber: 10 };

function target(over: Partial<NutritionTarget> = {}): NutritionTarget {
  return {
    id: "t1",
    userId: "u1",
    calories: 2000,
    proteinG: 150,
    carbG: null,
    fatG: 80,
    effectiveFrom: "2026-06-01",
    ...over,
  };
}

describe("computeTargetProgress", () => {
  it("returns no rows when there is no target", () => {
    expect(computeTargetProgress(TOTALS, null)).toEqual([]);
  });

  it("emits a row per set goal, skipping null/zero goals", () => {
    const rows = computeTargetProgress(TOTALS, target());
    // carbG is null → skipped; calories, protein, fat have goals.
    expect(rows.map((r) => r.key)).toEqual(["calories", "protein", "fat"]);
    expect(rows.find((r) => r.key === "calories")).toMatchObject({
      value: 1000,
      target: 2000,
      pct: 50,
      remaining: 1000,
    });
    expect(rows.find((r) => r.key === "fat")).toMatchObject({ pct: 100, remaining: 0 });
  });

  it("skips a zero goal", () => {
    const rows = computeTargetProgress(TOTALS, target({ proteinG: 0 }));
    expect(rows.some((r) => r.key === "protein")).toBe(false);
  });

  it("reports over-target as pct > 100 and negative remaining", () => {
    const rows = computeTargetProgress({ ...TOTALS, calories: 2200 }, target());
    const cals = rows.find((r) => r.key === "calories");
    expect(cals).toMatchObject({ pct: 110, remaining: -200 });
  });
});
