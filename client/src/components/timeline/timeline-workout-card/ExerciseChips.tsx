import { Badge } from "@/components/ui/badge";
import { Trophy, HelpCircle } from "lucide-react";
import { categoryChipColors, formatExerciseSummary } from "@/lib/exerciseUtils";
import { hasPRInWorkout } from "./utils";
import type { ExerciseChipsProps } from "./types";

export function ExerciseChips({
  entryId,
  groupedExercises,
  workoutLogId,
  personalRecords,
  weightLabel,
  distanceUnit,
}: Readonly<ExerciseChipsProps>) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-1" data-testid={`exercise-chips-${entryId}`}>
      {groupedExercises.map((group, idx) => {
        const isCustom = group.exerciseName === "custom";
        const isPR = hasPRInWorkout(group, workoutLogId, personalRecords);
        const conf = group.confidence;
        const showConfidence = conf != null && conf < 90;
        let confColor = "";
        if (conf != null) {
          if (conf >= 80) {
            confColor = "text-green-500";
          } else if (conf >= 60) {
            confColor = "text-yellow-500";
          } else {
            confColor = "text-red-500";
          }
        }
        const summaryText = formatExerciseSummary(group, weightLabel, distanceUnit);
        return (
          <Badge
            key={`${group.exerciseName}-${idx}`}
            variant="secondary"
            className={`text-xs font-normal max-w-full truncate ${categoryChipColors[group.category] || ""} ${isPR ? "ring-1 ring-yellow-500/50" : ""}`}
            data-testid={isPR ? `badge-pr-${entryId}-${idx}` : `badge-exercise-${entryId}-${idx}`}
            title={summaryText}
          >
            {isPR && <Trophy className="h-3 w-3 mr-0.5 text-yellow-500" />}
            {summaryText}
            {showConfidence && (
              <span className={`ml-1 text-[10px] font-medium ${confColor}`} data-testid={`confidence-score-${entryId}-${idx}`}>
                {conf}%
              </span>
            )}
            {isCustom && <HelpCircle className="h-3 w-3 ml-0.5 text-muted-foreground/60" />}
          </Badge>
        );
      })}
    </div>
  );
}
