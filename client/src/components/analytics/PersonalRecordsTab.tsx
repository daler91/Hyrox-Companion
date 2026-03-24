import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, Dumbbell, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { PersonalRecordItem } from "./PersonalRecordItem";
import { api } from "@/lib/api";

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
                  No personal records yet. Log workouts with structured exercise data to see your
                  PRs here.
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
                <PersonalRecordItem
                  key={`${pr.exerciseName}-${pr.customLabel || ""}`}
                  pr={pr}
                  weightLabel={weightLabel}
                  dLabel={dLabel}
                />
              ))}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
