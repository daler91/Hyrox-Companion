import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import {
  Activity,
  CheckCircle2,
  Dumbbell,
  Gauge,
  Link2,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { WorkoutStravaStats } from "@/components/timeline/timeline-workout-card/WorkoutStravaStats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { StructureBlocksEditor } from "@/components/workout-structure";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { featureFlags } from "@/lib/featureFlags";
import { apiRequest } from "@/lib/queryClient";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/timeOfDay";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";
import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { ExerciseTable } from "./ExerciseTable";
import { FuellingAroundSessionPanel } from "./FuellingAroundSessionPanel";
import { MafTestTagSection } from "./MafTestTagSection";
import { CoachRationaleSection, DetailSection } from "./shared/DetailSection";
import type { PrescriptionTextPayload } from "./shared/PrescriptionEditor";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { WorkoutContentsLayout } from "./shared/WorkoutContentsLayout";
import { WorkoutEffortNotes } from "./shared/WorkoutEffortNotes";
import { WorkoutPlanDayPicker } from "./shared/WorkoutPlanDayPicker";
import { buildWorkoutSummaryStats, WorkoutSummaryHeader } from "./shared/WorkoutSummaryHeader";
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

  // The manual session-time picker only makes sense when there's no device
  // start time — a Strava/Garmin `startedAt` already wins in the fuel-timing
  // resolver — so gate it on a loaded workout with a null startedAt.
  const canSetTimeOfDay = !!workoutLogId && workout != null && workout.startedAt == null;
  const handleTimeOfDayChange = (next: number | null) => {
    if (!workoutLogId) return;
    detail.updateTimeOfDay.mutate(next);
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
          timeOfDayMin={workout?.timeOfDayMin ?? null}
          onRpeChange={handleRpeChange}
          onSaveNote={handleSaveNote}
          onTimeOfDayChange={canSetTimeOfDay ? handleTimeOfDayChange : undefined}
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
  readonly timeOfDayMin: number | null;
  readonly onRpeChange: (next: number | null) => void;
  readonly onSaveNote: (next: string | null) => void;
  readonly onTimeOfDayChange?: (next: number | null) => void;
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
  timeOfDayMin,
  onRpeChange,
  onSaveNote,
  onTimeOfDayChange,
  onAskCoach,
  onMarkPlanned,
  onDelete,
  onDeleteClick,
  onResolveReview,
}: ReviewDetailsColumnProps) {
  return (
    <>
      <WorkoutSummaryHeader
        stats={buildWorkoutSummaryStats({
          entry,
          variant: "completed",
          rpe,
          distanceUnit,
          showAdherence: showPlannedDiffs,
        })}
        testId={`review-summary-${entry.id}`}
      />
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
      <ReviewEffortNotes
        isStrava={isStrava}
        rpe={rpe}
        notes={notes}
        timeOfDayMin={timeOfDayMin}
        onRpeChange={onRpeChange}
        onSaveNote={onSaveNote}
        onTimeOfDayChange={onTimeOfDayChange}
      />
      <CoachRationaleSection rationale={entry.aiRationale} testId={`review-rationale-${entry.id}`} />
      {featureFlags.nutritionEnabled && workoutLogId ? (
        <FuellingAroundSessionPanel workoutLogId={workoutLogId} />
      ) : null}
      <ReviewPlanLinkSection detail={detail} workoutLogId={workoutLogId} />
      <MafTestTagSection workoutLogId={workoutLogId} workout={detail.workout ?? null} />
      <MigrationReviewCallout reviewFlag={reviewFlag} onResolveReview={onResolveReview} />

      {/* Pinned to the bottom of the scroll area so Ask coach / Reopen /
          Delete stay reachable on a long review without scrolling to the end.
          `sticky` resolves against whichever ancestor scrolls (desktop dialog,
          split-coach details column, or mobile bottom sheet). */}
      <div className="sticky bottom-0 z-10 border-t bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <ReviewActionButtons
          entry={entry}
          confirmingDelete={confirmingDelete}
          currentCoachSeedText={currentCoachSeedText}
          onAskCoach={onAskCoach}
          onMarkPlanned={onMarkPlanned}
          onDelete={onDelete}
          onDeleteClick={onDeleteClick}
        />
      </div>
    </>
  );
}

