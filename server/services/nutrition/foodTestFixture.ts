import type { Food } from "@shared/schema";

import type { LogEntryWithFood } from "./rollup";

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
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/**
 * Round-number `Food` (100 kcal / 10 P / 20 C / 5 F / 2 fiber per 100 g) for the
 * rollup-style specs, whose expectations lean on easy per-100g math.
 */
export function makeLoggedFood(over: Partial<Food> = {}): Food {
  return makeFood({
    id: "f1",
    name: "Test Food",
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
    ...over,
  });
}

/**
 * Shared joined-log-entry fixture (the shape the storage layer returns). Defaults
 * to 100 g of {@link makeLoggedFood} at breakfast on 2026-06-07; pass `entryOver`
 * / `foodOver` to tweak either side of the join.
 */
export function makeLogRow(
  entryOver: Partial<LogEntryWithFood> = {},
  foodOver: Partial<Food> = {},
): LogEntryWithFood {
  const food = makeLoggedFood(foodOver);
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
