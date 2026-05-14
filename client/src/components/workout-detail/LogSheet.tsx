import type { TimelineEntry } from "@shared/schema";
import { ListChecks, MessageSquare, SkipForward, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { StructureBlocksEditor } from "@/components/workout-structure";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { ExerciseTable } from "./ExerciseTable";
import { SaveStatePill } from "./SaveStatePill";
import type { PrescriptionTextPayload } from "./shared/PrescriptionEditor";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { RpePrompt } from "./shared/RpePrompt";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";
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
}

type LogSheetModeProps =
  | {
      readonly mode?: "log";
      /** Tier 1: log the workout exactly as prescribed, with an optional RPE override. */
      readonly onLogAsPlanned: (entry: TimelineEntry, rpe: number | null) => void;
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

function useEntryRpe(entry: TimelineEntry | null) {
  const [rpe, setRpe] = useState<number | null>(entry?.rpe ?? null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(entry?.id ?? null);

  if (entry && entry.id !== lastEntryId) {
    setLastEntryId(entry.id);
    setRpe(entry.rpe ?? null);
  }

  return { rpe, setRpe };
}

function getLogButtonLabel(isSaving: boolean, isLogging?: boolean): string {
  if (isSaving) return "Saving edits\u2026";
  if (isLogging) return "Logging\u2026";
  return "Log as planned";
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

interface PlannedPrescriptionProps {
  readonly entry: TimelineEntry;
  readonly planSets: PlanDayExerciseState;
  readonly weightUnit: WorkoutWeightUnit;
  readonly distanceUnit: WorkoutDistanceUnit;
  readonly parseHelperVisible: boolean;
}

function PlannedPrescription({
  entry,
  planSets,
  weightUnit,
  distanceUnit,
  parseHelperVisible,
}: PlannedPrescriptionProps) {
  const hasUnparsedText = hasPrescriptionText(entry) && planSets.exerciseSets.length === 0;
  return (
    <>
      <PlanRationale rationale={entry.aiRationale} />
      <AccessoryNote accessory={entry.accessory} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prescription
          </p>
          <SaveStatePill
            state={{ isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }}
            testId={`log-edit-save-state-${entry.id}`}
          />
        </div>
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
          }}
          onOpenConversionHelper={() => planSets.reparseFreeText.mutate(undefined)}
          defaultExpanded
          hasUnparsedText={hasUnparsedText}
          structureBlocks={planSets.structureBlocks}
        />
        <StructureBlocksEditor
          value={planSets.structureBlocks}
          onChange={(next) => planSets.updateStructure.mutate(next)}
        />
        <ParseFailureAlert
          entryId={entry.id}
          visible={parseHelperVisible}
          retryParse={planSets.retryParse}
        />
        <PrescriptionEditor
          entryId={entry.id}
          hasSets={planSets.exerciseSets.length > 0}
          mainWorkout={entry.mainWorkout}
          accessory={entry.accessory}
          notes={entry.notes}
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
      </div>
    </>
  );
}

function PlanRationale({ rationale }: { readonly rationale?: string | null }) {
  if (!rationale) return null;
  return (
    <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <summary className="cursor-pointer text-xs font-medium text-primary">
        <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
        Why this workout
      </summary>
      <p className="mt-2 text-sm text-foreground/80">{rationale}</p>
    </details>
  );
}

function AccessoryNote({ accessory }: { readonly accessory: string | null }) {
  if (!accessory) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Accessory
      </p>
      <p className="text-sm text-muted-foreground">{accessory}</p>
    </div>
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
    <div
      className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      role="status"
      data-testid={`log-parse-failed-${entryId}`}
    >
      <p>Parse did not create exercise rows. You can still log this workout text-only.</p>
      {retryParse ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-amber-900"
          onClick={retryParse}
          data-testid={`log-parse-retry-${entryId}`}
        >
          Retry parse
        </Button>
      ) : null}
    </div>
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
  onLog,
  isLogging,
  isSaving,
  onSkip,
  onAskCoach,
}: LogCompletionControlsProps) {
  return (
    <>
      <Separator />

      <RpePrompt value={rpe} onChange={setRpe} />

      <div className="space-y-2">
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onLog}
          disabled={isLogging || isSaving}
          data-testid={`log-as-planned-${entry.id}`}
        >
          <ListChecks className="mr-2 h-4 w-4" />
          {getLogButtonLabel(isSaving, isLogging)}
        </Button>

        <SecondaryLogActions entry={entry} onAskCoach={onAskCoach} onSkip={onSkip} />
      </div>
    </>
  );
}

interface EditSecondaryActionsProps {
  readonly entry: TimelineEntry;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
}

function EditSecondaryActions({ entry, onAskCoach, onSkip }: EditSecondaryActionsProps) {
  if (!onAskCoach && !onSkip) return null;

  return (
    <>
      <Separator />
      <SecondaryLogActions entry={entry} onAskCoach={onAskCoach} onSkip={onSkip} />
    </>
  );
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
  isLogging,
  mode = "log",
}: LogSheetProps) {
  const isMobile = useIsMobile();
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
  const weightUnit: "kg" | "lb" = prefWeightUnit === "kg" ? "kg" : "lb";
  const { rpe, setRpe } = useEntryRpe(entry);

  const planSets = usePlanDayExercises(entry?.planDayId ?? null);

  if (!entry) return null;

  const handleLog = async () => {
    if (!onLogAsPlanned) return;
    // Flush any debounced cell edits before the log mutation runs — the
    // server's createWorkoutInTx copies persisted plan-day rows into
    // the new workoutLog, so a row edit still queued in the debounce
    // coordinator would be missing from the snapshot.
    await planSets.flushPendingSetPatches();
    onLogAsPlanned(entry, rpe);
  };

  const parseHelperVisible = isParseHelperVisible(entry, planSets);
  const isEditMode = mode === "edit";
  const title = entry.focus || (isEditMode ? "Edit workout" : "Log workout");
  const coachExerciseSets = entry.planDayId ? planSets.exerciseSets : (entry.exerciseSets ?? []);
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, coachExerciseSets);
  const handleAskCoach = onAskCoach
    ? (target: TimelineEntry) => onAskCoach(target, currentCoachSeedText)
    : undefined;
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={formatScheduledDate(entry.date)}
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : "sm:max-w-2xl"}
      mobileFullHeight={coachPanel.coachPanelOpen}
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
        {entry.planDayId ? (
          <PlannedPrescription
            entry={entry}
            planSets={planSets}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            parseHelperVisible={parseHelperVisible}
          />
        ) : (
          <WorkoutPrescriptionSummary entry={entry} rationaleVariant="collapsed" />
        )}

        {isEditMode ? (
          <EditSecondaryActions entry={entry} onAskCoach={handleAskCoach} onSkip={onSkip} />
        ) : (
          <LogCompletionControls
            entry={entry}
            rpe={rpe}
            setRpe={setRpe}
            onLog={handleLog}
            isLogging={isLogging}
            isSaving={planSets.isSaving}
            onAskCoach={handleAskCoach}
            onSkip={onSkip}
          />
        )}
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}
