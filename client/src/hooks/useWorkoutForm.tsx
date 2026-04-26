import { useCallback } from "react";

import { useToast } from "@/hooks/use-toast";

import { buildWorkoutSavePayload } from "./workout-form/saveWorkoutPayload";
import type { UseWorkoutFormProps } from "./workout-form/types";
import { useSaveWorkoutMutation } from "./workout-form/useSaveWorkoutMutation";
import { useWorkoutFormState } from "./workout-form/useWorkoutFormState";
import { useWorkoutFormVoice } from "./workout-form/useWorkoutFormVoice";

export function useWorkoutForm({
  // Kept in the contract for draft callers; save branches on
  // exerciseBlocks.length so the old "force text mode" branch is gone.
  useTextMode: _useTextMode,
  exerciseBlocks,
  exerciseData,
  weightLabel,
  distanceUnit,
  initialValues,
  onSaveSuccess,
}: UseWorkoutFormProps) {
  const { toast } = useToast();
  const form = useWorkoutFormState(initialValues);
  const { voiceInput, notesVoiceInput } = useWorkoutFormVoice({
    setFreeText: form.setFreeText,
    setNotes: form.setNotes,
  });
  const saveMutation = useSaveWorkoutMutation(onSaveSuccess);

  const handleSave = useCallback(() => {
    if (voiceInput.isListening) voiceInput.stopListening();
    if (notesVoiceInput.isListening) notesVoiceInput.stopListening();

    const result = buildWorkoutSavePayload({
      title: form.title,
      date: form.date,
      freeText: form.freeText,
      notes: form.notes,
      rpe: form.rpe,
      exerciseBlocks,
      exerciseData,
      weightLabel,
      distanceUnit,
    });

    if (!result.ok) {
      toast({
        title: "Missing workout details",
        description: result.description,
        variant: "destructive",
      });
      return;
    }

    if (result.warnings.length > 0) {
      toast({
        title: "Some data is missing",
        description:
          result.warnings.slice(0, 3).join(". ") +
          (result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : "") +
          ". Saving anyway - you can edit later.",
      });
    }

    saveMutation.mutate(result.payload);
  }, [
    voiceInput,
    notesVoiceInput,
    form,
    exerciseBlocks,
    exerciseData,
    weightLabel,
    distanceUnit,
    toast,
    saveMutation,
  ]);

  return {
    ...form,
    voiceInput,
    notesVoiceInput,
    saveMutation,
    handleSave,
  };
}
