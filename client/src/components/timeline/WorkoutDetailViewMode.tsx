import { type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { WorkoutDetailHeader } from "./WorkoutDetailHeader";
import { WorkoutDetailView } from "./WorkoutDetailExercises";
import { StatusChangeSection, WorkoutDetailFooter } from "./WorkoutDetailActions";

interface WorkoutDetailViewModeProps {
  readonly entry: TimelineEntry;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly isDeleting?: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
  readonly onMarkComplete: (entry: TimelineEntry) => void;
  readonly onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
  readonly onCombine?: (entry: TimelineEntry) => void;
}

export function WorkoutDetailViewMode({
  entry,
  canEdit,
  canDelete,
  isDeleting,
  onEdit,
  onDelete,
  onClose,
  onMarkComplete,
  onChangeStatus,
  onCombine,
}: Readonly<WorkoutDetailViewModeProps>) {
  const { distanceUnit, weightLabel } = useUnitPreferences();

  const hasStructuredData = entry.exerciseSets && entry.exerciseSets.length > 0;
  const grouped = hasStructuredData ? groupExerciseSets(entry.exerciseSets!) : [];
  const canChangeStatus = !!entry.planDayId;

  return (
    <>
      <WorkoutDetailHeader
        status={entry.status}
        source={entry.source}
        dayName={entry.dayName}
        focus={entry.focus}
        isEditing={false}
      />

      <WorkoutDetailView
        entry={entry}
        grouped={grouped}
        hasStructuredData={!!hasStructuredData}
        weightLabel={weightLabel}
        distanceUnit={distanceUnit}
      />

      {canChangeStatus && (
        <StatusChangeSection
          entry={entry}
          onMarkComplete={onMarkComplete}
          onChangeStatus={onChangeStatus}
        />
      )}

      <WorkoutDetailFooter
        isEditing={false}
        canEdit={canEdit}
        canDelete={canDelete}
        isDeleting={isDeleting}
        onEdit={onEdit}
        onCancelEdit={() => {}}
        onSave={() => {}}
        onDelete={onDelete}
        onClose={onClose}
        onCombine={onCombine ? () => onCombine(entry) : undefined}
      />
    </>
  );
}
