import {
  applyMealTargetOverrides,
  computeMealFuelTargets,
  type MealFuelDailyTarget,
  type MealFuelTargets,
} from "@shared/mealFuelling";
import type { MealFuelTarget, UpsertMealTargetInput } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { MealTargetDialog, type MealTargetDialogState } from "./MealTargetDialog";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { setMealTargetOverride: vi.fn(), clearMealTargetOverride: vi.fn() } },
  QUERY_KEYS: { nutritionDayPrefix: ["/api/v1/nutrition/summary"] },
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
  const ui: ReactNode = <MealTargetDialog state={state} onClose={onClose} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { onClose };
}

const field = (key: string) => screen.getByTestId(`input-meal-target-${key}`);

async function saveAndCapture(user: ReturnType<typeof userEvent.setup>): Promise<UpsertMealTargetInput> {
  vi.mocked(api.nutrition.setMealTargetOverride).mockResolvedValue({ id: "mt1" } as never);
  await user.click(screen.getByTestId("button-save-meal-target"));
  await waitFor(() => {
    expect(api.nutrition.setMealTargetOverride).toHaveBeenCalledTimes(1);
  });
  return vi.mocked(api.nutrition.setMealTargetOverride).mock.calls[0][0];
}

describe("MealTargetDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the suggested values as placeholders and pins only what is typed", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ mealType: "dinner", target: TARGET, isOverridden: false });

    expect(field("carbG")).toHaveValue(null);
    expect(field("carbG")).toHaveAttribute("placeholder", "70");
    expect(field("calories")).toHaveAttribute("placeholder", "600");

    await user.type(field("carbG"), "120");

    expect(await saveAndCapture(user)).toEqual({
      mealType: "dinner",
      calories: null,
      proteinG: null,
      carbG: 120,
      fatG: null,
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("keeps Save disabled until a field is pinned", () => {
    renderDialog({ mealType: "dinner", target: TARGET, isOverridden: false });
    expect(screen.getByTestId("button-save-meal-target")).toBeDisabled();
  });

  it("shows the meal's existing pins, keeps them, and unpins a cleared field", async () => {
    const user = userEvent.setup();
    const pinned: MealFuelTarget = {
      ...TARGET,
      calories: 900,
      proteinG: 50,
      reasonCodes: ["standard_split", "user_override"],
      override: { calories: 900, proteinG: 50, carbG: null, fatG: null },
    };
    renderDialog({ mealType: "dinner", target: pinned, isOverridden: true });

    expect(field("calories")).toHaveValue(900);
    expect(field("proteinG")).toHaveValue(50);
    expect(field("carbG")).toHaveValue(null);

    await user.clear(field("proteinG"));
    await user.type(field("fatG"), "20");

    expect(await saveAndCapture(user)).toEqual({
      mealType: "dinner",
      calories: 900,
      proteinG: null,
      carbG: null,
      fatG: 20,
    });
  });

  const lunchFor = (daily: MealFuelDailyTarget) =>
    computeMealFuelTargets({
      daily,
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;

  it("shows a pinned field's fallback, not the pin, as its placeholder", async () => {
    const user = userEvent.setup();
    const targets = lunchFor({ calories: 2500, proteinG: 150, carbG: null, fatG: null });
    const merged = applyMealTargetOverrides(targets, { lunch: { proteinG: 50 } }).lunch as MealFuelTarget;
    renderDialog({ mealType: "lunch", target: merged, isOverridden: true });

    expect(field("proteinG")).toHaveValue(50);
    // C21 (CODEBASE_ANALYSIS_2026-10-03): a blank calorie field reads what the
    // meal will: 720 kcal plus the extra 12.5 g protein, not the split's 720.
    expect(field("calories")).toHaveValue(null);
    expect(field("calories")).toHaveAttribute("placeholder", String(merged.calories));
    expect(merged.calories).toBe(770);
    // Clearing the pin falls back to the split's 37.5 g, so that is the hint.
    await user.clear(field("proteinG"));
    expect(field("proteinG")).toHaveAttribute("placeholder", "37.5");
    expect(field("calories")).toHaveAttribute("placeholder", "720");
  });

  // C21 (CODEBASE_ANALYSIS_2026-10-03): with all three macros pinned and one
  // edited, the meal's calories are its macros' energy, but the calorie field
  // stayed editable and its number was dropped: a row the old editor saved,
  // {780 kcal, 60 g protein, 96 g carbs, 24 g fat}, edited to 900 kcal read 840.
  describe("calories the pinned macros set", () => {
    const legacyRow = { calories: 780, proteinG: 60, carbG: 96, fatG: 24 };

    function openLegacyRow(): MealFuelTargets {
      const targets = lunchFor({ calories: 2600, proteinG: 180, carbG: 320, fatG: 80 });
      expect(targets.lunch).toMatchObject({ calories: 780, proteinG: 45, carbG: 96, fatG: 24 });
      const target = applyMealTargetOverrides(targets, { lunch: legacyRow }).lunch as MealFuelTarget;
      renderDialog({ mealType: "lunch", target, isOverridden: true });
      return targets;
    }

    it("shows the derived figure locked, and saves no calorie pin beside it", async () => {
      const user = userEvent.setup();
      const targets = openLegacyRow();

      expect(field("calories")).toHaveValue(840);
      expect(field("calories")).toHaveAttribute("readonly");
      expect(screen.getByTestId("text-meal-target-calories-from-macros")).toBeInTheDocument();

      const saved = await saveAndCapture(user);
      expect(saved).toEqual({ mealType: "lunch", calories: null, proteinG: 60, carbG: 96, fatG: 24 });
      expect(applyMealTargetOverrides(targets, { lunch: saved }).lunch?.calories).toBe(840);
    });

    // C21 (CODEBASE_ANALYSIS_2026-10-03): the locked field was disabled, so it
    // left the tab order, and the note saying why was tied to nothing: a
    // screen reader never announced it with the field.
    it("keeps the locked field focusable and describes it with the note", async () => {
      const user = userEvent.setup();
      openLegacyRow();

      expect(field("calories")).toHaveAccessibleDescription(
        "Calories follow the three macros you pinned. Clear a macro to set calories yourself.",
      );
      await user.click(field("calories"));
      expect(field("calories")).toHaveFocus();
      await user.keyboard("5");
      expect(field("calories")).toHaveValue(840);
    });

    it("unlocks the calories once a macro is cleared, without the old echo", async () => {
      const user = userEvent.setup();
      const targets = openLegacyRow();

      await user.clear(field("carbG"));

      expect(field("calories")).not.toHaveAttribute("readonly");
      expect(field("calories")).not.toHaveAttribute("aria-describedby");
      expect(screen.queryByTestId("text-meal-target-calories-from-macros")).toBeNull();
      // The overruled 780 kcal is not revived as a pin.
      expect(field("calories")).toHaveValue(null);
      expect(field("calories")).toHaveAttribute("placeholder", "840");

      await user.type(field("calories"), "900");
      const saved = await saveAndCapture(user);
      expect(saved).toEqual({ mealType: "lunch", calories: 900, proteinG: 60, carbG: null, fatG: 24 });
      expect(applyMealTargetOverrides(targets, { lunch: saved }).lunch?.calories).toBe(900);
    });

    it("locks the calories as the third macro is typed on a protein-only day", async () => {
      const user = userEvent.setup();
      const targets = lunchFor({ calories: 2500, proteinG: 150, carbG: null, fatG: null });
      renderDialog({ mealType: "lunch", target: targets.lunch as MealFuelTarget, isOverridden: false });

      await user.type(field("calories"), "900");
      await user.type(field("proteinG"), "50");
      await user.type(field("carbG"), "80");
      expect(field("calories")).not.toHaveAttribute("readonly");
      expect(screen.getByRole("status")).toHaveTextContent("");
      await user.type(field("fatG"), "20");

      // 50 g protein, 80 g carbs and 20 g fat: 700 kcal, whatever was typed.
      expect(field("calories")).toHaveAttribute("readonly");
      expect(field("calories")).toHaveValue(700);
      // C21 (CODEBASE_ANALYSIS_2026-10-03): the lock happens away from the
      // field, so a live region announces it as the third macro is typed.
      expect(screen.getByRole("status")).toHaveTextContent(
        "Calories now follow the three macros you pinned.",
      );
      const saved = await saveAndCapture(user);
      expect(saved.calories).toBeNull();
      expect(applyMealTargetOverrides(targets, { lunch: saved }).lunch?.calories).toBe(700);
    });

    it("keeps a calorie-only row's pin beside 0 g echoes, and lets the echoes be cleared", async () => {
      const user = userEvent.setup();
      const targets = lunchFor({ calories: 2500, proteinG: null, carbG: null, fatG: null });
      const row = { calories: 800, proteinG: 0, carbG: 0, fatG: 0 };
      const target = applyMealTargetOverrides(targets, { lunch: row }).lunch as MealFuelTarget;
      renderDialog({ mealType: "lunch", target, isOverridden: true });

      await user.clear(field("proteinG"));
      await user.type(field("proteinG"), "40");
      expect(field("calories")).not.toHaveAttribute("readonly");
      expect(field("calories")).toHaveValue(800);
      await user.clear(field("carbG"));
      await user.clear(field("fatG"));

      const saved = await saveAndCapture(user);
      expect(saved).toEqual({ mealType: "lunch", calories: 800, proteinG: 40, carbG: null, fatG: null });
      expect(applyMealTargetOverrides(targets, { lunch: saved }).lunch?.calories).toBe(800);
    });
  });

  // C21 (CODEBASE_ANALYSIS_2026-10-03): the dialog sent every shown value, so a
  // calorie edit arrived with the meal's macros and was dropped. Each probe
  // runs the saved payload through the real merge.
  describe("a calorie edit reaches the meal target", () => {

    async function editCalories(targets: MealFuelTargets, calories: string) {
      const user = userEvent.setup();
      const target = targets.lunch as MealFuelTarget;
      renderDialog({ mealType: "lunch", target, isOverridden: false });
      await user.type(field("calories"), calories);
      const override = await saveAndCapture(user);
      return { override, merged: applyMealTargetOverrides(targets, { lunch: override }).lunch };
    }

    it("on a calorie-only day (lunch 750 -> 800)", async () => {
      const targets = lunchFor({ calories: 2500, proteinG: null, carbG: null, fatG: null });
      expect(targets.lunch?.calories).toBe(750);

      const { override, merged } = await editCalories(targets, "800");

      expect(override).toEqual({
        mealType: "lunch",
        calories: 800,
        proteinG: null,
        carbG: null,
        fatG: null,
      });
      expect(merged?.calories).toBe(800);
    });

    it("on a protein-only day (lunch 720 -> 900)", async () => {
      const targets = lunchFor({ calories: 2500, proteinG: 150, carbG: null, fatG: null });
      expect(targets.lunch).toMatchObject({ calories: 720, proteinG: 37.5 });

      const { merged } = await editCalories(targets, "900");

      expect(merged).toMatchObject({ calories: 900, proteinG: 37.5 });
    });
  });

  it("shows Reset for an already-overridden meal and clears it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.clearMealTargetOverride).mockResolvedValue({ success: true });
    const { onClose } = renderDialog({ mealType: "lunch", target: TARGET, isOverridden: true });

    await user.click(screen.getByTestId("button-reset-meal-target"));
    await waitFor(() => {
      expect(api.nutrition.clearMealTargetOverride).toHaveBeenCalledWith("lunch");
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("hides Reset when the meal has no override", () => {
    renderDialog({ mealType: "dinner", target: TARGET, isOverridden: false });
    expect(screen.queryByTestId("button-reset-meal-target")).toBeNull();
  });
});
