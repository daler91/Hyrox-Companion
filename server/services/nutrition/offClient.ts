import { env } from "../../env";
import { parseRetryAfter, RetryableHttpError, retryWithJitter } from "../../utils/httpRetry";
import { MICRO_DEFS, OFF_GRAMS_TO_UNIT } from "./micros";
import type { MappedFood } from "./types";
import { num } from "./utils";

/**
 * Open Food Facts client (FR-1.1 + FR-2.1). Two operations, both mapping OFF's
 * response into a food whose macros are normalized to a PER-100-GRAM basis, ready
 * to cache in `foods` (source='off'): `resolveBarcode` (a single product by code)
 * and `searchOffFoods` (free-text search, supplementing USDA/Edamam). Like the
 * USDA client, this is the one place OFF's response shape is interpreted.
 *
 * OFF requires a descriptive User-Agent for reads and rate-limits ~15 req/min/IP
 * (and its search endpoint far more tightly), so callers must hit the local cache
 * first and cache every resolve.
 */

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_FIELDS =
  "code,product_name,brands,nutriments,serving_quantity,serving_size,completeness,status,status_verbose";
// Search returns the same product shape, keyed by `code` (the barcode) which
// becomes the cached food's sourceId; status fields are product-lookup only.
const OFF_SEARCH_FIELDS =
  "code,product_name,brands,nutriments,serving_quantity,serving_size,completeness";
// OFF's text-search endpoint is rate-limited far more tightly than product
// lookups (~10 req/min/IP), so keep the page small and cache every hit.
const OFF_SEARCH_PAGE_SIZE = 20;
const OFF_TIMEOUT_MS = 8_000;
// Floor for OFF's crowd-sourced data-quality score (0–1). Below this AND with no
// energy value, a product is too sparse to trust (see isAcceptableOffProduct).
const OFF_MIN_COMPLETENESS = 0.5;

// First custom User-Agent in the codebase (OFF policy: AppName/Version (contact)).
const OFF_USER_AGENT = `HyroxCompanion/1.0 (${env.APP_URL ?? "https://fitai.coach"})`;

interface OffNutriments {
  "energy-kcal_100g"?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  fibre_100g?: number;
}

interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_quantity?: number | string;
  serving_size?: string;
  // OFF data-quality score in [0,1]; gates the lowest-quality entries.
  completeness?: number | string;
  nutriments?: OffNutriments;
}

interface OffResponse {
  status?: number;
  product?: OffProduct;
}

/** Grams from `serving_quantity` (number) or the leading number of a "30 g" `serving_size`. */
function parseServingGrams(product: OffProduct): number | null {
  const quantity = num(product.serving_quantity);
  if (quantity !== null && quantity > 0) return quantity;
  const match = /^([\d.]+)\s*g\b/i.exec(product.serving_size ?? "");
  if (match) {
    const grams = Number(match[1]);
    if (Number.isFinite(grams) && grams > 0) return grams;
  }
  return null;
}

/**
 * Per-100g micros (FR-5.1). OFF reports `*_100g` nutriments in GRAMS, so each is
 * converted to the micro's unit (×1000 → mg, ×1e6 → mcg). Micros absent from the
 * product are omitted (not zeroed).
 */
function extractMicros(nutriments: OffNutriments): Record<string, number> | null {
  const source = nutriments as Record<string, unknown>;
  const micros: Record<string, number> = {};
  for (const def of MICRO_DEFS) {
    const grams = num(source[`${def.offKey}_100g`]);
    if (grams !== null && grams >= 0) micros[def.key] = grams * OFF_GRAMS_TO_UNIT[def.unit];
  }
  return Object.keys(micros).length > 0 ? micros : null;
}

/**
 * Reject the lowest-quality crowd-sourced OFF entries before caching. A product
 * missing its core energy value AND explicitly flagged low-completeness is too
 * unreliable to log from — better to 404 the scan (the user can add a custom
 * food) than cache a misleading row. Anything with calories, or an unknown /
 * decent completeness, passes; the per-field sanitize guard still clamps bad
 * numbers afterwards.
 */
function isAcceptableOffProduct(product: OffProduct): boolean {
  if (num(product.nutriments?.["energy-kcal_100g"]) !== null) return true;
  const completeness = num(product.completeness);
  return completeness === null || completeness >= OFF_MIN_COMPLETENESS;
}

