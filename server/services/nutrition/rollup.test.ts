import type { Food } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildDailySummary, emptyTotals, type LogEntryWithFood, scaleNutrition } from "./rollup";

function makeFood(over: Partial<Food> = {}): Food {
  return {
    id: "f1",
    source: "usda",
    sourceId: "1",
    name: "Test Food",
    brand: null,
    servingSizeG: null,
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
    micros: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeRow(entryOver: Partial<LogEntryWithFood> = {}, foodOver: Partial<Food> = {}): LogEntryWithFood {
  const food = makeFood(foodOver);
  return {
    id: "e1",
    userId: "u1",
    foodId: food.id,
    loggedAt: new Date("2026-06-07T08:00:00Z"),
    logDate: "2026-06-07",
    quantityG: 100,
    mealType: "breakfast",
    entryMethod: "manual",
    rawInput: null,
    parseConfidence: null,
    pendingReview: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    food,
    ...entryOver,
  };
}

describe("scaleNutrition", () => {
  it("scales per-100g values by grams / 100", () => {
    expect(scaleNutrition(makeFood(), 200)).toEqual({
      calories: 200,
      protein: 20,
      carb: 40,
      fat: 10,
      fiber: 4,
    });
    expect(scaleNutrition(makeFood(), 50)).toEqual({
      calories: 50,
      protein: 5,
      carb: 10,
      fat: 2.5,
      fiber: 1,
    });
  });

  it("handles fractional grams", () => {
    const n = scaleNutrition(makeFood({ caloriesPer100g: 89 }), 33);
    expect(n.calories).toBeCloseTo(29.37, 2);
  });

  it("treats null per-100g values as 0", () => {
    const n = scaleNutrition(
      makeFood({ caloriesPer100g: null, proteinPer100g: null, carbPer100g: null, fatPer100g: null, fiberPer100g: null }),
      100,
    );
    expect(n).toEqual({ calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 });
  });
});

describe("buildDailySummary", () => {
  it("returns all-zero totals and every meal bucket for an empty day", () => {
    const summary = buildDailySummary("2026-06-07", []);
    expect(summary.totals).toEqual(emptyTotals());
    expect(new Set(Object.keys(summary.meals))).toEqual(
      new Set(["breakfast", "lunch", "dinner", "snack", "snack_pm", "pre_workout", "post_workout"]),
    );
    for (const meal of Object.values(summary.meals)) {
      expect(meal).toEqual([]);
    }
  });

  it("buckets entries by meal and sums totals", () => {
    const rows = [
      makeRow({ id: "a", quantityG: 100, mealType: "breakfast" }),
      makeRow({ id: "b", quantityG: 50, mealType: "breakfast" }),
      makeRow({ id: "c", quantityG: 200, mealType: "lunch" }),
    ];
    const summary = buildDailySummary("2026-06-07", rows);

    expect(summary.meals.breakfast).toHaveLength(2);
    expect(summary.meals.lunch).toHaveLength(1);
    expect(summary.meals.dinner).toHaveLength(0);
    // 100g + 50g + 200g of a 100 kcal/100g food = 100 + 50 + 200 = 350.
    expect(summary.totals.calories).toBe(350);
    expect(summary.totals.protein).toBe(35);
  });

  it("rounds calories to whole numbers and macros to one decimal", () => {
    const summary = buildDailySummary("2026-06-07", [
      makeRow({ quantityG: 33 }, { caloriesPer100g: 89, proteinPer100g: 1.1 }),
    ]);
    const entry = summary.meals.breakfast[0];
    expect(entry.nutrition.calories).toBe(29); // round(29.37)
    expect(entry.nutrition.protein).toBe(0.4); // round1(0.363)
    expect(summary.totals.calories).toBe(29);
  });

  it("serializes loggedAt to an ISO string and carries food name/brand", () => {
    const summary = buildDailySummary("2026-06-07", [
      makeRow({ loggedAt: new Date("2026-06-07T08:00:00Z") }, { name: "Banana", brand: "Dole" }),
    ]);
    const entry = summary.meals.breakfast[0];
    expect(entry.loggedAt).toBe("2026-06-07T08:00:00.000Z");
    expect(entry.name).toBe("Banana");
    expect(entry.brand).toBe("Dole");
  });
});
