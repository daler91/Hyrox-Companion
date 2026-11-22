import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompressedImage } from "@/lib/image";

import { useImagePreview } from "../useImagePreview";

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

// The capture path makes the preview URL (compressImage), so the photos here
// get theirs from URL.createObjectURL the same way.
function capturedPhoto(): CompressedImage {
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  return {
    blob,
    mimeType: "image/jpeg",
    base64: "anBlZw==",
    previewUrl: URL.createObjectURL(blob),
    width: 10,
    height: 10,
  };
}

beforeEach(() => {
  let count = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:photo-${++count}`);
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
});

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", { value: originalCreate, configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: originalRevoke, configurable: true, writable: true });
});

// CC-imagePreview (REFACTORING_REVIEW 2026-09-23): the preview PrescriptionEditor
// and WorkoutComposer each managed, with every dropped blob URL revoked once.
describe("useImagePreview", () => {
  it("shows a capture without revoking it", () => {
    const { result } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(result.current.imagePreview).toEqual({ url: "blob:photo-1", base64: "anBlZw==", mimeType: "image/jpeg" });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revokes the preview a new capture replaces", () => {
    const { result } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    act(() => {
      result.current.captureImage(capturedPhoto());
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
    expect(result.current.imagePreview?.url).toBe("blob:photo-2");
  });

  it("revokes and drops the preview on Retake", () => {
    const { result } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    act(() => {
      result.current.clearImagePreview();
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
    expect(result.current.imagePreview).toBeNull();
  });

  it("revokes nothing when there is no preview to clear", () => {
    const { result } = renderHook(() => useImagePreview());

    act(() => {
      result.current.clearImagePreview();
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("releases a parsed preview, and keeps a newer capture taken meanwhile", () => {
    const { result } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    const parsed = result.current.imagePreview!;
    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    revokeObjectURL.mockClear();

    act(() => {
      result.current.releaseImagePreview(parsed);
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
    expect(result.current.imagePreview?.url).toBe("blob:photo-2");

    act(() => {
      result.current.releaseImagePreview(result.current.imagePreview!);
    });

    expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:photo-2");
    expect(result.current.imagePreview).toBeNull();
  });

  it("revokes the preview still showing on unmount", () => {
    const { result, unmount } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
  });

  it("revokes nothing on unmount once the preview is gone", () => {
    const { result, unmount } = renderHook(() => useImagePreview());

    act(() => {
      result.current.captureImage(capturedPhoto());
    });
    act(() => {
      result.current.clearImagePreview();
    });
    revokeObjectURL.mockClear();
    unmount();

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