export function mapOffProduct(code: string, product: OffProduct): MappedFood | null {
  const name = product.product_name?.trim();
  if (!name) return null;
  if (!isAcceptableOffProduct(product)) return null;
  const n = product.nutriments ?? {};
  const mapped: MappedFood = {
    source: "off",
    sourceId: code,
    name,
    brand: product.brands?.split(",")[0]?.trim() || null,
    servingSizeG: parseServingGrams(product),
    caloriesPer100g: num(n["energy-kcal_100g"]),
    proteinPer100g: num(n.proteins_100g),
    carbPer100g: num(n.carbohydrates_100g),
    fatPer100g: num(n.fat_100g),
    fiberPer100g: num(n.fiber_100g ?? n.fibre_100g),
    micros: extractMicros(n),
  };
  return mapped;
}

/**
 * Resolve a barcode via Open Food Facts. Returns null when the product is not
 * found — OFF returns **HTTP 200 with `status: 0`** for unknown codes — or on any
 * non-retryable failure (the route turns null into a 404). Retries transient
 * 429/5xx/network errors so a provider hiccup doesn't surface as a hard failure.
 */
export async function resolveBarcode(
  code: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  const url = `${OFF_PRODUCT_URL}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;

  const raw = await retryWithJitter(
    async (): Promise<OffResponse | null> => {
      const timeout = AbortSignal.timeout(OFF_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetch(url, {
        headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
        signal,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
      }
      if (res.status === 404) return null; // some OFF deployments hard-404 unknown codes
      if (!res.ok) throw new Error(`OFF lookup failed with HTTP ${res.status}`);
      return (await res.json()) as OffResponse;
    },
    { retries: 2, label: "off" },
  );

  if (!raw || raw.status === 0 || !raw.product) return null;
  return mapOffProduct(code, raw.product);
}

interface OffSearchResponse {
  products?: (OffProduct & { code?: string })[];
}

/**
 * Free-text search Open Food Facts (FR-1.1), supplementing USDA/Edamam in the
 * search orchestrator. Returns every per-100g-mappable product UNGATED — the
 * orchestrator applies the shared relevance gate to all providers uniformly, and
 * its fallback relies on receiving the ungated hits, so filtering here would both
 * double-gate OFF and blank an OFF-only deployment whenever the gate is over-strict.
 *
 * Never throws: any failure (network, or OFF's tight search rate limit → 429 after
 * a retry) degrades to `{ foods: [], reached: false }`, so search falls back to the
 * other providers + cache. `reached` is true whenever the API answered (even with
 * zero matches), so the orchestrator can treat OFF as a live source for the
 * degraded flag. The URL carries no secrets (OFF search needs no key).
 */
export async function searchOffFoods(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ foods: MappedFood[]; reached: boolean }> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(OFF_SEARCH_PAGE_SIZE),
    fields: OFF_SEARCH_FIELDS,
  });
  const url = `${OFF_SEARCH_URL}?${params.toString()}`;

  try {
    const raw = await retryWithJitter(
      async (): Promise<OffSearchResponse> => {
        const timeout = AbortSignal.timeout(OFF_TIMEOUT_MS);
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
        const res = await fetch(url, {
          headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
          signal,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
        }
        if (!res.ok) throw new Error(`OFF search failed with HTTP ${res.status}`);
        return (await res.json()) as OffSearchResponse;
      },
      // Only one retry — the search endpoint's tight rate limit means hammering a
      // transient failure just burns the budget; a miss degrades cleanly.
      { retries: 1, label: "off-search" },
    );

    const products = Array.isArray(raw.products) ? raw.products : [];
    const foods: MappedFood[] = [];
    for (const product of products) {
      const code = product.code?.trim();
      if (!code) continue;
      const mapped = mapOffProduct(code, product);
      if (mapped) foods.push(mapped);
    }
    return { foods, reached: true };
  } catch {
    // Any failure (network, or OFF's tight search rate limit → 429 after a retry)
    // degrades to no results; the orchestrator's "result mix" log records OFF as
    // not reached (offLive:false), so the miss is still observable.
    return { foods: [], reached: false };
  }
}
