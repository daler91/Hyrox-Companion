import type { TimelineEntry } from "@shared/schema";
import { Check, Dumbbell, Gauge, MessageSquare, SkipForward } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { StructureBlocksEditor } from "@/components/workout-structure";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { featureFlags } from "@/lib/featureFlags";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";
import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { ExerciseTable } from "./ExerciseTable";
import { FuellingPlanPanel } from "./FuellingPlanPanel";
import { CoachRationaleSection, DetailSection } from "./shared/DetailSection";
import type { PrescriptionTextPayload } from "./shared/PrescriptionEditor";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { WorkoutContentsLayout } from "./shared/WorkoutContentsLayout";
import { WorkoutEffortNotes } from "./shared/WorkoutEffortNotes";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";
import { buildWorkoutSummaryStats, WorkoutSummaryHeader } from "./shared/WorkoutSummaryHeader";
import {
  getWorkoutCoachPanelState,
  WorkoutCoachChatPanel,
  WorkoutCoachLayout,
} from "./WorkoutCoachPanel";

interface LogSheetBaseProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly coachChatOpen?: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly mobileCoachPanelOpen?: boolean;
  readonly onCloseCoachChat?: () => void;
  readonly onShowCoachPanel?: () => void;
  readonly onShowWorkoutDetails?: () => void;
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle?: boolean;
}

type LogSheetModeProps =
  | {
      readonly mode?: "log";
      /** Complete the workout as prescribed, carrying an optional RPE + note. */
      readonly onLogAsPlanned: (
        entry: TimelineEntry,
        rpe: number | null,
        note: string | null,
      ) => Promise<void> | void;
      readonly isLogging?: boolean;
    }
  | {
      readonly mode: "edit";
      readonly onLogAsPlanned?: never;
      readonly isLogging?: never;
    };

type LogSheetProps = LogSheetBaseProps & LogSheetModeProps;

type PlanDayExerciseState = ReturnType<typeof usePlanDayExercises>;
type WorkoutWeightUnit = "kg" | "lb";
type WorkoutDistanceUnit = "km" | "miles";

// Local draft for the completion form (RPE + note). Both are seeded from
// the entry and reset when the sheet is reused for a different workout.
// The note carries the entry's existing notes so prior content isn't
// silently dropped when the workout is completed.
function useEntryDraft(entry: TimelineEntry | null) {
  const [rpe, setRpe] = useState<number | null>(entry?.rpe ?? null);
  const [note, setNote] = useState<string>(entry?.notes ?? "");
  const [lastEntryId, setLastEntryId] = useState<string | null>(entry?.id ?? null);

  if (entry && entry.id !== lastEntryId) {
    setLastEntryId(entry.id);
    setRpe(entry.rpe ?? null);
    setNote(entry.notes ?? "");
  }

  return { rpe, setRpe, note, setNote };
}

function getLogButtonLabel(isSaving: boolean, isLogging?: boolean): string {
  if (isSaving) return "Saving edits\u2026";
  if (isLogging) return "Completing\u2026";
  return "Complete workout";
}

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function hasPrescriptionText(entry: TimelineEntry): boolean {
  return hasText(entry.mainWorkout) || hasText(entry.accessory) || hasText(entry.notes);
}

function isParseHelperVisible(entry: TimelineEntry, planSets: PlanDayExerciseState): boolean {
  return !!entry.planDayId && planSets.parseFailed && planSets.exerciseSets.length === 0;
}

function getTitleSaveHandler(
  entry: TimelineEntry,
  onRenameTitle?: (entry: TimelineEntry, title: string) => void,
): ((title: string) => void) | undefined {
  if (!onRenameTitle) return undefined;
  if (!entry.workoutLogId && !entry.planDayId) return undefined;
  return (nextTitle) => onRenameTitle(entry, nextTitle);
}

