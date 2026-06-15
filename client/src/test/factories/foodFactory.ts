import type { Food } from "@shared/schema";

/**
 * Shared `Food` fixture for client nutrition tests. Defaults to a simple shared
 * USDA banana; pass overrides to tweak any field.
 */
export function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: "f1",
    source: "usda",
    sourceId: "1",
    name: "Banana",
    brand: null,
    servingSizeG: 118,
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
    ...overrides,
  };
}

/** The canonical banana (id "f1") used by the nutrition component specs. */
export const BANANA: Food = makeFood();
