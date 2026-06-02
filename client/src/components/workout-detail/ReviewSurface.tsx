import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { CheckCircle2, MessageSquare, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { WorkoutStravaStats } from "@/components/timeline/timeline-workout-card/WorkoutStravaStats";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { StructureBlocksEditor } from "@/components/workout-structure";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { apiRequest } from "@/lib/queryClient";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";
import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { ExerciseTable } from "./ExerciseTable";
import { MafTestTagSection } from "./MafTestTagSection";
import type { PrescriptionTextPayload } from "./shared/PrescriptionEditor";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { WorkoutEffortNotes } from "./shared/WorkoutEffortNotes";
import { WorkoutPlanDayPicker } from "./shared/WorkoutPlanDayPicker";
import {
  getWorkoutCoachPanelState,
  WorkoutCoachChatPanel,
  WorkoutCoachLayout,
} from "./WorkoutCoachPanel";

interface ReviewSurfaceProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly coachChatOpen?: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly mobileCoachPanelOpen?: boolean;
  readonly onCloseCoachChat?: () => void;
  readonly onShowCoachPanel?: () => void;
  readonly onShowWorkoutDetails?: () => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle?: boolean;
  readonly showCompletionSuccess?: boolean;
}

type MigrationReviewFlag = { status: string; reason: string | null } | null;
type MigrationReviewAction = "accept" | "reject" | "edit";
type WorkoutDetailState = ReturnType<typeof useWorkoutDetail>;
type WeightUnit = "kg" | "lb";
type DistanceUnitPreference = ReturnType<typeof useUnitPreferences>["distanceUnit"];

function useMigrationReview(workoutLogId: string | null) {
  const [reviewFlag, setReviewFlag] = useState<MigrationReviewFlag>(null);

  useEffect(() => {
    if (!workoutLogId) return;
    let cancelled = false;

    fetch(
      `/api/v1/workouts/migration/reviews?ownerType=workoutLog&ownerId=${encodeURIComponent(workoutLogId)}`,
      { credentials: "include" },
    )
      .then(
        (r) =>
          r.json() as Promise<
            Array<{ ownerType: string; ownerId: string; status: string; reason: string | null }>
          >,
      )
      .then((rows) => {
        if (cancelled) return;
        const match = rows.find((r) => r.ownerType === "workoutLog" && r.ownerId === workoutLogId);
        setReviewFlag(match ? { status: match.status, reason: match.reason } : null);
      })
      .catch(ignoreAsyncError);

    return () => {
      cancelled = true;
    };
  }, [workoutLogId]);

  const resolveReview = async (action: MigrationReviewAction) => {
    if (!workoutLogId) return;
    await apiRequest("POST", "/api/v1/workouts/migration/reviews/resolve", {
      ownerType: "workoutLog",
      ownerId: workoutLogId,
      action,
    });
    setReviewFlag((prev) => {
      if (!prev) return prev;
      return { ...prev, status: getResolvedReviewStatus(action) };
    });
  };

  return { reviewFlag, resolveReview };
}

/**
 * Sheet-native review surface for already-logged workouts. Shows the
 * actuals editor wired to useWorkoutDetail mutations (autosave per
 * cell), inline RPE + notes editors, Strava stats when applicable,
 * and the coach rationale. Action footer covers ask-coach,
 * status-revert (back to planned), and delete (two-step confirm).
 *
 * Skipped cards have their own SkippedSheet surface; this component
 * is only mounted for entries with a workoutLogId.
 */
