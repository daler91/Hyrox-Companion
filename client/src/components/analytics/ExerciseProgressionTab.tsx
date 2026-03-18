import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Loader2 } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { getExerciseLabel } from "@/lib/exerciseUtils";
import { MiniBarChart, type ExerciseAnalyticDay } from "@/components/analytics/MiniBarChart";

interface RawPREntry {
  category: string;
  customLabel?: string | null;
}

interface ExerciseProgressionTabProps {
  dateParams: string;
}

export function ExerciseProgressionTab({ dateParams }: ExerciseProgressionTabProps) {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  const { data: rawPRs } = useQuery<Record<string, RawPREntry>>({
    queryKey: ["/api/v1/personal-records", dateParams],
    queryFn: () => fetch(`/api/v1/personal-records${dateParams}`).then(r => r.json()),
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
    queryFn: () => fetch(`/api/v1/exercise-analytics${dateParams}`).then(r => r.json()),
  });

  const analyticsData = useMemo(() => {
    if (!allAnalytics || !selectedExercise) return null;
    const data = allAnalytics[selectedExercise];
    if (!data || data.length === 0) return null;

    let hasVolume = false;
    let hasMaxWeight = false;
    let hasTotalReps = false;
    let hasTotalDistance = false;

    let totalSets = 0;
    let totalReps = 0;
    let totalVolume = 0;

    for (const d of data) {
      if (d.totalVolume > 0) hasVolume = true;
      if (d.maxWeight > 0) hasMaxWeight = true;
      if (d.totalReps > 0) hasTotalReps = true;
      if (d.totalDistance > 0) hasTotalDistance = true;

      totalSets += d.totalSets;
      totalReps += d.totalReps;
      totalVolume += d.totalVolume;
    }

    return {
      data,
      hasVolume,
      hasMaxWeight,
      hasTotalReps,
      hasTotalDistance,
      totalSets,
      totalReps,
      totalVolume
    };
  }, [allAnalytics, selectedExercise]);

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
        <div className="mb-6">
          <Select value={selectedExercise || undefined} onValueChange={setSelectedExercise}>
            <SelectTrigger data-testid="select-exercise-progression">
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

        {(() => {
          if (!selectedExercise) {
            return (
              <div className="flex items-center justify-center py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                <div>
                  <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p>Select an exercise from the dropdown above to view its progression.</p>
                </div>
              </div>
            );
          }
          if (analyticsLoading) {
            return (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            );
          }
          if (!analyticsData || analyticsData.data.length === 0) {
            return <p className="text-muted-foreground text-sm py-4">No data available for this exercise yet.</p>;
          }
          return (
            <div className="grid gap-6 sm:grid-cols-2">
              {analyticsData.hasVolume && (
                <MiniBarChart data={analyticsData.data} valueKey="totalVolume" color="bg-primary/60" label={`Volume (reps x ${weightLabel})`} />
              )}
              {analyticsData.hasMaxWeight && (
                <MiniBarChart data={analyticsData.data} valueKey="maxWeight" color="bg-purple-500/60" label={`Max Weight (${weightLabel})`} />
              )}
              {analyticsData.hasTotalReps && (
                <MiniBarChart data={analyticsData.data} valueKey="totalReps" color="bg-blue-500/60" label="Total Reps" />
              )}
              {analyticsData.hasTotalDistance && (
                <MiniBarChart data={analyticsData.data} valueKey="totalDistance" color="bg-green-500/60" label={`Total Distance (${dLabel})`} />
              )}
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground font-medium mb-2">Summary</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-2xl font-bold" data-testid="text-total-sessions">{analyticsData.data.length}</p>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sessions</p>
                  </div>
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-2xl font-bold" data-testid="text-total-sets">
                      {analyticsData.totalSets}
                    </p>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Sets</p>
                  </div>
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-2xl font-bold" data-testid="text-total-reps">
                      {analyticsData.totalReps}
                    </p>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Reps</p>
                  </div>
                  {analyticsData.hasVolume && (
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <p className="text-2xl font-bold" data-testid="text-total-volume">
                        {Math.round(analyticsData.totalVolume).toLocaleString()}
                      </p>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Volume ({weightLabel})</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
