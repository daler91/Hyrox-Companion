import { describe, expect, it } from "vitest";

import { clampMacro, sanitizeMappedFood } from "./sanitize";
import type { MappedFood } from "./types";

function food(over: Partial<MappedFood> = {}): MappedFood {
  return {
    source: "off",
    sourceId: "x",
    name: "Test Food",
    brand: null,
    servingSizeG: 30,
    caloriesPer100g: 100,
    proteinPer100g: 5,
    carbPer100g: 10,
    fatPer100g: 2,
    fiberPer100g: 1,
    micros: null,
    ...over,
  };
}

describe("clampMacro", () => {
  it("passes a finite, in-range value (including 0)", () => {
    expect(clampMacro(50, 200)).toBe(50);
    expect(clampMacro(0, 200)).toBe(0);
  });

  it("rejects NaN / Infinity / negative / over-ceiling / nullish as null", () => {
    expect(clampMacro(Number.NaN, 200)).toBeNull();
    expect(clampMacro(Infinity, 200)).toBeNull();
    expect(clampMacro(-1, 200)).toBeNull();
    expect(clampMacro(201, 200)).toBeNull();
    expect(clampMacro(null, 200)).toBeNull();
    expect(clampMacro(undefined, 200)).toBeNull();
  });
});

describe("sanitizeMappedFood", () => {
  it("passes a clean food through, trimming the name", () => {
    const out = sanitizeMappedFood(food({ name: "  Banana  " }));
    expect(out?.name).toBe("Banana");
    expect(out?.caloriesPer100g).toBe(100);
  });

  it("nulls individual NaN / negative / absurd macros without dropping the food", () => {
    const out = sanitizeMappedFood(
      food({ caloriesPer100g: Number.NaN, proteinPer100g: -5, carbPer100g: 9999, fatPer100g: 2 }),
    );
    expect(out).not.toBeNull();
    expect(out?.caloriesPer100g).toBeNull(); // NaN
    expect(out?.proteinPer100g).toBeNull(); // negative
    expect(out?.carbPer100g).toBeNull(); // over the 200/100g macro ceiling
    expect(out?.fatPer100g).toBe(2); // valid value preserved
  });

  it("clamps calories to the 1000/100g ceiling (nulls anything above)", () => {
    expect(sanitizeMappedFood(food({ caloriesPer100g: 1500 }))?.caloriesPer100g).toBeNull();
    expect(sanitizeMappedFood(food({ caloriesPer100g: 900 }))?.caloriesPer100g).toBe(900);
  });

  it("drops a food with no name", () => {
    expect(sanitizeMappedFood(food({ name: "   " }))).toBeNull();
  });

  it("drops a food with no usable macro at all", () => {
    const out = sanitizeMappedFood(
      food({
        caloriesPer100g: null,
        proteinPer100g: null,
        carbPer100g: null,
        fatPer100g: null,
        fiberPer100g: null,
      }),
    );
    expect(out).toBeNull();
  });

  it("keeps a fiber-only food (fiber counts as loggable)", () => {
    const out = sanitizeMappedFood(
      food({
        caloriesPer100g: null,
        proteinPer100g: null,
        carbPer100g: null,
        fatPer100g: null,
        fiberPer100g: 2.1,
      }),
    );
    expect(out?.fiberPer100g).toBe(2.1);
  });

  it("nulls a non-finite / non-positive / absurd serving size", () => {
    expect(sanitizeMappedFood(food({ servingSizeG: -1 }))?.servingSizeG).toBeNull();
    expect(sanitizeMappedFood(food({ servingSizeG: 200_000 }))?.servingSizeG).toBeNull();
    expect(sanitizeMappedFood(food({ servingSizeG: 30 }))?.servingSizeG).toBe(30);
  });

  it("drops bad micro entries but keeps the good ones", () => {
    const out = sanitizeMappedFood(
      food({ micros: { sodium: 50, potassium: Number.NaN, calcium: -1 } }),
    );
    expect(out?.micros).toEqual({ sodium: 50 });
  });

  it("nulls the micro map when nothing survives", () => {
    expect(sanitizeMappedFood(food({ micros: { sodium: Number.NaN } }))?.micros).toBeNull();
  });
});
