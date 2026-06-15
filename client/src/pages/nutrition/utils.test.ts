import type { NutritionMacroTotals, NutritionTarget } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  appendUnique,
  buildPreviewMicroRows,
  computeTargetProgress,
  macroEnergyShares,
  previewMicrosScaled,
  projectGoalContribution,
  removeAt,
  updateAt,
} from "./utils";

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

describe("previewMicrosScaled", () => {
  it("scales each per-100g micro to the quantity", () => {
    expect(previewMicrosScaled({ micros: { sodium: 50, vitaminC: 10 } }, 200)).toEqual({
      sodium: 100,
      vitaminC: 20,
    });
  });

  it("returns an empty map for null micros or a non-positive quantity", () => {
    expect(previewMicrosScaled({ micros: null }, 100)).toEqual({});
    expect(previewMicrosScaled({ micros: { sodium: 50 } }, 0)).toEqual({});
  });

  it("ignores non-finite values", () => {
    expect(previewMicrosScaled({ micros: { sodium: Number.NaN, iron: 5 } }, 100)).toEqual({
      iron: 5,
    });
  });
});

describe("buildPreviewMicroRows", () => {
  it("emits rows only for micros with data, in display order, with %RDI", () => {
    const rows = buildPreviewMicroRows({ vitaminC: 45, sodium: 1150 });
    // Display order follows MICRO_DISPLAY_DEFS — minerals (sodium) before vitamins.
    expect(rows.map((r) => r.key)).toEqual(["sodium", "vitaminC"]);
    expect(rows.find((r) => r.key === "sodium")).toMatchObject({
      label: "Sodium",
      unit: "mg",
      amount: 1150,
      rdi: 2300,
      pctRdi: 50,
    });
    expect(rows.find((r) => r.key === "vitaminC")?.pctRdi).toBe(50); // 45 / 90
  });

  it("omits unknown keys and empty input", () => {
    expect(buildPreviewMicroRows({})).toEqual([]);
    expect(buildPreviewMicroRows({ notAMicro: 5 })).toEqual([]);
  });
});

describe("macroEnergyShares", () => {
  it("splits energy by Atwater factors and normalises the shares", () => {
    const s = macroEnergyShares({ protein: 10, carb: 20, fat: 5 });
    // kcal: P 40, C 80, F 45 → total 165
    expect(s.totalKcal).toBe(165);
    expect(s.protein).toMatchObject({ g: 10, kcal: 40, pct: 24 });
    expect(s.carb.pct).toBe(48);
    expect(s.fat.pct).toBe(27);
  });

  it("returns zero shares for all-zero macros (empty ring)", () => {
    const s = macroEnergyShares({ protein: 0, carb: 0, fat: 0 });
    expect(s.totalKcal).toBe(0);
    expect([s.protein.pct, s.carb.pct, s.fat.pct]).toEqual([0, 0, 0]);
  });

  it("clamps negative macros to zero energy", () => {
    const s = macroEnergyShares({ protein: -5, carb: 10, fat: 0 });
    expect(s.protein.kcal).toBe(0);
    expect(s.carb.kcal).toBe(40);
    expect(s.totalKcal).toBe(40);
  });
});

describe("projectGoalContribution", () => {
  const today: NutritionMacroTotals = { calories: 1000, protein: 75, carb: 100, fat: 40, fiber: 8 };
  const serving: NutritionMacroTotals = { calories: 300, protein: 30, carb: 10, fat: 5, fiber: 2 };

  it("returns no rows without a target", () => {
    expect(projectGoalContribution(today, serving, null)).toEqual([]);
  });

  it("reports current → projected per set goal, skipping unset ones", () => {
    const rows = projectGoalContribution(today, serving, target());
    // carbG is null → skipped.
    expect(rows.map((r) => r.key)).toEqual(["calories", "protein", "fat"]);
    expect(rows.find((r) => r.key === "protein")).toMatchObject({
      current: 75,
      added: 30,
      projected: 105,
      target: 150,
      currentPct: 50,
      projectedPct: 70,
    });
  });
});

describe("updateAt", () => {
  it("merges the patch into only the row at the index", () => {
    const rows = [
      { label: "a", grams: "1" },
      { label: "b", grams: "2" },
    ];
    expect(updateAt(rows, 1, { grams: "20" })).toEqual([
      { label: "a", grams: "1" },
      { label: "b", grams: "20" },
    ]);
  });

  it("returns a new array and does not mutate the input", () => {
    const rows = [{ label: "a", grams: "1" }];
    const out = updateAt(rows, 0, { label: "z" });
    expect(out).not.toBe(rows);
    expect(rows[0].label).toBe("a");
  });

  it("is a no-op (content-wise) for an out-of-range index", () => {
    const rows = [{ label: "a", grams: "1" }];
    expect(updateAt(rows, 5, { label: "z" })).toEqual(rows);
  });
});

describe("removeAt", () => {
  it("drops the element at the index", () => {
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("returns a new array and leaves the input untouched", () => {
    const arr = ["a", "b"];
    const out = removeAt(arr, 0);
    expect(out).not.toBe(arr);
    expect(arr).toEqual(["a", "b"]);
  });
});

describe("appendUnique", () => {
  const keyOf = (x: { id: string }) => x.id;

  it("appends an item whose key is not present", () => {
    const arr = [{ id: "a" }];
    expect(appendUnique(arr, { id: "b" }, keyOf)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns the SAME reference (no-op) when the key already exists", () => {
    const arr = [{ id: "a" }];
    expect(appendUnique(arr, { id: "a" }, keyOf)).toBe(arr);
  });
});
