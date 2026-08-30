import type { TimelineEntry } from "@shared/schema";
import { MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { getStatusBadge } from "@/components/timeline/timeline-workout-card/utils";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";
import {
  ReadOnlyWorkoutActionGrid,
  ReadOnlyWorkoutDetailSheet,
} from "./ReadOnlyWorkoutDetailSheet";
import type { WorkoutCoachChatProps } from "./WorkoutCoachPanel";

interface SkippedSheetProps extends WorkoutCoachChatProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  /** Flip the entry's status back to "planned" so the user can log it. */
  readonly onUndoSkip?: (entry: TimelineEntry) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle?: boolean;
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
  onRenameTitle,
  isRenamingTitle = false,
  ...coachProps
}: SkippedSheetProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const handleDeleteConfirm = () => {
    if (!entry) return;
    onDelete?.(entry);
    setDeleteConfirmOpen(false);
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
          <EditableWorkoutTitle
            title={entry.focus}
            fallbackTitle="Skipped workout"
            onSave={
              onRenameTitle && (entry.workoutLogId || entry.planDayId)
                ? (title) => onRenameTitle(entry, title)
                : undefined
            }
            isSaving={isRenamingTitle}
            testIdPrefix={`workout-title-${entry.id}`}
          />
        </span>
      }
      sheetTestId={`skipped-sheet-${entry.id}`}
      detailsTestId={`skipped-details-${entry.id}`}
      returnTestId={`skipped-return-to-coach-${entry.id}`}
      summaryVariant="preview"
      renderActions={(seedText) => (
        <SkippedActions
          deleteConfirmOpen={deleteConfirmOpen}
          entry={entry}
          seedText={seedText}
          onAskCoach={onAskCoach}
          onDelete={onDelete}
          onDeleteConfirmOpenChange={setDeleteConfirmOpen}
          onDeleteConfirm={handleDeleteConfirm}
          onUndoSkip={onUndoSkip}
        />
      )}
    />
  );
}

interface SkippedActionsProps {
  readonly deleteConfirmOpen: boolean;
  readonly entry: TimelineEntry;
  readonly seedText: string;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onDelete?: (entry: TimelineEntry) => void;
  readonly onDeleteConfirmOpenChange: (open: boolean) => void;
  readonly onDeleteConfirm: () => void;
  readonly onUndoSkip?: (entry: TimelineEntry) => void;
}

type SkippedAction = ComponentProps<typeof ReadOnlyWorkoutActionGrid>["actions"][number];

/** An action with no handler is dropped by the grid, which is how gating works. */
function buildSkippedActions({
  entry,
  seedText,
  onAskCoach,
  onDelete,
  onDeleteConfirmOpenChange,
  onUndoSkip,
}: SkippedActionsProps): SkippedAction[] {
  return [
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
      label: "Delete",
      onClick: onDelete ? () => onDeleteConfirmOpenChange(true) : undefined,
      testId: `skipped-delete-${entry.id}`,
      variant: "ghost",
    },
  ];
}

function SkippedActions(props: SkippedActionsProps) {
  return (
    <>
      <ReadOnlyWorkoutActionGrid actions={buildSkippedActions(props)} />
      {props.onDelete ? (
        <ConfirmDialog
          open={props.deleteConfirmOpen}
          onOpenChange={props.onDeleteConfirmOpenChange}
          title="Delete workout?"
          description="This workout will be permanently removed. This cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={props.onDeleteConfirm}
          isDestructive
          cancelTestId={`skipped-cancel-delete-${props.entry.id}`}
          confirmTestId={`skipped-confirm-delete-${props.entry.id}`}
        />
      ) : null}
    </>
  );
}
