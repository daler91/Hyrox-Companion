import type { Food, ParseMealResponse, User } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { preferences } from "@/lib/api/user";
import { mockDeviceTimezone } from "@/test/support/deviceTimezone";

import { ParsedMealReviewSheet } from "./ParsedMealReviewSheet";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { createLogBatch: vi.fn(), search: vi.fn() } },
  QUERY_KEYS: {
    nutritionDay: (date: string) => ["/api/v1/nutrition/summary", date],
    nutritionMicros: (date: string) => ["/api/v1/nutrition/micros", date],
    nutritionMicrosPrefix: ["/api/v1/nutrition/micros"],
    nutritionRecent: ["/api/v1/nutrition/foods/recent"],
    nutritionSearch: (q: string) => ["/api/v1/nutrition/foods/search", q],
    authUser: ["/api/v1/auth/user"],
  },
}));

const FOOD: Food = {
  id: "f1",
  source: "usda",
  sourceId: "1",
  name: "Egg, scrambled",
  brand: null,
  lastFetchedAt: null,
  createdByUserId: null,
  isPublic: false,
  servingSizeG: null,
  caloriesPer100g: 150,
  proteinPer100g: 10,
  carbPer100g: 1,
  fatPer100g: 11,
  fiberPer100g: 0,
  micros: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const RESULT: ParseMealResponse = {
  rawInput: "2 eggs and obscure dish",
  warnings: ["assumed large eggs"],
  items: [
    {
      name: "egg, scrambled",
      quantityG: 100,
      displayAmount: "2 eggs",
      mealType: "breakfast",
      confidence: 92,
      foodId: "f1",
      food: FOOD,
      nutrition: { calories: 150, protein: 10, carb: 1, fat: 11, fiber: 0 },
    },
    {
      name: "obscure dish",
      quantityG: 100,
      displayAmount: "a plate",
      mealType: null,
      confidence: 40,
      foodId: null,
      food: null,
      nutrition: null,
    },
  ],
};

function renderSheet(onClose = vi.fn(), entryMethod: "nl" | "photo" = "nl", storedTimezone?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (storedTimezone) queryClient.setQueryData(["/api/v1/auth/user"], { userTimezone: storedTimezone });
  render(
    <QueryClientProvider client={queryClient}>
      <ParsedMealReviewSheet result={RESULT} date="2026-06-07" entryMethod={entryMethod} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("ParsedMealReviewSheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders matched and unmatched rows, warnings, and a count of loggable items", () => {
    renderSheet();
    expect(screen.getByTestId("meal-review-food-0")).toHaveTextContent("Egg, scrambled");
    expect(screen.getByTestId("meal-review-unmatched-1")).toBeInTheDocument();
    expect(screen.getByTestId("meal-review-warnings")).toHaveTextContent("assumed large eggs");
    // Only the matched row is loggable.
    expect(screen.getByTestId("button-log-meal-batch")).toHaveTextContent("Log 1 item");
  });

  // U34 (CODEBASE_ANALYSIS_2026-10-03): every row's controls had the same
  // name, so a screen reader heard "Quantity in grams" with no food.
  it("names each row's quantity and meal controls after its item", () => {
    renderSheet();
    expect(screen.getByRole("spinbutton", { name: "Quantity in grams for 2 eggs" })).toHaveValue(100);
    expect(screen.getByRole("spinbutton", { name: "Quantity in grams for a plate" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Meal for 2 eggs" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Meal for a plate" })).toBeInTheDocument();
  });

  it("logs only the matched items with the right payload, then closes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.createLogBatch).mockResolvedValue({ created: 1, logDate: "2026-06-07" });
    const { onClose } = renderSheet();

    await user.click(screen.getByTestId("button-log-meal-batch"));

    await waitFor(() => expect(api.nutrition.createLogBatch).toHaveBeenCalledTimes(1));
    expect(api.nutrition.createLogBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entryMethod: "nl",
        rawInput: "2 eggs and obscure dish",
        items: [{ foodId: "f1", quantityG: 100, mealType: "breakfast", parseConfidence: 92 }],
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("logs photo-sourced items with entryMethod 'photo'", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.createLogBatch).mockResolvedValue({ created: 1, logDate: "2026-06-07" });
    renderSheet(vi.fn(), "photo");

    await user.click(screen.getByTestId("button-log-meal-batch"));

    await waitFor(() => expect(api.nutrition.createLogBatch).toHaveBeenCalledTimes(1));
    expect(api.nutrition.createLogBatch).toHaveBeenCalledWith(
      expect.objectContaining({ entryMethod: "photo" }),
    );
  });

  it("removing the matched row disables logging", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId("meal-review-remove-0"));
    expect(screen.getByTestId("button-log-meal-batch")).toBeDisabled();
  });

  it("defaults un-inferred items to the time-of-day meal, not snack", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 18, 30));
    try {
      renderSheet();
      // The parser's own inference wins; only the null-mealType row falls back.
      expect(screen.getByTestId("meal-review-meal-0")).toHaveTextContent("Breakfast");
      expect(screen.getByTestId("meal-review-meal-1")).toHaveTextContent("Dinner");
    } finally {
      vi.useRealTimers();
    }
  });

  // CL65 (CODEBASE_ANALYSIS_2026-10-03): the server dates the batch by the
  // profile's timezone, so a stale one is saved first.
  describe("a profile timezone left behind by travel", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("saves the device's timezone, then logs the batch", async () => {
      mockDeviceTimezone("America/New_York");
      let finishSave: (() => void) | undefined;
      const update = vi.spyOn(preferences, "update").mockReturnValue(
        new Promise((resolve) => {
          finishSave = () => resolve({ userTimezone: "America/New_York" } as User);
        }),
      );
      vi.mocked(api.nutrition.createLogBatch).mockResolvedValue({ created: 1, logDate: "2026-06-07" });
      const user = userEvent.setup();
      renderSheet(vi.fn(), "nl", "Europe/London");

      await user.click(screen.getByTestId("button-log-meal-batch"));

      expect(update).toHaveBeenCalledWith({ userTimezone: "America/New_York" });
      expect(screen.getByTestId("button-log-meal-batch")).toBeDisabled();
      expect(screen.getByTestId("button-log-meal-batch")).toHaveTextContent("Logging…");
      expect(api.nutrition.createLogBatch).not.toHaveBeenCalled();

      finishSave?.();
      await waitFor(() => expect(api.nutrition.createLogBatch).toHaveBeenCalledTimes(1));
    });
  });
});
