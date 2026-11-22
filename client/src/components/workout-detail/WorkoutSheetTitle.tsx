import type { TimelineEntry } from "@shared/schema";
import type { ReactNode } from "react";

import { EditableWorkoutTitle } from "./EditableWorkoutTitle";

interface WorkoutSheetTitleProps {
  readonly entry: TimelineEntry;
  readonly fallbackTitle: string;
  readonly onRenameTitle?: (entry: TimelineEntry, title: string) => void;
  readonly isRenamingTitle?: boolean;
}

/**
 * The rename handler for an entry: none without a handler, or for an entry
 * with neither a log nor a plan day to hold the title.
 */
function getTitleSaveHandler(
  entry: TimelineEntry,
  onRenameTitle?: (entry: TimelineEntry, title: string) => void,
): ((title: string) => void) | undefined {
  if (!onRenameTitle) return undefined;
  if (!entry.workoutLogId && !entry.planDayId) return undefined;
  return (nextTitle) => onRenameTitle(entry, nextTitle);
}

/**
 * The editable title a workout sheet heads with (Preview, Log, Review and
 * Skipped): the entry's focus, its rename gate and the
 * `workout-title-<id>` test ids, written out in each sheet before.
 * (CC-sheetMarkup, REFACTORING_REVIEW 2026-09-23)
 */
export function WorkoutSheetTitle({
  entry,
  fallbackTitle,
  onRenameTitle,
  isRenamingTitle,
}: WorkoutSheetTitleProps) {
  return (
    <EditableWorkoutTitle
      title={entry.focus}
      fallbackTitle={fallbackTitle}
      onSave={getTitleSaveHandler(entry, onRenameTitle)}
      isSaving={isRenamingTitle}
      testIdPrefix={`workout-title-${entry.id}`}
    />
  );
}

/** The title after a status badge, as the Review and Skipped sheets show it. */
export function BadgedWorkoutSheetTitle({
  badge,
  ...titleProps
}: WorkoutSheetTitleProps & { readonly badge: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {badge}
      <WorkoutSheetTitle {...titleProps} />
    </span>
  );
}
