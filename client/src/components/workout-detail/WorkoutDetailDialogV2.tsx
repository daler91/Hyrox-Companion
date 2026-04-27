import type { ExerciseSet, TimelineEntry, WorkoutStatus } from "@shared/schema";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { type MutableRefObject,type ReactNode,useEffect, useRef, useState } from "react";

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
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import type { ParseFromImagePayload, ReparseResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { CoachPrescriptionCollapsible, type PrescriptionField } from "./CoachPrescriptionCollapsible";
import { CoachTakePanel } from "./CoachTakePanel";
import { ExerciseTable } from "./ExerciseTable";
import { HistoryPanel } from "./HistoryPanel";
import { InDialogCoachChat } from "./InDialogCoachChat";
import { SaveWorkoutButton } from "./SaveWorkoutButton";
import { useDialogParseControls } from "./useDialogParseControls";
import {
  CompletedWorkoutDetailContent,
  PlannedWorkoutDetailContent,
  WorkoutDetailGuidedLayout,
  WorkoutDetailOverview,
  WorkoutDetailReflection,
  WorkoutDetailSection,
} from "./WorkoutDetailGuidedLayout";
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
 *     sets copied across by the server's copy-from-plan path), plus the coach's
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
  // Tracks the in-dialog logging stepper. `null` = no stepper (default
  // planned overview or default logged view); `1` = "Log actuals"; `2` =
  // "Reflect". Set to 1 when the user clicks the planned-state Log
  // workout CTA so the dialog re-renders into the guided flow once the
  // mutation creates the workoutLog. Reset on entry change so reopening
  // a different card starts on its default view.
  const [loggingStep, setLoggingStep] = useState<1 | 2 | null>(null);
  useEffect(() => {
    setChatOpen(false);
    setLoggingStep(null);
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
    updateFocus,
    updateRpe,
  } = useWorkoutDetail(workoutId);
  const { showAdherenceInsights } = useUnitPreferences();
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

  const {
    saveClickedAt,
    saveInFlight,
    startSaveCycle,
  } = useWorkoutDetailSaveCoordinator({
    entryId: entry?.id,
    planSets,
    isSavingLoggedSets,
    regenerateMutate: planCoachNote.regenerate.mutate,
  });

  // Tracks the most recent focus value submitted from the header. The
  // timeline query owns `entry.focus` and is only invalidated on save
  // success, so right after blur-flush the entry prop can still show the
  // pre-edit value for a few hundred ms. Mark complete reads this ref at
  // click time to avoid posting a stale focus to logWorkoutMutation.
  const latestFocusRef = useRef<string>(entry?.focus || "");
  // Tracks in-progress prescription edits the same way `latestFocusRef`
  // tracks focus. Saves go through `planSets.updatePrescription.mutate`
  // (no debounce, fired on blur), but the timeline cache only refreshes
  // after that mutation settles + invalidations refetch — so a user who
  // types a new prescription, blurs, and then immediately clicks Log
  // workout can race the save and end up posting the pre-edit text via
  // entry.mainWorkout/accessory/notes. Carrying the latest draft into
  // handleFooterMarkComplete sidesteps that race.
  const latestPrescriptionRef = useRef<PlanPrescriptionDraft>(
    buildPlanPrescriptionDraft(entry),
  );
  useEffect(() => {
    latestFocusRef.current = entry?.focus || "";
  }, [entry?.focus]);
  useEffect(() => {
    latestPrescriptionRef.current = buildPlanPrescriptionDraft(entry);
  }, [entry]);

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
  const handleDraftFocusChange = (focus: string) => {
    latestFocusRef.current = focus;
  };
  const handleDraftPrescriptionChange = (field: PrescriptionField, value: string) => {
    latestPrescriptionRef.current = {
      ...latestPrescriptionRef.current,
      [field]: value,
    };
  };
  const headerSaveState = isPlanned
    ? { isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }
    : loggedSaveState;
  const completeAction = getCompleteActionState(isMarkingComplete, planSets.isSaving);
  const handleOpenChat = buildOpenChatHandler({
    aiCoachEnabled,
    onRequestCoachConsent,
    onAskCoachOpen,
    openChat: () => setChatOpen(true),
  });
  const handleCloseChat = () => setChatOpen(false);
  const handleSaveNote = buildSaveNoteHandler(workoutId, updateNote.mutate);
  const handleParseLoggedFreeText = buildLoggedFreeTextParser(workoutId, reparseFreeText.mutate);
  const handleParseLoggedFromImage = buildLoggedImageParser(workoutId, reparseFromImage.mutate);
  const handleSaveClick = () => handleWorkoutDetailSaveClick({
    isPlanned,
    planDayId: entry.planDayId ?? null,
    planSets,
    flushLoggedSetPatches,
    startSaveCycle,
  });
  const handleFooterMarkComplete = () => {
    // Flush any debounced ExerciseTable edits before the mutation runs.
    // logWorkoutMutation creates the workoutLog by copying persisted
    // plan-day rows on the server, so a row edit still in the debounce
    // queue would be missing from the new log.
    planSets.flushPendingSetPatches();
    handleWorkoutDetailMarkComplete({
      entry,
      latestFocus: latestFocusRef.current,
      latestPrescription: latestPrescriptionRef.current,
      onMarkComplete,
    });
    // Open the in-dialog stepper so the user can edit actuals and reflect
    // immediately, instead of being dropped back into the read-only logged
    // view (or worse, redirected to /log as the previous flow did). The
    // mutation onSuccess re-binds the URL to the new workoutLogId so this
    // local state survives the planned→logged transition.
    setLoggingStep(1);
  };
  const handleConfirmDelete = () => handleWorkoutDetailDeleteConfirm({
    entry,
    onDelete,
    closeDeleteConfirm: () => setConfirmingDelete(false),
  });

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
              onDraftFocusChange={handleDraftFocusChange}
              saveState={headerSaveState}
            />
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
            onUpdateSet={patchLoggedSetDebounced}
            onAddSet={addSet.mutate}
            onDeleteSet={deleteSet.mutate}
            loggedSaveState={loggedSaveState}
            planSets={planSets}
            planCoachNote={planCoachNote}
            onDraftPrescriptionChange={handleDraftPrescriptionChange}
            onSaveNote={handleSaveNote}
            loggingStep={loggingStep}
            onParseLoggedFreeText={handleParseLoggedFreeText}
            isParsingLogged={reparseFreeText.isPending}
            onParseLoggedFromImage={handleParseLoggedFromImage}
            isParsingLoggedImage={reparseFromImage.isPending}
            chatOpen={chatOpen}
            showAdherenceInsights={showAdherenceInsights}
            onOpenChat={handleOpenChat}
            onCloseChat={handleCloseChat}
            onChangeRpe={handlers.changeRpe}
            rpeResetSignal={rpeErrorToken}
          />
        </div>

        {loggingStep ? (
          <WorkoutLoggingStepFooter
            step={loggingStep}
            onBack={() => setLoggingStep(1)}
            onContinue={() => setLoggingStep(2)}
            onCancel={() => setLoggingStep(null)}
            onFinish={() => setLoggingStep(null)}
          />
        ) : (
          <WorkoutDetailFooter
            isPlanned={isPlanned}
            canMarkComplete={onMarkComplete != null}
            completeBusy={completeAction.busy}
            completeLabel={completeAction.label}
            saveBusy={saveInFlight || planCoachNote.isRegenerating}
            savedAt={saveClickedAt}
            showCoachNoteHint={isPlanned && entry.planDayId != null}
            saveDisabled={planCoachNote.isCoolingDown}
            onSaveClick={handleSaveClick}
            onMarkComplete={handleFooterMarkComplete}
            onDone={onClose}
          />
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
              onClick={handleConfirmDelete}
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

type PlanPrescriptionDraft = Record<PrescriptionField, string | null>;

function buildPlanPrescriptionDraft(
  entry: TimelineEntry | null | undefined,
): PlanPrescriptionDraft {
  return {
    mainWorkout: entry?.mainWorkout ?? null,
    accessory: entry?.accessory ?? null,
    notes: entry?.notes ?? null,
  };
}

function normalizePrescriptionDraft(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

type PlanSetsController = ReturnType<typeof usePlanDayExercises>;
type RegenerateCoachNote = ReturnType<typeof usePlanDayCoachNote>["regenerate"]["mutate"];
type ReparseTextOptions = { onSuccess?: () => void };
type ReparseImageOptions = { onSuccess?: (data: ReparseResponse) => void };

interface WorkoutSaveCoordinatorArgs {
  readonly entryId: string | undefined;
  readonly planSets: PlanSetsController;
  readonly isSavingLoggedSets: boolean;
  readonly regenerateMutate: RegenerateCoachNote;
}

function useWorkoutDetailSaveCoordinator({
  entryId,
  planSets,
  isSavingLoggedSets,
  regenerateMutate,
}: WorkoutSaveCoordinatorArgs) {
  const [saveClickedAt, setSaveClickedAt] = useState<number | null>(null);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [saveTargetPlanDayId, setSaveTargetPlanDayId] = useState<string | null>(null);
  const saveRegenerateFiredRef = useRef(false);
  const currentEntryIdRef = useRef<string | undefined>(entryId);

  useEffect(() => {
    currentEntryIdRef.current = entryId;
  }, [entryId]);

  const [lastEntryId, setLastEntryId] = useState<string | undefined>(entryId);
  if (entryId !== lastEntryId) {
    setLastEntryId(entryId);
    setSaveClickedAt(null);
    setSaveInFlight(false);
    setSaveTargetPlanDayId(null);
  }

  useEffect(() => {
    if (!saveInFlight) {
      saveRegenerateFiredRef.current = false;
      return;
    }
    if (planSets.isSaving || isSavingLoggedSets) return;
    if (saveRegenerateFiredRef.current) return;

    saveRegenerateFiredRef.current = true;
    const targetEntryId = entryId;
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
      return;
    }

    finalizeSuccess();
  }, [saveInFlight, planSets.isSaving, isSavingLoggedSets, saveTargetPlanDayId, regenerateMutate, entryId]);

  return {
    saveClickedAt,
    saveInFlight,
    startSaveCycle: setSaveTargetPlanDayIdAndMarkPending,
  };

  function setSaveTargetPlanDayIdAndMarkPending(targetPlanDayId: string | null) {
    setSaveTargetPlanDayId(targetPlanDayId);
    setSaveInFlight(true);
  }
}

interface WorkoutDetailSaveClickArgs {
  readonly isPlanned: boolean;
  readonly planDayId: string | null;
  readonly planSets: PlanSetsController;
  readonly flushLoggedSetPatches: () => void;
  readonly startSaveCycle: (targetPlanDayId: string | null) => void;
}

function handleWorkoutDetailSaveClick({
  isPlanned,
  planDayId,
  planSets,
  flushLoggedSetPatches,
  startSaveCycle,
}: WorkoutDetailSaveClickArgs) {
  blurActiveElement();
  planSets.flushPendingSetPatches();
  flushLoggedSetPatches();
  startSaveCycle(isPlanned ? planDayId : null);
}

interface CompleteActionState {
  readonly busy: boolean;
  readonly label: string;
}

function getCompleteActionState(isMarkingComplete: boolean, isSavingPlanSets: boolean): CompleteActionState {
  if (isMarkingComplete) return { busy: true, label: "Logging..." };
  if (isSavingPlanSets) return { busy: true, label: "Saving edits..." };
  return { busy: false, label: "Log workout" };
}

interface MarkCompleteArgs {
  readonly entry: TimelineEntry;
  readonly latestFocus: string;
  readonly latestPrescription: PlanPrescriptionDraft;
  readonly onMarkComplete?: (entry: TimelineEntry) => void;
}

function handleWorkoutDetailMarkComplete({
  entry,
  latestFocus,
  latestPrescription,
  onMarkComplete,
}: MarkCompleteArgs) {
  blurActiveElement();
  if (!onMarkComplete) return;

  const focus = (latestFocus.trim() || entry.focus).trim();
  // Carry the latest in-progress prescription edits into the payload so
  // useWorkoutActions.handleMarkComplete (which reads
  // entry.mainWorkout/accessory/notes verbatim) doesn't post stale text
  // when the user edits the prescription and clicks Log workout before
  // the planSets.updatePrescription save round-trips back through the
  // timeline cache.
  const mainWorkout = normalizePrescriptionDraft(latestPrescription.mainWorkout) ?? "";
  const accessory = normalizePrescriptionDraft(latestPrescription.accessory);
  const notes = normalizePrescriptionDraft(latestPrescription.notes);

  const focusChanged = focus !== entry.focus;
  const mainChanged = mainWorkout !== (entry.mainWorkout ?? "");
  const accessoryChanged = accessory !== (entry.accessory ?? null);
  const notesChanged = notes !== (entry.notes ?? null);

  if (!focusChanged && !mainChanged && !accessoryChanged && !notesChanged) {
    onMarkComplete(entry);
    return;
  }
  onMarkComplete({ ...entry, focus, mainWorkout, accessory, notes });
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

interface OpenChatHandlerArgs {
  readonly aiCoachEnabled: boolean;
  readonly onRequestCoachConsent: (() => void) | undefined;
  readonly onAskCoachOpen: (() => void) | undefined;
  readonly openChat: () => void;
}

function buildOpenChatHandler({
  aiCoachEnabled,
  onRequestCoachConsent,
  onAskCoachOpen,
  openChat,
}: OpenChatHandlerArgs) {
  return () => {
    if (!aiCoachEnabled) {
      onRequestCoachConsent?.();
      return;
    }

    onAskCoachOpen?.();
    openChat();
  };
}

function buildSaveNoteHandler(workoutId: string | null, saveNote: (note: string | null) => void) {
  return (note: string | null) => {
    if (workoutId) saveNote(note);
  };
}

function buildLoggedFreeTextParser(
  workoutId: string | null,
  parse: (variables: undefined, opts?: ReparseTextOptions) => void,
) {
  return (opts?: ReparseTextOptions) => {
    if (!workoutId) return;
    parse(undefined, opts);
  };
}

function buildLoggedImageParser(
  workoutId: string | null,
  parse: (payload: ParseFromImagePayload, opts?: ReparseImageOptions) => void,
) {
  return (payload: ParseFromImagePayload, opts?: ReparseImageOptions) => {
    if (!workoutId) return;
    parse(payload, opts);
  };
}

interface DeleteConfirmArgs {
  readonly entry: TimelineEntry;
  readonly onDelete: ((entry: TimelineEntry) => void) | undefined;
  readonly closeDeleteConfirm: () => void;
}

function handleWorkoutDetailDeleteConfirm({ entry, onDelete, closeDeleteConfirm }: DeleteConfirmArgs) {
  onDelete?.(entry);
  closeDeleteConfirm();
}

interface WorkoutDetailFooterProps {
  readonly isPlanned: boolean;
  readonly canMarkComplete: boolean;
  readonly completeBusy: boolean;
  readonly completeLabel: string;
  readonly saveBusy: boolean;
  readonly savedAt: number | null;
  readonly showCoachNoteHint: boolean;
  readonly saveDisabled: boolean;
  readonly onSaveClick: () => void;
  readonly onMarkComplete: () => void;
  readonly onDone: () => void;
}

function WorkoutDetailFooter({
  isPlanned,
  canMarkComplete,
  completeBusy,
  completeLabel,
  saveBusy,
  savedAt,
  showCoachNoteHint,
  saveDisabled,
  onSaveClick,
  onMarkComplete,
  onDone,
}: WorkoutDetailFooterProps) {
  const copy = getFooterCopy(isPlanned);
  const saveEmphasis = isPlanned ? "secondary" : "primary";
  const saveLabel = isPlanned ? "Save prescription" : "Save changes";
  const showLogWorkout = isPlanned && canMarkComplete;

  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{copy.title}</span>
        <span className="ml-2">{copy.description}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <SaveWorkoutButton
          isBusy={saveBusy}
          savedAt={savedAt}
          showCoachNoteHint={showCoachNoteHint}
          emphasis={saveEmphasis}
          label={saveLabel}
          disabled={saveDisabled}
          onClick={onSaveClick}
        />
        {!isPlanned && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDone}
            data-testid="workout-detail-done"
          >
            Done
          </Button>
        )}
        {showLogWorkout ? (
          <Button
            type="button"
            size="sm"
            className="gap-2"
            disabled={completeBusy}
            onClick={onMarkComplete}
            data-testid="workout-detail-log-workout"
          >
            <CompleteActionIcon busy={completeBusy} />
            {completeLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function getFooterCopy(isPlanned: boolean) {
  return isPlanned
    ? { title: "Planned workout", description: "Log it to enter actuals step by step." }
    : { title: "Logged workout", description: "Review first. Edit only what changed." };
}

interface WorkoutLoggingStepFooterProps {
  readonly step: 1 | 2;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onCancel: () => void;
  readonly onFinish: () => void;
}

function WorkoutLoggingStepFooter({
  step,
  onBack,
  onContinue,
  onCancel,
  onFinish,
}: WorkoutLoggingStepFooterProps) {
  return (
    <div
      className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between"
      data-testid="workout-logging-step-footer"
    >
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Step {step} of 2</span>
        <span className="ml-2">
          {step === 1
            ? "Edit the seeded sets to match what you actually did."
            : "Add an RPE and a quick note about how it felt."}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {step === 1 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            data-testid="workout-logging-step-cancel"
          >
            Skip for now
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onBack}
            data-testid="workout-logging-step-back"
          >
            Back
          </Button>
        )}
        {step === 1 ? (
          <Button
            type="button"
            size="sm"
            onClick={onContinue}
            data-testid="workout-logging-step-continue"
          >
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="gap-2"
            onClick={onFinish}
            data-testid="workout-logging-step-finish"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            Finish
          </Button>
        )}
      </div>
    </div>
  );
}

function CompleteActionIcon({ busy }: Readonly<{ busy: boolean }>) {
  return busy ? (
    <Loader2 className="size-4 animate-spin" aria-hidden />
  ) : (
    <CheckCircle2 className="size-4" aria-hidden />
  );
}

const LOGGING_STEP_LABELS: Record<1 | 2, string> = {
  1: "Log actuals",
  2: "Reflect",
};

// Visual pattern matches /log's StepIndicator (LogWorkoutStepperLayout.tsx)
// — numbered chip, connector line, Check icon when done — so users moving
// between the in-dialog stepper and the standalone /log surface see the
// same pacing cues. Inlined rather than extracted because the standalone
// stepper has 3 fixed steps while this one has 2; the abstraction isn't
// justified for two callers with different shapes.
function WorkoutLoggingStepHeader({ current }: Readonly<{ current: 1 | 2 }>) {
  const steps: (1 | 2)[] = [1, 2];
  return (
    <ol
      className="flex items-center gap-2"
      aria-label="Workout logging progress"
      data-testid="workout-logging-step-indicator"
    >
      {steps.map((s, idx) => {
        const isActive = s === current;
        const isDone = s < current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5",
                isActive && "bg-primary/10 text-primary",
                isDone && "text-muted-foreground",
              )}
              data-testid={`workout-logging-step-${s}`}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isActive && "bg-primary text-primary-foreground",
                  isDone && "bg-muted text-muted-foreground",
                  !isActive && !isDone && "border border-border text-muted-foreground",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : s}
              </span>
              <span className="text-sm font-medium">{LOGGING_STEP_LABELS[s]}</span>
            </span>
            {idx < steps.length - 1 && (
              <span
                className={cn("h-px flex-1 bg-border", isDone && "bg-primary/40")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
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
   * Tracks in-progress prescription edits so the dialog can carry them
   * into the Log workout payload before the planSets save round-trips
   * back through the timeline cache.
   */
  readonly onDraftPrescriptionChange: (field: PrescriptionField, value: string) => void;
  readonly onSaveNote: (note: string | null) => void;
  /**
   * Active in-dialog logging step, or null when the user is not in the
   * guided flow. When non-null we hide the sidebar and only render the
   * step-relevant section so the surface stays focused (mirrors the
   * /log stepper's UX without the page navigation).
   */
  readonly loggingStep: 1 | 2 | null;
  /**
   * Parse trigger for the logged-workout free-text prescription when
   * available. Planned entries parse via usePlanDayExercises.
   */
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
  readonly showAdherenceInsights: boolean;
  readonly onOpenChat: () => void;
  readonly onCloseChat: () => void;
  readonly onChangeRpe?: (rpe: number | null) => void;
  readonly rpeResetSignal: number;
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

interface DialogBodyComputedState {
  readonly focusLabel: string;
  readonly referenceMainWorkout: string | null | undefined;
  readonly referenceAccessory: string | null | undefined;
  readonly referenceNotes: string | null | undefined;
  readonly loggedTextDiffFields: string[];
  readonly plannedVsActual: PlannedVsActualSummary | null;
  readonly chatSeed: string;
  readonly complianceTag: { label: string; className: string } | null;
  readonly detailAdherencePct: number | null;
}

function buildDialogBodyComputedState(args: {
  readonly entry: TimelineEntry;
  readonly workout: (import("@shared/schema").WorkoutLog & { exerciseSets?: ExerciseSet[]; notes?: string | null }) | undefined;
  readonly isPlanned: boolean;
  readonly planDayId: string | null;
  readonly plannedSets: ExerciseSet[];
  readonly loggedSets: ExerciseSet[];
  readonly showAdherenceInsights: boolean;
}): DialogBodyComputedState {
  const { entry, workout, isPlanned, planDayId, plannedSets, loggedSets, showAdherenceInsights } = args;
  const focusLabel = entry.focus?.trim() || "this workout";
  const referenceMainWorkout = isPlanned
    ? entry.mainWorkout
    : workout?.prescribedMainWorkout ?? entry.mainWorkout;
  const referenceAccessory = isPlanned
    ? entry.accessory
    : workout?.prescribedAccessory ?? entry.accessory;
  const referenceNotes = isPlanned
    ? entry.notes
    : workout?.prescribedNotes ?? entry.notes;

  const hasPrescriptionSnapshot = !!(
    workout?.prescribedMainWorkout ||
    workout?.prescribedAccessory ||
    workout?.prescribedNotes
  );
  const loggedTextDiffFields = isPlanned || !hasPrescriptionSnapshot
    ? []
    : getLoggedPrescriptionDiffFields({
      prescribedMainWorkout: workout?.prescribedMainWorkout ?? null,
      prescribedAccessory: workout?.prescribedAccessory ?? null,
      prescribedNotes: workout?.prescribedNotes ?? null,
      actualMainWorkout: workout?.mainWorkout ?? entry.mainWorkout ?? null,
      actualAccessory: workout?.accessory ?? entry.accessory ?? null,
      actualNotes: workout?.notes ?? entry.notes ?? null,
    });

  // Prefer the persisted snapshot so later plan-day edits don't
  // retroactively change a completed workout's compliance.
  const plannedVsActual = computePlannedVsActual({
    isPlanned,
    planDayId,
    workout,
    plannedSets,
    loggedSets,
  });
  const chatSeed = buildCoachChatSeed({
    focusLabel,
    isPlanned,
    plannedVsActual,
  });
  const complianceTag = plannedVsActual?.compliancePct == null
    ? null
    : classifyCompliance(plannedVsActual.compliancePct);
  const detailAdherencePct = showAdherenceInsights
    ? workout?.compliancePct ?? plannedVsActual?.compliancePct ?? null
    : null;
  return {
    focusLabel,
    referenceMainWorkout,
    referenceAccessory,
    referenceNotes,
    loggedTextDiffFields,
    plannedVsActual,
    chatSeed,
    complianceTag,
    detailAdherencePct,
  };
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
    onUpdateSet,
    onAddSet,
    onDeleteSet,
    loggedSaveState,
    planSets,
    planCoachNote,
    onDraftPrescriptionChange,
    onSaveNote,
    loggingStep,
    onParseLoggedFreeText,
    isParsingLogged,
    onParseLoggedFromImage,
    isParsingLoggedImage,
    chatOpen,
    showAdherenceInsights,
    onOpenChat,
    onCloseChat,
    onChangeRpe,
    rpeResetSignal,
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
  const onSavePrescriptionField = (field: PrescriptionField, value: string) => {
    const normalized = value.trim().length === 0 ? null : value;
    if (isPlanned && planDayId) {
      planSets.updatePrescription.mutate({ [field]: normalized });
    }
  };
  // Keep parse available for logged workouts so legacy/imported entries
  // with free text but no structured sets can reach the Parse path.
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

  const {
    focusLabel,
    referenceMainWorkout,
    referenceAccessory,
    referenceNotes,
    loggedTextDiffFields,
    plannedVsActual,
    chatSeed,
    complianceTag,
    detailAdherencePct,
  } = buildDialogBodyComputedState({
    entry,
    workout,
    isPlanned,
    planDayId,
    plannedSets: planSets.exerciseSets,
    loggedSets: exerciseSets,
    showAdherenceInsights,
  });

  const prescriptionPanel = (
    <CoachPrescriptionCollapsible
      title={isPlanned ? "Coach's prescription" : "Reference/Notes"}
      compact={!isPlanned}
      mainWorkout={referenceMainWorkout}
      accessory={referenceAccessory}
      notes={referenceNotes}
      open={parseControls.prescriptionOpen}
      onOpenChange={parseControls.setPrescriptionOpen}
      onSaveField={isPlanned ? onSavePrescriptionField : undefined}
      onDraftFieldChange={isPlanned ? onDraftPrescriptionChange : undefined}
      onParse={parseReady ? parseControls.onParseClicked : undefined}
      isParsing={parseControls.isParsing}
      onCapture={parseReady ? parseControls.onCapture : undefined}
      imagePreview={parseControls.imagePreview}
      onRetakeImage={parseControls.clearImagePreview}
      onParseImage={parseControls.onParseImageClicked}
      isParsingImage={parseControls.isParsingImage}
    />
  );

  const textDiffNote = !isPlanned && loggedTextDiffFields.length > 0 && (
    <div
      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
      data-testid="logged-prescription-diff-note"
    >
      Updated after completion: {loggedTextDiffFields.join(", ")}.
    </div>
  );

  const plannedActualSummary =
    !isPlanned && showAdherenceInsights && plannedVsActual?.hasComparisonData ? (
      <PlannedActualSummary
        plannedVsActual={plannedVsActual}
        complianceTag={complianceTag}
      />
    ) : null;

  const parseConfirmDialog = (
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
  );

  const sidebar = chatOpen ? (
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
      {!isPlanned && (
        <HistoryPanel
          stats={history}
          adherencePct={detailAdherencePct}
          isLoading={isLoading}
        />
      )}
    </>
  );

  if (loggingStep) {
    return (
      <StepperContent
        loggingStep={loggingStep}
        prescriptionPanel={prescriptionPanel}
        parseConfirmDialog={parseConfirmDialog}
        workout={workout}
        workoutId={workoutId}
        exerciseSets={exerciseSets}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onUpdateSet={onUpdateSet}
        onAddSet={onAddSet}
        onDeleteSet={onDeleteSet}
        loggedSaveState={loggedSaveState}
        hasUnparsedText={hasUnparsedText}
        onChangeRpe={onChangeRpe}
        rpeResetSignal={rpeResetSignal}
        onSaveNote={onSaveNote}
      />
    );
  }

  return (
    <WorkoutDetailGuidedLayout sidebar={sidebar} chatOpen={chatOpen}>
      {isPlanned ? (
        <PlannedWorkoutDetailContent>
          <WorkoutDetailOverview>
            <PlannedOverviewSummary
              exerciseCount={countSetsByExercise(planSets.exerciseSets).size}
              setCount={planSets.exerciseSets.length}
              hasPrescriptionText={hasUnparsedText}
            />
          </WorkoutDetailOverview>
          <WorkoutDetailSection title="Prescription" testId="workout-detail-prescription-section">
            {prescriptionPanel}
          </WorkoutDetailSection>
          <WorkoutDetailSection title="Exercises" testId="workout-detail-exercises-section">
            <PlannedCallToAction
              entry={entry}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              planSets={planSets}
              hasUnparsedText={hasUnparsedText}
            />
          </WorkoutDetailSection>
        </PlannedWorkoutDetailContent>
      ) : (
        <CompletedWorkoutDetailContent>
          {workout && (
            <WorkoutDetailOverview>
              <WorkoutStatsRow
                workout={workout}
                exerciseSets={exerciseSets}
                onChangeRpe={onChangeRpe}
                reviewFirst
                rpeResetSignal={rpeResetSignal}
              />
            </WorkoutDetailOverview>
          )}
          <WorkoutDetailSection title="Exercises" testId="workout-detail-exercises-section">
            {prescriptionPanel}
            {textDiffNote}
            {plannedActualSummary}
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
              showPlannedDiffs
            />
          </WorkoutDetailSection>
          <WorkoutDetailReflection>
            <AthleteNoteInput
              value={workout?.notes}
              onSave={onSaveNote}
              disabled={!workoutId}
              reviewFirst
            />
          </WorkoutDetailReflection>
        </CompletedWorkoutDetailContent>
      )}
      {parseConfirmDialog}
    </WorkoutDetailGuidedLayout>
  );
}

interface StepperContentProps {
  readonly loggingStep: 1 | 2;
  readonly prescriptionPanel: ReactNode;
  readonly parseConfirmDialog: ReactNode;
  readonly workout:
    | (import("@shared/schema").WorkoutLog & { exerciseSets?: ExerciseSet[]; notes?: string | null })
    | undefined;
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly loggedSaveState: { isSaving: boolean; lastSavedAt: number | null };
  readonly hasUnparsedText: boolean;
  readonly onChangeRpe?: (rpe: number | null) => void;
  readonly rpeResetSignal: number;
  readonly onSaveNote: (note: string | null) => void;
}

// Renders the in-dialog logging flow's body. Extracted from DialogBody so
// the parent stays under Sonar's cognitive-complexity ceiling — nested
// step ternaries + workout/workoutId guards inflate that score quickly.
function StepperContent({
  loggingStep,
  prescriptionPanel,
  parseConfirmDialog,
  workout,
  workoutId,
  exerciseSets,
  weightUnit,
  distanceUnit,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  loggedSaveState,
  hasUnparsedText,
  onChangeRpe,
  rpeResetSignal,
  onSaveNote,
}: Readonly<StepperContentProps>) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6" data-testid="workout-logging-stepper">
      <WorkoutLoggingStepHeader current={loggingStep} />
      {loggingStep === 1 ? (
        <StepperLogActuals
          prescriptionPanel={prescriptionPanel}
          workoutId={workoutId}
          exerciseSets={exerciseSets}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onUpdateSet={onUpdateSet}
          onAddSet={onAddSet}
          onDeleteSet={onDeleteSet}
          loggedSaveState={loggedSaveState}
          hasUnparsedText={hasUnparsedText}
        />
      ) : (
        <StepperReflect
          workout={workout}
          workoutId={workoutId}
          exerciseSets={exerciseSets}
          onChangeRpe={onChangeRpe}
          rpeResetSignal={rpeResetSignal}
          onSaveNote={onSaveNote}
        />
      )}
      {parseConfirmDialog}
    </div>
  );
}

interface StepperLogActualsProps {
  readonly prescriptionPanel: ReactNode;
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onUpdateSet: (setId: string, data: import("@/lib/api").PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: import("@/lib/api").AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly loggedSaveState: { isSaving: boolean; lastSavedAt: number | null };
  readonly hasUnparsedText: boolean;
}

function StepperLogActuals({
  prescriptionPanel,
  workoutId,
  exerciseSets,
  weightUnit,
  distanceUnit,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  loggedSaveState,
  hasUnparsedText,
}: Readonly<StepperLogActualsProps>) {
  return (
    <WorkoutDetailSection title="Log actuals" testId="workout-logging-step-actuals">
      {prescriptionPanel}
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
        showPlannedDiffs
      />
    </WorkoutDetailSection>
  );
}

interface StepperReflectProps {
  readonly workout:
    | (import("@shared/schema").WorkoutLog & { exerciseSets?: ExerciseSet[]; notes?: string | null })
    | undefined;
  readonly workoutId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly onChangeRpe?: (rpe: number | null) => void;
  readonly rpeResetSignal: number;
  readonly onSaveNote: (note: string | null) => void;
}

function StepperReflect({
  workout,
  workoutId,
  exerciseSets,
  onChangeRpe,
  rpeResetSignal,
  onSaveNote,
}: Readonly<StepperReflectProps>) {
  return (
    <>
      {workout && (
        <WorkoutDetailOverview>
          <WorkoutStatsRow
            workout={workout}
            exerciseSets={exerciseSets}
            onChangeRpe={onChangeRpe}
            reviewFirst
            rpeResetSignal={rpeResetSignal}
          />
        </WorkoutDetailOverview>
      )}
      <WorkoutDetailReflection>
        <AthleteNoteInput
          value={workout?.notes}
          onSave={onSaveNote}
          disabled={!workoutId}
          reviewFirst
        />
      </WorkoutDetailReflection>
    </>
  );
}

interface LoggedPrescriptionDiffInput {
  readonly prescribedMainWorkout: string | null;
  readonly prescribedAccessory: string | null;
  readonly prescribedNotes: string | null;
  readonly actualMainWorkout: string | null;
  readonly actualAccessory: string | null;
  readonly actualNotes: string | null;
}

function getLoggedPrescriptionDiffFields(input: LoggedPrescriptionDiffInput): string[] {
  const out: string[] = [];
  if (!sameText(input.prescribedMainWorkout, input.actualMainWorkout)) out.push("Main");
  if (!sameText(input.prescribedAccessory, input.actualAccessory)) out.push("Accessory");
  if (!sameText(input.prescribedNotes, input.actualNotes)) out.push("Notes");
  return out;
}

function sameText(a: string | null, b: string | null): boolean {
  return normalizeText(a) === normalizeText(b);
}

function normalizeText(v: string | null): string {
  return (v ?? "").trim().replaceAll(/\s+/g, " ");
}

interface PlannedVsActualSummary {
  readonly hasComparisonData: boolean;
  readonly plannedSets: number;
  readonly actualSets: number;
  readonly matchedSets: number;
  readonly compliancePct: number | null;
  readonly addedSets: number;
  readonly removedSets: number;
  readonly addedExercises: readonly string[];
  readonly removedExercises: readonly string[];
}

function PlannedActualSummary({
  plannedVsActual,
  complianceTag,
}: Readonly<{
  plannedVsActual: PlannedVsActualSummary;
  complianceTag: { label: string; className: string } | null;
}>) {
  const setSummaryParts = [
    `${plannedVsActual.plannedSets} planned set${plannedVsActual.plannedSets === 1 ? "" : "s"}`,
    `${plannedVsActual.actualSets} logged set${plannedVsActual.actualSets === 1 ? "" : "s"}`,
  ];
  if (plannedVsActual.addedSets > 0) {
    setSummaryParts.push(`${plannedVsActual.addedSets} added`);
  }
  if (plannedVsActual.removedSets > 0) {
    setSummaryParts.push(`${plannedVsActual.removedSets} removed`);
  }

  return (
    <div
      className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      data-testid="planned-actual-summary"
    >
      <span className="font-medium text-foreground">Planned vs Actual:</span>{" "}
      {setSummaryParts.join(", ")}
      {plannedVsActual.compliancePct != null && (
        <div className="mt-1">
          <span className="font-medium text-foreground">Compliance:</span>{" "}
          {plannedVsActual.compliancePct}% ({plannedVsActual.matchedSets}/{plannedVsActual.plannedSets} planned sets matched)
          {complianceTag && (
            <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium", complianceTag.className)}>
              {complianceTag.label}
            </span>
          )}
        </div>
      )}
      {plannedVsActual.addedExercises.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Added:</span>{" "}
          {plannedVsActual.addedExercises.join(", ")}
        </div>
      )}
      {plannedVsActual.removedExercises.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Removed:</span>{" "}
          {plannedVsActual.removedExercises.join(", ")}
        </div>
      )}
    </div>
  );
}

function PlannedOverviewSummary({
  exerciseCount,
  setCount,
  hasPrescriptionText,
}: Readonly<{
  exerciseCount: number;
  setCount: number;
  hasPrescriptionText: boolean;
}>) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm" data-testid="planned-overview-summary">
      <OverviewMetric label="Exercises" value={exerciseCount} />
      <OverviewMetric label="Sets" value={setCount} />
      <OverviewMetric label="Prescription" value={hasPrescriptionText ? "Text" : "Rows"} />
    </div>
  );
}

function OverviewMetric({
  label,
  value,
}: Readonly<{
  label: string;
  value: number | string;
}>) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function computePlannedVsActual(args: {
  readonly isPlanned: boolean;
  readonly planDayId: string | null;
  readonly workout: Parameters<typeof buildPlannedVsActualFromSnapshot>[0];
  readonly plannedSets: ExerciseSet[];
  readonly loggedSets: ExerciseSet[];
}): PlannedVsActualSummary | null {
  if (args.isPlanned) return null;
  const snapshot = buildPlannedVsActualFromSnapshot(args.workout);
  if (snapshot) return snapshot;
  if (!args.planDayId) return null;
  return summarizePlannedVsActual(args.plannedSets, args.loggedSets);
}

// Returns null when no snapshot exists so the caller can fall back to a
// live comparison. Per-exercise added/removed labels aren't snapshotted.
function buildPlannedVsActualFromSnapshot(
  workout: { plannedSetCount?: number | null; actualSetCount?: number | null; matchedSetCount?: number | null; addedSetCount?: number | null; removedSetCount?: number | null; compliancePct?: number | null } | undefined,
): PlannedVsActualSummary | null {
  if (workout?.plannedSetCount == null) return null;
  const plannedSets = workout.plannedSetCount;
  const actualSets = workout.actualSetCount ?? 0;
  return {
    hasComparisonData: plannedSets > 0 || actualSets > 0,
    plannedSets,
    actualSets,
    matchedSets: workout.matchedSetCount ?? 0,
    compliancePct: workout.compliancePct ?? null,
    addedSets: workout.addedSetCount ?? 0,
    removedSets: workout.removedSetCount ?? 0,
    addedExercises: [],
    removedExercises: [],
  };
}

function summarizePlannedVsActual(
  planned: ExerciseSet[],
  actual: ExerciseSet[],
): PlannedVsActualSummary {
  const plannedCounts = countSetsByExercise(planned);
  const actualCounts = countSetsByExercise(actual);
  const keys = new Set([...plannedCounts.keys(), ...actualCounts.keys()]);

  let addedSets = 0;
  let removedSets = 0;
  let matchedSets = 0;
  const addedExercises: string[] = [];
  const removedExercises: string[] = [];
  for (const key of keys) {
    const plannedCount = plannedCounts.get(key) ?? 0;
    const actualCount = actualCounts.get(key) ?? 0;
    matchedSets += Math.min(plannedCount, actualCount);
    if (actualCount > plannedCount) {
      const delta = actualCount - plannedCount;
      addedSets += delta;
      addedExercises.push(`${formatExerciseLabel(key)} ×${delta}`);
    }
    if (plannedCount > actualCount) {
      const delta = plannedCount - actualCount;
      removedSets += delta;
      removedExercises.push(`${formatExerciseLabel(key)} ×${delta}`);
    }
  }

  return {
    hasComparisonData: planned.length > 0 || actual.length > 0,
    plannedSets: planned.length,
    actualSets: actual.length,
    matchedSets,
    compliancePct: planned.length > 0 ? Math.round((matchedSets / planned.length) * 100) : null,
    addedSets,
    removedSets,
    addedExercises,
    removedExercises,
  };
}

function countSetsByExercise(sets: ExerciseSet[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const set of sets) {
    const key = normalizeExerciseLabel(set);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function normalizeExerciseLabel(set: ExerciseSet): string {
  return (set.customLabel || set.exerciseName || "").toLowerCase().trim();
}

function formatExerciseLabel(label: string): string {
  return label.replaceAll("_", " ");
}

function classifyCompliance(pct: number): { label: string; className: string } {
  if (pct >= 85) {
    return { label: "High adherence", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
  }
  if (pct >= 60) {
    return { label: "Moderate adherence", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  }
  return { label: "Low adherence", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" };
}

function hasPrescriptionText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function buildCoachChatSeed(args: {
  readonly focusLabel: string;
  readonly isPlanned: boolean;
  readonly plannedVsActual: PlannedVsActualSummary | null;
}): string {
  const { focusLabel, isPlanned, plannedVsActual } = args;
  const base = `Can you walk me through your take on my ${focusLabel} workout?`;
  if (isPlanned || plannedVsActual?.compliancePct == null) return base;

  const details: string[] = [
    `compliance was ${plannedVsActual.compliancePct}%`,
    `${plannedVsActual.matchedSets}/${plannedVsActual.plannedSets} planned sets matched`,
  ];
  if (plannedVsActual.addedSets > 0) details.push(`${plannedVsActual.addedSets} added sets`);
  if (plannedVsActual.removedSets > 0) details.push(`${plannedVsActual.removedSets} removed sets`);

  return `${base} For context: ${details.join(", ")}.`;
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
  readonly showPlannedDiffs?: boolean;
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
  showPlannedDiffs = false,
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
      showPlannedDiffs={showPlannedDiffs}
    />
  );
}

interface PlannedCallToActionProps {
  readonly entry: TimelineEntry;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly planSets: ReturnType<typeof usePlanDayExercises>;
  readonly hasUnparsedText?: boolean;
}

function PlannedCallToAction({ entry, weightUnit, distanceUnit, planSets, hasUnparsedText }: Readonly<PlannedCallToActionProps>) {
  // Plan-day-backed exercise edits. `planSets` is hoisted up to DialogBody
  // so the same hook instance feeds both this CTA and the CoachTakePanel's
  // staleness comparison. Writes go to plan_day-owned exerciseSets; Mark
  // complete's server copy-from-plan path copies whatever this hook has
  // persisted into the new workoutLog at log time.
  const planDayId = entry.planDayId ?? null;

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
          Planned sets are ready for review.
        </p>
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
