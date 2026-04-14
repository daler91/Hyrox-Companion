import { useQuery } from "@tanstack/react-query";
import { Activity, TrendingUp } from "lucide-react";
import { useMemo,useState } from "react";

import { ExerciseProgressionCharts } from "@/components/analytics/ExerciseProgressionCharts";
import { type ExerciseAnalyticDay } from "@/components/analytics/MiniBarChart";
import { Card, CardContent, CardDescription,CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { api } from "@/lib/api";
import { getExerciseLabel } from "@/lib/exerciseUtils";

interface RawPREntry {
  category: string;
  customLabel?: string | null;
}

interface ExerciseProgressionTabProps {
  readonly dateParams: string;
}

export function ExerciseProgressionTab({ dateParams }: ExerciseProgressionTabProps) {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  const { data: rawPRs } = useQuery<Record<string, RawPREntry>>({
    queryKey: ["/api/v1/personal-records", dateParams],
    queryFn: () => api.analytics.getPersonalRecords(dateParams),
    // ⚡ Perf: kill rapid tab-toggle refetches but auto-heal after 5 min in
    // case an ingestion flow (Strava/Garmin sync, combine, batch reparse)
    // forgets to invalidate QUERY_KEYS.personalRecords.
    // (CODEBASE_REVIEW_2026-04-12.md #27; belt-and-braces with mutation-side
    // invalidations in useStrava/Garmin/Combine/DataTools.)
    staleTime: 5 * 60 * 1000,
  });

  const availableExercises = useMemo(() => {
    if (!rawPRs) return [];
    return Object.entries(rawPRs).map(([exerciseName, pr]) => ({
      value: exerciseName,
      label: getExerciseLabel(exerciseName, pr.customLabel),
      category: pr.category,
    }));
  }, [rawPRs]);

  const { data: allAnalytics, isLoading: analyticsLoading } = useQuery<Record<string, ExerciseAnalyticDay[]>>({
    queryKey: ["/api/v1/exercise-analytics", dateParams],
    queryFn: () => api.analytics.getExerciseAnalytics(dateParams) as Promise<Record<string, ExerciseAnalyticDay[]>>,
    // ⚡ Perf: see note above on personal-records query.
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card data-testid="card-exercise-progression">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle>Exercise Progression</CardTitle>
        </div>
        <CardDescription>
          Select an exercise to view its detailed history and progression
        </CardDescription>
      </CardHeader>
      <CardContent>
        {availableExercises.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-progression">
            <Activity className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm">No exercise data yet. Log workouts with structured exercises to track your progression over time.</p>
          </div>
        ) : (
        <>
        <div className="mb-6">
          <Select value={selectedExercise || undefined} onValueChange={setSelectedExercise}>
            <SelectTrigger data-testid="select-exercise-progression" aria-label="Select an exercise to view progression">
              <SelectValue placeholder="Select an exercise..." />
            </SelectTrigger>
            <SelectContent>
              {availableExercises.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ExerciseProgressionCharts
          selectedExercise={selectedExercise}
          allAnalytics={allAnalytics}
          analyticsLoading={analyticsLoading}
          weightLabel={weightLabel}
          dLabel={dLabel}
        />
        </>
        )}
      </CardContent>
    </Card>
  );
}
