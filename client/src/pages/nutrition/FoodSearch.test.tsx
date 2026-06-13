import type { Food } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { FoodSearch } from "./FoodSearch";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { search: vi.fn() } },
  QUERY_KEYS: { nutritionSearch: (q: string) => ["/api/v1/nutrition/foods/search", q] },
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
  lastFetchedAt: null,
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("FoodSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows results after typing and selects one on click", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={onSelect} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");

    const result = await screen.findByTestId("result-food-f1");
    await user.click(result);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("announces result count to screen readers via aria-live", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    await screen.findByTestId("result-food-f1");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 result found"),
    );
  });

  it("announces no results to screen readers when search is empty", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [], apiDegraded: false });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "zzz");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No foods found"),
    );
  });

  it("surfaces the cached-results notice when the API is degraded", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [], apiDegraded: true });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    expect(await screen.findByTestId("text-search-degraded")).toBeInTheDocument();
  });
});
