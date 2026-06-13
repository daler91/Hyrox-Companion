import type { Food } from "@shared/schema";

import { logger } from "../../logger";
import { storage } from "../../storage";
import { getFatSecretFoodById } from "./fatsecretClient";
import { resolveBarcode } from "./offClient";
import type { MappedFood } from "./types";
import { fetchUsdaFoodById } from "./usdaClient";

/**
 * Cache freshness. External nutrition data drifts — products get reformulated and
 * upstream entries corrected — but a cached `foods` row would otherwise stay wrong
 * forever. Every upsert stamps `lastFetchedAt`; a row older than STALE_AFTER_MS
 * (or never stamped) is refreshed lazily in the background when it's served, so
 * the user always gets the cached value instantly while the cache self-heals.
 */

// External nutrition data changes slowly; 60 days keeps refresh traffic tiny.
export const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
// Bound the background work one request can trigger (a search can return many
// stale rows); the rest are picked up on subsequent requests.
const MAX_REFRESH_PER_REQUEST = 3;

/** A shared external row is stale if it has no fetch stamp or an old one. Custom
 *  foods have no upstream and are never stale. */
export function isStaleFood(food: Food): boolean {
  if (food.source === "custom" || !food.sourceId) return false;
  if (!food.lastFetchedAt) return true;
  return Date.now() - new Date(food.lastFetchedAt).getTime() > STALE_AFTER_MS;
}

/** Re-fetch a cached food from its upstream source by its source id. */
async function refetch(food: Food): Promise<MappedFood | null> {
  if (!food.sourceId) return null;
  switch (food.source) {
    case "off":
      return resolveBarcode(food.sourceId); // OFF foods are keyed by the barcode
    case "fatsecret":
      return getFatSecretFoodById(food.sourceId); // keyed by FatSecret food_id
    case "usda":
      return fetchUsdaFoodById(food.sourceId); // keyed by fdcId
    default:
      return null;
  }
}

/**
 * Fire-and-forget refresh of the stalest rows in `foods`. Never awaited by the
 * caller and never throws — a refresh failure leaves the (still-valid) cached row
 * in place. Capped per call so background load stays bounded.
 */
export function refreshStaleFoodsInBackground(foods: Food[]): void {
  const stale = foods.filter(isStaleFood).slice(0, MAX_REFRESH_PER_REQUEST);
  if (stale.length === 0) return;
  void Promise.allSettled(
    stale.map(async (food) => {
      try {
        const mapped = await refetch(food);
        if (mapped) await storage.nutrition.upsertFoods([mapped]);
      } catch (err) {
        logger.warn({ err, foodId: food.id, source: food.source }, "[nutrition] background cache refresh failed");
      }
    }),
  );
}
