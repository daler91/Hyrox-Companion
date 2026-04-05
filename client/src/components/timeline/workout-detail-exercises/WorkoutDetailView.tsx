import React from "react";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import {
  categoryBorderColors,
  formatExerciseSummary,
  getExerciseLabel,
  type GroupedExercise,
} from "@/lib/exerciseUtils";
import { exerciseIcons } from "@/lib/exerciseIcons";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { cn } from "@/lib/utils";
import { WorkoutDetailStravaMetrics } from "./WorkoutDetailStravaMetrics";
import type { WorkoutDetailViewProps } from "./types";

function SummaryRow({
  group,
  weightLabel,
  distanceUnit,
}: {
  readonly group: GroupedExercise;
  readonly weightLabel: string;
  readonly distanceUnit: "km" | "miles";
}) {
  const isKnown = group.exerciseName in EXERCISE_DEFINITIONS;
  const def = isKnown
    ? EXERCISE_DEFINITIONS[group.exerciseName as ExerciseName]
    : undefined;
  const Icon = isKnown
    ? exerciseIcons[group.exerciseName as ExerciseName] || Plus
    : Plus;
  const label = getExerciseLabel(group.exerciseName, group.customLabel);
  const summary = formatExerciseSummary(group, weightLabel, distanceUnit);
  // Strip the leading "{label} " so we can render the summary separately.
  const summaryTail = summary.startsWith(label)
    ? summary.slice(label.length).trim()
    : summary;
  const muscleGroups = (def?.muscleGroups ?? []) as readonly string[];
  const borderColor = categoryBorderColors[group.category];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3",
        borderColor && `border-l-4 ${borderColor}`,
      )}
      data-testid={`detail-exercise-row-${group.exerciseName}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-foreground">{label}</div>
        {summaryTail && (
          <div className="text-xs text-muted-foreground truncate">{summaryTail}</div>
        )}
      </div>
      {muscleGroups.length > 0 && (
        <div className="hidden sm:flex items-center gap-1.5">
          {muscleGroups.slice(0, 2).map((mg) => (
            <Badge
              key={mg}
              variant="secondary"
              className="bg-muted/80 text-muted-foreground font-medium"
            >
              {mg}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

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
        <div className="space-y-2" data-testid="detail-exercise-rows">
          {grouped.map((group, idx) => (
            <SummaryRow
              key={`${group.exerciseName}-${idx}`}
              group={group}
              weightLabel={weightLabel}
              distanceUnit={distanceUnit}
            />
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
      {(entry.duration || entry.rpe) && entry.source !== "strava" && (
        <p className="text-xs text-muted-foreground">
          {[
            entry.duration ? `Duration: ${entry.duration} min` : null,
            entry.rpe ? `RPE: ${entry.rpe}` : null,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      )}
      <WorkoutDetailStravaMetrics entry={entry} distanceUnit={distanceUnit} />
    </div>
  );
});
