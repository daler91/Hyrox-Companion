import type { Food } from "@shared/schema";

/**
 * Shared `Food` fixture for the nutrition service tests. Defaults to a simple
 * shared USDA food; pass `over` to tweak any field. Kept in one place so the
 * factory isn't duplicated across the service specs.
 */
export function makeFood(over: Partial<Food> = {}): Food {
  return {
    id: "id1",
    source: "usda",
    sourceId: "1",
    name: "Banana",
    brand: null,
    servingSizeG: null,
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbPer100g: 23,
    fatPer100g: 0.3,
    fiberPer100g: 2.6,
    micros: null,
    lastFetchedAt: null,
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}
