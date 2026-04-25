import { useQuery } from "@tanstack/react-query";

import { QUERY_KEYS, type UserPreferences } from "@/lib/api";

interface UnitPreferences {
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  weightLabel: string;
  distanceLabel: string;
  showAdherenceInsights: boolean;
  isLoading: boolean;
}

export function useUnitPreferences(): UnitPreferences {
  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: QUERY_KEYS.preferences,
  });

  const weightUnit = (preferences?.weightUnit || "kg") as "kg" | "lbs";
  const distanceUnit = (preferences?.distanceUnit || "km") as "km" | "miles";
  const showAdherenceInsights = preferences?.showAdherenceInsights ?? true;

  return {
    weightUnit,
    distanceUnit,
    weightLabel: weightUnit === "kg" ? "kg" : "lbs",
    distanceLabel: distanceUnit === "km" ? "km" : "miles",
    showAdherenceInsights,
    isLoading,
  };
}
