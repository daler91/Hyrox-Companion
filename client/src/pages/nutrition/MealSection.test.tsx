import type { FoodLogEntryWithNutrition } from "@shared/schema";
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

describe("MealSection", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(
      <MealSection label="Breakfast" entries={[]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fires edit and delete callbacks", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<MealSection label="Breakfast" entries={[ENTRY]} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.getByText("Banana")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-edit-e1"));
    expect(onEdit).toHaveBeenCalledWith(ENTRY);

    await user.click(screen.getByTestId("button-delete-e1"));
    expect(onDelete).toHaveBeenCalledWith("e1");
  });

  it("shows an AI badge only for nl/photo entries", () => {
    const { rerender } = render(
      <MealSection label="Breakfast" entries={[ENTRY]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId("ai-badge-e1")).not.toBeInTheDocument();

    rerender(
      <MealSection
        label="Breakfast"
        entries={[{ ...ENTRY, entryMethod: "nl" }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ai-badge-e1")).toBeInTheDocument();
  });
});
