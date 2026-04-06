import { formatSpeed } from "@shared/unitConversion";
import { Activity, Flame, TrendingUp,Zap } from "lucide-react";

import type { WorkoutStravaStatsProps } from "./types";

export function WorkoutStravaStats({ entry, distanceUnit }: Readonly<WorkoutStravaStatsProps>) {
  if (entry.source !== "strava") return null;

  const hasStravaStats =
    entry.calories ||
    entry.avgWatts ||
    entry.sufferScore ||
    entry.avgCadence ||
    entry.avgSpeed;

  if (!hasStravaStats) return null;

  return (
    <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/50">
      {entry.calories && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-calories-${entry.id}`}>
          <Flame className="h-3 w-3 text-orange-500" />
          <span>{entry.calories} cal</span>
        </div>
      )}
      {entry.avgWatts && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-power-${entry.id}`}>
          <Zap className="h-3 w-3 text-yellow-500" />
          <span>{entry.avgWatts}W</span>
        </div>
      )}
      {entry.avgCadence && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-cadence-${entry.id}`}>
          <Activity className="h-3 w-3 text-blue-500" />
          <span>{Math.round(entry.avgCadence)} spm</span>
        </div>
      )}
      {entry.avgSpeed && entry.avgSpeed > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-speed-${entry.id}`}>
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
        </div>
      )}
      {entry.sufferScore && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-effort-${entry.id}`}>
          <TrendingUp className="h-3 w-3 text-purple-500" />
          <span>Effort: {entry.sufferScore}</span>
        </div>
      )}
    </div>
  );
}