interface ReviewStravaSectionProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: DistanceUnitPreference;
  readonly isStrava: boolean;
}

function ReviewStravaSection({ entry, distanceUnit, isStrava }: ReviewStravaSectionProps) {
  // WorkoutStravaStats renders nothing without chip-level stats; gate
  // here too so we never paint an empty titled card.
  const hasChipStats =
    !!entry.calories || !!entry.avgWatts || !!entry.sufferScore || !!entry.avgCadence || !!entry.avgSpeed;
  if (!isStrava || !hasChipStats) return null;

  return (
    <DetailSection title="Strava session" icon={Activity} testId={`review-strava-${entry.id}`}>
      <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
    </DetailSection>
  );
}

interface ReviewEffortNotesProps {
  readonly isStrava: boolean;
  readonly rpe: number | null;
  readonly notes: string | null;
  readonly timeOfDayMin: number | null;
  readonly onRpeChange: (next: number | null) => void;
  readonly onSaveNote: (next: string | null) => void;
  readonly onTimeOfDayChange?: (next: number | null) => void;
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
  timeOfDayMin,
  onRpeChange,
  onSaveNote,
  onTimeOfDayChange,
}: ReviewEffortNotesProps) {
  if (isStrava) return null;

  return (
    <DetailSection title="Effort & notes" icon={Gauge}>
      <div className="space-y-4">
        <WorkoutEffortNotes
          rpe={rpe}
          onRpeChange={onRpeChange}
          note={notes}
          onNoteChange={onSaveNote}
          debounceNote
        />
        {onTimeOfDayChange && (
          <div className="space-y-1">
            <Label htmlFor="review-time-of-day" className="text-sm font-medium">
              Session time
            </Label>
            <Input
              id="review-time-of-day"
              type="time"
              value={minutesToHhmm(timeOfDayMin)}
              onChange={(event) => onTimeOfDayChange(hhmmToMinutes(event.target.value))}
              data-testid="input-review-time-of-day"
              className="w-36"
            />
            <p className="text-xs text-muted-foreground">
              When you trained — sets the recovery-meal timing for this day.
            </p>
          </div>
        )}
      </div>
    </DetailSection>
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
    <DetailSection
      title="Training plan"
      icon={Link2}
      collapsible
      testId={`review-plan-link-${workoutLogId}`}
    >
      <WorkoutPlanDayPicker
        planId={workout?.planId ?? null}
        planDayId={workout?.planDayId ?? null}
        onChange={(next) => detail.updatePlanDay.mutate(next)}
        disabled={detail.updatePlanDay.isPending}
        idPrefix={`review-plan-${workoutLogId}`}
      />
    </DetailSection>
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

  // Hosts autosaving editors — must stay an always-open card: collapsing
  // would unmount the editors and could drop debounced cell edits.
  return (
    <DetailSection title="Results" icon={Dumbbell} testId={`review-results-${entry.id}`}>
      <WorkoutContentsLayout
        exerciseSets={exerciseSets}
        sourceLabel={hasReferenceText ? "from coach text" : null}
        structureBlockCount={(structureBlocks ?? []).length}
        summaryLabel="Results contents"
        isParsing={detail.reparseFreeText.isPending || detail.reparseFromImage.isPending}
        source={
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
        }
        table={
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
              lastSaveErrorAt: detail.lastSaveErrorAt,
            }}
            hasUnparsedText={hasReferenceText && exerciseSets.length === 0}
            onOpenConversionHelper={parseVisibleReference}
            defaultExpanded
            showPlannedDiffs={showPlannedDiffs}
            structureBlocks={structureBlocks}
          />
        }
        structure={
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
            headerless
          />
        }
      />
    </DetailSection>
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
    <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
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
