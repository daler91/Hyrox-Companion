import { describe, expect, it } from "vitest";

import { NutritionStorage } from "../nutrition";

/**
 * Every method the nutrition storage facade exposes, keyed by the sub-domain
 * module that owns it (A8). The implementations moved out of one 1,246-line
 * class into these modules; the facade binds them under their original names
 * because ~20 call sites and every route test mock address them as
 * `storage.nutrition.X`. A method dropped during a future move fails here
 * rather than at the call site.
 */
const EXPECTED_METHODS: Record<string, readonly string[]> = {
  nutritionFoods: [
    "searchLocalFoods",
    "upsertFoods",
    "getVisibleFoodById",
    "getFoodBySourceId",
    "getVisibleFoodsByIds",
    "getRecentFoods",
    "createCustomFood",
    "updateCustomFood",
    "deleteCustomFood",
    "listPrivateCustomFoodIds",
    "listCustomFoods",
    "getServings",
    "cacheServings",
    "createServing",
    "deleteServing",
  ],
  nutritionLogs: [
    "createLogEntry",
    "createLogEntriesBatch",
    "listEntriesWithFoodForDate",
    "hasEntriesOnDate",
    "hasEntriesSince",
    "listEntriesWithFoodInWindow",
    "listEntriesWithFoodForDateRange",
    "updateLogEntry",
    "deleteLogEntry",
    "repeatDay",
    "getLatestLogDate",
    "countLogEntries",
  ],
  nutritionFavorites: ["listFavorites", "addFavorite", "removeFavorite"],
  nutritionRecipes: [
    "createRecipe",
    "updateRecipe",
    "deleteRecipe",
    "listRecipes",
    "getRecipeWithIngredients",
  ],
  nutritionTargets: [
    "getCurrentTarget",
    "listTargets",
    "createTarget",
    "getMealTargetOverrides",
    "upsertMealTarget",
    "deleteMealTarget",
  ],
};

describe("NutritionStorage facade partition (A8)", () => {
  const storage = new NutritionStorage();
  const expected = Object.values(EXPECTED_METHODS).flat();

  it("exposes exactly the expected method surface", () => {
    const actual = Object.keys(storage).sort();
    expect(actual).toEqual([...expected].sort());
  });

  it.each(expected)("binds %s to a callable implementation", (name) => {
    expect(typeof (storage as unknown as Record<string, unknown>)[name]).toBe("function");
  });

  it("keeps the private helpers out of the public surface", () => {
    // getLastPortions/withPortionMemory (shared) and the recipe/target version
    // writers were private members and must not become facade methods.
    for (const internal of [
      "getLastPortions",
      "withPortionMemory",
      "computeFromInputs",
      "backingFoodValues",
      "replaceTargetVersion",
      "replaceMealTargetVersion",
    ]) {
      expect(Object.keys(storage)).not.toContain(internal);
    }
  });
});
