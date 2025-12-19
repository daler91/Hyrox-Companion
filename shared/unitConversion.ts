export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "miles";

const KG_TO_LBS = 2.20462;
const KM_TO_MILES = 0.621371;
const M_TO_FT = 3.28084;

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  if (from === "kg" && to === "lbs") return value * KG_TO_LBS;
  if (from === "lbs" && to === "kg") return value / KG_TO_LBS;
  return value;
}

export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value;
  if (from === "km" && to === "miles") return value * KM_TO_MILES;
  if (from === "miles" && to === "km") return value / KM_TO_MILES;
  return value;
}

export function formatWeight(value: number, unit: WeightUnit, decimals: number = 1): string {
  return `${value.toFixed(decimals)} ${unit}`;
}

export function formatDistance(value: number, unit: DistanceUnit, decimals: number = 2): string {
  return `${value.toFixed(decimals)} ${unit}`;
}

export function formatElevation(meters: number, distanceUnit: DistanceUnit): string {
  if (distanceUnit === "miles") {
    return `${Math.round(meters * M_TO_FT)} ft`;
  }
  return `${Math.round(meters)} m`;
}

export function formatPace(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  if (metersPerSecond <= 0) return "N/A";
  
  const secondsPerKm = 1000 / metersPerSecond;
  let secondsPerUnit: number;
  let unitLabel: string;

  if (distanceUnit === "miles") {
    secondsPerUnit = secondsPerKm / KM_TO_MILES;
    unitLabel = "/mi";
  } else {
    secondsPerUnit = secondsPerKm;
    unitLabel = "/km";
  }

  const minutes = Math.floor(secondsPerUnit / 60);
  const seconds = Math.round(secondsPerUnit % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}${unitLabel}`;
}

export function formatSpeed(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  if (metersPerSecond <= 0) return "N/A";
  
  const kmPerHour = metersPerSecond * 3.6;
  
  if (distanceUnit === "miles") {
    const milesPerHour = kmPerHour * KM_TO_MILES;
    return `${milesPerHour.toFixed(1)} mph`;
  }
  return `${kmPerHour.toFixed(1)} km/h`;
}

export function metersToUserDistance(meters: number, distanceUnit: DistanceUnit): number {
  const km = meters / 1000;
  if (distanceUnit === "miles") {
    return km * KM_TO_MILES;
  }
  return km;
}

export function userDistanceToMeters(value: number, distanceUnit: DistanceUnit): number {
  if (distanceUnit === "miles") {
    return (value / KM_TO_MILES) * 1000;
  }
  return value * 1000;
}

export function kgToUserWeight(kg: number, weightUnit: WeightUnit): number {
  if (weightUnit === "lbs") {
    return kg * KG_TO_LBS;
  }
  return kg;
}

export function userWeightToKg(value: number, weightUnit: WeightUnit): number {
  if (weightUnit === "lbs") {
    return value / KG_TO_LBS;
  }
  return value;
}
