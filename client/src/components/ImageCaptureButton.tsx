import { Camera, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { type CompressedImage, compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";

export interface ImageCaptureButtonProps {
  readonly onImage: (image: CompressedImage) => void;
  readonly disabled?: boolean;
  readonly size?: "icon" | "sm" | "default";
  readonly label?: string;
  readonly className?: string;
  readonly "data-testid"?: string;
  /**
   * Override the default tooltip copy. Defaults to a description of the
   * AI scan behavior so users understand this is not a "attach a photo"
   * affordance.
   */
  readonly tooltip?: string;
}

/**
 * Thin camera-capture button. Mirrors VoiceButton's visual API. On mobile
 * the hidden file input with `capture="environment"` launches the OS
 * camera; on desktop it falls back to the native file picker. The
 * captured file is resized + re-encoded via `compressImage` before the
 * caller receives it, so parents can treat every success identically
 * regardless of source resolution.
 *
 * The camera glyph carries a small Sparkles badge so the icon reads as
 * "AI scan" rather than "attach photo" — the captured image is never
 * stored; it's only passed to the vision endpoint that extracts
 * structured exercises from a printed / whiteboard workout.
 */
export function ImageCaptureButton({
  onImage,
  disabled,
  size = "icon",
  label,
  className,
  "data-testid": dataTestId,
  tooltip,
}: ImageCaptureButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  const openPicker = () => {
    if (disabled || processing) return;
    inputRef.current?.click();
  };

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the value so picking the same file twice still fires `change`
    // (browsers skip the event when value is unchanged).
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      const compressed = await compressImage(file);
      onImage(compressed);
    } catch (err) {
      toast({
        title: "Couldn't prepare that image",
        description: err instanceof Error ? err.message : "Try a different photo.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const busy = disabled || processing;
  const iconSize = size === "icon" ? "size-4" : "size-3.5";
  const sparkleSize = size === "icon" ? "size-2.5" : "size-2";
  const tooltipCopy =
    tooltip ?? "Scan a printed or whiteboard workout — we'll auto-fill the exercises.";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleChange}
        data-testid={`${dataTestId ?? "button-image-capture"}-input`}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={size}
              onClick={openPicker}
              disabled={busy}
              className={cn(processing && "animate-pulse", className)}
              data-testid={dataTestId ?? "button-image-capture"}
              aria-label={label ?? "Scan a printed or whiteboard workout"}
            >
              {processing ? (
                <Loader2 className={cn(iconSize, "animate-spin")} aria-hidden />
              ) : (
                <span className="relative inline-flex">
                  <Camera className={iconSize} aria-hidden />
                  <Sparkles
                    className={cn(
                      sparkleSize,
                      "absolute -bottom-0.5 -right-0.5 text-primary",
                    )}
                    aria-hidden
                  />
                </span>
              )}
              {label && !processing && <span className="ml-1.5">{label}</span>}
              {label && processing && <span className="ml-1.5">Preparing…</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipCopy}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
