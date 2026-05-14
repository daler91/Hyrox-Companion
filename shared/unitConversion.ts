export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "miles";
export type StoredDistanceUnit = "m" | "ft";
export type ParsedDistanceUnit = StoredDistanceUnit | DistanceUnit;

export interface UnitPreferences {
  readonly weightUnit?: string | null;
  readonly distanceUnit?: string | null;
}

/**
 * 🛡️ Sentinel: unit-storage invariant (S5).
 *
 * Weights and distances in `workout_logs` / `exercise_sets` are stored in the
 * USER'S CURRENT preferred unit at the time of writing — not a canonical SI
 * unit. The Gemini parser and the manual log form both convert incoming text
 * to the user's current `weightUnit` / `distanceUnit` before insert.
 *
 * Consequences:
 *   1. Round-tripping a stored value through convert*() back to itself will
 *      exhibit floating-point drift (100 kg → 220.462 lbs → 99.99997 kg).
 *      Never read-convert-write a stored weight/distance.
 *   2. Changing a user's unit preference does NOT migrate historical rows.
 *      Analytics stacks the raw numbers, so a user who switches from kg to
 *      lbs mid-history will see an apparent ~2.2x jump. We accept this
 *      trade-off today; a canonicalization migration is tracked as future
 *      work (see docs/state-management.md).
 *
 * The `kgToUserWeight` / `userWeightToKg` helpers below are provided for
 * integration code that receives canonical units from third parties (e.g.
 * Strava/Garmin expose metric data); do NOT use them on values already
 * sourced from our own DB.
 */

const KG_TO_LBS = 2.20462;
const KM_TO_MILES = 0.621371;
const M_TO_FT = 3.28084;
const FEET_PER_MILE = 5280;
const METERS_PER_MILE = 1609.34;

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
  if (standardUnit === 'miles') return meters / 1609.34;
  return meters;
}

export function userDistanceToMeters(value: number, distanceUnit: string): number {
  const standardUnit = standardizeDistanceUnit(distanceUnit);
  if (standardUnit === "miles") {
    return (value / KM_TO_MILES) * 1000;
  }
  return value * 1000;
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
  const parsedSourceUnit = standardizeParsedDistanceUnit(sourceUnit) ?? targetUnit;
  const meters = parsedDistanceToMeters(value, parsedSourceUnit);
  return roundStoredDistance(metersToStoredDistance(meters, targetUnit));
}

function formatCompactNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
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

  const feet = meters * M_TO_FT;
  if (Math.abs(feet) >= FEET_PER_MILE / 4) {
    return `${formatCompactNumber(feet / FEET_PER_MILE, 2)} mi`;
  }
  return `${formatCompactNumber(roundStoredDistance(feet), 0)} ft`;
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
    if (!isDigit(text[index + 1])) return null;
    index += 1;
  }
  if (!isDigit(text[index])) return null;
  while (isDigit(text[index])) index += 1;
  if (text[index] === "." && isDigit(text[index + 1])) {
    index += 1;
    while (isDigit(text[index])) index += 1;
  }
  const value = Number.parseFloat(text.slice(start, index));
  return Number.isFinite(value) ? { value, end: index } : null;
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

    const unitStart = skipWhitespace(text, numberToken.end);
    const unitMatch = matchTextUnit(text, lowerText, unitStart);
    if (!unitMatch) {
      index = numberToken.end;
      continue;
    }

    let replacement: string | null = null;
    if (unitMatch.type === "weight") {
      const sourceUnit = standardizeWeightUnit(unitMatch.rawUnit);
      if (sourceUnit !== targetWeightUnit) {
        replacement = formatWorkoutWeight(
          convertWeight(numberToken.value, sourceUnit, targetWeightUnit),
          targetWeightUnit,
        );
      }
    } else {
      const previousChar = index > 0 ? text[index - 1] : "";
      const sourceUnit = standardizeParsedDistanceUnit(unitMatch.rawUnit);
      const currentPreference = sourceUnit === "km" || sourceUnit === "m" ? "km" : "miles";
      if (previousChar !== "/" && previousChar !== ":" && sourceUnit && currentPreference !== targetDistanceUnit) {
        replacement = formatWorkoutDistance(numberToken.value, sourceUnit, targetDistanceUnit);
      }
    }

    if (replacement) {
      result += text.slice(cursor, index) + replacement;
      cursor = unitMatch.end;
    }
    index = unitMatch.end;
  }

  return result + text.slice(cursor);
}
