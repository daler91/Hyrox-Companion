import type { Food, FoodSearchResponse } from "@shared/schema";

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchEdamamFoods } from "./edamamClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import type { MappedFood } from "./types";
import { searchUsdaFoods } from "./usdaClient";

/**
 * Food search orchestration (FR-1.1). Queries the local `foods` cache plus the
 * live providers — Edamam (curated branded, preferred) and USDA — concurrently,
 * caching any hits back into `foods`. Provider failures are swallowed so manual
 * logging keeps working from cache (NFR-5), surfaced via `apiDegraded`. Results
 * rank Edamam → USDA → local, deduped.
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
/** Cache a provider's mapped results, degrading to cache-only (never throwing) if
 *  the write fails. A transient DB error — or the brief window after a deploy but
 *  before an additive `foods` migration (e.g. a new `source` value) is applied —
 *  must not 500 the search; the live results are simply skipped that request. */
async function cacheResults(mapped: MappedFood[], provider: string): Promise<Food[]> {
  if (mapped.length === 0) return [];
  try {
    return await storage.nutrition.upsertFoods(mapped);
  } catch (err) {
    logger.warn({ err, provider }, "[nutrition] caching search results failed; serving cache only");
    return [];
  }
}

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
  const [edamamSettled, usdaSettled] = await Promise.allSettled([
    searchEdamamFoods(query),
    searchUsdaFoods(query),
  ]);

  let edamam: Food[] = [];
  let edamamLive = false;
  if (edamamSettled.status === "fulfilled") {
    edamamLive = edamamSettled.value.reached;
    edamam = await cacheResults(edamamSettled.value.foods, "edamam");
  } else {
    logger.warn({ err: edamamSettled.reason, query }, "[nutrition] Edamam search failed; continuing");
  }

  let usda: Food[] = [];
  let usdaLive = false;
  if (usdaSettled.status === "fulfilled") {
    // USDA returns [] WITHOUT a live call when no API key is set; with a key, a
    // fulfilled result (even empty) means the API was reached.
    usdaLive = Boolean(env.USDA_API_KEY);
    usda = await cacheResults(usdaSettled.value, "usda");
  } else {
    logger.warn({ err: usdaSettled.reason, query }, "[nutrition] USDA search failed; returning cached foods only");
  }

  // Cache-only ⇒ degraded: no live provider reached its API (matches the prior
  // USDA-only behavior when Edamam is unconfigured).
  const apiDegraded = !edamamLive && !usdaLive;

  const results = mergeFoods([edamam, usda, local]);
  // Diagnostic: where the merged results came from, so it's clear in the logs
  // whether Edamam is actually contributing branded hits vs. all-USDA.
  logger.info(
    {
      query,
      edamamLive,
      usdaLive,
      edamam: edamam.length,
      usda: usda.length,
      local: local.length,
      results: results.length,
      apiDegraded,
    },
    "[nutrition] food search result mix",
  );
  // Self-heal stale cached rows in the background; never blocks the response.
  refreshStaleFoodsInBackground(results);
  return { results, apiDegraded };
}
