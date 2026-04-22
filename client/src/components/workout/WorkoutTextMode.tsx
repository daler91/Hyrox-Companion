import { Mic } from "lucide-react";
import React from "react";

import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import { Textarea } from "@/components/ui/textarea";
import { VoiceButton } from "@/components/VoiceButton";
import { ExerciseImagePreview } from "@/components/workout/ExerciseImagePreview";
import type { toast as toastFn } from "@/hooks/use-toast";
import type { CompressedImage } from "@/lib/image";

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
  /**
   * Optional image-capture wiring. When any of these props is undefined the
   * photo button is hidden and the component falls back to the voice-only
   * flow, so existing callers don't have to opt in.
   */
  onCaptureImage?: (image: CompressedImage) => void;
  imagePreview?: { readonly url: string; readonly error?: string | null } | null;
  onRetakeImage?: () => void;
  onParseImage?: () => void;
  isParsingImage?: boolean;
}

/**
 * Pure textarea + voice dictation surface. Used inside
 * `WorkoutComposer`'s collapsible panel — the auto-parse loop lives in
 * `useWorkoutEditor` and watches the `freeText` value, so this component
 * no longer owns a "parse now" button. Voice transcripts stream into
 * `freeText` via the parent's onChange, which re-primes the debounce.
 *
 * When an `imagePreview` is active, the textarea is swapped for the
 * image preview surface so the user confirms the capture before the
 * vision-parse mutation fires.
 */
export const WorkoutTextMode = ({
  freeText,
  setFreeText,
  isListening,
  isSupported,
  toggleListening,
  interimTranscript,
  onCaptureImage,
  imagePreview,
  onRetakeImage,
  onParseImage,
  isParsingImage,
}: Readonly<WorkoutTextModeProps>) => {
  const previewActive = !!imagePreview && !!onRetakeImage && !!onParseImage;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Workout description</span>
        <div className="flex items-center gap-2">
          {onCaptureImage && !previewActive && (
            <ImageCaptureButton
              onImage={onCaptureImage}
              size="icon"
              disabled={isListening}
              data-testid="button-photo-input"
            />
          )}
          {/*
            Hide voice while a photo preview is active. Without this, a user
            who toggles dictation after capturing can stream transcript into
            `freeText` — every change re-schedules an auto-parse, which can
            land AFTER the image parse and overwrite the image-derived
            blocks. Mirrors the photo-button hide for symmetry.
          */}
          {!previewActive && (
            <VoiceButton
              isListening={isListening}
              isSupported={isSupported}
              onClick={toggleListening}
              className=""
            />
          )}
        </div>
      </div>
      {previewActive ? (
        <ExerciseImagePreview
          previewUrl={imagePreview.url}
          error={imagePreview.error ?? null}
          isParsing={isParsingImage}
          onRetake={onRetakeImage}
          onParse={onParseImage}
        />
      ) : (
        <>
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
              ? "Type, dictate with the mic, or scan a whiteboard photo — the scan auto-fills your exercises."
              : "Type your workout or scan a whiteboard photo — the scan auto-fills your exercises."}
          </p>
        </>
      )}
    </div>
  );
};
