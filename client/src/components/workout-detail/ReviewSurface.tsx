import type { TimelineEntry } from "@shared/schema";
import {
  ChevronDown,
  Gauge,
  MessageSquare,
  Pencil,
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
import { cn } from "@/lib/utils";

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

/**
 * Sheet-native review surface for already-logged workouts. Replaces
 * WorkoutDetailDialogV2's "completed workout" path. Shows the actuals
 * editor wired to useWorkoutDetail mutations (autosave per cell),
 * inline RPE + notes editors, Strava stats when applicable, and the
 * coach rationale. Action footer covers ask-coach, status-revert
 * (back to planned), and delete (two-step confirm).
 *
 * Skipped cards still hand off to the legacy dialog for now — they
 * need a different read-only-with-undo layout that's out of scope
 * for this slice.
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

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset transient UI state when the selected entry changes.
  // Doing this in an effect avoids setState-during-render loops.
  useEffect(() => {
    setEditorOpen(false);
    setConfirmingDelete(false);
  }, [entry?.id]);

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
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete?.(entry);
  };

  const handleSheetOpenChange = (open: boolean) => {
    if (open) return;
    // Reset transient UI state on close so reopening the SAME card
    // doesn't carry an armed delete-confirm or stale open editor
    // across sessions — the entry-id reseed below only catches
    // open transitions to a *different* card. Without this, a user
    // who armed delete, dismissed the sheet, and reopened the same
    // workout would delete on the very first tap.
    setConfirmingDelete(false);
    setEditorOpen(false);
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
        {isStrava ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Strava session
            </p>
            <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
          </div>
        ) : null}

        {!isStrava ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Effort
            </p>
            <RpeSelector value={rpe} onChange={handleRpeChange} showLabel={false} compact />
          </div>
        ) : null}

        {canEditActuals ? (
          <div className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-accent/50"
              onClick={() => setEditorOpen((v) => !v)}
              aria-expanded={editorOpen}
              data-testid={`review-edit-actuals-${entry.id}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Pencil className="h-4 w-4" />
                {editorOpen ? "Hide actuals" : "Edit actuals"}
              </span>
              <span className="flex items-center gap-2">
                <SaveStatePill
                  state={{ isSaving: detail.isSaving, lastSavedAt: detail.lastSavedAt }}
                  testId={`review-actuals-save-state-${entry.id}`}
                />
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    editorOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </span>
            </button>
            {editorOpen && workoutLogId ? (
              <div className="space-y-3 border-t p-3">
                <PrescriptionEditor
                  entryId={entry.id}
                  hasSets={exerciseSets.length > 0}
                  mainWorkout={workout?.mainWorkout ?? entry.mainWorkout}
                  accessory={workout?.accessory ?? entry.accessory}
                  notes={null}
                  showNotes={false}
                  onSaveField={(field, value) => {
                    // Notes are owned by AthleteNoteInput below
                    // (writes through updateNote with optimistic
                    // patches); ignore any stray notes saves so we
                    // can't double-write to the same column.
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
                  defaultExpanded
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {!isStrava ? (
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
