import type { Food, FoodWithServingsResponse } from "@shared/schema";

import { logger } from "../../logger";
import { getRuntimeCache, runtimeCacheKey, setRuntimeCache } from "../../sharedRuntimeState";
import { storage } from "../../storage";
import type { MappedFood } from "./types";
import { fetchUsdaFoodDetail, type UsdaFoodDetail } from "./usdaClient";
import { type ProviderDeadline, startProviderDeadline } from "./utils";

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

  // The USDA read runs under one deadline, retries included: with only its
  // per-attempt timeouts it could outlast the client's request timeout, and
  // the food could not be opened to log at all. Past it, the food opens with
  // what is cached. D13 (CODEBASE_ANALYSIS_2026-10-03)
  const deadline = startProviderDeadline();
  return enrichFromUsda(id, food, initialServings, deadline).finally(() => {
    deadline.clear();
  });
}

/**
 * How long what a USDA detail read lacked is remembered. USDA data is fixed per
 * fdcId, so this only bounds the marker's life in server_runtime_cache.
 */
const USDA_DETAIL_READ_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USDA_DETAIL_READ_SCOPE = "usda-detail-read";

/** What a USDA food still lacks that its detail endpoint could fill. */
interface UsdaGaps {
  readonly fdcId: string;
  readonly portions: boolean;
  readonly micros: boolean;
}

function hasMicros(micros: Food["micros"] | undefined): boolean {
  return micros !== null && micros !== undefined && Object.keys(micros).length > 0;
}

/** The gaps a detail read could fill, or null when it is not a USDA food or lacks nothing. */
function usdaGaps(food: Food, servings: FoodWithServingsResponse["servings"]): UsdaGaps | null {
  if (food.source !== "usda" || !food.sourceId) return null;
  const gaps = {
    fdcId: food.sourceId,
    portions: servings.length === 0,
    micros: !hasMicros(food.micros),
  };
  return gaps.portions || gaps.micros ? gaps : null;
}

/**
 * What a USDA detail read came back without. The marker stores this, a fact
 * about the USDA record, rather than what the opening user's food still
 * lacked: that depends on who opened it (their personal servings count) and on
 * whether the backfill writes landed, and another user's open must not skip a
 * read that could fill its own gaps.
 */
interface UsdaDetailLacks {
  readonly noPortions: boolean;
  readonly noMicros: boolean;
}

function detailLacks(detail: UsdaFoodDetail): UsdaDetailLacks {
  return {
    noPortions: detail.portions.length === 0,
    noMicros: !hasMicros(detail.food?.micros),
  };
}

/** Whether USDA lacks every gap this open has, so reading it again cannot help. */
function readCannotHelp(gaps: UsdaGaps, lacks: UsdaDetailLacks | undefined): boolean {
  const portionsSettled = !gaps.portions || lacks?.noPortions === true;
  const microsSettled = !gaps.micros || lacks?.noMicros === true;
  return portionsSettled && microsSettled;
}

/** Remember what a detail read lacked, for every replica. Best-effort: it only saves a repeat read. */
async function rememberDetailRead(
  readKey: string,
  fdcId: string,
  lacks: UsdaDetailLacks,
): Promise<void> {
  try {
    await setRuntimeCache(readKey, lacks, USDA_DETAIL_READ_TTL_MS);
  } catch (err) {
    // fdcId is a public USDA catalogue id, not user data.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, fdcId }, "Could not remember a USDA detail read");
  }
}

/**
 * Backfill a food's named servings and micros from one USDA detail read,
 * within `deadline`. A Branded food has no portions and often no extra micros,
 * so every open used to read its detail again, twice (once for each), and
 * spend the shared hourly key on an answer that does not change. What a read
 * comes back without is now remembered, and a later open skips the read only
 * when USDA is known to lack everything that open is missing. PF11
 * (CODEBASE_ANALYSIS_2026-10-03)
 */
async function enrichFromUsda(
  id: string,
  food: Food,
  initialServings: FoodWithServingsResponse["servings"],
  deadline: ProviderDeadline,
): Promise<FoodWithServingsResponse> {
  const unchanged = { food, servings: initialServings };
  const gaps = usdaGaps(food, initialServings);
  if (!gaps) return unchanged;

  const readKey = runtimeCacheKey(USDA_DETAIL_READ_SCOPE, gaps.fdcId);
  const known = await getRuntimeCache<UsdaDetailLacks>(readKey).catch(() => undefined);
  if (readCannotHelp(gaps, known)) return unchanged;
  const detail = await deadline
    .within(fetchUsdaFoodDetail(gaps.fdcId, { signal: deadline.signal }))
    .catch(() => null);
  if (!detail) return unchanged;

  const servings =
    gaps.portions && detail.portions.length > 0
      ? await storage.nutrition.cacheServings(id, detail.portions)
      : initialServings;
  const enriched = gaps.micros ? await saveUsdaMicros(food, detail.food) : food;
  const lacks = detailLacks(detail);
  if (lacks.noPortions || lacks.noMicros) await rememberDetailRead(readKey, gaps.fdcId, lacks);
  return { food: enriched, servings };
}

/**
 * Save the micronutrients a USDA detail read carried onto the cached food:
 * search results carry only a sparse micro set, so most cached USDA foods have
 * null micros until first opened. Best-effort: returns the original food
 * unchanged on a miss or a failed write, so opening a food never fails on
 * enrichment.
 */
async function saveUsdaMicros(food: Food, detail: MappedFood | null): Promise<Food> {
  if (!detail || !hasMicros(detail.micros)) return food;
  try {
    const [updated] = await storage.nutrition.upsertFoods([detail]);
    return updated ?? food;
  } catch {
    return food;
  }
}
