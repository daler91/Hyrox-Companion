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
import { usePlanDayCoachNote } from "@/hooks/usePlanDayCoachNote";
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import type { ParseFromImagePayload, ReparseResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { CoachPrescriptionCollapsible } from "./CoachPrescriptionCollapsible";
import { CoachTakePanel } from "./CoachTakePanel";
import { ExerciseTable } from "./ExerciseTable";
import { HistoryPanel } from "./HistoryPanel";
import { InDialogCoachChat } from "./InDialogCoachChat";
import { SaveWorkoutButton } from "./SaveWorkoutButton";
import { useDialogParseControls } from "./useDialogParseControls";
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
  readonly distanceUnit?: "km" | "miles";
  /**
   * Fires the moment the user opens the in-dialog coach chat. Parent
   * uses this to close the global coach rail so the two chat surfaces
   * don't render side-by-side with independent `useChatSession`
   * instances — local message state between those two hooks doesn't
   * sync, so sending from one would leave the other stale.
   */
  readonly onAskCoachOpen?: () => void;
  /**
   * Whether the AI coach is enabled for this user. When false, the
   * Ask-coach click delegates to `onRequestCoachConsent` instead of
   * opening the in-dialog chat — the global-rail flow already gates
   * on consent via `handleCoachToggle` in Timeline; without this
   * prop, the in-dialog path would silently bypass that gate.
   */
  readonly aiCoachEnabled?: boolean;
  /**
   * Invoked when the user clicks Ask coach but consent hasn't been
   * granted yet. Parent shows `AIConsentDialog`; on accept, the user
   * clicks Ask coach again to actually open the chat.
   */
  readonly onRequestCoachConsent?: () => void;
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
  distanceUnit = "km",
  onAskCoachOpen,
  aiCoachEnabled = true,
  onRequestCoachConsent,
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
    isSaving: isSavingLoggedSets,
    lastSavedAt: loggedLastSavedAt,
    patchSetDebounced: patchLoggedSetDebounced,
    flushPendingSetPatches: flushLoggedSetPatches,
    addSet,
    deleteSet,
    reparseFreeText,
    reparseFromImage,
    updateNote,
    updatePrescription,
    updateFocus,
    updateRpe,
  } = useWorkoutDetail(workoutId);
  const loggedSaveState = { isSaving: isSavingLoggedSets, lastSavedAt: loggedLastSavedAt };

  // Hoisted to top-level so both the header's onChangeFocus handler and the
  // DialogBody's PlannedCallToAction can share the same hook instance —
  // React Query dedups by queryKey so this is just one subscription either
  // way. When the entry isn't planned, planDayId is null and every
  // mutation no-ops, which is the same behaviour DialogBody had before.
  const planSets = usePlanDayExercises(entry?.planDayId ?? null);
  // Hoisted for the same reason — the Save button lives in the dialog
  // footer and needs `regenerate.mutate()` + `isRegenerating`. DialogBody
  // receives the hook as a prop so CoachTakePanel wiring stays identical.
  const planCoachNote = usePlanDayCoachNote(entry?.planDayId ?? null);

  // Local stamp of the most recent successful Save click. Bumped after the
  // blur-flush and (when applicable) coach-note regenerate resolve, so
  // SaveWorkoutButton can flash "Saved ✓" once per click.
  const [saveClickedAt, setSaveClickedAt] = useState<number | null>(null);
  const [saveInFlight, setSaveInFlight] = useState(false);
  // Frozen at click time so the drain watcher regenerates the entry
  // the user actually clicked Save on — even if they navigate to a
  // different entry while the per-set PATCHes are still draining.
  // null means "no plan-day refresh for this save" (ad-hoc logged
  // workout, or a logged workout whose edits don't touch plan-day state).
  const [saveTargetPlanDayId, setSaveTargetPlanDayId] = useState<string | null>(null);
  // Guards against the drain watcher re-firing regenerate on every
  // isSaving toggle — one regenerate per Save click. Resets when
  // saveInFlight returns to false at the end of the cycle.
  const saveRegenerateFiredRef = useRef(false);
  const regenerateMutate = planCoachNote.regenerate.mutate;

  // Live entry id — read from the regenerate's finalize callback so a
  // late success (user navigated away while the mutation was in flight)
  // doesn't flash "Saved ✓" on whatever entry is current now. The ref
  // is updated from an effect rather than during render to satisfy
  // react-hooks/refs.
  const currentEntryIdRef = useRef<string | undefined>(entry?.id);
  useEffect(() => {
    currentEntryIdRef.current = entry?.id;
  }, [entry?.id]);

  // Entry-change sentinel: the dialog stays mounted while the athlete
  // browses between timeline cards, so per-entry save state has to
  // reset explicitly. Without this, opening entry B after saving entry
  // A shows A's "Saved ✓" confirmation and leaves B's button disabled
  // if A's regenerate is still draining. `lastEntryId` is a render-time
  // sentinel — same pattern as `ownerId` in usePlanDayExercises —
  // which satisfies react-hooks/set-state-in-effect.
  const [lastEntryId, setLastEntryId] = useState<string | undefined>(entry?.id);
  if (entry?.id !== lastEntryId) {
    setLastEntryId(entry?.id);
    setSaveClickedAt(null);
    setSaveInFlight(false);
    setSaveTargetPlanDayId(null);
  }

  // Drain watcher: once every set mutation the flush kicked off has
  // settled, fire the coach-note regenerate (planned entries) or just
  // finalize (ad-hoc logged). Without this the regenerate would
  // snapshot a plan day that still has pre-edit rows, since the
  // mutations fired from `flushPendingSetPatches` are async.
  useEffect(() => {
    if (!saveInFlight) {
      saveRegenerateFiredRef.current = false;
      return;
    }
    if (planSets.isSaving || isSavingLoggedSets) return;
    if (saveRegenerateFiredRef.current) return;
    saveRegenerateFiredRef.current = true;
    // Freeze the entry id at fire time so the finalize closure can
    // suppress the flash when the user has navigated away since.
    const targetEntryId = entry?.id;
    // "Saved ✓" is the success signal — only flash it when the
    // regenerate actually succeeded AND the user is still looking at
    // the entry they clicked Save on. Error paths still clear
    // saveInFlight + saveTargetPlanDayId so the button unlocks; the
    // `errorToast` on the hook's mutation surfaces the failure.
    const finalizeSuccess = () => {
      setSaveInFlight(false);
      setSaveTargetPlanDayId(null);
      if (currentEntryIdRef.current === targetEntryId) {
        setSaveClickedAt(Date.now());
      }
    };
    const finalizeFailure = () => {
      setSaveInFlight(false);
      setSaveTargetPlanDayId(null);
    };
    if (saveTargetPlanDayId) {
      regenerateMutate(saveTargetPlanDayId, {
        onSuccess: finalizeSuccess,
        onError: finalizeFailure,
      });
    } else {
      finalizeSuccess();
    }
  }, [saveInFlight, planSets.isSaving, isSavingLoggedSets, saveTargetPlanDayId, regenerateMutate, entry?.id]);

  // Tracks the most recent focus value submitted from the header. The
  // timeline query owns `entry.focus` and is only invalidated on save
  // success, so right after blur-flush the entry prop can still show the
  // pre-edit value for a few hundred ms. Mark complete reads this ref at
  // click time to avoid posting a stale focus to logWorkoutMutation.
  const latestFocusRef = useRef<string>(entry?.focus || "");
  useEffect(() => {
    latestFocusRef.current = entry?.focus || "";
  }, [entry?.focus]);

  // Hydration (auto-seed + auto-reparse on first open) was removed: plans
  // generated after the structured-exercises refactor always have prescribed
  // rows on the plan_day, and the Mark Complete path seeds the workout_log
  // from those rows at log-creation time. Legacy free-text-only rows are
  // handled explicitly by the Parse button on the free-text editor, not
  // silently on dialog open.

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

  const baseFocusHandler = buildFocusHandler({
    isPlanned,
    planDayId: entry.planDayId ?? null,
    workoutId,
    planSets,
    updateFocus,
  });
  const onChangeFocus = baseFocusHandler
    ? (focus: string) => {
        latestFocusRef.current = focus;
        baseFocusHandler(focus);
      }
    : undefined;
  const headerSaveState = isPlanned
    ? { isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }
    : loggedSaveState;

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col overflow-hidden p-0",
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-6 pt-4">
            <WorkoutDetailHeaderV2
              entry={entry}
              onDelete={handlers.menuDelete}
              onChangeStatus={handlers.menuChangeStatus}
              onCombine={handlers.menuCombine}
              onChangeFocus={onChangeFocus}
              saveState={headerSaveState}
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
            isLoading={isLoading}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            history={history}
            onMarkComplete={onMarkComplete}
            isMarkingComplete={isMarkingComplete}
            onUpdateSet={patchLoggedSetDebounced}
            onAddSet={addSet.mutate}
            onDeleteSet={deleteSet.mutate}
            loggedSaveState={loggedSaveState}
            planSets={planSets}
            planCoachNote={planCoachNote}
            latestFocusRef={latestFocusRef}
            onSaveNote={(note) => workoutId && updateNote.mutate(note)}
            onSaveLoggedPrescription={(patch) => workoutId && updatePrescription.mutate(patch)}
            onParseLoggedFreeText={(opts) => {
              if (!workoutId) return;
              reparseFreeText.mutate(undefined, opts);
            }}
            isParsingLogged={reparseFreeText.isPending}
            onParseLoggedFromImage={(payload, opts) => {
              if (!workoutId) return;
              reparseFromImage.mutate(payload, opts);
            }}
            isParsingLoggedImage={reparseFromImage.isPending}
            chatOpen={chatOpen}
            onOpenChat={() => {
              // Gate on consent first: the global-rail flow enforces
              // AIConsentDialog via handleCoachToggle in Timeline;
              // the in-dialog path needs the same guard or a
              // non-consented user could bypass it just by clicking
              // Ask coach from a workout detail.
              if (!aiCoachEnabled) {
                onRequestCoachConsent?.();
                return;
              }
              // Tell the parent to close the global coach rail before
              // we mount the in-dialog chat: both surfaces would spin
              // up their own `useChatSession` with independent local
              // state, so a message sent in one wouldn't reach the
              // other. One surface at a time keeps them consistent
              // until we hoist the session into a shared context.
              onAskCoachOpen?.();
              setChatOpen(true);
            }}
            onCloseChat={() => setChatOpen(false)}
          />
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SaveWorkoutButton
            isBusy={saveInFlight || planCoachNote.isRegenerating}
            savedAt={saveClickedAt}
            showCoachNoteHint={entry.planDayId != null}
            disabled={planCoachNote.isCoolingDown}
            onClick={() => {
              // Blur so EditableFocus + CoachPrescriptionCollapsible's
              // onBlur-flushes commit pending edits. Cell debounces live
              // in the hook below, so per-set PATCHes are driven by the
              // explicit flush calls rather than the blur.
              const active = document.activeElement;
              if (active instanceof HTMLElement) active.blur();
              // Commit any pending per-set PATCHes synchronously before
              // the drain watcher starts counting down. `flushLoggedSetPatches`
              // no-ops for the planned branch (workoutId is null) and
              // `planSets.flushPendingSetPatches` no-ops for ad-hoc workouts.
              planSets.flushPendingSetPatches();
              flushLoggedSetPatches();
              // Only planned entries write to plan_days, so only planned
              // entries need the coach-note regenerate. A logged workout
              // that happens to be linked to a plan day still edits its
              // workoutLog via api.workouts.*, not plan_days — regenerate
              // there would burn AI budget / cooldown without reflecting
              // what was actually saved.
              setSaveTargetPlanDayId(isPlanned ? entry.planDayId ?? null : null);
              setSaveInFlight(true);
            }}
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
interface DialogBodyProps {
  readonly entry: TimelineEntry;
  readonly workout: (import("@shared/schema").WorkoutLog & { exerciseSets?: ExerciseSet[]; notes?: string | null }) | undefined;
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly isPlanned: boolean;
  readonly isLoading: boolean;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly history: import("@/lib/api").WorkoutHistoryStats | undefined;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
  readonly isMarkingComplete: boolean;
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  /** Save-state signal passed to ExerciseTable on the logged-workout branch. */
  readonly loggedSaveState: { isSaving: boolean; lastSavedAt: number | null };
  /**
   * Plan-day mutation bundle hoisted from the top-level dialog so the
   * header's onChangeFocus handler and the planned-entry CTA share the
   * same hook instance. React Query dedupes by queryKey so passing it
   * through doesn't create a second subscription.
   */
  readonly planSets: ReturnType<typeof usePlanDayExercises>;
  /**
   * Coach-note regenerate hook hoisted up to the dialog so the Save
   * button in the footer and CoachTakePanel in the sidebar share one
   * instance. Passing it down here keeps CoachTakePanel's wiring
   * identical — it still reads `localRationale`, `localUpdatedAt`, and
   * `isRegenerating` from this bundle.
   */
  readonly planCoachNote: ReturnType<typeof usePlanDayCoachNote>;
  /**
   * Ref tracking the most recent focus submitted from the header input,
   * read by PlannedCallToAction so Mark complete uses the just-typed
   * value instead of the `entry.focus` prop, which lags the save.
   */
  readonly latestFocusRef: MutableRefObject<string>;
  readonly onSaveNote: (note: string | null) => void;
  /**
   * Save handlers + Parse trigger for the logged-workout free-text editor.
   * On the planned branch these are handled in-hook via usePlanDayExercises.
   */
  readonly onSaveLoggedPrescription: (patch: { mainWorkout?: string | null; accessory?: string | null; notes?: string | null }) => void;
  readonly onParseLoggedFreeText: (opts?: { onSuccess?: () => void }) => void;
  readonly isParsingLogged: boolean;
  readonly onParseLoggedFromImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (data: ReparseResponse) => void },
  ) => void;
  readonly isParsingLoggedImage: boolean;
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
// TimelineEntry.aiNoteUpdatedAt is typed as `string | Date | null` because it
// round-trips through JSON. Normalize to Date for the staleness comparison
// below; invalid strings degrade to `null` (treated as "no note yet").
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function DialogBody(props: Readonly<DialogBodyProps>) {
  const {
    entry,
    workout,
    workoutId,
    exerciseSets,
    isPlanned,
    isLoading,
    weightUnit,
    distanceUnit,
    history,
    onMarkComplete,
    isMarkingComplete,
    onUpdateSet,
    onAddSet,
    onDeleteSet,
    loggedSaveState,
    planSets,
    planCoachNote,
    latestFocusRef,
    onSaveNote,
    onSaveLoggedPrescription,
    onParseLoggedFreeText,
    isParsingLogged,
    onParseLoggedFromImage,
    isParsingLoggedImage,
    chatOpen,
    onOpenChat,
    onCloseChat,
  } = props;

  const planDayId = entry.planDayId ?? null;

  // Prefer the locally-regenerated rationale when present so the UI updates
  // the moment the refresh mutation resolves — without waiting for the
  // timeline invalidation to round-trip through the server.
  const displayRationale = planCoachNote.localRationale ?? entry.aiRationale;
  const displayNoteUpdatedAt = planCoachNote.localUpdatedAt ?? toDate(entry.aiNoteUpdatedAt);

  // Stale = at least one exercise edit landed after the rationale was last
  // generated. Session-bounded (lastSavedAt resets on dialog close), which
  // is acceptable — the point is immediate feedback in the session where
  // the user makes edits.
  const isCoachNoteStale =
    isPlanned &&
    planSets.lastSavedAt != null &&
    displayNoteUpdatedAt != null &&
    planSets.lastSavedAt > displayNoteUpdatedAt.getTime();

  // Route free-text edits to the right mutation based on which branch is open.
  const onSavePrescriptionField = (field: "mainWorkout" | "accessory" | "notes", value: string) => {
    const normalized = value.trim().length === 0 ? null : value;
    if (isPlanned && planDayId) {
      planSets.updatePrescription.mutate({ [field]: normalized });
    } else if (!isPlanned && workoutId) {
      onSaveLoggedPrescription({ [field]: normalized });
    }
  };
  const parseReady =
    (isPlanned && planDayId != null) || (!isPlanned && workoutId != null);
  const currentSets = isPlanned ? planSets.exerciseSets : exerciseSets;
  const hasSets = currentSets.length > 0;

  const parseControls = useDialogParseControls({
    entryId: entry.id,
    isPlanned,
    hasSets,
    planSets,
    onParseLoggedFreeText,
    isParsingLogged,
    onParseLoggedFromImage,
    isParsingLoggedImage,
  });

  // Empty-state nudge: when the prescription has text but no structured rows
  // exist yet, point the user at Parse instead of Add.
  const hasUnparsedText =
    hasPrescriptionText(entry.mainWorkout) || hasPrescriptionText(entry.accessory);

  const focusLabel = entry.focus?.trim() || "this workout";
  const chatSeed = `Can you walk me through your take on my ${focusLabel} workout?`;
  // Widen the right column when the chat surface is active so the
  // thread + input have room without squeezing the exercise table.
  const gridClasses = chatOpen
    ? "grid grid-cols-1 items-start gap-4 px-6 py-4 md:grid-cols-[1fr_380px] lg:grid-cols-[1fr_420px]"
    : "grid grid-cols-1 items-start gap-4 px-6 py-4 md:grid-cols-[1fr_280px]";

  return (
    <div className={gridClasses}>
      <div className="flex flex-col gap-3">
        <CoachPrescriptionCollapsible
          title={isPlanned ? "Coach's prescription" : "Workout description"}
          mainWorkout={entry.mainWorkout}
          accessory={entry.accessory}
          notes={entry.notes}
          open={parseControls.prescriptionOpen}
          onOpenChange={parseControls.setPrescriptionOpen}
          onSaveField={onSavePrescriptionField}
          onParse={parseReady ? parseControls.onParseClicked : undefined}
          isParsing={parseControls.isParsing}
          onCapture={parseReady ? parseControls.onCapture : undefined}
          imagePreview={parseControls.imagePreview}
          onRetakeImage={parseControls.clearImagePreview}
          onParseImage={parseControls.onParseImageClicked}
          isParsingImage={parseControls.isParsingImage}
        />

        {isPlanned ? (
          <PlannedCallToAction
            entry={entry}
            onMarkComplete={onMarkComplete}
            isMarkingComplete={isMarkingComplete}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            planSets={planSets}
            latestFocusRef={latestFocusRef}
            hasUnparsedText={hasUnparsedText}
          />
        ) : (
          <LoggedExerciseSection
            workoutId={workoutId}
            exerciseSets={exerciseSets}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdateSet={onUpdateSet}
            onAddSet={onAddSet}
            onDeleteSet={onDeleteSet}
            saveState={loggedSaveState}
            hasUnparsedText={hasUnparsedText}
          />
        )}

        {!isPlanned && (
          <AthleteNoteInput
            value={workout?.notes}
            onSave={onSaveNote}
            disabled={!workoutId}
          />
        )}

        <AlertDialog
          open={parseControls.confirmingParse}
          onOpenChange={parseControls.setConfirmingParse}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace existing exercises?</AlertDialogTitle>
              <AlertDialogDescription>
                {parseControls.pendingParseSource === "image"
                  ? "Parsing this photo will replace the current structured exercises for this workout. Any manual edits you've made to the rows will be lost."
                  : "Parsing the coach's text will replace the current structured exercises for this workout. Any manual edits you've made to the rows will be lost."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={parseControls.confirmReplace}
                data-testid="coach-prescription-parse-confirm"
              >
                Replace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <aside className="flex self-start flex-col gap-3">
        {chatOpen ? (
          <InDialogCoachChat
            focusLabel={focusLabel}
            seedText={chatSeed}
            onBack={onCloseChat}
          />
        ) : (
          <>
            <CoachTakePanel
              rationale={displayRationale}
              onAskCoach={onOpenChat}
              isStale={isCoachNoteStale}
              isRefreshing={planCoachNote.isRegenerating}
            />
            {!isPlanned && <HistoryPanel stats={history} isLoading={isLoading} />}
          </>
        )}
      </aside>
    </div>
  );
}

function hasPrescriptionText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

interface LoggedExerciseSectionProps {
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly saveState: { isSaving: boolean; lastSavedAt: number | null };
  readonly hasUnparsedText?: boolean;
}

function LoggedExerciseSection({
  workoutId,
  exerciseSets,
  weightUnit,
  distanceUnit,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  saveState,
  hasUnparsedText,
}: Readonly<LoggedExerciseSectionProps>) {
  if (!workoutId) return null;
  return (
    <ExerciseTable
      workoutId={workoutId}
      exerciseSets={exerciseSets}
      weightUnit={weightUnit}
      distanceUnit={distanceUnit}
      onUpdateSet={onUpdateSet}
      onAddSet={onAddSet}
      onDeleteSet={onDeleteSet}
      saveState={saveState}
      hasUnparsedText={hasUnparsedText}
    />
  );
}

interface PlannedCallToActionProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
  readonly isMarkingComplete?: boolean;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly planSets: ReturnType<typeof usePlanDayExercises>;
  /** Latest-submitted focus from the header input; used to override a
   *  potentially-stale `entry.focus` on Mark complete. */
  readonly latestFocusRef: MutableRefObject<string>;
  readonly hasUnparsedText?: boolean;
}

