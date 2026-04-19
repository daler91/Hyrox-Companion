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
   * When true, the Mark complete CTA shows a spinner and disables clicks.
   * The dialog stays mounted until the logWorkoutMutation resolves, so
   * without this the user can double-click and queue duplicate workouts.
   */
  readonly isMarkingComplete?: boolean;
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
  isMarkingComplete = false,
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

  useHydrateWorkoutDetail({
    workoutId,
    workout,
    isLoading,
    hasFreeText: hasMeaningfulText(entry?.mainWorkout) || hasMeaningfulText(entry?.accessory),
    seedFromPlan,
    reparseFreeText,
  });

  if (!entry) return null;

  const exerciseSets = workout?.exerciseSets ?? [];
  // Planned-state = this entry has never been logged. We render a
  // slimmer layout focused on the "Mark complete" primary action; the
  // stats/history/athlete-note sections only make sense once there's a
  // workoutLog to back them.
  const isPlanned = !workoutId;

  // Derive all conditional prop handlers up here so the JSX below stays
  // declarative. Each of these used to be an inline ternary in props,
  // which Sonar counts toward the component's cognitive complexity;
  // lifting them out keeps the main render readable without exceeding
  // the complexity ceiling.
  //
  // We also suppress every overflow-menu action while the mark-complete
  // logWorkoutMutation is in flight. Without this gate, the user could
  // click Mark complete (POST /workouts) and then immediately Skip /
  // Missed / Delete (PATCH plan_days.status or DELETE) from the same
  // dialog — the two requests race on the same plan day and can leave
  // a workoutLog with a conflicting plan_day status.
  const actionsLocked = isMarkingComplete;
  const handleMenuDelete = onDelete && !actionsLocked ? () => setConfirmingDelete(true) : undefined;
  const handleMenuChangeStatus = onChangeStatus && !actionsLocked
    ? (status: WorkoutStatus) => onChangeStatus(entry, status)
    : undefined;
  const handleMenuCombine = !isPlanned && onCombine && !actionsLocked
    ? () => onCombine(entry)
    : undefined;
  const handleAskCoach = onAskCoach
    ? () => onAskCoach(buildCoachSeedMessage(entry, exerciseSets))
    : undefined;
  const showStatsRow = !isPlanned && !!workout;

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
            onDelete={handleMenuDelete}
            onChangeStatus={handleMenuChangeStatus}
            onCombine={handleMenuCombine}
          />
          {showStatsRow && workout && <WorkoutStatsRow workout={workout} exerciseSets={exerciseSets} />}
        </div>

        <DialogBody
          entry={entry}
          workout={workout}
          workoutId={workoutId}
          exerciseSets={exerciseSets}
          isPlanned={isPlanned}
          isHydrating={isHydrating}
          isLoading={isLoading}
          weightUnit={weightUnit}
          history={history}
          onMarkComplete={onMarkComplete}
          isMarkingComplete={isMarkingComplete}
          onUpdateSet={(setId, data) => updateSet.mutate({ setId, data })}
          onAddSet={(data) => addSet.mutate(data)}
          onDeleteSet={(setId) => deleteSet.mutate(setId)}
          onSaveNote={(note) => workoutId && updateNote.mutate(note)}
          onAskCoach={handleAskCoach}
        />
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
interface DialogBodyProps {
  readonly entry: TimelineEntry;
  readonly workout: (import("@shared/schema").WorkoutLog & { exerciseSets?: ExerciseSet[]; notes?: string | null }) | undefined;
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly isPlanned: boolean;
  readonly isHydrating: boolean;
  readonly isLoading: boolean;
  readonly weightUnit: "kg" | "lb";
  readonly history: import("@/lib/api").WorkoutHistoryStats | undefined;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
  readonly isMarkingComplete: boolean;
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly onSaveNote: (note: string | null) => void;
  readonly onAskCoach?: () => void;
}

/**
 * The dialog's main content grid + athlete-note footer, split out so
 * WorkoutDetailDialogV2 stays below Sonar's cognitive-complexity
 * ceiling. Renders the planned-entry CTA or the structured exercise
 * table + side panels, plus the athlete-note section for logged
 * workouts.
 */
function DialogBody(props: Readonly<DialogBodyProps>) {
  const {
    entry,
    workout,
    workoutId,
    exerciseSets,
    isPlanned,
    isHydrating,
    isLoading,
    weightUnit,
    history,
    onMarkComplete,
    isMarkingComplete,
    onUpdateSet,
    onAddSet,
    onDeleteSet,
    onSaveNote,
    onAskCoach,
  } = props;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          {isPlanned ? (
            <PlannedCallToAction
              entry={entry}
              onMarkComplete={onMarkComplete}
              isMarkingComplete={isMarkingComplete}
            />
          ) : (
            <LoggedExerciseSection
              workoutId={workoutId}
              exerciseSets={exerciseSets}
              isHydrating={isHydrating}
              weightUnit={weightUnit}
              onUpdateSet={onUpdateSet}
              onAddSet={onAddSet}
              onDeleteSet={onDeleteSet}
            />
          )}

          <CoachPrescriptionCollapsible
            mainWorkout={entry.mainWorkout}
            accessory={entry.accessory}
            notes={entry.notes}
            defaultOpen={isPlanned}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <CoachTakePanel rationale={entry.aiRationale} onAskCoach={onAskCoach} />
          {!isPlanned && <HistoryPanel stats={history} isLoading={isLoading} />}
        </aside>
      </div>

      {!isPlanned && (
        <div className="border-t border-border px-6 py-4">
          <AthleteNoteInput
            value={workout?.notes}
            onSave={onSaveNote}
            disabled={!workoutId}
          />
        </div>
      )}
    </>
  );
}

