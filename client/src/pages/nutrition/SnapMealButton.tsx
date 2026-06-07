import type { ParseMealResponse } from "@shared/schema";

import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import { useParseMealPhoto } from "@/hooks/useNutrition";

/**
 * "Snap a meal" entry point (FR-4.1, photo path): the user takes or uploads a
 * photo of their meal, Gemini Vision identifies the foods and estimates
 * portions, and the result is handed to the review sheet (via `onParsed`) —
 * nothing is logged until the user confirms there. Reuses ImageCaptureButton
 * (OS camera on mobile, file picker on desktop) and its built-in image
 * compression + processing state; the parse request runs while the button is
 * disabled.
 */
export function SnapMealButton({
  onParsed,
}: {
  readonly onParsed: (result: ParseMealResponse) => void;
}) {
  const parse = useParseMealPhoto();

  return (
    <ImageCaptureButton
      size="sm"
      label="Snap a meal"
      tooltip="Snap a meal — we'll identify the foods and estimate portions for you to review before logging."
      disabled={parse.isPending}
      data-testid="button-snap-meal"
      onImage={(image) =>
        parse.mutate(
          { imageBase64: image.base64, mimeType: image.mimeType },
          { onSuccess: (result) => onParsed(result) },
        )
      }
    />
  );
}
