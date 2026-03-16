import { type ParsedExercise, type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { getExerciseLabel, groupExerciseSets } from "@/lib/exerciseUtils";
import {
  useWorkoutEditor,
  exerciseToPayload,
} from "@/hooks/useWorkoutEditor";
import { WorkoutDetailHeader } from "./WorkoutDetailHeader";
import { WorkoutDetailView, WorkoutDetailEditForm } from "./WorkoutDetailExercises";
import { exerciseSetsToStructured } from "@/lib/exerciseUtils";
import { StatusChangeSection, WorkoutDetailFooter, DeleteConfirmDialog } from "./WorkoutDetailActions";

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
}: WorkoutDetailDialogProps) {
  const { toast } = useToast();
  const { distanceUnit, weightUnit, weightLabel } = useUnitPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editRpe, setEditRpe] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });
  const hasStructuredData = entry?.exerciseSets && entry.exerciseSets.length > 0;

  const {
    exerciseBlocks: editExercises,
    exerciseData: editExerciseData,
    useTextMode,
    setUseTextMode,
    sensors: dialogSensors,
    handleDragEnd: handleEditDragEnd,
    addExercise: handleAddExercise,
    removeBlock: handleRemoveBlock,
    updateBlock,
    getSelectedExerciseNames,
    parseMutation,
    resetEditor,
  } = useWorkoutEditor({ initialBlockCounter: 100 });

  useEffect(() => {
    if (entry) {
      setEditForm({
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || "",
        notes: entry.notes || "",
      });
      setEditRpe(entry.rpe ?? null);
      if (entry.exerciseSets && entry.exerciseSets.length > 0) {
        const { names, data } = exerciseSetsToStructured(entry.exerciseSets);
        resetEditor(names, data, false);
      } else {
        resetEditor([], {}, true);
      }
      setIsEditing(false);
    }
  }, [entry, resetEditor]);

  const stopAllVoiceRef = useRef<(() => void) | null>(null);

  if (!entry) return null;

  const hasPlanDayId = !!entry.planDayId;
  const hasWorkoutLogId = !!entry.workoutLogId;
  const canEdit = hasPlanDayId || hasWorkoutLogId;
  const canDelete = hasPlanDayId || hasWorkoutLogId;

  const canChangeStatus = hasPlanDayId;
  const grouped = hasStructuredData ? groupExerciseSets(entry.exerciseSets!) : [];

  const handleSave = () => {
    stopAllVoiceRef.current?.();
    if (useTextMode) {
      onSave({
        focus: editForm.focus,
        mainWorkout: editForm.mainWorkout,
        accessory: editForm.accessory || null,
        notes: editForm.notes || null,
        rpe: editRpe,
        exercises: [],
      });
    } else {
      const exercises = editExercises.map((name) => editExerciseData[name]).filter(Boolean);
      const distLabel = distanceUnit === "km" ? "m" : "ft";
      const mainWorkout = exercises.length > 0
        ? exercises.map((ex) => {
            const name = getExerciseLabel(ex.exerciseName, ex.customLabel);
            const sets = ex.sets || [];
            if (sets.length === 0) return `${name}: completed`;
            const firstSet = sets[0];
            const allSame = sets.every(s => s.reps === firstSet.reps && s.weight === firstSet.weight);
            const parts: string[] = [];
            if (allSame && sets.length > 1 && firstSet.reps) parts.push(`${sets.length}x${firstSet.reps}`);
            else if (firstSet.reps) parts.push(`${firstSet.reps} reps`);
            if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightLabel}`);
            if (firstSet.distance) parts.push(`${firstSet.distance}${distLabel}`);
            if (firstSet.time) parts.push(`${firstSet.time}min`);
            return `${name}: ${parts.join(", ") || "completed"}`;
          }).join("; ")
        : editForm.mainWorkout;

      onSave({
        focus: editForm.focus,
        mainWorkout,
        accessory: editForm.accessory || null,
        notes: editForm.notes || null,
        rpe: editRpe,
        exercises: exercises.length > 0 ? exercises.map(exerciseToPayload) : undefined,
      });
    }
  };

  const handleClose = () => {
    stopAllVoiceRef.current?.();
    setIsEditing(false);
    setConfirmingDelete(false);
    onClose();
  };

  const handleParseText = () => {
    if (!editForm.mainWorkout.trim()) {
      toast({ title: "No text", description: "Please describe your workout first.", variant: "destructive" });
      return;
    }
    parseMutation.mutate(editForm.mainWorkout);
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", isEditing ? "max-w-4xl" : "max-w-lg")}>
        <WorkoutDetailHeader
          status={entry.status}
          source={entry.source}
          dayName={entry.dayName}
          focus={entry.focus}
          isEditing={isEditing}
        />

        {isEditing ? (
          <WorkoutDetailEditForm
              editForm={editForm}
              setEditForm={setEditForm}
              useTextMode={useTextMode}
              setUseTextMode={setUseTextMode}
              editExercises={editExercises}
              editExerciseData={editExerciseData}
              dialogSensors={dialogSensors}
              handleEditDragEnd={handleEditDragEnd}
              handleAddExercise={handleAddExercise}
              handleRemoveBlock={handleRemoveBlock}
              updateBlock={updateBlock}
              getSelectedExerciseNames={getSelectedExerciseNames}
              parseMutation={parseMutation}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              onParseText={handleParseText}
              stopAllVoiceRef={stopAllVoiceRef}
              editRpe={editRpe}
              setEditRpe={setEditRpe}
              source={entry.source}
            />
          ) : (
          <WorkoutDetailView
            entry={entry}
            grouped={grouped}
            hasStructuredData={!!hasStructuredData}
            weightLabel={weightLabel}
            distanceUnit={distanceUnit}
          />
        )}

        {canChangeStatus && !isEditing && (
          <StatusChangeSection
            entry={entry}
            onMarkComplete={onMarkComplete}
            onChangeStatus={onChangeStatus}
          />
        )}

        <WorkoutDetailFooter
          isEditing={isEditing}
          canEdit={canEdit}
          canDelete={canDelete}
          isSaving={isSaving}
          isDeleting={isDeleting}
          onEdit={() => setIsEditing(true)}
          onCancelEdit={() => { stopAllVoiceRef.current?.(); setIsEditing(false); }}
          onSave={handleSave}
          onDelete={() => setConfirmingDelete(true)}
          onClose={handleClose}
          onCombine={onCombine ? () => onCombine(entry) : undefined}
        />
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
