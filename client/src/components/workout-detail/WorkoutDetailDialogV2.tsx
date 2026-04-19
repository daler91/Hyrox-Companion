import type { TimelineEntry } from "@shared/schema";
import { useEffect, useRef } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { CoachPrescriptionCollapsible } from "./CoachPrescriptionCollapsible";
import { CoachTakePanel } from "./CoachTakePanel";
import { ExerciseTable } from "./ExerciseTable";
import { HistoryPanel } from "./HistoryPanel";
import { WorkoutDetailHeaderV2 } from "./WorkoutDetailHeaderV2";
import { WorkoutStatsRow } from "./WorkoutStatsRow";

interface WorkoutDetailDialogV2Props {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: () => void;
  readonly weightUnit?: "kg" | "lb";
}

/**
 * V2 workout detail dialog. Opens from the Timeline when a logged workout
 * is clicked; renders a wide landscape layout with an always-editable
 * structured exercise table plus a sidebar (coach take + history) and a
 * collapsible free-text prescription as a fallback.
 *
 * Currently only handles logged workouts (entry.workoutLogId != null); a
 * planned-day rendering mode is deferred to phase 6 when we wire the
 * "log this planned day" flow. The legacy dialog still handles planned
 * entries so we don't block the common click-a-logged-workout flow.
 */
export function WorkoutDetailDialogV2({
  entry,
  onClose,
  onAskCoach,
  weightUnit = "kg",
}: WorkoutDetailDialogV2Props) {
  const workoutId = entry?.workoutLogId ?? null;
  const {
    workout,
    history,
    isLoading,
    updateSet,
    addSet,
    deleteSet,
    seedFromPlan,
    updateNote,
  } = useWorkoutDetail(workoutId);

  // Lazy seed: if the workout is linked to a plan day but has no sets yet
  // (legacy rows from before structured plan generation shipped), copy the
  // prescribed sets across on first open. The server-side mutation is
  // idempotent — see seedExerciseSetsFromPlanDay in
  // server/storage/workouts.ts — so a retry after an error would still be
  // safe, but we deliberately attempt at most once per workoutId to avoid
  // looping on a 5xx: on failure `isSuccess` stays false forever and the
  // effect would re-fire on every re-render. The ref is keyed by the
  // workout being viewed so reopening the dialog on a different workout
  // still allows one fresh attempt.
  const seedAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!workoutId || isLoading || !workout) return;
    if (seedAttemptedRef.current === workoutId) return;
    const hasSets = (workout.exerciseSets?.length ?? 0) > 0;
    if (!hasSets && workout.planDayId) {
      seedAttemptedRef.current = workoutId;
      seedFromPlan.mutate();
    }
  }, [workoutId, workout, isLoading, seedFromPlan]);

  if (!entry) return null;

  const exerciseSets = workout?.exerciseSets ?? [];

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto p-0" data-testid="workout-detail-dialog-v2">
        {/* Radix requires a DialogTitle + Description for screen readers.
            The visible page title lives inside WorkoutDetailHeaderV2; this
            sr-only title describes the dialog itself, so screen readers
            announce "Workout details" before reading the focus + date. */}
        <DialogTitle className="sr-only">Workout details</DialogTitle>
        <DialogDescription className="sr-only">
          {(entry.focus || "Workout")} on {entry.date} — status {entry.status}.
        </DialogDescription>

        <div className="flex flex-col gap-4 px-6 pt-4">
          <WorkoutDetailHeaderV2 entry={entry} onClose={onClose} />
          {workout && <WorkoutStatsRow workout={workout} exerciseSets={exerciseSets} />}
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            {workoutId ? (
              <ExerciseTable
                workoutId={workoutId}
                exerciseSets={exerciseSets}
                weightUnit={weightUnit}
                onUpdateSet={(setId, data) => updateSet.mutate({ setId, data })}
                onAddSet={(data) => addSet.mutate(data)}
                onDeleteSet={(setId) => deleteSet.mutate(setId)}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                This workout hasn't been logged yet. Mark it complete to start logging sets.
              </div>
            )}

            <CoachPrescriptionCollapsible
              mainWorkout={entry.mainWorkout}
              accessory={entry.accessory}
              notes={entry.notes}
            />
          </div>

          <aside className="flex flex-col gap-3">
            <CoachTakePanel rationale={entry.aiRationale} onAskCoach={onAskCoach} />
            <HistoryPanel stats={history} isLoading={isLoading} />
          </aside>
        </div>

        <div className="border-t border-border px-6 py-4">
          <AthleteNoteInput
            value={workout?.notes}
            onSave={(note) => workoutId && updateNote.mutate(note)}
            disabled={!workoutId}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
