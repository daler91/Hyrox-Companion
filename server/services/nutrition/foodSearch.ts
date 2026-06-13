import type { Food, FoodSearchResponse } from "@shared/schema";

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchFatSecretFoods } from "./fatsecretClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import { searchUsdaFoods } from "./usdaClient";

/**
 * Food search orchestration (FR-1.1). Queries the local `foods` cache plus the
 * live providers — FatSecret (verified branded, preferred) and USDA — concurrently,
 * caching any hits back into `foods`. Provider failures are swallowed so manual
 * logging keeps working from cache (NFR-5), surfaced via `apiDegraded`. Results
 * rank FatSecret → USDA → local, deduped.
 */

const LOCAL_LIMIT = 25;
const MAX_RESULTS = 30;

/** Normalized brand+name identity for cross-source near-duplicate suppression.
 *  null (never suppressed) when there's no brand — generic foods sharing a name
 *  across sources are legitimately distinct entries and must not collapse. */
function labelKey(food: Food): string | null {
  const brand = food.brand?.trim().toLowerCase();
  if (!brand) return null;
  // Space-joined; a deliberately conservative key (exact brand+name match) so we
  // only collapse genuine cross-source duplicates, not just similarly-named foods.
  return `${brand} ${food.name.trim().toLowerCase()}`;
}

/** Merge source tiers in priority order, deduped by identity (`source:sourceId`)
 *  and, for branded items, by brand+name so the same product from two sources is
 *  shown once. */
function mergeFoods(tiers: Food[][]): Food[] {
  const seenKey = new Set<string>();
  const seenLabel = new Set<string>();
  const out: Food[] = [];
  for (const tier of tiers) {
    for (const food of tier) {
      const key = food.sourceId ? `${food.source}:${food.sourceId}` : `id:${food.id}`;
      if (seenKey.has(key)) continue;
      const label = labelKey(food);
      if (label && seenLabel.has(label)) continue;
      seenKey.add(key);
      if (label) seenLabel.add(label);
      out.push(food);
    }
  }
  return out.slice(0, MAX_RESULTS);
}

export async function searchFoods(query: string, userId: string): Promise<FoodSearchResponse> {
  const local = await storage.nutrition.searchLocalFoods(query, userId, LOCAL_LIMIT);

  // Query the live providers concurrently; one failing must not sink the other.
  const [fsSettled, usdaSettled] = await Promise.allSettled([
    searchFatSecretFoods(query),
    searchUsdaFoods(query),
  ]);

  let fatsecret: Food[] = [];
  let fatsecretLive = false;
  if (fsSettled.status === "fulfilled") {
    fatsecretLive = fsSettled.value.reached;
    if (fsSettled.value.foods.length > 0) {
      fatsecret = await storage.nutrition.upsertFoods(fsSettled.value.foods);
    }
  } else {
    logger.warn({ err: fsSettled.reason, query }, "[nutrition] FatSecret search failed; continuing");
  }

  let usda: Food[] = [];
  let usdaLive = false;
  if (usdaSettled.status === "fulfilled") {
    // USDA returns [] WITHOUT a live call when no API key is set; with a key, a
    // fulfilled result (even empty) means the API was reached.
    usdaLive = Boolean(env.USDA_API_KEY);
    if (usdaSettled.value.length > 0) {
      usda = await storage.nutrition.upsertFoods(usdaSettled.value);
    }
  } else {
    logger.warn({ err: usdaSettled.reason, query }, "[nutrition] USDA search failed; returning cached foods only");
  }

  // Cache-only ⇒ degraded: no live provider reached its API (matches the prior
  // USDA-only behavior when FatSecret is unconfigured).
  const apiDegraded = !fatsecretLive && !usdaLive;

  const results = mergeFoods([fatsecret, usda, local]);
  // Self-heal stale cached rows in the background; never blocks the response.
  refreshStaleFoodsInBackground(results);
  return { results, apiDegraded };
}
