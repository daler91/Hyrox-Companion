import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LazyGeneratePlanDialog } from "../LazyGeneratePlanDialog";

const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/plans/GeneratePlanDialog", () => {
  loads.count += 1;
  return {
    GeneratePlanDialog: ({ open, initialGoal }: { open: boolean; initialGoal?: string }) => (
      <div data-testid="generate-plan-dialog" data-open={String(open)} data-goal={initialGoal} />
    ),
  };
});

// The tests share one module load and run in order: the closed test must run
// before any test that opens the dialog and loads the module.
describe("LazyGeneratePlanDialog", { shuffle: false }, () => {
  it("renders nothing and loads no dialog code while closed", () => {
    const { container } = render(<LazyGeneratePlanDialog open={false} onOpenChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(loads.count).toBe(0);
  });

  it("loads the dialog on first open, forwards props, and stays mounted after close", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <LazyGeneratePlanDialog open={false} onOpenChange={onOpenChange} />,
    );

    rerender(<LazyGeneratePlanDialog open onOpenChange={onOpenChange} initialGoal="hyrox" />);
    const dialog = await screen.findByTestId("generate-plan-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
    expect(dialog).toHaveAttribute("data-goal", "hyrox");
    expect(loads.count).toBe(1);

    // Staying mounted keeps the close animation and an in-flight generation alive.
    rerender(<LazyGeneratePlanDialog open={false} onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("generate-plan-dialog")).toHaveAttribute("data-open", "false");
  });
});
