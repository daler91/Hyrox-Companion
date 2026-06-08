import type { TimelineEntry } from "@shared/schema";
import { CalendarClock, MessageSquare, Pencil, SkipForward } from "lucide-react";

import { featureFlags } from "@/lib/featureFlags";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";
import { FuellingPlanPanel } from "./FuellingPlanPanel";
import {
  ReadOnlyWorkoutActionGrid,
  ReadOnlyWorkoutDetailSheet,
  type WorkoutCoachSheetProps,
} from "./ReadOnlyWorkoutDetailSheet";

interface PreviewSheetProps extends WorkoutCoachSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onMove?: (entry: TimelineEntry) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onEditWorkout?: (entry: TimelineEntry) => void;
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle?: boolean;
}

/**
 * Read-only preview surface for future-dated planned workouts. Removes the
 * primary log CTA so users can't accidentally log a workout that hasn't
 * happened yet. The edit action opens the plan-day prescription editor without
 * creating a workout log.
 */
export function PreviewSheet({
  entry,
  onClose,
  onAskCoach,
  onMove,
  onSkip,
  onEditWorkout,
  onRenameTitle,
  isRenamingTitle = false,
  ...coachProps
}: PreviewSheetProps) {
  if (!entry) return null;

  return (
    <ReadOnlyWorkoutDetailSheet
      {...coachProps}
      entry={entry}
      onOpenChange={(open) => !open && onClose()}
      title={
        <EditableWorkoutTitle
          title={entry.focus}
          fallbackTitle="Upcoming workout"
          onSave={
            onRenameTitle && (entry.workoutLogId || entry.planDayId)
              ? (title) => onRenameTitle(entry, title)
              : undefined
          }
          isSaving={isRenamingTitle}
          testIdPrefix={`workout-title-${entry.id}`}
        />
      }
      sheetTestId={`preview-sheet-${entry.id}`}
      detailsTestId={`preview-details-${entry.id}`}
      returnTestId={`preview-return-to-coach-${entry.id}`}
      renderActions={(seedText) => (
        <PreviewActions
          entry={entry}
          seedText={seedText}
          onAskCoach={onAskCoach}
          onEditWorkout={onEditWorkout}
          onMove={onMove}
          onSkip={onSkip}
        />
      )}
      renderPanels={
        featureFlags.nutritionEnabled && entry.planDayId
          ? () => <FuellingPlanPanel entry={entry} />
          : undefined
      }
    />
  );
}

interface PreviewActionsProps {
  readonly entry: TimelineEntry;
  readonly seedText: string;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly onMove?: (entry: TimelineEntry) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onEditWorkout?: (entry: TimelineEntry) => void;
}

function PreviewActions({
  entry,
  seedText,
  onAskCoach,
  onEditWorkout,
  onMove,
  onSkip,
}: PreviewActionsProps) {
  return (
    <ReadOnlyWorkoutActionGrid
      actions={[
        {
          icon: MessageSquare,
          label: "Ask coach",
          onClick: onAskCoach ? () => onAskCoach(entry, seedText) : undefined,
          testId: `preview-ask-coach-${entry.id}`,
          variant: "default",
        },
        {
          icon: CalendarClock,
          label: "Move to another day",
          onClick: onMove ? () => onMove(entry) : undefined,
          testId: `preview-move-${entry.id}`,
          variant: "outline",
        },
        {
          icon: SkipForward,
          label: "Skip",
          onClick: onSkip ? () => onSkip(entry) : undefined,
          testId: `preview-skip-${entry.id}`,
          variant: "outline",
        },
        {
          icon: Pencil,
          label: "Edit workout",
          onClick: onEditWorkout ? () => onEditWorkout(entry) : undefined,
          testId: `preview-edit-workout-${entry.id}`,
          variant: "ghost",
        },
      ]}
    />
  );
}
