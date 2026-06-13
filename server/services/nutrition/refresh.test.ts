import type { Food } from "@shared/schema";
import { describe, expect, it, vi } from "vitest";

// Mock the side-effectful imports so loading refresh.ts doesn't pull in the DB.
vi.mock("../../storage", () => ({ storage: { nutrition: { upsertFoods: vi.fn() } } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("./fatsecretClient", () => ({ getFatSecretFoodById: vi.fn() }));
vi.mock("./offClient", () => ({ resolveBarcode: vi.fn() }));
vi.mock("./usdaClient", () => ({ fetchUsdaFoodById: vi.fn() }));

import { isStaleFood, STALE_AFTER_MS } from "./refresh";

function food(over: Partial<Food>): Food {
  return {
    id: "id1",
    source: "usda",
    sourceId: "1",
    name: "X",
    brand: null,
    servingSizeG: null,
    caloriesPer100g: 1,
    proteinPer100g: null,
    carbPer100g: null,
    fatPer100g: null,
    fiberPer100g: null,
    micros: null,
    lastFetchedAt: new Date(),
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("isStaleFood", () => {
  it("is stale when never stamped (legacy cached row)", () => {
    expect(isStaleFood(food({ lastFetchedAt: null }))).toBe(true);
  });

  it("is stale when older than the threshold", () => {
    expect(isStaleFood(food({ lastFetchedAt: new Date(Date.now() - STALE_AFTER_MS - 1000) }))).toBe(true);
  });

  it("is fresh when stamped recently", () => {
    expect(isStaleFood(food({ lastFetchedAt: new Date() }))).toBe(false);
  });

  it("never refreshes a custom food (no upstream)", () => {
    expect(isStaleFood(food({ source: "custom", sourceId: null, lastFetchedAt: null }))).toBe(false);
  });

  it("never refreshes a row without a source id", () => {
    expect(isStaleFood(food({ sourceId: null, lastFetchedAt: null }))).toBe(false);
  });
});
