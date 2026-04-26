import { useCallback } from "react";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { clearLogWorkoutDraft } from "@/hooks/useLogWorkoutDraft";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { useWorkoutEditor } from "@/hooks/useWorkoutEditor";
import { useWorkoutForm } from "@/hooks/useWorkoutForm";

import { LogWorkoutFormLayout } from "./LogWorkoutFormLayout";
import { useDuplicateLastWorkout } from "./useDuplicateLastWorkout";
import {
  useInitialLogWorkoutDraft,
  useLogWorkoutDraftPersistence,
} from "./useLogWorkoutDraftPersistence";

interface LogWorkoutFormProps {
  userKey: string;
}

export function LogWorkoutForm({ userKey }: Readonly<LogWorkoutFormProps>) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const handleCancel = useCallback(() => setLocation("/"), [setLocation]);
  const { weightUnit, distanceUnit, weightLabel } = useUnitPreferences();
  const initialDraft = useInitialLogWorkoutDraft(userKey);

  const {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    addExercise,
    removeBlock,
    updateBlock,
    reorderBlocks,
    resetEditor,
    autoParsing,
    autoParseError,
    parseNow,
    cancelAutoParse,
    parseImageMutation,
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
    planDayId,
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
          planDayId: initialDraft.planDayId,
        }
      : undefined,
    onSaveSuccess: () => clearLogWorkoutDraft(userKey),
  });

  const { isListening, isSupported, interimTranscript, stopListening, toggleListening } =
    voiceInput;

  const {
    isListening: isNotesListening,
    isSupported: isNotesSupported,
    interimTranscript: notesInterim,
    toggleListening: toggleNotesListening,
  } = notesVoiceInput;

  const { handleDuplicateLast, isDuplicating } = useDuplicateLastWorkout({
    setDate,
    setRpe,
    setTitle,
    setNotes,
    setFreeText,
    resetEditor,
    toast,
  });

  useLogWorkoutDraftPersistence({
    userKey,
    initialDraft,
    title,
    date,
    freeText,
    notes,
    rpe,
    planDayId,
    useTextMode,
    exerciseBlocks,
    exerciseData,
    toast,
  });

  const hasWorkoutDetails = exerciseBlocks.length > 0 || freeText.trim().length > 0;

  return (
    <LogWorkoutFormLayout
      title={title}
      setTitle={setTitle}
      date={date}
      setDate={setDate}
      rpe={rpe}
      setRpe={setRpe}
      notes={notes}
      setNotes={setNotes}
      freeText={freeText}
      setFreeText={setFreeText}
      exerciseBlocks={exerciseBlocks}
      exerciseData={exerciseData}
      addExercise={addExercise}
      updateBlock={updateBlock}
      removeBlock={removeBlock}
      reorderBlocks={reorderBlocks}
      weightUnit={weightUnit}
      distanceUnit={distanceUnit}
      autoParsing={autoParsing}
      autoParseError={autoParseError}
      parseNow={parseNow}
      cancelAutoParse={cancelAutoParse}
      isListening={isListening}
      isSupported={isSupported}
      interimTranscript={interimTranscript}
      toggleListening={toggleListening}
      stopListening={stopListening}
      isNotesListening={isNotesListening}
      isNotesSupported={isNotesSupported}
      notesInterim={notesInterim}
      toggleNotesListening={toggleNotesListening}
      handleSave={handleSave}
      isSaving={saveMutation.isPending}
      handleCancel={handleCancel}
      hasWorkoutDetails={hasWorkoutDetails}
      handleDuplicateLast={handleDuplicateLast}
      isDuplicating={isDuplicating}
      defaultPanelOpen={initialDraft?.useTextMode ? true : undefined}
      toast={toast}
      onParseImage={(payload, opts) => parseImageMutation.mutate(payload, opts)}
      isParsingImage={parseImageMutation.isPending}
    />
  );
}
