import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Trophy, TrendingUp, Dumbbell, Timer, Ruler, Weight, Activity } from "lucide-react";
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
    queryKey: ["/api/v1/personal-records", dateRange],
    queryFn: () => fetch(`/api/v1/personal-records${dateParams}`).then(r => r.json()),
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
    queryKey: ["/api/v1/exercise-analytics", dateRange],
    queryFn: () => fetch(`/api/v1/exercise-analytics${dateParams}`).then(r => r.json()),
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

    // ⚡ Bolt Performance Optimization:
    // Pre-calculate array aggregations (some, reduce) inside useMemo to avoid
    // multiple O(n) array traversals during every render. This improves render
    // performance significantly for users with extensive exercise histories.
    let hasVolume = false;
    let hasMaxWeight = false;
    let hasTotalReps = false;
    let hasTotalDistance = false;

    let totalSets = 0;
    let totalReps = 0;
    let totalVolume = 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
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

  const isLoading = prsLoading;
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
          <p className="text-muted-foreground">Personal records and exercise progression</p>
        </div>

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
      </div>

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="trends" data-testid="tab-trends">
            <Activity className="h-4 w-4 mr-2" />
            Trends & Progression
          </TabsTrigger>
          <TabsTrigger value="prs" data-testid="tab-prs">
            <Trophy className="h-4 w-4 mr-2" />
            Personal Records
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prs" className="space-y-6">
          <Card>
            <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <CardTitle>Personal Records</CardTitle>
            </div>
            <div className="flex items-center gap-2">
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
          {(() => {
            if (isLoading) {
              return (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              );
            }
            if (filteredPRs.length === 0) {
              return (
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
              );
            }
            return (
              <div className="divide-y border rounded-lg overflow-hidden">
                {filteredPRs.map((pr) => (
                  <div key={`${pr.exerciseName}-${pr.customLabel || ""}`} className="p-4 bg-card hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-testid={`card-pr-${pr.exerciseName}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{getExerciseLabel(pr.exerciseName, pr.customLabel)}</h3>
                        <Badge variant="secondary" className={`text-[10px] ${categoryChipColors[pr.category] || ""}`}>
                          {categoryLabels[pr.category] || pr.category}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 text-sm">
                      {pr.maxWeight != null && (
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Weight className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-bold tabular-nums" data-testid={`text-pr-weight-${pr.exerciseName}`}>
                              {pr.maxWeight}<span className="text-muted-foreground text-xs font-normal ml-0.5">{weightLabel}</span>
                            </p>
                            {pr.maxWeightDate && <p className="text-[10px] text-muted-foreground">{formatDate(pr.maxWeightDate)}</p>}
                          </div>
                        </div>
                      )}

                      {pr.maxDistance != null && (
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <Ruler className="h-4 w-4 text-blue-500" />
                          </div>
                          <div>
                            <p className="font-bold tabular-nums" data-testid={`text-pr-distance-${pr.exerciseName}`}>
                              {pr.maxDistance}<span className="text-muted-foreground text-xs font-normal ml-0.5">{dLabel}</span>
                            </p>
                            {pr.maxDistanceDate && <p className="text-[10px] text-muted-foreground">{formatDate(pr.maxDistanceDate)}</p>}
                          </div>
                        </div>
                      )}

                      {pr.bestTime != null && (
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Timer className="h-4 w-4 text-green-500" />
                          </div>
                          <div>
                            <p className="font-bold tabular-nums" data-testid={`text-pr-time-${pr.exerciseName}`}>
                              {pr.bestTime}<span className="text-muted-foreground text-xs font-normal ml-0.5">min</span>
                            </p>
                            {pr.bestTimeDate && <p className="text-[10px] text-muted-foreground">{formatDate(pr.bestTimeDate)}</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="trends" className="space-y-6">
        <Card data-testid="card-exercise-progression">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle>
                Exercise Progression
              </CardTitle>
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
      </TabsContent>
      </Tabs>
    </div>
  );
}
