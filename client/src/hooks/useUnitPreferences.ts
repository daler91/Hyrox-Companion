import { useQuery } from "@tanstack/react-query";

interface Preferences {
  weightUnit: string;
  distanceUnit: string;
  weeklyGoal: number;
}

interface UnitPreferences {
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  weightLabel: string;
  distanceLabel: string;
  isLoading: boolean;
}

export function useUnitPreferences(): UnitPreferences {
  const { data: preferences, isLoading } = useQuery<Preferences>({
    queryKey: ["/api/preferences"],
  });

  const weightUnit = (preferences?.weightUnit || "kg") as "kg" | "lbs";
  const distanceUnit = (preferences?.distanceUnit || "km") as "km" | "miles";

  return {
    weightUnit,
    distanceUnit,
    weightLabel: weightUnit === "kg" ? "kg" : "lbs",
    distanceLabel: distanceUnit === "km" ? "km" : "miles",
    isLoading,
  };
}