interface LoggedExerciseSectionProps {
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly isHydrating: boolean;
  readonly weightUnit: "kg" | "lb";
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

function LoggedExerciseSection({
  workoutId,
  exerciseSets,
  isHydrating,
  weightUnit,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: Readonly<LoggedExerciseSectionProps>) {
  if (!workoutId) return null;
  const showHydratingBanner = isHydrating && exerciseSets.length === 0;
  return (
    <>
      {showHydratingBanner && (
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
      <ExerciseTable
        workoutId={workoutId}
        exerciseSets={exerciseSets}
        weightUnit={weightUnit}
        onUpdateSet={onUpdateSet}
        onAddSet={onAddSet}
        onDeleteSet={onDeleteSet}
      />
    </>
  );
}

interface HydrationTrigger {
  isPending: boolean;
  mutate: (
    variables?: void,
    options?: { onSettled?: () => void },
  ) => void;
}

interface HydrateParams {
  workoutId: string | null;
  workout: { planDayId: string | null; exerciseSets?: unknown[] } | undefined;
  isLoading: boolean;
  hasFreeText: boolean;
  seedFromPlan: HydrationTrigger;
  reparseFreeText: HydrationTrigger;
}

/**
 * Two-step hydration for workouts that open with no structured sets:
 *   1. If the workout is linked to a plan day, call /seed-from-plan. On
 *      a plan generated after #834 shipped it copies the prescribed rows;
 *      on a legacy plan day it's a no-op.
 *   2. Once that settles and the workout still has no sets AND the
 *      free-text prescription has content, call /reparse so Gemini
 *      parses `mainWorkout + accessory` into structured rows.
 *   3. If there's no plan day link, skip step 1 and go straight to step 2.
 * Each attempt fires at most once per workoutId (refs) so a 5xx or a
 * zero-parse doesn't loop across re-renders.
 *
 * Extracted into its own hook so WorkoutDetailDialogV2 stays below
 * Sonar's cognitive-complexity ceiling; the component now just composes
 * data + callbacks and this hook owns the control flow.
 */
function useHydrateWorkoutDetail({
  workoutId,
  workout,
  isLoading,
  hasFreeText,
  seedFromPlan,
  reparseFreeText,
}: HydrateParams): void {
  const seedAttemptedRef = useRef<string | null>(null);
  const reparseAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workoutId || isLoading || !workout) return;
    const hasSets = (workout.exerciseSets?.length ?? 0) > 0;
    if (hasSets) return;

    if (workout.planDayId) {
      runSeedThenReparse({
        workoutId,
        hasFreeText,
        seedFromPlan,
        reparseFreeText,
        seedAttemptedRef,
        reparseAttemptedRef,
      });
      return;
    }
    runReparseOnly({
      workoutId,
      hasFreeText,
      reparseFreeText,
      reparseAttemptedRef,
    });
  }, [workoutId, workout, isLoading, hasFreeText, seedFromPlan, reparseFreeText]);
}

function runSeedThenReparse(args: {
  workoutId: string;
  hasFreeText: boolean;
  seedFromPlan: HydrationTrigger;
  reparseFreeText: HydrationTrigger;
  seedAttemptedRef: React.MutableRefObject<string | null>;
  reparseAttemptedRef: React.MutableRefObject<string | null>;
}) {
  const { workoutId, hasFreeText, seedFromPlan, reparseFreeText, seedAttemptedRef, reparseAttemptedRef } = args;
  if (seedAttemptedRef.current === workoutId || seedFromPlan.isPending) return;
  seedAttemptedRef.current = workoutId;
  seedFromPlan.mutate(undefined, {
    // Chain reparse only AFTER the seed call finishes, whether it
    // succeeded or not, to avoid two in-flight Gemini calls at once.
    onSettled: () => {
      if (!hasFreeText) return;
      if (reparseAttemptedRef.current === workoutId) return;
      reparseAttemptedRef.current = workoutId;
      reparseFreeText.mutate();
    },
  });
}

function runReparseOnly(args: {
  workoutId: string;
  hasFreeText: boolean;
  reparseFreeText: HydrationTrigger;
  reparseAttemptedRef: React.MutableRefObject<string | null>;
}) {
  const { workoutId, hasFreeText, reparseFreeText, reparseAttemptedRef } = args;
  if (!hasFreeText) return;
  if (reparseAttemptedRef.current === workoutId || reparseFreeText.isPending) return;
  reparseAttemptedRef.current = workoutId;
  reparseFreeText.mutate();
}

interface PlannedCallToActionProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
  readonly isMarkingComplete?: boolean;
}

function PlannedCallToAction({ entry, onMarkComplete, isMarkingComplete }: Readonly<PlannedCallToActionProps>) {
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
            // Disable while logWorkoutMutation is in flight. The dialog
            // stays open until the mutation settles, so without this
            // guard repeat clicks queue duplicate workoutLogs for the
            // same plan day before the Timeline closes the dialog.
            disabled={isMarkingComplete}
            data-testid="workout-detail-mark-complete"
          >
            {isMarkingComplete ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            {isMarkingComplete ? "Logging…" : "Mark complete"}
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
