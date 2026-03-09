import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trophy, TrendingUp, Dumbbell, Timer, Ruler, Weight } from "lucide-react";
import { Link } from "wouter";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { categoryChipColors, categoryLabels, getExerciseLabel } from "@/lib/exerciseUtils";
import { useState, useMemo } from "react";
import { subDays, format } from "date-fns";
import { MiniBarChart, type ExerciseAnalyticDay } from "@/components/analytics/MiniBarChart";

interface PRValue {
  value: number;
  date: string;
  workoutLogId: string;
}

interface RawPREntry {
  maxWeight?: PRValue;
  maxDistance?: PRValue;
  bestTime?: PRValue;
}

interface PersonalRecord {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  maxWeight?: number | null;
  maxWeightDate?: string | null;
  maxDistance?: number | null;
  maxDistanceDate?: string | null;
  bestTime?: number | null;
  bestTimeDate?: string | null;
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Analytics() {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<string>("90");

  const dateParams = useMemo(() => {
    if (dateRange === "all") return "";
    const from = format(subDays(new Date(), Number(dateRange)), "yyyy-MM-dd");
    return `?from=${from}`;
  }, [dateRange]);

  const { data: rawPRs, isLoading: prsLoading } = useQuery<Record<string, RawPREntry & { category: string; customLabel?: string | null }>>({
    queryKey: ["/api/personal-records", dateRange],
    queryFn: () => fetch(`/api/personal-records${dateParams}`).then(r => r.json()),
  });

  const personalRecords = useMemo(() => {
    if (!rawPRs) return [];
    return Object.entries(rawPRs).map(([exerciseName, pr]) => ({
      exerciseName,
      customLabel: pr.customLabel,
      category: pr.category,
      maxWeight: pr.maxWeight?.value ?? null,
      maxWeightDate: pr.maxWeight?.date ?? null,
      maxDistance: pr.maxDistance?.value ?? null,
      maxDistanceDate: pr.maxDistance?.date ?? null,
      bestTime: pr.bestTime?.value ?? null,
      bestTimeDate: pr.bestTime?.date ?? null,
    }));
  }, [rawPRs]);

  const { data: allAnalytics, isLoading: analyticsLoading } = useQuery<Record<string, ExerciseAnalyticDay[]>>({
    queryKey: ["/api/exercise-analytics", dateRange],
    queryFn: () => fetch(`/api/exercise-analytics${dateParams}`).then(r => r.json()),
  });

  const filteredPRs = useMemo(() => {
    if (!personalRecords) return [];
    if (categoryFilter === "all") return personalRecords;
    return personalRecords.filter(pr => pr.category === categoryFilter);
  }, [personalRecords, categoryFilter]);

  const availableExercises = useMemo(() => {
    if (!personalRecords) return [];
    return personalRecords.map(pr => ({
      value: pr.exerciseName,
      label: getExerciseLabel(pr.exerciseName, pr.customLabel),
      category: pr.category,
    }));
  }, [personalRecords]);

  const analyticsData = useMemo(() => {
    if (!allAnalytics || !selectedExercise) return null;
    const data = allAnalytics[selectedExercise];
    if (!data || data.length === 0) return null;
    return { data };
  }, [allAnalytics, selectedExercise]);

  const isLoading = prsLoading;
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
        <p className="text-muted-foreground">Personal records and exercise progression</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <CardTitle>Personal Records</CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-36" data-testid="select-date-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="180">Last 6 months</SelectItem>
                  <SelectItem value="365">Last year</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-40" data-testid="select-pr-category">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="hyrox_station">Hyrox Station</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="strength">Strength</SelectItem>
                  <SelectItem value="conditioning">Conditioning</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>Your best performances across all exercises</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPRs.length === 0 ? (
            <div className="text-center py-4 space-y-3" data-testid="text-no-prs">
              <Dumbbell className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                No personal records yet. Log workouts with structured exercise data to see your PRs here.
              </p>
              <Link href="/log">
                <Button variant="outline" data-testid="button-log-workout-from-analytics">
                  <Dumbbell className="h-4 w-4 mr-2" />
                  Log a Workout
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredPRs.map((pr) => (
                <Card key={`${pr.exerciseName}-${pr.customLabel || ""}`} className="border" data-testid={`card-pr-${pr.exerciseName}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-medium text-sm">{getExerciseLabel(pr.exerciseName, pr.customLabel)}</span>
                      <Badge variant="secondary" className={`text-xs ${categoryChipColors[pr.category] || ""}`}>
                        {categoryLabels[pr.category] || pr.category}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {pr.maxWeight != null && (
                        <div className="text-center">
                          <Weight className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                          <p className="text-sm font-semibold" data-testid={`text-pr-weight-${pr.exerciseName}`}>
                            {pr.maxWeight}{weightLabel}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Max Weight</p>
                          {pr.maxWeightDate && <p className="text-[10px] text-muted-foreground/60">{formatDate(pr.maxWeightDate)}</p>}
                        </div>
                      )}
                      {pr.maxDistance != null && (
                        <div className="text-center">
                          <Ruler className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                          <p className="text-sm font-semibold" data-testid={`text-pr-distance-${pr.exerciseName}`}>
                            {pr.maxDistance}{dLabel}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Max Distance</p>
                          {pr.maxDistanceDate && <p className="text-[10px] text-muted-foreground/60">{formatDate(pr.maxDistanceDate)}</p>}
                        </div>
                      )}
                      {pr.bestTime != null && (
                        <div className="text-center">
                          <Timer className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                          <p className="text-sm font-semibold" data-testid={`text-pr-time-${pr.exerciseName}`}>
                            {pr.bestTime}min
                          </p>
                          <p className="text-[10px] text-muted-foreground">Best Time</p>
                          {pr.bestTimeDate && <p className="text-[10px] text-muted-foreground/60">{formatDate(pr.bestTimeDate)}</p>}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2 text-xs"
                      onClick={() => {
                        const key = pr.exerciseName === "custom" ? `custom:${pr.customLabel}` : pr.exerciseName;
                        setSelectedExercise(key === selectedExercise ? null : key);
                      }}
                      data-testid={`button-view-progression-${pr.exerciseName}`}
                    >
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {selectedExercise === (pr.exerciseName === "custom" ? `custom:${pr.customLabel}` : pr.exerciseName) ? "Hide" : "View"} Progression
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedExercise && (
        <Card data-testid="card-exercise-progression">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle>
                Exercise Progression
              </CardTitle>
            </div>
            <CardDescription>
              {availableExercises.find(e => e.value === selectedExercise)?.label || selectedExercise}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !analyticsData || analyticsData.data.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">No data available for this exercise yet.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {analyticsData.data.some(d => d.totalVolume > 0) && (
                  <MiniBarChart data={analyticsData.data} valueKey="totalVolume" color="bg-primary/60" label={`Volume (reps x ${weightLabel})`} />
                )}
                {analyticsData.data.some(d => d.maxWeight > 0) && (
                  <MiniBarChart data={analyticsData.data} valueKey="maxWeight" color="bg-purple-500/60" label={`Max Weight (${weightLabel})`} />
                )}
                {analyticsData.data.some(d => d.totalReps > 0) && (
                  <MiniBarChart data={analyticsData.data} valueKey="totalReps" color="bg-blue-500/60" label="Total Reps" />
                )}
                {analyticsData.data.some(d => d.totalDistance > 0) && (
                  <MiniBarChart data={analyticsData.data} valueKey="totalDistance" color="bg-green-500/60" label={`Total Distance (${dLabel})`} />
                )}
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground font-medium mb-2">Summary</p>
                  <div className="flex gap-4 flex-wrap">
                    <div className="text-center">
                      <p className="text-lg font-semibold" data-testid="text-total-sessions">{analyticsData.data.length}</p>
                      <p className="text-xs text-muted-foreground">Sessions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold" data-testid="text-total-sets">
                        {analyticsData.data.reduce((a, d) => a + d.totalSets, 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">Total Sets</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold" data-testid="text-total-reps">
                        {analyticsData.data.reduce((a, d) => a + d.totalReps, 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">Total Reps</p>
                    </div>
                    {analyticsData.data.some(d => d.totalVolume > 0) && (
                      <div className="text-center">
                        <p className="text-lg font-semibold" data-testid="text-total-volume">
                          {Math.round(analyticsData.data.reduce((a, d) => a + d.totalVolume, 0)).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Total Volume ({weightLabel})</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