export function ReviewSurface({
  entry,
  onClose,
  onAskCoach,
  coachChatOpen = false,
  coachChatNonce,
  coachSeedText,
  mobileCoachPanelOpen = false,
  onCloseCoachChat,
  onShowCoachPanel,
  onShowWorkoutDetails,
  onMarkPlanned,
  onDelete,
  onRenameTitle,
  isRenamingTitle = false,
  showCompletionSuccess = false,
}: ReviewSurfaceProps) {
  const isMobile = useIsMobile();
  const { weightUnit: prefWeightUnit, distanceUnit, showAdherenceInsights } = useUnitPreferences();
  const weightUnit = getWeightUnit(prefWeightUnit);

  const workoutLogId = entry?.workoutLogId ?? null;
  const detail = useWorkoutDetail(workoutLogId);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { reviewFlag, resolveReview } = useMigrationReview(workoutLogId);

  if (!entry) return null;

  // The cached workout from useWorkoutDetail is the source of truth
  // for RPE / notes / sets — entry.* may lag while the timeline cache
  // refetches after a mutation. Falling back to entry.* keeps the
  // surface populated during the very first paint before
  // workoutQuery resolves.
  const workout = detail.workout;
  const displayEntry = workout?.focus ? { ...entry, focus: workout.focus } : entry;
  const exerciseSets = workout?.exerciseSets ?? entry.exerciseSets ?? [];
  const structureBlocks = workout?.structureBlocks ?? entry.structureBlocks ?? [];
  const rpe = workout?.rpe ?? entry.rpe ?? null;
  const notes = workout?.notes ?? entry.notes ?? null;

  const isStrava = entry.source === "strava";
  const canEditActuals = !isStrava && !!workoutLogId;
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(displayEntry, exerciseSets);
  const sheetContentClassName = getReviewSheetContentClassName(coachChatOpen);
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

  const handleRpeChange = (next: number | null) => {
    if (!workoutLogId) return;
    detail.updateRpe.mutate({ rpe: next, forWorkoutId: workoutLogId });
  };

  const handleSaveNote = (next: string | null) => {
    if (!workoutLogId) return;
    detail.updateNote.mutate(next);
  };

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDelete?.(entry);
      return;
    }
    setConfirmingDelete(true);
  };

  const handleSheetOpenChange = (open: boolean) => {
    if (open) return;
    // Reset transient UI state on close so reopening the SAME card
    // doesn't carry an armed delete-confirm across sessions — without
    // this, a user who armed delete, dismissed the sheet, and
    // reopened the same workout would delete on the very first tap.
    setConfirmingDelete(false);
    onClose();
  };

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={handleSheetOpenChange}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {getStatusBadge(entry.status)}
          <EditableWorkoutTitle
            title={displayEntry.focus}
            fallbackTitle="Workout"
            onSave={
              onRenameTitle && (displayEntry.workoutLogId || displayEntry.planDayId)
                ? (title) => onRenameTitle(displayEntry, title)
                : undefined
            }
            isSaving={isRenamingTitle}
            testIdPrefix={`workout-title-${displayEntry.id}`}
          />
        </span>
      }
      description={formatScheduledDate(entry.date)}
      contentClassName={sheetContentClassName}
      mobileFullHeight={coachPanel.coachPanelOpen}
      desktopFullHeight={coachChatOpen}
      testId={`review-surface-${entry.id}`}
    >
      <WorkoutCoachLayout
        panelState={coachPanel}
        detailsTestId={`review-details-${entry.id}`}
        returnTestId={`review-return-to-coach-${entry.id}`}
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
        <CompletionSuccessCallout visible={showCompletionSuccess} />
        <ReviewDetailsColumn
          entry={displayEntry}
          detail={detail}
          workoutLogId={workoutLogId}
          exerciseSets={exerciseSets}
          structureBlocks={structureBlocks}
          rpe={rpe}
          notes={notes}
          isStrava={isStrava}
          canEditActuals={canEditActuals}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          showPlannedDiffs={showAdherenceInsights}
          reviewFlag={reviewFlag}
          confirmingDelete={confirmingDelete}
          currentCoachSeedText={currentCoachSeedText}
          onRpeChange={handleRpeChange}
          onSaveNote={handleSaveNote}
          onAskCoach={onAskCoach}
          onMarkPlanned={onMarkPlanned}
          onDelete={onDelete}
          onDeleteClick={handleDeleteClick}
          onResolveReview={resolveReview}
        />
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}

