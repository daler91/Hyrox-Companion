import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { WorkoutDetailsCard } from "@/components/workout/WorkoutDetailsCard";
import { WorkoutExerciseMode } from "@/components/workout/WorkoutExerciseMode";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import { WorkoutModeSelector } from "@/components/workout/WorkoutModeSelector";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutSaveButton } from "@/components/workout/WorkoutSaveButton";
import { WorkoutTextMode } from "@/components/workout/WorkoutTextMode";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  clearLogWorkoutDraft,
  loadLogWorkoutDraft,
  saveLogWorkoutDraft,
} from "@/hooks/useLogWorkoutDraft";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutEditor } from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";

const DRAFT_SAVE_DEBOUNCE_MS = 400;

export default function LogWorkout() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const handleCancel = React.useCallback(() => setLocation("/"), [setLocation]);
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();
  const { user } = useAuth();
  const userKey = user?.id ?? "anon";

  // Load the draft synchronously once on mount (lazy initializer) so hook
  // initializers can hydrate from it without re-reading localStorage on every render.
  const [initialDraft] = useState(() => loadLogWorkoutDraft(userKey));

  const {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    setUseTextMode,
    addExercise,
    removeBlock,
    updateBlock,
    parseMutation,
  } = useWorkoutEditor({
    initialExerciseBlocks: initialDraft?.exerciseBlocks,
    initialExerciseData: initialDraft?.exerciseData,
    initialUseTextMode: initialDraft?.useTextMode,
    initialBlockCounter: initialDraft?.blockCounter,
  });

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
    initialValues: initialDraft
      ? {
          title: initialDraft.title,
          date: initialDraft.date,
          freeText: initialDraft.freeText,
          notes: initialDraft.notes,
          rpe: initialDraft.rpe,
        }
      : undefined,
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

  // Debounced autosave of the current in-progress workout to localStorage.
  // Uses the block counter derived from the highest seen suffix so restored
  // drafts keep producing unique block IDs when the user adds more exercises.
  const currentBlockCounter = useMemo(() => {
    let max = 0;
    for (const id of exerciseBlocks) {
      const parts = id.split("__");
      const n = Number.parseInt(parts[parts.length - 1] ?? "", 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }, [exerciseBlocks]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      saveLogWorkoutDraft(userKey, {
        title,
        date,
        freeText,
        notes,
        rpe,
        useTextMode,
        exerciseBlocks,
        exerciseData,
        blockCounter: currentBlockCounter,
      });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timerId);
  }, [
    userKey,
    title,
    date,
    freeText,
    notes,
    rpe,
    useTextMode,
    exerciseBlocks,
    exerciseData,
    currentBlockCounter,
  ]);

  // Clear the draft once the workout is successfully saved.
  useEffect(() => {
    if (saveMutation.isSuccess) {
      clearLogWorkoutDraft(userKey);
    }
  }, [saveMutation.isSuccess, userKey]);

  // "Draft restored" toast on mount. `initialDraft` comes from a lazy useState
  // initializer so it's stable across renders, meaning this effect runs exactly
  // once on mount when the restored draft is non-null.
  useEffect(() => {
    if (initialDraft) {
      toast({
        title: "Draft restored",
        description: "We brought back your in-progress workout.",
      });
    }
  }, [initialDraft, toast]);

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
              // If we have non-empty free text but we're currently in exercise
              // mode, the exercise blocks came from a Gemini parse. Show a
              // banner and offer a path back to edit the original text.
              parsedFromText={freeText.trim().length > 0 && exerciseBlocks.length > 0}
              onBackToText={() => setUseTextMode(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