interface LogSheetTitleProps {
  readonly entry: TimelineEntry;
  readonly mode: "edit" | "log";
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle: boolean;
}

function LogSheetTitle({
  entry,
  mode,
  onRenameTitle,
  isRenamingTitle,
}: LogSheetTitleProps) {
  return (
    <EditableWorkoutTitle
      title={entry.focus}
      fallbackTitle={mode === "edit" ? "Edit workout" : "Log workout"}
      onSave={getTitleSaveHandler(entry, onRenameTitle)}
      isSaving={isRenamingTitle}
      testIdPrefix={`workout-title-${entry.id}`}
    />
  );
}

interface PlannedPrescriptionProps {
  readonly entry: TimelineEntry;
  readonly planSets: PlanDayExerciseState;
  readonly weightUnit: WorkoutWeightUnit;
  readonly distanceUnit: WorkoutDistanceUnit;
  readonly parseHelperVisible: boolean;
  /**
   * Show the coach-note field inside the prescription editor. Off in log
   * mode, where the note lives in the prominent completion-form field
   * instead; on in edit mode, where the prescription editor is the only
   * place to revise the coach's note.
   */
  readonly showPrescriptionNotes: boolean;
}

function PlannedPrescription({
  entry,
  planSets,
  weightUnit,
  distanceUnit,
  parseHelperVisible,
  showPrescriptionNotes,
}: PlannedPrescriptionProps) {
  const hasUnparsedText = hasPrescriptionText(entry) && planSets.exerciseSets.length === 0;
  // The "Workout" card hosts autosaving editors — keep it an always-open
  // card: collapsing would unmount the editors and could drop debounced
  // cell edits.
  return (
    <DetailSection title="Workout" icon={Dumbbell} testId={`log-workout-${entry.id}`}>
      <WorkoutContentsLayout
        exerciseSets={planSets.exerciseSets}
        sourceLabel={hasUnparsedText ? "from coach text" : null}
        structureBlockCount={planSets.structureBlocks.length}
        isParsing={planSets.reparseFreeText.isPending || planSets.reparseFromImage.isPending}
        source={
          <PrescriptionEditor
            entryId={entry.id}
            hasSets={planSets.exerciseSets.length > 0}
            mainWorkout={entry.mainWorkout}
            accessory={entry.accessory}
            notes={entry.notes}
            showNotes={showPrescriptionNotes}
            onSaveField={(field, value) =>
              planSets.updatePrescription.mutate({
                [field]: value.trim().length === 0 ? null : value,
              })
            }
            onParseText={(payload: PrescriptionTextPayload) => planSets.reparseFreeText.mutate(payload)}
            onParseImage={(payload) => planSets.reparseFromImage.mutate(payload)}
            isParsingText={planSets.reparseFreeText.isPending}
            isParsingImage={planSets.reparseFromImage.isPending}
            title="Coach's text / photo"
            compact
          />
        }
        table={
          <ExerciseTable
            workoutId={entry.planDayId!}
            exerciseSets={planSets.exerciseSets}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdateSet={planSets.patchSetDebounced}
            onAddSet={planSets.addSet.mutate}
            onDeleteSet={planSets.deleteSet.mutate}
            saveState={{
              isSaving: planSets.isSaving,
              lastSavedAt: planSets.lastSavedAt,
              lastSaveErrorAt: planSets.lastSaveErrorAt,
            }}
            onOpenConversionHelper={() => planSets.reparseFreeText.mutate(undefined)}
            defaultExpanded
            hasUnparsedText={hasUnparsedText}
            structureBlocks={planSets.structureBlocks}
          />
        }
        belowTable={
          <ParseFailureAlert
            entryId={entry.id}
            visible={parseHelperVisible}
            retryParse={planSets.retryParse}
          />
        }
        structure={
          <StructureBlocksEditor
            value={planSets.structureBlocks}
            onChange={(next) => planSets.updateStructure.mutate(next)}
            exerciseSets={planSets.exerciseSets}
            onUpdateSet={planSets.patchSetDebounced}
            onAddSet={planSets.addSet.mutate}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            headerless
          />
        }
      />
    </DetailSection>
  );
}

