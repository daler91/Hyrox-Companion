import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

import { useToast } from "@/hooks/use-toast";

import { buildWorkoutSavePayload } from "./workout-form/saveWorkoutPayload";
import type { UseWorkoutFormProps } from "./workout-form/types";
import { useSaveWorkoutMutation } from "./workout-form/useSaveWorkoutMutation";
import { useWorkoutFormState } from "./workout-form/useWorkoutFormState";
import { useWorkoutFormVoice } from "./workout-form/useWorkoutFormVoice";

/** The two dictation sessions a save ends: the description's and the notes'. */
const DICTATION_SESSIONS = 2;

export function useWorkoutForm({
  // Kept in the contract for draft callers; save branches on
  // exerciseBlocks.length so the old "force text mode" branch is gone.
  useTextMode: _useTextMode,
  exerciseBlocks,
  exerciseData,
  structureBlocks,
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

  const saveCurrentForm = () => {
    const result = buildWorkoutSavePayload({
      title: form.title,
      date: form.date,
      freeText: form.freeText,
      notes: form.notes,
      rpe: form.rpe,
      timeOfDayMin: form.timeOfDayMin,
      durationMinutes: form.durationMinutes,
      distance: form.distance,
      avgHeartrate: form.avgHeartrate,
      maxHeartrate: form.maxHeartrate,
      planDayId: form.planDayId,
      exerciseBlocks,
      exerciseData,
      structureBlocks,
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
  };

  // Save ends any dictation and waits for its last words before it builds the
  // payload. Built straight away, the phrase still being spoken was shown as
  // interim text but left out of the saved workout. stopListening calls back
  // once the recogniser's final result is in the field (at once when nothing
  // is dictating; cut off after its bound, with the words on screen committed),
  // and the re-render that asks for carries the text to the effect below, as
  // "Continue to exercises" does. CL54 (CODEBASE_ANALYSIS_2026-10-03)
  const saveRef = useRef<"idle" | "waiting" | "ready">("idle");
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => {
    if (saveRef.current !== "ready") return;
    saveRef.current = "idle";
    saveCurrentForm();
  });

  const { stopListening: stopDescriptionDictation } = voiceInput;
  const { stopListening: stopNotesDictation } = notesVoiceInput;
  const handleSave = useCallback(() => {
    if (saveRef.current !== "idle") return;
    saveRef.current = "waiting";
    let running = DICTATION_SESSIONS;
    const onStopped = () => {
      running -= 1;
      if (running > 0) return;
      saveRef.current = "ready";
      rerender();
    };
    stopDescriptionDictation(onStopped);
    stopNotesDictation(onStopped);
  }, [stopDescriptionDictation, stopNotesDictation]);

  return {
    ...form,
    voiceInput,
    notesVoiceInput,
    saveMutation,
    handleSave,
  };
}
