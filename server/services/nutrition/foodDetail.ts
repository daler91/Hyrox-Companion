import type { Food, FoodWithServingsResponse } from "@shared/schema";

import { storage } from "../../storage";
import { fetchUsdaFoodById, fetchUsdaFoodPortions } from "./usdaClient";

/**
 * A food plus its named servings for the log dialog (FR-2.4). For a USDA food
 * this is also the lazy-enrichment point: on first open we best-effort backfill
 * named servings ("1 cup") and the richer micronutrient set from the USDA
 * food-detail endpoint (search results carry only a sparse micro set), caching
 * both. Visibility-scoped; null if not visible to the user.
 */
export async function getFoodWithServings(
  userId: string,
  id: string,
): Promise<FoodWithServingsResponse | null> {
  // ⚡ Bolt Performance Optimization: `getServings(id, userId)` queries
  // `food_servings` by the raw `id`/`userId` params, not by anything read
  // off the `foods` row — so it doesn't actually depend on
  // `getVisibleFoodById`'s result. The two were awaited sequentially (one
  // full DB round trip each) on every food-log-dialog open; running them
  // via `Promise.all` halves that round-trip latency on the common (food
  // found) path. On the rare "food not visible" 404 path this now fires one
  // extra, harmless `getServings` query instead of skipping it — the same
  // trade-off already made for the "stored-first" analytics routes.
  const [food, initialServings] = await Promise.all([
    storage.nutrition.getVisibleFoodById(userId, id),
    storage.nutrition.getServings(id, userId),
  ]);
  if (!food) return null;

  let servings = initialServings;
  if (servings.length === 0 && food.source === "usda" && food.sourceId) {
    const portions = await fetchUsdaFoodPortions(food.sourceId);
    if (portions.length > 0) {
      servings = await storage.nutrition.cacheServings(id, portions);
    }
  }

  return { food: await enrichUsdaMicros(food), servings };
}

/**
 * Backfill a USDA food's micronutrients from the detail endpoint the first time
 * it's opened — search results carry only a sparse micro set, so most cached USDA
 * foods have null micros until now. Best-effort: returns the original food
 * unchanged on any miss/error so opening a food never fails on enrichment.
 */
async function enrichUsdaMicros(food: Food): Promise<Food> {
  if (food.source !== "usda" || !food.sourceId) return food;
  if (food.micros && Object.keys(food.micros).length > 0) return food;
  try {
    const detail = await fetchUsdaFoodById(food.sourceId);
    if (!detail?.micros || Object.keys(detail.micros).length === 0) return food;
    const [updated] = await storage.nutrition.upsertFoods([detail]);
    return updated ?? food;
  } catch {
    return food;
  }
}