interface ParseFailureAlertProps {
  readonly entryId: string;
  readonly visible: boolean;
  readonly retryParse: (() => void) | null;
}

function ParseFailureAlert({ entryId, visible, retryParse }: ParseFailureAlertProps) {
  if (!visible) return null;
  return (
    <output
      className="block rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
      data-testid={`log-parse-failed-${entryId}`}
    >
      <span className="block">
        Parse did not create exercise rows. You can still log this workout text-only.
      </span>
      {retryParse ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-warning"
          onClick={retryParse}
          data-testid={`log-parse-retry-${entryId}`}
        >
          Retry parse
        </Button>
      ) : null}
    </output>
  );
}

interface SecondaryLogActionsProps {
  readonly entry: TimelineEntry;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
}

function SecondaryLogActions({ entry, onAskCoach, onSkip }: SecondaryLogActionsProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {onAskCoach ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onAskCoach(entry)}
          data-testid={`log-ask-coach-${entry.id}`}
        >
          <MessageSquare className="mr-2 h-4 w-4" />
          Ask coach
        </Button>
      ) : null}
      {onSkip ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSkip(entry)}
          data-testid={`log-skip-${entry.id}`}
        >
          <SkipForward className="mr-2 h-4 w-4" />
          Skip
        </Button>
      ) : null}
    </div>
  );
}

interface LogCompletionControlsProps {
  readonly entry: TimelineEntry;
  readonly rpe: number | null;
  readonly setRpe: (rpe: number | null) => void;
  readonly note: string;
  readonly setNote: (note: string) => void;
  readonly onLog: () => void;
  readonly isLogging?: boolean;
  readonly isSaving: boolean;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
}

function LogCompletionControls({
  entry,
  rpe,
  setRpe,
  note,
  setNote,
  onLog,
  isLogging,
  isSaving,
  onSkip,
  onAskCoach,
}: LogCompletionControlsProps) {
  return (
    <>
      <DetailSection title="Effort & notes" icon={Gauge}>
        <WorkoutEffortNotes
          rpe={rpe}
          onRpeChange={setRpe}
          note={note}
          onNoteChange={(next) => setNote(next ?? "")}
        />
      </DetailSection>

      <Separator />

      <div className="space-y-2">
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onLog}
          disabled={isLogging || isSaving}
          data-testid={`log-as-planned-${entry.id}`}
        >
          <Check className="mr-2 h-4 w-4" />
          {getLogButtonLabel(isSaving, isLogging)}
        </Button>

        <SecondaryLogActions entry={entry} onAskCoach={onAskCoach} onSkip={onSkip} />
      </div>
    </>
  );
}

interface LogSheetPrescriptionContentProps {
  readonly entry: TimelineEntry;
  readonly planSets: PlanDayExerciseState;
  readonly weightUnit: WorkoutWeightUnit;
  readonly distanceUnit: WorkoutDistanceUnit;
  readonly isEditMode: boolean;
}

function LogSheetPrescriptionContent({
  entry,
  planSets,
  weightUnit,
  distanceUnit,
  isEditMode,
}: LogSheetPrescriptionContentProps) {
  if (!entry.planDayId) {
    return (
      <DetailSection title="Workout" icon={Dumbbell} testId={`log-workout-${entry.id}`}>
        <WorkoutPrescriptionSummary entry={entry} />
      </DetailSection>
    );
  }

  return (
    <PlannedPrescription
      entry={entry}
      planSets={planSets}
      weightUnit={weightUnit}
      distanceUnit={distanceUnit}
      parseHelperVisible={isParseHelperVisible(entry, planSets)}
      showPrescriptionNotes={isEditMode}
    />
  );
}

