import React from "react";
import { Badge } from "@/components/ui/badge";
import { categoryChipColors, formatExerciseSummary } from "@/lib/exerciseUtils";
import { WorkoutDetailStravaMetrics } from "./WorkoutDetailStravaMetrics";
import type { WorkoutDetailViewProps } from "./types";

export const WorkoutDetailView = React.memo(function WorkoutDetailView({
  entry,
  grouped,
  hasStructuredData,
  weightLabel,
  distanceUnit,
}: Readonly<WorkoutDetailViewProps>) {
  return (
    <div className="space-y-3">
      {hasStructuredData ? (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="detail-exercise-chips"
        >
          {grouped.map((group, idx) => (
            <Badge
              key={`${group.exerciseName}-${idx}`}
              variant="secondary"
              className={`text-xs font-normal ${categoryChipColors[group.category] || ""}`}
            >
              {formatExerciseSummary(group, weightLabel, distanceUnit)}
            </Badge>
          ))}
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
        </div>
      )}
      {entry.accessory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">
            Accessory
          </p>
          <p className="text-sm text-muted-foreground/70">{entry.accessory}</p>
        </div>
      )}
      {entry.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground/70 mb-1">
            Notes
          </p>
          <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
        </div>
      )}
      {entry.duration && entry.source !== "strava" && (
        <p className="text-xs text-muted-foreground">
          Duration: {entry.duration} min
          {entry.rpe && ` | RPE: ${entry.rpe}`}
        </p>
      )}
      <WorkoutDetailStravaMetrics entry={entry} distanceUnit={distanceUnit} />
    </div>
  );
});
