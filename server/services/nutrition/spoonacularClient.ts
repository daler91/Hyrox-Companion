import { env } from "../../env";
import { logger } from "../../logger";
import { parseRetryAfter, RetryableHttpError, retryWithJitter } from "../../utils/httpRetry";
import { MICRO_DEFS } from "./micros";
import type { MappedFood } from "./types";
import { num, OZ_TO_GRAMS } from "./utils";

/**
 * Spoonacular grocery-products client. A verified, frequently-updated source for
 * branded/packaged foods and UPC barcodes, normalized to the same PER-100-GRAM
 * basis as the USDA/OFF clients so it caches into `foods` through the identical
 * path. This is the one place Spoonacular's response shape is interpreted.
 *
 * Auth is a single API key passed as the `apiKey` query param (no OAuth, no IP
 * whitelisting — matching the USDA client's model). Like the other clients,
 * every failure mode (no key, an exhausted daily quota, a provider hiccup, an
 * unknown product) degrades to an empty result rather than throwing, so
 * search/barcode always fall back cleanly to USDA/Open Food Facts.
 *
 * Cost model: Spoonacular's free tier has a small daily point budget and its
 * product *search* returns only ids (no nutrition), so each search costs one
 * search call + one detail call per product. We cap detail fetches per search
 * (SPOONACULAR_MAX_PRODUCTS) and cache every resolved food in `foods`, so the
 * steady-state cost is only newly-seen products.
 *
 * The AI architecture rule (BRD §7) does not apply — these are real, verified
 * numbers from Spoonacular, not generated values.
 */

const SPOONACULAR_BASE_URL = "https://api.spoonacular.com";
const SPOONACULAR_TIMEOUT_MS = 8_000;
// Products to detail-fetch per search. Bounds the free-tier point cost — one
// search (1 pt) + N product-info calls (1 pt each) ≈ N+1 points per query.
const SPOONACULAR_MAX_PRODUCTS = 5;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Authenticated GET against the Spoonacular API. Returns the parsed body, or
 * null for an unknown resource (HTTP 404) AND for any non-retryable failure
 * (missing/invalid key → 401, exhausted daily quota → 402, etc.) — both degrade
 * to "no result" so the caller falls back to USDA/OFF. Transient 429/5xx/network
 * errors are retried. Never throws. The URL (which carries the key) is never
 * logged.
 */
async function spoonacularGet<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T | null> {
  const apiKey = env.SPOONACULAR_API_KEY;
  if (!apiKey) return null;
  const query = new URLSearchParams({ ...params, apiKey });
  const url = `${SPOONACULAR_BASE_URL}${path}?${query.toString()}`;

  try {
    return await retryWithJitter<T | null>(
      async () => {
        const timeout = AbortSignal.timeout(SPOONACULAR_TIMEOUT_MS);
        const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal: sig });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
        }
        if (res.status === 404) return null; // unknown product / barcode — a normal "no result"
        // 401 (bad key) / 402 (daily quota spent) / other 4xx — non-retryable; the
        // catch below degrades. A plain Error is intentional so retryWithJitter
        // doesn't retry it.
        if (!res.ok) throw new Error(`Spoonacular request failed with HTTP ${res.status}`);
        return (await res.json()) as T;
      },
      { retries: 2, label: "spoonacular" },
    );
  } catch (err) {
    logger.warn({ err, path }, "[nutrition] Spoonacular request failed; degrading to USDA/OFF");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response shapes + per-serving → per-100g mapping
// ---------------------------------------------------------------------------

interface SpoonacularNutrient {
  // Spoonacular labels nutrients `name` in recipe/menu responses but `title` in
  // some food-product responses — read whichever is present.
  name?: string;
  title?: string;
  amount?: number | string;
  unit?: string;
}

interface SpoonacularProduct {
  id?: number | string;
  title?: string;
  brand?: string;
  upc?: string;
  // The label serving. `size`+`unit` give the per-serving weight when in grams;
  // `raw` is Spoonacular's own serving description, e.g. "1 bar (68g)".
  servings?: { number?: number; size?: number | string; unit?: string; raw?: string };
  nutrition?: {
    nutrients?: SpoonacularNutrient[];
    // Preferred per-serving weight, e.g. { amount: 31, unit: "g" }.
    weightPerServing?: { amount?: number | string; unit?: string };
  };
}

interface SpoonacularSearchResponse {
  products?: { id?: number | string; title?: string }[];
}

/** Normalize a unit for comparison: lower-case and fold the microgram spellings
 *  (µg / ug) to "mcg" so they match MICRO_DEFS[].unit. */
function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace("µg", "mcg").replace(/\bug\b/, "mcg");
}

