import type { Food } from "@shared/schema";

import { logger } from "../../logger";
import { storage } from "../../storage";
import { getEdamamFoodById } from "./edamamClient";
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

// A refetch that came back empty or failed leaves the row unstamped, so it
// stays stale, and every search or barcode response serving it used to fire
// another Edamam / Open Food Facts call: paid quota, and the shared OFF rate
// limit pushed toward 429s. This instance now waits this long before asking
// that upstream about the row again, and never runs two refreshes of one food
// at once. PF13 (CODEBASE_ANALYSIS_2026-10-03)
export const REFRESH_RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;
// Bounded like the other server caches; the oldest entry makes room.
const MAX_BACKOFF_ENTRIES = 1000;

/** Foods with a refresh running now, by id. */
const refreshesInFlight = new Map<string, Promise<void>>();
/** Food id → when (epoch ms) a failed or empty refresh may be tried again. */
const retryNotBefore = new Map<string, number>();

export function __resetFoodRefreshStateForTests(): void {
  refreshesInFlight.clear();
  retryNotBefore.clear();
}

function isBackingOff(foodId: string, now: number): boolean {
  const notBefore = retryNotBefore.get(foodId);
  if (notBefore === undefined) return false;
  if (notBefore > now) return true;
  retryNotBefore.delete(foodId);
  return false;
}

function backOff(foodId: string): void {
  retryNotBefore.delete(foodId);
  if (retryNotBefore.size >= MAX_BACKOFF_ENTRIES) {
    const oldest = retryNotBefore.keys().next();
    if (!oldest.done) retryNotBefore.delete(oldest.value);
  }
  retryNotBefore.set(foodId, Date.now() + REFRESH_RETRY_BACKOFF_MS);
}

/** A shared external row is stale if it has no fetch stamp or an old one. Custom
 *  foods have no upstream and are never stale. */
export function isStaleFood(food: Food): boolean {
  if (food.source === "custom" || !food.sourceId) return false;
  if (!food.lastFetchedAt) return true;
  // ⚡ Bolt Performance Optimization:
  // Avoid redundant new Date() allocation since Drizzle already provides a Date object
  // for timestamp fields. This eliminates unnecessary garbage collection overhead.
  return Date.now() - food.lastFetchedAt.getTime() > STALE_AFTER_MS;
}

/** Re-fetch a cached food from its upstream source by its source id. */
async function refetch(food: Food): Promise<MappedFood | null> {
  if (!food.sourceId) return null;
  switch (food.source) {
    case "off":
      return resolveBarcode(food.sourceId); // OFF foods are keyed by the barcode
    case "edamam":
      return getEdamamFoodById(food.sourceId, food.name); // re-search by name, match foodId
    case "usda":
      return fetchUsdaFoodById(food.sourceId); // keyed by fdcId
    // `fatsecret` and `spoonacular` are still legal `foods.source` values but
    // have no client any more (nothing ever created a row with either — their
    // search paths were never wired in). Such a row would fall through to
    // `default` and simply keep serving its cached values, which is what an
    // un-refreshable row should do.
    default:
      return null;
  }
}

/** Refresh one row; an empty or failed refetch backs it off. Never rejects. */
async function refreshFood(food: Food): Promise<void> {
  try {
    const mapped = await refetch(food);
    if (mapped) {
      await storage.nutrition.upsertFoods([mapped]);
      return;
    }
    backOff(food.id);
  } catch (err) {
    backOff(food.id);
    // err is an upstream or DB error; the food id and source name a shared
    // reference row, not the athlete.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, foodId: food.id, source: food.source }, "[nutrition] background cache refresh failed");
  }
}

/** The stale rows this response may refresh: not already running, not backing off, capped. */
function pickRefreshable(foods: Food[], now: number): Food[] {
  const picked = new Map<string, Food>();
  for (const food of foods) {
    if (picked.size >= MAX_REFRESH_PER_REQUEST) break;
    const skip = picked.has(food.id) || refreshesInFlight.has(food.id) || !isStaleFood(food);
    if (!skip && !isBackingOff(food.id, now)) picked.set(food.id, food);
  }
  return [...picked.values()];
}

/**
 * Fire-and-forget refresh of the stalest rows in `foods`. Never awaited by the
 * caller and never throws — a refresh failure leaves the (still-valid) cached row
 * in place. Capped per call so background load stays bounded.
 */
export function refreshStaleFoodsInBackground(foods: Food[]): void {
  for (const food of pickRefreshable(foods, Date.now())) {
    const running = refreshFood(food).finally(() => refreshesInFlight.delete(food.id));
    refreshesInFlight.set(food.id, running);
  }
}
