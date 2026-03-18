import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, Dumbbell, Weight, Ruler, Timer, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categoryChipColors, categoryLabels, getExerciseLabel } from "@/lib/exerciseUtils";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";

interface PRValue {
  value: number;
  date: string;
  workoutLogId: string;
}

interface RawPREntry {
  maxWeight?: PRValue;
  maxDistance?: PRValue;
  bestTime?: PRValue;
  category: string;
  customLabel?: string | null;
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface PersonalRecordsTabProps {
  readonly dateParams: string;
}

export function PersonalRecordsTab({ dateParams }: PersonalRecordsTabProps) {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  const { data: rawPRs, isLoading } = useQuery<Record<string, RawPREntry>>({
    queryKey: ["/api/v1/personal-records", dateParams],
    queryFn: () => fetch(`/api/v1/personal-records${dateParams}`).then(r => r.json()),
  });

  const filteredPRs = useMemo(() => {
    if (!rawPRs) return [];

    // ⚡ Bolt Performance Optimization:
    // Combine mapping and filtering into a single O(N) array traversal
    // instead of creating an intermediate array and filtering it again.
    const results = [];
    for (const [exerciseName, pr] of Object.entries(rawPRs)) {
      if (categoryFilter !== "all" && pr.category !== categoryFilter) {
        continue;
      }
      results.push({
        exerciseName,
        customLabel: pr.customLabel,
        category: pr.category,
        maxWeight: pr.maxWeight?.value ?? null,
        maxWeightDate: pr.maxWeight?.date ?? null,
        maxDistance: pr.maxDistance?.value ?? null,
        maxDistanceDate: pr.maxDistance?.date ?? null,
        bestTime: pr.bestTime?.value ?? null,
        bestTimeDate: pr.bestTime?.date ?? null,
      });
    }
    return results;
  }, [rawPRs, categoryFilter]);

  return (
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
  );
}