/** Convert a weight quantity to grams; null for volume/serving units we can't
 *  convert (matching the USDA/OFF/FatSecret weight-only behavior). */
function weightToGrams(amount: number | string | undefined, unit: string | undefined): number | null {
  const n = num(amount);
  if (n === null || n <= 0 || !unit) return null;
  switch (unit.trim().toLowerCase()) {
    case "g":
    case "gram":
    case "grams":
      return n;
    case "oz":
      return n * OZ_TO_GRAMS;
    default:
      return null;
  }
}

/** Parse an explicit gram/oz weight out of Spoonacular's own serving text
 *  (`servings.raw`), e.g. "1 bar (68g)" or "2.4 oz". Trustworthy because it's the
 *  source's stated serving, so a wide [1, 1000]g sanity range is fine. */
function parseGramsFromServingText(raw: string | undefined): number | null {
  if (!raw) return null;
  // Prefer a parenthetical gram weight: "1 bar (68 g)".
  const paren = /\(\s*([\d.]+)\s*g\s*\)/i.exec(raw);
  if (paren) {
    const grams = num(paren[1]);
    if (grams !== null && grams > 0 && grams <= 1000) return grams;
  }
  // Bounded quantifiers ({1,6}/{1,3}) keep this linear — an unbounded
  // (\d+(?:\.\d+)?) trips Sonar's super-linear-backtracking (ReDoS) rule — while
  // still covering any real serving weight.
  const match = /(\d{1,6}(?:\.\d{1,3})?)\s*(g|oz)\b/i.exec(raw);
  if (match) {
    const grams = weightToGrams(match[1], match[2]);
    if (grams !== null && grams > 0 && grams <= 1000) return grams;
  }
  return null;
}

/** Last-resort: infer a serving weight from a net-weight token in the product
 *  TITLE, e.g. "... 2.4 oz". Deliberately narrow to bound the guesswork:
 *   - only "oz" (US net-weight unit) — a "g" in a title is usually a macro figure
 *     ("9g Protein"), not the net weight;
 *   - only a plausible single-serving weight (5–250 g), so a container size
 *     ("16 oz jar") is rejected;
 *   - caller only applies it when nutrition is stated per single serving.
 *  The per-100g sanity clamp in sanitizeMappedFood is the final backstop. */
function parseServingGramsFromTitle(title: string | undefined): number | null {
  if (!title) return null;
  // Bounded quantifiers keep this linear (ReDoS-safe); see parseGramsFromServingText.
  const match = /(\d{1,6}(?:\.\d{1,3})?)\s*oz\b/i.exec(title);
  const grams = match ? weightToGrams(match[1], "oz") : null;
  return grams !== null && grams >= 5 && grams <= 250 ? grams : null;
}

/** The per-serving weight in grams, best-effort. Prefer structured fields
 *  (`weightPerServing`, then `servings.size`); fall back to Spoonacular's serving
 *  text; and only when nutrition is per single serving, infer a net weight from
 *  the title. null when no weight can be established (the food is then dropped). */
function servingGrams(product: SpoonacularProduct): number | null {
  const wps = product.nutrition?.weightPerServing;
  const fromWeightPerServing = weightToGrams(wps?.amount, wps?.unit);
  if (fromWeightPerServing !== null) return fromWeightPerServing;

  const fromSize = weightToGrams(product.servings?.size, product.servings?.unit);
  if (fromSize !== null) return fromSize;

  const fromRaw = parseGramsFromServingText(product.servings?.raw);
  if (fromRaw !== null) return fromRaw;

  const servingCount = product.servings?.number;
  if (servingCount === undefined || servingCount === 1) {
    return parseServingGramsFromTitle(product.title);
  }
  return null;
}

