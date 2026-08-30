import type { ParseLabelResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { uploadCompressedPhoto } from "@/test/support/imageCaptureMocks";

import { ScanLabelButton } from "./ScanLabelButton";

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/imageCaptureMocks")).makeCaptureApiMock({
    parseLabel: vi.fn(),
  }),
);
vi.mock("@/lib/image", () => ({ compressImage: vi.fn() }));

const authState = vi.hoisted(() => ({ aiCoachEnabled: true }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => authState.aiCoachEnabled,
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const EXTRACTED: ParseLabelResponse = {
  label: {
    productName: "Oat Bar",
    brand: null,
    servingSizeText: "1 bar (45g)",
    servingSizeG: 45,
    servingsPerContainer: null,
    per100g: { calories: 400, protein: 10, carb: 60, fat: 12, fiber: 6 },
    perServing: null,
    basis: "per100g",
    confidence: 90,
  },
  suggestion: {
    name: "Oat Bar",
    brand: null,
    caloriesPer100g: 400,
    proteinPer100g: 10,
    carbPer100g: 60,
    fatPer100g: 12,
    fiberPer100g: 6,
    servingSizeG: 45,
    servings: [],
  },
  warnings: [],
};

function renderButton(onExtracted: (r: ParseLabelResponse) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <ScanLabelButton onExtracted={onExtracted} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const uploadPhoto = () => uploadCompressedPhoto("button-scan-label-input", "label.jpg");

describe("ScanLabelButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.aiCoachEnabled = true;
  });

  it("compresses the chosen photo, parses it, and hands the result to onExtracted", async () => {
    vi.mocked(api.nutrition.parseLabel).mockResolvedValue(EXTRACTED);
    const onExtracted = vi.fn();
    renderButton(onExtracted);

    await uploadPhoto();

    await waitFor(() =>
      expect(api.nutrition.parseLabel).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg"),
    );
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(EXTRACTED));
  });

  it("shows a toast instead of opening the review when no label was found", async () => {
    vi.mocked(api.nutrition.parseLabel).mockResolvedValue({
      label: null,
      suggestion: null,
      warnings: [],
    });
    const onExtracted = vi.fn();
    renderButton(onExtracted);

    await uploadPhoto();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No nutrition label found", variant: "destructive" }),
      ),
    );
    expect(onExtracted).not.toHaveBeenCalled();
  });

  it("holds the photo behind the consent dialog and parses it after accepting", async () => {
    const user = userEvent.setup();
    authState.aiCoachEnabled = false;
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
    vi.mocked(api.nutrition.parseLabel).mockResolvedValue(EXTRACTED);
    const onExtracted = vi.fn();
    renderButton(onExtracted);

    await uploadPhoto();

    await screen.findByRole("button", { name: "Enable AI Coach" });
    expect(api.nutrition.parseLabel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    await waitFor(() =>
      expect(api.nutrition.parseLabel).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg"),
    );
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(EXTRACTED));
  });
});
