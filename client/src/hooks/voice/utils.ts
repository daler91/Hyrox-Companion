export const RETRYABLE_ERRORS = new Set(["network", "no-speech"]);

export function getVoiceErrorMessage(
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

export function getUserMediaErrorMessage(err: unknown): string {
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
