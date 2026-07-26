import type { TimelineEntry } from "@shared/schema";

import { ExerciseChips } from "@/components/timeline/timeline-workout-card/ExerciseChips";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { serializeWorkoutStructure } from "@/lib/workoutStructureSummary";

interface WorkoutPrescriptionSummaryProps {
  readonly entry: TimelineEntry;
}

/**
 * Shared "what was prescribed?" block used by the read-only workout
 * surfaces (PreviewSheet/SkippedSheet via ReadOnlyWorkoutDetailSheet,
 * LogSheet's no-plan fallback). Renders:
 *  - Prescribed exercises (chips when structured, plain text fallback)
 *  - Accessory line if any
 *
 * The coach rationale is NOT rendered here — surfaces show it in their
 * own CoachRationaleSection card so it sits consistently next to this
 * block. Kept presentation-only — actions and primary CTAs stay on each
 * surface since they differ by intent.
 */
export function WorkoutPrescriptionSummary({ entry }: WorkoutPrescriptionSummaryProps) {
  const { distanceUnit, weightLabel } = useUnitPreferences();

  const groupedExercises = entry.exerciseSets && entry.exerciseSets.length > 0
    ? groupExerciseSets(entry.exerciseSets)
    : [];

  const hasStructuredPrescription = groupedExercises.length > 0;
  const structuredText = serializeWorkoutStructure(entry.exerciseSets);
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
          {structuredText ? (
            <details className="mt-2">
              <summary className="cursor-pointer rounded-sm text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Full prescription</summary>
              <p className="mt-1 text-sm text-muted-foreground">{structuredText}</p>
            </details>
          ) : null}
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
    </div>
  );
}
