import type { ImagePreviewState } from "@/hooks/useImagePreview";
import type { ParseFromImagePayload, ParseWorkoutStructureResponse } from "@/lib/api";

export type { ImagePreviewState } from "@/hooks/useImagePreview";

export function buildParseImagePayload(preview: ImagePreviewState): ParseFromImagePayload {
  return {
    imageBase64: preview.base64,
    mimeType: preview.mimeType,
  };
}

export function shouldRetainImagePreview(parsed: ParseWorkoutStructureResponse | null | undefined): boolean {
  return !parsed || (parsed.exercises.length === 0 && parsed.structureBlocks.length === 0);
}
