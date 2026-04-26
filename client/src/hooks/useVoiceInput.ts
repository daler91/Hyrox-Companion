import { useCallback } from "react";

import type { UseVoiceInputOptions } from "./voice/types";
import { useSpeechRecognitionSession } from "./voice/useSpeechRecognitionSession";
import { useSpeechRecognitionSupport } from "./voice/useSpeechRecognitionSupport";

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const isSupported = useSpeechRecognitionSupport();
  const { isListening, interimTranscript, startListening, stopListening } =
    useSpeechRecognitionSession(options);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening().catch(() => {});
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  };
}
