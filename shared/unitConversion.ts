import { METRES_PER_MILE } from "./units";

export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "miles";
export type StoredDistanceUnit = "m" | "ft";
export type ParsedDistanceUnit = StoredDistanceUnit | DistanceUnit;
export type WorkoutDistanceDisplayUnit = "m" | "ft" | "mi";

export interface UnitPreferences {
  readonly weightUnit?: string | null;
  readonly distanceUnit?: string | null;
}

export interface WorkoutDistanceDisplay {
  readonly value: number;
  readonly unit: WorkoutDistanceDisplayUnit;
  readonly text: string;
}

/**
 * 🛡️ Sentinel: unit-storage invariant (S5).
 *
 * Weights and distances in `exercise_sets` are stored in the athlete's own unit
 * at the time of writing, not a canonical SI unit. Since audit L4 each row also
 * RECORDS that unit, in `weight_unit` / `distance_unit`.
 *
 * A correction to what this sentinel used to say: it claimed "the Gemini parser
 * and the manual log form both convert incoming text to the user's current
 * weightUnit before insert". The parser and plan generation do. The manual log
 * form does NOT and never did — `expandExercisesToSetRows` was called with no
 * unit preferences at all, and the number the client sent was stored verbatim.
 * It happened to be right, because that number was already in the athlete's
 * unit, but nothing in the write path was enforcing it.
 *
 * Two kinds of row now exist:
 *   STAMPED (every row written since L4) — `weight_unit` says "kg" or "lbs",
 *      `distance_unit` says "m" or "ft". The value means that, permanently.
 *      Read it through `storedWeightToDisplay` / `storedDistanceToDisplay` and
 *      a later preference switch converts instead of reinterpreting.
 *   LEGACY (everything written before) — the columns are NULL. The unit is
 *      whatever the athlete preferred at write time and was never recorded, so
 *      it is UNRECOVERABLE: `users.weight_unit` is a bare scalar with no
 *      history, unlike `training_style_previous_id` / `training_style_changed_at`
 *      right beside it. These rows are read as the athlete's CURRENT preference
 *      — correct for anyone who never switched, wrong by ~2.2x for anyone who
 *      did, and not fixable in code.
 *
 * Consequences that still hold:
 *   1. Round-tripping a stored value through convert*() back to itself will
 *      exhibit floating-point drift (100 kg → 220.462 lbs → 99.99997 kg).
 *      Never read-convert-write a stored weight/distance.
 *   2. Changing a unit preference still does not migrate historical rows, and
 *      LEGACY rows will still show the ~2.2x jump. Stamped rows will not, once
 *      the read path they flow through is unit-aware. Read paths are being
 *      converted incrementally — an un-updated one is still correct for an
 *      athlete whose preference has not changed, which is exactly why the stamp
 *      could be introduced without touching all 23 of them at once.
 *
 * The `kgToUserWeight` / `userWeightToKg` helpers below are provided for
 * integration code that receives canonical units from third parties (e.g.
 * Strava/Garmin expose metric data); do NOT use them to read-convert-write a
 * stored value (consequence 1).
 *
 * Sanctioned read-only exception: the training-load service normalizes stored
 * weights to kg to compute UTSS (never writing the result back), so that the
 * absolute governor thresholds and the weighted-vs-bodyweight mix stay
 * comparable across kg and lb athletes. It now goes through `storedWeightToKg`,
 * which is exact for a stamped row and falls back to the old current-preference
 * assumption only for a legacy one.
 */

const KG_TO_LBS = 2.20462;
// Miles<->metres is defined ONCE, in shared/units.ts, and everything else on
// this axis is derived from it. These used to be two independent literals --
// METERS_PER_MILE = 1609.34 and KM_TO_MILES = 0.621371, whose reciprocal is
// 1609.3445 -- so `miles -> metres` gave a different answer depending on which
// function you routed through (audit L6).
const METERS_PER_MILE = METRES_PER_MILE;
const KM_TO_MILES = 1000 / METERS_PER_MILE;
const M_TO_FT = 3.28084;
const FEET_PER_MILE = 5280;
const CLEAN_KILOMETER_TOLERANCE_METERS = 0.5;

export const WEIGHT_UNIT_ALIASES: Record<string, WeightUnit> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  lb: "lbs",
  lbs: "lbs",
  pound: "lbs",
  pounds: "lbs",
};

