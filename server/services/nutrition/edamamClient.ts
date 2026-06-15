import { env } from "../../env";
import { logger } from "../../logger";
import { parseRetryAfter, RetryableHttpError, retryWithJitter } from "../../utils/httpRetry";
import type { MappedFood } from "./types";
import { num } from "./utils";

/**
 * Edamam Food Database client. A curated source of branded/packaged + generic
 * foods and UPC barcodes. Its key advantage over the per-serving providers
 * (FatSecret/Spoonacular): the parser returns each food's macros ALREADY ON A
 * PER-100-GRAM basis, so there is no serving-weight to recover — it maps straight
 * into our `foods` columns.
 *
 * Auth is an app id + app key passed as query params. Like the other clients,
 * every failure mode (no credentials, a bad key/plan, a provider hiccup, an
 * unknown food/barcode) degrades to an empty result rather than throwing, so
 * search/barcode always fall back cleanly to USDA/Open Food Facts.
 *
 * The AI architecture rule (BRD §7) does not apply — these are real, sourced
 * numbers from Edamam, not generated values.
 */

const EDAMAM_PARSER_URL = "https://api.edamam.com/api/food-database/v2/parser";
const EDAMAM_TIMEOUT_MS = 8_000;
const EDAMAM_MAX_RESULTS = 25;

/** Both credentials present ⇒ Edamam enabled; otherwise it's simply off. */
function credentials(): { appId: string; appKey: string } | null {
  const appId = env.EDAMAM_APP_ID;
  const appKey = env.EDAMAM_APP_KEY;
  if (!appId || !appKey) return null;
  return { appId, appKey };
}

// ---------------------------------------------------------------------------
// Response shapes + per-100g mapping
// ---------------------------------------------------------------------------

interface EdamamNutrients {
  // All already per 100g. ENERC_KCAL=energy, PROCNT=protein, FAT, CHOCDF=carbs,
  // FIBTG=fiber.
  ENERC_KCAL?: number;
  PROCNT?: number;
  FAT?: number;
  CHOCDF?: number;
  FIBTG?: number;
}

interface EdamamFood {
  foodId?: string;
  label?: string;
  knownAs?: string;
  brand?: string;
  nutrients?: EdamamNutrients;
}

interface EdamamMeasure {
  label?: string;
  weight?: number; // grams
}

interface EdamamHint {
  food?: EdamamFood;
  measures?: EdamamMeasure[];
}

interface EdamamParserResponse {
  hints?: EdamamHint[];
}

/** The labelled "Serving" measure's gram weight, surfaced as the default serving
 *  (FR-1). null when Edamam lists no gram-based serving. */
function servingGrams(measures: EdamamMeasure[]): number | null {
  const serving = measures.find((m) => (m.label ?? "").trim().toLowerCase() === "serving");
  const grams = num(serving?.weight);
  return grams !== null && grams > 0 ? grams : null;
}

/** Map one Edamam hint into our per-100g shape, or null when unusable. Edamam's
 *  `nutrients` are already per 100g, so no scaling is needed; a food with no
 *  positive macro at all is dropped rather than cached as a 0-calorie shell. */
