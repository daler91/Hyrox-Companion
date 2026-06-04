import type { SpeechRecognitionInstance } from "./types";

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionConstructor());
}

export async function requestMicrophoneProbe(): Promise<void> {
  // Browser-compat: navigator.mediaDevices is undefined on insecure (HTTP)
  // origins and very old browsers. Guard so the caller shows a clear message
  // instead of a "Cannot read properties of undefined" TypeError.
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access requires a secure (HTTPS) connection.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}
