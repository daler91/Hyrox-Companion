export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "miles";

const KG_TO_LBS = 2.20462;
const KM_TO_MILES = 0.621371;
const M_TO_FT = 3.28084;

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
  if (standardUnit === "km") return meters / 1000;
  if (standardUnit === "miles") return meters / 1609.34;
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
