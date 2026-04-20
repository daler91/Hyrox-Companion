import type { ExerciseSet, TimelineEntry, WorkoutStatus } from "@shared/schema";
import { CheckCircle2, Loader2 } from "lucide-react";
import { type MutableRefObject,useEffect, useRef, useState } from "react";

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
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { cn } from "@/lib/utils";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { CoachPrescriptionCollapsible } from "./CoachPrescriptionCollapsible";
import { CoachTakePanel } from "./CoachTakePanel";
import { ExerciseTable } from "./ExerciseTable";
import { HistoryPanel } from "./HistoryPanel";
import { InDialogCoachChat } from "./InDialogCoachChat";
import { WorkoutDetailHeaderV2 } from "./WorkoutDetailHeaderV2";
import { WorkoutStatsRow } from "./WorkoutStatsRow";

interface WorkoutDetailDialogV2Props {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
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
  onDelete,
  onChangeStatus,
  onMarkComplete,
  isMarkingComplete = false,
  onCombine,
  weightUnit = "kg",
}: WorkoutDetailDialogV2Props) {
  const workoutId = entry?.workoutLogId ?? null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // When true, the dialog's right sidebar swaps from CoachTake +
  // History to the in-dialog coach chat. Click "Ask coach" to open,
  // back button in the chat to restore the default sidebar. Kept
  // local to the dialog — no Timeline-side seed wiring — so the
  // global coach panel (FAB) stays independent.
  const [chatOpen, setChatOpen] = useState(false);
  // Reset the chat when the dialog is closed or the entry changes,
  // so reopening a workout starts fresh on Coach Take + History.
  useEffect(() => {
    setChatOpen(false);
  }, [entry?.id]);
  // Monotonic counter bumped whenever an RPE save errors on the
  // currently-displayed workout. Passed to WorkoutStatsRow as the
  // reset signal so the editable input remounts with the
  // server-authoritative value after a failure.
  // updateRpe.failureCount can't be used here: TanStack Query resets
  // failureCount to 0 when the next retry enters pending, which
  // would remount the input mid-retry and drop the user's draft.
  const [rpeErrorToken, setRpeErrorToken] = useState(0);
  // Track the currently displayed workout id in a ref so a mutation
  // error firing after the dialog navigated away only bumps the
  // error token when the failed save belongs to the workout the
  // user is still looking at.
  const displayedWorkoutIdRef = useRef<string | null>(workoutId);
  useEffect(() => {
    displayedWorkoutIdRef.current = workoutId;
  }, [workoutId]);
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
    updateRpe,
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
  // displayedWorkoutIdRef is only dereferenced inside the `onError`
  // callback that buildDialogHandlers attaches to updateRpe.mutate(),
  // i.e. at mutation-error time. The compiler flags the call
  // defensively because it can't trace the ref through the helper,
  // so we suppress the rule here.
  // eslint-disable-next-line react-hooks/refs
  const handlers = buildDialogHandlers({
    entry,
    workoutId,
    isPlanned,
    actionsLocked,
    onDelete,
    onChangeStatus,
    onCombine,
    updateRpe,
    openDeleteConfirm: () => setConfirmingDelete(true),
    displayedWorkoutIdRef,
    bumpRpeErrorToken: setRpeErrorToken,
  });
  const showStatsRow = !isPlanned && !!workout;

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto p-0",
          // Widen the dialog a touch when the in-dialog chat is
          // open so the right sidebar has room for the thread +
          // input without squeezing the exercise table on the
          // left. Default max-w-6xl is comfortable for the
          // summary-only view.
          chatOpen ? "max-w-7xl" : "max-w-6xl",
        )}
        data-testid="workout-detail-dialog-v2"
      >
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
            onDelete={handlers.menuDelete}
            onChangeStatus={handlers.menuChangeStatus}
            onCombine={handlers.menuCombine}
          />
          {showStatsRow && workout && (
            <WorkoutStatsRow
              workout={workout}
              exerciseSets={exerciseSets}
              onChangeRpe={handlers.changeRpe}
              rpeResetSignal={rpeErrorToken}
            />
          )}
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
          chatOpen={chatOpen}
          onOpenChat={() => setChatOpen(true)}
          onCloseChat={() => setChatOpen(false)}
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
  /**
   * Whether the in-dialog coach chat is visible. When true the
   * sidebar swaps from CoachTake + History to the chat surface.
   */
  readonly chatOpen: boolean;
  readonly onOpenChat: () => void;
  readonly onCloseChat: () => void;
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
    chatOpen,
    onOpenChat,
    onCloseChat,
  } = props;

  const focusLabel = entry.focus?.trim() || "this workout";
  const chatSeed = `Can you walk me through your take on my ${focusLabel} workout?`;
  // Widen the right column when the chat surface is active so the
  // thread + input have room without squeezing the exercise table.
  const gridClasses = chatOpen
    ? "grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[1fr_380px] lg:grid-cols-[1fr_420px]"
    : "grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[1fr_280px]";

  return (
    <>
      <div className={gridClasses}>
        <div className="flex flex-col gap-3">
          {isPlanned ? (
            <PlannedCallToAction
              entry={entry}
              onMarkComplete={onMarkComplete}
              isMarkingComplete={isMarkingComplete}
              weightUnit={weightUnit}
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
          {chatOpen ? (
            <InDialogCoachChat
              focusLabel={focusLabel}
              seedText={chatSeed}
              onBack={onCloseChat}
            />
          ) : (
            <>
              <CoachTakePanel rationale={entry.aiRationale} onAskCoach={onOpenChat} />
              {!isPlanned && <HistoryPanel stats={history} isLoading={isLoading} />}
            </>
          )}
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
  readonly weightUnit: "kg" | "lb";
}

function PlannedCallToAction({ entry, onMarkComplete, isMarkingComplete, weightUnit }: Readonly<PlannedCallToActionProps>) {
  // Plan-day-backed exercise edits. Writes go to plan_day-owned
  // exerciseSets; Mark complete's phase-6 server copy copies whatever
  // this hook has persisted into the new workoutLog at log time.
  const planDayId = entry.planDayId ?? null;
  const planSets = usePlanDayExercises(planDayId);

  // Block Mark complete while any plan-day set mutation is still in
  // flight — otherwise createWorkoutInTx can race the mutation and
  // snapshot pre-edit plan_day rows before the PATCH commits.
  // Debounced-but-not-yet-fired cell edits still narrowly race, but
  // this catches the common "edit + click" sequence once the debounce
  // has fired its mutation.
  const ctaBusy = isMarkingComplete || planSets.isSaving;
  const ctaDisabled = ctaBusy;
  let ctaLabel = "Mark complete";
  if (isMarkingComplete) ctaLabel = "Logging…";
  else if (planSets.isSaving) ctaLabel = "Saving edits…";

  return (
    <div className="flex flex-col gap-4" data-testid="workout-detail-planned-cta">
      {planDayId ? (
        <ExerciseTable
          workoutId={planDayId}
          exerciseSets={planSets.exerciseSets}
          weightUnit={weightUnit}
          onUpdateSet={(setId, data) => planSets.updateSet.mutate({ setId, data })}
          onAddSet={(data) => planSets.addSet.mutate(data)}
          onDeleteSet={(setId) => planSets.deleteSet.mutate(setId)}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          This entry isn't linked to a plan day, so there's nothing to prescribe yet.
        </div>
      )}

      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-4 text-center"
      >
        <p className="text-sm text-muted-foreground">
          Tweak the sets above if needed, then mark the workout complete to log it.
        </p>
        {onMarkComplete && (
          <Button
            onClick={() => onMarkComplete(entry)}
            size="lg"
            className="gap-2"
            disabled={ctaDisabled}
            data-testid="workout-detail-mark-complete"
          >
            {ctaBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            {ctaLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function hasMeaningfulText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

interface BuildDialogHandlersArgs {
  entry: TimelineEntry;
  workoutId: string | null;
  isPlanned: boolean;
  actionsLocked: boolean;
  onDelete: WorkoutDetailDialogV2Props["onDelete"];
  onChangeStatus: WorkoutDetailDialogV2Props["onChangeStatus"];
  onCombine: WorkoutDetailDialogV2Props["onCombine"];
  updateRpe: {
    mutate: (
      vars: { rpe: number | null; forWorkoutId: string },
      options?: {
        onError?: (
          error: unknown,
          variables: { rpe: number | null; forWorkoutId: string },
        ) => void;
      },
    ) => void;
  };
  openDeleteConfirm: () => void;
  displayedWorkoutIdRef: MutableRefObject<string | null>;
  bumpRpeErrorToken: (updater: (n: number) => number) => void;
}

// Derive each conditional handler from the props + local state so the
// main component body stays below Sonar's cognitive-complexity ceiling.
// Every ternary/guard that used to live inline in the component lives
// here instead — same logic, different function boundary.
function buildDialogHandlers(args: BuildDialogHandlersArgs) {
  const {
    entry, workoutId, isPlanned, actionsLocked,
    onDelete, onChangeStatus, onCombine,
    updateRpe, openDeleteConfirm, displayedWorkoutIdRef, bumpRpeErrorToken,
  } = args;
  const menuUnlocked = !actionsLocked;
  // Capture workoutId in the mutation variable (forWorkoutId) so the
  // mutation's onSuccess can scope cache writes to the workout that
  // originated this save, even if the dialog has re-rendered for a
  // different entry by the time the server responds. The onError
  // callback runs at mutation-error time (event-handler context), so
  // reading displayedWorkoutIdRef.current there is safe — we only
  // bump the reset token if the failed save still belongs to the
  // workout the dialog is currently showing, otherwise a stale
  // error would clear a draft on a different entry.
  const changeRpe = workoutId
    ? (rpe: number | null) =>
        updateRpe.mutate(
          { rpe, forWorkoutId: workoutId },
          {
            onError: (_err, vars) => {
              if (vars.forWorkoutId === displayedWorkoutIdRef.current) {
                bumpRpeErrorToken((n) => n + 1);
              }
            },
          },
        )
    : undefined;
  return {
    menuDelete: onDelete && menuUnlocked ? openDeleteConfirm : undefined,
    menuChangeStatus:
      onChangeStatus && menuUnlocked
        ? (status: WorkoutStatus) => onChangeStatus(entry, status)
        : undefined,
    menuCombine:
      !isPlanned && onCombine && menuUnlocked ? () => onCombine(entry) : undefined,
    changeRpe,
  };
}