export const DISTANCE_UNIT_ALIASES: Record<string, DistanceUnit> = {
  km: "km",
  kms: "km",
  kilometer: "km",
  kilometers: "km",
  mi: "miles",
  mile: "miles",
  miles: "miles",
};

const PARSED_DISTANCE_UNIT_ALIASES: Record<string, ParsedDistanceUnit> = {
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  km: "km",
  kms: "km",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  mi: "miles",
  mile: "miles",
  miles: "miles",
};

export function standardizeWeightUnit(unit: string | undefined | null): WeightUnit {
  if (!unit) return "kg";
  const normalized = unit.toLowerCase().trim();
  return WEIGHT_UNIT_ALIASES[normalized] || "kg";
}

export function standardizeDistanceUnit(unit: string | undefined | null): DistanceUnit {
  if (!unit) return "km";
  const normalized = unit.toLowerCase().trim();
  return DISTANCE_UNIT_ALIASES[normalized] || "km";
}

export function standardizeParsedDistanceUnit(unit: string | undefined | null): ParsedDistanceUnit | null {
  if (!unit) return null;
  const normalized = unit.toLowerCase().trim();
  return PARSED_DISTANCE_UNIT_ALIASES[normalized] ?? null;
}

export function getStoredDistanceUnit(distanceUnit: string | undefined | null): StoredDistanceUnit {
  return standardizeDistanceUnit(distanceUnit) === "miles" ? "ft" : "m";
}

export function convertWeight(value: number, from: string, to: string): number {
  const standardFrom = standardizeWeightUnit(from);
  const standardTo = standardizeWeightUnit(to);
  if (standardFrom === standardTo) return value;
  if (standardFrom === "kg" && standardTo === "lbs") return value * KG_TO_LBS;
  if (standardFrom === "lbs" && standardTo === "kg") return value / KG_TO_LBS;
  return value;
}

export function convertDistance(value: number, from: string, to: string): number {
  const standardFrom = standardizeDistanceUnit(from);
  const standardTo = standardizeDistanceUnit(to);
  if (standardFrom === standardTo) return value;
  if (standardFrom === "km" && standardTo === "miles") return value * KM_TO_MILES;
  if (standardFrom === "miles" && standardTo === "km") return value / KM_TO_MILES;
  return value;
}

export function formatNumberWithUnit(value: number, unit: string, decimals: number): string {
  // Guard against NaN / Infinity slipping into the UI as "NaN kg" or
  // "Infinity miles" — both can be produced upstream by a divide-by-zero
  // (e.g. unit conversion with a corrupt source) or unvalidated user input.
  if (!Number.isFinite(value)) return `— ${unit}`;
  return `${Number(value.toFixed(decimals))} ${unit}`;
}

export function formatWeight(value: number, unit: string, decimals: number = 1): string {
  const standardUnit = standardizeWeightUnit(unit);
  return formatNumberWithUnit(value, standardUnit, decimals);
}

export function formatDistance(value: number, unit: string, decimals: number = 2): string {
  const standardUnit = standardizeDistanceUnit(unit);
  return formatNumberWithUnit(value, standardUnit, decimals);
}

export function formatElevation(meters: number, distanceUnit: string): string {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (standardUnit === "miles") {
    return `${Math.round(meters * M_TO_FT)} ft`;
  }
  return `${Math.round(meters)} m`;
}