/** Read a nutrient by exact (case-insensitive) name. When `expectedUnit` is
 *  given, the value is returned ONLY if the nutrient's unit matches it — this is
 *  how the micro reader skips IU-encoded vitamins instead of misconverting them,
 *  and how macros avoid matching a same-named-but-wrong-unit entry. */
function readNutrient(
  nutrients: SpoonacularNutrient[],
  name: string,
  expectedUnit?: string,
): number | null {
  const target = name.trim().toLowerCase();
  for (const n of nutrients) {
    if ((n.name ?? n.title ?? "").trim().toLowerCase() !== target) continue;
    const amount = num(n.amount);
    if (amount === null) continue;
    if (expectedUnit && normalizeUnit(n.unit) !== expectedUnit) continue;
    return amount;
  }
  return null;
}

/** Per-100g micros from the per-serving nutrients. Only MICRO_DEFS entries with a
 *  `spoonacularName` are read, and each is accepted only when its reported unit
 *  matches the micro's `unit` (mg/mcg) — so IU-reported vitamins are skipped. */
function extractMicros(nutrients: SpoonacularNutrient[], grams: number): Record<string, number> | null {
  const micros: Record<string, number> = {};
  for (const def of MICRO_DEFS) {
    if (!def.spoonacularName) continue;
    const perServing = readNutrient(nutrients, def.spoonacularName, def.unit);
    if (perServing !== null && perServing >= 0) micros[def.key] = (perServing * 100) / grams;
  }
  return Object.keys(micros).length > 0 ? micros : null;
}

/** Map one Spoonacular product into our per-100g shape, or null when unusable
 *  (no id/name, or no gram-convertible serving weight). */
export function mapSpoonacularProduct(product: SpoonacularProduct): MappedFood | null {
  const id = product.id;
  const name = product.title?.trim();
  if ((typeof id !== "number" && typeof id !== "string") || !name) return null;

  const grams = servingGrams(product);
  if (grams === null || grams <= 0) return null;

  const nutrients = Array.isArray(product.nutrition?.nutrients) ? product.nutrition.nutrients : [];
  const per100 = (nutrientName: string, unit?: string): number | null => {
    const value = readNutrient(nutrients, nutrientName, unit);
    return value === null ? null : (value * 100) / grams;
  };

  const caloriesPer100g = per100("Calories", "kcal");
  const proteinPer100g = per100("Protein", "g");
  const carbPer100g = per100("Carbohydrates", "g");
  // Exact-name match so "Fat" is never confused with "Saturated Fat"/"Trans Fat".
  const fatPer100g = per100("Fat", "g");
  const fiberPer100g = per100("Fiber", "g");

  // Spoonacular returns some low-quality grocery listings with a full nutrient
  // array whose amounts are all zero (a placeholder record). With a recovered
  // serving weight those would otherwise cache as a useless 0-calorie food, so
  // drop a product that carries no positive macro at all (the sanitize guard
  // only drops all-NULL, not all-ZERO).
  const hasUsableNutrition = [caloriesPer100g, proteinPer100g, carbPer100g, fatPer100g].some(
    (value) => value !== null && value > 0,
  );
  if (!hasUsableNutrition) return null;

  return {
    source: "spoonacular",
    sourceId: String(id),
    name,
    brand: product.brand?.trim() || null,
    servingSizeG: grams,
    caloriesPer100g,
    proteinPer100g,
    carbPer100g,
    fatPer100g,
    fiberPer100g,
    micros: extractMicros(nutrients, grams),
  };
}

// ---------------------------------------------------------------------------
// Exported operations
// ---------------------------------------------------------------------------

