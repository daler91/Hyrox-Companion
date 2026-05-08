import type { TimelineEntry } from "@shared/schema";
import { MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { buildWorkoutCoachSeedMessage, EmbeddedWorkoutCoachChat } from "./EmbeddedWorkoutCoachChat";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";

interface SkippedSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly coachChatOpen?: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly onCloseCoachChat?: () => void;
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
  coachChatOpen = false,
  coachChatNonce,
  coachSeedText,
  onCloseCoachChat,
  onUndoSkip,
  onDelete,
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
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, entry.exerciseSets ?? []);

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
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : undefined}
      testId={`skipped-sheet-${entry.id}`}
    >
      <div
        className={
          coachChatOpen
            ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]"
            : "space-y-4"
        }
      >
        <div className="min-w-0 space-y-4">
          <WorkoutPrescriptionSummary entry={entry} rationaleVariant="open" />

          <Separator />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onUndoSkip && entry.planDayId ? (
              <Button
                type="button"
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
                type="button"
                variant="outline"
                onClick={() => onAskCoach(entry, currentCoachSeedText)}
                data-testid={`skipped-ask-coach-${entry.id}`}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Ask coach
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
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
        {coachChatOpen ? (
          <EmbeddedWorkoutCoachChat
            entry={entry}
            seedText={coachSeedText ?? currentCoachSeedText}
            seedNonce={coachChatNonce}
            onBack={onCloseCoachChat ?? noop}
          />
        ) : null}
      </div>
    </ResponsiveSheet>
  );
}

function noop(): undefined {
  return undefined;
}
