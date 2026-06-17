import type { MealFuelTarget } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { MealTargetDialog, type MealTargetDialogState } from "./MealTargetDialog";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { setMealTargetOverride: vi.fn(), clearMealTargetOverride: vi.fn() } },
  QUERY_KEYS: { nutritionDay: (d: string) => ["/api/v1/nutrition/summary", d] },
}));

const TARGET: MealFuelTarget = {
  calories: 600,
  carbG: 70,
  proteinG: 30,
  fatG: 18,
  role: "standard",
  reasonCodes: ["standard_split"],
  rationale: "Steady fuel.",
};

function renderDialog(state: MealTargetDialogState | null, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <MealTargetDialog date="2026-06-07" state={state} onClose={onClose} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { onClose };
}

describe("MealTargetDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds fields from the meal target and saves an override", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.setMealTargetOverride).mockResolvedValue({ id: "mt1" } as never);
    const { onClose } = renderDialog({ mealType: "dinner", target: TARGET, isOverridden: false });

    expect(screen.getByTestId("input-meal-target-carbG")).toHaveValue(70);

    await user.clear(screen.getByTestId("input-meal-target-carbG"));
    await user.type(screen.getByTestId("input-meal-target-carbG"), "120");
    await user.click(screen.getByTestId("button-save-meal-target"));

    await waitFor(() => expect(api.nutrition.setMealTargetOverride).toHaveBeenCalledTimes(1));
    expect(api.nutrition.setMealTargetOverride).toHaveBeenCalledWith(
      expect.objectContaining({ mealType: "dinner", carbG: 120, proteinG: 30, fatG: 18, calories: 600 }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows Reset for an already-overridden meal and clears it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.clearMealTargetOverride).mockResolvedValue({ success: true });
    const { onClose } = renderDialog({ mealType: "lunch", target: TARGET, isOverridden: true });

    await user.click(screen.getByTestId("button-reset-meal-target"));
    await waitFor(() => expect(api.nutrition.clearMealTargetOverride).toHaveBeenCalledWith("lunch"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("hides Reset when the meal has no override", () => {
    renderDialog({ mealType: "dinner", target: TARGET, isOverridden: false });
    expect(screen.queryByTestId("button-reset-meal-target")).toBeNull();
  });
});
