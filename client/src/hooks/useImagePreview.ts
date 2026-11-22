import type { AllowedImageMimeType } from "@shared/schema";
import { useEffect, useRef, useState } from "react";

import type { CompressedImage } from "@/lib/image";

/** A captured photo waiting to be parsed: its object URL for the thumbnail and its upload payload. */
export interface ImagePreviewState {
  readonly url: string;
  readonly base64: string;
  readonly mimeType: AllowedImageMimeType;
}

/**
 * The preview of a captured workout photo, owning its blob URL: a new
 * capture, Retake, a parse that consumed it and unmounting each revoke the
 * URL they drop, so a capture never outlives its preview. PrescriptionEditor
 * and WorkoutComposer each hand-rolled this.
 * (CC-imagePreview, REFACTORING_REVIEW 2026-09-23)
 */
export function useImagePreview() {
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);

  // Mirror the active preview URL into a ref so a single unmount-only
  // cleanup effect can revoke it without re-running on every preview swap
  // (the swap paths below revoke the previous URL synchronously). Without
  // this, a user who captures and then navigates away leaks the underlying
  // Blob until the tab is closed.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = imagePreview?.url ?? null;
  }, [imagePreview?.url]);
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  /** Show a fresh capture, revoking the preview it replaces. */
  const captureImage = (img: CompressedImage) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url);
    setImagePreview({ url: img.previewUrl, base64: img.base64, mimeType: img.mimeType });
  };

  /** Drop the preview (Retake, or a parse that used it), revoking its URL. */
  const clearImagePreview = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url);
    setImagePreview(null);
  };

  /**
   * Revoke `preview` once a parse that used it has landed, and drop it unless
   * a newer capture has replaced it meanwhile.
   */
  const releaseImagePreview = (preview: ImagePreviewState) => {
    URL.revokeObjectURL(preview.url);
    setImagePreview((current) => (current?.url === preview.url ? null : current));
  };

  return { imagePreview, captureImage, clearImagePreview, releaseImagePreview };
}
