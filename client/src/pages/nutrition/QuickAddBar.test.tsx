import type { Food } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { QuickAddBar } from "./QuickAddBar";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { recent: vi.fn(), listFavorites: vi.fn() } },
  QUERY_KEYS: {
    nutritionRecent: ["/api/v1/nutrition/foods/recent"],
    nutritionFavorites: ["/api/v1/nutrition/favorites"],
  },
}));

const BANANA: Food = {
  id: "f1",
  source: "usda",
  sourceId: "1",
  name: "Banana",
  brand: null,
  servingSizeG: 118,
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbPer100g: 23,
  fatPer100g: 0.3,
  fiberPer100g: 2.6,
  micros: null,
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("QuickAddBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are no recent or favorite foods", () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const { container } = renderWithClient(<QuickAddBar onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders recent foods and selects one on click", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([BANANA]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<QuickAddBar onSelect={onSelect} />);

    await user.click(await screen.findByTestId("quickadd-recent-f1"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });
});
