import { useCallback, useEffect, useRef, useState } from "react";

import { VOICE_DEDUP_WINDOW_MS, VOICE_MAX_RETRIES, VOICE_RETRY_DELAY_MS } from "../constants";
import { getSpeechRecognitionConstructor, requestMicrophoneProbe } from "./speechRecognition";
import { dedupeFinalTranscript, type TranscriptEmission } from "./transcriptDeduper";
import type {
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
  UseVoiceInputOptions,
} from "./types";
import { getUserMediaErrorMessage, getVoiceErrorMessage, RETRYABLE_ERRORS } from "./utils";

export function useSpeechRecognitionSession({
  onResult,
  onInterim,
  onError,
  continuous = true,
  lang = "en-US",
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);
  const micGrantedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedByUserRef = useRef(false);
  const recentEmissionsRef = useRef<TranscriptEmission[]>([]);
  const startRecognitionRef = useRef<() => void>(() => {});

  useEffect(() => {
    onResultRef.current = onResult;
    onInterimRef.current = onInterim;
    onErrorRef.current = onError;
  }, [onResult, onInterim, onError]);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const processFinalTranscript = useCallback((finalTranscript: string) => {
    setInterimTranscript("");
    const result = dedupeFinalTranscript(
      finalTranscript,
      recentEmissionsRef.current,
      Date.now(),
      VOICE_DEDUP_WINDOW_MS,
    );
    recentEmissionsRef.current = [...result.emissions];
    if (result.textToEmit) {
      onResultRef.current?.(result.textToEmit);
    }
  }, []);

  const startRecognition = useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      retryCountRef.current = 0;
      let finalTranscript = "";
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        onInterimRef.current?.(interim);
      }

      if (finalTranscript) {
        processFinalTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (stoppedByUserRef.current) return;

      if (RETRYABLE_ERRORS.has(event.error) && retryCountRef.current < VOICE_MAX_RETRIES) {
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          if (!stoppedByUserRef.current) {
            startRecognitionRef.current();
          }
        }, VOICE_RETRY_DELAY_MS);
        return;
      }

      const message = getVoiceErrorMessage(event.error, micGrantedRef.current);
      if (message) {
        onErrorRef.current?.(message);
      }
      retryCountRef.current = 0;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      if (stoppedByUserRef.current) return;
      if (retryTimeoutRef.current !== null) return;
      setIsListening(false);
      setInterimTranscript("");
    };

    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      retryCountRef.current = 0;
      setIsListening(false);
      setInterimTranscript("");
      const msg = err instanceof Error ? err.message : "Failed to start voice input";
      onErrorRef.current?.(
        `Microphone error: ${msg}. Please check your browser permissions and try again.`,
      );
    }
  }, [continuous, lang, processFinalTranscript]);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  const startListening = useCallback(async () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return;

    stoppedByUserRef.current = false;
    retryCountRef.current = 0;
    recentEmissionsRef.current = [];
    clearRetryTimeout();

    try {
      await requestMicrophoneProbe();
      micGrantedRef.current = true;
    } catch (err) {
      micGrantedRef.current = false;
      onErrorRef.current?.(getUserMediaErrorMessage(err));
      return;
    }

    startRecognition();
  }, [startRecognition, clearRetryTimeout]);

  const stopListening = useCallback(() => {
    stoppedByUserRef.current = true;
    clearRetryTimeout();
    retryCountRef.current = 0;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript("");
  }, [clearRetryTimeout]);

  useEffect(() => {
    return () => {
      clearRetryTimeout();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [clearRetryTimeout]);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  };
}
