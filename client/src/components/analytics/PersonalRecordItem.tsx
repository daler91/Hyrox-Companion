import { Ruler, Timer, TrendingUp,Weight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { categoryChipColors, categoryLabels, getExerciseLabel } from "@/lib/exerciseUtils";

interface PersonalRecordItemProps {
  readonly pr: {
    exerciseName: string;
    customLabel?: string | null;
    category: string;
    maxWeight: number | null;
    maxWeightDate: string | null;
    maxDistance: number | null;
    maxDistanceDate: string | null;
    bestTime: number | null;
    bestTimeDate: string | null;
    estimated1RM: number | null;
    estimated1RMDate: string | null;
  };
  readonly weightLabel: string;
  readonly dLabel: string;
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PersonalRecordItem({ pr, weightLabel, dLabel }: PersonalRecordItemProps) {
  return (
    <div className="p-4 bg-card hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4" data-testid={`card-pr-${pr.exerciseName}`}>
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

        {pr.estimated1RM != null && (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-purple-500/10 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="font-bold tabular-nums" data-testid={`text-pr-e1rm-${pr.exerciseName}`}>
                {pr.estimated1RM}<span className="text-muted-foreground text-xs font-normal ml-0.5">{weightLabel} e1RM</span>
              </p>
              {pr.estimated1RMDate && <p className="text-[10px] text-muted-foreground">{formatDate(pr.estimated1RMDate)}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
