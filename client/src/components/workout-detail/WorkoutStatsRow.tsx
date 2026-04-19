import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { useMemo } from "react";

interface WorkoutStatsRowProps {
  readonly workout: WorkoutLog;
  readonly exerciseSets: ExerciseSet[];
}

/**
 * Four-column strip below the dialog header showing duration / exercises /
 * RPE / volume. Derivations are client-side so the server never has to
 * denormalise these counts — cheap aggregates over the already-loaded
 * exerciseSets array.
 */
export function WorkoutStatsRow({ workout, exerciseSets }: WorkoutStatsRowProps) {
  const stats = useMemo(() => {
    const uniqueExercises = new Set<string>();
    for (const s of exerciseSets) {
      const key = s.exerciseName === "custom" && s.customLabel
        ? `custom:${s.customLabel}`
        : s.exerciseName;
      uniqueExercises.add(key);
    }
    return {
      exerciseCount: uniqueExercises.size,
      setCount: exerciseSets.length,
    };
  }, [exerciseSets]);

  return (
    <div
      className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4"
      data-testid="workout-stats-row"
    >
      <StatCell label="Duration" value={workout.duration} unit="min" />
      <StatCell label="Exercises" value={stats.exerciseCount} />
      <StatCell label="RPE" value={workout.rpe} />
      <StatCell label="Volume" value={stats.setCount} unit={stats.setCount === 1 ? "set" : "sets"} />
    </div>
  );
}

function StatCell({ label, value, unit }: { label: string; value: number | null | undefined; unit?: string }) {
  const displayValue = value == null ? "—" : String(value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{displayValue}</span>
        {unit && value != null && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