function CompletionSuccessCallout({ visible }: { readonly visible: boolean }) {
  if (!visible) return null;

  return (
    <output
      className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-foreground"
      data-testid="review-completion-success"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      <span>
        <span className="block font-medium">Workout completed</span>
        <span className="block text-muted-foreground">Review or adjust your results below.</span>
      </span>
    </output>
  );
}

interface ReviewDetailsColumnProps {
  readonly entry: TimelineEntry;
  readonly detail: WorkoutDetailState;
  readonly workoutLogId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly structureBlocks: TimelineEntry["structureBlocks"];
  readonly rpe: number | null;
  readonly notes: string | null;
  readonly isStrava: boolean;
  readonly canEditActuals: boolean;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnitPreference;
  readonly showPlannedDiffs: boolean;
  readonly reviewFlag: MigrationReviewFlag;
  readonly confirmingDelete: boolean;
  readonly currentCoachSeedText: string;
  readonly onRpeChange: (next: number | null) => void;
  readonly onSaveNote: (next: string | null) => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onDeleteClick: () => void;
  readonly onResolveReview: (action: MigrationReviewAction) => Promise<void>;
}

function ReviewDetailsColumn({
  entry,
  detail,
  workoutLogId,
  exerciseSets,
  structureBlocks,
  rpe,
  notes,
  isStrava,
  canEditActuals,
  weightUnit,
  distanceUnit,
  showPlannedDiffs,
  reviewFlag,
  confirmingDelete,
  currentCoachSeedText,
  onRpeChange,
  onSaveNote,
  onAskCoach,
  onMarkPlanned,
  onDelete,
  onDeleteClick,
  onResolveReview,
}: ReviewDetailsColumnProps) {
  return (
    <>
      <ReviewStravaSection entry={entry} distanceUnit={distanceUnit} isStrava={isStrava} />
      <ReviewActualsSection
        entry={entry}
        detail={detail}
        workoutLogId={workoutLogId}
        exerciseSets={exerciseSets}
        structureBlocks={structureBlocks ?? []}
        canEditActuals={canEditActuals}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        showPlannedDiffs={showPlannedDiffs}
      />
      <ReviewPlanLinkSection detail={detail} workoutLogId={workoutLogId} />
      <MafTestTagSection workoutLogId={workoutLogId} workout={detail.workout ?? null} />
      <ReviewEffortNotes
        isStrava={isStrava}
        rpe={rpe}
        notes={notes}
        onRpeChange={onRpeChange}
        onSaveNote={onSaveNote}
      />
      <MigrationReviewCallout reviewFlag={reviewFlag} onResolveReview={onResolveReview} />
      <CoachRationale rationale={entry.aiRationale} />

      <Separator />

      <ReviewActionButtons
        entry={entry}
        confirmingDelete={confirmingDelete}
        currentCoachSeedText={currentCoachSeedText}
        onAskCoach={onAskCoach}
        onMarkPlanned={onMarkPlanned}
        onDelete={onDelete}
        onDeleteClick={onDeleteClick}
      />
    </>
  );
}

interface ReviewStravaSectionProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: DistanceUnitPreference;
  readonly isStrava: boolean;
}

function ReviewStravaSection({ entry, distanceUnit, isStrava }: ReviewStravaSectionProps) {
  if (!isStrava) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Strava session
      </p>
      <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
    </div>
  );
}

interface ReviewEffortNotesProps {
  readonly isStrava: boolean;
  readonly rpe: number | null;
  readonly notes: string | null;
  readonly onRpeChange: (next: number | null) => void;
  readonly onSaveNote: (next: string | null) => void;
}

/**
 * Effort + notes wrap-up for a logged workout. Sits below the actuals
 * editor — the same position the block holds on LogSheet/AdhocLogSheet —
 * so RPE and notes are found in one consistent place across the whole
 * logging flow. Hidden for Strava sessions, which carry neither.
 */
function ReviewEffortNotes({
  isStrava,
  rpe,
  notes,
  onRpeChange,
  onSaveNote,
}: ReviewEffortNotesProps) {
  if (isStrava) return null;

  return (
    <>
      <Separator />
      <WorkoutEffortNotes
        rpe={rpe}
        onRpeChange={onRpeChange}
        note={notes}
        onNoteChange={onSaveNote}
        debounceNote
      />
    </>
  );
}

