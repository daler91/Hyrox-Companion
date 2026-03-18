import { type ParsedExercise, type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "./WorkoutDetailActions";
import { WorkoutDetailViewMode } from "./WorkoutDetailViewMode";
import { WorkoutDetailEditMode } from "./WorkoutDetailEditMode";

interface WorkoutDetailDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onMarkComplete: (entry: TimelineEntry) => void;
  readonly onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
  readonly onSave: (updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; rpe?: number | null; exercises?: ParsedExercise[] }) => void;
  onDelete: (entry: TimelineEntry) => void;
  onCombine?: (entry: TimelineEntry) => void;
  isSaving?: boolean;
  isDeleting?: boolean;
}

export default function WorkoutDetailDialog({
  entry,
  onClose,
  onMarkComplete,
  onChangeStatus,
  onSave,
  onDelete,
  onCombine,
  isSaving,
  isDeleting,
}: Readonly<WorkoutDetailDialogProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!entry) return null;

  const hasPlanDayId = !!entry.planDayId;
  const hasWorkoutLogId = !!entry.workoutLogId;
  const canEdit = hasPlanDayId || hasWorkoutLogId;
  const canDelete = hasPlanDayId || hasWorkoutLogId;

  const handleClose = () => {
    setIsEditing(false);
    setConfirmingDelete(false);
    onClose();
  };

  const handleSave = (updates: any) => {
    onSave(updates);
    setIsEditing(false);
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", isEditing ? "max-w-4xl" : "max-w-lg")}>
        {isEditing ? (
          <WorkoutDetailEditMode
            entry={entry}
            canEdit={canEdit}
            canDelete={canDelete}
            isSaving={isSaving}
            isDeleting={isDeleting}
            onCancelEdit={() => setIsEditing(false)}
            onSave={handleSave}
            onDelete={() => setConfirmingDelete(true)}
            onClose={handleClose}
          />
        ) : (
          <WorkoutDetailViewMode
            entry={entry}
            canEdit={canEdit}
            canDelete={canDelete}
            isDeleting={isDeleting}
            onEdit={() => setIsEditing(true)}
            onDelete={() => setConfirmingDelete(true)}
            onClose={handleClose}
            onMarkComplete={onMarkComplete}
            onChangeStatus={onChangeStatus}
            onCombine={onCombine}
          />
        )}
      </DialogContent>

      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => {
          onDelete(entry);
          setConfirmingDelete(false);
        }}
        isDeleting={isDeleting}
      />
    </Dialog>
  );
}