interface EditSecondaryActionsProps {
  readonly entry: TimelineEntry;
  readonly onDone: () => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
}

/**
 * Edit-mode footer. Edits autosave per cell, but a planned-workout edit
 * has no natural end state the way logging does — so a primary "Done"
 * gives the user an affirmative way to close the sheet (and flush any
 * debounced cell edits) instead of dismissing via the X.
 */
function EditSecondaryActions({ entry, onDone, onAskCoach, onSkip }: EditSecondaryActionsProps) {
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onDone}
          data-testid={`edit-done-${entry.id}`}
        >
          <Check className="mr-2 h-4 w-4" />
          Done
        </Button>
        {onAskCoach || onSkip ? (
          <SecondaryLogActions entry={entry} onAskCoach={onAskCoach} onSkip={onSkip} />
        ) : null}
      </div>
    </>
  );
}

interface LogSheetFooterProps {
  readonly entry: TimelineEntry;
  readonly isEditMode: boolean;
  readonly rpe: number | null;
  readonly setRpe: (rpe: number | null) => void;
  readonly note: string;
  readonly setNote: (note: string) => void;
  readonly onLog: () => void;
  readonly onDone: () => void;
  readonly isLogging?: boolean;
  readonly isSaving: boolean;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
}

function LogSheetFooter({
  entry,
  isEditMode,
  rpe,
  setRpe,
  note,
  setNote,
  onLog,
  onDone,
  isLogging,
  isSaving,
  onSkip,
  onAskCoach,
}: LogSheetFooterProps) {
  if (isEditMode) {
    return (
      <EditSecondaryActions
        entry={entry}
        onDone={onDone}
        onAskCoach={onAskCoach}
        onSkip={onSkip}
      />
    );
  }

  return (
    <LogCompletionControls
      entry={entry}
      rpe={rpe}
      setRpe={setRpe}
      note={note}
      setNote={setNote}
      onLog={onLog}
      isLogging={isLogging}
      isSaving={isSaving}
      onAskCoach={onAskCoach}
      onSkip={onSkip}
    />
  );
}

function getCoachExerciseSets(entry: TimelineEntry, planSets: PlanDayExerciseState) {
  if (entry.planDayId) return planSets.exerciseSets;
  return entry.exerciseSets ?? [];
}

function getAskCoachHandler(
  onAskCoach: LogSheetBaseProps["onAskCoach"],
  currentCoachSeedText: string,
) {
  if (!onAskCoach) return undefined;
  return (target: TimelineEntry) => onAskCoach(target, currentCoachSeedText);
}

/**
 * Sheet-native surface for planned cards. Single-tier:
 * the prescription editor is inline (no disclosure tap) so per-set
 * tweaks are one tap away. In log mode, edits autosave before the log
 * mutation copies them into a workoutLog. In edit mode, the same plan-day
 * editor saves future prescription changes without creating a workout log.
 * The free-text/photo "Replace prescription" affordance
 * stays in PrescriptionEditor (self-collapsed when sets exist) since
 * it's destructive and rarely needed for normal logging.
 */
