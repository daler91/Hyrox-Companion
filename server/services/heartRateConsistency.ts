/**
 * Cross-field heart-rate consistency for partial workout updates.
 *
 * The route-level refinement on the update schema only sees fields present in a
 * PATCH body, so a one-sided update (e.g. only `maxHeartrate`) can't be checked
 * against its stored counterpart there. This merges the patch over the existing
 * values and rejects an impossible pair (max below avg) when both end up
 * present. Returns an error message, or null when the merged pair is fine.
 */
export interface HeartRatePair {
  readonly avgHeartrate?: number | null;
  readonly maxHeartrate?: number | null;
}

export function findInconsistentHeartRate(
  patch: HeartRatePair,
  existing: HeartRatePair,
): string | null {
  const patchHasAvg = "avgHeartrate" in patch;
  const patchHasMax = "maxHeartrate" in patch;
  // Nothing to check if the update doesn't touch either heart-rate field.
  if (!patchHasAvg && !patchHasMax) return null;

  const avg = (patchHasAvg ? patch.avgHeartrate : existing.avgHeartrate) ?? null;
  const max = (patchHasMax ? patch.maxHeartrate : existing.maxHeartrate) ?? null;
  if (avg != null && max != null && max < avg) {
    return "Max heart rate cannot be below average heart rate";
  }
  return null;
}
