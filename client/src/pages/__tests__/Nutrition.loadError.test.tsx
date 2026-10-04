import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Nutrition from "../Nutrition";

const day = vi.hoisted(() => {
  const current: Record<string, unknown> = {};
  return { current, refetch: vi.fn() };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

vi.mock("@/hooks/useNutrition", () => {
  const idle = { mutate: vi.fn(), isPending: false };
  const loaded = (data: unknown) => ({ data, isSuccess: true });
  return {
    useNutritionDay: () => day.current,
    useNutritionTargets: () => ({ data: { current: null } }),
    useDeleteLog: () => idle,
    useRepeatDay: () => idle,
    usePortionMemory: () => () => undefined,
    useRecentFoods: () => loaded([{ id: "recent" }]),
    useFavorites: () => loaded([]),
  };
});

vi.mock("../nutrition/useQuickLog", () => ({
  useQuickLog: () => ({ quickLog: vi.fn(), isPending: false }),
}));

// Everything below the day summary is out of this test's way.
vi.mock("../nutrition/DailyTotalsHeader", () => ({
  DailyTotalsHeader: ({ totals }: { readonly totals: { readonly calories: number } }) => (
    <div data-testid="nutrition-daily-totals">{totals.calories} kcal</div>
  ),
}));
vi.mock("../nutrition/EnergyBalanceCard", () => ({ EnergyBalanceCard: () => null }));
vi.mock("../nutrition/MealSection", () => ({
  MealSection: ({ mealType }: { readonly mealType: string }) => (
    <div data-testid={`meal-section-${mealType}`} />
  ),
}));
vi.mock("../nutrition/FoodSearch", () => ({ FoodSearch: () => null }));
vi.mock("../nutrition/QuickAddBar", () => ({ QuickAddBar: () => null }));
vi.mock("../nutrition/LogFoodActions", () => ({ LogFoodActions: () => null }));
vi.mock("../nutrition/MicronutrientPanel", () => ({ MicronutrientPanel: () => null }));
vi.mock("../nutrition/MyFoodsSection", () => ({ MyFoodsSection: () => null }));
vi.mock("../nutrition/NutritionInsightsPanel", () => ({ NutritionInsightsPanel: () => null }));
vi.mock("../nutrition/LogFoodDialog", () => ({ LogFoodDialog: () => null }));
vi.mock("../nutrition/BarcodeScanner", () => ({ BarcodeScanner: () => null }));
vi.mock("../nutrition/CustomFoodDialog", () => ({ CustomFoodDialog: () => null }));
vi.mock("../nutrition/RecipeBuilderDialog", () => ({ RecipeBuilderDialog: () => null }));
vi.mock("../nutrition/ParsedMealReviewSheet", () => ({ ParsedMealReviewSheet: () => null }));
vi.mock("../nutrition/DescribeMealDialog", () => ({ DescribeMealDialog: () => null }));
vi.mock("../nutrition/TargetsDialog", () => ({ TargetsDialog: () => null }));
vi.mock("../nutrition/MealTargetDialog", () => ({ MealTargetDialog: () => null }));

const MEALS = {
  breakfast: [{ id: "e1" }],
  lunch: [],
  dinner: [],
  snack: [],
  pre_workout: [],
  post_workout: [],
};

describe("Nutrition day summary load failure (U5)", () => {
  beforeEach(() => {
    day.refetch.mockReset();
  });

  it("shows an error with a retry instead of a 0 kcal day when the summary failed", async () => {
    day.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch: day.refetch,
    };
    const user = userEvent.setup();
    render(<Nutrition />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this day's food log");
    expect(screen.queryByTestId("nutrition-daily-totals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meal-section-breakfast")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-empty-day")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("nutrition-day-error-retry"));
    expect(day.refetch).toHaveBeenCalledOnce();
  });

  it("keeps the day's totals and meals when the summary loaded", () => {
    day.current = {
      data: {
        meals: MEALS,
        totals: { calories: 420 },
        effectiveTarget: null,
        energy: null,
        mealTargets: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: day.refetch,
    };
    render(<Nutrition />);

    expect(screen.getByTestId("nutrition-daily-totals")).toHaveTextContent("420 kcal");
    expect(screen.getByTestId("meal-section-breakfast")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
