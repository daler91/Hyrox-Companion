import React from "react";
import { useLocation } from "wouter";

import { WorkoutDetailsCard } from "@/components/workout/WorkoutDetailsCard";
import { WorkoutExerciseMode } from "@/components/workout/WorkoutExerciseMode";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import { WorkoutModeSelector } from "@/components/workout/WorkoutModeSelector";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutSaveButton } from "@/components/workout/WorkoutSaveButton";
import { WorkoutTextMode } from "@/components/workout/WorkoutTextMode";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutEditor } from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";

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
    addExercise,
    removeBlock,
    updateBlock,
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

  const hasData = useTextMode
    ? freeText.trim().length > 0
    : exerciseBlocks.length > 0;

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
            hasData={hasData}
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
              addExercise={addExercise}
              updateBlock={updateBlock}
              removeBlock={removeBlock}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
