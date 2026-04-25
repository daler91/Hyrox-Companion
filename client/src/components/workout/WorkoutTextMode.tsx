import { Loader2, Mic, Sparkles } from "lucide-react";
import React from "react";

import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import { Button } from "@/components/ui/button";
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
  toast?: typeof toastFn;
  /**
   * Fires the manual text-parse pipeline. When omitted the Parse
   * button is hidden, which keeps consumers that do not pass a parse
   * handler untouched.
   */
  onParseText?: () => void;
  isParsingText?: boolean;
  /**
   * Optional image-capture wiring. When any of these props is undefined the
   * photo button is hidden and the component falls back to the voice-only
   * flow, so existing callers do not have to opt in.
   */
  onCaptureImage?: (image: CompressedImage) => void;
  imagePreview?: { readonly url: string; readonly error?: string | null } | null;
  onRetakeImage?: () => void;
  onParseImage?: () => void;
  isParsingImage?: boolean;
}

/**
 * Textarea + voice dictation surface with an explicit Parse button.
 * Used inside `WorkoutComposer`'s collapsible panel.
 */
export const WorkoutTextMode = ({
  freeText,
  setFreeText,
  isListening,
  isSupported,
  toggleListening,
  interimTranscript,
  onParseText,
  isParsingText,
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
        <span className="text-sm font-medium text-foreground">Description</span>
        <div className="flex items-center gap-2">
          {onCaptureImage && !previewActive && (
            <ImageCaptureButton
              onImage={onCaptureImage}
              size="icon-touch"
              disabled={isListening}
              data-testid="button-photo-input"
            />
          )}
          {!previewActive && (
            <VoiceButton
              isListening={isListening}
              isSupported={isSupported}
              onClick={toggleListening}
              size="icon-touch"
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
              <span>Listening... speak your workout</span>
            </div>
          )}
          <Textarea
            placeholder={
              isListening
                ? "Listening... describe your workout"
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
          {onParseText && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onParseText}
              disabled={isParsingText || freeText.trim().length === 0}
              className="min-h-10 w-full gap-1.5"
              data-testid="button-parse-text"
            >
              {isParsingText ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              {isParsingText ? "Parsing..." : "Parse description"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {freeText.trim()
              ? "Description captured."
              : isSupported
                ? "Text, voice, and photo input are available here."
                : "Text and photo input are available here."}
          </p>
        </>
      )}
    </div>
  );
};
