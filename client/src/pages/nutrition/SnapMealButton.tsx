import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import type { ParseImageInput } from "@/hooks/useNutrition";
import { cn } from "@/lib/utils";

import { useAiConsentGate } from "./useAiConsentGate";

/**
 * "Snap a meal" entry point (FR-4.1, photo path): the user takes or uploads a
 * photo of their meal, Gemini Vision identifies the foods and estimates
 * portions, and the result goes to the review sheet — nothing is logged until
 * the user confirms there. Reuses ImageCaptureButton (OS camera on mobile, file
 * picker on desktop) and its built-in image compression. Consent-gated inline:
 * the photo is held locally until the user has agreed to AI processing, so a
 * first try never dead-ends in an error.
 *
 * The parse itself is owned by the caller, which outlives this row: the row
 * sits in the Log food sheet, which can be dismissed mid-parse, and a parse
 * owned here lost its result with it. The row shows the parse's progress.
 * CL31 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function SnapMealButton({
  onImage,
  isParsing,
  size = "sm",
  className,
}: {
  readonly onImage: (image: ParseImageInput) => void;
  readonly isParsing: boolean;
  readonly size?: "sm" | "default";
  readonly className?: string;
}) {
  const { requireAiConsent, aiConsentDialog } = useAiConsentGate();

  return (
    <>
      <ImageCaptureButton
        size={size}
        className={cn(className, isParsing && "animate-pulse")}
        label={isParsing ? "Reading your meal…" : "Snap a meal"}
        tooltip="Snap a meal — we'll identify the foods and estimate portions for you to review before logging."
        disabled={isParsing}
        data-testid="button-snap-meal"
        onImage={(image) => {
          requireAiConsent(() => {
            onImage({ imageBase64: image.base64, mimeType: image.mimeType });
          });
        }}
      />
      {aiConsentDialog}
    </>
  );
}
