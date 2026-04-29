import type { TimelineEntry } from "@shared/schema";
import { Sparkles } from "lucide-react";

import { ExerciseChips } from "@/components/timeline/timeline-workout-card/ExerciseChips";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";

interface WorkoutPrescriptionSummaryProps {
  readonly entry: TimelineEntry;
  /** "open" renders the rationale always-visible (preview); "collapsed"
   *  hides it behind a details/summary disclosure (log sheet). */
  readonly rationaleVariant?: "open" | "collapsed";
}

/**
 * Shared "what was prescribed?" block used by every workout-detail surface
 * (PreviewSheet, LogSheet, and the upcoming ReviewSurface). Renders:
 *  - Prescribed exercises (chips when structured, plain text fallback)
 *  - Accessory line if any
 *  - Coach rationale if any (open/collapsed per variant)
 *
 * Kept presentation-only — actions and primary CTAs stay on each surface
 * since they differ by intent.
 */
export function WorkoutPrescriptionSummary({
  entry,
  rationaleVariant = "open",
}: WorkoutPrescriptionSummaryProps) {
  const { distanceUnit, weightLabel } = useUnitPreferences();

  const groupedExercises = entry.exerciseSets && entry.exerciseSets.length > 0
    ? groupExerciseSets(entry.exerciseSets)
    : [];

  const hasStructuredPrescription = groupedExercises.length > 0;
  const hasMainWorkout = !hasStructuredPrescription && Boolean(entry.mainWorkout);

  return (
    <div className="space-y-4">
      {hasStructuredPrescription ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prescribed
          </p>
          <ExerciseChips
            entryId={entry.id}
            groupedExercises={groupedExercises}
            workoutLogId={undefined}
            weightLabel={weightLabel}
            distanceUnit={distanceUnit}
          />
        </div>
      ) : null}

      {hasMainWorkout ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prescribed
          </p>
          <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
        </div>
      ) : null}

      {entry.accessory ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Accessory
          </p>
          <p className="text-sm text-muted-foreground">{entry.accessory}</p>
        </div>
      ) : null}

      {entry.aiRationale && rationaleVariant === "open" ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Coach rationale
          </p>
          <p className="text-sm text-foreground/80">{entry.aiRationale}</p>
        </div>
      ) : null}

      {entry.aiRationale && rationaleVariant === "collapsed" ? (
        <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
            Why this workout
          </summary>
          <p className="mt-2 text-sm text-foreground/80">{entry.aiRationale}</p>
        </details>
      ) : null}
    </div>
  );
}
