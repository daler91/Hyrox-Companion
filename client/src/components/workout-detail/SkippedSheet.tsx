import type { TimelineEntry } from "@shared/schema";
import { MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";

import {
  ReadOnlyWorkoutActionGrid,
  ReadOnlyWorkoutDetailSheet,
  type WorkoutCoachSheetProps,
} from "./ReadOnlyWorkoutDetailSheet";

interface SkippedSheetProps extends WorkoutCoachSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  /** Flip the entry's status back to "planned" so the user can log it. */
  readonly onUndoSkip?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
}

/**
 * Read-only review surface for cards the user marked as skipped.
 * Mirrors PreviewSheet's shape — no log path, no editor — but adds
 * an "Undo skip" action that flips the entry back to planned, plus
 * a two-step delete (same gating pattern as ReviewSurface).
 *
 * Skipped entries don't have a workoutLogId, so there are no actuals
 * to edit; the prescribed workout is shown for context only.
 */
export function SkippedSheet({
  entry,
  onClose,
  onAskCoach,
  onUndoSkip,
  onDelete,
  ...coachProps
}: SkippedSheetProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleSheetOpenChange = (open: boolean) => {
    if (open) return;
    setConfirmingDelete(false);
    onClose();
  };

  const handleDeleteClick = () => {
    if (!entry) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete?.(entry);
  };

  if (!entry) return null;

  return (
    <ReadOnlyWorkoutDetailSheet
      {...coachProps}
      entry={entry}
      onOpenChange={handleSheetOpenChange}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {getStatusBadge(entry.status)}
          <span>{entry.focus || "Skipped workout"}</span>
        </span>
      }
      sheetTestId={`skipped-sheet-${entry.id}`}
      detailsTestId={`skipped-details-${entry.id}`}
      returnTestId={`skipped-return-to-coach-${entry.id}`}
      renderActions={(seedText) => (
        <SkippedActions
          confirmingDelete={confirmingDelete}
          entry={entry}
          seedText={seedText}
          onAskCoach={onAskCoach}
          onDelete={onDelete}
          onDeleteClick={handleDeleteClick}
          onUndoSkip={onUndoSkip}
        />
      )}
    />
  );
}

interface SkippedActionsProps {
  readonly confirmingDelete: boolean;
  readonly entry: TimelineEntry;
  readonly seedText: string;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onDeleteClick: () => void;
  readonly onUndoSkip?: (entry: TimelineEntry) => void;
}

function SkippedActions({
  confirmingDelete,
  entry,
  seedText,
  onAskCoach,
  onDelete,
  onDeleteClick,
  onUndoSkip,
}: SkippedActionsProps) {
  return (
    <ReadOnlyWorkoutActionGrid
      actions={[
        {
          icon: RotateCcw,
          label: "Undo skip",
          onClick: onUndoSkip && entry.planDayId ? () => onUndoSkip(entry) : undefined,
          testId: `skipped-undo-${entry.id}`,
          variant: "default",
        },
        {
          icon: MessageSquare,
          label: "Ask coach",
          onClick: onAskCoach ? () => onAskCoach(entry, seedText) : undefined,
          testId: `skipped-ask-coach-${entry.id}`,
          variant: "outline",
        },
        {
          icon: Trash2,
          label: confirmingDelete ? "Tap again to confirm" : "Delete",
          onClick: onDelete ? onDeleteClick : undefined,
          testId: `skipped-delete-${entry.id}`,
          variant: confirmingDelete ? "destructive" : "ghost",
        },
      ]}
    />
  );
}
