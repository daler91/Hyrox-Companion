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

/**
 * The day query with no data, as TanStack reports it after `errorUpdateCount`
 * failures. A fetch of a query with no data (a first fetch, or a retry after a
 * failure) resets it to pending, and a paused fetch is pending without being
 * `isLoading`; only a failure with no fetch running reads as `isError`.
 */
function dayWithoutData(errorUpdateCount: number, fetchStatus: "idle" | "fetching" | "paused") {
  const isError = errorUpdateCount > 0 && fetchStatus === "idle";
  const isPending = !isError;
  return {
    data: undefined,
    status: isError ? "error" : "pending",
    isError,
    isPending,
    isLoading: isPending && fetchStatus === "fetching",
    isFetching: fetchStatus === "fetching",
    isPaused: fetchStatus === "paused",
    isRefetching: false,
    errorUpdateCount,
    fetchStatus,
    refetch: day.refetch,
  };
}

describe("Nutrition day summary load failure (U5)", () => {
  beforeEach(() => {
    day.refetch.mockReset();
  });

  it("shows an error with a retry instead of a 0 kcal day when the summary failed", async () => {
    day.current = dayWithoutData(1, "idle");
    const user = userEvent.setup();
    render(<Nutrition />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this day's food log");
    expect(screen.queryByTestId("nutrition-daily-totals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meal-section-breakfast")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-empty-day")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("nutrition-day-error-retry"));
    expect(day.refetch).toHaveBeenCalledOnce();
  });

  // A retry of a query with no data resets it to pending, so `isError` and
  // `isRefetching` both read false while it runs and the 0 kcal day flashed
  // back in place of the error.
  it("keeps the error up, marked retrying, while a retry runs", () => {
    day.current = dayWithoutData(1, "fetching");
    render(<Nutrition />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this day's food log");
    expect(screen.getByTestId("nutrition-day-error-retry")).toBeDisabled();
    expect(screen.getByTestId("nutrition-day-error-retry")).toHaveTextContent("Retrying…");
    expect(screen.queryByTestId("nutrition-daily-totals")).not.toBeInTheDocument();
  });

  // TanStack pauses rather than runs a fetch while the browser is offline: the
  // query is pending but not `isLoading`, which rendered a 0 kcal day with
  // every meal empty.
  it("shows loading, not a 0 kcal day, while the first fetch waits offline", () => {
    day.current = dayWithoutData(0, "paused");
    render(<Nutrition />);

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByTestId("nutrition-daily-totals-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-daily-totals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meal-section-breakfast")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // An ordinary online load, such as switching to an uncached day: the header
  // keeps its place without showing zeros as the day's totals.
  it("holds the totals header's place, without zeros, while the summary loads", () => {
    day.current = dayWithoutData(0, "fetching");
    render(<Nutrition />);

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByTestId("nutrition-daily-totals-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-daily-totals")).not.toBeInTheDocument();
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
      status: "success",
      isError: false,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isPaused: false,
      isRefetching: false,
      errorUpdateCount: 0,
      fetchStatus: "idle",
      refetch: day.refetch,
    };
    render(<Nutrition />);

    expect(screen.queryByTestId("nutrition-daily-totals-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("nutrition-daily-totals")).toHaveTextContent("420 kcal");
    expect(screen.getByTestId("meal-section-breakfast")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
