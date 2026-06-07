import type { Food, FoodLogEntryWithNutrition } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLogFood, useUpdateLog } from "@/hooks/useNutrition";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { LogFoodDialog } from "./LogFoodDialog";

vi.mock("@/hooks/useNutrition", () => ({ useLogFood: vi.fn(), useUpdateLog: vi.fn() }));

installRadixPointerMocks();

const logMutate = vi.fn();
const updateMutate = vi.fn();

const FOOD = {
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
  createdAt: new Date(),
  updatedAt: new Date(),
} as Food;

describe("LogFoodDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLogFood).mockReturnValue({ mutate: logMutate, isPending: false } as never);
    vi.mocked(useUpdateLog).mockReturnValue({ mutate: updateMutate, isPending: false } as never);
  });

  it("previews scaled nutrition and logs the food on submit", async () => {
    const user = userEvent.setup();
    render(<LogFoodDialog state={{ mode: "create", food: FOOD }} date="2026-06-07" onClose={vi.fn()} />);

    expect(screen.getByText("Banana")).toBeInTheDocument();
    // Default quantity = serving size (118 g) → 89 * 118 / 100 ≈ 105 kcal.
    expect(screen.getByTestId("preview-calories")).toHaveTextContent("105");

    const quantity = screen.getByTestId("input-quantity");
    await user.clear(quantity);
    await user.type(quantity, "200");
    // 89 * 200 / 100 = 178 kcal.
    expect(screen.getByTestId("preview-calories")).toHaveTextContent("178");

    await user.click(screen.getByTestId("button-submit-log"));
    expect(logMutate).toHaveBeenCalledWith(
      expect.objectContaining({ foodId: "f1", quantityG: 200 }),
      expect.any(Object),
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
    render(<LogFoodDialog state={{ mode: "edit", entry }} date="2026-06-07" onClose={vi.fn()} />);

    expect(screen.getByText("Edit entry")).toBeInTheDocument();
    const quantity = screen.getByTestId("input-quantity");
    await user.clear(quantity);
    await user.type(quantity, "200");

    await user.click(screen.getByTestId("button-submit-log"));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e1", data: expect.objectContaining({ quantityG: 200 }) }),
      expect.any(Object),
    );
  });
});