export function mapEdamamFood(hint: EdamamHint): MappedFood | null {
  const food = hint.food;
  const foodId = food?.foodId;
  const name = (food?.label ?? food?.knownAs)?.trim();
  if (!foodId || !name) return null;

  const nutrients = food?.nutrients ?? {};
  const caloriesPer100g = num(nutrients.ENERC_KCAL);
  const proteinPer100g = num(nutrients.PROCNT);
  const carbPer100g = num(nutrients.CHOCDF);
  const fatPer100g = num(nutrients.FAT);
  const fiberPer100g = num(nutrients.FIBTG);

  const hasUsableNutrition = [caloriesPer100g, proteinPer100g, carbPer100g, fatPer100g].some(
    (value) => value !== null && value > 0,
  );
  if (!hasUsableNutrition) return null;

  return {
    source: "edamam",
    sourceId: foodId,
    name,
    brand: food?.brand?.trim() || null,
    servingSizeG: servingGrams(Array.isArray(hint.measures) ? hint.measures : []),
    caloriesPer100g,
    proteinPer100g,
    carbPer100g,
    fatPer100g,
    fiberPer100g,
    // The parser's hints carry only the 5 macros; micros are left null.
    micros: null,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * GET the Edamam parser with the given params. Returns the parsed body, or null
 * for any non-retryable failure (no credentials, a bad key/plan → 401/403, an
 * unknown resource → 404) — all of which degrade to "no result" so the caller
 * falls back to USDA/OFF. Transient 429/5xx/network errors are retried. Never
 * throws. The URL (which carries the key) is never logged.
 */
async function edamamGet(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<EdamamParserResponse | null> {
  const creds = credentials();
  if (!creds) return null;
  const query = new URLSearchParams({ app_id: creds.appId, app_key: creds.appKey, ...params });
  const url = `${EDAMAM_PARSER_URL}?${query.toString()}`;

  try {
    return await retryWithJitter<EdamamParserResponse | null>(
      async () => {
        const timeout = AbortSignal.timeout(EDAMAM_TIMEOUT_MS);
        const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal: sig });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
        }
        if (res.status === 404) return null; // unknown food / barcode — a normal "no result"
        // 401 (bad key) / 403 (plan) / other 4xx — non-retryable; the catch degrades.
        if (!res.ok) throw new Error(`Edamam request failed with HTTP ${res.status}`);
        return (await res.json()) as EdamamParserResponse;
      },
      { retries: 2, label: "edamam" },
    );
  } catch (err) {
    logger.warn({ err }, "[nutrition] Edamam request failed; degrading to USDA/OFF");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported operations
// ---------------------------------------------------------------------------

export interface EdamamSearchResult {
  foods: MappedFood[];
  /** false when Edamam is unconfigured or its API couldn't be reached (no
   *  credentials, a bad key/plan, an error) — these are NOT live results, so the
   *  orchestrator treats search as degraded unless another provider was live. A
   *  genuine zero-match counts as reached. */
  reached: boolean;
}

/** Search Edamam for branded + generic foods. One call returns every hit with
 *  per-100g nutrition inline (no N+1 detail fetch). Never throws — on any
 *  unavailability it reports `reached: false` and the orchestrator falls back to
 *  USDA + cache. */
export async function searchEdamamFoods(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EdamamSearchResult> {
  if (!credentials()) {
    logger.info("[nutrition] Edamam search skipped — EDAMAM_APP_ID/EDAMAM_APP_KEY not set");
    return { foods: [], reached: false };
  }

  const body = await edamamGet({ ingr: query }, opts.signal);
  if (!body) return { foods: [], reached: false }; // unavailable / bad key

  const hints = Array.isArray(body.hints) ? body.hints.slice(0, EDAMAM_MAX_RESULTS) : [];
  const foods: MappedFood[] = [];
  for (const hint of hints) {
    const mapped = mapEdamamFood(hint);
    if (mapped) foods.push(mapped);
  }
  // Diagnostic: how many hits Edamam returned vs. how many mapped (a gap means
  // foods were dropped for missing/zero macros).
  logger.info(
    { query, hintCount: hints.length, mapped: foods.length },
    "[nutrition] Edamam search diagnostics",
  );
  return { foods, reached: true };
}

/** Re-fetch a cached Edamam food for the staleness refresh. Edamam has no
 *  get-by-id endpoint, so re-search by the food's name and match its foodId. */
export async function getEdamamFoodById(
  foodId: string,
  name: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  if (!credentials()) return null;
  const body = await edamamGet({ ingr: name }, opts.signal);
  if (!body) return null;
  const hint = (Array.isArray(body.hints) ? body.hints : []).find((h) => h.food?.foodId === foodId);
  return hint ? mapEdamamFood(hint) : null;
}

/** Resolve a barcode to a food via Edamam's UPC lookup. Returns the mapped food,
 *  or null when Edamam is unconfigured/unavailable or the barcode is unknown — so
 *  the caller falls back to Open Food Facts. */
export async function resolveEdamamBarcode(
  code: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  if (!credentials()) return null;
  const body = await edamamGet({ upc: code }, opts.signal);
  if (!body) return null;
  const hint = (Array.isArray(body.hints) ? body.hints : [])[0];
  if (!hint) return null;
  return mapEdamamFood(hint);
}