function PlannedCallToAction({ entry, onMarkComplete, isMarkingComplete, weightUnit, distanceUnit, planSets, latestFocusRef, hasUnparsedText }: Readonly<PlannedCallToActionProps>) {
  // Plan-day-backed exercise edits. `planSets` is hoisted up to DialogBody
  // so the same hook instance feeds both this CTA and the CoachTakePanel's
  // staleness comparison. Writes go to plan_day-owned exerciseSets; Mark
  // complete's phase-6 server copy copies whatever this hook has persisted
  // into the new workoutLog at log time.
  const planDayId = entry.planDayId ?? null;

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
          distanceUnit={distanceUnit}
          onUpdateSet={planSets.patchSetDebounced}
          onAddSet={planSets.addSet.mutate}
          onDeleteSet={planSets.deleteSet.mutate}
          saveState={{ isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }}
          hasUnparsedText={hasUnparsedText}
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
            onClick={() => {
              // Blur whatever input is focused so EditableFocus's onBlur
              // flush fires synchronously before Mark complete posts. The
              // flush updates latestFocusRef via the dialog's wrapped
              // onChangeFocus, so reading the ref below gives us the
              // just-typed title even if the timeline query hasn't
              // invalidated yet.
              const active = document.activeElement;
              if (active instanceof HTMLElement) active.blur();
              const focus = latestFocusRef.current || entry.focus;
              onMarkComplete(focus === entry.focus ? entry : { ...entry, focus });
            }}
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

/**
 * Resolve the focus-save handler for the header title input. Branches on
 * planned-vs-logged state, then guards on the owning id (planDayId /
 * workoutId). Returning undefined on either guard drops the header into
 * its read-only fallback. Extracted so the JSX site stays free of nested
 * ternaries.
 */
function buildFocusHandler(args: {
  readonly isPlanned: boolean;
  readonly planDayId: string | null;
  readonly workoutId: string | null;
  readonly planSets: ReturnType<typeof usePlanDayExercises>;
  readonly updateFocus: ReturnType<typeof useWorkoutDetail>["updateFocus"];
}): ((focus: string) => void) | undefined {
  const { isPlanned, planDayId, workoutId, planSets, updateFocus } = args;
  if (isPlanned) {
    if (!planDayId) return undefined;
    return (focus) => planSets.updatePrescription.mutate({ focus });
  }
  if (!workoutId) return undefined;
  return (focus) => updateFocus.mutate(focus);
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
