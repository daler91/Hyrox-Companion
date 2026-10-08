import { HelpCircle,Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { categoryChipColors, formatExerciseSummary } from "@/lib/exerciseUtils";

import type { ExerciseChipsProps } from "./types";
import { hasPRInWorkout } from "./utils";

/**
 * The parse-confidence colour. Raw green/yellow/red-500 read at about 1.9:1
 * to 3.5:1 on the chip in light mode, which hid the low-confidence signal
 * on AI-parsed exercises; success and warning are the tuned AA tokens, and
 * red-700 / red-400 clear AA where the destructive token does not.
 * U21 (CODEBASE_ANALYSIS_2026-10-03)
 */
function confidenceColor(conf: number): string {
  if (conf >= 80) return "text-success";
  if (conf >= 60) return "text-warning";
  return "text-red-700 dark:text-red-400";
}

export function ExerciseChips({
  entryId,
  groupedExercises,
  workoutLogId,
  personalRecords,
  weightLabel,
  distanceUnit,
}: Readonly<ExerciseChipsProps>) {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1.5 mb-1" data-testid={`exercise-chips-${entryId}`}>
        {groupedExercises.map((group, idx) => {
          const isCustom = group.exerciseName === "custom";
          const isPR = hasPRInWorkout(group, workoutLogId, personalRecords);
          const conf = group.confidence;
          const showConfidence = conf != null && conf < 90;
          const confColor = conf == null ? "" : confidenceColor(conf);
          const summaryText = formatExerciseSummary(group, weightLabel, distanceUnit);
          return (
            <Tooltip key={`${group.exerciseName}-${idx}`}>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className={`text-xs font-normal max-w-full truncate ${categoryChipColors[group.category] || ""} ${isPR ? "ring-1 ring-yellow-500/50" : ""}`}
                  data-testid={isPR ? `badge-pr-${entryId}-${idx}` : `badge-exercise-${entryId}-${idx}`}
                >
                  {isPR && <Trophy className="h-3 w-3 mr-0.5 text-yellow-500" aria-hidden="true" />}
                  {summaryText}
                  {showConfidence && (
                    <span className={`ml-1 text-[10px] font-medium ${confColor}`} data-testid={`confidence-score-${entryId}-${idx}`}>
                      {conf}%
                    </span>
                  )}
                  {isCustom && <HelpCircle className="h-3 w-3 ml-0.5 text-muted-foreground/60" aria-hidden="true" />}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{summaryText}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
