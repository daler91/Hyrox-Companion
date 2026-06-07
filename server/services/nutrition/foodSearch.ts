import type { Food, FoodSearchResponse } from "@shared/schema";

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchUsdaFoods } from "./usdaClient";

/**
 * Food search orchestration (FR-1.1). Queries the local `foods` cache, then
 * USDA, caching any USDA hits back into `foods`. USDA failures are swallowed so
 * manual logging keeps working from cache (NFR-5) — surfaced via `apiDegraded`.
 */

const LOCAL_LIMIT = 25;
const MAX_RESULTS = 30;

/** Merge USDA (fresh, relevance-ordered) ahead of local, deduped by identity. */
function mergeFoods(usda: Food[], local: Food[]): Food[] {
  const seen = new Set<string>();
  const out: Food[] = [];
  for (const food of [...usda, ...local]) {
    const key = food.sourceId ? `${food.source}:${food.sourceId}` : `id:${food.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(food);
  }
  return out.slice(0, MAX_RESULTS);
}

export async function searchFoods(query: string): Promise<FoodSearchResponse> {
  const local = await storage.nutrition.searchLocalFoods(query, LOCAL_LIMIT);

  let apiDegraded = false;
  let usda: Food[] = [];
  try {
    const mapped = await searchUsdaFoods(query);
    if (mapped.length > 0) {
      usda = await storage.nutrition.upsertFoods(mapped);
    } else if (!env.USDA_API_KEY) {
      // No key configured: we never called the API, so results are cache-only.
      apiDegraded = true;
    }
  } catch (err) {
    logger.warn({ err, query }, "[nutrition] USDA search failed; returning cached foods only");
    apiDegraded = true;
  }

  return { results: mergeFoods(usda, local), apiDegraded };
}
