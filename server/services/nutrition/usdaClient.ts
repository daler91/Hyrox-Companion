import { env } from "../../env";
import { parseRetryAfter, RetryableHttpError, retryWithJitter } from "../../utils/httpRetry";

/**
 * USDA FoodData Central client. Turns a search term into a list of foods whose
 * macros are normalized to a PER-100-GRAM basis, ready to cache in the `foods`
 * table. This is the single place USDA's response shape and nutrient numbering
 * is interpreted — keep all of that here so a mis-scaling bug has one home.
 *
 * The AI architecture rule (BRD §7) does not apply here — these are real,
 * lab-verified numbers from USDA, not generated values.
 */

const FDC_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const USDA_TIMEOUT_MS = 8_000;
const USDA_PAGE_SIZE = 25;

// USDA nutrient numbers (strings in the API). Energy has several encodings:
// 1008 is the classic kcal; 2047/2048 are Atwater kcal on Foundation foods.
// 1062 (kJ) is deliberately absent so kilojoules are never read as calories.
const ENERGY_KCAL_NUMBERS = ["1008", "2047", "2048"];
const PROTEIN_NUMBER = "1003";
const CARB_NUMBER = "1005";
const FAT_NUMBER = "1004";
const FIBER_NUMBER = "1079";

export interface UsdaFoodMapped {
  source: "usda";
  sourceId: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
}

interface UsdaNutrient {
  nutrientNumber?: string | number;
  unitName?: string;
  value?: number;
}

interface UsdaLabelNutrient {
  value?: number;
}

interface UsdaSearchFood {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
  labelNutrients?: {
    calories?: UsdaLabelNutrient;
    protein?: UsdaLabelNutrient;
    carbohydrates?: UsdaLabelNutrient;
    fat?: UsdaLabelNutrient;
    fiber?: UsdaLabelNutrient;
  };
}

interface UsdaSearchResponse {
  foods?: UsdaSearchFood[];
}

/** Find the first nutrient matching one of `numbers`, optionally unit-filtered. */
function findNutrient(
  nutrients: UsdaNutrient[],
  numbers: string[],
  opts: { unit?: string } = {},
): number | null {
  for (const num of numbers) {
    const match = nutrients.find(
      (n) =>
        String(n.nutrientNumber) === num &&
        typeof n.value === "number" &&
        (!opts.unit || (n.unitName ?? "").toLowerCase() === opts.unit),
    );
    if (match && typeof match.value === "number") return match.value;
  }
  return null;
}

/** Convert a USDA serving size to grams. Volume units (ml/l) are skipped in Phase 1. */
function servingToGrams(size?: number, unit?: string): number | null {
  if (typeof size !== "number" || !unit) return null;
  switch (unit.toLowerCase()) {
    case "g":
    case "gram":
    case "grams":
      return size;
    case "mg":
      return size / 1000;
    case "kg":
      return size * 1000;
    case "oz":
      return size * 28.349523125;
    case "lb":
      return size * 453.59237;
    default:
      return null;
  }
}

/**
 * Branded foods occasionally omit per-100g `foodNutrients` but carry
 * `labelNutrients` (per serving). When that happens and we know the serving in
 * grams, derive per-100g = labelValue / servingG * 100. Per-field, so it only
 * fills gaps the per-100g path left null.
 */
function withLabelFallback(mapped: UsdaFoodMapped, raw: UsdaSearchFood): UsdaFoodMapped {
  const label = raw.labelNutrients;
  const serving = mapped.servingSizeG;
  if (!label || !serving || serving <= 0) return mapped;
  const per100 = (n?: UsdaLabelNutrient): number | null =>
    typeof n?.value === "number" ? (n.value / serving) * 100 : null;
  return {
    ...mapped,
    caloriesPer100g: mapped.caloriesPer100g ?? per100(label.calories),
    proteinPer100g: mapped.proteinPer100g ?? per100(label.protein),
    carbPer100g: mapped.carbPer100g ?? per100(label.carbohydrates),
    fatPer100g: mapped.fatPer100g ?? per100(label.fat),
    fiberPer100g: mapped.fiberPer100g ?? per100(label.fiber),
  };
}

/** Map one USDA search result into our per-100g shape, or null if unusable. */
export function mapUsdaSearchFood(raw: UsdaSearchFood): UsdaFoodMapped | null {
  if (typeof raw.fdcId !== "number" || typeof raw.description !== "string") return null;
  const nutrients = Array.isArray(raw.foodNutrients) ? raw.foodNutrients : [];
  const mapped: UsdaFoodMapped = {
    source: "usda",
    sourceId: String(raw.fdcId),
    name: raw.description,
    brand: raw.brandOwner ?? raw.brandName ?? null,
    servingSizeG: servingToGrams(raw.servingSize, raw.servingSizeUnit),
    caloriesPer100g: findNutrient(nutrients, ENERGY_KCAL_NUMBERS, { unit: "kcal" }),
    proteinPer100g: findNutrient(nutrients, [PROTEIN_NUMBER]),
    carbPer100g: findNutrient(nutrients, [CARB_NUMBER]),
    fatPer100g: findNutrient(nutrients, [FAT_NUMBER]),
    fiberPer100g: findNutrient(nutrients, [FIBER_NUMBER]),
  };
  return withLabelFallback(mapped, raw);
}

/**
 * Search USDA FoodData Central. Returns [] (no network call) when no API key is
 * configured, so the caller degrades to locally-cached foods (NFR-5). Retries
 * transient 429/5xx/network errors; a non-transient failure propagates so the
 * orchestrator can flag `apiDegraded`.
 */
export async function searchUsdaFoods(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<UsdaFoodMapped[]> {
  const apiKey = env.USDA_API_KEY;
  if (!apiKey) return [];

  const url = `${FDC_SEARCH_URL}?api_key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    query,
    dataType: ["Foundation", "SR Legacy", "Branded"],
    pageSize: USDA_PAGE_SIZE,
  });

  const raw = await retryWithJitter(
    async () => {
      // Fresh timeout per attempt; combine with any caller-supplied signal.
      const timeout = AbortSignal.timeout(USDA_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
      }
      if (!res.ok) {
        throw new Error(`USDA search failed with HTTP ${res.status}`);
      }
      return (await res.json()) as UsdaSearchResponse;
    },
    { retries: 2, label: "usda" },
  );

  const foods = Array.isArray(raw.foods) ? raw.foods : [];
  return foods
    .map(mapUsdaSearchFood)
    .filter((f): f is UsdaFoodMapped => f !== null);
}
