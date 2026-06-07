import type { FoodWithServingsResponse } from "@shared/schema";

import { storage } from "../../storage";
import { fetchUsdaFoodPortions } from "./usdaClient";

/**
 * A food plus its named servings for the log dialog (FR-2.4). For a USDA food
 * with no cached servings yet, best-effort-enrich from USDA food-detail portions
 * (e.g. "1 cup") and cache them. Visibility-scoped; null if not visible to the user.
 */
export async function getFoodWithServings(
  userId: string,
  id: string,
): Promise<FoodWithServingsResponse | null> {
  const food = await storage.nutrition.getVisibleFoodById(userId, id);
  if (!food) return null;

  let servings = await storage.nutrition.getServings(id);
  if (servings.length === 0 && food.source === "usda" && food.sourceId) {
    const portions = await fetchUsdaFoodPortions(food.sourceId);
    if (portions.length > 0) {
      servings = await storage.nutrition.cacheServings(id, portions);
    }
  }

  return { food, servings };
}
