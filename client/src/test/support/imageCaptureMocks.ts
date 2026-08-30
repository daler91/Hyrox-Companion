import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { compressImage } from "@/lib/image";

/**
 * Factory body for `vi.mock("@/lib/api", ...)` in the photo-capture button
 * specs (SnapMealButton, ScanLabelButton). The caller passes the nutrition
 * endpoints its component uses, e.g. `{ parseLabel: vi.fn() }`.
 */
export function makeCaptureApiMock(nutrition: Record<string, unknown>) {
  return {
    api: { nutrition, preferences: { update: vi.fn() } },
    QUERY_KEYS: { authUser: ["/api/v1/auth/user"] },
  };
}

/**
 * Resolve the mocked compressImage with a fixed fake JPEG, then upload
 * `fileName` into the capture input `inputTestId`. Callers must mock
 * "@/lib/image" (`compressImage: vi.fn()`).
 */
export async function uploadCompressedPhoto(inputTestId: string, fileName: string) {
  const user = userEvent.setup();
  vi.mocked(compressImage).mockResolvedValue({
    blob: new Blob(),
    mimeType: "image/jpeg",
    base64: "ZmFrZS1pbWFnZQ==",
    previewUrl: "blob:preview",
    width: 100,
    height: 100,
  });
  const file = new File(["x"], fileName, { type: "image/jpeg" });
  await user.upload(screen.getByTestId(inputTestId), file);
}
