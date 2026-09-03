import {
  type StampedSetValues,
  stampForPreferences,
  storedDistanceToDisplay,
  storedWeightToDisplay,
  type UnitPreferences,
} from "@shared/unitConversion";

/**
 * A stored set re-expressed in the athlete's CURRENT units.
 *
 * Every exercise_sets row records the unit its numbers are in (audit L4), but
 * the workout-detail tree labelled the raw stored number with whatever the
 * athlete prefers today, so a 100 kg set read "100 lb" after a switch and the
 * progression suggestion was computed on the wrong-unit number (finding D2).
 * Rather than teaching each of the ~28 read sites to convert, the sets are
 * converted once where they enter a surface and every downstream read sees
 * values already in the display unit.
 *
 *   stamped, same unit  -> the row itself (values untouched, identity)
 *   stamped, other unit -> a copy with weight/plannedWeight and
 *                          distance/plannedDistance converted and rounded by
 *                          storedWeightToDisplay / storedDistanceToDisplay
 *   legacy (no stamp)   -> a copy with the values untouched and the stamp set,
 *                          the same "current preference" reading every read
 *                          path applied before L4
 *
 * The result carries the CURRENT stamp, so applying this twice is a no-op and
 * a value written back from it is in the unit the server will re-stamp it as.
 */
export function toPreferenceScale<T extends StampedSetValues>(set: T, preferences: UnitPreferences): T {
  const stamp = stampForPreferences(preferences);
  const weight = scaleWeight(set.weight, set, preferences);
  const plannedWeight = scaleWeight(set.plannedWeight, set, preferences);
  const distance = scaleDistance(set.distance, set, preferences);
  const plannedDistance = scaleDistance(set.plannedDistance, set, preferences);

  const alreadyInScale =
    weight === set.weight &&
    plannedWeight === set.plannedWeight &&
    distance === set.distance &&
    plannedDistance === set.plannedDistance &&
    set.weightUnit === stamp.weightUnit &&
    set.distanceUnit === stamp.distanceUnit;
  if (alreadyInScale) return set;

  return {
    ...set,
    weight,
    plannedWeight,
    distance,
    plannedDistance,
    weightUnit: stamp.weightUnit,
    distanceUnit: stamp.distanceUnit,
  };
}

/** `toPreferenceScale` over a list; the same array comes back when no row changed. */
export function toPreferenceScaleAll<T extends StampedSetValues>(
  sets: readonly T[],
  preferences: UnitPreferences,
): T[] {
  let changed = false;
  const scaled = sets.map((set) => {
    const next = toPreferenceScale(set, preferences);
    if (next !== set) changed = true;
    return next;
  });
  return changed ? scaled : (sets as T[]);
}

function scaleWeight(
  value: number | null | undefined,
  stamp: StampedSetValues,
  preferences: UnitPreferences,
): number | null | undefined {
  return value == null ? value : storedWeightToDisplay(value, stamp, preferences);
}

function scaleDistance(
  value: number | null | undefined,
  stamp: StampedSetValues,
  preferences: UnitPreferences,
): number | null | undefined {
  return value == null ? value : storedDistanceToDisplay(value, stamp, preferences);
}
