import type { ParseLabelResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { compressImage } from "@/lib/image";

import { ScanLabelButton } from "./ScanLabelButton";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { parseLabel: vi.fn() } },
  QUERY_KEYS: {},
}));
vi.mock("@/lib/image", () => ({ compressImage: vi.fn() }));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const EXTRACTED: ParseLabelResponse = {
  label: {
    productName: "Oat Bar",
    brand: null,
    servingSizeText: "1 bar (45g)",
    servingSizeG: 45,
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
  },
  warnings: [],
};

function renderButton(onExtracted: (r: ParseLabelResponse) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <ScanLabelButton onExtracted={onExtracted} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

async function uploadPhoto() {
  const user = userEvent.setup();
  vi.mocked(compressImage).mockResolvedValue({
    blob: new Blob(),
    mimeType: "image/jpeg",
    base64: "ZmFrZS1pbWFnZQ==",
    previewUrl: "blob:preview",
    width: 100,
    height: 100,
  });
  const file = new File(["x"], "label.jpg", { type: "image/jpeg" });
  await user.upload(screen.getByTestId("button-scan-label-input"), file);
}

describe("ScanLabelButton", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
