import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { Gauge, MessageSquare, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { WorkoutStravaStats } from "@/components/timeline/timeline-workout-card/WorkoutStravaStats";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { StructureBlocksEditor } from "@/components/workout-structure";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { apiRequest } from "@/lib/queryClient";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { buildWorkoutCoachSeedMessage, EmbeddedWorkoutCoachChat } from "./EmbeddedWorkoutCoachChat";
import { ExerciseTable } from "./ExerciseTable";
import { SaveStatePill } from "./SaveStatePill";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";

interface ReviewSurfaceProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly coachChatOpen?: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly onCloseCoachChat?: () => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
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
  onCloseCoachChat,
  onMarkPlanned,
  onDelete,
}: ReviewSurfaceProps) {
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
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
  const exerciseSets = workout?.exerciseSets ?? entry.exerciseSets ?? [];
  const structureBlocks = workout?.structureBlocks ?? entry.structureBlocks ?? [];
  const rpe = workout?.rpe ?? entry.rpe ?? null;
  const notes = workout?.notes ?? entry.notes ?? null;

  const isStrava = entry.source === "strava";
  const canEditActuals = !isStrava && !!workoutLogId;
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, exerciseSets);
  const sheetContentClassName = getReviewSheetContentClassName(coachChatOpen);
  const layoutClassName = getReviewLayoutClassName(coachChatOpen);

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
          <span>{entry.focus || "Workout"}</span>
        </span>
      }
      description={formatScheduledDate(entry.date)}
      contentClassName={sheetContentClassName}
      testId={`review-surface-${entry.id}`}
    >
      <div className={layoutClassName}>
        <ReviewDetailsColumn
          entry={entry}
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
        <ReviewCoachChat
          entry={entry}
          currentCoachSeedText={currentCoachSeedText}
          coachChatOpen={coachChatOpen}
          coachChatNonce={coachChatNonce}
          coachSeedText={coachSeedText}
          onCloseCoachChat={onCloseCoachChat}
        />
      </div>
    </ResponsiveSheet>
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
    <div className="min-w-0 space-y-4">
      <ReviewStravaSection entry={entry} distanceUnit={distanceUnit} isStrava={isStrava} />
      <ReviewEffortSection isStrava={isStrava} rpe={rpe} onRpeChange={onRpeChange} />
      <ReviewActualsSection
        entry={entry}
        detail={detail}
        workoutLogId={workoutLogId}
        exerciseSets={exerciseSets}
        structureBlocks={structureBlocks ?? []}
        canEditActuals={canEditActuals}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
      />
      <ReviewNotesSection isStrava={isStrava} notes={notes} onSaveNote={onSaveNote} />
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
    </div>
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

interface ReviewEffortSectionProps {
  readonly isStrava: boolean;
  readonly rpe: number | null;
  readonly onRpeChange: (next: number | null) => void;
}

function ReviewEffortSection({ isStrava, rpe, onRpeChange }: ReviewEffortSectionProps) {
  if (isStrava) return null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        Effort
      </p>
      <RpeSelector value={rpe} onChange={onRpeChange} showLabel={false} compact />
    </div>
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
}: ReviewActualsSectionProps) {
  if (!canEditActuals || !workoutLogId) return null;

  const workout = detail.workout;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Logged exercises
        </p>
        <SaveStatePill
          state={{ isSaving: detail.isSaving, lastSavedAt: detail.lastSavedAt }}
          testId={`review-actuals-save-state-${entry.id}`}
        />
      </div>
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
        onOpenConversionHelper={() => detail.reparseFreeText.mutate(undefined)}
        defaultExpanded
        structureBlocks={structureBlocks}
      />
      <StructureBlocksEditor
        value={structureBlocks}
        onChange={(next) => detail.updateStructure.mutate(next)}
        showScoreControls
        onScoreChange={(blockId, score) => detail.updateBlockScore.mutate({ blockId, score })}
      />
      <PrescriptionEditor
        entryId={entry.id}
        hasSets={exerciseSets.length > 0}
        mainWorkout={workout?.mainWorkout ?? entry.mainWorkout}
        accessory={workout?.accessory ?? entry.accessory}
        notes={null}
        showNotes={false}
        onSaveField={(field, value) => {
          // Notes are owned by AthleteNoteInput below (writes
          // through updateNote with optimistic patches); ignore
          // any stray notes saves so we can't double-write to
          // the same column.
          if (field === "notes") return;
          detail.updatePrescription.mutate({
            [field]: value.trim().length === 0 ? null : value,
          });
        }}
        onParseText={() => detail.reparseFreeText.mutate(undefined)}
        onParseImage={(payload) => detail.reparseFromImage.mutate(payload)}
        isParsingText={detail.reparseFreeText.isPending}
        isParsingImage={detail.reparseFromImage.isPending}
        title="Workout description"
        compact
      />
    </div>
  );
}

interface ReviewNotesSectionProps {
  readonly isStrava: boolean;
  readonly notes: string | null;
  readonly onSaveNote: (next: string | null) => void;
}

function ReviewNotesSection({ isStrava, notes, onSaveNote }: ReviewNotesSectionProps) {
  if (isStrava) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Notes
      </p>
      <AthleteNoteInput value={notes} onSave={onSaveNote} mode="form" />
    </div>
  );
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
          Mark as planned
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

interface ReviewCoachChatProps {
  readonly entry: TimelineEntry;
  readonly currentCoachSeedText: string;
  readonly coachChatOpen: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly onCloseCoachChat?: () => void;
}

function ReviewCoachChat({
  entry,
  currentCoachSeedText,
  coachChatOpen,
  coachChatNonce,
  coachSeedText,
  onCloseCoachChat,
}: ReviewCoachChatProps) {
  if (!coachChatOpen) return null;

  return (
    <EmbeddedWorkoutCoachChat
      entry={entry}
      seedText={coachSeedText ?? currentCoachSeedText}
      seedNonce={coachChatNonce}
      onBack={onCloseCoachChat ?? noop}
    />
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

function getReviewLayoutClassName(coachChatOpen: boolean): string {
  if (coachChatOpen) {
    return "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]";
  }
  return "space-y-4";
}

function getResolvedReviewStatus(action: MigrationReviewAction): string {
  if (action === "reject") return "needs_manual_review";
  return "resolved";
}

function ignoreAsyncError(): undefined {
  return undefined;
}

function noop(): undefined {
  return undefined;
}
