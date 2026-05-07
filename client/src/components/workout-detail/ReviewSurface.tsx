import type { TimelineEntry } from "@shared/schema";
import {
  Gauge,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { WorkoutStravaStats } from "@/components/timeline/timeline-workout-card/WorkoutStravaStats";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";
import { apiRequest } from "@/lib/queryClient";

import { AthleteNoteInput } from "./AthleteNoteInput";
import { ExerciseTable } from "./ExerciseTable";
import { SaveStatePill } from "./SaveStatePill";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";

interface ReviewSurfaceProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
  readonly onMarkPlanned?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
}


type MigrationReviewFlag = { status: string; reason: string | null } | null;

function useMigrationReview(workoutLogId: string | null) {
  const [reviewFlag, setReviewFlag] = useState<MigrationReviewFlag>(null);

  useEffect(() => {
    if (!workoutLogId) return;
    let cancelled = false;

    void fetch(`/api/v1/workouts/migration/reviews?ownerType=workoutLog&ownerId=${encodeURIComponent(workoutLogId)}`, { credentials: "include" })
      .then((r) => r.json() as Promise<Array<{ ownerType: string; ownerId: string; status: string; reason: string | null }>>)
      .then((rows) => {
        if (cancelled) return;
        const match = rows.find((r) => r.ownerType === "workoutLog" && r.ownerId === workoutLogId);
        setReviewFlag(match ? { status: match.status, reason: match.reason } : null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [workoutLogId]);

  const resolveReview = async (action: "accept" | "reject" | "edit") => {
    if (!workoutLogId) return;
    await apiRequest("POST", "/api/v1/workouts/migration/reviews/resolve", { ownerType: "workoutLog", ownerId: workoutLogId, action });
    setReviewFlag((prev) => (prev ? { ...prev, status: action === "reject" ? "needs_manual_review" : "resolved" } : prev));
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
  onMarkPlanned,
  onDelete,
}: ReviewSurfaceProps) {
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
  const weightUnit: "kg" | "lb" = prefWeightUnit === "kg" ? "kg" : "lb";

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
  const rpe = workout?.rpe ?? entry.rpe ?? null;
  const notes = workout?.notes ?? entry.notes ?? null;

  const isStrava = entry.source === "strava";
  const canEditActuals = !isStrava && !!workoutLogId;

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
      contentClassName="sm:max-w-2xl"
      testId={`review-surface-${entry.id}`}
    >
      <div className="space-y-4">
        {isStrava && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Strava session
            </p>
            <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
          </div>
        )}

        {!isStrava && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Effort
            </p>
            <RpeSelector value={rpe} onChange={handleRpeChange} showLabel={false} compact />
          </div>
        )}

        {canEditActuals && workoutLogId && (
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
        )}

        {!isStrava && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </p>
            <AthleteNoteInput
              value={notes}
              onSave={handleSaveNote}
              mode="form"
            />
          </div>
        )}

        {reviewFlag ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium">Migration review: {reviewFlag.status}</p>
            {reviewFlag.reason ? <p className="text-muted-foreground">{reviewFlag.reason}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void resolveReview("accept")}>Accept</Button>
              <Button size="sm" variant="outline" onClick={() => void resolveReview("edit")}>Edited & accept</Button>
              <Button size="sm" variant="ghost" onClick={() => void resolveReview("reject")}>Reject</Button>
            </div>
          </div>
        ) : null}

        {entry.aiRationale ? (
          <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <summary className="cursor-pointer text-xs font-medium text-primary">
              <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
              Coach rationale
            </summary>
            <p className="mt-2 text-sm text-foreground/80">{entry.aiRationale}</p>
          </details>
        ) : null}

        <Separator />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onAskCoach ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onAskCoach(entry)}
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
              variant={confirmingDelete ? "destructive" : "ghost"}
              onClick={handleDeleteClick}
              data-testid={`review-delete-${entry.id}`}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {confirmingDelete ? "Tap again to confirm" : "Delete"}
            </Button>
          ) : null}
        </div>
      </div>
    </ResponsiveSheet>
  );
}
