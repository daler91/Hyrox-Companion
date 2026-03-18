import { useState, useRef, useCallback, useEffect } from "react";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const RETRYABLE_ERRORS = new Set(["network", "no-speech"]);
const DEDUP_WINDOW_MS = 3000;

function getVoiceErrorMessage(
  errorCode: string,
  micGranted: boolean,
): string | null {
  switch (errorCode) {
    case "not-allowed":
      if (micGranted) {
        return "Speech recognition service is unavailable. Your microphone is working, but the browser's speech service could not start. Try restarting your browser or using Chrome.";
      }
      return "Microphone access denied. Please click the lock icon in the address bar, set Microphone to Allow, and reload the page.";
    case "service-not-allowed":
      return "Speech recognition is not available in this browser or context. Try opening the app directly (not in an embedded frame).";
    case "network":
      return "Network error during speech recognition. Please check your internet connection and try again.";
    case "no-speech":
      return "No speech was detected. Please try again and speak clearly into your microphone.";
    case "audio-capture":
      return "No microphone was found. Please connect a microphone and try again.";
    case "aborted":
      return null;
    default:
      return `Voice input error: ${errorCode}. Please try again.`;
  }
}

function getUserMediaErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return "Microphone access denied. Please click the lock icon in the address bar, set Microphone to Allow, and reload the page.";
      case "NotFoundError":
        return "No microphone found. Please connect a microphone and try again.";
      case "NotReadableError":
        return "Microphone is in use by another application. Please close other apps using the mic and try again.";
      default:
        return `Could not access microphone: ${err.message}`;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not access microphone: ${msg}`;
}

interface UseVoiceInputOptions {
  onResult?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  onError?: (message: string) => void;
  continuous?: boolean;
  lang?: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const {
    onResult,
    onInterim,
    onError,
    continuous = true,
    lang = "en-US",
  } = options;
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);
  const micGrantedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedByUserRef = useRef(false);
  const recentEmissionsRef = useRef<Array<{ text: string; time: number }>>([]);

  onResultRef.current = onResult;
  onInterimRef.current = onInterim;
  onErrorRef.current = onError;

  useEffect(() => {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition ||
      (globalThis as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const processFinalTranscript = useCallback((finalTranscript: string) => {
    setInterimTranscript("");
    const now = Date.now();
    const normalized = finalTranscript.trim().toLowerCase();
    recentEmissionsRef.current = recentEmissionsRef.current.filter(
      (e) => now - e.time < DEDUP_WINDOW_MS,
    );
    // Android Chrome in continuous mode can emit overlapping/progressive
    // finals: "House" then "House is very small". We handle 3 cases:
    // 1. Exact duplicate -> skip
    // 2. New is a subset of previous -> skip (partial re-fire)
    // 3. New is a superset of previous -> emit only the delta (new words)
    // NOTE: We use startsWith (not includes) because Android progressive
    // finals always extend from the beginning of the utterance. Using
    // includes would cause false matches on common words like "I am"
    // appearing in the middle of unrelated sentences.
    const exactOrSubset = recentEmissionsRef.current.some(
      (e) => e.text === normalized || e.text.startsWith(normalized),
    );
    if (!exactOrSubset) {
      // Check if the new result is a superset of a previous emission
      const supersetOf = recentEmissionsRef.current.findIndex((e) =>
        normalized.startsWith(e.text),
      );
      if (supersetOf !== -1) {
        // Case 3: new is a superset - emit only the new portion
        const previousText = recentEmissionsRef.current[supersetOf].text;
        const delta = normalized.slice(previousText.length).trim();
        // Update the tracker to the full (longer) text
        recentEmissionsRef.current[supersetOf] = {
          text: normalized,
          time: now,
        };
        if (delta) {
          onResultRef.current?.(delta);
        }
      } else {
        // Completely new text - emit as-is
        recentEmissionsRef.current.push({ text: normalized, time: now });
        onResultRef.current?.(finalTranscript);
      }
    }
  }, []);

  const startRecognition = useCallback(() => {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition ||
      (globalThis as any).webkitSpeechRecognition;
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

      if (
        RETRYABLE_ERRORS.has(event.error) &&
        retryCountRef.current < MAX_RETRIES
      ) {
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          if (!stoppedByUserRef.current) {
            startRecognition();
          }
        }, RETRY_DELAY_MS);
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
      const msg =
        err instanceof Error ? err.message : "Failed to start voice input";
      onErrorRef.current?.(
        `Microphone error: ${msg}. Please check your browser permissions and try again.`,
      );
    }
  }, [continuous, lang, processFinalTranscript]);

  const startListening = useCallback(async () => {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition ||
      (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    stoppedByUserRef.current = false;
    retryCountRef.current = 0;
    recentEmissionsRef.current = [];
    clearRetryTimeout();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
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

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

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
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  };
}
