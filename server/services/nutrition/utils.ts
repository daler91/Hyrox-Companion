/**
 * Small shared helpers for the external nutrition clients (USDA, OFF, FatSecret,
 * Spoonacular, Edamam). Kept in one place so the numeric coercion and the
 * oz→grams factor can't drift between providers.
 */

/**
 * Coerce a provider's numeric field (often a string like "120.000") to a finite
 * number, or null when absent / non-numeric.
 */
export function num(value: unknown): number | null {
  let n: number;
  if (typeof value === "string") n = Number(value);
  else if (typeof value === "number") n = value;
  else n = Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Avoirdupois ounce → grams. One source of truth so an oz serving converts
 * identically across every client.
 */
export const OZ_TO_GRAMS = 28.349523125;
