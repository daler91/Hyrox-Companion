import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LazyMealTargetDialog, LazyTargetsDialog } from "./LazyNutritionDialogs";

const loads = vi.hoisted(() => ({ targets: 0, meal: 0 }));

vi.mock("./TargetsDialog", () => {
  loads.targets += 1;
  return {
    TargetsDialog: ({ open }: { open: boolean }) => (
      <div data-testid="targets-dialog" data-open={String(open)} />
    ),
  };
});

vi.mock("./MealTargetDialog", () => {
  loads.meal += 1;
  return {
    MealTargetDialog: ({ state }: { state: unknown }) => (
      <div data-testid="meal-target-dialog" data-open={String(state !== null)} />
    ),
  };
});

// The tests share one module load and run in order: the closed checks must
// run before any test that opens a dialog and loads its module.
describe("LazyNutritionDialogs", { shuffle: false }, () => {
  it("renders nothing and loads no dialog code while closed", () => {
    const { container } = render(
      <>
        <LazyTargetsDialog open={false} current={null} onClose={vi.fn()} />
        <LazyMealTargetDialog state={null} onClose={vi.fn()} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(loads).toEqual({ targets: 0, meal: 0 });
  });

  it("loads a dialog on first open and keeps it mounted after close", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<LazyTargetsDialog open={false} current={null} onClose={onClose} />);

    rerender(<LazyTargetsDialog open current={null} onClose={onClose} />);
    expect(await screen.findByTestId("targets-dialog")).toHaveAttribute("data-open", "true");
    expect(loads.targets).toBe(1);

    // Staying mounted keeps the Radix close animation and in-dialog state.
    rerender(<LazyTargetsDialog open={false} current={null} onClose={onClose} />);
    expect(screen.getByTestId("targets-dialog")).toHaveAttribute("data-open", "false");
    expect(loads.meal).toBe(0);
  });
});
