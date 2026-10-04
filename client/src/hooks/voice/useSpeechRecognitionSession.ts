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

// How long a stopped recogniser gets to return its final result and end
// before it is cut off and the words on screen are committed instead
// (CL30, CODEBASE_ANALYSIS_2026-10-03).
const STOP_RESULT_TIMEOUT_MS = 2000;

export function useSpeechRecognitionSession({
  onResult,
  onInterim,
  onError,
  continuous = true,
  lang = "en-US",
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  // Mirrors interimTranscript: words heard that no final result has replaced
  // yet, committed if a stopped recogniser never finalises them
  // (CL30, CODEBASE_ANALYSIS_2026-10-03).
  const interimRef = useRef("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // The recogniser stopListening stopped, from stop() until it has delivered
  // its last result and ended, and the callers waiting for that
  // (CL30, CODEBASE_ANALYSIS_2026-10-03).
  const stoppingRef = useRef<SpeechRecognitionInstance | null>(null);
  const stopWaitersRef = useRef<(() => void)[]>([]);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const clearStopTimeout = useCallback(() => {
    if (stopTimeoutRef.current !== null) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }, []);

  const showInterim = useCallback((text: string) => {
    interimRef.current = text;
    setInterimTranscript(text);
  }, []);

  const processFinalTranscript = useCallback((finalTranscript: string) => {
    showInterim("");
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
  }, [showInterim]);

  // Ends the stop phase once the stopped recogniser has ended or been cut off.
  // Nothing it sends afterwards is taken, words it showed but never finalised
  // are committed rather than dropped, then the waiting callers run.
  const finishStop = useCallback(() => {
    const recognition = stoppingRef.current;
    if (!recognition) return;
    stoppingRef.current = null;
    clearStopTimeout();
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    const pending = interimRef.current;
    if (pending) processFinalTranscript(pending);
    const waiters = stopWaitersRef.current;
    stopWaitersRef.current = [];
    for (const waiter of waiters) waiter();
  }, [clearStopTimeout, processFinalTranscript]);

  // Settles a stop without waiting for the recogniser: the fallback when it
  // never ends, and a restart that would otherwise run two at once.
  const cutOffStop = useCallback(() => {
    const recognition = stoppingRef.current;
    finishStop();
    recognition?.abort();
  }, [finishStop]);

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

      // The final goes first because it clears the interim: shown the other
      // way round, an event carrying both blanked the phrase still being
      // spoken, so a stop never had it to commit (CL30, CODEBASE_ANALYSIS_2026-10-03).
      if (finalTranscript) {
        processFinalTranscript(finalTranscript);
      }

      if (interim) {
        showInterim(interim);
        onInterimRef.current?.(interim);
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
      showInterim("");
    };

    recognition.onend = () => {
      if (stoppingRef.current === recognition) {
        finishStop();
        return;
      }
      if (stoppedByUserRef.current) return;
      if (retryTimeoutRef.current !== null) return;
      // Ended by itself, so a later stopListening has nothing to wait for.
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setIsListening(false);
      showInterim("");
    };

    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      retryCountRef.current = 0;
      setIsListening(false);
      showInterim("");
      const msg = err instanceof Error ? err.message : "Failed to start voice input";
      onErrorRef.current?.(
        `Microphone error: ${msg}. Please check your browser permissions and try again.`,
      );
    }
  }, [continuous, lang, finishStop, processFinalTranscript, showInterim]);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  const startListening = useCallback(async () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return;

    cutOffStop();
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
  }, [startRecognition, clearRetryTimeout, cutOffStop]);

  // Ends dictation with stop(), under which the recogniser still returns a
  // final result for the audio captured so far and then fires `end`; abort()
  // would drop the last words. `onStopped` runs once that result has reached
  // onResult (straight away when nothing is running), so a caller such as
  // "Continue to exercises" can wait for the complete text. A recogniser that
  // has not ended after STOP_RESULT_TIMEOUT_MS is cut off and the words on
  // screen are committed (CL30, CODEBASE_ANALYSIS_2026-10-03).
  const stopListening = useCallback((onStopped?: () => void) => {
    // A recogniser waiting out a retry delay has already ended.
    const recognition = retryTimeoutRef.current === null ? recognitionRef.current : null;
    stoppedByUserRef.current = true;
    clearRetryTimeout();
    retryCountRef.current = 0;
    recognitionRef.current = null;
    setIsListening(false);
    if (recognition) {
      stoppingRef.current = recognition;
      stopTimeoutRef.current = setTimeout(cutOffStop, STOP_RESULT_TIMEOUT_MS);
      recognition.stop();
    } else if (!stoppingRef.current) {
      showInterim("");
    }
    if (!onStopped) return;
    if (stoppingRef.current) stopWaitersRef.current.push(onStopped);
    else onStopped();
  }, [clearRetryTimeout, cutOffStop, showInterim]);

  useEffect(() => {
    return () => {
      clearRetryTimeout();
      clearStopTimeout();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [clearRetryTimeout, clearStopTimeout]);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  };
}
