import type { FoodLogEntryWithNutrition, MealFuelTarget } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MealSection } from "./MealSection";

const ENTRY: FoodLogEntryWithNutrition = {
  id: "e1",
  foodId: "f1",
  name: "Banana",
  brand: null,
  loggedAt: "2026-06-07T08:00:00.000Z",
  logDate: "2026-06-07",
  quantityG: 118,
  mealType: "breakfast",
  entryMethod: "manual",
  nutrition: { calories: 105, protein: 1.3, carb: 27, fat: 0.4, fiber: 3.1 },
};

const TARGET: MealFuelTarget = {
  calories: 464,
  carbG: 53,
  proteinG: 45,
  fatG: 8,
  role: "post_workout_recovery",
  reasonCodes: ["post_workout_recovery"],
  rationale: "Your post-workout refuel — 53g carbs + 45g protein to recover.",
};

describe("MealSection", () => {
  it("renders nothing when there are no entries and no target", () => {
    const { container } = render(
      <MealSection label="Breakfast" mealType="breakfast" entries={[]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the per-meal target even when nothing is logged", () => {
    render(
      <MealSection
        label="Breakfast"
        mealType="breakfast"
        entries={[]}
        target={TARGET}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("meal-target-breakfast")).toBeInTheDocument();
    expect(screen.getByText("Post-workout refuel")).toBeInTheDocument();
    expect(screen.getByText(TARGET.rationale)).toBeInTheDocument();
    expect(screen.getByText("0/53g")).toBeInTheDocument(); // carb target, nothing logged
    expect(screen.getByTestId("meal-empty-breakfast")).toBeInTheDocument();
  });

  it("shows logged progress against the meal target", () => {
    render(
      <MealSection
        label="Breakfast"
        mealType="breakfast"
        entries={[ENTRY]}
        target={TARGET}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("27/53g")).toBeInTheDocument(); // logged carbs vs target
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("fires edit callback on edit click", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<MealSection label="Breakfast" mealType="breakfast" entries={[ENTRY]} onEdit={onEdit} onDelete={vi.fn()} />);

    expect(screen.getByText("Banana")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-edit-e1"));
    expect(onEdit).toHaveBeenCalledWith(ENTRY);
  });

  it("requires confirmation before deleting", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <MealSection label="Breakfast" mealType="breakfast" entries={[ENTRY]} onEdit={vi.fn()} onDelete={onDelete} />,
    );

    await user.click(screen.getByTestId("button-delete-e1"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete food entry?")).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-delete-food-log"));
    expect(onDelete).toHaveBeenCalledWith("e1");
  });

  it("cancels delete when dismissed", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <MealSection label="Breakfast" mealType="breakfast" entries={[ENTRY]} onEdit={vi.fn()} onDelete={onDelete} />,
    );

    await user.click(screen.getByTestId("button-delete-e1"));
    await user.click(screen.getByTestId("cancel-delete-food-log"));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("shows an AI badge only for nl/photo entries", () => {
    const { rerender } = render(
      <MealSection label="Breakfast" mealType="breakfast" entries={[ENTRY]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId("ai-badge-e1")).not.toBeInTheDocument();

    rerender(
      <MealSection
        label="Breakfast"
        mealType="breakfast"
        entries={[{ ...ENTRY, entryMethod: "nl" }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ai-badge-e1")).toBeInTheDocument();
  });

  it("opens the per-meal target editor when a target + handler are provided", async () => {
    const onEditTarget = vi.fn();
    const user = userEvent.setup();
    render(
      <MealSection
        label="Breakfast"
        mealType="breakfast"
        entries={[]}
        target={TARGET}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onEditTarget={onEditTarget}
      />,
    );
    await user.click(screen.getByTestId("button-edit-meal-target-breakfast"));
    expect(onEditTarget).toHaveBeenCalledWith("breakfast");
  });

  it("labels an overridden target 'Custom'", () => {
    render(
      <MealSection
        label="Dinner"
        mealType="dinner"
        entries={[]}
        target={{ ...TARGET, reasonCodes: ["standard_split", "user_override"] }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onEditTarget={vi.fn()}
      />,
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