export function formatPace(metersPerSecond: number, distanceUnit: string): string {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (!metersPerSecond || Number.isNaN(metersPerSecond) || metersPerSecond <= 0) return "-";
  
  const secondsPerKm = 1000 / metersPerSecond;
  let secondsPerUnit: number;
  let unitLabel: string;

  if (standardUnit === "miles") {
    secondsPerUnit = secondsPerKm / KM_TO_MILES;
    unitLabel = "/mi";
  } else {
    secondsPerUnit = secondsPerKm;
    unitLabel = "/km";
  }

  let minutes = Math.floor(secondsPerUnit / 60);
  let seconds = Math.round(secondsPerUnit % 60);

  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}${unitLabel}`;
}

/**
 * Pace as seconds per the user's distance unit (km or mile), or null when speed
 * is non-positive. Numeric counterpart to `formatPace`, for plotting a pace
 * trend (lower = faster).
 */
export function paceSecondsPerUnit(metersPerSecond: number, distanceUnit: string): number | null {
  if (!metersPerSecond || Number.isNaN(metersPerSecond) || metersPerSecond <= 0) return null;
  const secondsPerKm = 1000 / metersPerSecond;
  return standardizeDistanceUnit(distanceUnit) === "miles" ? secondsPerKm / KM_TO_MILES : secondsPerKm;
}

export function formatSpeed(metersPerSecond: number, distanceUnit: string): string {
  if (metersPerSecond <= 0) return "N/A";
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  const kmPerHour = metersPerSecond * 3.6;
  if (standardUnit === "miles") {
    const milesPerHour = kmPerHour * KM_TO_MILES;
    return formatNumberWithUnit(milesPerHour, "mph", 1);
  }
  return formatNumberWithUnit(kmPerHour, "km/h", 1);
}

export function metersToUserDistance(meters: number, distanceUnit: string): number {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (standardUnit === 'km') return meters / 1000;
  if (standardUnit === 'miles') return meters / METERS_PER_MILE;
  return meters;
}

export function userDistanceToMeters(value: number, distanceUnit: string): number {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (standardUnit === "miles") {
    return (value / KM_TO_MILES) * 1000;
  }
  return value * 1000;
}

/**
 * Convert a distance value stored in `exercise_sets` / `workout_logs` — which is
 * in the user's stored unit (m for km users, ft for miles users) — into meters,
 * for read-only computation. This does NOT write the value back, so the
 * read-convert-write drift caveat in the unit-storage sentinel does not apply.
 */
export function storedDistanceToMeters(value: number, distanceUnit: string | undefined | null): number {
  return getStoredDistanceUnit(distanceUnit) === "ft" ? value / M_TO_FT : value;
}

export function kgToUserWeight(kg: number, weightUnit: string): number {
  const standardUnit = standardizeWeightUnit(weightUnit);
  if (standardUnit === "lbs") {
    return kg * KG_TO_LBS;
  }
  return kg;
}

export function userWeightToKg(value: number, weightUnit: string): number {
  const standardUnit = standardizeWeightUnit(weightUnit);
  if (standardUnit === "lbs") {
    return value / KG_TO_LBS;
  }
  return value;
}

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

/**
 * Split a canonical height in centimetres into whole feet + inches for display
 * to imperial users. Read-only (display edge) so the S5 read-convert-write
 * caveat does not apply. Rolls 12" up to the next foot.
 */
export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = totalInches % INCHES_PER_FOOT;
  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

/** Convert a feet + inches height back to canonical centimetres. */
export function ftInToCm(feet: number, inches: number): number {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

function roundToNearestHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function roundStoredWeight(value: number, weightUnit: string): number {
  if (!Number.isFinite(value)) return value;
  return standardizeWeightUnit(weightUnit) === "lbs"
    ? Math.round(value)
    : roundToNearestHalf(value);
}

export function roundStoredDistance(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : value;
}

// ---------------------------------------------------------------------------
// Per-row unit stamps (audit L4)
// ---------------------------------------------------------------------------

/**
 * Every NEW exercise_sets row records the unit its numbers are in, in
 * `weight_unit` / `distance_unit`.
 *
 * Before L4 a stored weight meant "a number in whatever unit the athlete
 * preferred at write time", and that unit was never written down — so switching
 * kg <-> lbs reinterpreted the athlete's whole history and analytics showed a
 * ~2.2x step change on the day they toggled a display preference.
 *
 * The value itself is stored UNCHANGED, in the athlete's own unit. Storing one
 * canonical unit instead would also fix the switch, but it would make every one
 * of the 23 places that read a set wrong until each was taught to convert back,
 * and a missed one shows a lbs athlete kilos labelled as pounds. Recording the
 * unit fixes the same bug while leaving every existing read correct for the
 * athlete who never switches, so read paths can be corrected one at a time
 * instead of all at once.
 *
 * It is also the prerequisite for canonicalising later, history included: the
 * reason old rows cannot be converted today is that nobody knows what unit they
 * are in. From here on, that is known.
 */

/** A stored row's unit stamp. Null/undefined means a pre-L4 row (see below). */
export interface StoredUnitStamp {
  readonly weightUnit?: string | null;
  readonly distanceUnit?: string | null;
}

/** The stamp to write on a new row: the units the athlete is working in. */
export function stampForPreferences(preferences: UnitPreferences): {
  weightUnit: WeightUnit;
  distanceUnit: StoredDistanceUnit;
} {
  return {
    weightUnit: standardizeWeightUnit(preferences.weightUnit),
    distanceUnit: getStoredDistanceUnit(preferences.distanceUnit),
  };
}

/**
 * Read a stored weight as the athlete should see it now.
 *
 *   stamped, unit unchanged → identity. The overwhelmingly common case, and why
 *                 an un-updated read path stays correct.
 *   stamped, unit changed   → convert from the unit it was written in. THIS is
 *                 the ~2.2x jump that L4 is about, and the only case whose
 *                 answer differs from what the code did before.
 *   unstamped (legacy)      → pass through unchanged, exactly as every read path
 *                 did before L4: right for an athlete who never switched, wrong
 *                 for one who did, and not fixable without knowing what they
 *                 used to prefer.
 */
export function storedWeightToDisplay(
  value: number,
  stamp: StoredUnitStamp,
  preferences: UnitPreferences,
): number {
  if (!stamp.weightUnit) return value;
  const displayUnit = standardizeWeightUnit(preferences.weightUnit);
  if (standardizeWeightUnit(stamp.weightUnit) === displayUnit) return value;
  return roundStoredWeight(convertWeight(value, stamp.weightUnit, displayUnit), displayUnit);
}

/** Read a stored distance as the athlete should see it now. See storedWeightToDisplay. */
export function storedDistanceToDisplay(
  value: number,
  stamp: StoredUnitStamp,
  preferences: UnitPreferences,
): number {
  if (!stamp.distanceUnit) return value;
  const displayUnit = getStoredDistanceUnit(preferences.distanceUnit);
  const storedUnit = standardizeParsedDistanceUnit(stamp.distanceUnit) ?? displayUnit;
  if (storedUnit === displayUnit) return value;
  return roundStoredDistance(
    metersToStoredDistance(parsedDistanceToMeters(value, storedUnit), displayUnit),
  );
}

/**
 * A stored weight in kg, for load maths that must not see display units.
 *
 * A stamped row is exact. A legacy row falls back to the athlete's CURRENT
 * preference — the same sanctioned read-only assumption trainingLoadService
 * already made before L4, and the same one that is wrong after a switch.
 */
export function storedWeightToKg(
  value: number,
  stamp: StoredUnitStamp,
  preferences: UnitPreferences,
): number {
  const unit = stamp.weightUnit ?? preferences.weightUnit;
  return userWeightToKg(value, standardizeWeightUnit(unit));
}

/** A stored distance in metres. See storedWeightToKg. */
export function storedDistanceToMetersStamped(
  value: number,
  stamp: StoredUnitStamp,
  preferences: UnitPreferences,
): number {
  const unit = stamp.distanceUnit ?? getStoredDistanceUnit(preferences.distanceUnit);
  return parsedDistanceToMeters(value, standardizeParsedDistanceUnit(unit) ?? "m");
}

/** The per-row values the unit stamp governs: actual and prescribed, per axis. */
export interface StampedSetValues extends StoredUnitStamp {
  readonly weight?: number | null;
  readonly plannedWeight?: number | null;
  readonly distance?: number | null;
  readonly plannedDistance?: number | null;
}

type StampedSetPatch = {
  weight?: number | null;
  plannedWeight?: number | null;
  distance?: number | null;
  plannedDistance?: number | null;
  weightUnit?: string | null;
  distanceUnit?: string | null;
};

/**
 * Re-stamp a PARTIAL update to a stored set so the row's unit stamp stays true
 * for every value on it.
 *
 * A patch's numbers are in the athlete's CURRENT preference (that is what the
 * client shows and edits), so an axis the patch touches is re-stamped with that
 * unit. But one stamp covers both the actual and the prescribed value on an
 * axis: patching `weight` on a kg-stamped row for an athlete who now prefers
 * lbs would relabel an untouched `plannedWeight` as pounds. So any value on a
 * re-stamped axis that the patch does NOT touch is converted from the old
 * stamp into the new unit first. A legacy (unstamped) row's values are, by
 * convention, already in the current preference, so they pass through
 * unchanged and simply gain the stamp.
 *
 * Axes the patch leaves alone keep their existing stamp and values.
 */
export function restampSetPatch<TPatch extends StampedSetPatch>(
  existing: StampedSetValues,
  patch: TPatch,
  preferences: UnitPreferences,
): TPatch & StampedSetPatch {
  const stamp = stampForPreferences(preferences);
  const out: StampedSetPatch = { ...patch };

  if (patch.weight !== undefined || patch.plannedWeight !== undefined) {
    out.weightUnit = stamp.weightUnit;
    if (patch.weight === undefined && existing.weight != null) {
      out.weight = storedWeightToDisplay(existing.weight, existing, preferences);
    }
    if (patch.plannedWeight === undefined && existing.plannedWeight != null) {
      out.plannedWeight = storedWeightToDisplay(existing.plannedWeight, existing, preferences);
    }
  }

  if (patch.distance !== undefined || patch.plannedDistance !== undefined) {
    out.distanceUnit = stamp.distanceUnit;
    if (patch.distance === undefined && existing.distance != null) {
      out.distance = storedDistanceToDisplay(existing.distance, existing, preferences);
    }
    if (patch.plannedDistance === undefined && existing.plannedDistance != null) {
      out.plannedDistance = storedDistanceToDisplay(existing.plannedDistance, existing, preferences);
    }
  }

  return out as TPatch & StampedSetPatch;
}

export function normalizeParsedWeight(
  value: number,
  sourceUnit: string | undefined | null,
  preferences: UnitPreferences,
): number {
  const targetUnit = standardizeWeightUnit(preferences.weightUnit);
  const fromUnit = standardizeWeightUnit(sourceUnit ?? targetUnit);
  return roundStoredWeight(convertWeight(value, fromUnit, targetUnit), targetUnit);
}

function parsedDistanceToMeters(value: number, sourceUnit: ParsedDistanceUnit): number {
  if (sourceUnit === "m") return value;
  if (sourceUnit === "ft") return value / M_TO_FT;
  if (sourceUnit === "km") return value * 1000;
  return value * METERS_PER_MILE;
}

function metersToStoredDistance(meters: number, targetUnit: StoredDistanceUnit): number {
  return targetUnit === "ft" ? meters * M_TO_FT : meters;
}

export function normalizeParsedDistance(
  value: number,
  sourceUnit: string | undefined | null,
  preferences: UnitPreferences,
): number {
  const targetUnit = getStoredDistanceUnit(preferences.distanceUnit);
  const parsedSourceUnit = standardizeParsedDistanceUnit(sourceUnit) ?? "m";
  const meters = parsedDistanceToMeters(value, parsedSourceUnit);
  return roundStoredDistance(metersToStoredDistance(meters, targetUnit));
}

function formatCompactNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

function formatWorkoutDistanceDisplayText(value: number, unit: WorkoutDistanceDisplayUnit, decimals: number): string {
  return `${formatCompactNumber(value, decimals)} ${unit}`;
}

function cleanWholeKilometerTarget(meters: number): number | null {
  const sign = Math.sign(meters) || 1;
  const absMeters = Math.abs(meters);
  const target = Math.round(absMeters / 1000) * 1000;
  if (target < 1000) return null;
  return Math.abs(absMeters - target) <= CLEAN_KILOMETER_TOLERANCE_METERS
    ? target * sign
    : null;
}

export function getWorkoutDistanceDisplay(value: number, distanceUnit: string): WorkoutDistanceDisplay {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (standardUnit === "km") {
    const meters = roundStoredDistance(value);
    return {
      value: meters,
      unit: "m",
      text: formatWorkoutDistanceDisplayText(meters, "m", 0),
    };
  }

  const feet = value;
  const metricTarget = cleanWholeKilometerTarget(feet / M_TO_FT);
  if (metricTarget != null) {
    return {
      value: metricTarget,
      unit: "m",
      text: formatWorkoutDistanceDisplayText(metricTarget, "m", 0),
    };
  }

  if (Math.abs(feet) >= FEET_PER_MILE) {
    const miles = feet / FEET_PER_MILE;
    return {
      value: Number(formatCompactNumber(miles, 2)),
      unit: "mi",
      text: formatWorkoutDistanceDisplayText(miles, "mi", 2),
    };
  }

  const roundedFeet = roundStoredDistance(feet);
  return {
    value: roundedFeet,
    unit: "ft",
    text: formatWorkoutDistanceDisplayText(roundedFeet, "ft", 0),
  };
}

export function displayDistanceToStored(
  value: number,
  displayUnit: WorkoutDistanceDisplayUnit,
  distanceUnit: string,
): number {
  let meters: number;
  if (displayUnit === "mi") {
    meters = value * METERS_PER_MILE;
  } else if (displayUnit === "ft") {
    meters = value / M_TO_FT;
  } else {
    meters = value;
  }
  return roundStoredDistance(metersToStoredDistance(meters, getStoredDistanceUnit(distanceUnit)));
}

function formatWorkoutWeight(value: number, targetUnit: WeightUnit): string {
  const rounded = roundStoredWeight(value, targetUnit);
  return `${formatCompactNumber(rounded, targetUnit === "lbs" ? 0 : 1)} ${targetUnit}`;
}

function distanceToMeters(value: number, unit: ParsedDistanceUnit): number {
  return parsedDistanceToMeters(value, unit);
}

function formatWorkoutDistance(value: number, sourceUnit: ParsedDistanceUnit, distanceUnit: DistanceUnit): string {
  const meters = distanceToMeters(value, sourceUnit);
  if (distanceUnit === "km") {
    if (Math.abs(meters) >= 1000) {
      return `${formatCompactNumber(meters / 1000, 2)} km`;
    }
    return `${formatCompactNumber(roundStoredDistance(meters), 0)} m`;
  }

  const feet = roundStoredDistance(metersToStoredDistance(meters, "ft"));
  return getWorkoutDistanceDisplay(feet, distanceUnit).text;
}

const TEXT_WEIGHT_UNITS = [
  "kilograms",
  "kilogram",
  "pounds",
  "pound",
  "kilos",
  "kilo",
  "kgs",
  "lbs",
  "kg",
  "lb",
] as const;

const TEXT_DISTANCE_UNITS = [
  "kilometers",
  "kilometres",
  "kilometer",
  "kilometre",
  "meters",
  "metres",
  "miles",
  "meter",
  "metre",
  "mile",
  "feet",
  "foot",
  "kms",
  "km",
  "mi",
  "ft",
  "m",
] as const;

const MINUTE_SHORTHAND_CONTEXT = [
  "amrap",
  "bike",
  "conditioning",
  "cooldown",
  "easy",
  "emom",
  "jog",
  "recovery",
  "ride",
  "row",
  "run",
  "ski",
  "steady",
  "tempo",
  "walk",
  "warmup",
  "workout",
  "z1",
  "z2",
  "z3",
  "zone",
] as const;

interface NumberToken {
  readonly value: number;
  readonly end: number;
}

interface TextUnitMatch {
  readonly type: "weight" | "distance";
  readonly rawUnit: string;
  readonly end: number;
}

function isDigit(char: string | undefined): boolean {
  return char != null && char >= "0" && char <= "9";
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
}

function isWordChar(char: string | undefined): boolean {
  if (char == null) return false;
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  );
}

function parseNumberToken(text: string, start: number): NumberToken | null {
  let index = start;
  if (text[index] === "-") {
    // A dash straight after a digit separates a range ("60-80kg"), it is not
    // a sign. Reading it as one made the scanner tokenize "-90" out of
    // "80-90kg" and convert only that half, so the low bound kept its source
    // magnitude while the label flipped: "80-90kg" came out as "80-198 lbs".
    if (start > 0 && isDigit(text[start - 1])) return null;
    if (!isDigit(text[index + 1])) return null;
    index += 1;
  }
  if (!isDigit(text[index])) return null;
  while (isDigit(text[index])) index += 1;
  // Thousands separators: "1,000m" is one number. Without this the scanner
  // read "1", then "000" as a separate zero, and "Row 1,000m" converted to
  // "Row 1,0 ft". Only an exact 3-digit group counts, so an ambiguous
  // decimal comma ("7,5kg") is left for the guard in the main loop.
  while (
    text[index] === "," &&
    isDigit(text[index + 1]) &&
    isDigit(text[index + 2]) &&
    isDigit(text[index + 3]) &&
    !isDigit(text[index + 4])
  ) {
    index += 4;
  }
  if (text[index] === "." && isDigit(text[index + 1])) {
    index += 1;
    while (isDigit(text[index])) index += 1;
  }
  const value = Number.parseFloat(text.slice(start, index).replaceAll(",", ""));
  return Number.isFinite(value) ? { value, end: index } : null;
}

/** Hyphen, en dash and em dash all show up as range separators in plans. */
const RANGE_SEPARATORS = new Set(["-", "\u2013", "\u2014"]);

/**
 * If the number at `numberStart` is the high bound of a range ("400-800m"),
 * return the low bound so both halves convert together. Returns null for
 * anything that is not cleanly `<number><dash>` immediately before it.
 */
function findRangeLowBound(text: string, numberStart: number): NumberToken | null {
  const separatorIndex = numberStart - 1;
  if (separatorIndex < 0) return null;
  if (!RANGE_SEPARATORS.has(text[separatorIndex] ?? "")) return null;

  let lowStart = separatorIndex;
  while (lowStart > 0 && isNumericBodyChar(text[lowStart - 1] ?? "")) lowStart -= 1;
  if (lowStart === separatorIndex) return null;

  const low = parseNumberToken(text, lowStart);
  // Must account for the whole span up to the separator, so "Set 3. 80-90kg"
  // reads 80 and a partial match like ".5-90kg" is declined.
  if (!low || low.end !== separatorIndex) return null;
  return { value: low.value, end: lowStart };
}

function isNumericBodyChar(char: string): boolean {
  return isDigit(char) || char === "." || char === ",";
}

/** Split "176 lbs" into its number and unit halves; null if it has no label. */
function splitConvertedValue(replacement: string): { value: string; unit: string } | null {
  const lastSpace = replacement.lastIndexOf(" ");
  if (lastSpace <= 0) return null;
  return { value: replacement.slice(0, lastSpace), unit: replacement.slice(lastSpace + 1) };
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (isWhitespace(text[index])) index += 1;
  return index;
}

function matchUnitFromList(
  text: string,
  lowerText: string,
  start: number,
  units: readonly string[],
  type: TextUnitMatch["type"],
): TextUnitMatch | null {
  for (const unit of units) {
    if (!lowerText.startsWith(unit, start)) continue;
    const end = start + unit.length;
    if (isWordChar(text[end])) continue;
    return { type, rawUnit: text.slice(start, end), end };
  }
  return null;
}

function matchTextUnit(text: string, lowerText: string, start: number): TextUnitMatch | null {
  return (
    matchUnitFromList(text, lowerText, start, TEXT_WEIGHT_UNITS, "weight") ??
    matchUnitFromList(text, lowerText, start, TEXT_DISTANCE_UNITS, "distance")
  );
}

function readNextWord(lowerText: string, start: number): string | null {
  let index = skipWhitespace(lowerText, start);
  const wordStart = index;
  while (isWordChar(lowerText[index])) index += 1;
  return index > wordStart ? lowerText.slice(wordStart, index) : null;
}

function readPreviousWord(lowerText: string, start: number): string | null {
  let index = start - 1;
  while (index >= 0 && isWhitespace(lowerText[index])) index -= 1;
  const wordEnd = index + 1;
  while (index >= 0 && isWordChar(lowerText[index])) index -= 1;
  return wordEnd > index + 1 ? lowerText.slice(index + 1, wordEnd) : null;
}

function isMinuteContext(word: string | null): boolean {
  return word != null && MINUTE_SHORTHAND_CONTEXT.includes(word as typeof MINUTE_SHORTHAND_CONTEXT[number]);
}

function isLikelyMinuteShorthand(
  value: number,
  sourceUnit: ParsedDistanceUnit,
  lowerText: string,
  numberStart: number,
  unitEnd: number,
): boolean {
  if (sourceUnit !== "m" || value > 60) return false;
  return isMinuteContext(readNextWord(lowerText, unitEnd)) || isMinuteContext(readPreviousWord(lowerText, numberStart));
}

function getWeightTextReplacement(
  value: number,
  rawUnit: string,
  targetWeightUnit: WeightUnit,
): string | null {
  const sourceUnit = standardizeWeightUnit(rawUnit);
  if (sourceUnit === targetWeightUnit) return null;
  return formatWorkoutWeight(convertWeight(value, sourceUnit, targetWeightUnit), targetWeightUnit);
}

function getDistancePreference(sourceUnit: ParsedDistanceUnit): DistanceUnit {
  return sourceUnit === "km" || sourceUnit === "m" ? "km" : "miles";
}

function isPaceOrRatioUnit(previousChar: string): boolean {
  return previousChar === "/" || previousChar === ":";
}

function getDistanceTextReplacement(
  text: string,
  lowerText: string,
  numberStart: number,
  numberToken: NumberToken,
  unitMatch: TextUnitMatch,
  targetDistanceUnit: DistanceUnit,
): string | null {
  const sourceUnit = standardizeParsedDistanceUnit(unitMatch.rawUnit);
  if (!sourceUnit) return null;
  const previousChar = numberStart > 0 ? text[numberStart - 1] ?? "" : "";
  if (isPaceOrRatioUnit(previousChar)) return null;
  if (isLikelyMinuteShorthand(numberToken.value, sourceUnit, lowerText, numberStart, unitMatch.end)) {
    return null;
  }
  if (getDistancePreference(sourceUnit) === targetDistanceUnit) return null;
  return formatWorkoutDistance(numberToken.value, sourceUnit, targetDistanceUnit);
}

function getTextUnitReplacement(
  text: string,
  lowerText: string,
  numberStart: number,
  numberToken: NumberToken,
  unitMatch: TextUnitMatch,
  targetWeightUnit: WeightUnit,
  targetDistanceUnit: DistanceUnit,
): string | null {
  if (unitMatch.type === "weight") {
    return getWeightTextReplacement(numberToken.value, unitMatch.rawUnit, targetWeightUnit);
  }
  return getDistanceTextReplacement(
    text,
    lowerText,
    numberStart,
    numberToken,
    unitMatch,
    targetDistanceUnit,
  );
}

export function normalizeWorkoutTextUnits(
  text: string | null | undefined,
  preferences: UnitPreferences,
): string | null | undefined {
  if (text == null || text.length === 0) return text;
  const targetWeightUnit = standardizeWeightUnit(preferences.weightUnit);
  const targetDistanceUnit = standardizeDistanceUnit(preferences.distanceUnit);
  const lowerText = text.toLowerCase();
  let result = "";
  let cursor = 0;
  let index = 0;

  while (index < text.length) {
    const numberToken = parseNumberToken(text, index);
    if (!numberToken) {
      index += 1;
      continue;
    }

    // A number reached through a digit-comma-digit group that was not a
    // thousands group ("7,5kg") is ambiguous — decimal comma or typo — so
    // leave it exactly as written rather than convert a half-read number.
    if (text[index - 1] === "," && isDigit(text[index - 2] ?? "")) {
      index = numberToken.end;
      continue;
    }

    const unitStart = skipWhitespace(text, numberToken.end);
    const unitMatch = matchTextUnit(text, lowerText, unitStart);
    if (!unitMatch) {
      index = numberToken.end;
      continue;
    }

    const replacement = getTextUnitReplacement(
      text,
      lowerText,
      index,
      numberToken,
      unitMatch,
      targetWeightUnit,
      targetDistanceUnit,
    );

    if (replacement != null) {
      // The unit binds to the whole range, so a low bound in front of this
      // number has to convert with it.
      const rangeLow = findRangeLowBound(text, index);
      const lowReplacement =
        rangeLow == null
          ? null
          : getTextUnitReplacement(
              text,
              lowerText,
              rangeLow.end,
              { value: rangeLow.value, end: index - 1 },
              unitMatch,
              targetWeightUnit,
              targetDistanceUnit,
            );

      if (rangeLow != null && lowReplacement == null) {
        // The low bound declined conversion (a pace, ratio or minute
        // shorthand reading) while the high bound accepted. Converting half
        // a range is worse than leaving it alone, so emit neither.
        index = unitMatch.end;
        continue;
      }

      if (rangeLow != null && lowReplacement != null) {
        const low = splitConvertedValue(lowReplacement);
        const high = splitConvertedValue(replacement);
        // Drop the low bound's label when both land on the same unit
        // ("176-198 lbs"); keep both when they don't ("900 m-1.1 km").
        const lowText =
          low != null && high != null && low.unit === high.unit ? low.value : lowReplacement;
        result += text.slice(cursor, rangeLow.end) + lowText + text.slice(index - 1, index) + replacement;
      } else {
        result += text.slice(cursor, index) + replacement;
      }
      cursor = unitMatch.end;
    }
    index = unitMatch.end;
  }

  return result + text.slice(cursor);
}
