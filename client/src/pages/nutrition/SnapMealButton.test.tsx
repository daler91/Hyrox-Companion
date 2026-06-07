import type { ParseMealResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { compressImage } from "@/lib/image";

import { SnapMealButton } from "./SnapMealButton";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { parseMealPhoto: vi.fn() } },
  QUERY_KEYS: {},
}));
vi.mock("@/lib/image", () => ({ compressImage: vi.fn() }));

const PARSED: ParseMealResponse = {
  rawInput: "[photo]",
  warnings: [],
  items: [
    {
      name: "egg, scrambled",
      quantityG: 100,
      displayAmount: "2 eggs",
      mealType: "breakfast",
      confidence: 88,
      foodId: "f1",
      food: null,
      nutrition: null,
    },
  ],
};

function renderButton(onParsed: (r: ParseMealResponse) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <SnapMealButton onParsed={onParsed} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("SnapMealButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compresses the chosen photo, parses it, and hands the result to onParsed", async () => {
    const user = userEvent.setup();
    vi.mocked(compressImage).mockResolvedValue({
      blob: new Blob(),
      mimeType: "image/jpeg",
      base64: "ZmFrZS1pbWFnZQ==",
      previewUrl: "blob:preview",
      width: 100,
      height: 100,
    });
    vi.mocked(api.nutrition.parseMealPhoto).mockResolvedValue(PARSED);
    const onParsed = vi.fn();
    renderButton(onParsed);

    const file = new File(["x"], "meal.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("button-snap-meal-input"), file);

    await waitFor(() =>
      expect(api.nutrition.parseMealPhoto).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg"),
    );
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(PARSED));
  });
});
