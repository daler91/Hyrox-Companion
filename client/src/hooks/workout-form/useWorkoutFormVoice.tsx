import { type Dispatch, type SetStateAction,useCallback, useEffect, useRef } from "react";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useVoiceInput } from "@/hooks/useVoiceInput";

function appendTranscript(previous: string, transcript: string): string {
  const separator = previous && !previous.endsWith(" ") && !previous.endsWith("\n") ? " " : "";
  return previous + separator + transcript;
}

interface UseWorkoutFormVoiceOptions {
  readonly setFreeText: Dispatch<SetStateAction<string>>;
  readonly setNotes: Dispatch<SetStateAction<string>>;
}

export function useWorkoutFormVoice({ setFreeText, setNotes }: UseWorkoutFormVoiceOptions) {
  const { toast } = useToast();
  const startVoiceRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startNotesVoiceRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      setFreeText((prev) => appendTranscript(prev, transcript));
    },
    [setFreeText],
  );

  const handleNotesVoiceResult = useCallback(
    (transcript: string) => {
      setNotes((prev) => appendTranscript(prev, transcript));
    },
    [setNotes],
  );

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({
        title: "Voice input failed",
        description: msg,
        variant: "destructive",
        action: (
          <ToastAction
            altText="Retry voice input"
            data-testid="button-voice-retry"
            onClick={() => {
              startVoiceRef.current().catch(() => {});
            }}
          >
            Try again
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  const handleNotesVoiceError = useCallback(
    (msg: string) => {
      toast({
        title: "Voice input failed",
        description: msg,
        variant: "destructive",
        action: (
          <ToastAction
            altText="Retry notes voice input"
            data-testid="button-voice-retry-notes"
            onClick={() => {
              startNotesVoiceRef.current().catch(() => {});
            }}
          >
            Try again
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  const voiceInput = useVoiceInput({
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  const notesVoiceInput = useVoiceInput({
    onResult: handleNotesVoiceResult,
    onError: handleNotesVoiceError,
  });

  useEffect(() => {
    startVoiceRef.current = voiceInput.startListening;
    startNotesVoiceRef.current = notesVoiceInput.startListening;
  }, [voiceInput.startListening, notesVoiceInput.startListening]);

  return {
    voiceInput,
    notesVoiceInput,
  };
}
