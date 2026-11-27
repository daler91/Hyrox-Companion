import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Nutrition from "../Nutrition";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

vi.mock("@/hooks/useNutrition", () => {
  const idle = { mutate: vi.fn(), isPending: false };
  return {
    // A day that is still loading: enough for the page shell to render.
    useNutritionDay: () => ({ data: undefined, isPending: true, isLoading: true }),
    useNutritionTargets: () => ({ data: { current: null } }),
    useDeleteLog: () => idle,
    useRepeatDay: () => idle,
    usePortionMemory: () => () => undefined,
    useRecentFoods: () => ({ data: [], isSuccess: true }),
    useFavorites: () => ({ data: [], isSuccess: true }),
  };
});

vi.mock("../nutrition/useQuickLog", () => ({
  useQuickLog: () => ({ quickLog: vi.fn(), isPending: false }),
}));
vi.mock("../nutrition/DailyTotalsHeader", () => ({ DailyTotalsHeader: () => null }));
vi.mock("../nutrition/EnergyBalanceCard", () => ({ EnergyBalanceCard: () => null }));
vi.mock("../nutrition/MealSection", () => ({ MealSection: () => null }));
vi.mock("../nutrition/QuickAddBar", () => ({ QuickAddBar: () => null }));
vi.mock("../nutrition/LogFoodActions", () => ({ LogFoodActions: () => null }));
vi.mock("../nutrition/MicronutrientPanel", () => ({ MicronutrientPanel: () => null }));
vi.mock("../nutrition/MyFoodsSection", () => ({ MyFoodsSection: () => null }));
vi.mock("../nutrition/NutritionInsightsPanel", () => ({ NutritionInsightsPanel: () => null }));
vi.mock("../nutrition/FoodSearch", () => ({
  FoodSearch: ({ onSelect }: { readonly onSelect: (food: { id: string }) => void }) => (
    <button type="button" data-testid="pick-food" onClick={() => onSelect({ id: "oats" })}>
      Pick
    </button>
  ),
}));

// The dialogs reach the page only through the lazy `nutrition/dialogs` chunk.
vi.mock("../nutrition/LogFoodDialog", () => ({
  LogFoodDialog: ({ state }: { readonly state: { food: { id: string } } | null }) =>
    state ? <div data-testid="log-food-dialog">{state.food.id}</div> : null,
}));
vi.mock("../nutrition/BarcodeScanner", () => ({ BarcodeScanner: () => null }));
vi.mock("../nutrition/CustomFoodDialog", () => ({ CustomFoodDialog: () => null }));
vi.mock("../nutrition/RecipeBuilderDialog", () => ({ RecipeBuilderDialog: () => null }));
vi.mock("../nutrition/ParsedMealReviewSheet", () => ({ ParsedMealReviewSheet: () => null }));
vi.mock("../nutrition/DescribeMealDialog", () => ({ DescribeMealDialog: () => null }));
vi.mock("../nutrition/TargetsDialog", () => ({ TargetsDialog: () => null }));
vi.mock("../nutrition/MealTargetDialog", () => ({ MealTargetDialog: () => null }));

describe("Nutrition lazy dialogs", () => {
  it("paints the page before the dialog chunk loads, and keeps a tap that beats it", async () => {
    const user = userEvent.setup();
    render(<Nutrition />);

    // The page itself is on screen in the first render: the lazy dialogs sit
    // behind their own Suspense, so they do not suspend the route.
    expect(screen.getByTestId("pick-food")).toBeInTheDocument();
    expect(screen.queryByTestId("log-food-dialog")).not.toBeInTheDocument();

    // Open state lives in the page, so the dialog shows once its chunk lands.
    await user.click(screen.getByTestId("pick-food"));
    expect(await screen.findByTestId("log-food-dialog")).toHaveTextContent("oats");
  });
});
