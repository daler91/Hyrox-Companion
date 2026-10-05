import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import type { ParseImageInput } from "@/hooks/useNutrition";
import { cn } from "@/lib/utils";

import { useAiConsentGate } from "./useAiConsentGate";

/**
 * "Scan label" entry point (label-scan flow): the user photographs a nutrition
 * facts label, Gemini Vision transcribes the printed values verbatim (unlike
 * "Snap a meal", which estimates), and the result prefills the custom-food
 * form — nothing is saved until the user reviews and confirms there. Reuses
 * ImageCaptureButton (OS camera on mobile, file picker on desktop) and its
 * built-in compression. Consent-gated inline: the photo is held locally until
 * the user has agreed to AI processing, so a first try never dead-ends in an
 * error.
 *
 * The parse itself is owned by the caller, which outlives this row (see
 * SnapMealButton). CL31 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function ScanLabelButton({
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
        label={isParsing ? "Reading the label…" : "Scan label"}
        tooltip="Scan a nutrition label — we'll read the printed values for you to review before saving."
        disabled={isParsing}
        data-testid="button-scan-label"
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
