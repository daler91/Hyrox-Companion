/**
 * Shape of a food mapped from an external source (USDA or Open Food Facts) into
 * our per-100g `foods` columns, ready for `NutritionStorage.upsertFoods`. Custom
 * foods don't go through this — they're user-entered directly.
 */
export interface MappedFood {
  source: "usda" | "off";
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
