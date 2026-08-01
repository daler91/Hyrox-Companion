import type { Food, FoodLogEntry, FoodLogEntryWithNutrition, FoodServing } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { LogFoodDialog, matchPortionForGrams } from "./LogFoodDialog";

vi.mock("@/lib/api", () => ({
  api: {
    nutrition: {
      createLog: vi.fn(),
      updateLog: vi.fn(),
      getFood: vi.fn(),
      addServing: vi.fn(),
      removeServing: vi.fn(),
    },
  },
  QUERY_KEYS: {
    nutritionDay: (date: string) => ["/api/v1/nutrition/summary", date],
    nutritionRecent: ["/api/v1/nutrition/foods/recent"],
    nutritionRangePrefix: ["/api/v1/nutrition/summary-range"],
    nutritionFood: (id: string) => ["/api/v1/nutrition/foods", id],
  },
}));

installRadixPointerMocks();

const FOOD: Food = {
  id: "f1",
  source: "usda",
  sourceId: "1",
  name: "Banana",
  brand: "Dole",
  servingSizeG: 118,
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbPer100g: 23,
  fatPer100g: 0.3,
  fiberPer100g: 2.6,
  micros: null,
  lastFetchedAt: null,
  createdByUserId: null,
  isPublic: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SAVED_ENTRY: FoodLogEntry = {
  id: "e1",
  userId: "u1",
  foodId: "f1",
  loggedAt: new Date(),
  logDate: "2026-06-07",
  quantityG: 200,
  mealType: "snack",
  entryMethod: "manual",
  rawInput: null,
  parseConfidence: null,
  pendingReview: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("LogFoodDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.nutrition.createLog).mockResolvedValue(SAVED_ENTRY);
    vi.mocked(api.nutrition.updateLog).mockResolvedValue(SAVED_ENTRY);
    vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [] });
  });

  it("defaults to one serving and logs the scaled amount", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Banana")).toBeInTheDocument();
    // Default amount = 1 serving (118 g) → 89 * 118 / 100 ≈ 105 kcal (not a raw 100 g).
    expect(screen.getByTestId("preview-calories")).toHaveTextContent("105");

    const quantity = screen.getByTestId("input-quantity");
    await user.clear(quantity);
    await user.type(quantity, "2");
    // 2 servings = 236 g → 89 * 236 / 100 ≈ 210 kcal.
    expect(screen.getByTestId("preview-calories")).toHaveTextContent("210");

    await user.click(screen.getByTestId("button-submit-log"));
    await waitFor(() =>
      expect(api.nutrition.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ foodId: "f1", quantityG: 236 }),
        // Online logs carry an idempotency key for safe offline replay.
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
  });

  it("adds a custom portion and logs in that portion", async () => {
    const slice: FoodServing = {
      id: "s9",
      foodId: "f1",
      label: "1 slice",
      grams: 95,
      createdByUserId: "u1",
    };
    vi.mocked(api.nutrition.addServing).mockResolvedValue(slice);
    const user = userEvent.setup();
    renderWithClient(
      <LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />,
    );

    // Open the unit selector and choose "+ Add portion…".
    await user.click(screen.getByTestId("select-unit"));
    await user.click(await screen.findByRole("option", { name: /add portion/i }));

    await user.type(screen.getByTestId("input-portion-label"), "1 slice");
    await user.type(screen.getByTestId("input-portion-grams"), "95");
    await user.click(screen.getByTestId("button-save-portion"));

    await waitFor(() =>
      expect(api.nutrition.addServing).toHaveBeenCalledWith("f1", { label: "1 slice", grams: 95 }),
    );

    // The new portion is selected (1 × 95 g) → 89 * 95 / 100 ≈ 85 kcal.
    await waitFor(() => expect(screen.getByTestId("preview-calories")).toHaveTextContent("85"));

    await user.click(screen.getByTestId("button-submit-log"));
    await waitFor(() =>
      expect(api.nutrition.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ foodId: "f1", quantityG: 95 }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
  });

  it("seeds a new log from the food's remembered portion, not the default serving", async () => {
    renderWithClient(
      <LogFoodDialog
        state={{ mode: "create", food: FOOD, portionHint: { quantityG: 140, mealType: "lunch" } }}
        date="2026-06-07"
        onClose={vi.fn()}
      />,
    );

    // Without a remembered portion this food (118 g serving) would default to
    // "1 serving"; the portion hint seeds grams and the athlete's own amount
    // instead.
    expect(screen.getByTestId("input-quantity")).toHaveValue(140);
    expect(screen.getByTestId("select-unit")).toHaveTextContent("grams");
    expect(screen.getByTestId("select-meal-type")).toHaveTextContent("Lunch");
  });

  describe("removing a portion", () => {
    const SLICE: FoodServing = {
      id: "s9",
      foodId: "f1",
      label: "1 slice",
      grams: 95,
      createdByUserId: "u1",
    };

    it("falls back to grams when the removed portion was the selected one", async () => {
      vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [SLICE] });
      vi.mocked(api.nutrition.removeServing).mockResolvedValue({ success: true });
      const user = userEvent.setup();
      renderWithClient(
        <LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />,
      );

      await user.click(screen.getByTestId("select-unit"));
      await user.click(await screen.findByRole("option", { name: "1 slice" }));
      expect(screen.getByTestId("select-unit")).toHaveTextContent("1 slice");

      await user.click(screen.getByTestId("button-remove-portion"));

      // The removed portion was the selected one (1 slice = 95 g) — the amount
      // carries over as grams rather than reinterpreting the count (1) as 1 g.
      await waitFor(() => expect(screen.getByTestId("select-unit")).toHaveTextContent("grams"));
      expect(screen.getByTestId("input-quantity")).toHaveValue(95);
      await waitFor(() =>
        expect(api.nutrition.removeServing).toHaveBeenCalledWith("f1", "s9"),
      );
    });

    it("keeps the current selection when removing a portion that isn't selected", async () => {
      vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [SLICE] });
      vi.mocked(api.nutrition.removeServing).mockResolvedValue({ success: true });
      const user = userEvent.setup();
      renderWithClient(
        <LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />,
      );

      // Default create-mode selection is "1 serving (118 g)", not the slice.
      await waitFor(() => expect(screen.getByTestId("button-remove-portion")).toBeInTheDocument());
      expect(screen.getByTestId("select-unit")).toHaveTextContent("1 serving");

      await user.click(screen.getByTestId("button-remove-portion"));

      // Untouched selection — still the default serving, still a count of 1.
      expect(screen.getByTestId("select-unit")).toHaveTextContent("1 serving");
      expect(screen.getByTestId("input-quantity")).toHaveValue(1);
      await waitFor(() =>
        expect(api.nutrition.removeServing).toHaveBeenCalledWith("f1", "s9"),
      );
    });
  });

  it("saves an edited entry", async () => {
    const entry: FoodLogEntryWithNutrition = {
      id: "e1",
      foodId: "f1",
      name: "Banana",
      brand: null,
      loggedAt: "2026-06-07T08:00:00.000Z",
      logDate: "2026-06-07",
      quantityG: 100,
      mealType: "breakfast",
      entryMethod: "manual",
      nutrition: { calories: 89, protein: 1.1, carb: 23, fat: 0.3, fiber: 2.6 },
    };
    const user = userEvent.setup();
    renderWithClient(
      <LogFoodDialog state={{ mode: "edit", entry }} date="2026-06-07" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Edit entry")).toBeInTheDocument();
    // 100 g against a 118 g serving isn't a clean portion count, so the amount
    // stays in grams. Pinned explicitly: without it this case would still pass
    // while silently exercising the named-portion path.
    await waitFor(() => expect(screen.getByTestId("select-unit")).toHaveTextContent("grams"));

    const quantity = screen.getByTestId("input-quantity");
    await user.clear(quantity);
    await user.type(quantity, "200");

    await user.click(screen.getByTestId("button-submit-log"));
    await waitFor(() =>
      expect(api.nutrition.updateLog).toHaveBeenCalledWith(
        "e1",
        expect.objectContaining({ quantityG: 200 }),
      ),
    );
  });

  describe("editing in named portions", () => {
    const SLICE: FoodServing = {
      id: "s9",
      foodId: "f1",
      label: "1 slice",
      grams: 95,
      createdByUserId: "u1",
    };

    /** An entry of `quantityG`, on the food the suite's mocks describe. */
    function entryOf(quantityG: number): FoodLogEntryWithNutrition {
      return {
        id: "e1",
        foodId: "f1",
        name: "Banana",
        brand: null,
        loggedAt: "2026-06-07T08:00:00.000Z",
        logDate: "2026-06-07",
        quantityG,
        mealType: "breakfast",
        entryMethod: "manual",
        nutrition: { calories: 89, protein: 1.1, carb: 23, fat: 0.3, fiber: 2.6 },
      };
    }

    it("reopens the entry in the portion it was logged in", async () => {
      vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [SLICE] });
      renderWithClient(
        <LogFoodDialog
          state={{ mode: "edit", entry: entryOf(190) }}
          date="2026-06-07"
          onClose={vi.fn()}
        />,
      );

      // 190 g ÷ 95 g = 2 slices. The servings arrive asynchronously, so the seed
      // resolves after first paint — hence the wait.
      await waitFor(() => expect(screen.getByTestId("select-unit")).toHaveTextContent("1 slice"));
      expect(screen.getByTestId("input-quantity")).toHaveValue(2);
      expect(screen.getByText("= 190 g")).toBeInTheDocument();
    });

    it("saves grams, not the portion count", async () => {
      vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [SLICE] });
      const user = userEvent.setup();
      renderWithClient(
        <LogFoodDialog
          state={{ mode: "edit", entry: entryOf(190) }}
          date="2026-06-07"
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => expect(screen.getByTestId("select-unit")).toHaveTextContent("1 slice"));
      const quantity = screen.getByTestId("input-quantity");
      await user.clear(quantity);
      await user.type(quantity, "3");

      await user.click(screen.getByTestId("button-submit-log"));
      // 3 slices — the wire value stays grams, because that's all an entry stores.
      await waitFor(() =>
        expect(api.nutrition.updateLog).toHaveBeenCalledWith(
          "e1",
          expect.objectContaining({ quantityG: 285 }),
        ),
      );
    });

    it("does not overwrite an amount the athlete typed before the servings land", async () => {
      let resolveFood: (v: { food: Food; servings: FoodServing[] }) => void = () => {};
      vi.mocked(api.nutrition.getFood).mockReturnValue(
        new Promise((resolve) => {
          resolveFood = resolve;
        }),
      );
      const user = userEvent.setup();
      renderWithClient(
        <LogFoodDialog
          state={{ mode: "edit", entry: entryOf(190) }}
          date="2026-06-07"
          onClose={vi.fn()}
        />,
      );

      const quantity = screen.getByTestId("input-quantity");
      await user.clear(quantity);
      await user.type(quantity, "150");

      resolveFood({ food: FOOD, servings: [SLICE] });

      // The seed would have said "2 slices"; the typed 150 g wins and keeps winning.
      await waitFor(() => expect(screen.getByTestId("select-unit")).toHaveTextContent("grams"));
      expect(screen.getByTestId("input-quantity")).toHaveValue(150);
    });

    it("adds a portion while editing, against the entry's own food", async () => {
      vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: FOOD, servings: [] });
      vi.mocked(api.nutrition.addServing).mockResolvedValue(SLICE);
      const user = userEvent.setup();
      renderWithClient(
        <LogFoodDialog
          state={{ mode: "edit", entry: entryOf(190) }}
          date="2026-06-07"
          onClose={vi.fn()}
        />,
      );

      await user.click(screen.getByTestId("select-unit"));
      await user.click(await screen.findByRole("option", { name: /add portion/i }));
      await user.type(screen.getByTestId("input-portion-label"), "1 slice");
      await user.type(screen.getByTestId("input-portion-grams"), "95");
      await user.click(screen.getByTestId("button-save-portion"));

      // Regression guard: edit mode used to pass foodId "" here, so this call
      // went to /foods//servings and the food-detail invalidation missed.
      await waitFor(() =>
        expect(api.nutrition.addServing).toHaveBeenCalledWith("f1", {
          label: "1 slice",
          grams: 95,
        }),
      );
      // The new portion is selected at a count of 1, and the refetch it triggers
      // must not re-seed that back to the entry's original 2 slices.
      await waitFor(() => expect(screen.getByTestId("input-quantity")).toHaveValue(1));
      expect(screen.getByTestId("select-unit")).toHaveTextContent("1 slice");
    });
  });

  describe("matchPortionForGrams", () => {
    const grams = { value: "g", label: "grams", grams: 1 };
    const slice = { value: "slice", label: "1 slice", grams: 95 };
    const loaf = { value: "loaf", label: "1 loaf", grams: 760 };

    it("expresses a clean multiple in the named portion", () => {
      expect(matchPortionForGrams(190, [grams, slice])).toEqual({ unitValue: "slice", count: 2 });
    });

    it("allows half portions", () => {
      expect(matchPortionForGrams(142.5, [grams, slice])).toEqual({
        unitValue: "slice",
        count: 1.5,
      });
    });

    it("falls back to grams when nothing divides cleanly", () => {
      expect(matchPortionForGrams(100, [grams, slice])).toEqual({ unitValue: "g", count: 100 });
    });

    it("prefers the largest portion that fits", () => {
      // 760 g is both 8 slices and 1 loaf — "1 loaf" is how a person says it.
      expect(matchPortionForGrams(760, [grams, slice, loaf])).toEqual({
        unitValue: "loaf",
        count: 1,
      });
    });

    it("rejects counts too large to read as a portion", () => {
      expect(matchPortionForGrams(2850, [grams, slice])).toEqual({ unitValue: "g", count: 2850 });
    });

    it("absorbs the rounding in a stored gram value", () => {
      // 3 × 33.3 g = 99.9, stored as 100.
      expect(
        matchPortionForGrams(100, [grams, { value: "p", label: "1 piece", grams: 33.3 }]),
      ).toEqual({ unitValue: "p", count: 3 });
    });

    it("returns grams when there are no named portions", () => {
      expect(matchPortionForGrams(84, [grams])).toEqual({ unitValue: "g", count: 84 });
    });
  });

  it("shows goal impact and micronutrients when data and targets are present", async () => {
    const microFood: Food = { ...FOOD, micros: { sodium: 200, vitaminC: 9 } };
    // The detail fetch returns the enriched food (with micros) — it overrides the
    // search-result food once it resolves, mirroring the real endpoint.
    vi.mocked(api.nutrition.getFood).mockResolvedValue({ food: microFood, servings: [] });
    const user = userEvent.setup();
    renderWithClient(
      <LogFoodDialog
        state={{ mode: "create", food: microFood }}
        date="2026-06-07"
        onClose={vi.fn()}
        todayTotals={{ calories: 1000, protein: 75, carb: 100, fat: 40, fiber: 8 }}
        effectiveTarget={{
          calories: 2000,
          proteinG: 150,
          carbG: 200,
          fatG: 80,
          carbDeltaG: 0,
          baseLoadDeltaG: 0,
          recoveryDeltaG: 0,
          preloadDeltaG: 0,
          proteinDeltaG: 0,
          utss: 0,
          scaled: false,
          reasonCodes: [],
          explanation: "",
          phase: null,
        }}
      />,
    );

    // "Effect on today's goals" renders on the default Summary tab.
    expect(screen.getByTestId("goal-contrib")).toBeInTheDocument();
    expect(screen.getByTestId("goal-contrib-protein")).toBeInTheDocument();

    // Micros come from the food; the Nutrients tab reveals them.
    await user.click(screen.getByTestId("tab-nutrients"));
    expect(await screen.findByTestId("preview-micro-sodium")).toBeInTheDocument();
    expect(screen.getByTestId("preview-micro-vitaminC")).toBeInTheDocument();
  });
});