export function LogSheet({
  entry,
  onClose,
  onLogAsPlanned,
  onSkip,
  onAskCoach,
  coachChatOpen = false,
  coachChatNonce,
  coachSeedText,
  mobileCoachPanelOpen = false,
  onCloseCoachChat,
  onShowCoachPanel,
  onShowWorkoutDetails,
  onRenameTitle,
  isRenamingTitle = false,
  isLogging,
  mode = "log",
}: LogSheetProps) {
  const isMobile = useIsMobile();
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
  const weightUnit: "kg" | "lb" = prefWeightUnit === "kg" ? "kg" : "lb";
  const { rpe, setRpe, note, setNote } = useEntryDraft(entry);
  const [completingEntryId, setCompletingEntryId] = useState<string | null>(null);
  const completionEntryIdRef = useRef<string | null>(null);

  const planSets = usePlanDayExercises(entry?.planDayId ?? null);

  if (!entry) return null;

  const isCompletingCurrentEntry = completingEntryId === entry.id;
  const finishCompletion = (submittedEntryId: string) => {
    if (completionEntryIdRef.current !== submittedEntryId) return;
    completionEntryIdRef.current = null;
    setCompletingEntryId(null);
  };

  const handleLog = async () => {
    if (!onLogAsPlanned) return;
    if (completionEntryIdRef.current === entry.id) return;
    const submittedEntryId = entry.id;
    completionEntryIdRef.current = submittedEntryId;
    setCompletingEntryId(submittedEntryId);
    // Flush any debounced cell edits before the log mutation runs — the
    // server's createWorkoutInTx copies persisted plan-day rows into
    // the new workoutLog, so a row edit still queued in the debounce
    // coordinator would be missing from the snapshot.
    try {
      await planSets.flushPendingSetPatches();
      await onLogAsPlanned(entry, rpe, note.trim().length > 0 ? note : null);
    } catch {
      finishCompletion(submittedEntryId);
      return;
    }
    finishCompletion(submittedEntryId);
  };

  const handleDone = async () => {
    // Flush debounced cell edits before unmounting the plan-day hook so
    // a row edit queued in the debounce coordinator isn't dropped.
    await planSets.flushPendingSetPatches();
    onClose();
  };

  const isEditMode = mode === "edit";
  const title = (
    <LogSheetTitle
      entry={entry}
      mode={mode}
      onRenameTitle={onRenameTitle}
      isRenamingTitle={isRenamingTitle}
    />
  );
  const coachExerciseSets = getCoachExerciseSets(entry, planSets);
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, coachExerciseSets);
  const handleAskCoach = getAskCoachHandler(onAskCoach, currentCoachSeedText);
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={formatScheduledDate(entry.date)}
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : "sm:max-w-2xl"}
      mobileFullHeight={coachPanel.coachPanelOpen}
      desktopFullHeight={coachChatOpen}
      testId={`log-sheet-${entry.id}`}
    >
      <WorkoutCoachLayout
        panelState={coachPanel}
        detailsTestId={`log-details-${entry.id}`}
        returnTestId={`log-return-to-coach-${entry.id}`}
        onShowCoachPanel={onShowCoachPanel}
        chat={
          <WorkoutCoachChatPanel
            entry={entry}
            coachChatOpen={coachChatOpen}
            coachChatNonce={coachChatNonce}
            coachSeedText={coachSeedText}
            currentCoachSeedText={currentCoachSeedText}
            panelState={coachPanel}
            onCloseCoachChat={onCloseCoachChat}
            onShowWorkoutDetails={onShowWorkoutDetails}
          />
        }
      >
        <WorkoutSummaryHeader
          stats={buildWorkoutSummaryStats({
            entry,
            variant: "planned",
            distanceUnit,
            showAdherence: false,
          })}
          testId={`log-summary-${entry.id}`}
        />
        <CoachRationaleSection
          rationale={entry.aiRationale}
          title="Why this workout"
          testId={`log-rationale-${entry.id}`}
        />

        {/* Pre-workout fuelling guidance sits above the exercise table so
            it's read before training, not after. */}
        {featureFlags.nutritionEnabled && entry.planDayId && <FuellingPlanPanel entry={entry} />}

        <LogSheetPrescriptionContent
          entry={entry}
          planSets={planSets}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          isEditMode={isEditMode}
        />

        <LogSheetFooter
          entry={entry}
          isEditMode={isEditMode}
          rpe={rpe}
          setRpe={setRpe}
          note={note}
          setNote={setNote}
          onLog={handleLog}
          onDone={handleDone}
          isLogging={isCompletingCurrentEntry || isLogging}
          isSaving={planSets.isSaving}
          onAskCoach={handleAskCoach}
          onSkip={onSkip}
        />
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}
