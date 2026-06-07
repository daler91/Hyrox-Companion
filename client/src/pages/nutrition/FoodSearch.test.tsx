import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchFoods } from "@/hooks/useNutrition";

import { FoodSearch } from "./FoodSearch";

vi.mock("@/hooks/useNutrition", () => ({ useSearchFoods: vi.fn() }));

const BANANA = { id: "f1", name: "Banana", brand: null, caloriesPer100g: 89 };

describe("FoodSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows results after typing and selects one on click", async () => {
    vi.mocked(useSearchFoods).mockReturnValue({
      data: { results: [BANANA], apiDegraded: false },
      isFetching: false,
    } as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<FoodSearch onSelect={onSelect} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");

    const result = await screen.findByTestId("result-food-f1");
    await user.click(result);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("surfaces the cached-results notice when the API is degraded", () => {
    vi.mocked(useSearchFoods).mockReturnValue({
      data: { results: [], apiDegraded: true },
      isFetching: false,
    } as never);
    render(<FoodSearch onSelect={vi.fn()} />);
    expect(screen.getByTestId("text-search-degraded")).toBeInTheDocument();
  });
});
