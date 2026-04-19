import type { ExerciseSet, TimelineEntry, WorkoutStatus } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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
  /**
   * Called from the ⋮ menu → Mark as planned/skipped/missed/completed.
   * The dialog filters out the current status so this is always a
   * transition. Requires entry.planDayId — the underlying mutation
   * writes to plan_days, so ad-hoc logged workouts don't get the menu.
   */
  readonly onChangeStatus?: (entry: TimelineEntry, status: WorkoutStatus) => void;
  /**
   * Primary CTA for planned entries. Creates a new workoutLog seeded from
   * the plan day's prescribed exerciseSets (or free text) — the Timeline
   * closes the dialog on the mutation's onSuccess so the user sees the
   * newly-logged workout in their list.
   */
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
  /**
   * ⋮ menu → Combine workouts. Parent closes the detail dialog and opens
   * the combine picker; only surfaces on logged workouts (no second
   * workout to merge with when nothing's logged yet).
   */
  readonly onCombine?: (entry: TimelineEntry) => void;
  readonly weightUnit?: "kg" | "lb";
}

/**
 * V2 workout detail dialog. Renders both states:
 *   - **Logged**: structured exercise table with inline edit, stats row,
 *     athlete note, coach take + history sidebar.
 *   - **Planned** (entry.workoutLogId == null): a "Mark complete" primary
 *     CTA that turns the plan day into a workoutLog (with prescribed
 *     sets copied across by the phase-6 server path), plus the coach's
 *     prescription and coach take — no stats/history/athlete-note since
 *     there's no log to measure or annotate yet.
 */
export function WorkoutDetailDialogV2({
  entry,
  onClose,
  onAskCoach,
  onDelete,
  onChangeStatus,
  onMarkComplete,
  onCombine,
  weightUnit = "kg",
}: WorkoutDetailDialogV2Props) {
  const workoutId = entry?.workoutLogId ?? null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const {
    workout,
    history,
    isLoading,
    isHydrating,
    updateSet,
    addSet,
    deleteSet,
    seedFromPlan,
    reparseFreeText,
    updateNote,
  } = useWorkoutDetail(workoutId);

  // Hydration pipeline for workouts that open with no structured sets:
  //   1. If the workout is linked to a plan day, call /seed-from-plan
  //      first. On a plan generated after #834 shipped it copies the
  //      prescribed rows; on a legacy plan day it's a no-op.
  //   2. Once that settles and the workout still has no sets AND the
  //      free-text prescription has content, call /reparse so Gemini
  //      parses `mainWorkout + accessory` into structured rows.
  //   3. If the workout has no plan day at all (ad-hoc logged workout),
  //      skip step 1 and go straight to step 2.
  // Each attempt fires at most once per workoutId — seed/reparse are
  // safe to retry but if either fails we don't want to loop on a 5xx,
  // and if reparse returned zero exercises we don't want to burn
  // another Gemini call on re-render.
  const seedAttemptedRef = useRef<string | null>(null);
  const reparseAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!workoutId || isLoading || !workout) return;
    const hasSets = (workout.exerciseSets?.length ?? 0) > 0;
    if (hasSets) return;

    const hasFreeText = hasMeaningfulText(entry?.mainWorkout) || hasMeaningfulText(entry?.accessory);

    // Step 1: seed-from-plan (only if the workout has a plan day link).
    if (workout.planDayId && seedAttemptedRef.current !== workoutId && !seedFromPlan.isPending) {
      seedAttemptedRef.current = workoutId;
      seedFromPlan.mutate(undefined, {
        // Chain reparse only AFTER the seed call finishes, whether it
        // succeeded or not, to avoid two in-flight Gemini calls at once.
        onSettled: () => {
          if (reparseAttemptedRef.current === workoutId) return;
          if (!hasFreeText) return;
          reparseAttemptedRef.current = workoutId;
          reparseFreeText.mutate();
        },
      });
      return;
    }

    // Step 2 (direct): no plan day — go straight to reparse.
    if (!workout.planDayId && reparseAttemptedRef.current !== workoutId && !reparseFreeText.isPending) {
      if (!hasFreeText) return;
      reparseAttemptedRef.current = workoutId;
      reparseFreeText.mutate();
    }
  }, [workoutId, workout, isLoading, entry?.mainWorkout, entry?.accessory, seedFromPlan, reparseFreeText]);

  if (!entry) return null;

  const exerciseSets = workout?.exerciseSets ?? [];
  // Planned-state = this entry has never been logged. We render a
  // slimmer layout focused on the "Mark complete" primary action; the
  // stats/history/athlete-note sections only make sense once there's a
  // workoutLog to back them.
  const isPlanned = !workoutId;

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
            onChangeStatus={onChangeStatus ? (status) => onChangeStatus(entry, status) : undefined}
            onCombine={!isPlanned && onCombine ? () => onCombine(entry) : undefined}
          />
          {!isPlanned && workout && <WorkoutStatsRow workout={workout} exerciseSets={exerciseSets} />}
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            {isPlanned ? (
              <PlannedCallToAction entry={entry} onMarkComplete={onMarkComplete} />
            ) : (
              <>
                {isHydrating && exerciseSets.length === 0 && (
                  <div
                    className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                    data-testid="workout-detail-hydrating"
                  >
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Parsing coach's prescription…
                  </div>
                )}
                {workoutId && (
                  <ExerciseTable
                    workoutId={workoutId}
                    exerciseSets={exerciseSets}
                    weightUnit={weightUnit}
                    onUpdateSet={(setId, data) => updateSet.mutate({ setId, data })}
                    onAddSet={(data) => addSet.mutate(data)}
                    onDeleteSet={(setId) => deleteSet.mutate(setId)}
                  />
                )}
              </>
            )}

            <CoachPrescriptionCollapsible
              mainWorkout={entry.mainWorkout}
              accessory={entry.accessory}
              notes={entry.notes}
              defaultOpen={isPlanned}
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
            {!isPlanned && <HistoryPanel stats={history} isLoading={isLoading} />}
          </aside>
        </div>

        {!isPlanned && (
          <div className="border-t border-border px-6 py-4">
            <AthleteNoteInput
              value={workout?.notes}
              onSave={(note) => workoutId && updateNote.mutate(note)}
              disabled={!workoutId}
            />
          </div>
        )}
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
interface PlannedCallToActionProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
}

function PlannedCallToAction({ entry, onMarkComplete }: Readonly<PlannedCallToActionProps>) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-4 py-5 text-center"
      data-testid="workout-detail-planned-cta"
    >
      <p className="text-sm text-muted-foreground">
        This workout hasn't been logged yet. Mark it complete to copy the coach's
        prescription into an editable log.
      </p>
      {onMarkComplete && (
        <div className="flex justify-center">
          <Button
            onClick={() => onMarkComplete(entry)}
            size="lg"
            className="gap-2"
            data-testid="workout-detail-mark-complete"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            Mark complete
          </Button>
        </div>
      )}
    </div>
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function hasMeaningfulText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
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
