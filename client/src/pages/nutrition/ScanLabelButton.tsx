import type { ParseLabelResponse } from "@shared/schema";

import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import { useToast } from "@/hooks/use-toast";
import { useParseNutritionLabel } from "@/hooks/useNutrition";

/**
 * "Scan label" entry point (label-scan flow): the user photographs a nutrition
 * facts label, Gemini Vision transcribes the printed values verbatim (unlike
 * "Snap a meal", which estimates), and the result is handed up via
 * `onExtracted` to prefill the custom-food form — nothing is saved until the
 * user reviews and confirms there. Reuses ImageCaptureButton (OS camera on
 * mobile, file picker on desktop) and its built-in compression.
 */
export function ScanLabelButton({
  onExtracted,
}: {
  readonly onExtracted: (result: ParseLabelResponse) => void;
}) {
  const parse = useParseNutritionLabel();
  const { toast } = useToast();

  return (
    <ImageCaptureButton
      size="sm"
      label="Scan label"
      tooltip="Scan a nutrition label — we'll read the printed values for you to review before saving."
      disabled={parse.isPending}
      data-testid="button-scan-label"
      onImage={(image) =>
        parse.mutate(
          { imageBase64: image.base64, mimeType: image.mimeType },
          {
            onSuccess: (result) => {
              if (result.label === null) {
                toast({
                  title: "No nutrition label found",
                  description: "Try a closer, well-lit photo of the nutrition facts panel.",
                  variant: "destructive",
                });
                return;
              }
              onExtracted(result);
            },
          },
        )
      }
    />
  );
}
