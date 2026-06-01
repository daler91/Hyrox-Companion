import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

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

  // Memoize so consumers (e.g. one observer per timeline card) get a stable
  // object reference across renders when the prefs haven't changed (S8).
  return useMemo(
    () => ({
      weightUnit,
      distanceUnit,
      weightLabel: weightUnit === "kg" ? "kg" : "lbs",
      distanceLabel: distanceUnit === "km" ? "km" : "miles",
      showAdherenceInsights,
      isLoading,
    }),
    [weightUnit, distanceUnit, showAdherenceInsights, isLoading],
  );
}
