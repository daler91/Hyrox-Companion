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
  api: { nutrition: { parseMealPhoto: vi.fn() }, preferences: { update: vi.fn() } },
  QUERY_KEYS: { authUser: ["/api/v1/auth/user"] },
}));
vi.mock("@/lib/image", () => ({ compressImage: vi.fn() }));

const authState = vi.hoisted(() => ({ aiCoachEnabled: true }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => authState.aiCoachEnabled,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    authState.aiCoachEnabled = true;
  });

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

  it("holds the photo behind the consent dialog and parses it after accepting", async () => {
    const user = userEvent.setup();
    authState.aiCoachEnabled = false;
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
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

    // The photo is captured but nothing is sent until consent lands.
    await screen.findByRole("button", { name: "Enable AI Coach" });
    expect(api.nutrition.parseMealPhoto).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    await waitFor(() =>
      expect(api.nutrition.parseMealPhoto).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg"),
    );
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(PARSED));
  });
});
