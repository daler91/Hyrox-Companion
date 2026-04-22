export interface CompressedImage {
  readonly blob: Blob;
  readonly mimeType: "image/jpeg";
  readonly base64: string;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface CompressImageOptions {
  readonly maxDim?: number;
  readonly quality?: number;
}

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.8;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * Resize + re-encode an image `File` (from a camera capture or file picker)
 * to a JPEG with a bounded max dimension and return base64 + a blob-URL
 * preview. Keeps the payload small enough for a ~10MB base64 JSON body
 * while preserving enough detail for OCR of a whiteboard/printed workout.
 *
 * Callers own the `previewUrl` lifetime — call
 * `URL.revokeObjectURL(previewUrl)` when the preview is replaced or
 * unmounted to release memory.
 */
export async function compressImage(
  file: File,
  opts: CompressImageOptions = {},
): Promise<CompressedImage> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Image too large (max 20MB).");
  }
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image encoding failed."))),
        "image/jpeg",
        quality,
      );
    });
    const dataUrl = await readAsDataURL(blob);
    const base64 = extractBase64(dataUrl);
    return {
      blob,
      mimeType: "image/jpeg",
      base64,
      previewUrl: URL.createObjectURL(blob),
      width,
      height,
    };
  } finally {
    bitmap.close?.();
  }
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error."));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function extractBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
