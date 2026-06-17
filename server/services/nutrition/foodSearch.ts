import type { Food, FoodSearchResponse } from "@shared/schema";

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchEdamamFoods } from "./edamamClient";
import { searchOffFoods } from "./offClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import type { MappedFood } from "./types";
import { searchUsdaFoods } from "./usdaClient";

/**
 * Food search orchestration (FR-1.1). Queries the local `foods` cache plus the
 * live providers — Edamam (curated branded, preferred), USDA, and Open Food Facts
 * — concurrently, caching any hits back into `foods`. OFF text search is noisy
 * (crowd-sourced, matches on ingredients/categories), so the OFF client only
 * returns hits whose name/brand actually matches the query (its relevance gate).
 * Provider failures are swallowed so manual logging keeps working from cache
 * (NFR-5), surfaced via `apiDegraded`. Results rank Edamam → USDA → OFF → local,
 * deduped — OFF (no API key needed) keeps search live even when neither keyed
 * provider is configured.
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
  // Flatten the priority tiers into one ordered stream (`flat` concatenates in
  // tier order, preserving Edamam → USDA → local ranking) so dedup is a single
  // pass rather than a nested loop.
  for (const food of tiers.flat()) {
    const key = food.sourceId ? `${food.source}:${food.sourceId}` : `id:${food.id}`;
    if (seenKey.has(key)) continue;
    const label = labelKey(food);
    if (label && seenLabel.has(label)) continue;
    seenKey.add(key);
    if (label) seenLabel.add(label);
    out.push(food);
  }
  return out.slice(0, MAX_RESULTS);
}

/** Re-key a settled provider result to the uniform `{ foods, live }` shape so
 *  both providers (Edamam's `{ foods, reached }` and USDA's bare array) flow
 *  through one resolver. Rejections pass through untouched. */
function toUniform<I, O>(
  settled: PromiseSettledResult<I>,
  map: (value: I) => O,
): PromiseSettledResult<O> {
  return settled.status === "fulfilled"
    ? { status: "fulfilled", value: map(settled.value) }
    : settled;
}

/** Resolve one provider's settled search: cache its hits (carrying the live flag),
 *  or log and degrade to cache-only on rejection. */
async function resolveProvider(
  settled: PromiseSettledResult<{ foods: MappedFood[]; live: boolean }>,
  provider: string,
  query: string,
  warnMsg: string,
): Promise<{ foods: Food[]; live: boolean }> {
  if (settled.status !== "fulfilled") {
    logger.warn({ err: settled.reason, query }, warnMsg);
    return { foods: [], live: false };
  }
  return { foods: await cacheResults(settled.value.foods, provider), live: settled.value.live };
}

export async function searchFoods(query: string, userId: string): Promise<FoodSearchResponse> {
  const local = await storage.nutrition.searchLocalFoods(query, userId, LOCAL_LIMIT);

  // Query the live providers concurrently; one failing must not sink the others.
  const [edamamSettled, usdaSettled, offSettled] = await Promise.allSettled([
    searchEdamamFoods(query),
    searchUsdaFoods(query),
    searchOffFoods(query),
  ]);

  // Resolve sequentially (Edamam → USDA → OFF) so the cache writes never race.
  const { foods: edamam, live: edamamLive } = await resolveProvider(
    toUniform(edamamSettled, (v) => ({ foods: v.foods, live: v.reached })),
    "edamam",
    query,
    "[nutrition] Edamam search failed; continuing",
  );
  // USDA returns [] WITHOUT a live call when no API key is set; with a key, a
  // fulfilled result (even empty) means the API was reached.
  const { foods: usda, live: usdaLive } = await resolveProvider(
    toUniform(usdaSettled, (v) => ({ foods: v, live: Boolean(env.USDA_API_KEY) })),
    "usda",
    query,
    "[nutrition] USDA search failed; returning cached foods only",
  );
  // OFF needs no API key, so a fulfilled result with `reached` means it answered;
  // its own client already applied the relevance gate before returning hits.
  const { foods: off, live: offLive } = await resolveProvider(
    toUniform(offSettled, (v) => ({ foods: v.foods, live: v.reached })),
    "off",
    query,
    "[nutrition] Open Food Facts search failed; continuing",
  );

  // Cache-only ⇒ degraded: no live provider reached its API. OFF (keyless) counts,
  // so a working OFF call keeps search live even with no USDA/Edamam credentials.
  const apiDegraded = !edamamLive && !usdaLive && !offLive;

  const results = mergeFoods([edamam, usda, off, local]);
  // Diagnostic: where the merged results came from, so it's clear in the logs
  // which sources are actually contributing hits.
  logger.info(
    {
      query,
      edamamLive,
      usdaLive,
      offLive,
      edamam: edamam.length,
      usda: usda.length,
      off: off.length,
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
