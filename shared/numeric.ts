/**
 * Small numeric helpers that used to be re-declared module by module: a
 * median, a three-argument clamp and rounding to one decimal place (S-numeric,
 * REFACTORING_REVIEW 2026-09-23). Pure and import-free, so the client bundle
 * can use them too. Means and ratios live in `ratio.ts`.
 */

/**
 * The median of `values`; the middle pair is averaged for an even count. For a
 * non-empty list only: an empty one gives NaN. Use `medianOrNull` where the
 * list can be empty.
 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // An empty list reads NaN on both sides, so the result is NaN as documented.
  const upper = sorted[mid] ?? Number.NaN;
  if (sorted.length % 2 !== 0) return upper;
  const lower = sorted[mid - 1] ?? Number.NaN;
  return (lower + upper) / 2;
}

/** `median`, or null for an empty list. */
export function medianOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return median(values);
}

/** `n` held to [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `n` rounded to one decimal place. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
