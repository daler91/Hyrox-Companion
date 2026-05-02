import type { AllowedImageMimeType, ParsedExercise } from "@shared/schema";

import type { ParseFromImagePayload } from "@/lib/api";

export interface ImagePreviewState {
  readonly url: string;
  readonly base64: string;
  readonly mimeType: AllowedImageMimeType;
}

export function buildParseImagePayload(preview: ImagePreviewState): ParseFromImagePayload {
  return {
    imageBase64: preview.base64,
    mimeType: preview.mimeType,
  };
}

export function shouldRetainImagePreview(parsed: ParsedExercise[] | null | undefined): boolean {
  return !parsed || parsed.length === 0;
}
