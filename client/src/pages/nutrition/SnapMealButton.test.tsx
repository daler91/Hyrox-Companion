import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { captureAuthState, uploadCompressedPhoto } from "@/test/support/imageCaptureMocks";

import { SnapMealButton } from "./SnapMealButton";

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/imageCaptureMocks")).makeCaptureApiMock({}),
);
vi.mock("@/lib/image", () => ({ compressImage: vi.fn() }));
vi.mock("@/hooks/useAuth", async () =>
  (await import("@/test/support/imageCaptureMocks")).makeCaptureAuthMock(),
);

const PHOTO = { imageBase64: "ZmFrZS1pbWFnZQ==", mimeType: "image/jpeg" };

function renderButton(onImage: (image: typeof PHOTO) => void, isParsing = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <SnapMealButton onImage={onImage} isParsing={isParsing} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("SnapMealButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureAuthState.aiCoachEnabled = true;
  });

  it("compresses the chosen photo and hands it on for parsing", async () => {
    const onImage = vi.fn();
    renderButton(onImage);

    await uploadCompressedPhoto("button-snap-meal-input", "meal.jpg");

    await waitFor(() => {
      expect(onImage).toHaveBeenCalledWith(PHOTO);
    });
  });

  it("holds the photo behind the consent dialog and hands it on after accepting", async () => {
    const user = userEvent.setup();
    captureAuthState.aiCoachEnabled = false;
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
    const onImage = vi.fn();
    renderButton(onImage);

    await uploadCompressedPhoto("button-snap-meal-input", "meal.jpg");

    // The photo is captured but nothing is sent until consent lands.
    await screen.findByRole("button", { name: "Enable AI Coach" });
    expect(onImage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    await waitFor(() => {
      expect(onImage).toHaveBeenCalledWith(PHOTO);
    });
  });

  // CL31 (CODEBASE_ANALYSIS_2026-10-03): the 5-15 s parse showed no progress.
  it("shows the parse in progress and takes no second photo meanwhile", () => {
    renderButton(vi.fn(), true);

    const button = screen.getByTestId("button-snap-meal");
    expect(button).toHaveTextContent("Reading your meal…");
    expect(button).toBeDisabled();
  });
});
