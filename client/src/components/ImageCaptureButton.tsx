import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
}

/**
 * Thin camera-capture button. Mirrors VoiceButton's visual API. On mobile
 * the hidden file input with `capture="environment"` launches the OS
 * camera; on desktop it falls back to the native file picker. The
 * captured file is resized + re-encoded via `compressImage` before the
 * caller receives it, so parents can treat every success identically
 * regardless of source resolution.
 */
export function ImageCaptureButton({
  onImage,
  disabled,
  size = "icon",
  label,
  className,
  "data-testid": dataTestId,
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
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={openPicker}
        disabled={busy}
        className={cn(processing && "animate-pulse", className)}
        data-testid={dataTestId ?? "button-image-capture"}
        aria-label={label ?? "Take a photo of a workout plan"}
      >
        {processing ? (
          <Loader2 className={cn(iconSize, "animate-spin")} aria-hidden />
        ) : (
          <Camera className={iconSize} aria-hidden />
        )}
        {label && !processing && <span className="ml-1.5">{label}</span>}
        {label && processing && <span className="ml-1.5">Preparing…</span>}
      </Button>
    </>
  );
}
