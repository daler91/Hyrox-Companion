/**
 * Ratio and mean helpers, so an average stops being computed a different way
 * at every call site.
 *
 * The August 2026 calculation audit found six findings sharing one root cause:
 * a numerator and a denominator drawn from different populations. Three shapes
 * kept recurring, and each has a helper here:
 *
 *   1. `mean(perItemMeans)` — averaging averages. "Avg RPE" was the unweighted
 *      mean of WEEKLY means, so a single hard session in a quiet week counted
 *      as much as six sessions in a heavy one: one RPE-10 workout plus six
 *      RPE-4 workouts reported 7.0 instead of 4.9 (audit H9). Use `weightedMean`
 *      or, better, pool the raw values.
 *
 *   2. A numerator filtered by a condition the denominator does not share.
 *      "Avg Duration" summed duration only where it was recorded but divided by
 *      EVERY logged workout, halving the answer for an athlete who records
 *      duration inconsistently (audit H8). Use `pooledRatio` and count the same
 *      population on both sides.
 *
 *   3. A denominator built only from the periods that have data. "Avg / Week"
 *      divided by the number of weeks that CONTAIN a workout, so rest weeks
 *      were structurally invisible and the figure could never fall below 1.0
 *      (audit H7). Zero-fill the range first, then use `pooledRatio`.
 *
 * See `docs/CALCULATION_AUDIT_2026-08-20.md` (root cause C).
 */

/**
 * A single pooled ratio: total numerator over total denominator.
 *
 * Returns null — not 0 — when the denominator is 0 or either side is not
 * finite. A zero denominator means "no basis to answer", which is different
 * from "the answer is zero", and collapsing the two is how an athlete with no
 * plan came to be emailed a 100% completion rate (audit H6).
 */
export function pooledRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** `pooledRatio` scaled to a percentage. Null propagates. */
export function pooledPercentage(numerator: number, denominator: number): number | null {
  const ratio = pooledRatio(numerator, denominator);
  return ratio == null ? null : ratio * 100;
}

/**
 * Mean of `values` weighted by `weights` — the correct way to combine
 * per-group averages when the groups are not the same size.
 *
 * Prefer pooling the raw observations where you still have them; this is for
 * the cases where only the per-group summary survives.
 */
export function weightedMean(values: readonly number[], weights: readonly number[]): number | null {
  if (values.length !== weights.length) return null;
  let weightedTotal = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const weight = weights[i];
    if (value == null || weight == null) continue;
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  return pooledRatio(weightedTotal, totalWeight);
}

/** Round to `dp` decimal places, preserving null. */
export function roundOrNull(value: number | null, dp = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
