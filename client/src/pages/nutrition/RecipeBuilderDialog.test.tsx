import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { RecipeBuilderDialog, type RecipePrefill } from "./RecipeBuilderDialog";

vi.mock("@/lib/api", () => ({
  api: {
    nutrition: {
      getRecipe: vi.fn(),
      createRecipe: vi.fn(),
      updateRecipe: vi.fn(),
      search: vi.fn(),
    },
  },
  QUERY_KEYS: {
    nutritionRecipes: ["/api/v1/nutrition/recipes"],
    nutritionRecipe: (id: string) => ["/api/v1/nutrition/recipes", id],
    nutritionCustomFoods: ["/api/v1/nutrition/custom-foods"],
    nutritionSearch: (q: string) => ["/api/v1/nutrition/foods/search", q],
  },
}));

// A logged breakfast: banana (118g / 105 kcal) + oats (60g / 220 kcal).
const PREFILL: RecipePrefill = {
  name: "Breakfast",
  ingredients: [
    {
      foodId: "f1",
      name: "Banana",
      quantityG: 118,
      nutrition: { calories: 105, protein: 1.3, carb: 27, fat: 0.4, fiber: 3.1 },
    },
    {
      foodId: "f2",
      name: "Oats",
      quantityG: 60,
      nutrition: { calories: 220, protein: 8, carb: 40, fat: 4, fiber: 6 },
    },
  ],
};

function renderDialog(prefill: RecipePrefill | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RecipeBuilderDialog open recipeId={null} prefill={prefill} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("RecipeBuilderDialog prefill (save meal as recipe)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds the name, ingredients and per-serving preview from the logged meal", () => {
    renderDialog(PREFILL);

    expect(screen.getByTestId("input-recipe-name")).toHaveValue("Breakfast");
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("Oats")).toBeInTheDocument();
    // 105 + 220 kcal at 1 serving.
    expect(screen.getByTestId("recipe-preview-calories")).toHaveTextContent("325");
  });

  it("creates the recipe with the seeded ingredients", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.createRecipe).mockResolvedValue({
      id: "r1",
      name: "Breakfast",
      servings: 1,
      ingredients: [],
    } as never);
    renderDialog(PREFILL);

    await user.click(screen.getByTestId("button-save-recipe"));

    await waitFor(() =>
      expect(api.nutrition.createRecipe).toHaveBeenCalledWith({
        name: "Breakfast",
        servings: 1,
        ingredients: [
          { foodId: "f1", quantityG: 118 },
          { foodId: "f2", quantityG: 60 },
        ],
      }),
    );
  });

  it("starts blank without a prefill", () => {
    renderDialog(null);
    expect(screen.getByTestId("input-recipe-name")).toHaveValue("");
    expect(screen.getByText("Search below to add ingredients.")).toBeInTheDocument();
  });
});
