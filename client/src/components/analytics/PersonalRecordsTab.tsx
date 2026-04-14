import { useQuery } from "@tanstack/react-query";
import { Dumbbell, Loader2, Sparkles,Trophy } from "lucide-react";
import { useMemo,useState } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription,CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { api } from "@/lib/api";

import { PersonalRecordItem } from "./PersonalRecordItem";

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

interface PersonalRecordsTabProps {
  readonly dateParams: string;
}

export function PersonalRecordsTab({ dateParams }: PersonalRecordsTabProps) {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const dLabel = distanceUnit === "km" ? "m" : "ft";

  const { data: rawPRs, isLoading } = useQuery<Record<string, RawPREntry>>({
    queryKey: ["/api/v1/personal-records", dateParams],
    queryFn: () => api.analytics.getPersonalRecords(dateParams),
    // ⚡ Perf: kill rapid tab-toggle refetches but auto-heal after 5 min if
    // an ingestion flow forgets to invalidate QUERY_KEYS.personalRecords.
    // (CODEBASE_REVIEW_2026-04-12.md #27; belt-and-braces with mutation-side
    // invalidations in useStrava/Garmin/Combine/DataTools.)
    staleTime: 5 * 60 * 1000,
  });

  const { filteredPRs, recentPRs } = useMemo(() => {
    if (!rawPRs) return { filteredPRs: [], recentPRs: [] };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

    const results = [];
    const recent = [];

    for (const [exerciseName, pr] of Object.entries(rawPRs)) {
      const mapped = {
        exerciseName,
        customLabel: pr.customLabel,
        category: pr.category,
        maxWeight: pr.maxWeight?.value ?? null,
        maxWeightDate: pr.maxWeight?.date ?? null,
        maxDistance: pr.maxDistance?.value ?? null,
        maxDistanceDate: pr.maxDistance?.date ?? null,
        bestTime: pr.bestTime?.value ?? null,
        bestTimeDate: pr.bestTime?.date ?? null,
      };

      if (categoryFilter !== "all" && pr.category !== categoryFilter) {
        continue;
      }
      results.push(mapped);

      // Check if any PR date is within last 30 days
      const hasRecentPR =
        (pr.maxWeight?.date && pr.maxWeight.date >= cutoff) ||
        (pr.maxDistance?.date && pr.maxDistance.date >= cutoff) ||
        (pr.bestTime?.date && pr.bestTime.date >= cutoff);

      if (hasRecentPR) {
        recent.push(mapped);
      }
    }
    return { filteredPRs: results, recentPRs: recent };
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
              <SelectTrigger className="w-40" data-testid="select-pr-category" aria-label="Select personal record category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="functional">Functional</SelectItem>
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
            <div className="space-y-4">
              {recentPRs.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Recent PRs (last 30 days)</p>
                  </div>
                  <div className="divide-y border rounded-lg overflow-hidden border-amber-500/30 bg-amber-500/5">
                    {recentPRs.map((pr) => (
                      <PersonalRecordItem
                        key={`recent-${pr.exerciseName}-${pr.customLabel ?? ""}`}
                        pr={pr}
                        weightLabel={weightLabel}
                        dLabel={dLabel}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="divide-y border rounded-lg overflow-hidden">
                {filteredPRs.map((pr) => (
                  <PersonalRecordItem
                    key={`${pr.exerciseName}-${pr.customLabel ?? ""}`}
                    pr={pr}
                    weightLabel={weightLabel}
                    dLabel={dLabel}
                  />
                ))}
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
