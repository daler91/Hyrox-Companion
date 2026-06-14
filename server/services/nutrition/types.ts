/**
 * Shape of a food mapped from an external source (USDA, Open Food Facts,
 * FatSecret, Spoonacular, or Edamam) into our per-100g `foods` columns, ready for
 * `NutritionStorage.upsertFoods`, which runs every record through
 * `sanitizeMappedFood` (./sanitize) so a corrupt upstream value can never reach
 * the cache. Custom foods don't go through this — they're user-entered directly.
 */
export interface MappedFood {
  source: "usda" | "off" | "fatsecret" | "spoonacular" | "edamam";
  sourceId: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  // Per-100g micronutrient map (FR-5.1); null when the source carries none.
  micros: Record<string, number> | null;
}