export interface SpoonacularSearchResult {
  foods: MappedFood[];
  /** false when Spoonacular is unconfigured or its API couldn't be reached (no
   *  key, exhausted quota, an error) — i.e. these are NOT live results, so the
   *  orchestrator treats search as degraded unless another provider was live. A
   *  genuine zero-match counts as reached. */
  reached: boolean;
}

/** Fetch + map a single product by its Spoonacular id. Shared by search, barcode
 *  resolution, and the cache-staleness refresh. */
export async function getSpoonacularFoodById(
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  const product = await spoonacularGet<SpoonacularProduct>(
    `/food/products/${encodeURIComponent(id)}`,
    {},
    opts.signal,
  );
  if (!product) return null;
  const mapped = mapSpoonacularProduct(product);
  if (!mapped) {
    // Diagnostic: a dropped product is usually missing a gram-convertible serving
    // OR has placeholder nutrition (all-zero amounts). Surface the serving fields
    // AND a raw sample of the energy/macro nutrients so the logs show, beyond
    // doubt, whether the source data itself is empty vs. a mapping problem.
    const nutrients = product.nutrition?.nutrients ?? [];
    logger.info(
      {
        id,
        title: product.title,
        weightPerServing: product.nutrition?.weightPerServing,
        servings: product.servings,
        nutrientCount: nutrients.length,
        // Raw nutrient objects exactly as returned, so the logs show the real
        // field names (name vs. title) and amounts beyond any doubt.
        sample: nutrients.slice(0, 4),
      },
      "[nutrition] Spoonacular product dropped (no gram-convertible serving or unusable)",
    );
  }
  return mapped;
}

/**
 * Search Spoonacular for branded/packaged foods. The search endpoint returns
 * only ids, so we detail-fetch the top SPOONACULAR_MAX_PRODUCTS concurrently to
 * get nutrition. Never throws — on any unavailability it reports `reached: false`
 * and the orchestrator falls back to USDA + cache.
 */
export async function searchSpoonacularFoods(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SpoonacularSearchResult> {
  if (!env.SPOONACULAR_API_KEY) {
    logger.info("[nutrition] Spoonacular search skipped — SPOONACULAR_API_KEY not set");
    return { foods: [], reached: false };
  }

  const search = await spoonacularGet<SpoonacularSearchResponse>(
    "/food/products/search",
    { query, number: String(SPOONACULAR_MAX_PRODUCTS) },
    opts.signal,
  );
  if (!search) return { foods: [], reached: false }; // unavailable / quota spent

  const searchHits = search.products?.length ?? 0;
  const ids = (search.products ?? [])
    .map((p) => p.id)
    .filter((id): id is number | string => typeof id === "number" || typeof id === "string")
    .map(String)
    .slice(0, SPOONACULAR_MAX_PRODUCTS);
  if (ids.length === 0) {
    logger.info({ query, searchHits }, "[nutrition] Spoonacular search: reached, no products");
    return { foods: [], reached: true };
  }

  const settled = await Promise.allSettled(ids.map((id) => getSpoonacularFoodById(id, opts)));
  const foods: MappedFood[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) foods.push(result.value);
  }
  // Diagnostic: how many the search returned vs. how many we detail-fetched and
  // successfully mapped. A high detailFetched with low mapped = products are being
  // dropped (see the per-product drop log above for the reason).
  logger.info(
    { query, searchHits, detailFetched: ids.length, mapped: foods.length },
    "[nutrition] Spoonacular search diagnostics",
  );
  return { foods, reached: true };
}

/**
 * Resolve a barcode to a food via Spoonacular's UPC lookup. Returns the mapped
 * food in one call (the UPC endpoint carries full nutrition), or null when
 * Spoonacular is unconfigured/unavailable or the barcode is unknown — so the
 * caller falls back to Open Food Facts.
 */
export async function resolveSpoonacularBarcode(
  code: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  if (!env.SPOONACULAR_API_KEY) return null;
  const product = await spoonacularGet<SpoonacularProduct>(
    `/food/products/upc/${encodeURIComponent(code)}`,
    {},
    opts.signal,
  );
  if (!product) return null;
  return mapSpoonacularProduct(product);
}
