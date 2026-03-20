import React from "react";
import { Flame, Zap, Activity, TrendingUp } from "lucide-react";
import { formatSpeed } from "@shared/unitConversion";
import type { WorkoutDetailStravaMetricsProps } from "./types";

export const WorkoutDetailStravaMetrics = React.memo(
  function WorkoutDetailStravaMetrics({
    entry,
    distanceUnit,
  }: Readonly<WorkoutDetailStravaMetricsProps>) {
    if (
      entry.source !== "strava" ||
      (!entry.calories &&
        !entry.avgWatts &&
        !entry.sufferScore &&
        !entry.avgCadence &&
        !entry.avgSpeed)
    ) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-3 pt-2 border-t border-border/50">
        {entry.calories && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Flame className="h-3 w-3 text-orange-500" />
            <span>{entry.calories} cal</span>
          </div>
        )}
        {entry.avgWatts && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span>{entry.avgWatts}W</span>
          </div>
        )}
        {entry.avgCadence && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Activity className="h-3 w-3 text-blue-500" />
            <span>{Math.round(entry.avgCadence)} spm</span>
          </div>
        )}
        {entry.avgSpeed && entry.avgSpeed > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
          </div>
        )}
        {entry.sufferScore && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3 text-purple-500" />
            <span>Effort: {entry.sufferScore}</span>
          </div>
        )}
      </div>
    );
  },
);
