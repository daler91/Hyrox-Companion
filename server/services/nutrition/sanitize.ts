import { CALORIES_PER_100G_MAX, MACRO_PER_100G_MAX, SERVING_SIZE_G_MAX } from "@shared/schema";

import type { MappedFood } from "./types";

/**
 * Import sanity guard, shared by every external-food mapper (USDA, Open Food
 * Facts, FatSecret). External sources occasionally carry NaN / negative / absurd
 * macros — a mis-scaled serving, a bad crowd-sourced edit, a label typo. Because
 * a cached `foods` row is reused for every future log of that food, a single
 * poisoned import would silently corrupt every downstream daily total. This is
 * the one boundary where those values are caught before they reach the cache.
 *
 * Policy: clamp, don't truncate. A field that is non-finite, negative, or beyond
 * a sane per-100g ceiling is set to `null` — treated as "absent", which
 * `scaleNutrition` already counts as 0, so it can never inflate a total. We
 * never rewrite a clearly-corrupt number into a plausible-looking one. The whole
 * food is dropped only when fundamentally unusable: no name, or no usable macro
 * at all (nothing to log). The ceilings are shared with custom-food validation
 * (CALORIES_PER_100G_MAX / MACRO_PER_100G_MAX) so every food obeys one rulebook.
 */

/** A finite, non-negative per-100g macro within `max`; else null. */
export function clampMacro(value: number | null | undefined, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

/** A finite, positive serving size within the sane gram ceiling; else null. */
function clampServingSizeG(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > SERVING_SIZE_G_MAX) return null;
  return value;
}

/** Drop non-finite / negative micro entries; null when nothing usable remains. */
function clampMicros(
  micros: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!micros) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(micros)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Clamp every numeric field of a mapped food, returning a cleaned copy — or null
 * when the food is unusable. Generic so each mapper keeps its own narrow source
 * literal (e.g. UsdaFoodMapped) in the return type.
 */
export function sanitizeMappedFood<T extends MappedFood>(food: T): T | null {
  const name = typeof food.name === "string" ? food.name.trim() : "";
  if (!name) return null;

  const caloriesPer100g = clampMacro(food.caloriesPer100g, CALORIES_PER_100G_MAX);
  const proteinPer100g = clampMacro(food.proteinPer100g, MACRO_PER_100G_MAX);
  const carbPer100g = clampMacro(food.carbPer100g, MACRO_PER_100G_MAX);
  const fatPer100g = clampMacro(food.fatPer100g, MACRO_PER_100G_MAX);
  const fiberPer100g = clampMacro(food.fiberPer100g, MACRO_PER_100G_MAX);

  // Nothing loggable survived — drop the food rather than cache an all-null shell.
  if (
    caloriesPer100g === null &&
    proteinPer100g === null &&
    carbPer100g === null &&
    fatPer100g === null &&
    fiberPer100g === null
  ) {
    return null;
  }

  // Start from the original so any source-specific fields are preserved, then
  // overwrite the value fields with their clamped equivalents — each keeps its
  // declared MappedFood type, so the result stays assignable to T.
  return {
    ...food,
    name,
    servingSizeG: clampServingSizeG(food.servingSizeG),
    caloriesPer100g,
    proteinPer100g,
    carbPer100g,
    fatPer100g,
    fiberPer100g,
    micros: clampMicros(food.micros),
  };
}
