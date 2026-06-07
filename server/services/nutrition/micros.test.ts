import type { Food } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildMicroSummary } from "./micros";
import { mapOffProduct } from "./offClient";
import { type LogEntryWithFood, scaleMicros, sumMicros } from "./rollup";
import { mapUsdaSearchFood } from "./usdaClient";

function makeFood(micros: Record<string, number> | null): Food {
  return {
    id: "f1",
    source: "usda",
    sourceId: "1",
    name: "Test Food",
    brand: null,
    createdByUserId: null,
    servingSizeG: null,
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
    micros,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRow(micros: Record<string, number> | null, quantityG: number): LogEntryWithFood {
  return {
    id: `e-${quantityG}`,
    userId: "u1",
    foodId: "f1",
    loggedAt: new Date("2026-06-07T08:00:00Z"),
    logDate: "2026-06-07",
    quantityG,
    mealType: "breakfast",
    entryMethod: "manual",
    rawInput: null,
    parseConfidence: null,
    pendingReview: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    food: makeFood(micros),
  };
}

describe("scaleMicros", () => {
  it("scales per-100g micros by grams / 100", () => {
    expect(scaleMicros({ sodium: 100, calcium: 50 }, 200)).toEqual({ sodium: 200, calcium: 100 });
    expect(scaleMicros({ sodium: 100 }, 50)).toEqual({ sodium: 50 });
  });

  it("returns an empty map for null micros", () => {
    expect(scaleMicros(null, 100)).toEqual({});
  });
});

describe("sumMicros", () => {
  it("sums scaled micros across rows and unions keys", () => {
    const totals = sumMicros([
      makeRow({ sodium: 100, iron: 5 }, 100), // sodium 100, iron 5
      makeRow({ sodium: 100 }, 50), // sodium 50
      makeRow(null, 100), // contributes nothing
    ]);
    expect(totals).toEqual({ sodium: 150, iron: 5 });
  });
});

describe("buildMicroSummary", () => {
  it("emits amount + %RDI for micros with data, omitting the rest", () => {
    // 200g of a food with 1000mg sodium/100g = 2000mg → 87% of the 2300mg RDI.
    const summary = buildMicroSummary([makeRow({ sodium: 1000 }, 200)]);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ key: "sodium", unit: "mg", amount: 2000, rdi: 2300, pctRdi: 87 });
  });

  it("returns no rows when no food carries micro data", () => {
    expect(buildMicroSummary([makeRow(null, 100)])).toEqual([]);
  });
});

describe("USDA micro extraction (unit-filtered)", () => {
  it("reads mg/µg micros and ignores wrong-unit encodings", () => {
    const mapped = mapUsdaSearchFood({
      fdcId: 1,
      description: "Test",
      foodNutrients: [
        { nutrientNumber: "1093", unitName: "MG", value: 50 }, // sodium → 50 mg
        { nutrientNumber: "1106", unitName: "UG", value: 300 }, // vitamin A → 300 mcg
        { nutrientNumber: "1114", unitName: "IU", value: 600 }, // vitamin D in IU → skipped
        { nutrientNumber: "1114", unitName: "UG", value: 15 }, // vitamin D in µg → 15 mcg
      ],
    });
    expect(mapped?.micros).toEqual({ sodium: 50, vitaminA: 300, vitaminD: 15 });
  });

  it("yields null micros when none are present", () => {
    const mapped = mapUsdaSearchFood({ fdcId: 2, description: "Bare", foodNutrients: [] });
    expect(mapped?.micros).toBeNull();
  });
});

describe("OFF micro extraction (grams → unit)", () => {
  it("converts gram-based nutriments to mg / mcg (guards the 1000x trap)", () => {
    const mapped = mapOffProduct("123", {
      product_name: "Test",
      nutriments: {
        sodium_100g: 0.5, // 0.5 g → 500 mg
        "vitamin-a_100g": 0.0003, // 0.0003 g → 300 mcg
      } as never,
    });
    expect(mapped?.micros).toEqual({ sodium: 500, vitaminA: 300 });
  });
});
