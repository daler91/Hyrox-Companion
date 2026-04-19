import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { groupExerciseSets } from "@/lib/exerciseUtils";

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
  /**
   * Called when the user clicks "Ask coach". Receives a pre-built message
   * summarising the current workout so the parent can open CoachPanel with
   * that text seeded into the input. The parent decides how the message
   * gets to the chat (see Timeline.tsx's coach seed wiring).
   */
  readonly onAskCoach?: (seedMessage: string) => void;
  /** Called from the ⋮ menu → Delete. Parent is responsible for the confirm UX. */
  readonly onDelete?: (entry: TimelineEntry) => void;
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
  onDelete,
  weightUnit = "kg",
}: WorkoutDetailDialogV2Props) {
  const workoutId = entry?.workoutLogId ?? null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
          <WorkoutDetailHeaderV2
            entry={entry}
            onClose={onClose}
            onDelete={onDelete ? () => setConfirmingDelete(true) : undefined}
          />
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
            <CoachTakePanel
              rationale={entry.aiRationale}
              onAskCoach={
                onAskCoach
                  ? () => onAskCoach(buildCoachSeedMessage(entry, exerciseSets))
                  : undefined
              }
            />
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

      {/* Explicit confirm step before firing onDelete — the v2 menu's ⋮ is
          close to the close button, and a single mis-click shouldn't destroy
          a logged workout. Matches the legacy dialog's DeleteConfirmDialog
          guard. */}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the logged workout and all of its exercise sets. You can't undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (onDelete) onDelete(entry);
                setConfirmingDelete(false);
              }}
              data-testid="workout-detail-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * Build the prefill text the coach chat input gets when the user clicks
 * "Ask coach" on this workout. Short + concrete so the user can either
 * send it as-is or edit before submitting. The coach service already has
 * the full training context via the standard RAG pipeline, so this only
 * needs to point the conversation at the specific workout.
 */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildCoachSeedMessage(entry: TimelineEntry, sets: ExerciseSet[]): string {
  const focus = entry.focus?.trim() || "this workout";
  const dateLabel = formatCoachDate(entry.date);
  const groups = groupExerciseSets(sets);
  const exerciseCount = groups.length;
  const setCount = sets.length;

  let stats = "";
  if (exerciseCount > 0) {
    const exerciseLabel = pluralize(exerciseCount, "exercise", "exercises");
    const setLabel = pluralize(setCount, "set", "sets");
    stats = ` (${exerciseCount} ${exerciseLabel}, ${setCount} ${setLabel})`;
  }

  return `Help me think about my ${focus} workout on ${dateLabel}${stats}. What would you adjust?`;
}

function formatCoachDate(iso: string): string {
  try {
    return format(parseISO(iso), "EEE MMM d");
  } catch {
    return iso;
  }
}
