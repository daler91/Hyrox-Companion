import type { TimelineEntry } from "@shared/schema";
import { MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";

interface SkippedSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
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
}: SkippedSheetProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset destructive-action arm state whenever a different entry is selected.
  // Keeping this in an effect avoids render-time state updates.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [entry?.id]);

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
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={handleSheetOpenChange}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {getStatusBadge(entry.status)}
          <span>{entry.focus || "Skipped workout"}</span>
        </span>
      }
      description={formatScheduledDate(entry.date)}
      testId={`skipped-sheet-${entry.id}`}
    >
      <div className="space-y-4">
        <WorkoutPrescriptionSummary entry={entry} rationaleVariant="open" />

        <Separator />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onUndoSkip && entry.planDayId ? (
            <Button
              variant="default"
              onClick={() => onUndoSkip(entry)}
              data-testid={`skipped-undo-${entry.id}`}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Undo skip
            </Button>
          ) : null}
          {onAskCoach ? (
            <Button
              variant="outline"
              onClick={() => onAskCoach(entry)}
              data-testid={`skipped-ask-coach-${entry.id}`}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Ask coach
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant={confirmingDelete ? "destructive" : "ghost"}
              onClick={handleDeleteClick}
              data-testid={`skipped-delete-${entry.id}`}
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
