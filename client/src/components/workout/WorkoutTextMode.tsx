import { Mic } from "lucide-react";
import React from "react";

import { Textarea } from "@/components/ui/textarea";
import { VoiceButton } from "@/components/VoiceButton";
import type { toast as toastFn } from "@/hooks/use-toast";

interface WorkoutTextModeProps {
  freeText: string;
  setFreeText: (value: string) => void;
  isListening: boolean;
  isSupported: boolean;
  toggleListening: () => void;
  stopListening: () => void;
  interimTranscript: string;
  // Kept in the props signature so legacy callers don't break, but the
  // inline "Parse & review" button has moved to the composer's
  // auto-parse pipeline and this prop is ignored.
  toast?: typeof toastFn;
}

/**
 * Pure textarea + voice dictation surface. Used inside
 * `WorkoutComposer`'s collapsible panel — the auto-parse loop lives in
 * `useWorkoutEditor` and watches the `freeText` value, so this component
 * no longer owns a "parse now" button. Voice transcripts stream into
 * `freeText` via the parent's onChange, which re-primes the debounce.
 */
export const WorkoutTextMode = ({
  freeText,
  setFreeText,
  isListening,
  isSupported,
  toggleListening,
  interimTranscript,
}: Readonly<WorkoutTextModeProps>) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Workout description</span>
        <VoiceButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={toggleListening}
          className=""
        />
      </div>
      {isListening && (
        <div
          className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          data-testid="voice-listening-indicator"
        >
          <Mic className="h-4 w-4 animate-pulse" aria-hidden />
          <span>Listening… speak your workout</span>
        </div>
      )}
      <Textarea
        placeholder={
          isListening
            ? "Listening… describe your workout"
            : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n3x10 bent over rows at 50kg\n5km tempo run in 25 min\n1000m skierg"
        }
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        className="min-h-[120px]"
        aria-label="Workout description"
        data-testid="input-freetext"
      />
      {isListening && interimTranscript && (
        <div
          className="px-3 py-1 text-xs text-muted-foreground italic truncate"
          data-testid="voice-interim-freetext"
        >
          {interimTranscript}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {isSupported
          ? "Use the microphone to dictate, or type. We'll parse exercises into the list below as you go."
          : "Type your workout and we'll parse exercises into the list below as you go."}
      </p>
    </div>
  );
};
