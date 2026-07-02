import type { Food, FoodLogEntry, FoodLogEntryWithNutrition, FoodServing } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { LogFoodDialog } from "./LogFoodDialog";

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
    renderWithClient(<LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />);

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
    const slice: FoodServing = { id: "s9", foodId: "f1", label: "1 slice", grams: 95, createdByUserId: "u1" };
    vi.mocked(api.nutrition.addServing).mockResolvedValue(slice);
    const user = userEvent.setup();
    renderWithClient(<LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />);

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
    renderWithClient(<LogFoodDialog state={{ mode: "edit", entry }} date="2026-06-07" onClose={vi.fn()} />);

    expect(screen.getByText("Edit entry")).toBeInTheDocument();
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
