import React from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import {
  useWorkoutEditor,
  getBlockExerciseName,
} from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";

import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import { WorkoutDetailsCard } from "@/components/workout/WorkoutDetailsCard";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutSaveButton } from "@/components/workout/WorkoutSaveButton";
import { WorkoutModeSelector } from "@/components/workout/WorkoutModeSelector";
import { WorkoutTextMode } from "@/components/workout/WorkoutTextMode";
import { WorkoutExerciseMode } from "@/components/workout/WorkoutExerciseMode";

export default function LogWorkout() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const handleCancel = React.useCallback(() => setLocation("/"), [setLocation]);
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();

  const {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    setUseTextMode,
    sensors,
    handleDragEnd,
    addExercise,
    removeBlock,
    updateBlock,
    getSelectedExerciseNames,
    parseMutation,
  } = useWorkoutEditor();

  const {
    title,
    setTitle,
    date,
    setDate,
    freeText,
    setFreeText,
    notes,
    setNotes,
    rpe,
    setRpe,
    voiceInput,
    notesVoiceInput,
    saveMutation,
    handleSave,
  } = useWorkoutForm({
    useTextMode,
    exerciseBlocks,
    exerciseData,
    weightLabel,
    distanceUnit,
  });

  const {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  } = voiceInput;

  const {
    isListening: isNotesListening,
    isSupported: isNotesSupported,
    interimTranscript: notesInterim,
    toggleListening: toggleNotesListening,
  } = notesVoiceInput;

  const { blockCounts, blockIndices } = React.useMemo(() => {
    // ⚡ Bolt Performance Optimization:
    // Combine two O(N) array traversals into a single O(N) traversal
    // and remove the need for a secondary runningCounts object allocation.
    const counts: Record<string, number> = {};
    const indices: Record<string, number> = {};

    for (const blockId of exerciseBlocks) {
      const name = getBlockExerciseName(blockId);
      if (name) {
        counts[name] = (counts[name] || 0) + 1;
        indices[blockId] = counts[name];
      }
    }

    return { blockCounts: counts, blockIndices: indices };
  }, [exerciseBlocks]);

  return (
    <div className="container max-w-5xl mx-auto p-4 pb-20 md:pb-8 pt-4 md:pt-8 min-h-screen">
      <WorkoutHeader />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Basic Details & Notes */}
        <div className="md:col-span-5 lg:col-span-4 space-y-6 md:sticky md:top-6">
          <WorkoutDetailsCard
            title={title}
            setTitle={setTitle}
            date={date}
            setDate={setDate}
            rpe={rpe}
            setRpe={setRpe}
          />
          <WorkoutNotesCard
            notes={notes}
            setNotes={setNotes}
            isNotesListening={isNotesListening}
            isNotesSupported={isNotesSupported}
            toggleNotesListening={toggleNotesListening}
            notesInterim={notesInterim}
          />
          <WorkoutSaveButton
            handleSave={handleSave}
            isPending={saveMutation.isPending}
            onCancel={handleCancel}
          />
        </div>

        {/* Right Column: Workout Content */}
        <div className="md:col-span-7 lg:col-span-8 space-y-6">
          <WorkoutModeSelector
            useTextMode={useTextMode}
            setUseTextMode={setUseTextMode}
            isListening={isListening}
            isSupported={isSupported}
            startListening={startListening}
            stopListening={stopListening}
          />

          {useTextMode ? (
            <WorkoutTextMode
              freeText={freeText}
              setFreeText={setFreeText}
              isListening={isListening}
              isSupported={isSupported}
              toggleListening={toggleListening}
              stopListening={stopListening}
              interimTranscript={interimTranscript}
              parseMutation={parseMutation}
              toast={toast}
            />
          ) : (
            <WorkoutExerciseMode
              exerciseBlocks={exerciseBlocks}
              exerciseData={exerciseData}
              getSelectedExerciseNames={getSelectedExerciseNames}
              addExercise={addExercise}
              updateBlock={updateBlock}
              removeBlock={removeBlock}
              sensors={sensors}
              handleDragEnd={handleDragEnd}
              blockCounts={blockCounts}
              blockIndices={blockIndices}
              getBlockExerciseName={getBlockExerciseName}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
