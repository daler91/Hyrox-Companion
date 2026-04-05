import { type ParsedExercise, type TimelineEntry } from "@shared/schema";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { getExerciseLabel, exerciseSetsToStructured } from "@/lib/exerciseUtils";
import { useWorkoutEditor, exerciseToPayload } from "@/hooks/useWorkoutEditor";
import { WorkoutDetailHeader } from "./WorkoutDetailHeader";
import { WorkoutDetailEditForm } from "./workout-detail-exercises";
import { WorkoutDetailFooter } from "./WorkoutDetailActions";

interface WorkoutDetailEditModeProps {
  readonly entry: TimelineEntry;
  readonly onSave: (updates: {
    focus: string;
    mainWorkout: string;
    accessory: string | null;
    notes: string | null;
    rpe?: number | null;
    exercises?: ParsedExercise[];
  }) => void;
  readonly onCancel: () => void;
  readonly isSaving?: boolean;
}

export function WorkoutDetailEditMode({
  entry,
  onSave,
  onCancel,
  isSaving,
}: Readonly<WorkoutDetailEditModeProps>) {
  const { toast } = useToast();
  const { distanceUnit, weightUnit, weightLabel } = useUnitPreferences();
  const [editRpe, setEditRpe] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });

  const {
    exerciseBlocks: editExercises,
    exerciseData: editExerciseData,
    useTextMode,
    setUseTextMode,
    addExercise: handleAddExercise,
    removeBlock: handleRemoveBlock,
    updateBlock,
    parseMutation,
    resetEditor,
  } = useWorkoutEditor({ initialBlockCounter: 100 });

  useEffect(() => {
    if (entry) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    }
  }, [entry, resetEditor]);

  const stopAllVoiceRef = useRef<(() => void) | null>(null);

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
      // ⚡ Bolt Performance Optimization: Combine map and filter into a single O(N) reduction to prevent intermediate array allocations.
      const exercises = editExercises.reduce<ParsedExercise[]>((acc, name) => {
        const data = editExerciseData[name];
        if (data) acc.push(data);
        return acc;
      }, []);
      const distLabel = distanceUnit === "km" ? "m" : "ft";
      const mainWorkout =
        exercises.length > 0
          ? exercises
              .map((ex) => {
                const name = getExerciseLabel(ex.exerciseName, ex.customLabel);
                const sets = ex.sets || [];
                if (sets.length === 0) return `${name}: completed`;
                const firstSet = sets[0];
                const allSame = sets.every(
                  (s) => s.reps === firstSet.reps && s.weight === firstSet.weight,
                );
                const parts: string[] = [];
                if (allSame && sets.length > 1 && firstSet.reps)
                  parts.push(`${sets.length}x${firstSet.reps}`);
                else if (firstSet.reps) parts.push(`${firstSet.reps} reps`);
                if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightLabel}`);
                if (firstSet.distance) parts.push(`${firstSet.distance}${distLabel}`);
                if (firstSet.time) parts.push(`${firstSet.time}min`);
                return `${name}: ${parts.join(", ") || "completed"}`;
              })
              .join("; ")
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

  const handleParseText = () => {
    if (!editForm.mainWorkout.trim()) {
      toast({
        title: "No text",
        description: "Please describe your workout first.",
        variant: "destructive",
      });
      return;
    }
    parseMutation.mutate(editForm.mainWorkout);
  };

  const handleCancel = () => {
    stopAllVoiceRef.current?.();
    onCancel();
  };

  return (
    <>
      <WorkoutDetailHeader
        status={entry.status}
        source={entry.source}
        dayName={entry.dayName}
        focus={entry.focus}
        isEditing={true}
      />
      <WorkoutDetailEditForm
        editForm={editForm}
        setEditForm={setEditForm}
        useTextMode={useTextMode}
        setUseTextMode={setUseTextMode}
        editExercises={editExercises}
        editExerciseData={editExerciseData}
        handleAddExercise={handleAddExercise}
        handleRemoveBlock={handleRemoveBlock}
        updateBlock={updateBlock}
        parseMutation={parseMutation}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onParseText={handleParseText}
        stopAllVoiceRef={stopAllVoiceRef}
        editRpe={editRpe}
        setEditRpe={setEditRpe}
        source={entry.source}
      />
      <WorkoutDetailFooter
        isEditing={true}
        canEdit={true}
        canDelete={false}
        isSaving={isSaving}
        isDeleting={false}
        onEdit={() => {}}
        onCancelEdit={handleCancel}
        onSave={handleSave}
        onDelete={() => {}}
        onClose={() => {}}
      />
    </>
  );
}
