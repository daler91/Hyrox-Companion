import { useCallback, useEffect,useRef } from "react";

import { useToast } from "@/hooks/use-toast";
import { useVoiceInput } from "@/hooks/useVoiceInput";

export interface EditFormState {
  focus: string;
  mainWorkout: string;
  accessory: string;
  notes: string;
}

export function useWorkoutVoiceForm(
  editForm: EditFormState,
  setEditForm: (form: EditFormState) => void,
  stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>
) {
  const { toast } = useToast();

  const editFormRef = useRef(editForm);
  useEffect(() => {
    editFormRef.current = editForm;
  }, [editForm]);

  const stopAccessoryRef = useRef<(() => void) | null>(null);
  const stopNotesRef = useRef<(() => void) | null>(null);

  const appendToField = useCallback(
    (field: keyof EditFormState, text: string) => {
      const current = editFormRef.current;
      const val = current[field];
      const separator =
        val && !val.endsWith(" ") && !val.endsWith("\n") ? " " : "";
      setEditForm({
        ...current,
        [field]: val + separator + text,
      });
    },
    [setEditForm],
  );

  const handleMainVoiceResult = useCallback(
    (transcript: string) => {
      appendToField("mainWorkout", transcript);
    },
    [appendToField],
  );

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({ title: "Voice Input", description: msg, variant: "destructive" });
    },
    [toast],
  );

  const {
    isListening: isMainListening,
    isSupported,
    interimTranscript: mainInterim,
    startListening: startMainListening,
    stopListening: stopMainListening,
    toggleListening: toggleMainListening,
  } = useVoiceInput({
    onResult: handleMainVoiceResult,
    onError: handleVoiceError,
  });

  const stopAllVoice = useCallback(() => {
    stopMainListening();
    stopAccessoryRef.current?.();
    stopNotesRef.current?.();
  }, [stopMainListening]);

  useEffect(() => {
    if (stopAllVoiceRef) {
      stopAllVoiceRef.current = stopAllVoice;
    }
  }, [stopAllVoiceRef, stopAllVoice]);

  return {
    appendToField,
    stopAccessoryRef,
    stopNotesRef,
    isMainListening,
    isSupported,
    mainInterim,
    startMainListening,
    stopMainListening,
    toggleMainListening,
    stopAllVoice,
  };
}