interface ReviewPlanLinkSectionProps {
  readonly detail: WorkoutDetailState;
  readonly workoutLogId: string | null;
}

/**
 * Connect this logged workout to a plan day, or change/remove the link. Reads
 * the current link from detail.workout (the source of truth — the timeline
 * entry doesn't carry plan info for standalone logs) and writes through
 * updatePlanDay. Rendered for Strava sessions too: a synced run can legitimately
 * fulfil a plan day.
 */
function ReviewPlanLinkSection({ detail, workoutLogId }: ReviewPlanLinkSectionProps) {
  if (!workoutLogId) return null;
  const workout = detail.workout;

  return (
    <>
      <Separator />
      <section className="space-y-2" data-testid={`review-plan-link-${workoutLogId}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Training plan
        </p>
        <WorkoutPlanDayPicker
          planId={workout?.planId ?? null}
          planDayId={workout?.planDayId ?? null}
          onChange={(next) => detail.updatePlanDay.mutate(next)}
          disabled={detail.updatePlanDay.isPending}
          idPrefix={`review-plan-${workoutLogId}`}
        />
      </section>
    </>
  );
}

interface ReviewActualsSectionProps {
  readonly entry: TimelineEntry;
  readonly detail: WorkoutDetailState;
  readonly workoutLogId: string | null;
  readonly exerciseSets: ExerciseSet[];
  readonly structureBlocks: TimelineEntry["structureBlocks"];
  readonly canEditActuals: boolean;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnitPreference;
  readonly showPlannedDiffs: boolean;
}

function ReviewActualsSection({
  entry,
  detail,
  workoutLogId,
  exerciseSets,
  structureBlocks = [],
  canEditActuals,
  weightUnit,
  distanceUnit,
  showPlannedDiffs,
}: ReviewActualsSectionProps) {
  if (!canEditActuals || !workoutLogId) return null;

  const workout = detail.workout;
  const referenceMainWorkout = workout?.prescribedMainWorkout ?? workout?.mainWorkout ?? entry.mainWorkout;
  const referenceAccessory = workout?.prescribedAccessory ?? workout?.accessory ?? entry.accessory;
  const hasReferenceText = hasText(referenceMainWorkout) || hasText(referenceAccessory);
  const handleExplicitTextParse = (payload: PrescriptionTextPayload) => {
    detail.reparseFreeText.mutate({
      prescribedMainWorkout: payload.mainWorkout,
      prescribedAccessory: payload.accessory,
    });
  };
  const parseVisibleReference = () => {
    handleExplicitTextParse({
      mainWorkout: referenceMainWorkout ?? null,
      accessory: referenceAccessory ?? null,
    });
  };

  return (
    <div className="space-y-3">
      <StructureBlocksEditor
        value={structureBlocks}
        onChange={(next) => detail.updateStructure.mutate(next)}
        exerciseSets={exerciseSets}
        onUpdateSet={detail.patchSetDebounced}
        onAddSet={detail.addSet.mutate}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        showScoreControls
        onScoreChange={(blockId, score) => detail.updateBlockScore.mutate({ blockId, score })}
      />
      <ExerciseTable
        workoutId={workoutLogId}
        exerciseSets={exerciseSets}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onUpdateSet={detail.patchSetDebounced}
        onAddSet={detail.addSet.mutate}
        onDeleteSet={detail.deleteSet.mutate}
        saveState={{
          isSaving: detail.isSaving,
          lastSavedAt: detail.lastSavedAt,
        }}
        hasUnparsedText={hasReferenceText && exerciseSets.length === 0}
        onOpenConversionHelper={parseVisibleReference}
        defaultExpanded
        showPlannedDiffs={showPlannedDiffs}
        structureBlocks={structureBlocks}
      />
      <PrescriptionEditor
        entryId={entry.id}
        hasSets={exerciseSets.length > 0}
        mainWorkout={referenceMainWorkout}
        accessory={referenceAccessory}
        notes={null}
        showNotes={false}
        onSaveField={(field, value) => {
          // Notes are owned by the effort/notes block below (writes
          // through updateNote with optimistic patches); ignore any
          // stray notes saves so we can't double-write to the same
          // column.
          if (field === "notes") return;
          const normalized = value.trim().length === 0 ? null : value;
          detail.updateReference.mutate(
            field === "mainWorkout"
              ? { prescribedMainWorkout: normalized }
              : { prescribedAccessory: normalized },
          );
        }}
        onParseText={handleExplicitTextParse}
        onParseImage={(payload) => detail.reparseFromImage.mutate(payload)}
        isParsingText={detail.reparseFreeText.isPending}
        isParsingImage={detail.reparseFromImage.isPending}
        title="Workout description"
        compact
      />
    </div>
  );
}

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

interface MigrationReviewCalloutProps {
  readonly reviewFlag: MigrationReviewFlag;
  readonly onResolveReview: (action: MigrationReviewAction) => Promise<void>;
}

function MigrationReviewCallout({ reviewFlag, onResolveReview }: MigrationReviewCalloutProps) {
  if (!reviewFlag) return null;

  const handleAccept = () => {
    onResolveReview("accept").catch(ignoreAsyncError);
  };

  const handleEdit = () => {
    onResolveReview("edit").catch(ignoreAsyncError);
  };

  const handleReject = () => {
    onResolveReview("reject").catch(ignoreAsyncError);
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Migration review: {reviewFlag.status}</p>
      {reviewFlag.reason ? <p className="text-muted-foreground">{reviewFlag.reason}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={handleAccept}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={handleEdit}>
          Edited & accept
        </Button>
        <Button size="sm" variant="ghost" onClick={handleReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}

interface CoachRationaleProps {
  readonly rationale: string | null | undefined;
}

function CoachRationale({ rationale }: CoachRationaleProps) {
  if (!rationale) return null;

  return (
    <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <summary className="cursor-pointer text-xs font-medium text-primary">
        <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
        Coach rationale
      </summary>
      <p className="mt-2 text-sm text-foreground/80">{rationale}</p>
    </details>
  );
}

interface ReviewActionButtonsProps {
  readonly entry: TimelineEntry;
  readonly confirmingDelete: boolean;
  readonly currentCoachSeedText: string;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onDeleteClick: () => void;
}

function ReviewActionButtons({
  entry,
  confirmingDelete,
  currentCoachSeedText,
  onAskCoach,
  onMarkPlanned,
  onDelete,
  onDeleteClick,
}: ReviewActionButtonsProps) {
  const deleteButtonVariant = confirmingDelete ? "destructive" : "ghost";
  const deleteButtonLabel = confirmingDelete ? "Tap again to confirm" : "Delete";

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {onAskCoach ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onAskCoach(entry, currentCoachSeedText)}
          data-testid={`review-ask-coach-${entry.id}`}
        >
          <MessageSquare className="mr-2 h-4 w-4" />
          Ask coach
        </Button>
      ) : null}
      {onMarkPlanned && entry.planDayId ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onMarkPlanned(entry)}
          data-testid={`review-mark-planned-${entry.id}`}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reopen workout
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          type="button"
          variant={deleteButtonVariant}
          onClick={onDeleteClick}
          data-testid={`review-delete-${entry.id}`}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {deleteButtonLabel}
        </Button>
      ) : null}
    </div>
  );
}

function getWeightUnit(prefWeightUnit: "kg" | "lbs"): WeightUnit {
  if (prefWeightUnit === "kg") return "kg";
  return "lb";
}

function getReviewSheetContentClassName(coachChatOpen: boolean): string {
  if (coachChatOpen) return "sm:max-w-5xl";
  return "sm:max-w-2xl";
}

function getResolvedReviewStatus(action: MigrationReviewAction): string {
  if (action === "reject") return "needs_manual_review";
  return "resolved";
}

function ignoreAsyncError(): undefined {
  return undefined;
}
