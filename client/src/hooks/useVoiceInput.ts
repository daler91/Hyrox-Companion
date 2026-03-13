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

function getVoiceErrorMessage(errorCode: string, micGranted: boolean): string | null {
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
  return "Could not access microphone. Please check your browser settings and try again.";
}

interface UseVoiceInputOptions {
  onResult?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  onError?: (message: string) => void;
  continuous?: boolean;
  lang?: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const { onResult, onInterim, onError, continuous = true, lang = "en-US" } = options;
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);

  onResultRef.current = onResult;
  onInterimRef.current = onInterim;
  onErrorRef.current = onError;

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  const micGrantedRef = useRef(false);

  const startListening = useCallback(async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      micGrantedRef.current = true;
    } catch (err) {
      micGrantedRef.current = false;
      onErrorRef.current?.(getUserMediaErrorMessage(err));
      return;
    }

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
        setInterimTranscript("");
        onResultRef.current?.(finalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const message = getVoiceErrorMessage(event.error, micGrantedRef.current);
      if (message) {
        onErrorRef.current?.(message);
      }
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
      const msg = err instanceof Error ? err.message : "Failed to start voice input";
      onErrorRef.current?.(`Microphone error: ${msg}. Please check your browser permissions and try again.`);
    }
  }, [continuous, lang]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  };
}
