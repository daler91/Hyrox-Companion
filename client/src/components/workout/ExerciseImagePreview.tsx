import { Loader2, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ExerciseImagePreviewProps {
  readonly previewUrl: string;
  readonly onRetake: () => void;
  readonly onParse: () => void;
  readonly isParsing?: boolean;
  readonly error?: string | null;
  readonly className?: string;
}

/**
 * Inline preview for a captured workout photo. Rendered in place of the
 * textarea / free-text editor while the user confirms the shot. The
 * parent owns the previewUrl lifetime and should revoke it when this
 * component unmounts or the user retakes.
 */
export function ExerciseImagePreview({
  previewUrl,
  onRetake,
  onParse,
  isParsing,
  error,
  className,
}: ExerciseImagePreviewProps) {
  return (
    <div
      className={className ?? "flex flex-col gap-3"}
      data-testid="exercise-image-preview"
    >
      <div className="overflow-hidden rounded-md border border-border bg-muted/30">
        <img
          src={previewUrl}
          alt="Captured workout plan"
          className="block max-h-[320px] w-full object-contain"
          data-testid="exercise-image-preview-thumbnail"
        />
      </div>
      {error && (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid="exercise-image-preview-error"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetake}
          disabled={isParsing}
          data-testid="exercise-image-preview-retake"
        >
          <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
          Retake
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onParse}
          disabled={isParsing}
          data-testid="exercise-image-preview-parse"
        >
          {isParsing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="mr-1.5 size-3.5" aria-hidden />
          )}
          {isParsing ? "Parsing…" : "Parse this image"}
        </Button>
      </div>
    </div>
  );
}
